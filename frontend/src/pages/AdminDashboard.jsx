import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { kpiApi, memberApi, tenantAdminApi, guestApi, sessionApi } from '../services/api';
import {
  formatDT as formatDTMillimes,
  formatDateDMY,
  formatTime24h,
  formatTimeHMS,
  formatKpiDelta,
  TUNIS_TZ,
} from '../utils/format';
import Money from '../components/common/Money';
import PortalLayout from '../components/layout/PortalLayout';
import { getRoleLabel } from '../utils/roles';
import { exportDashboardToExcel } from '../utils/exportDashboardExcel';
import PeriodFilter from '../components/dashboard/PeriodFilter';
import AIReportPanel from '../components/dashboard/AIReportPanel';
import { useSessionUser } from '../hooks/useSessionUser';
import { useTheme } from '../context/ThemeContext';
import {
  DEFAULT_PERIOD, periodWindow, windowLabel, trendBadge, CHART_COLORS, inWindow,
} from '../utils/dashboardPeriod';
import {
  ComposedChart, BarChart, Bar, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

// ─── Intervalles de rafraîchissement ────────────────────────────────────────
const REFRESH_KPI_MS = 90_000;      // KPIs généraux  : 90s
const REFRESH_SESSIONS_MS = 30_000; // Sessions live  : 30s

// ─── Animations CSS pures légères ───────────────────────────────────────────
const DASH_ANIMATIONS = `
@keyframes dashFadeUp {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes dashScaleIn {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes dashBarGrow {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}
.dash-enter {
  animation: dashFadeUp 0.48s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.dash-scale-enter {
  animation: dashScaleIn 0.42s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.dash-bar-grow {
  transform-origin: left center;
  animation: dashBarGrow 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
}
`;

// ─── Helpers ────────────────────────────────────────────────────────────────
function formatDT(val) {
  return formatDTMillimes(val, { suffix: false });
}

function formatClockSeconds(totalSec) {
  const sec = Math.max(0, Math.floor(totalSec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Bonjour';
  if (h < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

function formatTimeShort(dateStr) {
  return formatTime24h(dateStr);
}

function formatDateShort(dateStr) {
  return formatDateDMY(dateStr);
}

function relTime(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `il y a ${d}j`;
  return new Date(dateStr).toLocaleDateString('fr-FR', { timeZone: TUNIS_TZ, day: 'numeric', month: 'short' });
}

function getInitials(prenom, nom, fallback = 'DW') {
  const a = String(prenom || '').trim()[0] || '';
  const b = String(nom || '').trim()[0] || '';
  return (a + b).toUpperCase() || fallback;
}

// ─── Hook compteur animé fluide (easeOutCubic) ──────────────────────────────
function useCountUp(target, duration = 680) {
  const numeric = Number(target);
  const valid = Number.isFinite(numeric);
  const [display, setDisplay] = useState(valid ? numeric : 0);
  const prevRef = useRef(valid ? numeric : 0);

  useEffect(() => {
    if (!valid) return undefined;
    const from = prevRef.current;
    const to = numeric;
    if (from === to) {
      setDisplay(to);
      return undefined;
    }
    let rafId = null;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (to - from) * eased;
      setDisplay(current);
      if (t < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        prevRef.current = to;
        setDisplay(to);
      }
    };
    rafId = requestAnimationFrame(step);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [numeric, valid, duration]);

  return valid ? display : null;
}

function AnimatedNumber({ value, decimals = 0, suffix = '' }) {
  const num = Number(value);
  const isNum = Number.isFinite(num);
  const animated = useCountUp(isNum ? num : 0);
  if (!isNum || animated == null) return <span>—</span>;
  if (decimals === 3 && suffix.trim() === 'DT') {
    return <span>{formatDTMillimes(animated, { suffix: true })}</span>;
  }
  const formatted = decimals > 0
    ? formatDTMillimes(animated, { suffix: false })
    : Math.round(animated).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  return <span>{formatted}{suffix}</span>;
}

// ─── Composant StatCard Cliquable & Animée (un seul filet neutre) ──────────
function StatCard({ label, rawValue, decimals = 0, suffix = '', sub, icon, accent = '#f95d00', to = '/admin/dashboard', badge, pulse, trend, delayMs = 0 }) {
  const { dark } = useTheme();
  const bg = accent === '#2fbe8f' ? 'rgba(47,190,143,0.12)'
    : accent === '#ba1a1a' ? 'rgba(186,26,26,0.10)'
      : accent === '#f59e0b' ? 'rgba(245,158,11,0.12)'
        : accent === '#8b5cf6' ? 'rgba(139,92,246,0.12)'
          : 'rgba(249,93,0,0.11)';

  const trendColor = trend?.dir === 'up' || trend?.dir === 'new'
    ? '#2fbe8f'
    : trend?.dir === 'down'
      ? '#ba1a1a'
      : (dark ? '#cfcac3' : '#5e5a55');

  return (
    <Link
      to={to}
      className="dash-enter block no-underline hover:no-underline h-full group focus:outline-none"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div
        className="bg-surface-container-lowest rounded-3xl border border-outline-variant/25 h-full transition-all duration-300 group-hover:-translate-y-1 group-hover:border-[#f95d00]/50 relative overflow-hidden"
        style={{
          padding: '18px 20px',
          boxShadow: dark ? '0 8px 24px rgba(0,0,0,0.35)' : '0 6px 20px rgba(16,35,63,0.05)',
        }}
      >
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0 group-hover:scale-110 transition-transform duration-300"
              style={{ background: bg, color: accent }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{icon}</span>
            </span>
            <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant leading-tight">
              {label}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {pulse && (
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: accent }} />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: accent }} />
              </span>
            )}
            <span
              className="material-symbols-outlined text-on-surface-variant/40 group-hover:text-secondary group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-300"
              style={{ fontSize: 16 }}
            >
              arrow_outward
            </span>
          </div>
        </div>

        <p className="font-sora font-extrabold text-primary leading-tight" style={{ fontSize: 22 }}>
          <AnimatedNumber value={rawValue} decimals={decimals} suffix={suffix} />
        </p>

        {trend && (
          <p className="text-xs font-bold mt-1 flex items-center gap-1" style={{ color: trendColor }}>
            {trend.text}
          </p>
        )}
        {sub && <p className="text-xs text-on-surface-variant mt-1 font-medium truncate">{sub}</p>}
        {badge != null && (
          <span
            className="inline-flex items-center gap-1 mt-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold"
            style={{ background: bg, color: accent }}
          >
            {badge}
          </span>
        )}
      </div>
    </Link>
  );
}

// ─── Tooltip personnalisé Recharts (Dark / Light) ───────────────────────────
function CustomTooltip({ active, payload, label }) {
  const { dark } = useTheme();
  if (!active || !payload?.length) return null;
  return (
    <div
      className={`rounded-2xl px-3.5 py-2.5 shadow-xl text-xs border backdrop-blur-md ${
        dark ? 'bg-[#1b1a18]/95 border-white/15 text-[#fbffff]' : 'bg-white/95 border-outline-variant/20 text-primary'
      }`}
    >
      <p className="font-bold mb-1">{label}</p>
      {payload.map((p, i) => {
        const isCa = p.name === 'CA (DT)' || p.name === 'CA' || p.dataKey === 'value';
        return (
          <p key={i} className="flex items-center gap-1.5" style={{ color: p.color || p.payload?.color || '#f95d00' }}>
            <span>{p.name} :</span>
            <strong>
              {typeof p.value === 'number'
                ? (isCa ? `${formatDT(p.value)} DT` : p.value.toLocaleString('fr-FR'))
                : p.value}
            </strong>
          </p>
        );
      })}
    </div>
  );
}

// ─── Donut CA par espace ────────────────────────────────────────────────────
function DonutBySpace({ data, title, sub, totalFormatter }) {
  const { dark } = useTheme();
  const total = (data || []).reduce((s, d) => s + (d.value || 0), 0);
  return (
    <div
      className="dash-enter bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15 h-full"
      style={{ boxShadow: dark ? '0 8px 24px rgba(0,0,0,0.35)' : '0 6px 20px rgba(16,35,63,0.06)' }}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-sora font-bold text-primary text-base">{title}</h2>
          <p className="text-xs text-on-surface-variant">{sub}</p>
        </div>
        <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-[rgba(139,92,246,0.12)]">
          <span className="material-symbols-outlined text-[#8b5cf6]" style={{ fontSize: 18 }}>donut_small</span>
        </span>
      </div>
      {data && data.length > 0 ? (
        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative w-[160px] h-[160px] shrink-0 mx-auto">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={74}
                  paddingAngle={3}
                  cornerRadius={5}
                  stroke="none"
                  isAnimationActive
                  animationDuration={750}
                >
                  {data.map((d, i) => <Cell key={d.name ?? i} fill={d.color} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-2 text-center">
              <span className="font-sora font-bold text-primary text-sm leading-tight">
                {totalFormatter ? totalFormatter(total) : total}
              </span>
              <span className="text-xs text-on-surface-variant font-semibold uppercase tracking-wider mt-0.5">Total</span>
            </div>
          </div>
          <div className="flex-1 min-w-[140px] space-y-1">
            {data.map((d) => {
              const p = total > 0 ? Math.round((d.value / total) * 100) : 0;
              return (
                <div key={d.name} className="flex items-center gap-2 py-1 px-2 rounded-lg hover:bg-surface-container-low/60 transition-colors">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                  <span className="text-xs text-on-surface-variant truncate flex-1">{d.name}</span>
                  <span className="text-xs font-bold text-primary">{p}%</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="h-[160px] flex flex-col items-center justify-center text-sm text-on-surface-variant">
          <span className="material-symbols-outlined text-[32px] opacity-40 mb-1">donut_large</span>
          Aucune donnée disponible
        </div>
      )}
    </div>
  );
}

// ─── Ligne session live isolée (minuteur 1s local) ────────────────────────────
function LiveSessionClockRow({ s, releasingId, onStart, onRelease }) {
  const isUpcoming = s.statut === 'upcoming' || s.etat === 'a_venir';
  const [nowEpoch, setNowEpoch] = useState(() => Date.now());

  useEffect(() => {
    if (isUpcoming) return undefined;
    const tick = setInterval(() => setNowEpoch(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [isUpcoming]);

  const finMs = s.reservations?.date_fin ? new Date(s.reservations.date_fin).getTime() : nowEpoch;
  const diffSec = isUpcoming
    ? Math.max(0, Math.floor(s.seconds_remaining || 0))
    : Math.floor((finMs - nowEpoch) / 1000);
  const isOvertime = !isUpcoming && diffSec < 0;
  const isSoon = !isUpcoming && diffSec >= 0 && diffSec <= 15 * 60;
  const overtimeMin = isOvertime ? Math.ceil(Math.abs(diffSec) / 60) : 0;
  const rate = Number(s.hourly_overtime_rate ?? s.reservations?.espaces?.tarif_horaire ?? 0);
  const overtimeCost = overtimeMin > 0 && rate > 0
    ? Number(((overtimeMin / 60) * rate).toFixed(3))
    : Number(s.montant_depassement || 0);

  const badgeCfg = isUpcoming
    ? { txt: 'À venir', cls: 'bg-slate-100 text-slate-700 border-slate-200' }
    : isOvertime
      ? { txt: 'En dépassement', cls: 'bg-red-100 text-red-800 border-red-200 animate-pulse' }
      : isSoon
        ? { txt: 'Bientôt terminée - 15 min', cls: 'bg-amber-100 text-amber-800 border-amber-200' }
        : { txt: 'En cours', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' };

  return (
    <div className="py-3 px-2 rounded-2xl hover:bg-surface-container-low/50 transition-colors flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <span
          className={`flex items-center justify-center w-10 h-10 rounded-xl shrink-0 ${
            isOvertime ? 'bg-red-500/15 text-red-600' : isSoon ? 'bg-amber-500/15 text-amber-600' : isUpcoming ? 'bg-slate-500/10 text-slate-600' : 'bg-emerald-500/15 text-emerald-600'
          }`}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 19 }}>
            {isOvertime ? 'warning' : 'timer'}
          </span>
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-primary text-sm truncate">{s.membre}</p>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${badgeCfg.cls}`}>
              {badgeCfg.txt}
            </span>
          </div>
          <p className="text-xs text-on-surface-variant truncate mt-0.5">
            {s.espace_nom || s.reservations?.espaces?.nom || 'Espace'} ·{' '}
            {isUpcoming
              ? `Prévu ${formatTimeShort(s.reservations?.date_debut)}`
              : `Check-in ${formatTimeShort(s.check_in)}`}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 ml-auto shrink-0">
        <div className="text-right">
          <p className={`font-mono text-sm font-bold ${isOvertime ? 'text-red-600' : isSoon ? 'text-amber-600' : 'text-emerald-600'}`}>
            {isOvertime ? `+${formatClockSeconds(Math.abs(diffSec))}` : formatClockSeconds(diffSec)}
          </p>
          {isOvertime && (
            <p className="text-xs font-bold text-red-600">
              Surplus : {formatDTMillimes(overtimeCost)}
            </p>
          )}
        </div>

        {isUpcoming ? (
          <button
            type="button"
            onClick={() => onStart(s.reservation_id)}
            disabled={releasingId === s.reservation_id}
            className="px-3.5 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition-all hover:-translate-y-0.5 disabled:opacity-50"
          >
            Démarrer
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onRelease(s.id)}
            disabled={releasingId === s.id}
            className="px-3.5 py-2 rounded-xl bg-[#f95d00] text-white text-xs font-bold hover:bg-[#e55500] shadow-sm transition-all hover:-translate-y-0.5 disabled:opacity-50"
            title="Marquer la session de travail terminée et libérer la ressource"
          >
            {releasingId === s.id ? 'Libération…' : "C'est bon, libérée"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Composant principal ─────────────────────────────────────────────────────
export default function AdminDashboard({ session }) {
  const navigate = useNavigate();
  const { dark } = useTheme();
  const { userId, email, metadata } = useSessionUser(session);
  const [profile, setProfile] = useState(() =>
    userId ? { id: userId, email, role: metadata.role || 'admin', ...metadata } : null
  );
  const [period, setPeriod] = useState(DEFAULT_PERIOD);
  const [kpis, setKpis] = useState(null);
  const [chart, setChart] = useState(null);
  const [formations, setFormations] = useState([]);
  const [pendingAccounts, setPendingAccounts] = useState([]);
  const [approvingId, setApprovingId] = useState(null);
  const [coworking, setCoworking] = useState(null);
  const [guests, setGuests] = useState([]);
  const [liveSessions, setLiveSessions] = useState([]);
  const [releasingId, setReleasingId] = useState(null);
  const [sessionActionMsg, setSessionActionMsg] = useState('');
  const hasLoadedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [exportingPdf, setExportingPdf] = useState(false);

  // Onglets / filtres locaux interactifs
  const [bookingTab, setBookingTab] = useState('upcoming'); // 'upcoming' | 'today'
  const [formationTab, setFormationTab] = useState('period'); // 'period' | 'today'
  const [guestScope, setGuestScope] = useState('period'); // 'period' | 'all'
  const [guestStatusFilter, setGuestStatusFilter] = useState('all'); // 'all' | 'pending' | 'confirmed'

  const periodRef = useRef(period);
  periodRef.current = period;

  const showReportRef = useRef(showReport);
  showReportRef.current = showReport;

  const kpiTimerRef = useRef(null);
  const sessionTimerRef = useRef(null);

  // ── Fetch KPIs ────────────────────────────────────────────────────────────
  const fetchKpis = useCallback(async (silent = false) => {
    if (!silent && !hasLoadedRef.current) setLoading(true);
    setError('');
    try {
      const p = periodRef.current;
      const params = typeof p === 'string' && p.startsWith('custom:')
        ? { period: 'custom', from: p.split(':')[1], to: p.split(':')[2] }
        : { period: p };
      const [kpiRes, chartRes, pendingRes, liveRes] = await Promise.all([
        kpiApi.getAll(params),
        kpiApi.getRevenueChart(params),
        memberApi.getPendingAccounts().catch(() => ({ pending: [] })),
        sessionApi.getLive().catch(() => ({ live_sessions: null })),
      ]);
      if (Array.isArray(liveRes?.live_sessions)) setLiveSessions(liveRes.live_sessions);
      setKpis(kpiRes);
      setChart(chartRes);
      setPendingAccounts(pendingRes.pending || []);
      setLastRefresh(new Date());
      hasLoadedRef.current = true;
      if (Array.isArray(chartRes?.formations)) setFormations(chartRes.formations);
    } catch (e) {
      if (!silent) setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Rapport IA ────────────────────────────────────────────────────────────
  const loadReport = useCallback(async (silent = false) => {
    if (!silent) setReportLoading(true);
    setReportError('');
    try {
      const p = periodRef.current;
      const params = typeof p === 'string' && p.startsWith('custom:')
        ? { period: 'custom', from: p.split(':')[1], to: p.split(':')[2] }
        : { period: p };
      const r = await kpiApi.getReport(params);
      setReport(r);
    } catch (e) {
      setReportError(e.message);
    } finally {
      setReportLoading(false);
    }
  }, []);

  // ── Refresh sélectif sessions ─────────────────────────────────────────────
  const fetchSessionsOnly = useCallback(async () => {
    if (document.hidden) return;
    try {
      const liveRes = await sessionApi.getLive().catch(() => null);
      if (Array.isArray(liveRes?.live_sessions)) {
        setLiveSessions(liveRes.live_sessions);
        const activeCount = liveRes.live_sessions.filter(
          (s) => s.statut === 'in_progress' || s.etat === 'en_cours'
        ).length;
        setKpis((prev) => (prev ? { ...prev, sessionsEnCours: activeCount } : prev));
        setLastRefresh(new Date());
      }
    } catch (_) { /* silencieux */ }
  }, []);

  // D3 : Libération manuelle explicite (« C'est bon, libérée ») + D4 dépassement
  const handleReleaseSession = async (sessionId) => {
    setReleasingId(sessionId);
    setSessionActionMsg('');
    try {
      const res = await sessionApi.release(sessionId);
      setSessionActionMsg(res.message || "C'est bon, la ressource a été libérée.");
      await fetchSessionsOnly();
    } catch (e) {
      setError(e.message || 'Impossible de libérer la session de travail.');
    } finally {
      setReleasingId(null);
    }
  };

  const handleStartUpcomingSession = async (reservationId) => {
    setReleasingId(reservationId);
    try {
      await sessionApi.checkIn({ reservation_id: reservationId, force: true });
      setSessionActionMsg('Session de travail démarrée.');
      await fetchSessionsOnly();
    } catch (e) {
      setError(e.message || 'Impossible de démarrer la session de travail.');
    } finally {
      setReleasingId(null);
    }
  };

  // ── Effet principal : profil + auto-refresh + onboarding + guests ─────────
  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;

    supabase.from('profiles').select('*').eq('id', userId).single()
      .then(({ data, error: e }) => {
        if (cancelled || e || !data) return;
        setProfile(data);
      }).catch(() => {});

    fetchKpis(false);

    Promise.all([
      tenantAdminApi.getTenant().catch(() => ({})),
      guestApi.getAll().catch(() => ({})),
    ]).then(([tRes, gRes]) => {
      if (cancelled) return;
      if (tRes?.tenant) setCoworking(tRes.tenant);
      if (gRes?.guests) setGuests(gRes.guests);
      if (
        tRes?.onboarding_completed === false &&
        window.location.pathname === '/admin/dashboard'
      ) {
        navigate('/admin/onboarding', { replace: true });
      }
    }).catch(() => {});

    kpiTimerRef.current = setInterval(() => {
      if (!document.hidden) fetchKpis(true);
    }, REFRESH_KPI_MS);
    sessionTimerRef.current = setInterval(() => {
      if (!document.hidden) fetchSessionsOnly();
    }, REFRESH_SESSIONS_MS);

    return () => {
      cancelled = true;
      clearInterval(kpiTimerRef.current);
      clearInterval(sessionTimerRef.current);
    };
  }, [userId, navigate, fetchKpis, fetchSessionsOnly]);

  useEffect(() => {
    if (!hasLoadedRef.current) return;
    fetchKpis(true);
  }, [period, fetchKpis]);

  useEffect(() => {
    if (showReportRef.current) loadReport(true);
  }, [period, loadReport]);

  // ── Exports ───────────────────────────────────────────────────────────────
  const handleExport = async () => {
    if (!kpis || !chart) return;
    setExporting(true);
    try {
      await exportDashboardToExcel(kpis, chart);
    } catch (e) {
      alert('Erreur export Excel : ' + e.message);
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      const params = typeof period === 'string' && period.startsWith('custom:')
        ? { period: 'custom', from: period.split(':')[1], to: period.split(':')[2] }
        : { period };
      await kpiApi.downloadPdfReport(params);
    } catch (e) {
      alert('Erreur export PDF : ' + e.message);
    } finally {
      setExportingPdf(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  const handleAccountAction = async (id, action) => {
    setApprovingId(id);
    try {
      await memberApi.approveAccount(id, action);
      setPendingAccounts((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      alert('Erreur : ' + e.message);
    } finally {
      setApprovingId(null);
    }
  };

  // ── Dérivés ────────────────────────────────────────────────────────────────
  const k = kpis || {};
  const ca = k.chiffreAffaires || {};
  const membres = k.nouveauxMembres || {};
  const sessions = Array.isArray(k.sessionsEnCours) ? k.sessionsEnCours : [];
  const topMembres = Array.isArray(k.topMembres) ? k.topMembres : [];
  const calendrierDuJour = Array.isArray(k.calendrierDuJour) ? k.calendrierDuJour : [];
  const prochainesReservations = Array.isArray(k.prochainesReservations) ? k.prochainesReservations : [];
  const formationsDuJourList = Array.isArray(k.formationsDuJourList) ? k.formationsDuJourList : [];
  const activiteRecente = Array.isArray(k.activiteRecente) ? k.activiteRecente : [];
  const reservationsPeriode = k.reservationsPeriode || { count: 0, confirmed: 0, pending: 0 };

  const revenueChart = Array.isArray(chart?.revenueChart) ? chart.revenueChart : [];
  const caParEspace = Array.isArray(chart?.caParEspace)
    ? chart.caParEspace.map((d, idx) => ({
        ...d,
        value: d.ca ?? 0,
        color: CHART_COLORS[idx % CHART_COLORS.length],
      }))
    : [];
  const reservationsParEspace = Array.isArray(chart?.reservationsParEspace) ? chart.reservationsParEspace : [];

  const win = useMemo(() => periodWindow(period), [period]);
  const label = windowLabel(period);
  const pStr = typeof period === 'string' ? period : (period?.key || 'mois');
  const bucketCaption = pStr.startsWith('jour')
    ? `Par heure · ${label}`
    : (pStr.startsWith('mois') || pStr.startsWith('semaine') || pStr.startsWith('custom'))
      ? `Par jour · ${label}`
      : (pStr.startsWith('annee') || pStr.startsWith('trimestre'))
        ? `Par mois · ${label}`
        : 'Par année · historique';

  const caDelta = formatKpiDelta(ca.periode ?? 0, ca.periodePrecedente ?? 0);
  const caTrend = {
    text: caDelta.pct === null
      ? `${caDelta.text} vs période préc.`
      : `${caDelta.pct > 0 ? '▲ +' : caDelta.pct < 0 ? '▼ ' : '→ '}${caDelta.pct}% vs période préc.`,
    dir: caDelta.dir,
  };
  const memDelta = formatKpiDelta(membres.periode || 0, membres.periodePrecedente || 0);
  const membersTrend = {
    text: memDelta.pct === null
      ? `${memDelta.text} vs période préc.`
      : `${memDelta.pct > 0 ? '▲ +' : memDelta.pct < 0 ? '▼ ' : '→ '}${memDelta.pct}% vs période préc.`,
    dir: memDelta.dir,
  };
  const formationsPeriode = useMemo(
    () => formations.filter((f) => inWindow(f.date_debut, win)),
    [formations, win]
  );

  const guestsPeriode = useMemo(
    () =>
      guests.filter((g) => {
        if (inWindow(g.created_at, win)) return true;
        const list = Array.isArray(g.reservations) ? g.reservations : [];
        return list.some((r) => inWindow(r.date_debut, win));
      }),
    [guests, win]
  );

  const displayedGuests = useMemo(() => {
    const base = guestScope === 'all' ? guests : guestsPeriode;
    if (guestStatusFilter === 'all') return base;
    return base.filter((g) => (g.reservations?.[0]?.statut || 'none') === guestStatusFilter);
  }, [guests, guestsPeriode, guestScope, guestStatusFilter]);

  const activeSessionsCount = liveSessions.filter((s) => s.statut !== 'upcoming' && s.etat !== 'a_venir').length || sessions.length;
  const visibleReservations = bookingTab === 'today' ? calendrierDuJour : prochainesReservations;
  const visibleFormations = formationTab === 'today' ? formationsDuJourList : formationsPeriode;

  const cardShadow = dark ? '0 8px 24px rgba(0,0,0,0.35)' : '0 6px 20px rgba(16,35,63,0.06)';
  const welcomeText = greeting();

  if (loading) {
    return (
      <PortalLayout profile={profile}>
        <div className="space-y-6 animate-pulse">
          <div className="h-24 bg-surface-container rounded-3xl" />
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15 h-32" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-7 bg-surface-container-lowest rounded-3xl h-64 border border-outline-variant/15" />
            <div className="lg:col-span-5 bg-surface-container-lowest rounded-3xl h-64 border border-outline-variant/15" />
          </div>
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout profile={profile} onLogout={handleLogout}>
      <style>{DASH_ANIMATIONS}</style>

      {/* ── 1. Hero Command Header ───────────────────────────────────────── */}
      <header
        className="dash-enter relative z-20 mb-6 rounded-3xl border border-outline-variant/15 p-5 sm:p-6"
        style={{
          background: dark
            ? 'linear-gradient(135deg, rgba(249,93,0,0.12) 0%, #151412 52%, rgba(47,190,143,0.08) 100%)'
            : 'linear-gradient(135deg, rgba(249,93,0,0.07) 0%, #ffffff 55%, rgba(47,190,143,0.04) 100%)',
          boxShadow: cardShadow,
        }}
      >
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 relative z-10">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-secondary/12 text-secondary text-xs font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
                {coworking?.nom || getRoleLabel(profile?.role)}
              </span>
              <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                {formatDateDMY(new Date())}
              </span>
            </div>

            <h1 className="font-sora font-extrabold text-primary text-2xl sm:text-3xl leading-tight">
              {welcomeText}, {profile?.prenom || 'Gérant'}
            </h1>
            <p className="text-on-surface-variant text-xs sm:text-sm mt-1 flex flex-wrap gap-1.5 items-center">
              <span>Pilotage de l&apos;établissement — Règlement 100 % sur place</span>
              {lastRefresh && (
                <span className="text-xs text-on-surface-variant/80 font-medium">
                  · Actualisé à {formatTimeHMS(lastRefresh)}
                </span>
              )}
            </p>
          </div>

          <div className="flex flex-col items-start xl:items-end gap-2.5">
            <PeriodFilter value={period} onChange={setPeriod} />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => navigate('/admin/agenda?view=plan')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-bold text-xs sm:text-sm transition-all hover:-translate-y-0.5 shadow-xs ${
                  dark ? 'border border-white/15 hover:brightness-125' : 'hover:brightness-125'
                }`}
                style={{
                  backgroundColor: dark ? 'rgba(255,255,255,0.12)' : '#100f0d',
                  color: '#ffffff',
                }}
              >
                <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 17 }}>map</span>
                <span style={{ color: '#ffffff' }}>Plan 2D Live</span>
              </button>
              {profile?.role !== 'staff' && (
                <>
                  <button
                    type="button"
                    onClick={handleExportPdf}
                    disabled={exportingPdf}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl font-semibold text-xs sm:text-sm bg-surface-container-lowest text-primary border border-outline-variant/25 hover:bg-surface-container transition-all disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[17px] text-[#f95d00]">
                      {exportingPdf ? 'sync' : 'picture_as_pdf'}
                    </span>
                    {exportingPdf ? 'PDF…' : 'PDF'}
                  </button>
                  <button
                    type="button"
                    onClick={handleExport}
                    disabled={exporting || !kpis}
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-secondary text-on-secondary rounded-xl font-semibold text-xs sm:text-sm hover:bg-secondary/90 transition-all disabled:opacity-50 shadow-xs"
                  >
                    <span className="material-symbols-outlined text-[17px]">
                      {exporting ? 'sync' : 'download'}
                    </span>
                    {exporting ? 'Export…' : 'Excel'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {error && (
        <div className="mb-4 p-3.5 bg-error-container text-on-error-container text-sm rounded-2xl flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">warning</span>
          {error}
        </div>
      )}

      {showReport && (
        <div className="mb-6">
          <AIReportPanel
            report={report}
            loading={reportLoading}
            error={reportError}
            onClose={() => setShowReport(false)}
            onRefresh={() => loadReport(false)}
          />
        </div>
      )}

      {/* ── Demandes de compte en attente (prioritaire si > 0) ───────────── */}
      {pendingAccounts.length > 0 && (
        <div
          className="dash-enter bg-surface-container-lowest rounded-3xl p-5 border border-amber-400/50 mb-6"
          style={{ boxShadow: '0 8px 24px rgba(245,158,11,0.12)' }}
        >
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-600" style={{ fontSize: 20 }}>pending_actions</span>
              <h2 className="font-sora font-bold text-primary text-base">Demandes de compte en attente</h2>
              <span className="flex h-5 px-2 items-center justify-center rounded-full text-xs font-bold text-white bg-amber-600 animate-pulse">
                {pendingAccounts.length}
              </span>
            </div>
            <Link to="/admin/clients" className="text-xs font-bold text-secondary hover:underline">
              Voir clients →
            </Link>
          </div>
          <div className="divide-y divide-outline-variant/10">
            {pendingAccounts.map((p) => {
              const isActing = approvingId === p.id;
              return (
                <div key={p.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 font-bold text-sm text-white"
                      style={{ background: 'linear-gradient(135deg, #d97706, #f59e0b)' }}
                    >
                      {getInitials(p.prenom, p.nom)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-primary text-sm truncate">{p.prenom} {p.nom}</p>
                      <p className="text-xs text-on-surface-variant truncate">{p.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleAccountAction(p.id, 'reject')}
                      disabled={isActing}
                      className="px-3 py-1.5 rounded-xl border border-red-500/30 text-red-600 text-xs font-semibold hover:bg-red-500/10 disabled:opacity-50"
                    >
                      Rejeter
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAccountAction(p.id, 'approve')}
                      disabled={isActing}
                      className="px-3.5 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {isActing ? 'En cours…' : 'Approuver'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 2. Grille KPIs Cliquables (4 × 2, sans Occupation moyenne) ───── */}
      <section aria-label="Indicateurs clés" className="mb-6 space-y-3">
        <div key={`k1-${period}`} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
          <StatCard
            delayMs={0}
            label="CA — période"
            rawValue={ca.periode ?? 0}
            decimals={3}
            suffix=" DT"
            sub={`${ca.transactions ?? 0} transactions · ${label}`}
            badge={typeof k.caMoisPrecedent === 'number' ? `Mois préc. : ${formatDTMillimes(k.caMoisPrecedent)}` : null}
            trend={caTrend}
            icon="payments"
            accent="#2fbe8f"
            to="/admin/payments"
          />
          <StatCard
            delayMs={60}
            label="Nouveaux membres"
            rawValue={membres.periode ?? 0}
            sub={`${k.membresActifs ?? 0} membres actifs au total`}
            trend={membersTrend}
            icon="group"
            accent="#f95d00"
            to="/admin/clients"
          />
          <StatCard
            delayMs={120}
            label="Réservations — période"
            rawValue={reservationsPeriode.count ?? 0}
            sub={`${k.reservationsDuJour ?? 0} aujourd'hui · ${reservationsPeriode.confirmed ?? 0} confirmées`}
            icon="event_available"
            accent="#8b5cf6"
            to="/admin/reservations"
          />
          <StatCard
            delayMs={180}
            label="Paiements en attente"
            rawValue={k.paiementsEnAttente?.montantTotal ?? 0}
            decimals={3}
            suffix=" DT"
            sub={`${k.paiementsEnAttente?.count ?? 0} encaissement(s) sur place`}
            icon="pending_actions"
            accent="#ba1a1a"
            pulse={(k.paiementsEnAttente?.count ?? 0) > 0}
            to="/admin/payments"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
          <StatCard
            delayMs={240}
            label="Sessions de travail actives"
            rawValue={activeSessionsCount}
            sub="Voir sur le Plan 2D en direct"
            icon="timer"
            accent="#f59e0b"
            pulse={activeSessionsCount > 0}
            to="/admin/agenda?view=plan"
          />
          {k.module_formations_actif !== false && (
            <StatCard
              delayMs={300}
              label="Formations — période"
              rawValue={k.formationsPeriode ?? 0}
              sub={`${k.formationsDuJour ?? 0} prévue(s) aujourd'hui`}
              icon="school"
              accent="#8b5cf6"
              to="/admin/formations"
            />
          )}
          <StatCard
            delayMs={360}
            label="Réservations invités"
            rawValue={guestsPeriode.length}
            sub={`${guests.length} invité(s) au total · ${label}`}
            icon="person_add_alt"
            accent="#f95d00"
            pulse={guestsPeriode.some((g) => g.reservations?.[0]?.statut === 'pending')}
            to="/admin/reservations"
          />
          <StatCard
            delayMs={420}
            label="Abonnements expirant"
            rawValue={k.abonnementsExpirant ?? 0}
            sub="Dans les 7 prochains jours"
            icon="card_membership"
            accent={(k.abonnementsExpirant ?? 0) > 0 ? '#ba1a1a' : '#2fbe8f'}
            pulse={(k.abonnementsExpirant ?? 0) > 0}
            to="/admin/abonnements"
          />
        </div>
      </section>

      {/* ── 3. HAUT DE PAGE : Prochaines réservations + Activité récente + Suivi formations ── */}
      <section aria-label="Pilotage prioritaire" className="space-y-4 mb-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Prochaines réservations (onglets À venir / Aujourd'hui) */}
          <div
            className="dash-enter lg:col-span-7 bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15 flex flex-col"
            style={{ boxShadow: cardShadow, animationDelay: '120ms' }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2.5">
                <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-[rgba(249,93,0,0.12)] text-[#f95d00]">
                  <span className="material-symbols-outlined" style={{ fontSize: 19 }}>upcoming</span>
                </span>
                <div>
                  <h2 className="font-sora font-bold text-primary text-base">Prochaines réservations</h2>
                  <p className="text-xs text-on-surface-variant">
                    {bookingTab === 'upcoming'
                      ? `${prochainesReservations.length} dans les 7 prochains jours`
                      : `${calendrierDuJour.length} prévue(s) aujourd'hui`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-xl border border-outline-variant/20 bg-surface-container-low p-0.5 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => setBookingTab('upcoming')}
                    className={`px-2.5 py-1 rounded-lg transition-all ${
                      bookingTab === 'upcoming' ? 'bg-secondary text-white shadow-2xs' : 'text-on-surface-variant hover:text-primary'
                    }`}
                  >
                    À venir ({prochainesReservations.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setBookingTab('today')}
                    className={`px-2.5 py-1 rounded-lg transition-all ${
                      bookingTab === 'today' ? 'bg-secondary text-white shadow-2xs' : 'text-on-surface-variant hover:text-primary'
                    }`}
                  >
                    Aujourd&apos;hui ({calendrierDuJour.length})
                  </button>
                </div>
                <Link
                  to="/admin/reservations"
                  className="text-xs font-bold text-secondary hover:underline whitespace-nowrap"
                >
                  Gérer →
                </Link>
              </div>
            </div>

            {visibleReservations.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-8 text-center">
                <span className="material-symbols-outlined text-[40px] text-on-surface-variant/35 mb-2">event_available</span>
                <p className="text-sm text-on-surface-variant">
                  {bookingTab === 'today' ? "Aucune réservation prévue aujourd'hui" : 'Aucune réservation à venir'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-outline-variant/10 max-h-[300px] overflow-y-auto pr-1">
                {visibleReservations.map((r, idx) => {
                  const clientName = r.profiles
                    ? `${r.profiles.prenom || ''} ${r.profiles.nom || ''}`.trim()
                    : (r.guest_nom || 'Client');
                  const isConfirmed = r.statut === 'confirmed';
                  return (
                    <div
                      key={r.id || idx}
                      className="py-2.5 px-2 rounded-xl hover:bg-surface-container-low/60 transition-colors flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0 font-bold text-xs text-white"
                          style={{ background: CHART_COLORS[idx % CHART_COLORS.length] }}
                        >
                          {getInitials(r.profiles?.prenom || clientName, r.profiles?.nom || '')}
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold text-primary text-sm truncate">{clientName}</p>
                          <p className="text-xs text-on-surface-variant truncate">
                            {r.espaces?.nom || 'Espace'} · {formatTimeShort(r.date_debut)} → {formatTimeShort(r.date_fin)}
                          </p>
                        </div>
                      </div>

                      <div className="text-right shrink-0 flex flex-col items-end gap-1">
                        <span className="text-xs font-bold text-primary">
                          {formatDateShort(r.date_debut)}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase ${
                            isConfirmed
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                          }`}
                        >
                          {isConfirmed ? 'Confirmée' : 'En attente'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Activité récente */}
          <div
            className="dash-enter lg:col-span-5 bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15 flex flex-col"
            style={{ boxShadow: cardShadow, animationDelay: '180ms' }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-[rgba(249,93,0,0.11)] text-[#f95d00]">
                  <span className="material-symbols-outlined" style={{ fontSize: 19 }}>bolt</span>
                </span>
                <div>
                  <h2 className="font-sora font-bold text-primary text-base">Activité récente</h2>
                  <p className="text-xs text-on-surface-variant">Flux en direct de l&apos;établissement</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/12 text-emerald-600 text-xs font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </span>
            </div>

            {activiteRecente.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-8 text-center">
                <span className="material-symbols-outlined text-[40px] text-on-surface-variant/35 mb-2">history</span>
                <p className="text-sm text-on-surface-variant">Aucune activité récente</p>
              </div>
            ) : (
              <div className="relative pl-4 space-y-2.5 max-h-[300px] overflow-y-auto pr-1 before:content-[''] before:absolute before:left-[19px] before:top-2 before:bottom-2 before:w-px before:bg-outline-variant/25">
                {activiteRecente.map((a, idx) => {
                  const meta = a.type === 'paiement'
                    ? { icon: 'payments', bg: 'bg-emerald-500/15', color: 'text-emerald-600' }
                    : a.type === 'session'
                      ? { icon: 'login', bg: 'bg-amber-500/15', color: 'text-amber-600' }
                      : { icon: 'event_available', bg: 'bg-violet-500/15', color: 'text-violet-600' };
                  return (
                    <div
                      key={a.id || idx}
                      className="relative flex items-start gap-3 p-2 rounded-xl hover:bg-surface-container-low/60 transition-colors"
                    >
                      <span className={`relative z-10 flex items-center justify-center w-8 h-8 rounded-xl shrink-0 ${meta.bg} ${meta.color}`}>
                        <span className="material-symbols-outlined" style={{ fontSize: 15 }}>{meta.icon}</span>
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-primary font-medium leading-snug">{a.text}</p>
                        <p className="text-xs text-on-surface-variant mt-0.5">{relTime(a.time)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Suivi des formations programmées (en haut) — masqué si module désactivé */}
        {k.module_formations_actif !== false && (
        <div
          className="dash-enter bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15"
          style={{ boxShadow: cardShadow, animationDelay: '220ms' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2.5">
              <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-[rgba(139,92,246,0.12)] text-[#8b5cf6]">
                <span className="material-symbols-outlined" style={{ fontSize: 19 }}>school</span>
              </span>
              <div>
                <h2 className="font-sora font-bold text-primary text-base">Suivi des formations programmées</h2>
                <p className="text-xs text-on-surface-variant">
                  {visibleFormations.length} formation(s) · {formationTab === 'today' ? "Aujourd'hui" : label}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-xl border border-outline-variant/20 bg-surface-container-low p-0.5 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setFormationTab('period')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${
                    formationTab === 'period' ? 'bg-[#8b5cf6] text-white shadow-2xs' : 'text-on-surface-variant hover:text-primary'
                  }`}
                >
                  Période ({formationsPeriode.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFormationTab('today')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${
                    formationTab === 'today' ? 'bg-[#8b5cf6] text-white shadow-2xs' : 'text-on-surface-variant hover:text-primary'
                  }`}
                >
                  Aujourd&apos;hui ({formationsDuJourList.length})
                </button>
              </div>
              <Link to="/admin/formations" className="text-xs font-bold text-secondary hover:underline whitespace-nowrap">
                Gérer →
              </Link>
            </div>
          </div>

          {visibleFormations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-7 text-center">
              <span className="material-symbols-outlined text-[38px] text-on-surface-variant/35 mb-2">school</span>
              <p className="text-sm text-on-surface-variant">
                {formationTab === 'today'
                  ? "Aucune formation prévue aujourd'hui"
                  : 'Aucune formation programmée dans cette période'}
              </p>
            </div>
          ) : (
            <div className="table-responsive-wrapper">
              <table className="w-full min-w-[650px] text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-outline-variant/15">
                    <th className="pb-2.5 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Formation</th>
                    <th className="pb-2.5 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Formateur</th>
                    <th className="pb-2.5 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Date &amp; Heure</th>
                    <th className="pb-2.5 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Salle</th>
                    <th className="pb-2.5 text-xs font-bold uppercase tracking-wider text-on-surface-variant text-center">Remplissage</th>
                    <th className="pb-2.5 text-xs font-bold uppercase tracking-wider text-on-surface-variant text-right">Tarif</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {visibleFormations.slice(0, 6).map((f) => {
                    const formateurName = f.profiles ? `${f.profiles.prenom || ''} ${f.profiles.nom || ''}`.trim() : '—';
                    const fillPct = f.capacite_max > 0 ? Math.min(100, Math.round(((f.nb_inscrits || 0) / f.capacite_max) * 100)) : 0;
                    const barColor = fillPct >= 90 ? 'bg-red-500' : fillPct >= 60 ? 'bg-amber-500' : 'bg-emerald-500';
                    const isFree = Number(f.prix_inscription || 0) <= 0;

                    return (
                      <tr key={f.id} className="hover:bg-surface-container-low/40 transition-colors">
                        <td className="py-3 font-semibold text-primary">{f.titre}</td>
                        <td className="py-3 text-on-surface-variant">
                          <div>{formateurName}</div>
                          {f.profiles?.specialite && (
                            <div className="text-xs text-on-surface-variant/70">{f.profiles.specialite}</div>
                          )}
                        </td>
                        <td className="py-3 text-on-surface-variant">
                          <div className="font-medium text-primary">{formatDateShort(f.date_debut)}</div>
                          <div className="text-xs text-on-surface-variant/75">{formatTimeShort(f.date_debut)}</div>
                        </td>
                        <td className="py-3 text-on-surface-variant">{f.espaces?.nom || '—'}</td>
                        <td className="py-3">
                          <div className="flex flex-col items-center justify-center min-w-[110px]">
                            <div className="flex items-center justify-between w-full text-xs mb-1">
                              <span className="font-semibold text-on-surface-variant">{f.nb_inscrits ?? 0} / {f.capacite_max ?? 0}</span>
                              <span className="font-bold text-primary">{fillPct}%</span>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-outline-variant/15 overflow-hidden">
                              <div className={`dash-bar-grow h-full rounded-full ${barColor}`} style={{ width: `${fillPct}%` }} />
                            </div>
                          </div>
                        </td>
                        <td className="py-3 text-right font-bold text-secondary">
                          {!isFree
                            ? formatDTMillimes(f.prix_inscription)
                            : (f.est_gratuit || f.programme?.includes('[SESSION_GRATUITE]'))
                              ? 'Gratuit'
                              : <span className="text-on-surface-variant/60 font-medium italic">Non défini</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}
      </section>

      {/* ── 4. Sessions de travail en cours + Actions rapides ────────────── */}
      <section aria-label="Sessions en direct et actions" className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
        <div
          className="dash-enter lg:col-span-8 bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15"
          style={{ boxShadow: cardShadow }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2.5">
              <h2 className="font-sora font-bold text-primary text-base">Sessions de travail en cours</h2>
              {liveSessions.length > 0 && (
                <span className="flex h-2.5 w-2.5 relative">
                  <span className="animate-ping absolute inline-flex h-2.5 w-2.5 rounded-full bg-[#f95d00] opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#f95d00]" />
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-on-surface-variant font-medium hidden sm:inline">
                Minuteur temps réel · Libération manuelle obligatoire
              </span>
              <Link
                to="/admin/agenda?view=plan"
                className="text-xs font-bold text-secondary hover:underline whitespace-nowrap flex items-center gap-1"
              >
                Plan 2D en direct →
              </Link>
            </div>
          </div>

          {sessionActionMsg && (
            <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 flex items-center justify-between">
              <span>{sessionActionMsg}</span>
              <button type="button" onClick={() => setSessionActionMsg('')} className="ml-2 hover:underline">Fermer</button>
            </div>
          )}

          {liveSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-9 text-center">
              <span className="material-symbols-outlined text-[42px] text-on-surface-variant/35 mb-2">timer_off</span>
              <p className="text-sm text-on-surface-variant">Aucune session de travail active ou imminente en ce moment</p>
            </div>
          ) : (
            <div className="divide-y divide-outline-variant/10 max-h-[320px] overflow-y-auto">
              {liveSessions.map((s) => (
                <LiveSessionClockRow
                  key={s.id}
                  s={s}
                  releasingId={releasingId}
                  onStart={handleStartUpcomingSession}
                  onRelease={handleReleaseSession}
                />
              ))}
            </div>
          )}
        </div>

        {/* Actions rapides */}
        <div
          className="dash-enter lg:col-span-4 bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15 flex flex-col justify-between"
          style={{ boxShadow: cardShadow }}
        >
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-sora font-bold text-primary text-base">Actions rapides</h2>
              <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 19 }}>bolt</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2.5">
              <button
                type="button"
                onClick={() => navigate('/admin/reservations?new=1')}
                className="flex items-center justify-between gap-3 w-full px-3.5 py-2.5 rounded-2xl bg-[#f95d00] text-white font-semibold text-sm hover:bg-[#e55500] transition-all hover:-translate-y-0.5 shadow-sm"
              >
                <span className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined" style={{ fontSize: 19 }}>add_circle</span>
                  Nouvelle réservation
                </span>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_forward</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/admin/agenda?view=plan')}
                className="flex items-center justify-between gap-3 w-full px-3.5 py-2.5 rounded-2xl bg-surface-container-low text-primary font-semibold text-sm hover:bg-surface-container transition-all hover:-translate-y-0.5 border border-outline-variant/15"
              >
                <span className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 19 }}>map</span>
                  Plan 2D en direct
                </span>
                <span className="material-symbols-outlined opacity-40" style={{ fontSize: 16 }}>arrow_forward</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/admin/agenda')}
                className="flex items-center justify-between gap-3 w-full px-3.5 py-2.5 rounded-2xl bg-surface-container-low text-primary font-semibold text-sm hover:bg-surface-container transition-all hover:-translate-y-0.5 border border-outline-variant/15"
              >
                <span className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[#2fbe8f]" style={{ fontSize: 19 }}>qr_code_scanner</span>
                  Check-in &amp; Agenda
                </span>
                <span className="material-symbols-outlined opacity-40" style={{ fontSize: 16 }}>arrow_forward</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/admin/clients?new=1')}
                className="flex items-center justify-between gap-3 w-full px-3.5 py-2.5 rounded-2xl bg-surface-container-low text-primary font-semibold text-sm hover:bg-surface-container transition-all hover:-translate-y-0.5 border border-outline-variant/15"
              >
                <span className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 19 }}>person_add</span>
                  Nouveau membre
                </span>
                <span className="material-symbols-outlined opacity-40" style={{ fontSize: 16 }}>arrow_forward</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/admin/payments')}
                className="flex items-center justify-between gap-3 w-full px-3.5 py-2.5 rounded-2xl bg-surface-container-low text-primary font-semibold text-sm hover:bg-surface-container transition-all hover:-translate-y-0.5 border border-outline-variant/15"
              >
                <span className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[#8b5cf6]" style={{ fontSize: 19 }}>payments</span>
                  Encaisser un paiement
                </span>
                <span className="material-symbols-outlined opacity-40" style={{ fontSize: 16 }}>arrow_forward</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── 5. JUSTE APRÈS LES SESSIONS : Réservations invités ──── */}
      <section
        aria-label="Réservations invités"
        className="dash-enter bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/25 mb-6"
        style={{ boxShadow: cardShadow }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-[rgba(249,93,0,0.12)] text-[#f95d00]">
              <span className="material-symbols-outlined" style={{ fontSize: 19 }}>person_add_alt</span>
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-sora font-bold text-primary text-base">Réservations invités</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-secondary text-white">
                  {displayedGuests.length}
                </span>
              </div>
              <p className="text-xs text-on-surface-variant">
                Visiteurs sans compte ayant réservé en ligne · {guestScope === 'period' ? label : 'Tout l’historique'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl border border-outline-variant/20 bg-surface-container-low p-0.5 text-xs font-bold">
              <button
                type="button"
                onClick={() => setGuestScope('period')}
                className="px-2.5 py-1 rounded-lg transition-all"
                style={guestScope === 'period' ? { backgroundColor: '#f95d00', color: '#ffffff' } : undefined}
              >
                Période ({guestsPeriode.length})
              </button>
              <button
                type="button"
                onClick={() => setGuestScope('all')}
                className="px-2.5 py-1 rounded-lg transition-all"
                style={guestScope === 'all' ? { backgroundColor: '#f95d00', color: '#ffffff' } : undefined}
              >
                Tous ({guests.length})
              </button>
            </div>

            <div className="inline-flex rounded-xl border border-outline-variant/20 bg-surface-container-low p-0.5 text-xs font-bold">
              {[
                { id: 'all', label: 'Tous' },
                { id: 'pending', label: 'En attente' },
                { id: 'confirmed', label: 'Confirmées' },
              ].map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setGuestStatusFilter(st.id)}
                  className="px-2.5 py-1 rounded-lg transition-all"
                  style={guestStatusFilter === st.id ? { backgroundColor: '#f95d00', color: '#ffffff' } : undefined}
                >
                  {st.label}
                </button>
              ))}
            </div>

            <Link to="/admin/reservations" className="text-xs font-bold text-secondary hover:underline whitespace-nowrap">
              Voir les réservations →
            </Link>
          </div>
        </div>

        {displayedGuests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-7 text-center">
            <span className="material-symbols-outlined text-[38px] text-on-surface-variant/35 mb-2">group_off</span>
            <p className="text-sm text-on-surface-variant">Aucune réservation invité pour ce filtre.</p>
          </div>
        ) : (
          <div className="table-responsive-wrapper">
            <table className="w-full min-w-[650px] text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-outline-variant/15">
                  <th className="pb-2.5 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Invité(e)</th>
                  <th className="pb-2.5 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Contact</th>
                  <th className="pb-2.5 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Espace réservé</th>
                  <th className="pb-2.5 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Créneau</th>
                  <th className="pb-2.5 text-xs font-bold uppercase tracking-wider text-on-surface-variant text-right">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {displayedGuests.slice(0, 10).map((g, idx) => {
                  const res = g.reservations?.[0];
                  const statut = res?.statut;
                  return (
                    <tr key={g.id} className="hover:bg-surface-container-low/40 transition-colors">
                      <td className="py-3">
                        <div className="flex items-center gap-2.5">
                          <span
                            className="flex items-center justify-center w-9 h-9 rounded-xl font-bold text-xs text-white shrink-0"
                            style={{ background: CHART_COLORS[idx % CHART_COLORS.length] }}
                          >
                            {getInitials(g.prenom, g.nom, '?')}
                          </span>
                          <span className="font-semibold text-primary">{g.prenom} {g.nom}</span>
                        </div>
                      </td>
                      <td className="py-3 text-on-surface-variant">
                        <div className="truncate max-w-[220px]">{g.email}</div>
                        {g.telephone && <div className="text-xs text-on-surface-variant/75">{g.telephone}</div>}
                      </td>
                      <td className="py-3 text-on-surface-variant font-medium">{res?.espaces?.nom || '—'}</td>
                      <td className="py-3 text-on-surface-variant">
                        {res?.date_debut ? (
                          <div>
                            <div className="font-medium text-primary">{formatDateShort(res.date_debut)}</div>
                            <div className="text-xs opacity-75">
                              {formatTimeShort(res.date_debut)} → {formatTimeShort(res.date_fin)}
                            </div>
                          </div>
                        ) : '—'}
                      </td>
                      <td className="py-3 text-right">
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-tight ${
                            statut === 'confirmed'
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : statut === 'pending'
                                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                : statut === 'cancelled'
                                  ? 'bg-red-500/15 text-red-700 dark:text-red-300'
                                  : 'bg-slate-500/15 text-slate-600'
                          }`}
                        >
                          {statut === 'confirmed'
                            ? 'Confirmée'
                            : statut === 'pending'
                              ? 'En attente'
                              : statut === 'cancelled'
                                ? 'Annulée'
                                : '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── 6. Analytique & Performance (sans Occupation moyenne) ─────────── */}
      <section aria-label="Analytique et performance" className="space-y-4 mb-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Évolution des revenus */}
          <div
            className="dash-enter lg:col-span-7 bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15"
            style={{ boxShadow: cardShadow }}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-sora font-bold text-primary text-base">Évolution des revenus</h2>
                <p className="text-xs text-on-surface-variant">{bucketCaption}</p>
              </div>
              <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-[rgba(47,190,143,0.12)]">
                <span className="material-symbols-outlined text-[#2fbe8f]" style={{ fontSize: 18 }}>trending_up</span>
              </span>
            </div>
            {revenueChart.length > 0 ? (
              <ResponsiveContainer width="100%" height={230}>
                <ComposedChart data={revenueChart} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revBar" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2fbe8f" stopOpacity={0.92} />
                      <stop offset="95%" stopColor="#2fbe8f" stopOpacity={0.22} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'} />
                  <XAxis dataKey="mois" tick={{ fontSize: 12, fill: dark ? '#a3a09b' : '#64748b' }} />
                  <YAxis yAxisId="ca" tick={{ fontSize: 12, fill: dark ? '#a3a09b' : '#64748b' }} tickFormatter={(v) => `${v} DT`} width={72} />
                  <YAxis yAxisId="tx" orientation="right" tick={{ fontSize: 12, fill: '#94a3b8' }} allowDecimals={false} width={30} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    yAxisId="ca"
                    dataKey="ca"
                    name="CA (DT)"
                    fill="url(#revBar)"
                    radius={[6, 6, 0, 0]}
                    isAnimationActive
                    animationDuration={750}
                  />
                  <Line
                    yAxisId="tx"
                    type="monotone"
                    dataKey="transactions"
                    name="Transactions"
                    stroke="#f95d00"
                    strokeWidth={2.4}
                    dot={{ r: 3.5, fill: '#f95d00' }}
                    activeDot={{ r: 5.5 }}
                    isAnimationActive
                    animationDuration={850}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[230px] flex items-center justify-center text-sm text-on-surface-variant">
                Aucune donnée disponible
              </div>
            )}
          </div>

          {/* Donut CA par espace */}
          <div className="lg:col-span-5">
            <DonutBySpace
              data={caParEspace}
              title="CA par espace"
              sub={label}
              totalFormatter={(v) => formatDTMillimes(v)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Réservations par espace */}
          <div
            className="dash-enter lg:col-span-7 bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15"
            style={{ boxShadow: cardShadow }}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-sora font-bold text-primary text-base">Réservations par espace</h2>
                <p className="text-xs text-on-surface-variant">{reservationsParEspace.length} espace(s) · {label}</p>
              </div>
              <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-[rgba(245,158,11,0.12)]">
                <span className="material-symbols-outlined text-[#f59e0b]" style={{ fontSize: 18 }}>chair</span>
              </span>
            </div>
            {reservationsParEspace.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={reservationsParEspace} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'} />
                  <XAxis
                    dataKey="nom"
                    tick={{ fontSize: 12, fill: dark ? '#a3a09b' : '#64748b' }}
                    tickFormatter={(v) => (v.length > 12 ? `${v.slice(0, 12)}…` : v)}
                  />
                  <YAxis tick={{ fontSize: 12, fill: dark ? '#a3a09b' : '#64748b' }} width={32} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    dataKey="confirmed"
                    name="Confirmées"
                    stackId="a"
                    fill="#2fbe8f"
                    radius={[0, 0, 0, 0]}
                    isAnimationActive
                    animationDuration={750}
                  />
                  <Bar
                    dataKey="pending"
                    name="En attente"
                    stackId="a"
                    fill="#f59e0b"
                    radius={[6, 6, 0, 0]}
                    isAnimationActive
                    animationDuration={750}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-sm text-on-surface-variant">
                Aucune donnée disponible
              </div>
            )}
          </div>

          {/* Top membres (CA période) */}
          <div
            className="dash-enter lg:col-span-5 bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15"
            style={{ boxShadow: cardShadow }}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-sora font-bold text-primary text-base">Top membres</h2>
                <p className="text-xs text-on-surface-variant">Par CA · {label}</p>
              </div>
              <Link to="/admin/clients" className="text-xs font-bold text-secondary hover:underline">
                Clients →
              </Link>
            </div>
            {topMembres.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <span className="material-symbols-outlined text-[40px] text-on-surface-variant/35 mb-2">leaderboard</span>
                <p className="text-sm text-on-surface-variant">Aucun paiement enregistré</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {topMembres.map((m, i) => {
                  const medals = ['🥇', '🥈', '🥉'];
                  const maxCa = topMembres[0]?.ca || 1;
                  const pct = Math.max(6, Math.round((m.ca / maxCa) * 100));
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-3 p-2.5 rounded-2xl hover:bg-surface-container-low/60 transition-colors"
                    >
                      <span className="text-lg w-6 text-center shrink-0">{medals[i] || `#${i + 1}`}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-primary text-sm truncate">{m.nom}</p>
                        <div className="h-1.5 rounded-full bg-outline-variant/15 overflow-hidden mt-1.5">
                          <div
                            className="dash-bar-grow h-full rounded-full"
                            style={{ width: `${pct}%`, background: CHART_COLORS[i % CHART_COLORS.length] }}
                          />
                        </div>
                      </div>
                      <span className="font-bold text-[#2fbe8f] text-xs sm:text-sm shrink-0">
                        <Money amount={m.ca} />
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
    </PortalLayout>
  );
}
