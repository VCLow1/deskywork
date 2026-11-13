import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { superAdminApi } from '../services/superAdminApi';
import { useSessionUser } from '../hooks/useSessionUser';
import PortalLayout from '../components/layout/PortalLayout';

const PAGE_SIZE = 20;

const STATUT_META = {
  paid: { label: 'Payé', bg: 'bg-emerald-100', text: 'text-emerald-800' },
  paye: { label: 'Payé', bg: 'bg-emerald-100', text: 'text-emerald-800' },
  pending: { label: 'En attente', bg: 'bg-amber-100', text: 'text-amber-700' },
  en_attente: { label: 'En attente', bg: 'bg-amber-100', text: 'text-amber-700' },
  failed: { label: 'Échoué', bg: 'bg-red-100', text: 'text-red-700' },
  echoue: { label: 'Échoué', bg: 'bg-red-100', text: 'text-red-700' },
  refunded: { label: 'Remboursé', bg: 'bg-sky-100', text: 'text-sky-800' },
  rembourse: { label: 'Remboursé', bg: 'bg-sky-100', text: 'text-sky-800' },
};

const MODE_META = {
  online: 'Sur place (legacy)',
  cash: 'Sur place (Espèces)',
  bank_transfer: 'Virement bancaire',
  check: 'Chèque',
};

function StatCard({ label, value, icon, accent = '#f95d00', sub }) {
  const bg = accent === '#2fbe8f' ? 'rgba(47,190,143,0.10)'
    : accent === '#ba1a1a' ? 'rgba(186,26,26,0.09)'
    : accent === '#8b5cf6' ? 'rgba(139,92,246,0.10)'
    : 'rgba(249,93,0,0.09)';
  return (
    <div className="bg-surface-container-lowest rounded-3xl border border-outline-variant/10 p-5 shadow-sm hover:-translate-y-0.5 transition-transform relative overflow-hidden">
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }} />
      <div className="flex items-center gap-2 mb-2">
        <span className="flex items-center justify-center w-8 h-8 rounded-xl" style={{ background: bg, color: accent }}>
          <span className="material-symbols-outlined" style={{ fontSize: 17 }}>{icon}</span>
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant">{label}</span>
      </div>
      <p className="font-sora font-bold text-primary text-xl">{value}</p>
      {sub && <p className="text-[11px] text-on-surface-variant mt-1">{sub}</p>}
    </div>
  );
}

