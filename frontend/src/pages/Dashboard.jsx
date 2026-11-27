import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { memberApi, subscriptionApi, bookingApi, sessionApi, formationApi, memberPortalApi, paymentApi } from '../services/api';
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
import { ROLE_LABELS, isCompanyRole } from '../utils/roles';
import { useSessionUser } from '../hooks/useSessionUser';
import { useServerTimer, formatHMSDuration } from '../hooks/useServerTimer';
import { formatDateDMY, formatTime24h, getTunisHourMinute } from '../utils/format';
import { QRCodeSVG } from 'qrcode.react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

/* ─── Constants ─── */
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

const MEMBER_TYPE_LABELS = {
  individuel: 'Individuel',
  entreprise: 'Entreprise',
  etudiant: 'Étudiant',
};

const STATUT_LABELS = {
  active: 'Actif',
  actif: 'Actif',
  a_renouveler: 'À renouveler',
  suspended: 'Suspendu',
  expired: 'Expiré',
};

const BOOKING_STATUT_LABELS = {
  pending: 'En attente',
  en_attente_confirmation: 'En attente de confirmation',
  confirmed: 'Confirmée',
  completed: 'Terminée',
  no_show: 'Absent',
  refused: 'Refusée',
  cancelled: 'Annulée',
};

const BOOKING_STATUT_COLORS = {
  confirmed: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  en_attente_confirmation: 'bg-amber-100 text-amber-700',
  completed: 'bg-slate-100 text-slate-600',
  no_show: 'bg-orange-100 text-orange-700',
  refused: 'bg-rose-100 text-rose-700',
  cancelled: 'bg-red-100 text-red-600',
};

const PAYMENT_STATUT_LABELS = {
  pending: 'En attente',
  partial: 'Partiel',
  paid: 'Payé',
  failed: 'Échoué',
  refunded: 'Remboursé',
};

