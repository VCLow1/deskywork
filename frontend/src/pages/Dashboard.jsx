import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import {
  memberApi,
  subscriptionApi,
  bookingApi,
  sessionApi,
  formationApi,
  memberPortalApi,
  paymentApi,
} from '../services/api';
import {
  connectSocket,
  joinUser,
  onSessionStarted,
  onSessionEnded,
  onSessionOvertime,
  onSessionAlert15Min,
  disconnectSocket,
} from '../services/socket';
import PortalLayout from '../components/layout/PortalLayout';
import PeriodFilter from '../components/dashboard/PeriodFilter';
import Money from '../components/common/Money';
import { DEFAULT_PERIOD, periodWindow, windowLabel } from '../utils/dashboardPeriod';
import { isCompanyRole } from '../utils/roles';
import { useSessionUser } from '../hooks/useSessionUser';
import { useServerTimer, formatHMSDuration } from '../hooks/useServerTimer';
import { formatDateDMY, formatTime24h, getTunisHourMinute } from '../utils/format';
import { QRCodeSVG } from 'qrcode.react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const TIMER_RING_RADIUS = 42;
const TIMER_RING_CIRCUMFERENCE = 2 * Math.PI * TIMER_RING_RADIUS;
const ALERT_THRESHOLD_SECONDS = 900;

const SUBSCRIPTION_LABELS = {
  day_pass: 'Pass journée',
  week_pass: 'Pass semaine',
  mensuel: 'Mensuel',
  trimestriel: 'Trimestriel',
  annuel: 'Annuel',
  bureau_prive: 'Bureau privé',
};

const PAYMENT_STATUT_LABELS = {
  pending: 'En attente',
  partial: 'Partiel',
  paid: 'Encaissé',
  failed: 'Échoué',
  refunded: 'Remboursé',
};

const PAYMENT_STATUT_COLORS = {
  paid: 'bg-emerald-100 text-emerald-700',
  partial: 'bg-amber-100 text-amber-700',
  pending: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-600',
  refunded: 'bg-violet-100 text-violet-700',
};

const SPACE_TYPE_LABELS = {
  open_space: 'Open space',
  private_office: 'Bureau privé',
  meeting_room: 'Salle de réunion',
  training_room: 'Salle de formation',
  event_space: 'Espace événementiel',
  hot_desk: 'Poste nomade',
  dedicated_desk: 'Poste fixe',
};

const styleSheet = `
@keyframes bento-fade-in { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
@keyframes pulse-dot { 0%,100% { opacity:1; } 50% { opacity:.45; } }
.bento-card { animation: bento-fade-in .4s ease-out both; }
.pulse-dot { animation: pulse-dot 1.6s ease-in-out infinite; }
.progress-ring__circle {
  transition: stroke-dashoffset .4s ease;
  transform: rotate(-90deg);
  transform-origin: 50% 50%;
}
`;

function formatTimeShort(dateStr) {
  return formatTime24h(dateStr);
}

function formatDateShort(dateStr) {
  return formatDateDMY(dateStr);
}

