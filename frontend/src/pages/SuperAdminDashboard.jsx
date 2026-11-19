import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { superAdminApi } from '../services/superAdminApi';
import { formationApi } from '../services/api';
import { exportFormationsToExcel } from '../utils/exportFormationsExcel';
import { supabase } from '../supabaseClient';
import { useSessionUser } from '../hooks/useSessionUser';
import PortalLayout from '../components/layout/PortalLayout';
import PeriodFilter from '../components/dashboard/PeriodFilter';
import AIReportPanel from '../components/dashboard/AIReportPanel';
import { DEFAULT_PERIOD, windowLabel } from '../utils/dashboardPeriod';
import { ComposedChart, Bar, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const styles = `
@keyframes bento-fade-in { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
@keyframes pulse-dot { 0%,100% { opacity:1; } 50% { opacity:.45; } }
.bento-card { animation: bento-fade-in .45s ease-out both; }
.bento-card:nth-child(2) { animation-delay:.07s; }
.bento-card:nth-child(3) { animation-delay:.14s; }
.bento-card:nth-child(4) { animation-delay:.21s; }
.pulse-dot { animation: pulse-dot 1.6s ease-in-out infinite; }
`;

// ─── StatCard PowerBI ────────────────────────────────────────────────────────
function StatCard({ label, value, icon, accent = '#f95d00', trend, sub, badge, to, onClick }) {
  const bg = accent === '#2fbe8f' ? 'rgba(47,190,143,0.1)'
    : accent === '#ba1a1a' ? 'rgba(186,26,26,0.09)'
      : accent === '#f59e0b' ? 'rgba(245,158,11,0.1)'
        : accent === '#8b5cf6' ? 'rgba(139,92,246,0.1)'
          : accent === '#0ea5e9' ? 'rgba(14,165,233,0.09)'
            : 'rgba(249,93,0,0.09)';
  const trendColors = { up: '#2fbe8f', down: '#ba1a1a', flat: '#9da2a8' };
  const trendColor = trend ? trendColors[trend.dir] || '#9da2a8' : '#9da2a8';

  const content = (
    <div
      className="bg-surface-container-lowest rounded-3xl border border-outline-variant/10 h-full transition-all duration-300 hover:-translate-y-1 relative overflow-hidden group"
      style={{ padding: '18px 20px', boxShadow: '0 4px 16px rgba(16,35,63,0.06)' }}
    >
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }} />
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

  if (to) return <button onClick={onClick} className="block w-full text-left h-full no-underline">{content}</button>;
  return content;
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
          {p.name === 'MRR (DT)' ? ' DT' : ''}
        </p>
      ))}
    </div>
  );
}

// ─── Format tendance (%) ─────────────────────────────────────────────────────
function pctTrend(evolution) {
  const v = Number(evolution) || 0;
  if (v > 0) return { text: `▲ +${v}% vs période préc.`, dir: 'up' };
  if (v < 0) return { text: `▼ ${v}% vs période préc.`, dir: 'down' };
  return { text: '→ Stable vs période préc.', dir: 'flat' };
}

// ─── Format montant en DT ────────────────────────────────────────────────────
function fmtDT(n) {
  return `${Number(n || 0).toLocaleString('fr-TN')} DT`;
}

// ─── Libellés des plans / actions d'audit ────────────────────────────────────
const PLAN_LABELS = {
  free: 'Essentiel',
  starter: 'Essentiel',
  pro: 'Standard',
  enterprise: 'Premium',
  essentiel: 'Essentiel',
  standard: 'Standard',
  premium: 'Premium',
};
const ACTION_META = {
  tenant_created: { icon: 'domain_add', label: 'a enregistré un nouveau coworking' },
  tenant_updated: { icon: 'edit', label: "a mis à jour un coworking" },
  tenant_deleted: { icon: 'delete', label: 'a supprimé un coworking' },
  tenant_onboarded: { icon: 'person_add', label: 'a invité un administrateur' },
  user_updated: { icon: 'manage_accounts', label: 'a modifié un utilisateur' },
  user_deleted: { icon: 'person_remove', label: 'a supprimé un utilisateur' },
};

