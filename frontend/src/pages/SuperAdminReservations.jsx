import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { superAdminApi } from '../services/superAdminApi';
import { useSessionUser } from '../hooks/useSessionUser';
import PortalLayout from '../components/layout/PortalLayout';

const PAGE_SIZE = 20;

const STATUT_META = {
  confirmed: { label: 'Confirmée', bg: 'bg-emerald-100', text: 'text-emerald-800' },
  confirmee: { label: 'Confirmée', bg: 'bg-emerald-100', text: 'text-emerald-800' },
  pending: { label: 'En attente', bg: 'bg-amber-100', text: 'text-amber-700' },
  en_attente: { label: 'En attente', bg: 'bg-amber-100', text: 'text-amber-700' },
  cancelled: { label: 'Annulée', bg: 'bg-red-100', text: 'text-red-700' },
  annulee: { label: 'Annulée', bg: 'bg-red-100', text: 'text-red-700' },
  completed: { label: 'Terminée', bg: 'bg-sky-100', text: 'text-sky-800' },
  terminee: { label: 'Terminée', bg: 'bg-sky-100', text: 'text-sky-800' },
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

export default function SuperAdminReservations({ session }) {
  const navigate = useNavigate();
  const { userId, email, metadata } = useSessionUser(session);
  const [profile] = useState(() =>
    userId ? { id: userId, email, role: metadata.role || 'super_admin', ...metadata } : null
  );

  const [reservations, setReservations] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [filterTenant, setFilterTenant] = useState('');
  const [filterStatut, setFilterStatut] = useState('');
  const [cancelModal, setCancelModal] = useState(null);
  const [cancelMotif, setCancelMotif] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  const tenantsLoadedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: PAGE_SIZE };
      if (filterStatut) params.statut = filterStatut;
      if (filterTenant) params.tenant_id = filterTenant;
      if (search) params.search = search;

      const [resData, tenantsData] = await Promise.all([
        superAdminApi.getAllReservations(params),
        !tenantsLoadedRef.current ? superAdminApi.getTenants({ limit: 100 }).catch(() => ({ tenants: [] })) : Promise.resolve(null),
      ]);

      setReservations(resData?.reservations || []);
      setTotal(resData?.pagination?.total || 0);

      if (tenantsData?.tenants) {
        tenantsLoadedRef.current = true;
        setTenants(tenantsData.tenants);
      }
    } catch (e) {
      console.error(e);
      setNotice({ type: 'error', msg: e.message || 'Erreur lors du chargement des réservations.' });
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

  const handleCancel = async () => {
    if (!cancelModal) return;
    setSaving(true);
    try {
      await superAdminApi.cancelReservation(cancelModal.id, cancelMotif);
      setNotice({ type: 'success', msg: 'Réservation annulée avec succès.' });
      setCancelModal(null);
      setCancelMotif('');
      load();
    } catch (e) {
      setNotice({ type: 'error', msg: e.message });
    } finally {
      setSaving(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const kpiConfirmee = reservations.filter(r => r.statut === 'confirmed' || r.statut === 'confirmee').length;
  const kpiAnnulee = reservations.filter(r => r.statut === 'cancelled' || r.statut === 'annulee').length;
  const kpiCa = reservations.filter(r => r.statut !== 'cancelled' && r.statut !== 'annulee').reduce((s, r) => s + (Number(r.montant) || 0), 0);

  if (!profile) return null;

  return (
    <PortalLayout profile={profile} onLogout={handleLogout}>
      <div className="p-2 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-on-surface-variant mb-1">Super Admin · Supervision</p>
            <h1 className="font-sora text-xl sm:text-2xl font-bold text-primary flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 26 }}>event_available</span>
              Réservations globales
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
          <StatCard label="Total réservations" value={total.toLocaleString('fr-FR')} icon="event_available" accent="#f95d00" />
          <StatCard label="Confirmées (page)" value={kpiConfirmee.toLocaleString('fr-FR')} icon="check_circle" accent="#2fbe8f" />
          <StatCard label="Annulées (page)" value={kpiAnnulee.toLocaleString('fr-FR')} icon="cancel" accent="#ba1a1a" />
          <StatCard label="CA affiché" value={`${kpiCa.toLocaleString('fr-TN')} DT`} icon="payments" accent="#8b5cf6" />
        </div>

        {/* Filters */}
        <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/10 p-4 mb-4 flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[160px]">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" style={{ fontSize: 17 }}>search</span>
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Rechercher membre / email…"
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
            <table className="w-full text-sm min-w-[750px]">
              <thead>
                <tr className="border-b border-outline-variant/10 bg-surface-container-low/50">
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Membre</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Coworking · Espace</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Période</th>
                  <th className="px-4 py-3 text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Montant</th>
                  <th className="px-4 py-3 text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Statut</th>
                  <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {loading ? (
                  <tr><td colSpan={6} className="py-12 text-center text-on-surface-variant text-sm">Chargement…</td></tr>
                ) : reservations.length === 0 ? (
                  <tr><td colSpan={6} className="py-12 text-center text-on-surface-variant text-sm">Aucune réservation trouvée.</td></tr>
                ) : reservations.map(r => {
                  const meta = STATUT_META[r.statut] || { label: r.statut, bg: 'bg-surface-container', text: 'text-on-surface-variant' };
                  const debut = r.date_debut ? new Date(r.date_debut).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
                  const fin = r.date_fin ? new Date(r.date_fin).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '—';
                  const membre = r.profiles ? `${r.profiles.prenom || ''} ${r.profiles.nom || ''}`.trim() : '—';
                  const coworking = r.espaces?.tenants?.nom || '—';
                  const espace = r.espaces?.nom || '—';
                  return (
                    <tr key={r.id} className="hover:bg-surface-container-low/40 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-primary truncate max-w-[140px]">{membre}</p>
                        <p className="text-[11px] text-on-surface-variant truncate">{r.profiles?.email || ''}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-secondary/10 text-secondary mb-1">
                          <span className="material-symbols-outlined" style={{ fontSize: 11 }}>domain</span>
                          {coworking}
                        </span>
                        <p className="text-[11px] text-on-surface-variant">{espace}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-on-surface-variant">
                        <p>{debut}</p>
                        <p className="text-[11px]">→ {fin}</p>
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-secondary">
                        {r.montant ? `${Number(r.montant).toLocaleString('fr-TN')} DT` : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${meta.bg} ${meta.text}`}>{meta.label}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {r.statut !== 'annulee' && r.statut !== 'terminee' && (
                          <button
                            onClick={() => setCancelModal(r)}
                            className="flex items-center gap-1 ml-auto px-3 py-1.5 rounded-full border text-[11px] font-semibold hover:bg-red-50 transition-colors"
                            style={{ borderColor: 'rgba(186,26,26,0.3)', color: '#ba1a1a' }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>cancel</span>
                            Annuler
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="px-4 py-3 border-t border-outline-variant/10 flex items-center justify-between text-xs text-on-surface-variant">
              <span>{total.toLocaleString('fr-FR')} résultat(s)</span>
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

      {/* Modal annulation */}
      {cancelModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setCancelModal(null)} />
          <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl p-7">
            <h2 className="font-sora text-lg font-bold text-primary mb-1">Annuler la réservation</h2>
            <p className="text-sm text-on-surface-variant mb-4">
              Vous êtes sur le point d'annuler la réservation de{' '}
              <strong>{cancelModal.profiles ? `${cancelModal.profiles.prenom} ${cancelModal.profiles.nom}` : '—'}</strong>.
            </p>
            <label className="block text-xs font-semibold text-on-surface-variant mb-1">Motif (optionnel)</label>
            <textarea
              value={cancelMotif}
              onChange={e => setCancelMotif(e.target.value)}
              className="w-full rounded-xl border border-outline-variant/30 p-3 text-sm resize-none mb-4"
              rows={3}
              placeholder="Ex : Non-respect des règles du coworking…"
            />
            <div className="flex gap-3">
              <button onClick={() => setCancelModal(null)}
                className="flex-1 py-2.5 rounded-xl border border-outline-variant/30 text-sm font-semibold hover:bg-surface-container-low transition-colors">
                Retour
              </button>
              <button onClick={handleCancel} disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60 transition-colors">
                {saving ? 'En cours…' : 'Confirmer l\'annulation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