function greeting() {
  const { hour } = getTunisHourMinute(Date.now());
  if (hour < 12) return 'Bonjour';
  if (hour < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

export default function Dashboard({ session }) {
  const navigate = useNavigate();
  const { userId, email, metadata } = useSessionUser(session);

  const [profile, setProfile] = useState(() =>
    userId ? { id: userId, email, role: metadata.role || 'member', prenom: metadata.prenom || '', nom: metadata.nom || '', ...metadata } : null
  );
  const [activeSubscription, setActiveSubscription] = useState(null);
  const [pendingSubRequest, setPendingSubRequest] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [myFormations, setMyFormations] = useState([]);
  const [availableFormations, setAvailableFormations] = useState([]);
  const [nearbySpaces, setNearbySpaces] = useState([]);
  const [nearbySummary, setNearbySummary] = useState({ total: 0, disponibles: 0, total_units: 0, available_units: 0 });
  const [montantsDus, setMontantsDus] = useState({ items: [], total_du: 0 });
  const [recentReceipts, setRecentReceipts] = useState([]);
  const [downloadingReceipt, setDownloadingReceipt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [memberQr, setMemberQr] = useState(null);

  // Bloc 8 repliable (fermé par défaut) contenant son filtre de période
  const [activityOpen, setActivityOpen] = useState(false);
  const [period, setPeriod] = useState(DEFAULT_PERIOD);

  // Redirection B2B Entreprise
  useEffect(() => {
    const isComp = isCompanyRole(metadata?.role, metadata?.type_membre) || isCompanyRole(profile?.role, profile?.type_membre);
    if (isComp) navigate('/company/dashboard', { replace: true });
  }, [metadata, profile, navigate]);

  // Chronomètre serveur (RM-15 à RM-17)
  const [activeSession, setActiveSession] = useState(null);
  const [nextBooking, setNextBooking] = useState(null);
  const [serverNow, setServerNow] = useState(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const [extendingSession, setExtendingSession] = useState(false);
  const [extendConflict, setExtendConflict] = useState(null);

  const isTrulyStarted = Boolean(activeSession && (activeSession.started_at || activeSession.check_in));
  const serverTimer = useServerTimer({
    startedAt: activeSession?.started_at || activeSession?.check_in || null,
    endAt: activeSession?.reservations?.date_fin || null,
    serverNow,
    active: isTrulyStarted,
  });
  const nextBookingTimer = useServerTimer({
    startedAt: null,
    endAt: nextBooking?.date_debut || null,
    serverNow,
    active: Boolean(!isTrulyStarted && nextBooking),
  });
  const timerSeconds = serverTimer.remainingSeconds;
  const totalSessionSeconds = Math.max(1, serverTimer.totalPlannedSeconds || 1);

  const timerPercent = useMemo(() => {
    if (!totalSessionSeconds || totalSessionSeconds <= 0) return 0;
    return Math.min(1, timerSeconds / totalSessionSeconds);
  }, [timerSeconds, totalSessionSeconds]);

  const timerRingOffset = useMemo(() => TIMER_RING_CIRCUMFERENCE * (1 - timerPercent), [timerPercent]);

  const subscriptionDaysLeft = useMemo(() => {
    if (!activeSubscription?.date_fin) return null;
    const diff = new Date(activeSubscription.date_fin).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }, [activeSubscription]);

  // Bloc 6 : Formations à venir liées au catalogue réel
  const upcomingCatalogFormations = useMemo(() => {
    const now = Date.now();
    const myByFormId = new Map(
      (myFormations || [])
        .filter((i) => i.statut !== 'annulee')
        .map((i) => [i.formation_id, i])
    );
    return (availableFormations || [])
      .filter((f) => {
        if (!f || ['annulee', 'brouillon', 'terminee'].includes(f.statut)) return false;
        const dt = f.date_debut ? new Date(f.date_debut).getTime() : NaN;
        return !Number.isFinite(dt) || dt >= now - 2 * 3600 * 1000;
      })
      .sort((a, b) => new Date(a.date_debut || 0) - new Date(b.date_debut || 0))
      .slice(0, 4)
      .map((f) => ({
        ...f,
        myInscription: myByFormId.get(f.id) || null,
      }));
  }, [availableFormations, myFormations]);

  // Graphique Mon activité (Bloc 8 repliable)
  const memberActivityChart = useMemo(() => {
    const win = periodWindow(period);
    const buckets = [];
    const inRange = (dateStr, s, e) => {
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return d >= s && d <= e;
    };
    const countRes = (s, e) => (bookings || []).filter((b) => b.statut !== 'cancelled' && inRange(b.date_debut, s, e)).length;
    const countForm = (s, e) => (myFormations || []).filter((i) => i.statut !== 'annulee' && inRange(i.formations?.date_debut || i.created_at, s, e)).length;

    if (win.bucket === 'hour') {
      const y = win.fromJ.getFullYear();
      const m = win.fromJ.getMonth();
      const d = win.fromJ.getDate();
      for (let h = 0; h < 24; h++) {
        buckets.push({
          label: `${h}h`,
          reservations: countRes(new Date(y, m, d, h, 0, 0, 0), new Date(y, m, d, h, 59, 59, 999)),
          formations: countForm(new Date(y, m, d, h, 0, 0, 0), new Date(y, m, d, h, 59, 59, 999)),
        });
      }
    } else if (win.bucket === 'day') {
      const cur = new Date(win.fromJ);
      cur.setHours(0, 0, 0, 0);
      let count = 0;
      while (cur <= win.toJ && count < 60) {
        const s = new Date(cur);
        const e = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), 23, 59, 59, 999);
        buckets.push({ label: cur.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), reservations: countRes(s, e), formations: countForm(s, e) });
        cur.setDate(cur.getDate() + 1);
        count++;
      }
    } else if (win.bucket === 'month') {
      const cur = new Date(win.fromJ.getFullYear(), win.fromJ.getMonth(), 1);
      let count = 0;
      while (cur <= win.toJ && count < 36) {
        const s = new Date(cur);
        const e = new Date(cur.getFullYear(), cur.getMonth() + 1, 0, 23, 59, 59, 999);
        buckets.push({ label: cur.toLocaleDateString('fr-FR', { month: 'short' }), reservations: countRes(s, e), formations: countForm(s, e) });
        cur.setMonth(cur.getMonth() + 1);
        count++;
      }
    } else {
      for (let yr = win.fromJ.getFullYear(); yr <= win.toJ.getFullYear(); yr++) {
        buckets.push({
          label: String(yr),
          reservations: countRes(new Date(yr, 0, 1), new Date(yr, 11, 31, 23, 59, 59, 999)),
          formations: countForm(new Date(yr, 0, 1), new Date(yr, 11, 31, 23, 59, 59, 999)),
        });
      }
    }
    return buckets;
  }, [bookings, myFormations, period]);

  const pStr = typeof period === 'string' ? period : (period?.key || 'mois');
  const memberActivityCaption = pStr.startsWith('jour') ? `Par heure · ${windowLabel(period)}`
    : (pStr.startsWith('mois') || pStr.startsWith('semaine') || pStr.startsWith('custom')) ? `Par jour · ${windowLabel(period)}`
      : (pStr.startsWith('annee') || pStr.startsWith('trimestre')) ? `Par mois · ${windowLabel(period)}`
        : 'Par année · historique';

  const hydrateSession = (sess, srvNow = null, nxtBooking = undefined) => {
    setActiveSession(sess);
    if (srvNow) setServerNow(srvNow);
    if (nxtBooking !== undefined) setNextBooking(nxtBooking);
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      let prof = null;
      let subscription = null;
      let subscriptions = [];
      let reservations = [];
      let myF = [];
      let allF = [];

      const [profRes, subRes, mySubsRes, bkRes, myFRes, avFRes, activeRes, nearbyRes, payRes, duRes] = await Promise.allSettled([
        memberApi.getMe(),
        subscriptionApi.getActive(),
        subscriptionApi.getMine(),
        bookingApi.getAll(),
        formationApi.getMesFormations(),
        formationApi.getAll({}),
        sessionApi.getActive(),
        memberPortalApi.getNearbySpaces(),
        session?.user?.id ? paymentApi.getMemberPayments(session.user.id) : Promise.resolve({ payments: [] }),
        paymentApi.getMyMontantDu(),
      ]);

      if (profRes.status === 'fulfilled') prof = profRes.value?.profile || profRes.value;
      if (!prof && session?.user?.id) {
        const { data: dbProf } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
        prof = dbProf || null;
      }
      if (subRes.status === 'fulfilled' && subRes.value?.subscription?.id) subscription = subRes.value.subscription;
      if (mySubsRes.status === 'fulfilled') subscriptions = mySubsRes.value?.subscriptions || [];
      if (bkRes.status === 'fulfilled') reservations = bkRes.value?.reservations || (Array.isArray(bkRes.value) ? bkRes.value : []);
      if (myFRes.status === 'fulfilled') myF = myFRes.value?.inscriptions || [];
      if (avFRes.status === 'fulfilled') allF = avFRes.value?.formations || [];

      if (activeRes.status === 'fulfilled') {
        hydrateSession(activeRes.value.session, activeRes.value.server_now, activeRes.value.next_booking);
      } else {
        setActiveSession(null);
        setNextBooking(null);
      }

      if (nearbyRes.status === 'fulfilled') {
        setNearbySpaces(nearbyRes.value.espaces || []);
        setNearbySummary({
          total: nearbyRes.value.total ?? 0,
          disponibles: nearbyRes.value.disponibles ?? 0,
          total_units: nearbyRes.value.total_units ?? 0,
          available_units: nearbyRes.value.available_units ?? 0,
        });
      } else {
        setNearbySpaces([]);
      }

      const allPays = payRes.status === 'fulfilled' ? (payRes.value?.payments || []) : [];
      const receiptsOnly = allPays.filter((p) => ['paid', 'refunded'].includes(p.statut)).slice(0, 4);
      setRecentReceipts(receiptsOnly);

      if (duRes.status === 'fulfilled') {
        setMontantsDus({
          items: duRes.value?.items || [],
          total_du: Number(duRes.value?.total_du || 0),
        });
      } else {
        const fallbackDue = allPays.filter((p) => ['pending', 'partial'].includes(p.statut));
        setMontantsDus({
          items: fallbackDue,
          total_du: fallbackDue.reduce((s, p) => s + Number(p.reste_a_payer ?? p.montant ?? 0), 0),
        });
      }

      const pendingSub = subscriptions.find((s) => s.statut === 'en_attente_paiement') || null;
      setProfile(prof);
      setActiveSubscription(subscription);
      setPendingSubRequest(pendingSub);
      setBookings(reservations);
      setMyFormations(myF);
      setAvailableFormations(allF);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [session]);

  const refreshMemberQr = () => {
    memberApi.getQr().then((qr) => setMemberQr(qr)).catch(() => {});
  };

  useEffect(() => {
    let active = true;
    memberApi.getQr().then((qr) => { if (active) setMemberQr(qr); }).catch(() => {});
    const autoId = setInterval(() => { if (active) refreshMemberQr(); }, 4 * 60 * 1000);
    return () => { active = false; clearInterval(autoId); };
  }, [session]);

  useEffect(() => {
    if (!session?.user?.id) return;
    connectSocket();
    joinUser(session.user.id);
    const unsubs = [
      onSessionStarted((data) => { hydrateSession(data); loadData(); }),
      onSessionEnded(() => { setActiveSession(null); loadData(); }),
      onSessionOvertime(() => { loadData(); }),
      onSessionAlert15Min((data) => {
        setSuccess(`Attention : moins de 15 min restantes — ${data.espace?.nom || 'espace de travail'}.`);
      }),
    ];
    return () => { unsubs.forEach((fn) => fn()); disconnectSocket(); };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!activeSession) return;
    const id = setInterval(() => {
      sessionApi
        .getActive()
        .then(({ session: sess, server_now, next_booking }) => hydrateSession(sess, server_now, next_booking))
        .catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, [activeSession?.id]);

  const handleExtendMemberSession = async (minutes = 30) => {
    if (!activeSession) return;
    setExtendingSession(true);
    setError('');
    setExtendConflict(null);
    try {
      const res = await sessionApi.extend(activeSession.id, { minutes });
      setSuccess(res.message || `Session prolongée de ${minutes} min (payable sur place).`);
      const activeRes = await sessionApi.getActive();
      hydrateSession(activeRes.session, activeRes.server_now, activeRes.next_booking);
    } catch (e) {
      if (e.status === 409 || e.body?.conflict) {
        setExtendConflict({
          message: e.message || 'Le créneau suivant est déjà réservé.',
          alternatives: e.body?.alternatives || { slots: [], units: [] },
        });
      } else {
        setError(e.message);
      }
    } finally {
      setExtendingSession(false);
    }
  };

  const handleCheckOut = async () => {
    if (!activeSession) return;
    setCheckingOut(true);
    setError('');
    try {
      const res = await sessionApi.checkOut({ session_id: activeSession.id });
      setShowFinishConfirm(false);
      setActiveSession(null);
      setSuccess(res.message || 'Session terminée. L’accueil a été prévenu.');
      await loadData();
    } catch (e) {
      setError(e.message);
    } finally {
      setCheckingOut(false);
    }
  };

  const handleDownloadReceipt = async (p) => {
    if (!['paid', 'refunded'].includes(p.statut)) return;
    setError('');
    try {
      setDownloadingReceipt(p.id);
      await paymentApi.downloadReceipt(p.id, p.numero_recu);
    } catch (e) {
      setError(e.message);
    } finally {
      setDownloadingReceipt(null);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  if (loading) {
    return (
      <PortalLayout profile={profile} onLogout={handleLogout}>
        <style>{styleSheet}</style>
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-white dark:bg-[#1a1917] rounded-3xl p-6 border border-outline-variant/15 animate-pulse h-28" />
          ))}
        </div>
      </PortalLayout>
    );
  }

  const timerIsLow = isTrulyStarted && !serverTimer.isOvertime && timerSeconds > 0 && timerSeconds <= ALERT_THRESHOLD_SECONDS;
  const timerIsOvertime = isTrulyStarted && serverTimer.isOvertime;
  const timerColor = timerIsOvertime ? '#ef4444' : timerIsLow ? '#f59e0b' : '#2FBE8F';
  const overtimeHourlyRate = activeSession?.overtime_rate ?? activeSession?.reservations?.espaces?.tarif_horaire ?? 0;
  const needsProfileCompletion = !profile?.telephone?.trim() || !profile?.cin?.trim();

  return (
    <PortalLayout profile={profile} onLogout={handleLogout}>
      <style>{styleSheet}</style>

      {/* En-tête Accueil */}
      <header className="mb-5 bento-card flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-on-surface-variant mb-1">
            {new Date().toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis', weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1 className="font-sora font-bold text-primary dark:text-white" style={{ fontSize: 'clamp(20px, 5vw, 28px)', lineHeight: '1.25' }}>
            {greeting()}, {profile?.prenom || 'Membre'}
          </h1>
        </div>
        <Link
          to="/book/step1"
          className="inline-flex items-center justify-center gap-2 text-sm font-semibold text-white px-4 py-2.5 rounded-xl shrink-0 transition-all hover:opacity-95 active:scale-[.97] w-full sm:w-auto"
          style={{ background: '#f95d00', boxShadow: '0 4px 14px rgba(249,93,0,.28)' }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add_circle</span>
          Réserver un espace
        </Link>
      </header>

      {/* Bannière discrète "Complétez votre profil" uniquement si téléphone ou CIN manquant */}
      {needsProfileCompletion && (
        <div className="mb-5 px-4 py-3 rounded-2xl border border-[#f95d00]/25 bg-[#ffedd8]/60 dark:bg-[#f95d00]/10 flex flex-wrap items-center justify-between gap-3 bento-card">
          <div className="flex items-center gap-2.5 text-xs sm:text-sm text-primary dark:text-white">
            <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 20 }}>badge</span>
            <span>
              <strong>Complétez votre profil</strong> — renseignez votre{' '}
              {!profile?.telephone?.trim() && !profile?.cin?.trim()
                ? 'téléphone et votre numéro CIN'
                : !profile?.telephone?.trim()
                  ? 'numéro de téléphone'
                  : 'numéro CIN'}{' '}
              pour accélérer vos réservations et votre accueil sur place.
            </span>
          </div>
          <Link
            to="/dashboard/profile"
            className="text-xs font-bold text-[#f95d00] hover:underline whitespace-nowrap"
          >
            Compléter mon compte →
          </Link>
        </div>
      )}

      {error && (
        <div className="mb-5 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl flex items-center gap-2 bento-card">
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>warning</span>
          {error}
        </div>
      )}
      {success && (
        <div className="mb-5 px-4 py-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-xl flex items-center gap-2 bento-card">
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>check_circle</span>
          {success}
        </div>
      )}

      {/* Ordre strict des 8 blocs de haut en bas (RM-37, RM-38) */}
      <div className="space-y-5">

        {/* 1. Prochaine réservation ou Session en cours + 2. Carte Mon accès QR */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* BLOC 1 : Prochaine réservation ou Session en cours */}
          <div className="lg:col-span-8 bento-card">
            {isTrulyStarted ? (
              <div className="bg-white dark:bg-[#1a1917] rounded-3xl p-5 sm:p-6 border border-outline-variant/15 h-full flex flex-col sm:flex-row items-center gap-5 sm:gap-6" style={{ boxShadow: '0 8px 24px rgba(16,15,13,.06)' }}>
                <div className="relative shrink-0" style={{ width: 'clamp(112px, 28vw, 150px)', height: 'clamp(112px, 28vw, 150px)' }}>
                  <svg viewBox="0 0 100 100" className="w-full h-full">
                    <circle cx="50" cy="50" r={TIMER_RING_RADIUS} fill="transparent" stroke="#f1eee9" strokeWidth="8" />
                    <circle
                      cx="50" cy="50" r={TIMER_RING_RADIUS} fill="transparent"
                      stroke={timerColor}
                      strokeWidth="8" strokeLinecap="round"
                      strokeDasharray={TIMER_RING_CIRCUMFERENCE}
                      strokeDashoffset={timerIsOvertime ? 0 : timerRingOffset}
                      className="progress-ring__circle"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center px-2">
                    <span className={`font-sora font-bold text-base sm:text-lg tabular-nums ${timerIsOvertime ? 'text-red-600' : timerIsLow ? 'text-amber-600' : 'text-primary dark:text-white'}`}>
                      {timerIsOvertime ? `+${formatHMSDuration(serverTimer.overtimeSeconds)}` : formatHMSDuration(timerSeconds)}
                    </span>
                    <span className="text-xs text-on-surface-variant font-semibold mt-0.5">
                      {timerIsOvertime ? 'dépassement' : 'restant'}
                    </span>
                  </div>
                </div>

                <div className="flex-grow text-center sm:text-left space-y-3 min-w-0">
                  <div>
                    <div className="flex items-center justify-center sm:justify-start gap-2 mb-1 flex-wrap">
                      <span className="w-2 h-2 rounded-full pulse-dot" style={{ background: timerColor }} />
                      <span className="text-xs font-bold uppercase tracking-[.12em]" style={{ color: timerColor }}>
                        {timerIsOvertime ? 'Session en dépassement' : 'Session en cours'}
                      </span>
                      <span className="text-xs text-on-surface-variant font-medium tabular-nums">
                        · Écoulé : {serverTimer.formattedElapsed}
                      </span>
                    </div>
                    <h2 className="font-sora font-bold text-primary dark:text-white text-lg">
                      {activeSession.reservations?.espaces?.nom || 'Espace'}
                      {activeSession.reservations?.espaces?.type && (
                        <span className="font-normal text-on-surface-variant text-sm">
                          {' · '}{SPACE_TYPE_LABELS[activeSession.reservations.espaces.type] || activeSession.reservations.espaces.type}
                        </span>
                      )}
                    </h2>
                    <p className="text-sm text-on-surface-variant mt-0.5">
                      Démarrée à {formatTimeShort(activeSession.started_at || activeSession.check_in)} · Fin prévue à {formatTimeShort(activeSession.reservations?.date_fin)}
                    </p>
                  </div>

                  {timerIsLow && (
                    <p className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                      Alerte 15 min : votre créneau arrive bientôt à échéance. Vous pouvez prolonger ci-dessous.
                    </p>
                  )}

                  {timerIsOvertime && (
                    <div className="text-xs font-semibold text-red-800 bg-red-50 border border-red-200 rounded-xl px-3 py-2 space-y-1">
                      <p>
                        Dépassement en cours — Tarif annoncé :{' '}
                        <strong><Money amount={overtimeHourlyRate} zeroLabel="Gratuit" unit="/ heure" /></strong>{' '}
                        (facturé par tranches de 15 min sur place).
                      </p>
                      {Number(activeSession?.details?.montant_depassement || 0) > 0 && (
                        <p>Supplément estimé actuel : <Money amount={activeSession.details.montant_depassement} /></p>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 justify-center sm:justify-start items-center">
                    <div className="inline-flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-bold text-on-surface-variant mr-1">Prolonger :</span>
                      {[15, 30, 60].map((min) => (
                        <button
                          key={min}
                          type="button"
                          onClick={() => handleExtendMemberSession(min)}
                          disabled={extendingSession}
                          className="px-3 py-1.5 rounded-lg border border-[#f95d00]/40 bg-[#ffedd8] text-xs font-bold text-[#f95d00] hover:bg-[#f95d00] hover:text-white transition-all disabled:opacity-50 cursor-pointer"
                        >
                          +{min} min
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowFinishConfirm(true)}
                      disabled={checkingOut}
                      className="px-4 py-2 rounded-lg bg-[#100f0d] text-white text-xs sm:text-sm font-bold hover:opacity-90 active:scale-[.97] transition-all disabled:opacity-50 cursor-pointer"
                    >
                      {checkingOut ? 'Arrêt…' : 'Terminer ma session'}
                    </button>
                  </div>

                  {extendConflict && (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-left space-y-2">
                      <p className="text-xs font-bold text-amber-800">{extendConflict.message}</p>
                      <Link
                        to={`/book/step1?espaceId=${activeSession.reservations?.espace_id || ''}`}
                        className="inline-flex items-center gap-1 text-xs font-bold text-[#f95d00] underline"
                      >
                        Réserver un autre espace ou créneau →
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            ) : nextBooking ? (
              <div className="bg-white dark:bg-[#1a1917] rounded-3xl p-6 border border-outline-variant/15 h-full flex flex-col justify-between gap-4" style={{ boxShadow: '0 8px 24px rgba(16,15,13,.06)' }}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#ffedd8] text-[#f95d00] text-xs font-bold">
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>schedule</span>
                      Prochaine réservation
                    </div>
                    <h2 className="font-sora font-bold text-primary dark:text-white text-xl pt-1">
                      {nextBooking.espaces?.nom || 'Espace réservé'}
                    </h2>
                    <p className="text-sm text-on-surface-variant">
                      {formatDateShort(nextBooking.date_debut)} · {formatTimeShort(nextBooking.date_debut)} → {formatTimeShort(nextBooking.date_fin)}
                    </p>
                  </div>
                  <div className="px-4 py-3 rounded-2xl bg-[#100f0d] text-white text-center min-w-[160px]">
                    <span className="text-xs text-[#a3a09b] block">
                      {nextBookingTimer.isOvertime ? 'Statut accueil' : 'Début prévu dans'}
                    </span>
                    <span className="font-sora font-extrabold text-xl tabular-nums text-[#f95d00] mt-0.5 block">
                      {nextBookingTimer.isOvertime ? 'Créneau ouvert' : formatHMSDuration(nextBookingTimer.remainingSeconds)}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-outline-variant/15">
                  <p className="text-xs text-on-surface-variant">
                    Présentez votre code QR à l&apos;accueil à votre arrivée pour démarrer votre session.
                  </p>
                  <div className="flex items-center gap-2">
                    <Link
                      to="/dashboard/qr"
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white"
                      style={{ backgroundColor: '#f95d00', textDecoration: 'none' }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>qr_code_2</span>
                      Voir mon QR d&apos;accès
                    </Link>
                    <Link
                      to="/dashboard/bookings"
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-outline-variant/30 text-primary dark:text-white"
                      style={{ textDecoration: 'none' }}
                    >
                      Mes réservations
                    </Link>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white dark:bg-[#1a1917] rounded-3xl p-6 border border-outline-variant/15 h-full flex flex-col items-center justify-center text-center min-h-[210px]" style={{ boxShadow: '0 8px 24px rgba(16,15,13,.05)' }}>
                <span className="material-symbols-outlined text-outline-variant mb-3" style={{ fontSize: 44 }}>event_available</span>
                <p className="font-sora font-bold text-primary dark:text-white text-base mb-1">Aucune réservation à venir</p>
                <p className="text-sm text-on-surface-variant mb-4">Réservez un espace pour planifier votre prochaine venue.</p>
                <Link
                  to="/book/step1"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-95"
                  style={{ background: '#f95d00', boxShadow: '0 4px 14px rgba(249,93,0,.25)' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 17 }}>add_circle</span>
                  Réserver maintenant
                </Link>
              </div>
            )}
          </div>

          {/* BLOC 2 : Carte Mon accès QR */}
          <div className="lg:col-span-4 bento-card">
            <div className="bg-white dark:bg-[#1a1917] rounded-3xl p-6 border border-outline-variant/15 h-full flex flex-col items-center justify-between text-center" style={{ boxShadow: '0 8px 24px rgba(16,15,13,.05)' }}>
              <div className="flex items-center justify-between w-full mb-1">
                <h2 className="font-sora font-bold text-primary dark:text-white text-base">Mon accès</h2>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                  memberQr?.status === 'blocked'
                    ? 'bg-red-100 text-red-700'
                    : memberQr?.status === 'expired'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-emerald-100 text-emerald-700'
                }`}>
                  {memberQr?.status === 'blocked' ? 'Bloqué' : memberQr?.status === 'expired' ? 'Expiré' : 'Actif · 5 min'}
                </span>
              </div>
              <p className="text-xs text-on-surface-variant mb-3 w-full text-left">
                Présentez ce code QR à l&apos;accueil pour entrer
              </p>

              {memberQr?.status === 'blocked' ? (
                <div className="p-4 rounded-xl border border-red-200 bg-red-50 w-full mb-4 flex flex-col items-center justify-center min-h-[156px] gap-2">
                  <span className="material-symbols-outlined text-red-600" style={{ fontSize: 34 }}>lock</span>
                  <p className="text-xs font-semibold text-red-700">Accès bloqué (impayé en retard)</p>
                </div>
              ) : (
                <Link
                  to="/dashboard/qr"
                  className="p-3.5 rounded-xl border border-outline-variant/20 bg-surface-container-low/60 hover:bg-surface-container-low transition-colors mb-4 w-full flex flex-col items-center justify-center gap-2"
                >
                  <QRCodeSVG
                    value={memberQr?.payload || memberQr?.qr_token || 'deskywork-pass'}
                    size={128}
                    bgColor="transparent"
                    fgColor="#100f0d"
                    level="M"
                    includeMargin={false}
                  />
                  {memberQr?.short_code && (
                    <p className="font-sora font-bold text-xs tracking-widest text-primary">
                      Code : {memberQr.short_code}
                    </p>
                  )}
                </Link>
              )}

              <Link
                to="/dashboard/qr"
                className="w-full py-2.5 rounded-xl bg-[#100f0d] text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-all"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>qr_code_2</span>
                Ouvrir Mon accès
              </Link>
            </div>
          </div>
        </div>

        {/* BLOC 3 : Statut Abonnement en une ligne */}
        <section className="bento-card bg-[#100f0d] text-white rounded-2xl px-5 py-4 border border-white/10 flex flex-wrap items-center justify-between gap-4" style={{ boxShadow: '0 6px 20px rgba(16,15,13,.16)' }}>
          <div className="flex items-center gap-3 min-w-0 flex-wrap">
            <span className="w-10 h-10 rounded-xl flex items-center justify-center bg-[#f95d00]/20 text-[#f95d00] shrink-0">
              <span className="material-symbols-outlined" style={{ fontSize: 22 }}>card_membership</span>
            </span>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-[#a3a09b] font-semibold">Statut abonnement</p>
              {activeSubscription ? (
                <div className="flex items-center gap-2.5 flex-wrap text-sm">
                  <span className="font-sora font-bold text-white">
                    {SUBSCRIPTION_LABELS[activeSubscription.type] || activeSubscription.type}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300">
                    {activeSubscription.statut === 'a_renouveler' ? 'À renouveler' : 'Actif'}
                  </span>
                  <span className="text-xs text-[#d6d3d1]">
                    Expire le {formatDateShort(activeSubscription.date_fin)} ({subscriptionDaysLeft} j restants)
                  </span>
                  {activeSubscription.quota_total > 0 && activeSubscription.quota_type !== 'illimite' && (
                    <span className="text-xs font-semibold text-[#ffedd8]">
                      · Quota : {activeSubscription.quota_consomme}/{activeSubscription.quota_total}{activeSubscription.quota_type === 'jours' ? ' j' : ' h'}
                    </span>
                  )}
                </div>
              ) : pendingSubRequest ? (
                <div className="flex items-center gap-2.5 flex-wrap text-sm">
                  <span className="font-sora font-bold text-white">
                    {SUBSCRIPTION_LABELS[pendingSubRequest.type] || pendingSubRequest.type}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300">
                    En attente de paiement
                  </span>
                  <span className="text-xs text-[#d6d3d1]">
                    Règlement à effectuer à l&apos;accueil pour activation immédiate.
                  </span>
                </div>
              ) : (
                <p className="text-sm text-[#d6d3d1]">Aucun abonnement actif actuellement.</p>
              )}
            </div>
          </div>

          <Link
            to="/dashboard/abonnement"
            className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-[#f95d00] hover:opacity-95 transition shrink-0"
          >
            {activeSubscription ? 'Gérer mon abonnement' : pendingSubRequest ? 'Voir ma demande' : 'Découvrir les offres'}
          </Link>
        </section>

        {/* BLOC 4 : Montants dus */}
        <section className="bento-card bg-white dark:bg-[#1a1917] rounded-3xl p-5 sm:p-6 border border-outline-variant/15" style={{ boxShadow: '0 8px 24px rgba(16,15,13,.05)' }}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2.5">
              <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 22 }}>account_balance_wallet</span>
              <div>
                <h2 className="font-sora font-bold text-primary dark:text-white text-base">Montants dus</h2>
                <p className="text-xs text-on-surface-variant">Soldes en attente de règlement sur place à l&apos;accueil</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`font-sora font-extrabold text-lg ${montantsDus.total_du > 0 ? 'text-[#f95d00]' : 'text-emerald-600'}`}>
                <Money amount={montantsDus.total_du} zeroLabel="0,000 DT" />
              </span>
              <Link to="/member/payments" className="text-xs font-bold text-[#f95d00] hover:underline">
                Mes paiements →
              </Link>
            </div>
          </div>

          {montantsDus.items.length === 0 ? (
            <div className="flex items-center gap-2.5 text-xs sm:text-sm text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 rounded-2xl px-4 py-3">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>verified</span>
              <span>Votre compte est à jour : aucun montant dû en attente.</span>
            </div>
          ) : (
            <div className="space-y-2">
              {montantsDus.items.slice(0, 3).map((item) => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 rounded-xl border border-outline-variant/15 bg-surface-container-low/40">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-primary dark:text-white truncate">
                        {item.libelle || 'Montant dû'}
                      </p>
                      {item.days_overdue > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
                          En retard de {item.days_overdue} j
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-on-surface-variant">
                      Échéance : {formatDateShort(item.due_date || item.created_at)}
                    </p>
                  </div>
                  <span className="font-sora font-bold text-sm text-[#f95d00]">
                    <Money amount={item.reste_a_payer ?? item.montant_du ?? item.montant} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* BLOC 5 : Espaces disponibles maintenant (badge Habituel uniquement si >= 2 réservations passées) */}
        <section className="bento-card bg-white dark:bg-[#1a1917] rounded-3xl p-5 sm:p-6 border border-outline-variant/15" style={{ boxShadow: '0 8px 24px rgba(16,15,13,.05)' }}>
          <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
            <div>
              <h2 className="font-sora font-bold text-primary dark:text-white text-base flex items-center gap-2">
                <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 20 }}>meeting_room</span>
                Espaces disponibles maintenant
              </h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                {nearbySummary.disponibles} espace{nearbySummary.disponibles > 1 ? 's' : ''} disponible{nearbySummary.disponibles > 1 ? 's' : ''} sur {nearbySummary.total}
                {nearbySummary.total_units > 0 ? ` · ${nearbySummary.available_units} / ${nearbySummary.total_units} unités libres` : ''}
              </p>
            </div>
            <Link to="/book/step1" className="text-xs font-bold text-[#f95d00] hover:underline">
              Tout voir →
            </Link>
          </div>

          {nearbySpaces.length === 0 ? (
            <p className="text-sm text-on-surface-variant py-6 text-center">Aucun espace planifiable pour le moment.</p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {nearbySpaces.map((sp) => (
                <div key={sp.id} className="p-3.5 rounded-2xl border border-outline-variant/15 bg-surface-container-low/40 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-[#f95d00]/10 text-[#f95d00]">
                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                      {sp.type === 'open_space' ? 'groups' : sp.type === 'private_office' ? 'door_front' : sp.type === 'meeting_room' ? 'event_seat' : 'school'}
                    </span>
                  </div>
                  <div className="flex-grow min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="font-semibold text-primary dark:text-white text-sm truncate">{sp.nom}</p>
                      {sp.habituel && (
                        <span className="shrink-0 px-1.5 py-0.5 rounded bg-[#ffedd8] text-[#f95d00] text-xs font-bold leading-none">
                          Habituel
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-on-surface-variant truncate">
                      {SPACE_TYPE_LABELS[sp.type] || sp.type} · <Money amount={sp.tarif_horaire} zeroLabel="Gratuit" unit="/ h" />
                    </p>
                  </div>
                  <Link
                    to={`/book/step1?espaceId=${sp.id}`}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-white shrink-0 transition hover:opacity-90"
                    style={{ background: sp.disponible ? '#f95d00' : '#78716c' }}
                  >
                    {sp.disponible ? 'Réserver' : 'Voir'}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* BLOC 6 : Formations à venir (lié au vrai catalogue) */}
        <section className="bento-card bg-white dark:bg-[#1a1917] rounded-3xl p-5 sm:p-6 border border-outline-variant/15" style={{ boxShadow: '0 8px 24px rgba(16,15,13,.05)' }}>
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-sora font-bold text-primary dark:text-white text-base flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 20 }}>school</span>
              Formations à venir
            </h2>
            <Link to="/dashboard/formations" className="text-xs font-bold text-[#f95d00] hover:underline">
              Catalogue complet →
            </Link>
          </div>

          {upcomingCatalogFormations.length === 0 ? (
            <p className="text-sm text-on-surface-variant py-6 text-center">Aucune session de formation planifiée prochainement.</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {upcomingCatalogFormations.map((f) => (
                <div key={f.id} className="p-4 rounded-2xl border border-outline-variant/15 bg-surface-container-low/40 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-primary dark:text-white text-sm truncate">{f.titre}</h3>
                      {f.myInscription && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                          Inscrit
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-on-surface-variant mt-0.5">
                      {f.date_debut ? `${formatDateShort(f.date_debut)} à ${formatTimeShort(f.date_debut)}` : 'Date à confirmer'}
                      {f.profiles ? ` · ${f.profiles.prenom} ${f.profiles.nom}` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right flex flex-col items-end gap-1">
                    <span className="text-xs font-bold text-[#f95d00]">
                      <Money amount={f.prix_inscription || 0} zeroLabel="Gratuit" />
                    </span>
                    <Link
                      to="/dashboard/formations"
                      className="text-xs font-bold text-primary dark:text-white hover:text-[#f95d00] underline"
                    >
                      {f.myInscription ? 'Détails' : "S'inscrire"}
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* BLOC 7 : Reçus récents (4 dernières lignes) */}
        <section className="bento-card bg-white dark:bg-[#1a1917] rounded-3xl p-5 sm:p-6 border border-outline-variant/15" style={{ boxShadow: '0 8px 24px rgba(16,15,13,.05)' }}>
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-sora font-bold text-primary dark:text-white text-base flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 20 }}>receipt_long</span>
              Reçus récents
            </h2>
            <Link to="/member/payments?tab=receipts" className="text-xs font-bold text-[#f95d00] hover:underline">
              Tous mes reçus →
            </Link>
          </div>

          {recentReceipts.length === 0 ? (
            <p className="text-sm text-on-surface-variant py-6 text-center">Aucun reçu encaissé pour le moment.</p>
          ) : (
            <div className="space-y-2.5">
              {recentReceipts.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-outline-variant/15 bg-surface-container-low/30">
                  <div className="min-w-0">
                    <p className="font-semibold text-primary dark:text-white text-sm truncate">
                      {p.libelle || (p.reservations?.espaces?.nom ? `Réservation · ${p.reservations.espaces.nom}` : p.abonnements?.type ? 'Abonnement' : 'Paiement')}
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      {p.numero_recu ? `${p.numero_recu} · ` : ''}{formatDateShort(p.date_paiement || p.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${PAYMENT_STATUT_COLORS[p.statut] || 'bg-slate-100 text-slate-600'}`}>
                      {PAYMENT_STATUT_LABELS[p.statut] || p.statut}
                    </span>
                    <span className="font-sora font-bold text-primary dark:text-white text-sm">
                      <Money amount={p.montant} />
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDownloadReceipt(p)}
                      disabled={downloadingReceipt === p.id}
                      className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-outline-variant/25 text-primary dark:text-white hover:border-[#f95d00] hover:text-[#f95d00] transition disabled:opacity-50"
                      title="Télécharger le reçu PDF"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                        {downloadingReceipt === p.id ? 'hourglass_top' : 'download'}
                      </span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* BLOC 8 : Mon activité (repliable, contenant le filtre de période) */}
        <section className="bento-card bg-white dark:bg-[#1a1917] rounded-3xl border border-outline-variant/15 overflow-hidden" style={{ boxShadow: '0 8px 24px rgba(16,15,13,.05)' }}>
          <button
            type="button"
            onClick={() => setActivityOpen((v) => !v)}
            className="w-full flex items-center justify-between px-5 sm:px-6 py-4 hover:bg-surface-container-low/40 transition text-left"
          >
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 20 }}>show_chart</span>
              <div>
                <h2 className="font-sora font-bold text-primary dark:text-white text-base">Mon activité</h2>
                <p className="text-xs text-on-surface-variant">{memberActivityCaption} · Réservations et formations</p>
              </div>
            </div>
            <span className={`material-symbols-outlined text-on-surface-variant transition-transform duration-200 ${activityOpen ? 'rotate-180' : ''}`} style={{ fontSize: 22 }}>
              expand_more
            </span>
          </button>

          {activityOpen && (
            <div className="px-5 sm:px-6 pb-6 pt-3 border-t border-outline-variant/15 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Période d&apos;analyse</p>
                <PeriodFilter value={period} onChange={setPeriod} />
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={memberActivityChart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRes" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f95d00" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f95d00" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorForm" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2FBE8F" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#2FBE8F" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#64748b' }} width={30} allowDecimals={false} />
                  <Tooltip />
                  <Area type="monotone" dataKey="reservations" name="Réservations" stroke="#f95d00" strokeWidth={2} fillOpacity={1} fill="url(#colorRes)" />
                  <Area type="monotone" dataKey="formations" name="Formations" stroke="#2FBE8F" strokeWidth={2} fillOpacity={1} fill="url(#colorForm)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      {/* Modale confirmation Terminer ma session */}
      {showFinishConfirm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1b1a18] rounded-3xl p-6 max-w-md w-full border border-outline-variant/20 space-y-4">
            <h3 className="font-sora font-bold text-lg text-primary dark:text-white">Terminer ma session ?</h3>
            <p className="text-sm text-on-surface-variant">
              Votre chronomètre serveur sera arrêté et l&apos;accueil recevra une notification en temps réel.
              {timerIsOvertime && ' Le supplément de dépassement par tranches de 15 min sera ajouté à votre compte (payable sur place).'}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowFinishConfirm(false)}
                className="px-4 py-2 rounded-xl border border-outline-variant/30 text-sm font-semibold"
              >
                Continuer
              </button>
              <button
                type="button"
                onClick={handleCheckOut}
                disabled={checkingOut}
                style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
                className="px-5 py-2 rounded-xl text-sm font-bold disabled:opacity-50"
              >
                {checkingOut ? 'Arrêt…' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