const PAYMENT_STATUT_COLORS = {
  paid: 'bg-emerald-100 text-emerald-700',
  partial: 'bg-amber-100 text-amber-700',
  pending: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-600',
  refunded: 'bg-slate-100 text-slate-600',
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

/* ─── Keyframes injected once ─── */
const styleSheet = `
@keyframes bento-fade-in { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
@keyframes pulse-dot { 0%,100% { opacity:1; } 50% { opacity:.45; } }
.bento-card { animation: bento-fade-in .45s ease-out both; }
.bento-card:nth-child(2) { animation-delay:.07s; }
.bento-card:nth-child(3) { animation-delay:.14s; }
.bento-card:nth-child(4) { animation-delay:.21s; }
.pulse-dot { animation: pulse-dot 1.6s ease-in-out infinite; }
.progress-ring__circle {
  transition: stroke-dashoffset .4s ease;
  transform: rotate(-90deg);
  transform-origin: 50% 50%;
}
.glass-card {
  background: rgba(255,255,255,.82);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}
`;

/* ─── Small helpers ─── */
function formatTimer(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

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

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN DASHBOARD COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */
export default function Dashboard({ session }) {
  const navigate = useNavigate();
  const { userId, email, metadata } = useSessionUser(session);

  /* ── Data state — profile initialisé depuis JWT (0 appel DB) ── */
  const [profile, setProfile] = useState(() =>
    userId ? { id: userId, email, role: metadata.role || 'member', prenom: metadata.prenom || '', nom: metadata.nom || '', ...metadata } : null
  );
  const [activeSubscription, setActiveSubscription] = useState(null);
  const [subscriptionHistory, setSubscriptionHistory] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [myFormations, setMyFormations] = useState([]);
  const [availableFormations, setAvailableFormations] = useState([]);
  const [nearbySpaces, setNearbySpaces] = useState([]);
  const [nearbySummary, setNearbySummary] = useState({ total: 0, disponibles: 0, total_units: 0, available_units: 0 });
  const [recentPayments, setRecentPayments] = useState([]);
  const [downloadingReceipt, setDownloadingReceipt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [period, setPeriod] = useState(DEFAULT_PERIOD);
  const [memberQr, setMemberQr] = useState(null);

  // Redirection immédiate des comptes entreprise vers leur espace dédié
  useEffect(() => {
    const isComp = isCompanyRole(metadata?.role, metadata?.type_membre) || isCompanyRole(profile?.role, profile?.type_membre);
    if (isComp) {
      navigate('/company/dashboard', { replace: true });
    }
  }, [metadata, profile, navigate]);

  /* ── Session state (synchronisé UTC serveur LOT 3 + RM-15..RM-17) ── */
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

  /* ── Booking state ── */
  const [cancellingId, setCancellingId] = useState(null);

  /* ── Profile edit state ── */
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ nom: '', prenom: '', telephone: '', cin: '', type_membre: 'individuel' });

  /* ── Derived: upcoming bookings (future, not cancelled) ── */
  const upcomingBookings = useMemo(() => {
    const now = new Date();
    return bookings
      .filter((b) => new Date(b.date_fin) > now && !['cancelled', 'refused', 'completed', 'no_show'].includes(b.statut))
      .sort((a, b) => new Date(a.date_debut) - new Date(b.date_debut))
      .slice(0, 5);
  }, [bookings]);

  /* ── Derived: timer percentage for SVG ring ── */
  const timerPercent = useMemo(() => {
    if (!totalSessionSeconds || totalSessionSeconds <= 0) return 0;
    return Math.min(1, timerSeconds / totalSessionSeconds);
  }, [timerSeconds, totalSessionSeconds]);

  const timerRingOffset = useMemo(() => {
    return TIMER_RING_CIRCUMFERENCE * (1 - timerPercent);
  }, [timerPercent]);

  /* ── Derived: days left for subscription ── */
  const subscriptionDaysLeft = useMemo(() => {
    if (!activeSubscription?.date_fin) return null;
    const diff = new Date(activeSubscription.date_fin).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }, [activeSubscription]);

  /* ── Derived: member activity chart (période globale) ── */
  const memberActivityChart = useMemo(() => {
    const win = periodWindow(period);
    const buckets = [];
    const inRange = (dateStr, s, e) => {
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return d >= s && d <= e;
    };
    const countRes = (s, e) => (bookings || []).filter(b => b.statut !== 'cancelled' && inRange(b.date_debut, s, e)).length;
    const countForm = (s, e) => (myFormations || []).filter(i => i.statut !== 'annulee' && inRange(i.formations?.date_debut || i.created_at, s, e)).length;

    if (win.bucket === 'hour') {
      const y = win.fromJ.getFullYear();
      const m = win.fromJ.getMonth();
      const d = win.fromJ.getDate();
      for (let h = 0; h < 24; h++) {
        const s = new Date(y, m, d, h, 0, 0, 0);
        const e = new Date(y, m, d, h, 59, 59, 999);
        buckets.push({ label: `${h}h`, reservations: countRes(s, e), formations: countForm(s, e) });
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
        const s = new Date(yr, 0, 1, 0, 0, 0, 0);
        const e = new Date(yr, 11, 31, 23, 59, 59, 999);
        buckets.push({ label: String(yr), reservations: countRes(s, e), formations: countForm(s, e) });
      }
    }
    return buckets;
  }, [bookings, myFormations, period]);

  const pStr = typeof period === 'string' ? period : (period?.key || 'mois');
  const memberActivityCaption = pStr.startsWith('jour') ? 'Par heure · ' + windowLabel(period)
    : (pStr.startsWith('mois') || pStr.startsWith('semaine') || pStr.startsWith('custom')) ? 'Par jour · ' + windowLabel(period)
      : (pStr.startsWith('annee') || pStr.startsWith('trimestre')) ? 'Par mois · ' + windowLabel(period)
        : 'Par année · historique';

  /* ── Load all data ── */
  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      let prof = null;
      let subscription = null;
      let subscriptions = [];
      let reservations = [];
      let myFormations = [];
      let availableFormations = [];

      try {
        const [profRes, subRes, mySubsRes, bkRes, myFRes, avFRes] = await Promise.allSettled([
          memberApi.getMe(),
          subscriptionApi.getActive().catch(() => ({ subscription: null })),
          subscriptionApi.getMine().catch(() => ({ subscriptions: [] })),
          bookingApi.getAll().catch(() => ({ reservations: [] })),
          formationApi.getMesFormations().catch(() => ({ inscriptions: [] })),
          formationApi.getAll({ statut: 'planifiee' }).catch(() => ({ formations: [] })),
        ]);

        if (profRes.status === 'fulfilled') prof = profRes.value?.profile || profRes.value;
        if (subRes.status === 'fulfilled' && subRes.value?.subscription?.id) subscription = subRes.value.subscription;
        if (mySubsRes.status === 'fulfilled') subscriptions = mySubsRes.value?.subscriptions || [];
        if (bkRes.status === 'fulfilled') reservations = bkRes.value?.reservations || (Array.isArray(bkRes.value) ? bkRes.value : []);
        if (myFRes.status === 'fulfilled') myFormations = myFRes.value?.inscriptions || [];
        if (avFRes.status === 'fulfilled') availableFormations = avFRes.value?.formations || [];
      } catch (_) {}

      // Fallback profil Supabase si l'API a retourné null
      if (!prof && session?.user?.id) {
        const { data: dbProf } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        prof = dbProf;
      }

      // Fallback abonnement actif Supabase (source de vérité vérifiée en base)
      if (!subscription && session?.user?.id) {
        const todayStr = new Date().toISOString().slice(0, 10);
        const { data: dbSub } = await supabase
          .from('abonnements')
          .select('*')
          .eq('user_id', session.user.id)
          .eq('statut', 'active')
          .gte('date_fin', todayStr)
          .order('date_fin', { ascending: false })
          .limit(1)
          .maybeSingle();
        subscription = dbSub || null;
      }

      setProfile(prof);
      setActiveSubscription(subscription);
      setSubscriptionHistory(subscriptions);
      setBookings(reservations);
      setMyFormations(myFormations);
      setAvailableFormations(availableFormations);
      if (prof) {
        setForm({
          nom: prof.nom || '',
          prenom: prof.prenom || '',
          telephone: prof.telephone || '',
          cin: prof.cin || '',
          type_membre: prof.type_membre || 'individuel',
        });
      }

      try {
        const activeRes = await sessionApi.getActive();
        hydrateSession(activeRes.session, activeRes.server_now, activeRes.next_booking);
      } catch {
        setActiveSession(null);
        setNextBooking(null);
      }

      try {
        const nearby = await memberPortalApi.getNearbySpaces();
        setNearbySpaces(nearby.espaces || []);
        setNearbySummary({
          total: nearby.total ?? 0,
          disponibles: nearby.disponibles ?? 0,
          total_units: nearby.total_units ?? 0,
          available_units: nearby.available_units ?? 0,
        });
      } catch {
        setNearbySpaces([]);
      }

      try {
        const { payments = [] } = await paymentApi.getMemberPayments(session.user.id);
        setRecentPayments(payments.slice(0, 4));
      } catch {
        setRecentPayments([]);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const hydrateSession = (sess, srvNow = null, nxtBooking = undefined) => {
    setActiveSession(sess);
    if (srvNow) setServerNow(srvNow);
    if (nxtBooking !== undefined) setNextBooking(nxtBooking);
  };

  /* ── Initial load ── */
  useEffect(() => { loadData(); }, [session]);

  /* ── Mon QR code d'accès dynamique (validité 5 min, scannable à l'accueil) ── */
  const refreshMemberQr = () => {
    memberApi
      .getQr()
      .then((qr) => setMemberQr(qr))
      .catch(() => {});
  };

  useEffect(() => {
    let active = true;
    memberApi
      .getQr()
      .then((qr) => {
        if (active) setMemberQr(qr);
      })
      .catch(() => {});
    const autoId = setInterval(() => {
      if (active) refreshMemberQr();
    }, 4 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(autoId);
    };
  }, [session]);

  /* ── Socket.io events ── */
  useEffect(() => {
    if (!session?.user?.id) return;
    connectSocket();
    joinUser(session.user.id);

    const unsubs = [
      onSessionStarted((data) => {
        hydrateSession(data);
        loadData();
      }),
      onSessionEnded(() => {
        setActiveSession(null);
        loadData();
      }),
      onSessionOvertime(() => { loadData(); }),
      onSessionAlert15Min((data) => {
        setSuccess(`⚠️ Attention : moins de 15 min restantes — ${data.espace?.nom || 'espace de travail'}.`);
      }),
    ];

    return () => {
      unsubs.forEach((fn) => fn());
      disconnectSocket();
    };
  }, [session?.user?.id]);

  /* ── Poll active session every 30 s ── */
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

  /* ── Handlers ── */
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

  const handleDownloadReceipt = async (id) => {
    setError('');
    try {
      setDownloadingReceipt(id);
      await paymentApi.downloadReceipt(id);
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

  const handleCancelBooking = async (id) => {
    if (!window.confirm('Annuler cette réservation ?')) return;
    setCancellingId(id);
    setError('');
    setSuccess('');
    try {
      await bookingApi.cancel(id);
      setSuccess('Réservation annulée.');
      await loadData();
    } catch (e) {
      setError(e.message);
    } finally {
      setCancellingId(null);
    }
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const { profile: updated } = await memberApi.updateMe(form);
      setProfile(updated);
      setEditing(false);
      setSuccess('Profil mis à jour avec succès.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  /* ── Skeleton (données pas encore chargées) ── */
  if (loading) {
    return (
      <PortalLayout profile={profile} onLogout={handleLogout}>
        <style>{styleSheet}</style>
        {/* Header skeleton */}
        <div className="mb-7">
          <div className="h-3 w-32 bg-gray-200 rounded animate-pulse mb-2" />
          <div className="h-8 w-56 bg-gray-200 rounded animate-pulse mb-1" />
          <div className="h-4 w-40 bg-gray-200 rounded animate-pulse" />
        </div>
        {/* Cards skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-2xl p-5 shadow-sm animate-pulse">
              <div className="h-3 w-24 bg-gray-200 rounded mb-3" />
              <div className="h-7 w-16 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
        {/* Content skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-2xl p-5 shadow-sm animate-pulse h-40">
              <div className="h-4 w-32 bg-gray-200 rounded mb-4" />
              <div className="h-3 w-full bg-gray-100 rounded mb-2" />
              <div className="h-3 w-3/4 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      </PortalLayout>
    );
  }

  const timerIsLow = isTrulyStarted && !serverTimer.isOvertime && timerSeconds > 0 && timerSeconds <= ALERT_THRESHOLD_SECONDS;
  const timerIsOvertime = isTrulyStarted && serverTimer.isOvertime;
  const timerColor = timerIsOvertime ? '#ef4444' : timerIsLow ? '#f59e0b' : '#2FBE8F';
  const overtimeHourlyRate = activeSession?.overtime_rate ?? activeSession?.reservations?.espaces?.tarif_horaire ?? 0;

  return (
    <PortalLayout profile={profile} onLogout={handleLogout}>
      {/* Inject one-time CSS */}
      <style>{styleSheet}</style>

      {/* ═══════ HEADER ═══════ */}
      <header className="mb-7 bento-card">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="shrink-0 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-on-surface-variant mb-1">
              {new Date().toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis', weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <h1 className="font-sora font-bold text-primary" style={{ fontSize: 'clamp(20px, 5vw, 28px)', lineHeight: '1.25' }}>
              {greeting()}, {profile?.prenom || 'Membre'}
            </h1>
            <p className="text-on-surface-variant text-sm mt-1">
              Gérez votre espace, vos réservations et votre abonnement
            </p>
          </div>
          <div className="flex flex-row sm:flex-row sm:items-center gap-3 shrink-0 flex-wrap">
            <PeriodFilter value={period} onChange={setPeriod} />
            <Link
              to="/book/step1"
              className="inline-flex items-center justify-center gap-2 text-sm font-semibold text-white px-4 py-2.5 rounded-xl shrink-0 transition-all hover:-translate-y-0.5 active:scale-[.97]"
              style={{ background: '#f95d00', boxShadow: '0 4px 14px rgba(249,93,0,.3)' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add_circle</span>
              Réserver
            </Link>
          </div>
        </div>
      </header>

      {/* ═══════ BANNERS ═══════ */}
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

      {/* ═══════ BENTO GRID ═══════ */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">

        {/* ─── ROW 1 LEFT (8 cols): Session en cours OU Prochaine réservation ─── */}
        <div className="md:col-span-8 bento-card">
          {isTrulyStarted ? (
            /* ── SESSION EN COURS (affichée uniquement après check-in QR ou accueil) ── */
            <div className="bg-white dark:bg-[#1a1917] rounded-3xl p-5 sm:p-6 border border-outline-variant/15 h-full flex flex-col sm:flex-row items-center gap-5 sm:gap-6" style={{ boxShadow: '0 8px 24px rgba(16,15,13,.06)' }}>
              {/* Circular timer — responsive size */}
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

              {/* Info */}
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
                    Démarrée à {formatTimeShort(activeSession.started_at || activeSession.check_in)}
                    {' · Fin prévue à '}
                    {formatTimeShort(activeSession.reservations?.date_fin)}
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
                      <strong><Money amount={overtimeHourlyRate} zeroLabel="Gratuit" unit="/ heure" /></strong>
                      {' '}(facturé par tranches de 15 min sur place).
                    </p>
                    {Number(activeSession?.details?.montant_depassement || 0) > 0 && (
                      <p>
                        Supplément estimé actuel : <Money amount={activeSession.details.montant_depassement} />
                      </p>
                    )}
                  </div>
                )}

                {/* Actions membre strictes : Prolonger (+15/+30/+60) & Terminer ma session */}
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

                {/* Propositions d'alternatives en cas de créneau suivant occupé */}
                {extendConflict && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-left space-y-2">
                    <p className="text-xs font-bold text-amber-800">{extendConflict.message}</p>
                    {(extendConflict.alternatives?.units?.length > 0 || extendConflict.alternatives?.slots?.length > 0) && (
                      <div className="text-xs text-amber-900 space-y-1">
                        {extendConflict.alternatives.units?.length > 0 && (
                          <p>
                            Postes/unités libres sur ce créneau :{' '}
                            {extendConflict.alternatives.units.slice(0, 4).map((u) => u.code || u.nom).join(', ')}
                          </p>
                        )}
                        {extendConflict.alternatives.slots?.length > 0 && (
                          <p>
                            Autres créneaux libres aujourd&apos;hui :{' '}
                            {extendConflict.alternatives.slots.slice(0, 3).map((s) => s.label).join(' · ')}
                          </p>
                        )}
                      </div>
                    )}
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
            /* ── PROCHAINE RÉSERVATION (avant démarrage — compte à rebours serveur, jamais "00:00 restant") ── */
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
                    {nextBookingTimer.isOvertime
                      ? 'Créneau ouvert'
                      : formatHMSDuration(nextBookingTimer.remainingSeconds)}
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
                    Détails
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            /* ── AUCUNE SESSION / AUCUNE RÉSERVATION À VENIR ── */
            <div className="bg-white dark:bg-[#1a1917] rounded-3xl p-6 border border-outline-variant/15 h-full flex flex-col items-center justify-center text-center min-h-[200px]" style={{ boxShadow: '0 8px 24px rgba(16,15,13,.05)' }}>
              <span className="material-symbols-outlined text-outline-variant mb-3" style={{ fontSize: 48 }}>desk</span>
              <p className="font-sora font-bold text-primary dark:text-white text-base mb-1">Aucune session en cours</p>
              <p className="text-sm text-on-surface-variant mb-4">Réservez un espace pour planifier votre prochaine venue.</p>
              <Link
                to="/book/step1"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:-translate-y-0.5"
                style={{ background: '#f95d00', boxShadow: '0 4px 14px rgba(249,93,0,.25)' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 17 }}>add_circle</span>
                Réserver un espace
              </Link>
            </div>
          )}
        </div>

        {/* ─── ROW 1 RIGHT (4 cols): Active Subscription (Charte DeskyWork) ─── */}
        <div className="md:col-span-4 bento-card">
          <div
            className="rounded-3xl p-6 h-full relative overflow-hidden flex flex-col justify-between min-h-[280px]"
            style={{ background: '#100f0d', boxShadow: '0 8px 24px rgba(16,15,13,.22)' }}
          >
            {/* Glow */}
            <div className="absolute top-[-30px] right-[-30px] w-44 h-44 rounded-full blur-3xl" style={{ background: 'rgba(249,93,0,.18)' }} />
            <div className="absolute bottom-[-40px] left-[-20px] w-32 h-32 rounded-full blur-3xl" style={{ background: 'rgba(47,190,143,.10)' }} />

            <div className="relative z-10">
              <div className="flex justify-between items-start mb-4">
                <div className="px-3 py-1 rounded-full" style={{ background: '#f95d00' }}>
                  <span className="text-xs uppercase tracking-[.12em] text-white font-semibold">
                    {activeSubscription ? SUBSCRIPTION_LABELS[activeSubscription.type] || 'Abonnement' : 'Sans abonnement'}
                  </span>
                </div>
                <span className="material-symbols-outlined" style={{ color: 'rgba(255,255,255,.35)', fontSize: 24 }}>workspace_premium</span>
              </div>

              {activeSubscription ? (
                <>
                  <h3 className="font-sora font-bold text-white text-lg mb-1">
                    {SUBSCRIPTION_LABELS[activeSubscription.type] || activeSubscription.type}
                  </h3>
                  <p className="text-sm" style={{ color: '#a3a09b' }}>
                    Du {formatDateShort(activeSubscription.date_debut)} au {formatDateShort(activeSubscription.date_fin)}
                  </p>
                </>
              ) : (
                <>
                  <h3 className="font-sora font-bold text-white text-lg mb-1">Aucun abonnement</h3>
                  <p className="text-sm" style={{ color: '#a3a09b' }}>
                    Souscrivez depuis la page{' '}
                    <Link to="/dashboard/abonnement" className="underline font-semibold text-[#ffedd8] hover:text-white transition-colors">
                      Abonnement
                    </Link>.
                  </p>
                </>
              )}
            </div>

            {activeSubscription && (
              <div className="relative z-10 space-y-4 mt-6">
                {/* Days left counter */}
                <div className="flex items-end justify-between">
                  <div>
                    <span className="font-sora font-bold text-white text-3xl block leading-none">
                      {subscriptionDaysLeft ?? '—'}
                    </span>
                    <span className="text-xs font-medium mt-1 block" style={{ color: '#a3a09b' }}>
                      {subscriptionDaysLeft === 1 ? 'jour restant' : 'jours restants'}
                    </span>
                  </div>
                  <Link
                    to="/dashboard/abonnement"
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all hover:bg-white/20"
                    style={{ background: 'rgba(255,255,255,.1)' }}
                  >
                    {activeSubscription.statut === 'active' ? 'Gérer' : 'Renouveler'}
                  </Link>
                </div>
                {/* Progress bar */}
                <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.1)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.min(100, ((subscriptionDaysLeft ?? 0) / 30) * 100)}%`,
                      background: 'linear-gradient(90deg, #f95d00, #2FBE8F)',
                    }}
                  />
                </div>
                {/* Auto-renewal */}
                <div className="flex justify-between text-xs">
                  <span style={{ color: '#a3a09b' }}>Renouvellement auto</span>
                  <span className="font-semibold text-white">
                    {activeSubscription.renouvellement_auto ? 'Activé' : 'Désactivé'}
                  </span>
                </div>
              </div>
            )}

            {!activeSubscription && (
              <div className="relative z-10 mt-4">
                <Link
                  to="/dashboard/abonnement"
                  className="block w-full text-center py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[.98]"
                  style={{ background: '#f95d00', boxShadow: '0 4px 14px rgba(249,93,0,.35)' }}
                >
                  Découvrir les offres
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* ─── ROW 2 LEFT (8 cols): Upcoming Bookings ─── */}
        <div className="md:col-span-8 bento-card">
          <div className="bg-white rounded-3xl p-6 border border-outline-variant/10 h-full" style={{ boxShadow: '0 8px 24px rgba(16,35,63,.05)' }}>
            <div className="flex justify-between items-center mb-5">
              <h3 className="font-sora font-bold text-primary text-base">Réservations à venir</h3>
              <Link to="/dashboard/bookings" className="text-sm font-semibold text-[#f95d00] hover:underline transition-colors">
                Voir tout
              </Link>
            </div>

            {upcomingBookings.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <span className="material-symbols-outlined text-outline-variant mb-2" style={{ fontSize: 40 }}>calendar_month</span>
                <p className="text-sm text-on-surface-variant mb-3">Aucune réservation à venir.</p>
                <Link
                  to="/book/step1"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#f95d00] hover:underline"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
                  Réserver un espace
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {upcomingBookings.map((b) => (
                  <div
                    key={b.id}
                    className="group flex items-center gap-4 p-3 rounded-xl border border-transparent hover:border-outline-variant/20 hover:bg-surface-container-low/60 transition-all"
                  >
                    {/* Date badge */}
                    <div className="w-14 h-14 rounded-xl flex flex-col items-center justify-center shrink-0 bg-[#ffedd8]">
                      <span className="text-xs font-bold uppercase text-[#f95d00] leading-none">
                        {new Date(b.date_debut).toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis', month: 'short' })}
                      </span>
                      <span className="font-sora font-bold text-lg text-primary leading-none mt-0.5">
                        {new Date(b.date_debut).toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis', day: '2-digit' })}
                      </span>
                    </div>

                    {/* Info */}
                    <div className="flex-grow min-w-0">
                      <p className="font-semibold text-primary text-sm truncate">
                        {b.espaces?.nom || 'Espace'}
                      </p>
                      <p className="text-xs text-on-surface-variant">
                        {formatTimeShort(b.date_debut)} → {formatTimeShort(b.date_fin)}
                      </p>
                    </div>

                    {/* Status pill + cancel */}
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`px-2.5 py-1 rounded-md text-xs font-bold tracking-tight ${BOOKING_STATUT_COLORS[b.statut] || 'bg-gray-100 text-gray-500'}`}>
                        {BOOKING_STATUT_LABELS[b.statut] || b.statut}
                      </span>
                      {['pending', 'confirmed'].includes(b.statut) && (
                        <button
                          onClick={() => handleCancelBooking(b.id)}
                          disabled={cancellingId === b.id}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-xs font-semibold text-[#FF6F59] hover:underline disabled:opacity-50"
                        >
                          {cancellingId === b.id ? '…' : 'Annuler'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ─── ROW 2 RIGHT (4 cols): QR Code / Access Pass ─── */}
        <div className="md:col-span-4 bento-card">
          <div className="bg-white rounded-3xl p-6 border border-outline-variant/10 h-full flex flex-col items-center text-center" style={{ boxShadow: '0 8px 24px rgba(16,15,13,.05)' }}>
            <div className="flex items-center justify-between w-full mb-1">
              <h3 className="font-sora font-bold text-primary text-base">Mon accès</h3>
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
            <p className="text-xs text-on-surface-variant mb-4 w-full text-left">
              Présentez ce code à l&apos;accueil pour entrer
            </p>

            {/* QR preview */}
            {memberQr?.status === 'blocked' ? (
              <div className="p-4 rounded-xl border border-red-200 bg-red-50 w-full mb-4 flex flex-col items-center justify-center min-h-[176px] gap-2">
                <span className="material-symbols-outlined text-red-600" style={{ fontSize: 36 }}>lock</span>
                <p className="text-xs font-semibold text-red-700">Accès bloqué (impayé en retard)</p>
              </div>
            ) : (
              <div className="p-4 rounded-xl border border-outline-variant/20 bg-surface-container-low/60 hover:bg-surface-container-low transition-colors cursor-pointer relative group mb-4 w-full flex flex-col items-center justify-center gap-2">
                <div className="w-36 h-36 flex items-center justify-center">
                  <QRCodeSVG
                    value={memberQr?.payload || memberQr?.qr_token || 'deskywork-pass'}
                    size={144}
                    bgColor="transparent"
                    fgColor="#100f0d"
                    level="M"
                    includeMargin={false}
                  />
                </div>
                {memberQr?.short_code && (
                  <p className="font-sora font-bold text-xs tracking-widest text-primary">
                    Code : {memberQr.short_code}
                  </p>
                )}
              </div>
            )}

            <Link
              to="/dashboard/qr"
              className="w-full py-2.5 rounded-xl bg-surface-container-high text-primary text-sm font-semibold flex items-center justify-center gap-2 hover:bg-outline-variant/30 transition-all"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>qr_code_2</span>
              Ouvrir Mon accès
            </Link>
          </div>
        </div>

        {/* ─── ROW A LEFT (8 cols): Available Spaces Near You (Source unique de vérité) ─── */}
        <div className="md:col-span-8 bento-card">
          <div className="bg-white rounded-3xl p-6 border border-outline-variant/10 h-full" style={{ boxShadow: '0 8px 24px rgba(16,15,13,.05)' }}>
            <div className="flex justify-between items-center mb-5">
              <div>
                <h3 className="font-sora font-bold text-primary text-base flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 20 }}>near_me</span>
                  Espaces disponibles maintenant
                </h3>
                <p className="text-xs text-on-surface-variant mt-1">
                  {nearbySummary.disponibles} espace{nearbySummary.disponibles > 1 ? 's' : ''} disponible{nearbySummary.disponibles > 1 ? 's' : ''} sur {nearbySummary.total}
                  {nearbySummary.total_units > 0 ? ` · ${nearbySummary.available_units} / ${nearbySummary.total_units} unités libres` : ''}
                </p>
              </div>
              <span className="shrink-0 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">
                {nearbySummary.total_units > 0 ? `${nearbySummary.available_units} unités` : `${nearbySummary.disponibles} dispo`}
              </span>
            </div>

            {nearbySpaces.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <span className="material-symbols-outlined text-outline-variant mb-2" style={{ fontSize: 40 }}>location_off</span>
                <p className="text-sm text-on-surface-variant">Aucun espace planifiable pour le moment.</p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {nearbySpaces.map((sp) => (
                  <div key={sp.id} className="p-3 rounded-xl border border-outline-variant/10 bg-surface-container-low/40 flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(249,93,0,0.1)' }}>
                      <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 22 }}>
                        {sp.type === 'open_space' ? 'groups' : sp.type === 'private_office' ? 'meeting_room' : sp.type === 'meeting_room' ? 'event_seat' : sp.type === 'training_room' ? 'school' : 'celebration'}
                      </span>
                    </div>
                    <div className="flex-grow min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-semibold text-primary text-sm truncate">{sp.nom}</p>
                        {sp.proche && (
                          <span className="shrink-0 px-1.5 py-0.5 rounded bg-[#ffedd8] text-[#f95d00] text-xs font-bold leading-none">Habituel</span>
                        )}
                      </div>
                      <p className="text-xs text-on-surface-variant truncate">
                        {sp.coworking?.nom}{sp.coworking?.ville ? ` · ${sp.coworking.ville}` : ''}
                      </p>
                      <p className="text-xs text-on-surface-variant/85">
                        {SPACE_TYPE_LABELS[sp.type] || sp.type} · <Money amount={sp.tarif_horaire} zeroLabel="Gratuit" unit="/ h" />
                      </p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1.5">
                      {sp.disponible ? (
                        <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 text-xs font-bold tracking-tight">
                          {sp.places_restantes > 1 ? `${sp.places_restantes} places` : 'Disponible'}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-500 text-xs font-bold tracking-tight">Occupé</span>
                      )}
                      <Link
                        to="/book/step1"
                        className="px-2.5 py-1 rounded-lg text-xs font-bold text-white transition-all hover:opacity-90 active:scale-[.97]"
                        style={{ background: sp.disponible ? '#f95d00' : '#9ca3af' }}
                      >
                        Réserver
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ─── ROW A RIGHT (4 cols): Recent Invoices ─── */}
        <div className="md:col-span-4 bento-card">
          <div className="bg-white rounded-3xl p-6 border border-outline-variant/10 h-full flex flex-col justify-between" style={{ boxShadow: '0 8px 24px rgba(16,15,13,.05)' }}>
            <div>
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-sora font-bold text-primary text-base flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 20 }}>receipt_long</span>
                  Reçus récents
                </h3>
                <Link to="/member/payments" className="text-sm font-semibold text-[#f95d00] hover:underline transition-colors">Voir tout</Link>
              </div>

              {recentPayments.length === 0 ? (
                <div className="flex flex-col items-center py-8 text-center">
                  <span className="material-symbols-outlined text-outline-variant mb-2" style={{ fontSize: 32 }}>receipt_long</span>
                  <p className="text-xs text-on-surface-variant">Aucun reçu pour le moment.</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {recentPayments.map((p) => {
                    const source = p.reservations?.espaces?.nom
                      ? `Réservation · ${p.reservations.espaces.nom}`
                      : p.abonnements?.type
                        ? 'Abonnement'
                        : p.inscriptions_formations?.[0]?.formations?.titre
                          ? `Formation · ${p.inscriptions_formations[0].formations.titre}`
                          : 'Paiement';
                    return (
                      <div key={p.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-outline-variant/10 bg-surface-container-low/30">
                        <div className="min-w-0">
                          <p className="font-semibold text-primary text-xs truncate">{source}</p>
                          <p className="text-xs text-on-surface-variant">
                            {p.created_at ? formatDateShort(p.created_at) : '—'}
                          </p>
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-bold tracking-tight ${PAYMENT_STATUT_COLORS[p.statut] || 'bg-gray-100 text-gray-500'}`}>
                            {PAYMENT_STATUT_LABELS[p.statut] || p.statut}
                          </span>
                          <span className="font-sora font-bold text-primary text-sm whitespace-nowrap">
                            <Money amount={p.montant} zeroLabel="Gratuit" />
                          </span>
                          <button
                            onClick={() => handleDownloadReceipt(p.id)}
                            disabled={downloadingReceipt === p.id}
                            className="flex items-center justify-center w-7 h-7 rounded-lg bg-surface-container-high text-primary hover:bg-outline-variant/30 transition-all disabled:opacity-50"
                            title="Télécharger le reçu"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{downloadingReceipt === p.id ? 'hourglass_top' : 'download'}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <Link
              to="/member/payments"
              className="w-full text-center py-2 mt-4 rounded-xl text-xs font-bold text-secondary border border-secondary/20 hover:bg-secondary/5 transition-all block"
            >
              Tous mes reçus
            </Link>
          </div>
        </div>

        {/* ─── GRAPH : Mon activité mensuelle ─── */}
        <div className="md:col-span-12 bento-card">
          <div className="bg-white rounded-3xl p-6 border border-outline-variant/10" style={{ boxShadow: '0 8px 24px rgba(16,35,63,.05)' }}>
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="font-sora font-bold text-primary text-base">Mon activité</h3>
                <p className="text-xs text-on-surface-variant">{memberActivityCaption} · Réservations et formations</p>
              </div>
              <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-orange-50 text-[#f95d00]">
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>show_chart</span>
              </span>
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={memberActivityChart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRes" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f95d00" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#f95d00" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorForm" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2FBE8F" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#2FBE8F" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} width={30} allowDecimals={false} />
                <Tooltip />
                <Area type="monotone" dataKey="reservations" name="Réservations" stroke="#f95d00" strokeWidth={2} fillOpacity={1} fill="url(#colorRes)" />
                <Area type="monotone" dataKey="formations" name="Formations" stroke="#2FBE8F" strokeWidth={2} fillOpacity={1} fill="url(#colorForm)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ─── ROW 3 LEFT (8 cols): My Registered Formations ─── */}
        <div className="md:col-span-8 bento-card">
          <div className="bg-white rounded-3xl p-6 border border-outline-variant/10 h-full flex flex-col justify-between" style={{ boxShadow: '0 8px 24px rgba(16,35,63,.05)' }}>
            <div>
              <div className="flex justify-between items-center mb-5">
                <h3 className="font-sora font-bold text-primary text-base flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#2FBE8F]" style={{ fontSize: 20 }}>school</span>
                  Mes formations à venir
                </h3>
                <Link to="/dashboard/formations" className="text-sm font-semibold text-[#f95d00] hover:underline transition-colors">
                  Voir tout
                </Link>
              </div>

              {myFormations.filter(i => i.statut !== 'annulee').length === 0 ? (
                <div className="flex flex-col items-center py-8 text-center">
                  <span className="material-symbols-outlined text-outline-variant mb-2" style={{ fontSize: 40 }}>school</span>
                  <p className="text-sm text-on-surface-variant mb-3">Vous n'êtes inscrit à aucune formation.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {myFormations
                    .filter(i => i.statut !== 'annulee')
                    .slice(0, 3)
                    .map((insc) => {
                      const f = insc.formations || {};
                      const formateurName = f.profiles ? `${f.profiles.prenom} ${f.profiles.nom}` : 'Formateur';
                      return (
                        <div
                          key={insc.id}
                          className="flex items-center gap-4 p-3 rounded-xl border border-outline-variant/10 bg-surface-container-low/30 hover:bg-surface-container-low/60 transition-all"
                        >
                          <div className="w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0" style={{ background: 'rgba(47,190,143,0.1)' }}>
                            <span className="material-symbols-outlined text-[#2FBE8F]" style={{ fontSize: 22 }}>menu_book</span>
                          </div>
                          <div className="flex-grow min-w-0">
                            <h4 className="font-semibold text-primary text-sm truncate">{f.titre || 'Formation'}</h4>
                            <p className="text-xs text-on-surface-variant mt-0.5">
                              Animé par <strong className="text-primary">{formateurName}</strong>
                            </p>
                            <p className="text-xs text-on-surface-variant/80 mt-0.5">
                              {formatDateShort(f.date_debut)} à {formatTimeShort(f.date_debut)}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                              insc.statut_paiement === 'paye' ? 'bg-emerald-100 text-emerald-800' :
                              insc.statut_paiement === 'gratuit' ? 'bg-slate-100 text-slate-700' :
                              'bg-amber-100 text-amber-800'
                            }`}>
                              {insc.statut_paiement === 'paye' ? 'Payé' : insc.statut_paiement === 'gratuit' ? 'Gratuit' : 'À régler'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ─── ROW 3 RIGHT (4 cols): Available Formations to Register ─── */}
        <div className="md:col-span-4 bento-card">
          <div className="bg-white rounded-3xl p-6 border border-outline-variant/10 h-full flex flex-col justify-between" style={{ boxShadow: '0 8px 24px rgba(16,15,13,.05)' }}>
            <div>
              <h3 className="font-sora font-bold text-primary text-base mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 20 }}>auto_awesome</span>
                Ateliers recommandés
              </h3>

              {availableFormations.filter(f => !myFormations.some(m => m.formation_id === f.id && m.statut !== 'annulee')).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <span className="material-symbols-outlined text-outline-variant mb-2" style={{ fontSize: 32 }}>celebration</span>
                  <p className="text-xs text-on-surface-variant">Aucun nouvel atelier disponible.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {availableFormations
                    .filter(f => !myFormations.some(m => m.formation_id === f.id && m.statut !== 'annulee'))
                    .slice(0, 2)
                    .map((f) => {
                      const formateurName = f.profiles ? `${f.profiles.prenom} ${f.profiles.nom}` : 'Formateur';
                      return (
                        <div key={f.id} className="p-3 rounded-xl border border-outline-variant/10 bg-surface-container-low/40">
                          <h4 className="font-semibold text-primary text-xs truncate mb-1">{f.titre}</h4>
                          <p className="text-xs text-on-surface-variant">Formateur : <strong>{formateurName}</strong></p>
                          <div className="flex justify-between items-center mt-2.5">
                            <span className="text-xs font-bold text-secondary">
                              {Number(f.prix_inscription || 0) > 0 || (f.est_gratuit || f.programme?.includes('[SESSION_GRATUITE]'))
                                ? <Money amount={f.prix_inscription || 0} zeroLabel="Gratuit" />
                                : 'Sur devis'}
                            </span>
                            <Link
                              to="/dashboard/formations"
                              className="px-2.5 py-1 rounded bg-[#f95d00] text-white text-xs font-bold hover:opacity-90 transition-colors"
                            >
                              S'inscrire
                            </Link>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
            <Link
              to="/dashboard/formations"
              className="w-full text-center py-2 mt-4 rounded-xl text-xs font-bold text-secondary border border-secondary/20 hover:bg-secondary/5 transition-all block"
            >
              Explorer les formations
            </Link>
          </div>
        </div>
      </div>

      {/* ═══════ QUICK LINKS GRID ═══════ */}
      <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mt-6">
        {[
          { icon: 'person', label: 'Profil', to: '/dashboard/profile', color: '#f95d00' },
          { icon: 'notifications', label: 'Notifications', to: '/dashboard/notifications', color: '#FF6F59' },
          { icon: 'school', label: 'Formations', to: '/dashboard/formations', color: '#2FBE8F' },
          { icon: 'receipt_long', label: 'Mes reçus', to: '/member/payments', color: '#f95d00' },
        ].map((link) => (
          <Link
            key={link.label}
            to={link.to}
            className="bento-card bg-white rounded-2xl p-4 sm:p-5 border border-outline-variant/10 flex items-center gap-3 sm:gap-4 hover:-translate-y-0.5 hover:shadow-lg transition-all group min-w-0"
            style={{ boxShadow: '0 4px 16px rgba(16,15,13,.04)' }}
          >
            <span
              className="flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-xl shrink-0 transition-transform group-hover:scale-110"
              style={{ background: `${link.color}10`, color: link.color }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>{link.icon}</span>
            </span>
            <span className="text-sm font-semibold text-primary truncate">{link.label}</span>
          </Link>
        ))}
      </div>

      {/* ═══════ PROFILE SECTION (expandable) ═══════ */}
      <div className="mt-6 bg-white rounded-3xl border border-outline-variant/10 overflow-hidden" style={{ boxShadow: '0 4px 16px rgba(16,15,13,.04)' }}>
        <button
          onClick={() => setEditing((v) => !v)}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-surface-container-low/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 20 }}>person</span>
            <span className="font-sora font-bold text-primary text-sm">Mon profil</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-full bg-[#ffedd8] text-[#f95d00] text-xs font-bold tracking-tight">
              {profile?.statut_compte || 'actif'}
            </span>
            <span className={`material-symbols-outlined transition-transform duration-200 text-on-surface-variant ${editing ? 'rotate-180' : ''}`} style={{ fontSize: 20 }}>
              expand_more
            </span>
          </div>
        </button>

        {editing ? (
          <div className="px-6 pb-6 border-t border-outline-variant/10">
            <form onSubmit={handleSaveProfile} className="pt-5 space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                {[
                  { id: 'prenom', label: 'Prénom', key: 'prenom', required: true },
                  { id: 'nom', label: 'Nom', key: 'nom', required: true },
                  { id: 'telephone', label: 'Téléphone', key: 'telephone', required: true },
                  { id: 'cin', label: 'CIN / Passeport', key: 'cin', required: false },
                ].map((field) => (
                  <div key={field.id}>
                    <label className="block text-xs font-semibold text-primary mb-1" htmlFor={field.id}>{field.label}</label>
                    <input
                      id={field.id}
                      value={form[field.key]}
                      onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                      className="w-full border border-outline-variant/30 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#f95d00]/30 focus:border-[#f95d00] transition-all"
                      required={field.required}
                    />
                  </div>
                ))}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-primary mb-1" htmlFor="type_membre">Type membre</label>
                  <select
                    id="type_membre"
                    value={form.type_membre}
                    onChange={(e) => setForm({ ...form, type_membre: e.target.value })}
                    className="w-full border border-outline-variant/30 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#f95d00]/30 focus:border-[#f95d00] transition-all"
                  >
                    <option value="individuel">Individuel</option>
                    <option value="entreprise">Entreprise</option>
                    <option value="etudiant">Étudiant</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50"
                  style={{ background: '#f95d00' }}
                >
                  {saving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="px-5 py-2 rounded-xl text-sm font-semibold border border-outline-variant/30 hover:bg-surface-container-low transition-all"
                >
                  Annuler
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div className="px-6 pb-5 border-t border-outline-variant/10">
            <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 gap-3 pt-4">
              {[
                { label: 'Nom', value: `${profile?.prenom || ''} ${profile?.nom || ''}`.trim() || '—', icon: 'person' },
                { label: 'Email', value: profile?.email || session?.user?.email || '—', icon: 'mail' },
                { label: 'Téléphone', value: profile?.telephone || '—', icon: 'call' },
                { label: 'Type', value: MEMBER_TYPE_LABELS[profile?.type_membre] || profile?.type_membre || '—', icon: 'badge' },
                { label: 'Rôle', value: ROLE_LABELS[profile?.role] || profile?.role || '—', icon: 'shield_person' },
                { label: 'CIN', value: profile?.cin || 'Non renseigné', icon: 'id_card' },
              ].map((item) => (
                <div key={item.label} className="flex items-start gap-2.5 p-3 rounded-xl bg-surface-container-low/50">
                  <span className="material-symbols-outlined text-[#f95d00] shrink-0 mt-0.5" style={{ fontSize: 16 }}>{item.icon}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">{item.label}</p>
                    <p className="text-sm font-medium text-primary truncate">{item.value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ═══════ SUBSCRIPTION HISTORY (compact) ═══════ */}
      {subscriptionHistory.length > 0 && (
        <div className="mt-5 bg-white rounded-3xl border border-outline-variant/10 p-6" style={{ boxShadow: '0 4px 16px rgba(16,15,13,.04)' }}>
          <h3 className="font-sora font-bold text-primary text-sm mb-4">Historique des abonnements</h3>
          <div className="space-y-2">
            {subscriptionHistory.map((sub) => (
              <div key={sub.id} className="flex items-center justify-between gap-3 p-3 rounded-xl hover:bg-surface-container-low/50 transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-primary truncate">
                    {SUBSCRIPTION_LABELS[sub.type] || sub.type}
                  </p>
                  <p className="text-xs text-on-surface-variant">
                    {formatDateShort(sub.date_debut)} → {formatDateShort(sub.date_fin)}
                  </p>
                </div>
                <span className={`px-2.5 py-1 rounded-md text-xs font-bold tracking-tight shrink-0 ${
                  sub.statut === 'active' || sub.statut === 'actif' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {STATUT_LABELS[sub.statut] || sub.statut}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══════ MODALE CONFIRMATION ARRÊT SESSION ═══════ */}
      {showFinishConfirm && isTrulyStarted && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          onClick={() => setShowFinishConfirm(false)}
        >
          <div
            className="bg-white dark:bg-[#1a1917] rounded-3xl p-6 shadow-2xl border border-outline-variant/20 w-full max-w-md space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-[#ffedd8] text-[#f95d00] flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined" style={{ fontSize: 22 }}>stop_circle</span>
              </div>
              <div>
                <h3 className="font-sora font-bold text-primary dark:text-white text-base">
                  Terminer votre session ?
                </h3>
                <p className="text-xs text-on-surface-variant">
                  {activeSession.reservations?.espaces?.nom || 'Espace'} · Durée écoulée : {serverTimer.formattedElapsed}
                </p>
              </div>
            </div>

            <p className="text-xs text-on-surface-variant leading-relaxed">
              Le chronomètre serveur sera arrêté immédiatement et l&apos;accueil recevra une notification en temps réel pour finaliser votre sortie.
            </p>

            {serverTimer.isOvertime && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-semibold">
                Un dépassement est en cours (<Money amount={overtimeHourlyRate} zeroLabel="Gratuit" unit="/ heure" />, facturé par tranches de 15 min sur place).
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setShowFinishConfirm(false)}
                className="flex-1 py-2.5 px-4 rounded-xl border border-outline-variant/30 text-xs font-bold text-primary dark:text-white hover:bg-black/5 cursor-pointer"
              >
                Continuer la session
              </button>
              <button
                type="button"
                onClick={handleCheckOut}
                disabled={checkingOut}
                className="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-white cursor-pointer disabled:opacity-50"
                style={{ backgroundColor: '#f95d00' }}
              >
                {checkingOut ? 'Arrêt en cours…' : 'Confirmer et terminer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