export default function SuperAdminDashboard({ session }) {
  const navigate = useNavigate();
  const { userId, email, metadata } = useSessionUser(session);

  // Profil minimal construit synchroniquement depuis le JWT — aucun appel DB au démarrage
  const [profile, setProfile] = useState(() =>
    userId ? { id: userId, email, role: metadata.role || 'super_admin', ...metadata } : null
  );
  const [period, setPeriod] = useState(DEFAULT_PERIOD);
  const [stats, setStats] = useState(null);
  const [allFormations, setAllFormations] = useState([]);
  const [pendingTenants, setPendingTenants] = useState([]);
  const [coworkings, setCoworkings] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showReport, setShowReport] = useState(false);
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');

  const periodRef = useRef(period);
  periodRef.current = period;

  const showReportRef = useRef(showReport);
  showReportRef.current = showReport;

  const firstLoadRef = useRef(true);

  const load = useCallback(async (p) => {
    const silent = !firstLoadRef.current;
    if (firstLoadRef.current) setLoading(true);
    try {
      const [s, auditRes, fRes, ptRes, cwRes] = await Promise.all([
        superAdminApi.getStats({ period: p }).catch(() => null),
        superAdminApi.getAuditLogs({ limit: 8, page: 1 }).catch(() => ({ logs: [] })),
        formationApi.getAll().catch(() => ({ formations: [] })),
        superAdminApi.getTenants({ statut: 'suspendu' }).catch(() => ({ tenants: [] })),
        superAdminApi.getTenants({ statut: 'actif', limit: 50 }).catch(() => ({ tenants: [] })),
      ]);
      if (s) setStats(s);
      if (auditRes?.logs) setAuditLogs(auditRes.logs);
      if (fRes?.formations) setAllFormations(fRes.formations);
      if (ptRes?.tenants) setPendingTenants(ptRes.tenants);
      if (cwRes?.tenants) setCoworkings(cwRes.tenants);
      firstLoadRef.current = false;
    } catch (e) { /* silencieux */ }
    finally { setLoading(false); }
  }, []);

  // ── Rapport intelligent (IA) selon la période active ─────────────────────
  const loadReport = useCallback(async (silent = false) => {
    if (!silent) setReportLoading(true);
    setReportError('');
    try {
      const r = await superAdminApi.getReport({ period: periodRef.current });
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

  // Chargement initial : si pas de userId → redirection login
  useEffect(() => {
    if (!userId) { navigate('/login'); return; }
    if (profile?.role && profile.role !== 'super_admin') { navigate('/admin/dashboard'); }
  }, [userId, profile, navigate]);

  // Chargement des données : initial + à chaque changement de période
  useEffect(() => {
    if (profile) {
      load(period);
    }
  }, [period, profile, load]);

  // Rapport IA : rechargé si ouvert lors d'un changement de période
  useEffect(() => {
    if (showReportRef.current) loadReport(true);
  }, [period, loadReport]);

  const handleLogout = async () => { await supabase.auth.signOut(); navigate('/login'); };

  const handleApproveTenant = async (id) => {
    try {
      await superAdminApi.updateTenant(id, { statut: 'actif' });
      setPendingTenants(prev => prev.filter(t => t.id !== id));
      const s = await superAdminApi.getStats({ period: periodRef.current });
      if (s) setStats(s);
    } catch (e) {
      alert('Erreur approbation : ' + e.message);
    }
  };

  const handleRejectTenant = async (id) => {
    if (!confirm('Rejeter cette demande ? Cela supprimera définitivement le coworking.')) return;
    try {
      await superAdminApi.deleteTenant(id);
      setPendingTenants(prev => prev.filter(t => t.id !== id));
      const s = await superAdminApi.getStats({ period: periodRef.current });
      if (s) setStats(s);
    } catch (e) {
      alert('Erreur rejet : ' + e.message);
    }
  };

  const handleDownloadCSV = () => {
    exportFormationsToExcel(allFormations);
  };

  if (!profile) {
    return null;
  }


  const safeStats = stats || {
    totalTenants: 0,
    nouveauxTenants: 0,
    mrr: 0,
    totalMembers: 0,
    activeTenants: 0,
    suspendedTenants: 0,
    activeSubscriptions: 0,
    expiredSubscriptions: 0,
    overdueAmount: 0,
    planBreakdown: {},
    monthlyGrowth: [],
    topCoworkings: [],
  };

  const pStr = typeof period === 'string' ? period : (period?.key || 'mois');
  const bucketCaption = pStr.startsWith('jour') ? 'Par heure'
    : (pStr.startsWith('mois') || pStr.startsWith('semaine') || pStr.startsWith('custom')) ? 'Par jour'
    : (pStr.startsWith('annee') || pStr.startsWith('trimestre')) ? 'Par mois'
    : 'Par année';

  const planSummary = Object.entries(safeStats.planBreakdown || {})
    .map(([plan, count]) => `${PLAN_LABELS[plan] || plan} ${count}`)
    .join(' · ') || 'Aucun';

  // ── Activité récente : audit log + arrivées de coworkings ────────────────
  const activityFeed = [];
  (auditLogs || []).forEach((log) => {
    const who = log.profiles ? `${log.profiles.prenom || ''} ${log.profiles.nom || ''}`.trim() : 'VC LOW';
    const meta = ACTION_META[log.action] || { icon: 'event', label: `a réalisé l'action "${log.action}"` };
    activityFeed.push({
      id: log.id,
      icon: meta.icon,
      text: `${who} ${meta.label}${log.target_name ? ` · ${log.target_name}` : ''}`,
      time: log.created_at,
    });
  });
  (coworkings || []).slice(0, 3).forEach((t) => {
    activityFeed.push({ id: `t-${t.id}`, icon: 'domain_add', text: `Nouveau coworking : ${t.nom}`, time: t.created_at });
  });
  activityFeed.sort((a, b) => new Date(b.time) - new Date(a.time));
  const activityToShow = activityFeed.slice(0, 8);

  // ── Alertes importantes (dynamiques) ─────────────────────────────────────
  const alerts = [];
  if ((safeStats.expiredSubscriptions ?? 0) > 0) {
    alerts.push({
      severity: 'high',
      icon: 'error',
      text: `${safeStats.expiredSubscriptions} coworking(s) en impayé ou expiré`,
      detail: `${fmtDT(safeStats.overdueAmount)} en attente de règlement`,
    });
  }
  if (pendingTenants.length > 0) {
    alerts.push({
      severity: 'warning',
      icon: 'pending_actions',
      text: `${pendingTenants.length} demande(s) d'inscription en attente d'approbation`,
    });
  }
  if ((safeStats.suspendedTenants ?? 0) > 0) {
    alerts.push({
      severity: 'warning',
      icon: 'block',
      text: `${safeStats.suspendedTenants} coworking(s) suspendu(s)`,
    });
  }

  const topCoworkings = Array.isArray(safeStats.topCoworkings) ? safeStats.topCoworkings : [];

  const cards = [
    {
      label: 'Total Coworkings',
      value: (safeStats.totalTenants ?? 0).toLocaleString('fr-FR'),
      icon: 'domain',
      color: '#f95d00',
      trend: pctTrend(safeStats.tenantEvolution),
      sub: `${(safeStats.nouveauxTenants ?? 0).toLocaleString('fr-FR')} nouveau(x) sur la période`,
      to: '/super-admin/tenants',
      onClick: () => navigate('/super-admin/tenants'),
    },
    {
      label: 'Abonnements actifs',
      value: (safeStats.activeSubscriptions ?? 0).toLocaleString('fr-FR'),
      icon: 'workspace_premium',
      color: '#2fbe8f',
      sub: `Par plan : ${planSummary}`,
      to: '/super-admin/billing',
      onClick: () => navigate('/super-admin/billing'),
    },
    {
      label: 'Abonnements expirés / impayés',
      value: (safeStats.expiredSubscriptions ?? 0).toLocaleString('fr-FR'),
      icon: 'warning',
      color: '#ba1a1a',
      badge: `${fmtDT(safeStats.overdueAmount)} en attente`,
      to: '/super-admin/billing',
      onClick: () => navigate('/super-admin/billing'),
    },
    {
      label: 'Chiffre d’affaires plateforme',
      value: fmtDT(safeStats.mrr),
      icon: 'payments',
      color: '#8b5cf6',
      sub: `${(safeStats.totalMembers ?? 0).toLocaleString('fr-FR')} membres sur la plateforme`,
      to: '/super-admin/billing',
      onClick: () => navigate('/super-admin/billing'),
    },
  ];

  const growthData = Array.isArray(safeStats.monthlyGrowth) ? safeStats.monthlyGrowth : [];

  return (
    <PortalLayout profile={profile} onLogout={handleLogout}>
      <style>{styles}</style>
      <div className="p-2 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">

        {/* ── En-tête + filtre global ─────────────────────────────────────── */}
        <div className="mb-6 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="shrink-0">
            <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-on-surface-variant mb-1">
              Vue globale de la plateforme · {windowLabel(period)}
            </p>
            <h1 className="font-sora text-xl sm:text-2xl font-bold text-primary">Tableau de bord Super Admin</h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <PeriodFilter value={period} onChange={setPeriod} />
          </div>
        </div>


        {/* ── Cartes KPI ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
          {cards.map((c) => (
            <StatCard key={c.label} {...c} />
          ))}
        </div>

        {/* ── Évolution des revenus + Activité récente ────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
          <div className="lg:col-span-2 bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/10 shadow-[0px_4px_12px_rgba(16,35,63,0.05)] bento-card">
            <div className="flex items-center justify-between gap-4 mb-2 flex-wrap">
              <div>
                <h2 className="font-sora text-lg font-semibold text-primary">Évolution des revenus</h2>
                <p className="text-xs text-on-surface-variant mt-0.5">{bucketCaption} · {windowLabel(period)}</p>
              </div>
            <div className="flex items-center gap-3 text-xs font-semibold">
              <span className="flex items-center gap-1.5 text-[#8b5cf6]">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#8b5cf6' }} /> MRR (DT)
              </span>
              <span className="flex items-center gap-1.5 text-[#f95d00]">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#f95d00' }} /> Coworkings
              </span>
            </div>
          </div>
          {growthData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={growthData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorMrr2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                <XAxis dataKey="mois" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#64748b' }} width={50} tickFormatter={(v) => `${v}`} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#64748b' }} width={36} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar yAxisId="right" dataKey="coworkings" name="Coworkings" fill="#f95d00" radius={[4, 4, 0, 0]} barSize={18} />
                <Area yAxisId="left" type="monotone" dataKey="mrr" name="MRR (DT)" stroke="#8b5cf6" strokeWidth={2.5} fillOpacity={1} fill="url(#colorMrr2)" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[140px] flex items-center justify-center text-xs text-on-surface-variant">
              Aucune donnée d'évolution disponible
            </div>
          )}
          </div>

          {/* ─── Activité récente ─── */}
          <div className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/10 shadow-[0px_4px_12px_rgba(16,35,63,0.05)] bento-card">
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <div>
                <h2 className="font-sora text-lg font-semibold text-primary">Activité récente</h2>
                <p className="text-xs text-on-surface-variant mt-0.5">Dernières actions de la plateforme</p>
              </div>
              <button onClick={() => navigate('/super-admin/monitoring')}
                className="flex items-center gap-1 text-xs font-semibold text-secondary hover:underline">
                Voir tout
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>arrow_forward</span>
              </button>
            </div>
            {activityToShow.length === 0 ? (
              <div className="h-[160px] flex items-center justify-center text-xs text-on-surface-variant">
                Aucune activité récente
              </div>
            ) : (
              <ul className="space-y-3 max-h-[280px] overflow-y-auto pr-1">
                {activityToShow.map((a) => (
                  <li key={a.id} className="flex items-start gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-secondary/10 text-secondary">
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{a.icon}</span>
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-primary leading-snug">{a.text}</p>
                      <p className="text-[10px] text-on-surface-variant mt-0.5">
                        {new Date(a.time).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* ─── SECTION: Demandes d'inscription de Coworkings ─── */}
        {pendingTenants.length > 0 && (
          <div className="bg-surface-container-lowest rounded-3xl p-6 border border-amber-200/60 mb-6 shadow-[0px_4px_12px_rgba(245,158,11,0.06)] bento-card">
            <div className="flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined text-[#d97706]" style={{ fontSize: 22 }}>domain_disabled</span>
              <h2 className="font-sora text-lg font-semibold text-primary">Demandes d’inscription de Coworkings</h2>
              <span className="ml-2 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white animate-pulse" style={{ background: '#d97706' }}>
                {pendingTenants.length}
              </span>
            </div>
            <div className="divide-y divide-outline-variant/10">
              {pendingTenants.map((t) => {
                const dateInscrit = new Date(t.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
                return (
                  <div key={t.id} className="py-4 flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-amber-50 flex items-center justify-center font-sora font-bold text-[#d97706] text-sm">
                        {(t.nom || '?')[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold text-primary">{t.nom}</p>
                        <p className="text-xs text-on-surface-variant">
                          {t.email} {t.telephone ? `· ${t.telephone}` : ''} {t.ville ? `· ${t.ville}` : ''}
                        </p>
                        <p className="text-[10px] text-on-surface-variant/80 mt-0.5">Demande reçue le {dateInscrit}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleRejectTenant(t.id)}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-xs font-semibold hover:bg-red-50 transition-colors"
                        style={{ borderColor: 'rgba(186,26,26,0.25)', color: '#ba1a1a' }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 15 }}>close</span>
                        Rejeter
                      </button>
                      <button
                        onClick={() => handleApproveTenant(t.id)}
                        className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 text-white rounded-full text-xs font-semibold hover:bg-emerald-700 transition-colors shadow-sm"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 15 }}>check</span>
                        Activer le Coworking
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ─── SECTION: Coworkings actifs (galerie avec images) ─── */}
        {coworkings.length > 0 && (
          <div className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/10 mb-6 shadow-[0px_4px_12px_rgba(16,35,63,0.05)] bento-card">
            <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary" style={{ fontSize: 22 }}>domain</span>
                <h2 className="font-sora text-lg font-semibold text-primary">Coworkings actifs</h2>
                <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{ background: '#f95d00' }}>{coworkings.length}</span>
              </div>
              <button onClick={() => navigate('/super-admin/tenants')}
                className="flex items-center gap-2 px-4 py-2 bg-secondary text-white rounded-full text-xs font-semibold hover:bg-secondary/90 transition-colors">
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>domain</span>
                Gérer les Tenants
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {coworkings.slice(0, 8).map((t) => (
                <div key={t.id} className="rounded-2xl overflow-hidden border border-outline-variant/10 bg-surface-container-lowest hover:shadow-[0px_8px_20px_rgba(16,35,63,0.1)] transition-shadow">
                  <div className="h-28 overflow-hidden">
                    <img
                      src={t.cover_url || t.logo_url || 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=600&h=300&fit=crop'}
                      alt={t.nom}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-sora font-bold text-primary text-sm truncate">{t.nom}</p>
                      <span className="shrink-0 w-2 h-2 rounded-full bg-emerald-500" title="Actif" />
                    </div>
                    <p className="text-[11px] text-on-surface-variant flex items-center gap-1 mb-2">
                      <span className="material-symbols-outlined" style={{ fontSize: 13 }}>location_on</span>
                      {[t.adresse, t.ville, t.pays].filter(Boolean).join(', ') || 'Tunisie'}
                    </p>
                    <div className="flex items-center gap-3 text-[11px] text-on-surface-variant">
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>meeting_room</span>
                        {t.space_count ?? 0} espaces
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>groups</span>
                        {t.member_count ?? 0} membres
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {coworkings.length > 8 && (
              <p className="text-center text-xs text-on-surface-variant mt-4">
                + {coworkings.length - 8} autre(s) coworking(s) — consultez la <button
                  className="text-secondary font-semibold hover:underline"
                  onClick={() => navigate('/super-admin/tenants')}>gestion des tenants</button>
              </p>
            )}
          </div>
        )}

        {/* ─── Coworkings les plus performants ─────────────────────────────── */}
        {topCoworkings.length > 0 && (
          <div className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/10 mb-6 shadow-[0px_4px_12px_rgba(16,35,63,0.05)] bento-card">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#f59e0b]" style={{ fontSize: 22 }}>leaderboard</span>
                <h2 className="font-sora text-lg font-semibold text-primary">Coworkings les plus performants</h2>
              </div>
              <button onClick={() => navigate('/super-admin/tenants')}
                className="flex items-center gap-1 text-xs font-semibold text-secondary hover:underline">
                Voir le classement complet
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>arrow_forward</span>
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
              {topCoworkings.slice(0, 5).map((t, rank) => (
                <div key={`${t.id}-${rank}`}
                  className={`rounded-2xl border p-4 ${rank === 0 ? 'border-amber-200/70 bg-amber-50/40' : 'border-outline-variant/10'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`flex h-6 w-6 items-center justify-center rounded-md font-sora font-bold text-[11px] ${rank === 0 ? 'bg-amber-100 text-amber-700' : 'bg-secondary/10 text-secondary'}`}>
                      #{rank + 1}
                    </span>
                    <span className={`w-2 h-2 rounded-full ${rank === 0 ? 'bg-amber-500' : 'bg-secondary'}`} />
                  </div>
                  <p className="font-sora font-bold text-primary text-sm truncate mb-1">{t.nom}</p>
                  <p className="text-[11px] text-on-surface-variant">{t.bookings ?? 0} réservation(s)</p>
                  <p className="text-sm font-bold text-secondary mt-1">{fmtDT(t.ca)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── Catalogue global des formations ─── */}
        <div className="mb-6">
          <div className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/10 shadow-[0px_2px_4px_rgba(16,35,63,0.04)] bento-card">
            <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#8b5cf6]" style={{ fontSize: 22 }}>school</span>
                <h2 className="font-sora text-lg font-semibold text-primary">Catalogue global des formations</h2>
              </div>
              {allFormations.length > 0 && (
                <button
                  onClick={handleDownloadCSV}
                  className="flex items-center gap-2 px-4 py-2 bg-secondary text-white rounded-full text-xs font-semibold hover:bg-secondary/90 transition-colors"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
                  Télécharger la liste
                </button>
              )}
            </div>

            {allFormations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <span className="material-symbols-outlined text-[40px] text-on-surface-variant/40 mb-2">school</span>
                <p className="text-sm text-on-surface-variant">Aucune formation créée sur la plateforme.</p>
              </div>
            ) : (
              <div className="table-responsive-wrapper">
                <table className="w-full text-left text-sm border-collapse min-w-[650px]">

                  <thead>
                    <tr className="border-b border-outline-variant/10 pb-2">
                      <th className="pb-2 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Formation</th>
                      <th className="pb-2 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Formateur</th>
                      <th className="pb-2 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Espace / Coworking</th>
                      <th className="pb-2 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Date début</th>
                      <th className="pb-2 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant text-center">Inscrits</th>
                      <th className="pb-2 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant text-right">Tarif</th>
                      <th className="pb-2 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant text-right">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/10">
                    {allFormations.map((f) => {
                      const formateurName = f.profiles ? `${f.profiles.prenom} ${f.profiles.nom}` : '—';
                      const dateDebut = new Date(f.date_debut).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
                      const heureDebut = new Date(f.date_debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

                      return (
                        <tr key={f.id} className="hover:bg-surface-container-low/30 transition-colors">
                          <td className="py-3 font-semibold text-primary">{f.titre}</td>
                          <td className="py-3 text-on-surface-variant">
                            <div>{formateurName}</div>
                            {f.profiles?.specialite && <div className="text-[10px] text-on-surface-variant/70">{f.profiles.specialite}</div>}
                          </td>
                          <td className="py-3 text-on-surface-variant">{f.espaces?.nom || '—'}</td>
                          <td className="py-3 text-on-surface-variant">
                            <div>{dateDebut}</div>
                            <div className="text-[10px] text-on-surface-variant/70">{heureDebut}</div>
                          </td>
                          <td className="py-3 text-center font-semibold text-on-surface-variant">
                            {f.nb_inscrits ?? 0} / {f.capacite_max}
                          </td>
                          <td className="py-3 text-right font-bold text-secondary">
                            {f.prix_inscription > 0
                              ? `${f.prix_inscription} DT`
                              : (f.est_gratuit || f.programme?.includes('[SESSION_GRATUITE]'))
                              ? 'Gratuit'
                              : <span className="text-slate-400 font-medium italic">Non défini</span>}
                          </td>
                          <td className="py-3 text-right">
                            <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-tight ${
                              f.statut === 'planifiee' ? 'bg-amber-100 text-amber-800' :
                              f.statut === 'en_cours' ? 'bg-emerald-100 text-emerald-800' :
                              f.statut === 'terminee' ? 'bg-sky-100 text-sky-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {f.statut === 'planifiee' ? 'Planifiée' : f.statut === 'en_cours' ? 'En cours' : f.statut === 'terminee' ? 'Terminée' : 'Annulée'}
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
        </div>

        {/* ─── Accès rapide à la supervision cross-tenant ─── */}
        <div className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/10 shadow-[0px_2px_4px_rgba(16,35,63,0.04)] bento-card mb-6">
          <div className="flex items-center gap-2 mb-5">
            <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 22 }}>shield</span>
            <h2 className="font-sora text-lg font-semibold text-primary">Supervision globale</h2>
            <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">Cross-tenant</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                label: 'Réservations globales',
                icon: 'event_available',
                desc: 'Supervisez toutes les réservations de tous les coworkings',
                accent: '#f95d00',
                bg: 'rgba(249,93,0,0.08)',
                to: '/super-admin/reservations',
              },
              {
                label: 'Paiements globaux',
                icon: 'account_balance_wallet',
                desc: 'Suivez tous les paiements membres cross-tenant',
                accent: '#8b5cf6',
                bg: 'rgba(139,92,246,0.08)',
                to: '/super-admin/payments',
              },
              {
                label: 'Formations globales',
                icon: 'school',
                desc: 'Gérez toutes les formations de la plateforme',
                accent: '#0ea5e9',
                bg: 'rgba(14,165,233,0.08)',
                to: '/super-admin/formations',
              },
              {
                label: 'Espaces globaux',
                icon: 'meeting_room',
                desc: 'Visualisez et activez/désactivez les espaces',
                accent: '#2fbe8f',
                bg: 'rgba(47,190,143,0.08)',
                to: '/super-admin/espaces',
              },
            ].map((item) => (
              <button
                key={item.to}
                onClick={() => navigate(item.to)}
                className="group flex flex-col items-start gap-3 rounded-2xl border border-outline-variant/10 p-4 hover:border-outline-variant/30 hover:shadow-md transition-all duration-200 text-left w-full"
                style={{ background: item.bg }}
              >
                <span className="flex items-center justify-center w-10 h-10 rounded-xl group-hover:scale-110 transition-transform"
                  style={{ background: `${item.accent}20`, color: item.accent }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 22 }}>{item.icon}</span>
                </span>
                <div>
                  <p className="font-sora font-semibold text-primary text-sm">{item.label}</p>
                  <p className="text-[11px] text-on-surface-variant mt-0.5 leading-snug">{item.desc}</p>
                </div>
                <span className="flex items-center gap-1 text-[11px] font-semibold mt-auto" style={{ color: item.accent }}>
                  Accéder
                  <span className="material-symbols-outlined group-hover:translate-x-0.5 transition-transform" style={{ fontSize: 14 }}>arrow_forward</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

    </PortalLayout>
  );
}