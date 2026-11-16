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
import { DEFAULT_PERIOD, periodWindow, windowLabel } from '../utils/dashboardPeriod';
import { ROLE_LABELS } from '../utils/roles';
import { useSessionUser } from '../hooks/useSessionUser';
import { QRCodeSVG } from 'qrcode.react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

/* ─── Constants ─── */
const TIMER_RING_RADIUS = 42;
const TIMER_RING_CIRCUMFERENCE = 2 * Math.PI * TIMER_RING_RADIUS;
const ALERT_THRESHOLD_SECONDS = 900;

const SUBSCRIPTION_LABELS = {
  day_pass: 'Day Pass',
  week_pass: 'Week Pass',
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
  suspended: 'Suspendu',
  expired: 'Expiré',
};

const BOOKING_STATUT_LABELS = {
  pending: 'En attente',
  confirmed: 'Confirmée',
  cancelled: 'Annulée',
};

const BOOKING_STATUT_COLORS = {
  confirmed: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-red-100 text-red-600',
};

const PAYMENT_STATUT_LABELS = {
  pending: 'En attente',
  paid: 'Payé',
  failed: 'Échoué',
  refunded: 'Remboursé',
};

const PAYMENT_STATUT_COLORS = {
  paid: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-600',
  refunded: 'bg-slate-100 text-slate-600',
};

const SPACE_TYPE_LABELS = {
  open_space: 'Open Space',
  private_office: 'Bureau privé',
  meeting_room: 'Salle de réunion',
  training_room: 'Salle de formation',
  event_space: 'Espace événementiel',
  hot_desk: 'Poste nomade (Hot Desk)',
  dedicated_desk: 'Poste fixe (Dedicated Desk)',
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
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleTimeString('fr-FR', { timeStyle: 'short' });
}