export default function SuperAdminPayments({ session }) {
  const navigate = useNavigate();
  const { userId, email, metadata } = useSessionUser(session);
  const [profile] = useState(() =>
    userId ? { id: userId, email, role: metadata.role || 'super_admin', ...metadata } : null
  );

  const [payments, setPayments] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [filterTenant, setFilterTenant] = useState('');
  const [filterStatut, setFilterStatut] = useState('');
  const [notice, setNotice] = useState(null);

  const tenantsLoadedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: PAGE_SIZE };
      if (filterStatut) params.statut = filterStatut;
      if (filterTenant) params.tenant_id = filterTenant;
      if (search) params.search = search;

      const [payData, tenantsData] = await Promise.all([
        superAdminApi.getAllPayments(params),
        !tenantsLoadedRef.current ? superAdminApi.getTenants({ limit: 100 }).catch(() => ({ tenants: [] })) : Promise.resolve(null),
      ]);

      setPayments(payData?.payments || []);
      setTotal(payData?.pagination?.total || 0);

      if (tenantsData?.tenants) {
        tenantsLoadedRef.current = true;
        setTenants(tenantsData.tenants);
      }
    } catch (e) {
      console.error(e);
      setNotice({ type: 'error', msg: e.message || 'Erreur lors du chargement des paiements.' });
    } finally {
      setLoading(false);
    }
  }, [page, filterStatut, filterTenant, search]);

  useEffect(() => {
    if (!userId) { navigate('/login'); return; }
    if (profile?.role && profile.role !== 'super_admin') { navigate('/admin/dashboard'); }
  }, [userId, profile, navigate]);

  useEffect(() => { if (profile) load(); }, [load, profile]);

  const handleLogout = async () => { await supabase.auth.signOut(); navigate('/login'); };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const kpiPaye = payments.filter(p => p.statut === 'paid' || p.statut === 'paye').reduce((s, p) => s + (Number(p.montant) || 0), 0);
  const kpiEnAttente = payments.filter(p => p.statut === 'pending' || p.statut === 'en_attente').length;
  const kpiEchoue = payments.filter(p => p.statut === 'failed' || p.statut === 'echoue').length;

  if (!profile) return null;

  return (
    <PortalLayout profile={profile} onLogout={handleLogout}>
      <div className="p-2 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-on-surface-variant mb-1">Super Admin · Supervision</p>
            <h1 className="font-sora text-xl sm:text-2xl font-bold text-primary flex items-center gap-2">
              <span className="material-symbols-outlined text-[#8b5cf6]" style={{ fontSize: 26 }}>account_balance_wallet</span>
              Paiements globaux
            </h1>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200/60 text-amber-700 text-xs font-semibold">
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>shield</span>
            Vue cross-tenant — tous les coworkings
          </div>
        </div>

        {notice && (
          <div className={`mb-4 rounded-xl p-3 text-sm font-medium flex items-center gap-2 ${notice.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{notice.type === 'success' ? 'check_circle' : 'error'}</span>
            {notice.msg}
            <button className="ml-auto" onClick={() => setNotice(null)}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
            </button>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard label="Total paiements" value={total.toLocaleString('fr-FR')} icon="account_balance_wallet" accent="#f95d00" />
          <StatCard label="Volume payé (page)" value={`${kpiPaye.toLocaleString('fr-TN')} DT`} icon="payments" accent="#2fbe8f" />
          <StatCard label="En attente (page)" value={kpiEnAttente.toLocaleString('fr-FR')} icon="schedule" accent="#f59e0b" />
          <StatCard label="Échoués (page)" value={kpiEchoue.toLocaleString('fr-FR')} icon="error" accent="#ba1a1a" />
        </div>

        {/* Filters */}
        <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/10 p-4 mb-4 flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[160px]">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" style={{ fontSize: 17 }}>search</span>
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Membre, email ou référence…"
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-outline-variant/30 text-sm bg-transparent"
            />
          </div>
          <select value={filterTenant} onChange={e => { setFilterTenant(e.target.value); setPage(1); }}
            className="rounded-xl border border-outline-variant/30 px-3 py-2 text-sm bg-transparent min-w-[160px]">
            <option value="">Tous les coworkings</option>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
          </select>
          <select value={filterStatut} onChange={e => { setFilterStatut(e.target.value); setPage(1); }}
            className="rounded-xl border border-outline-variant/30 px-3 py-2 text-sm bg-transparent min-w-[140px]">
            <option value="">Tous statuts</option>
            {Object.entries(STATUT_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
          </select>
        </div>

        {/* Table */}
        <div className="bg-surface-container-lowest rounded-3xl border border-outline-variant/10 shadow-sm overflow-hidden mb-4">
          <div className="table-responsive-wrapper">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="border-b border-outline-variant/10 bg-surface-container-low/50">
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Membre</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Coworking</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Référence</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Date</th>
                  <th className="px-4 py-3 text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Montant</th>
                  <th className="px-4 py-3 text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Méthode</th>
                  <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {loading ? (
                  <tr><td colSpan={7} className="py-12 text-center text-on-surface-variant text-sm">Chargement…</td></tr>
                ) : payments.length === 0 ? (
                  <tr><td colSpan={7} className="py-12 text-center text-on-surface-variant text-sm">Aucun paiement trouvé.</td></tr>
                ) : payments.map(p => {
                  const meta = STATUT_META[p.statut] || { label: p.statut, bg: 'bg-surface-container', text: 'text-on-surface-variant' };
                  const date = new Date(p.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
                  const membre = p.profiles ? `${p.profiles.prenom || ''} ${p.profiles.nom || ''}`.trim() : '—';
                  return (
                    <tr key={p.id} className="hover:bg-surface-container-low/40 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-primary truncate max-w-[130px]">{membre}</p>
                        <p className="text-[11px] text-on-surface-variant truncate">{p.profiles?.email || ''}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-secondary/10 text-secondary">
                          <span className="material-symbols-outlined" style={{ fontSize: 11 }}>domain</span>
                          {p.tenants?.nom || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-on-surface-variant">{p.numero_recu || p.reference_externe || p.id.slice(0, 8)}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-on-surface-variant">{date}</td>
                      <td className="px-4 py-3 text-center font-bold text-secondary">
                        {p.montant ? `${Number(p.montant).toLocaleString('fr-TN')} DT` : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-xs capitalize text-on-surface-variant">{MODE_META[p.mode] || p.mode || '—'}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${meta.bg} ${meta.text}`}>{meta.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="px-4 py-3 border-t border-outline-variant/10 flex items-center justify-between text-xs text-on-surface-variant">
              <span>{total.toLocaleString('fr-FR')} paiement(s)</span>
              <div className="flex items-center gap-1">
                <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                  className="px-2.5 py-1.5 rounded-lg border border-outline-variant/20 disabled:opacity-40 hover:bg-surface-container-low transition-colors">
                  <span className="material-symbols-outlined" style={{ fontSize: 15 }}>chevron_left</span>
                </button>
                <span className="px-3 font-semibold">{page} / {totalPages}</span>
                <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)}
                  className="px-2.5 py-1.5 rounded-lg border border-outline-variant/20 disabled:opacity-40 hover:bg-surface-container-low transition-colors">
                  <span className="material-symbols-outlined" style={{ fontSize: 15 }}>chevron_right</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </PortalLayout>
  );
}
