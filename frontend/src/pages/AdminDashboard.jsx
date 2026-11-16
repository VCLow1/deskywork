import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { kpiApi, memberApi, tenantAdminApi, guestApi, sessionApi } from '../services/api';
import { formatDT as formatDTMillimes } from '../utils/format';
import PortalLayout from '../components/layout/PortalLayout';
import { getRoleLabel } from '../utils/roles';
import { exportDashboardToExcel } from '../utils/exportDashboardExcel';
import PeriodFilter from '../components/dashboard/PeriodFilter';
import AIReportPanel from '../components/dashboard/AIReportPanel';
import { useSessionUser } from '../hooks/useSessionUser';
import {
  DEFAULT_PERIOD, periodWindow, windowLabel, trendBadge, CHART_COLORS, inWindow,
} from '../utils/dashboardPeriod';
import {
  ComposedChart, LineChart, BarChart, Bar, Line, Area,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';


// ─── Intervalles de rafraîchissement ────────────────────────────────────────
const REFRESH_KPI_MS = 90_000;      // KPIs généraux  : 90s
const REFRESH_SESSIONS_MS = 30_000; // Sessions live  : 30s

// ─── Helpers ────────────────────────────────────────────────────────────────
function formatDT(val) {
  return typeof val === 'number'
    ? val.toLocaleString('fr-TN', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
    : '—';
}

function formatClockSeconds(totalSec) {
  const sec = Math.max(0, Math.floor(totalSec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatTime(minutes) {
  if (minutes == null) return '—';
  if (minutes <= 0) return 'Terminé';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m.toString().padStart(2, '0')}min` : `${m} min`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Bonjour';
  if (h < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

function formatTimeShort(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleTimeString('fr-FR', { timeStyle: 'short' });
}

function relTime(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'à l\'instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `il y a ${d}j`;
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

// ─── Composant StatCard PowerBI ─────────────────────────────────────────────
function StatCard({ label, value, sub, icon, accent = '#f95d00', to, badge, pulse, trend }) {
  const bg = accent === '#2fbe8f' ? 'rgba(47,190,143,0.1)'
    : accent === '#ba1a1a' ? 'rgba(186,26,26,0.09)'
      : accent === '#f59e0b' ? 'rgba(245,158,11,0.1)'
        : accent === '#8b5cf6' ? 'rgba(139,92,246,0.1)'
          : accent === '#0ea5e9' ? 'rgba(14,165,233,0.09)'
            : 'rgba(249,93,0,0.09)';

  const trendColor = trend?.dir === 'up' ? '#2fbe8f' : trend?.dir === 'down' ? '#ba1a1a' : '#64748b';

  const inner = (
    <div
      className="bg-surface-container-lowest rounded-3xl border border-outline-variant/10 h-full transition-all duration-300 hover:-translate-y-1 relative overflow-hidden group"
      style={{ padding: '18px 20px', boxShadow: '0 4px 16px rgba(16,35,63,0.06)' }}
    >
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }} />
      {pulse && (
        <span className="absolute top-3 right-3 flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: accent }} />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: accent }} />
        </span>
      )}
      <div className="flex items-center gap-2.5 mb-2.5">
        <span className="flex items-center justify-center w-8 h-8 rounded-xl shrink-0 group-hover:scale-110 transition-transform"
          style={{ background: bg, color: accent }}>
          <span className="material-symbols-outlined" style={{ fontSize: 17 }}>{icon}</span>
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant leading-tight">{label}</span>
      </div>
      <p className="font-sora font-bold text-primary" style={{ fontSize: 22 }}>{value}</p>
      {trend && (
        <p className="text-[11px] font-bold mt-1 flex items-center gap-1" style={{ color: trendColor }}>
          {trend.text}
        </p>
      )}
      {sub && <p className="text-[11px] text-on-surface-variant mt-1 font-medium">{sub}</p>}
      {badge != null && (
        <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold"
          style={{ background: bg, color: accent }}>
          {badge}
        </span>
      )}
    </div>
  );

  return to
    ? <Link to={to} className="block no-underline hover:no-underline h-full">{inner}</Link>
    : inner;
}

// ─── Tooltip personnalisé Recharts ───────────────────────────────────────────
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-outline-variant/20 rounded-xl px-3 py-2 shadow-lg text-xs">
      <p className="font-bold text-primary mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>
          {p.name} : <strong>{typeof p.value === 'number' ? p.value.toLocaleString('fr-FR') : p.value}</strong>
          {p.name === 'CA (DT)' || p.name === 'CA' ? ' DT' : p.name === 'Occupation (%)' || p.name === 'taux' ? '%' : ''}
        </p>
      ))}
    </div>
  );
}

// ─── Petit donut réutilisable ────────────────────────────────────────────────
function DonutBySpace({ data, title, sub, totalFormatter }) {
  const total = (data || []).reduce((s, d) => s + (d.value || 0), 0);
  return (
    <div className="bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/10"
      style={{ boxShadow: '0 4px 16px rgba(16,35,63,0.06)' }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-sora font-bold text-primary text-base">{title}</h2>
          <p className="text-xs text-on-surface-variant">{sub}</p>
        </div>
        <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-[rgba(139,92,246,0.1)]">
          <span className="material-symbols-outlined text-[#8b5cf6]" style={{ fontSize: 17 }}>donut_small</span>
        </span>
      </div>
      {data && data.length > 0 ? (
        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative w-[150px] h-[150px] shrink-0 mx-auto">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
                  innerRadius={48} outerRadius={70} paddingAngle={2} cornerRadius={4} stroke="none"
                  isAnimationActive={false}>
                  {data.map((d, i) => <Cell key={d.name ?? i} fill={d.color} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="font-sora font-bold text-primary text-lg leading-none">{totalFormatter ? totalFormatter(total) : total}</span>
              <span className="text-[9px] text-on-surface-variant font-medium mt-0.5">Total</span>
            </div>
          </div>
          <div className="flex-1 min-w-[140px]">
            {data.map((d) => {
              const p = total > 0 ? Math.round((d.value / total) * 100) : 0;
              return (
                <div key={d.name} className="flex items-center gap-2 py-1">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                  <span className="text-xs text-on-surface-variant truncate flex-1">{d.name}</span>
                  <span className="text-[10px] font-bold text-on-surface-variant/70">{p}%</span>
                </div>
              );
            })}
            {data.length === 0 && <p className="text-xs text-on-surface-variant">Aucune donnée</p>}
          </div>
        </div>
      ) : (
        <div className="h-[150px] flex items-center justify-center text-sm text-on-surface-variant">
          Aucune donnée disponible
        </div>
      )}
    </div>
  );
}

// ─── Ligne session live isolée (minuteur 1s local pour éviter de re-render tout le dashboard) ─
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
    ? Math.max(0, Math.floor((s.seconds_remaining || 0)))
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
      ? { txt: 'En dépassement', cls: 'bg-red-100 text-red-800 border-red-200' }
      : isSoon
        ? { txt: 'Bientôt terminée - 15 min', cls: 'bg-amber-100 text-amber-800 border-amber-200' }
        : { txt: 'En cours', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' };

  return (
    <div className="py-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <span className={`flex items-center justify-center w-9 h-9 rounded-xl shrink-0 ${
          isOvertime ? 'bg-red-50 text-red-600' : isSoon ? 'bg-amber-50 text-amber-600' : isUpcoming ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-600'
        }`}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            {isOvertime ? 'warning' : 'timer'}
          </span>
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-primary text-sm truncate">{s.membre}</p>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badgeCfg.cls}`}>
              {badgeCfg.txt}
            </span>
          </div>
          <p className="text-xs text-on-surface-variant truncate">
            {s.espace_nom || s.reservations?.espaces?.nom || 'Espace'} ·{' '}
            {isUpcoming
              ? `Prévu ${s.reservations?.date_debut ? new Date(s.reservations.date_debut).toLocaleTimeString('fr-TN', { hour: '2-digit', minute: '2-digit' }) : '—'}`
              : `Check-in ${s.check_in ? new Date(s.check_in).toLocaleTimeString('fr-TN', { hour: '2-digit', minute: '2-digit' }) : '—'}`}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 ml-auto shrink-0">
        <div className="text-right">
          <p className={`font-mono text-sm font-bold ${isOvertime ? 'text-red-600' : isSoon ? 'text-amber-600' : 'text-emerald-700'}`}>
            {isOvertime ? `+${formatClockSeconds(Math.abs(diffSec))}` : formatClockSeconds(diffSec)}
          </p>
          {isOvertime && (
            <p className="text-[11px] font-bold text-red-700">
              Surplus : {formatDTMillimes(overtimeCost)}
            </p>
          )}
        </div>

        {isUpcoming ? (
          <button
            type="button"
            onClick={() => onStart(s.reservation_id)}
            disabled={releasingId === s.reservation_id}
            className="px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition disabled:opacity-50"
          >
            Démarrer
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onRelease(s.id)}
            disabled={releasingId === s.id}
            className="px-3 py-1.5 rounded-xl bg-[#f95d00] text-white text-xs font-bold hover:bg-[#e55500] shadow-xs transition disabled:opacity-50"
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

  const periodRef = useRef(period);
  periodRef.current = period;

  const showReportRef = useRef(showReport);
  showReportRef.current = showReport;

  const kpiTimerRef = useRef(null);
  const sessionTimerRef = useRef(null);

  // ── Fetch KPIs (silent = pas de spinner) ──────────────────────────────────
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

  // ── Rapport IA (généré selon la période active) ──────────────────────────
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

  const toggleReport = () => {
    const next = !showReport;
    setShowReport(next);
    if (next) loadReport(false);
  };

  // ── Refresh sélectif (sessions uniquement, rapide — sans requêtes KPI lourdes) ──
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

  // ── Effet principal : chargement profil + auto-refresh (déclenché par userId uniquement) ──
  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;

    // Profil Supabase DB en arrière-plan (sans requête duplicate sur tenants)
    supabase.from('profiles').select('*').eq('id', userId).single()
      .then(({ data, error: e }) => {
        if (cancelled || e || !data) return;
        setProfile(data);
      }).catch(() => {});

    fetchKpis(false);

    // Données secondaires en parallèle (Mon Coworking + vérification onboarding + Invités)
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


  // ── Changement de période : recharge silencieuse (pas de spinner) ─────────
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    fetchKpis(true);
  }, [period, fetchKpis]);

  // ── Rapport IA : rechargé si ouvert lors d'un changement de période ───────
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
      setPendingAccounts(prev => prev.filter(p => p.id !== id));
    } catch (e) {
      alert('Erreur : ' + e.message);
    } finally {
      setApprovingId(null);
    }
  };

  if (loading) {
    return (
      <PortalLayout profile={profile}>
        <div className="space-y-6 animate-pulse">
          <div className="h-10 bg-gray-200 rounded-2xl w-64" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1,2,3,4].map(i => (
              <div key={i} className="bg-white rounded-3xl p-5 border border-outline-variant/20 h-28" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-white rounded-3xl h-48 border border-outline-variant/20" />
            <div className="bg-white rounded-3xl h-48 border border-outline-variant/20" />
            <div className="bg-white rounded-3xl h-48 border border-outline-variant/20" />
          </div>
        </div>
      </PortalLayout>
    );
  }

  // ── Dérivés ────────────────────────────────────────────────────────────────
  const k = kpis || {};
  const ca = (k.chiffreAffaires || {});
  const membres = (k.nouveauxMembres || {});
  const sessions = Array.isArray(k.sessionsEnCours) ? k.sessionsEnCours : [];
  const topMembres = Array.isArray(k.topMembres) ? k.topMembres : [];
  const tauxOccupation = Array.isArray(k.tauxOccupation) ? k.tauxOccupation : [];
  const calendrierDuJour = Array.isArray(k.calendrierDuJour) ? k.calendrierDuJour : [];
  const prochainesReservations = Array.isArray(k.prochainesReservations) ? k.prochainesReservations : [];
  const formationsDuJourList = Array.isArray(k.formationsDuJourList) ? k.formationsDuJourList : [];
  const activiteRecente = Array.isArray(k.activiteRecente) ? k.activiteRecente : [];
  const reservationsPeriode = k.reservationsPeriode || { count: 0, confirmed: 0, pending: 0 };

  const revenueChart = Array.isArray(chart?.revenueChart) ? chart.revenueChart : [];
  const occupationChart = Array.isArray(chart?.occupationChart) ? chart.occupationChart : [];
  const caParEspace = Array.isArray(chart?.caParEspace)
    ? chart.caParEspace.map((d) => ({ ...d, value: d.ca ?? 0, color: CHART_COLORS[chart.caParEspace.indexOf(d) % CHART_COLORS.length] }))
    : [];
  const reservationsParEspace = Array.isArray(chart?.reservationsParEspace) ? chart.reservationsParEspace : [];

  const win = periodWindow(period);
  const label = windowLabel(period);
  const pStr = typeof period === 'string' ? period : (period?.key || 'mois');
  const bucketCaption = pStr.startsWith('jour')
    ? `Par heure · ${label}`
    : (pStr.startsWith('mois') || pStr.startsWith('semaine') || pStr.startsWith('custom'))
    ? `Par jour · ${label}`
    : (pStr.startsWith('annee') || pStr.startsWith('trimestre'))
    ? `Par mois · ${label}`
    : `Par année · historique`;

  const membersTrend = trendBadge(membres.periode || 0, membres.periodePrecedente || 0);

  const occupationMoyen = typeof k.occupationMoyen === 'number' ? k.occupationMoyen
    : (tauxOccupation.length > 0 ? Math.round(tauxOccupation.reduce((s, e) => s + (e.taux || 0), 0) / tauxOccupation.length) : 0);

  const topEspace = tauxOccupation.length > 0
    ? tauxOccupation.reduce((a, b) => ((b.taux || 0) > (a.taux || 0) ? b : a), tauxOccupation[0])
    : null;

  const formationsPeriode = formations.filter((f) => inWindow(f.date_debut, win));
  const guestsPeriode = guests.filter((g) => inWindow(g.created_at, win));

  const welcomeText = greeting();

  return (
    <PortalLayout profile={profile} onLogout={handleLogout}>

      {/* ── En-tête + filtre global ─────────────────────────────────────── */}
      <header className="mb-6 space-y-3">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="shrink-0 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-0.5">
              {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <h1 className="font-sora font-bold text-primary text-2xl sm:text-3xl leading-tight">
              {welcomeText}, {profile?.prenom || 'Admin'}
            </h1>
            <p className="text-on-surface-variant text-sm mt-0.5 flex flex-wrap gap-1.5 items-center">
              <span>Tableau de bord — {getRoleLabel(profile?.role)}</span>
              {lastRefresh && (
                <span className="text-xs text-on-surface-variant/60">
                  · Mis à jour {lastRefresh.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <PeriodFilter value={period} onChange={setPeriod} />
            {profile?.role !== 'staff' && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportPdf}
                  disabled={exportingPdf}
                  className="flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl font-semibold text-xs sm:text-sm bg-surface-container-low text-primary border border-outline-variant/20 hover:bg-surface-container transition-colors disabled:opacity-50 shadow-2xs"
                >
                  <span className="material-symbols-outlined text-[17px] text-[#f95d00]">
                    {exportingPdf ? 'sync' : 'picture_as_pdf'}
                  </span>
                  {exportingPdf ? 'PDF…' : 'Export PDF'}
                </button>
                <button
                  onClick={handleExport}
                  disabled={exporting || !kpis}
                  className="flex items-center justify-center gap-2 px-3.5 py-2 bg-secondary text-on-secondary rounded-xl font-semibold text-xs sm:text-sm hover:bg-secondary/90 transition-colors disabled:opacity-50 shadow-2xs"
                >
                  <span className="material-symbols-outlined text-[17px]">
                    {exporting ? 'sync' : 'download'}
                  </span>
                  {exporting ? 'Export…' : 'Export Excel'}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-error-container text-on-error-container text-sm rounded-xl flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">warning</span>
          {error}
        </div>
      )}

      {/* ── Rapport intelligent (IA) ────────────────────────────────────── */}
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

      {/* ── Grille KPIs — Ligne 1 (filtre global appliqué) ─────────────── */}
      <div key={`k1-${period}`} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        <StatCard
          label="CA — période"
          value={`${formatDT(ca.periode)} DT`}
          sub={`${ca.transactions ?? 0} transactions · ${label}`}
          badge={typeof k.caMoisPrecedent === 'number' ? `Mois préc. : ${formatDT(k.caMoisPrecedent)} DT` : null}
          trend={{ text: `${ca.evolution > 0 ? '▲' : ca.evolution < 0 ? '▼' : '→'} ${Math.abs(ca.evolution ?? 0)}% vs période préc.`, dir: ca.evolution > 0 ? 'up' : ca.evolution < 0 ? 'down' : 'flat' }}
          icon="payments"
          accent="#2fbe8f"
          to="/admin/payments"
        />
        <StatCard
          label="Nouveaux membres"
          value={`${membres.periode ?? 0}`}
          sub={`${k.membresActifs ?? 0} membres actifs au total`}
          badge={null}
          trend={membersTrend}
          icon="group"
          accent="#f95d00"
        />
        <StatCard
          label="Réservations — période"
          value={`${reservationsPeriode.count ?? 0}`}
          sub={`${k.reservationsDuJour ?? 0} aujourd'hui · ${reservationsPeriode.confirmed ?? 0} confirmées`}
          icon="event_available"
          accent="#8b5cf6"
          to="/admin/agenda"
        />
        <StatCard
          label="Paiements en attente"
          value={`${formatDT(k.paiementsEnAttente?.montantTotal ?? 0)} DT`}
          sub={`${k.paiementsEnAttente?.count ?? 0} paiement(s) · ${label}`}
          icon="pending_actions"
          accent="#ba1a1a"
          to="/admin/payments"
        />
      </div>

      {/* ── Grille KPIs — Ligne 2 (Opérations) ─────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Sessions de travail actives"
          value={liveSessions.filter((s) => s.statut !== 'upcoming' && s.etat !== 'a_venir').length || sessions.length}
          sub="Libération manuelle requise"
          icon="timer"
          accent="#f59e0b"
          pulse={sessions.length > 0}
        />
        <StatCard
          label="Formations — période"
          value={k.formationsPeriode ?? 0}
          sub={`${k.formationsDuJour ?? 0} prévue(s) aujourd'hui`}
          icon="school"
          accent="#8b5cf6"
          to="/admin/formations"
        />
        <StatCard
          label="Occupation moyenne"
          value={`${occupationMoyen}%`}
          sub={topEspace ? `Meilleur espace : ${topEspace.nom} (${topEspace.taux}%)` : '—'}
          icon="domain"
          accent="#0ea5e9"
        />
        <StatCard
          label="Abonnements expirant"
          value={k.abonnementsExpirant ?? '—'}
          sub="Dans les 7 prochains jours"
          icon="card_membership"
          accent={k.abonnementsExpirant > 0 ? '#ba1a1a' : '#f95d00'}
        />
      </div>

      {/* ══ CDC v3.0 — PILOTAGE OPÉRATIONNEL IMMÉDIAT (SOUS LES KPIs, AVANT MON COWORKING) ══ */}
      {/* 1. Sessions de travail en cours + 2. Actions rapides */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
        <div
          className="lg:col-span-8 bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/10"
          style={{ boxShadow: '0 4px 16px rgba(16,35,63,0.06)' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <h2 className="font-sora font-bold text-primary text-base">Sessions de travail en cours</h2>
              {liveSessions.length > 0 && (
                <span className="flex h-2.5 w-2.5 relative">
                  <span className="animate-ping absolute inline-flex h-2.5 w-2.5 rounded-full bg-[#f95d00] opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#f95d00]" />
                </span>
              )}
            </div>
            <span className="text-[11px] text-on-surface-variant font-medium">
              Minuteur temps réel · Libération manuelle obligatoire
            </span>
          </div>

          {sessionActionMsg && (
            <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 flex items-center justify-between">
              <span>{sessionActionMsg}</span>
              <button type="button" onClick={() => setSessionActionMsg('')} className="ml-2 text-emerald-700 hover:underline">Fermer</button>
            </div>
          )}

          {liveSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <span className="material-symbols-outlined text-[40px] text-on-surface-variant/40 mb-2">timer_off</span>
              <p className="text-sm text-on-surface-variant">Aucune session de travail active ou imminente en ce moment</p>
            </div>
          ) : (
            <div className="divide-y divide-outline-variant/10">
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

        {/* Actions rapides (4 boutons directs CDC v3.0) */}
        <div
          className="lg:col-span-4 bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/10 flex flex-col justify-between"
          style={{ boxShadow: '0 4px 16px rgba(16,35,63,0.06)' }}
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
                className="flex items-center gap-3 w-full px-3.5 py-2.5 rounded-2xl bg-[#f95d00] text-white font-semibold text-sm hover:bg-[#e55500] transition-colors shadow-xs"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 19 }}>add_circle</span>
                <span>Nouvelle réservation</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/admin/agenda')}
                className="flex items-center gap-3 w-full px-3.5 py-2.5 rounded-2xl bg-surface-container-low text-primary font-semibold text-sm hover:bg-surface-container transition-colors border border-outline-variant/15"
              >
                <span className="material-symbols-outlined text-[#2fbe8f]" style={{ fontSize: 19 }}>qr_code_scanner</span>
                <span>Check-in</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/admin/clients?new=1')}
                className="flex items-center gap-3 w-full px-3.5 py-2.5 rounded-2xl bg-surface-container-low text-primary font-semibold text-sm hover:bg-surface-container transition-colors border border-outline-variant/15"
              >
                <span className="material-symbols-outlined text-[#0ea5e9]" style={{ fontSize: 19 }}>person_add</span>
                <span>Nouveau membre</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/admin/payments')}
                className="flex items-center gap-3 w-full px-3.5 py-2.5 rounded-2xl bg-surface-container-low text-primary font-semibold text-sm hover:bg-surface-container transition-colors border border-outline-variant/15"
              >
                <span className="material-symbols-outlined text-[#8b5cf6]" style={{ fontSize: 19 }}>payments</span>
                <span>Encaisser un paiement</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Agenda du jour (Réservations & Formations du jour) */}
      <div
        className="bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/10 mb-6"
        style={{ boxShadow: '0 4px 16px rgba(16,35,63,0.06)' }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 20 }}>today</span>
            <div>
              <h2 className="font-sora font-bold text-primary text-base">Agenda du jour</h2>
              <p className="text-xs text-on-surface-variant">
                {calendrierDuJour.length} réservation(s) · {formationsDuJourList.length} formation(s) prévue(s) aujourd'hui
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate('/admin/agenda')}
            className="text-xs font-bold text-[#f95d00] hover:underline flex items-center gap-1"
          >
            Ouvrir l'agenda complet
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>arrow_forward</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Réservations du jour */}
          <div className="rounded-2xl bg-surface-container-low/50 p-4 border border-outline-variant/10">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Réservations du jour</span>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#f95d00]/12 text-[#f95d00]">
                {calendrierDuJour.length}
              </span>
            </div>
            {calendrierDuJour.length === 0 ? (
              <p className="text-xs text-on-surface-variant py-4 text-center">Aucune réservation prévue aujourd'hui</p>
            ) : (
              <div className="divide-y divide-outline-variant/10 max-h-60 overflow-y-auto">
                {calendrierDuJour.map((r) => (
                  <div key={r.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-primary text-sm truncate">
                        {r.profiles ? `${r.profiles.prenom} ${r.profiles.nom}` : (r.guest_nom || 'Client')}
                      </p>
                      <p className="text-xs text-on-surface-variant truncate">
                        {r.espaces?.nom || 'Espace'} · {formatTimeShort(r.date_debut)} – {formatTimeShort(r.date_fin)}
                      </p>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${
                      r.statut === 'confirmed' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                    }`}>
                      {r.statut === 'confirmed' ? 'Confirmée' : 'En attente'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Formations du jour */}
          <div className="rounded-2xl bg-surface-container-low/50 p-4 border border-outline-variant/10">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Formations du jour</span>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#8b5cf6]/12 text-[#8b5cf6]">
                {formationsDuJourList.length}
              </span>
            </div>
            {formationsDuJourList.length === 0 ? (
              <p className="text-xs text-on-surface-variant py-4 text-center">Aucune session de formation aujourd'hui</p>
            ) : (
              <div className="divide-y divide-outline-variant/10 max-h-60 overflow-y-auto">
                {formationsDuJourList.map((f) => (
                  <div key={f.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-primary text-sm truncate">{f.titre}</p>
                      <p className="text-xs text-on-surface-variant truncate">
                        {f.profiles ? `${f.profiles.prenom} ${f.profiles.nom}` : 'Formateur'} · {f.espaces?.nom || 'Salle'}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold text-primary">{formatTimeShort(f.date_debut)}</p>
                      <p className="text-[10px] text-on-surface-variant">{f.nb_inscrits ?? 0}/{f.capacite_max ?? 0} inscrits</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Mon Coworking (image + coordonnées) ────────────────────────── */}
      {coworking && (
        <div className="bg-surface-container-lowest rounded-3xl border border-outline-variant/10 mb-6"
          style={{ boxShadow: '0 4px 16px rgba(16,35,63,0.06)', overflow: 'hidden' }}>
          <div className="flex items-center gap-5 p-5 flex-wrap">
            <img
              src={coworking.cover_url || coworking.logo_url || 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&h=400&fit=crop'}
              alt={coworking.nom}
              className="w-full sm:w-64 h-32 object-cover rounded-2xl shrink-0"
              style={{ maxWidth: '100%' }}
            />
            <div className="flex-1 min-w-0" style={{ minWidth: 160 }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="material-symbols-outlined text-secondary" style={{ fontSize: 20 }}>domain</span>
                <h2 className="font-sora font-bold text-primary text-base">Mon Coworking</h2>
              </div>
              <p className="font-sora font-bold text-primary" style={{ fontSize: 18 }}>{coworking.nom}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-1 text-xs text-on-surface-variant">
                {(coworking.adresse || coworking.ville) && (
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>location_on</span>
                    {[coworking.adresse, coworking.ville, coworking.pays].filter(Boolean).join(', ')}
                  </span>
                )}
                {coworking.telephone && (
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>phone</span>
                    {coworking.telephone}
                  </span>
                )}
                {coworking.latitude && coworking.longitude && (
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>place</span>
                    GPS {coworking.latitude}, {coworking.longitude}
                  </span>
                )}
                {coworking.email && (
                  <span className="flex items-center gap-1 truncate">
                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>mail</span>
                    {coworking.email}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Link to={`/coworking/${coworking.id}`}
                className="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold border border-secondary/30 bg-secondary/10 text-secondary hover:bg-secondary/20 transition-colors shrink-0">
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>visibility</span>
                Consulter mon espace
              </Link>
              <Link to="/admin/profile-coworking"
                className="flex items-center gap-2 px-4 py-2 bg-secondary text-white rounded-full text-xs font-semibold hover:bg-secondary/90 transition-colors shrink-0">
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>settings</span>
                Modifier le profil
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ── Graphiques : CA / espace + occupation / réservations ───────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">

        {/* Évolution des revenus (buckets selon période) */}
        <div className="lg:col-span-7 bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/10"
          style={{ boxShadow: '0 4px 16px rgba(16,35,63,0.06)' }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-sora font-bold text-primary text-base">Évolution des revenus</h2>
              <p className="text-xs text-on-surface-variant">{bucketCaption}</p>
            </div>
            <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-[rgba(47,190,143,0.1)]">
              <span className="material-symbols-outlined text-[#2fbe8f]" style={{ fontSize: 17 }}>trending_up</span>
            </span>
          </div>
          {revenueChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={revenueChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revBar" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2fbe8f" stopOpacity={0.9} />
                    <stop offset="95%" stopColor="#2fbe8f" stopOpacity={0.25} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                <XAxis dataKey="mois" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis yAxisId="ca" tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => `${v} DT`} width={70} />
                <YAxis yAxisId="tx" orientation="right" tick={{ fontSize: 10, fill: '#94a3b8' }} allowDecimals={false} width={30} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="ca" dataKey="ca" name="CA (DT)" fill="url(#revBar)" radius={[5, 5, 0, 0]} isAnimationActive={false} />
                <Line yAxisId="tx" type="monotone" dataKey="transactions" name="Transactions" stroke="#f95d00" strokeWidth={2.2} dot={{ r: 3, fill: '#f95d00' }} activeDot={{ r: 5 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-sm text-on-surface-variant">
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
            totalFormatter={(v) => `${v.toLocaleString('fr-FR')} DT`}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Évolution occupation */}
        <div className="bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/10"
          style={{ boxShadow: '0 4px 16px rgba(16,35,63,0.06)' }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-sora font-bold text-primary text-base">Taux d'occupation moyen</h2>
              <p className="text-xs text-on-surface-variant">{bucketCaption}</p>
            </div>
            <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-[rgba(0,84,203,0.09)]">
              <span className="material-symbols-outlined text-[#0ea5e9]" style={{ fontSize: 17 }}>domain</span>
            </span>
          </div>
          {occupationChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={occupationChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="occFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                <XAxis dataKey="mois" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => `${v}%`} domain={[0, 100]} width={40} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="taux" name="Occupation (%)" stroke="#0ea5e9" strokeWidth={2.5} fill="url(#occFill)" isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-sm text-on-surface-variant">
              Aucune donnée disponible
            </div>
          )}
        </div>

        {/* Réservations par espace (empilé) */}
        <div className="bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/10"
          style={{ boxShadow: '0 4px 16px rgba(16,35,63,0.06)' }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-sora font-bold text-primary text-base">Réservations par espace</h2>
              <p className="text-xs text-on-surface-variant">{reservationsParEspace.length} espace(s) · {label}</p>
            </div>
            <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-[rgba(245,158,11,0.1)]">
              <span className="material-symbols-outlined text-[#f59e0b]" style={{ fontSize: 17 }}>chair</span>
            </span>
          </div>
          {reservationsParEspace.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={reservationsParEspace} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                <XAxis dataKey="nom" tick={{ fontSize: 10, fill: '#64748b' }}
                  tickFormatter={(v) => (v.length > 10 ? v.slice(0, 10) + '…' : v)} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} width={32} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="confirmed" name="Confirmées" stackId="a" fill="#2fbe8f" radius={[0, 0, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="pending" name="En attente" stackId="a" fill="#f59e0b" radius={[5, 5, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-sm text-on-surface-variant">
              Aucune donnée disponible
            </div>
          )}
        </div>
      </div>

      {/* ── Top membres + Prochaines réservations + Activité récente ──── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
        {/* Top 5 membres (CA période) */}
        <div className="lg:col-span-6 bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/10"
          style={{ boxShadow: '0 4px 16px rgba(16,35,63,0.06)' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-sora font-bold text-primary text-base">Top membres</h2>
            <span className="text-xs text-on-surface-variant font-medium">Par CA · {label}</span>
          </div>
          {topMembres.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <span className="material-symbols-outlined text-[40px] text-on-surface-variant/40 mb-2">leaderboard</span>
              <p className="text-sm text-on-surface-variant">Aucun paiement enregistré</p>
            </div>
          ) : (
            <div className="space-y-2">
              {topMembres.map((m, i) => {
                const medals = ['🥇', '🥈', '🥉'];
                const maxCa = topMembres[0]?.ca || 1;
                return (
                  <div key={i} className="flex items-center gap-3 p-2 rounded-xl hover:bg-surface-container-low/50 transition-colors">
                    <span className="text-lg w-6 text-center shrink-0">{medals[i] || `#${i + 1}`}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-primary text-sm truncate">{m.nom}</p>
                      <div className="h-1 rounded-full bg-outline-variant/10 overflow-hidden mt-1">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(6, Math.round((m.ca / maxCa) * 100))}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                      </div>
                    </div>
                    <span className="font-bold text-[#2fbe8f] text-sm shrink-0">
                      {formatDT(m.ca)} DT
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Prochaines réservations (J+7) */}
        <div className="lg:col-span-6 bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/10"
          style={{ boxShadow: '0 4px 16px rgba(16,35,63,0.06)' }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-sora font-bold text-primary text-base">Prochaines réservations</h2>
              <p className="text-xs text-on-surface-variant">Dans les 7 prochains jours</p>
            </div>
            <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-[rgba(0,84,203,0.09)]">
              <span className="material-symbols-outlined text-[#0ea5e9]" style={{ fontSize: 17 }}>upcoming</span>
            </span>
          </div>
          {prochainesReservations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <span className="material-symbols-outlined text-[40px] text-on-surface-variant/40 mb-2">event_available</span>
              <p className="text-sm text-on-surface-variant">Aucune réservation à venir</p>
            </div>
          ) : (
            <div className="divide-y divide-outline-variant/10 max-h-[320px] overflow-y-auto">
              {prochainesReservations.map((r) => (
                <div key={r.id} className="py-3 flex items-center gap-3">
                  <span className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0 bg-[rgba(47,190,143,0.1)] text-[#2fbe8f]">
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>calendar_month</span>
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-primary text-sm truncate">
                      {r.profiles ? `${r.profiles.prenom} ${r.profiles.nom}` : 'Membre'}
                    </p>
                    <p className="text-xs text-on-surface-variant truncate">{r.espaces?.nom || 'Espace'}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-bold text-primary">
                      {new Date(r.date_debut).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                    </p>
                    <p className="text-[10px] text-on-surface-variant">{formatTimeShort(r.date_debut)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Activité récente ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
        <div className="lg:col-span-12 bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/10"
          style={{ boxShadow: '0 4px 16px rgba(16,35,63,0.06)' }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-sora font-bold text-primary text-base">Activité récente</h2>
              <p className="text-xs text-on-surface-variant">Derniers événements</p>
            </div>
            <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-[rgba(249,93,0,0.09)]">
              <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 17 }}>bolt</span>
            </span>
          </div>
          {activiteRecente.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <span className="material-symbols-outlined text-[40px] text-on-surface-variant/40 mb-2">history</span>
              <p className="text-sm text-on-surface-variant">Aucune activité récente</p>
            </div>
          ) : (
            <div className="divide-y divide-outline-variant/10 max-h-[320px] overflow-y-auto">
              {activiteRecente.map((a) => {
                const meta = a.type === 'paiement'
                  ? { icon: 'payments', bg: 'bg-[rgba(47,190,143,0.1)]', color: 'text-[#2fbe8f]' }
                  : a.type === 'session'
                    ? { icon: 'login', bg: 'bg-[rgba(245,158,11,0.1)]', color: 'text-[#f59e0b]' }
                    : { icon: 'event_available', bg: 'bg-[rgba(139,92,246,0.1)]', color: 'text-[#8b5cf6]' };
                return (
                  <div key={a.id} className="py-2.5 flex items-center gap-3">
                    <span className={`flex items-center justify-center w-8 h-8 rounded-xl shrink-0 ${meta.bg} ${meta.color}`}>
                      <span className="material-symbols-outlined" style={{ fontSize: 15 }}>{meta.icon}</span>
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-primary font-medium leading-snug">{a.text}</p>
                      <p className="text-[10px] text-on-surface-variant mt-0.5">{relTime(a.time)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Section Demandes en attente ───────────────────────────────── */}
      {pendingAccounts.length > 0 && (
        <div className="bg-surface-container-lowest rounded-3xl p-5 border border-amber-200/60 mb-6"
          style={{ boxShadow: '0 4px 16px rgba(245,158,11,0.08)' }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#d97706' }}>pending_actions</span>
              <h2 className="font-sora font-bold text-primary text-base">Demandes de compte en attente</h2>
            </div>
            <span className="ml-2 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white animate-pulse"
              style={{ background: '#d97706' }}>{pendingAccounts.length}</span>
          </div>

          <div className="divide-y divide-outline-variant/10">
            {pendingAccounts.map((p) => {
              const roleColors = { formateur: { bg: '#f5f3ff', text: '#6d28d9' }, member: { bg: '#eff6ff', text: '#1d4ed8' }, default: { bg: '#f1f5f9', text: '#475569' } };
              const rc = roleColors[p.role] || roleColors.default;
              const isActing = approvingId === p.id;
              const dateInscrit = new Date(p.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
              return (
                <div key={p.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 font-bold text-sm text-white"
                      style={{ background: 'linear-gradient(135deg, #d97706, #f59e0b)', minWidth: 40 }}>
                      {(p.prenom?.[0] || '').toUpperCase()}{(p.nom?.[0] || '').toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-primary text-sm">{p.prenom} {p.nom}</p>
                      <p className="text-xs text-on-surface-variant truncate">{p.email}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: rc.bg, color: rc.text }}>
                          {p.role === 'formateur' ? 'Formateur' : 'Membre'}
                          {p.specialite ? ` · ${p.specialite}` : ''}
                        </span>
                        <span className="text-[10px] text-on-surface-variant">Inscrit le {dateInscrit}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                    <button
                      onClick={() => handleAccountAction(p.id, 'reject')}
                      disabled={isActing}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors disabled:opacity-50"
                      style={{ borderColor: 'rgba(186,26,26,0.25)', color: '#ba1a1a', background: 'rgba(186,26,26,0.05)' }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
                      Rejeter
                    </button>
                    <button
                      onClick={() => handleAccountAction(p.id, 'approve')}
                      disabled={isActing}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors disabled:opacity-50 text-white"
                      style={{ background: isActing ? '#94a3b8' : 'linear-gradient(135deg, #059669, #10b981)' }}
                    >
                      {isActing
                        ? <span className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full" />
                        : <span className="material-symbols-outlined" style={{ fontSize: 14 }}>check</span>
                      }
                      {isActing ? 'En cours…' : 'Approuver'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Formations (période) ──────────────────────────────────────── */}
      <div className="bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/10 mb-6"
        style={{ boxShadow: '0 4px 16px rgba(16,35,63,0.06)' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#8b5cf6]" style={{ fontSize: 20 }}>school</span>
            <h2 className="font-sora font-bold text-primary text-base">Suivi des formations programmées</h2>
          </div>
          <span className="text-xs text-on-surface-variant font-medium">
            {formationsPeriode.length} formation(s) · {label}
          </span>
        </div>

        {formationsPeriode.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <span className="material-symbols-outlined text-[40px] text-on-surface-variant/40 mb-2">school</span>
            <p className="text-sm text-on-surface-variant">Aucune formation programmée dans cette période</p>
          </div>
        ) : (
          <div className="table-responsive-wrapper">
            <table className="w-full min-w-[650px] text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-outline-variant/10 pb-2">
                  <th className="pb-2 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Formation</th>
                  <th className="pb-2 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Formateur</th>
                  <th className="pb-2 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Date de début</th>
                  <th className="pb-2 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Espace</th>
                  <th className="pb-2 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant text-center">Inscriptions</th>
                  <th className="pb-2 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant text-right">Prix</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {formationsPeriode.slice(0, 5).map((f) => {
                  const formateurName = f.profiles ? `${f.profiles.prenom} ${f.profiles.nom}` : '—';
                  const fillPct = f.capacite_max > 0 ? Math.min(100, Math.round((f.nb_inscrits / f.capacite_max) * 100)) : 0;
                  const barColor = fillPct >= 90 ? 'bg-red-500' : fillPct >= 60 ? 'bg-amber-500' : 'bg-emerald-500';

                  return (
                    <tr key={f.id} className="hover:bg-surface-container-low/30 transition-colors">
                      <td className="py-3 font-semibold text-primary">{f.titre}</td>
                      <td className="py-3 text-on-surface-variant">
                        <div>{formateurName}</div>
                        {f.profiles?.specialite && <div className="text-[10px] text-on-surface-variant/70">{f.profiles.specialite}</div>}
                      </td>
                      <td className="py-3 text-on-surface-variant">
                        <div>{new Date(f.date_debut).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</div>
                        <div className="text-[10px] text-on-surface-variant/70">{formatTimeShort(f.date_debut)}</div>
                      </td>
                      <td className="py-3 text-on-surface-variant">{f.espaces?.nom || '—'}</td>
                      <td className="py-3">
                        <div className="flex flex-col items-center justify-center min-w-[100px]">
                          <div className="flex items-center justify-between w-full text-[10px] mb-1">
                            <span className="font-semibold text-on-surface-variant">{f.nb_inscrits} / {f.capacite_max}</span>
                            <span className="font-bold text-on-surface-variant">{fillPct}%</span>
                          </div>
                          <div className="w-full h-1 rounded-full bg-outline-variant/10 overflow-hidden">
                            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${fillPct}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="py-3 text-right font-bold text-secondary">
                        {f.prix_inscription > 0 ? `${f.prix_inscription} DT` : 'Gratuit'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Réservations invités (guests) ──────────────────────────────── */}
      <div className="bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/10 mb-6"
        style={{ boxShadow: '0 4px 16px rgba(16,35,63,0.06)' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-secondary" style={{ fontSize: 20 }}>person_off</span>
            <h2 className="font-sora font-bold text-primary text-base">Réservations invités (guests)</h2>
          </div>
          {guestsPeriode.length > 0 && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
              style={{ background: '#f95d00' }}>{guestsPeriode.length}</span>
          )}
        </div>

        {guestsPeriode.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <span className="material-symbols-outlined text-[38px] text-on-surface-variant/40 mb-2">group_off</span>
            <p className="text-sm text-on-surface-variant">Aucune réservation invité sur {label}.</p>
          </div>
        ) : (
          <div className="table-responsive-wrapper">
            <table className="w-full min-w-[650px] text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-outline-variant/10">
                  <th className="pb-2 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Invitée(e)</th>
                  <th className="pb-2 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Contact</th>
                  <th className="pb-2 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Espace réservé</th>
                  <th className="pb-2 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Date</th>
                  <th className="pb-2 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant text-right">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {guestsPeriode.slice(0, 10).map((g) => {
                  const res = g.reservations?.[0];
                  return (
                    <tr key={g.id} className="hover:bg-surface-container-low/30 transition-colors">
                      <td className="py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-[rgba(249,93,0,0.09)] text-secondary font-bold text-xs">
                            {(g.prenom?.[0] || '?').toUpperCase()}{(g.nom?.[0] || '').toUpperCase()}
                          </span>
                          <span className="font-semibold text-primary">{g.prenom} {g.nom}</span>
                        </div>
                      </td>
                      <td className="py-3 text-on-surface-variant">
                        <div className="truncate max-w-[200px]">{g.email}</div>
                        {g.telephone && <div className="text-[10px] text-on-surface-variant/70">{g.telephone}</div>}
                      </td>
                      <td className="py-3 text-on-surface-variant">{res?.espaces?.nom || '—'}</td>
                      <td className="py-3 text-on-surface-variant">
                        {res?.date_debut ? new Date(res.date_debut).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '—'}
                      </td>
                      <td className="py-3 text-right">
                        <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-tight ${
                          res?.statut === 'confirmed' ? 'bg-emerald-100 text-emerald-800'
                            : res?.statut === 'pending' ? 'bg-amber-100 text-amber-800'
                              : res?.statut === 'cancelled' ? 'bg-red-100 text-red-800'
                                : 'bg-gray-100 text-gray-700'
                        }`}>
                          {res?.statut === 'confirmed' ? 'Confirmée'
                            : res?.statut === 'pending' ? 'En attente'
                              : res?.statut === 'cancelled' ? 'Annulée'
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
      </div>

    </PortalLayout>
  );
}