function formatDateShort(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Bonjour';
  if (h < 18) return 'Après-midi';
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
  const [nearbySummary, setNearbySummary] = useState({ total: 0, disponibles: 0 });
  const [recentPayments, setRecentPayments] = useState([]);
  const [downloadingReceipt, setDownloadingReceipt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [period, setPeriod] = useState(DEFAULT_PERIOD);
  const [memberQr, setMemberQr] = useState(null);

  /* ── Session state ── */
  const [activeSession, setActiveSession] = useState(null);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [totalSessionSeconds, setTotalSessionSeconds] = useState(1);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);

  /* ── Booking state ── */
  const [cancellingId, setCancellingId] = useState(null);

  /* ── Profile edit state ── */
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ nom: '', prenom: '', telephone: '', cin: '', type_membre: 'individuel' });

  /* ── Derived: today's check-in ready reservations ── */
  const todayCheckInReady = useMemo(() => {
    if (activeSession) return [];
    const now = new Date();
    return bookings.filter((b) => {
      if (b.statut !== 'confirmed') return false;
      const debut = new Date(b.date_debut);
      const fin = new Date(b.date_fin);
      return debut <= now && fin > now;
    });
  }, [bookings, activeSession]);

  /* ── Derived: upcoming bookings (future, not cancelled) ── */
  const upcomingBookings = useMemo(() => {
    const now = new Date();
    return bookings
      .filter((b) => new Date(b.date_fin) > now && b.statut !== 'cancelled')
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
      const [{ profile: prof }, { subscription }, { subscriptions }, { reservations }, myFormationsRes, availableFormationsRes] = await Promise.all([
        memberApi.getMe(),
        subscriptionApi.getActive(),
        subscriptionApi.getMine(),
        bookingApi.getAll(),
        formationApi.getMesFormations(),
        formationApi.getAll({ statut: 'planifiee' }),
      ]);
      setProfile(prof);
      setActiveSubscription(subscription);
      setSubscriptionHistory(subscriptions || []);
      setBookings(reservations || []);
      setMyFormations(myFormationsRes.inscriptions || []);
      setAvailableFormations(availableFormationsRes.formations || []);
      setForm({
        nom: prof.nom || '',
        prenom: prof.prenom || '',
        telephone: prof.telephone || '',
        cin: prof.cin || '',
        type_membre: prof.type_membre || 'individuel',
      });

      try {
        const { session: sess } = await sessionApi.getActive();
        hydrateSession(sess);
      } catch {
        setActiveSession(null);
      }

      try {
        const nearby = await memberPortalApi.getNearbySpaces();
        setNearbySpaces(nearby.espaces || []);
        setNearbySummary({ total: nearby.total ?? 0, disponibles: nearby.disponibles ?? 0 });
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

  const hydrateSession = (sess) => {
    setActiveSession(sess);
    if (sess?.reservations?.date_fin) {
      const remaining = Math.max(0, Math.floor((new Date(sess.reservations.date_fin).getTime() - Date.now()) / 1000));
      setTimerSeconds(remaining);
      if (sess.check_in) {
        const total = Math.max(1, Math.floor((new Date(sess.reservations.date_fin).getTime() - new Date(sess.check_in).getTime()) / 1000));
        setTotalSessionSeconds(total);
      }
    }
  };

  /* ── Initial load ── */
  useEffect(() => { loadData(); }, [session]);

  /* ── Mon QR code d'accès (scannable par le staff) ── */
  useEffect(() => {
    let active = true;
    memberApi
      .getQr()
      .then((qr) => {
        if (active) setMemberQr(qr);
      })
      .catch(() => {});
    return () => {
      active = false;
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
        setTimerSeconds(0);
        setTotalSessionSeconds(1);
        loadData();
      }),
      onSessionOvertime(() => { loadData(); }),
      onSessionAlert15Min((data) => {
        setSuccess(`⚠️ Attention : moins de 15 min restantes — ${data.espace?.nom || 'workspace'}.`);
      }),
    ];

    return () => {
      unsubs.forEach((fn) => fn());
      disconnectSocket();
    };
  }, [session?.user?.id]);

  /* ── Timer tick ── */
  useEffect(() => {
    if (!activeSession || timerSeconds <= 0) return;
    const id = setInterval(() => {
      setTimerSeconds((s) => (s <= 1 ? (clearInterval(id), 0) : s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [activeSession?.id]);

  /* ── Poll active session every 30 s ── */
  useEffect(() => {
    if (!activeSession) return;
    const id = setInterval(() => {
      sessionApi
        .getActive()
        .then(({ session: sess }) => hydrateSession(sess))
        .catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, [activeSession?.id]);

  /* ── Handlers ── */
  const handleCheckIn = async (reservationId) => {
    setCheckingIn(true);
    setError('');
    try {
      const { session: sess } = await sessionApi.checkIn({ reservation_id: reservationId });
      hydrateSession(sess);
      setSuccess('Check-in réussi ! Bonne session.');
    } catch (e) {
      setError(e.message);
    } finally {
      setCheckingIn(false);
    }
  };

  const handleCheckOut = async () => {
    if (!activeSession) return;
    setCheckingOut(true);
    setError('');
    try {
      await sessionApi.checkOut({ session_id: activeSession.id });
      setActiveSession(null);
      setTimerSeconds(0);
      setTotalSessionSeconds(1);
      setSuccess('Check-out enregistré. À bientôt !');
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

  const timerIsLow = timerSeconds > 0 && timerSeconds <= ALERT_THRESHOLD_SECONDS;
  const timerColor = timerIsLow ? '#FF6F59' : '#2FBE8F';

  return (
    <PortalLayout profile={profile} onLogout={handleLogout}>
      {/* Inject one-time CSS */}
      <style>{styleSheet}</style>

      {/* ═══════ HEADER ═══════ */}
      <header className="mb-7 bento-card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-on-surface-variant mb-1">
              {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
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

        {/* ─── ROW 1 LEFT (8 cols): Live Session / Quick Check-in ─── */}
        <div className="md:col-span-8 bento-card">
          {activeSession ? (
            /* ── LIVE SESSION CARD ── */
            <div className="bg-white rounded-3xl p-5 sm:p-6 border border-outline-variant/10 h-full flex flex-col sm:flex-row items-center gap-5 sm:gap-6" style={{ boxShadow: '0 8px 24px rgba(16,35,63,.05)' }}>
              {/* Circular timer — responsive size */}
              <div className="relative shrink-0" style={{ width: 'clamp(100px, 28vw, 144px)', height: 'clamp(100px, 28vw, 144px)' }}>
                <svg viewBox="0 0 100 100" className="w-full h-full">
                  <circle cx="50" cy="50" r={TIMER_RING_RADIUS} fill="transparent" stroke="#eef0f4" strokeWidth="8" />
                  <circle
                    cx="50" cy="50" r={TIMER_RING_RADIUS} fill="transparent"
                    stroke={timerColor}
                    strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={TIMER_RING_CIRCUMFERENCE}
                    strokeDashoffset={timerRingOffset}
                    className="progress-ring__circle"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={`font-sora font-bold text-lg sm:text-xl ${timerIsLow ? 'text-[#FF6F59]' : 'text-primary'}`}>
                    {formatTimer(timerSeconds)}
                  </span>
                  <span className="text-[10px] text-on-surface-variant font-medium mt-0.5">restant</span>
                </div>
              </div>

              {/* Info */}
              <div className="flex-grow text-center sm:text-left space-y-3">
                <div>
                  <div className="flex items-center justify-center sm:justify-start gap-2 mb-1">
                    <span className="w-2 h-2 rounded-full pulse-dot" style={{ background: timerColor }} />
                    <span className="text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: timerColor }}>
                      Session de travail en cours
                    </span>
                  </div>
                  <h2 className="font-sora font-bold text-primary text-lg">
                    {activeSession.reservations?.espaces?.nom || 'Espace'}
                    {activeSession.reservations?.espaces?.type && (
                      <span className="font-normal text-on-surface-variant text-sm capitalize">
                        {' · '}{activeSession.reservations.espaces.type.replace('_', ' ')}
                      </span>
                    )}
                  </h2>
                  <p className="text-sm text-on-surface-variant mt-0.5">
                    Début {formatTimeShort(activeSession.check_in)}
                    {' · Fin prévue '}
                    {formatTimeShort(activeSession.reservations?.date_fin)}
                  </p>
                </div>
                {timerIsLow && (
                  <p className="text-xs font-semibold text-[#FF6F59]">Moins de 15 minutes restantes</p>
                )}
                <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
                  <Link
                    to="/dashboard/abonnement"
                    className="px-4 py-2 rounded-lg border border-outline-variant/30 text-sm font-semibold text-on-surface-variant hover:bg-surface-container transition-all"
                  >
                    Prolonger
                  </Link>
                  <button
                    onClick={handleCheckOut}
                    disabled={checkingOut}
                    className="px-5 py-2 rounded-lg bg-[#FF6F59] text-white text-sm font-semibold hover:opacity-90 active:scale-[.97] transition-all disabled:opacity-50"
                  >
                    {checkingOut ? '…' : 'Terminer la session de travail'}
                  </button>
                </div>
              </div>
            </div>
          ) : todayCheckInReady.length > 0 ? (
            /* ── QUICK CHECK-IN CARD ── */
            <div className="bg-white rounded-3xl p-6 border border-outline-variant/10 h-full" style={{ boxShadow: '0 8px 24px rgba(16,35,63,.05)' }}>
              <div className="flex items-center gap-2 mb-4">
                <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 22 }}>event_available</span>
                <h2 className="font-sora font-bold text-primary text-base">Check-in rapide</h2>
              </div>
              <div className="space-y-3">
                {todayCheckInReady.map((b) => (
                  <div key={b.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl bg-surface-container-low border border-outline-variant/10">
                    <div>
                      <p className="font-semibold text-primary text-sm">{b.espaces?.nom || 'Espace'}</p>
                      <p className="text-xs text-on-surface-variant">
                        {formatTimeShort(b.date_debut)} → {formatTimeShort(b.date_fin)}
                      </p>
                    </div>
                    <button
                      onClick={() => handleCheckIn(b.id)}
                      disabled={checkingIn}
                      className="px-4 py-2 rounded-lg text-white text-sm font-semibold transition-all hover:opacity-90 active:scale-[.97] disabled:opacity-50 self-start sm:self-auto"
                      style={{ background: '#2FBE8F' }}
                    >
                      {checkingIn ? '…' : 'Check-in'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* ── NO SESSION STATE ── */
            <div className="bg-white rounded-3xl p-6 border border-outline-variant/10 h-full flex flex-col items-center justify-center text-center min-h-[200px]" style={{ boxShadow: '0 8px 24px rgba(16,35,63,.05)' }}>
              <span className="material-symbols-outlined text-outline-variant mb-3" style={{ fontSize: 48 }}>desk</span>
              <p className="font-sora font-bold text-primary text-base mb-1">Aucune session de travail en cours</p>
              <p className="text-sm text-on-surface-variant mb-4">Réservez un espace ou effectuez un check-in depuis vos réservations.</p>
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

        {/* ─── ROW 1 RIGHT (4 cols): Active Subscription ─── */}
        <div className="md:col-span-4 bento-card">
          <div
            className="rounded-3xl p-6 h-full relative overflow-hidden flex flex-col justify-between min-h-[280px]"
            style={{ background: '#000d23', boxShadow: '0 8px 24px rgba(0,13,35,.18)' }}
          >
            {/* Glow */}
            <div className="absolute top-[-30px] right-[-30px] w-44 h-44 rounded-full blur-3xl" style={{ background: 'rgba(0,84,203,.15)' }} />
            <div className="absolute bottom-[-40px] left-[-20px] w-32 h-32 rounded-full blur-3xl" style={{ background: 'rgba(47,190,143,.08)' }} />

            <div className="relative z-10">
              <div className="flex justify-between items-start mb-4">
                <div className="px-3 py-1 rounded-full" style={{ background: '#f95d00' }}>
                  <span className="text-[11px] uppercase tracking-[.16em] text-white font-semibold">
                    {activeSubscription ? SUBSCRIPTION_LABELS[activeSubscription.type] || 'Abonnement' : 'Sans abonnement'}
                  </span>
                </div>
                <span className="material-symbols-outlined" style={{ color: 'rgba(218,226,255,.4)', fontSize: 24 }}>workspace_premium</span>
              </div>

              {activeSubscription ? (
                <>
                  <h3 className="font-sora font-bold text-white text-lg mb-1">
                    {SUBSCRIPTION_LABELS[activeSubscription.type] || activeSubscription.type}
                  </h3>
                  <p className="text-sm" style={{ color: '#798bac' }}>
                    Du {formatDateShort(activeSubscription.date_debut)} au {formatDateShort(activeSubscription.date_fin)}
                  </p>
                </>
              ) : (
                <>
                  <h3 className="font-sora font-bold text-white text-lg mb-1">Aucun abonnement</h3>
                  <p className="text-sm" style={{ color: '#798bac' }}>
                    Souscrivez depuis la page{' '}
                    <Link to="/dashboard/abonnement" className="underline font-semibold text-[#b5c7eb] hover:text-white transition-colors">
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
                    <span className="text-[11px] font-medium mt-1 block" style={{ color: '#798bac' }}>
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
                      background: 'linear-gradient(90deg, #2FBE8F, #b5c7eb)',
                    }}
                  />
                </div>
                {/* Auto-renewal */}
                <div className="flex justify-between text-xs">
                  <span style={{ color: '#798bac' }}>Renouvellement auto</span>
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
                    <div className="w-14 h-14 rounded-xl flex flex-col items-center justify-center shrink-0" style={{ background: '#eef2ff' }}>
                      <span className="text-[10px] font-bold uppercase text-[#f95d00] leading-none">
                        {new Date(b.date_debut).toLocaleDateString('fr-FR', { month: 'short' })}
                      </span>
                      <span className="font-sora font-bold text-lg text-primary leading-none mt-0.5">
                        {new Date(b.date_debut).getDate()}
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
                      <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-tight ${BOOKING_STATUT_COLORS[b.statut] || 'bg-gray-100 text-gray-500'}`}>
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
          <div className="bg-white rounded-3xl p-6 border border-outline-variant/10 h-full flex flex-col items-center text-center" style={{ boxShadow: '0 8px 24px rgba(16,35,63,.05)' }}>
            <h3 className="font-sora font-bold text-primary text-base mb-1">Mon accès</h3>
            <p className="text-xs text-on-surface-variant mb-4">Scannez au kiosk pour entrer</p>

            {/* QR preview */}
            <div className="p-4 rounded-xl border border-outline-variant/20 bg-surface-container-low/60 hover:bg-surface-container-low transition-colors cursor-pointer relative group mb-4 w-full flex items-center justify-center">
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 rounded-xl" style={{ background: 'rgba(0,84,203,.06)' }}>
                <span className="material-symbols-outlined text-[#f95d00] text-3xl">fullscreen</span>
              </div>
              <div className="w-40 h-40 flex items-center justify-center">
                <QRCodeSVG
                  value={memberQr?.payload || profile?.email || session?.user?.email || profile?.id || 'member'}
                  size={160}
                  bgColor="transparent"
                  fgColor="#000d23"
                  level="M"
                  includeMargin={false}
                />
              </div>
            </div>

            <Link
              to="/dashboard/qr"
              className="w-full py-2.5 rounded-xl bg-surface-container-high text-primary text-sm font-semibold flex items-center justify-center gap-2 hover:bg-outline-variant/30 transition-all"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>open_in_new</span>
              Mon accès
            </Link>
          </div>
        </div>

        {/* ─── ROW A LEFT (8 cols): Available Spaces Near You ─── */}
        <div className="md:col-span-8 bento-card">
          <div className="bg-white rounded-3xl p-6 border border-outline-variant/10 h-full" style={{ boxShadow: '0 8px 24px rgba(16,35,63,.05)' }}>
            <div className="flex justify-between items-center mb-5">
              <div>
                <h3 className="font-sora font-bold text-primary text-base flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 20 }}>near_me</span>
                  Espaces disponibles à proximité
                </h3>
                <p className="text-xs text-on-surface-variant mt-1">
                  {nearbySummary.disponibles} disponible{nearbySummary.disponibles > 1 ? 's' : ''} maintenant sur {nearbySummary.total} espaces actifs
                </p>
              </div>
              <span className="shrink-0 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-tight">
                {nearbySummary.disponibles} dispo
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
                          <span className="shrink-0 px-1.5 py-0.5 rounded bg-[#dae2ff] text-[#001847] text-[9px] font-bold uppercase leading-none">Habituel</span>
                        )}
                      </div>
                      <p className="text-[11px] text-on-surface-variant truncate">
                        {sp.coworking?.nom}{sp.coworking?.ville ? ` · ${sp.coworking.ville}` : ''}
                      </p>
                      <p className="text-[10px] text-on-surface-variant/80">
                        {SPACE_TYPE_LABELS[sp.type] || sp.type} · {sp.tarif_horaire > 0 ? `${sp.tarif_horaire} DT/h` : 'Gratuit'}
                      </p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1.5">
                      {sp.disponible ? (
                        <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[9px] font-bold uppercase tracking-tight">
                          {sp.places_restantes > 1 ? `${sp.places_restantes} places` : 'Disponible'}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-500 text-[9px] font-bold uppercase tracking-tight">Occupé</span>
                      )}
                      <Link
                        to="/book/step1"
                        className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-white transition-all hover:opacity-90 active:scale-[.97]"
                        style={{ background: sp.disponible ? '#f95d00' : '#cbd5e1' }}
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
          <div className="bg-white rounded-3xl p-6 border border-outline-variant/10 h-full flex flex-col justify-between" style={{ boxShadow: '0 8px 24px rgba(16,35,63,.05)' }}>
            <div>
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-sora font-bold text-primary text-base flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#8b5cf6]" style={{ fontSize: 20 }}>receipt_long</span>
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
                          <p className="text-[10px] text-on-surface-variant">
                            {p.created_at ? new Date(p.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                          </p>
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-tight ${PAYMENT_STATUT_COLORS[p.statut] || 'bg-gray-100 text-gray-500'}`}>
                            {PAYMENT_STATUT_LABELS[p.statut] || p.statut}
                          </span>
                          <span className="font-sora font-bold text-primary text-sm whitespace-nowrap">{parseFloat(p.montant || 0).toFixed(3)} DT</span>
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
                            <p className="text-[11px] text-on-surface-variant/80 mt-0.5">
                              {formatDateShort(f.date_debut)} à {formatTimeShort(f.date_debut)}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
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
          <div className="bg-white rounded-3xl p-6 border border-outline-variant/10 h-full flex flex-col justify-between" style={{ boxShadow: '0 8px 24px rgba(16,35,63,.05)' }}>
            <div>
              <h3 className="font-sora font-bold text-primary text-base mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-[#8b5cf6]" style={{ fontSize: 20 }}>auto_awesome</span>
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
                          <p className="text-[10px] text-on-surface-variant">Formateur : <strong>{formateurName}</strong></p>
                          <div className="flex justify-between items-center mt-2.5">
                            <span className="text-[10px] font-bold text-secondary">{f.prix_inscription > 0 ? `${f.prix_inscription} DT` : 'Gratuit'}</span>
                            <Link
                              to="/dashboard/formations"
                              className="px-2.5 py-1 rounded bg-[#8b5cf6] text-white text-[10px] font-bold hover:bg-[#8b5cf6]/90 transition-colors"
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
          { icon: 'receipt_long', label: 'Mes reçus', to: '/member/payments', color: '#8b5cf6' },
        ].map((link) => (
          <Link
            key={link.label}
            to={link.to}
            className="bento-card bg-white rounded-2xl p-4 sm:p-5 border border-outline-variant/10 flex items-center gap-3 sm:gap-4 hover:-translate-y-0.5 hover:shadow-lg transition-all group min-w-0"
            style={{ boxShadow: '0 4px 16px rgba(16,35,63,.04)' }}
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
      <div className="mt-6 bg-white rounded-3xl border border-outline-variant/10 overflow-hidden" style={{ boxShadow: '0 4px 16px rgba(16,35,63,.04)' }}>
        <button
          onClick={() => setEditing((v) => !v)}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-surface-container-low/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 20 }}>person</span>
            <span className="font-sora font-bold text-primary text-sm">Mon profil</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-full bg-[#dae2ff] text-[#001847] text-[10px] font-bold uppercase tracking-tight">
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
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">{item.label}</p>
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
        <div className="mt-5 bg-white rounded-3xl border border-outline-variant/10 p-6" style={{ boxShadow: '0 4px 16px rgba(16,35,63,.04)' }}>
          <h3 className="font-sora font-bold text-primary text-sm mb-4">Historique des abonnements</h3>
          <div className="space-y-2">
            {subscriptionHistory.map((sub) => (
              <div key={sub.id} className="flex items-center justify-between gap-3 p-3 rounded-xl hover:bg-surface-container-low/50 transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-primary truncate">
                    {SUBSCRIPTION_LABELS[sub.type] || sub.type}
                  </p>
                  <p className="text-xs text-on-surface-variant">
                    {new Date(sub.date_debut).toLocaleDateString('fr-FR')} → {new Date(sub.date_fin).toLocaleDateString('fr-FR')}
                  </p>
                </div>
                <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-tight shrink-0 ${
                  sub.statut === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {STATUT_LABELS[sub.statut] || sub.statut}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
