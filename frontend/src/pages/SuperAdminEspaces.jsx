import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { superAdminApi } from '../services/superAdminApi';
import { useSessionUser } from '../hooks/useSessionUser';
import PortalLayout from '../components/layout/PortalLayout';

const PAGE_SIZE = 24;

const TYPE_META = {
  bureau: { label: 'Bureau privé', icon: 'work' },
  private_office: { label: 'Bureau privé', icon: 'work' },
  open_space: { label: 'Open space', icon: 'groups' },
  salle_reunion: { label: 'Salle de réunion', icon: 'meeting_room' },
  meeting_room: { label: 'Salle de réunion', icon: 'meeting_room' },
  salle_formation: { label: 'Salle de formation', icon: 'school' },
  training_room: { label: 'Salle de formation', icon: 'school' },
  espace_evenement: { label: 'Évènement', icon: 'celebration' },
  event_space: { label: 'Évènement', icon: 'celebration' },
  hot_desk: { label: 'Hot Desk', icon: 'laptop_mac' },
  dedicated_desk: { label: 'Dedicated Desk', icon: 'push_pin' },
  coworking: { label: 'Coworking', icon: 'desk' },
};

function StatCard({ label, value, icon, accent = '#f95d00' }) {
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
    </div>
  );
}

export default function SuperAdminEspaces({ session }) {
  const navigate = useNavigate();
  const { userId, email, metadata } = useSessionUser(session);
  const [profile] = useState(() =>
    userId ? { id: userId, email, role: metadata.role || 'super_admin', ...metadata } : null
  );

  const [espaces, setEspaces] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [filterTenant, setFilterTenant] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterActif, setFilterActif] = useState('');
  const [notice, setNotice] = useState(null);
  const [togglingId, setTogglingId] = useState(null);

  const tenantsLoadedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: PAGE_SIZE };
      if (filterTenant) params.tenant_id = filterTenant;
      if (filterType) params.type = filterType;
      if (search) params.search = search;

      const [espData, tenantsData] = await Promise.all([
        superAdminApi.getAllEspaces(params),
        !tenantsLoadedRef.current ? superAdminApi.getTenants({ limit: 100 }).catch(() => ({ tenants: [] })) : Promise.resolve(null),
      ]);

      let rows = espData?.espaces || [];
      if (filterActif !== '') {
        rows = rows.filter(e => String(e.actif) === filterActif);
      }

      setEspaces(rows);
      setTotal(espData?.pagination?.total || 0);

      if (tenantsData?.tenants) {
        tenantsLoadedRef.current = true;
        setTenants(tenantsData.tenants);
      }
    } catch (e) {
      console.error(e);
      setNotice({ type: 'error', msg: e.message || 'Erreur lors du chargement des espaces.' });
    } finally {
      setLoading(false);
    }
  }, [page, filterTenant, filterType, filterActif, search]);

  useEffect(() => {
    if (!userId) { navigate('/login'); return; }
    if (profile?.role && profile.role !== 'super_admin') { navigate('/admin/dashboard'); }
  }, [userId, profile, navigate]);

  useEffect(() => { if (profile) load(); }, [load, profile]);

  const handleLogout = async () => { await supabase.auth.signOut(); navigate('/login'); };

  const handleToggle = async (espace) => {
    setTogglingId(espace.id);
    try {
      await superAdminApi.toggleEspace(espace.id, !espace.actif);
      setNotice({ type: 'success', msg: `Espace "${espace.nom}" ${!espace.actif ? 'activé' : 'désactivé'}.` });
      setEspaces(prev => prev.map(e => e.id === espace.id ? { ...e, actif: !e.actif } : e));
    } catch (e) {
      setNotice({ type: 'error', msg: e.message });
    } finally {
      setTogglingId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const kpiActifs = espaces.filter(e => e.actif).length;
  const kpiInactifs = espaces.filter(e => !e.actif).length;
  const kpiCapaciteTotale = espaces.reduce((s, e) => s + (Number(e.capacite) || 0), 0);

  if (!profile) return null;

  return (
    <PortalLayout profile={profile} onLogout={handleLogout}>
      <div className="p-2 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-on-surface-variant mb-1">Super Admin · Supervision</p>
            <h1 className="font-sora text-xl sm:text-2xl font-bold text-primary flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 26 }}>meeting_room</span>
              Espaces globaux
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
          <StatCard label="Total espaces" value={total.toLocaleString('fr-FR')} icon="meeting_room" accent="#f95d00" />
          <StatCard label="Actifs (page)" value={kpiActifs.toLocaleString('fr-FR')} icon="check_circle" accent="#2fbe8f" />
          <StatCard label="Inactifs (page)" value={kpiInactifs.toLocaleString('fr-FR')} icon="block" accent="#ba1a1a" />
          <StatCard label="Capacité totale (page)" value={kpiCapaciteTotale.toLocaleString('fr-FR')} icon="people" accent="#8b5cf6" />
        </div>

        {/* Filters */}
        <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/10 p-4 mb-6 flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[160px]">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" style={{ fontSize: 17 }}>search</span>
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Nom d'espace ou coworking…"
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-outline-variant/30 text-sm bg-transparent"
            />
          </div>
          <select value={filterTenant} onChange={e => { setFilterTenant(e.target.value); setPage(1); }}
            className="rounded-xl border border-outline-variant/30 px-3 py-2 text-sm bg-transparent min-w-[160px]">
            <option value="">Tous les coworkings</option>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
          </select>
          <select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(1); }}
            className="rounded-xl border border-outline-variant/30 px-3 py-2 text-sm bg-transparent min-w-[140px]">
            <option value="">Tous types</option>
            {Object.entries(TYPE_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
          </select>
          <select value={filterActif} onChange={e => { setFilterActif(e.target.value); setPage(1); }}
            className="rounded-xl border border-outline-variant/30 px-3 py-2 text-sm bg-transparent min-w-[120px]">
            <option value="">Tous</option>
            <option value="true">Actifs</option>
            <option value="false">Inactifs</option>
          </select>
        </div>

        {/* Cards grid */}
        {loading ? (
          <div className="py-16 text-center text-on-surface-variant text-sm">Chargement…</div>
        ) : espaces.length === 0 ? (
          <div className="py-16 text-center text-on-surface-variant text-sm">Aucun espace trouvé.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-4">
            {espaces.map(e => {
              const typeMeta = TYPE_META[e.type] || { label: e.type, icon: 'meeting_room' };
              return (
                <div key={e.id} className={`bg-surface-container-lowest rounded-2xl border overflow-hidden shadow-sm transition-shadow hover:shadow-md ${e.actif ? 'border-outline-variant/10' : 'border-red-200/50 opacity-70'}`}>
                  {/* Color top bar */}
                  <div className={`h-1 w-full ${e.actif ? 'bg-gradient-to-r from-[#2fbe8f] to-transparent' : 'bg-gradient-to-r from-red-400 to-transparent'}`} />
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`flex items-center justify-center w-8 h-8 rounded-xl ${e.actif ? 'bg-secondary/10 text-secondary' : 'bg-red-50 text-red-400'}`}>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{typeMeta.icon}</span>
                        </span>
                        <p className="font-sora font-bold text-primary text-sm truncate max-w-[120px]">{e.nom}</p>
                      </div>
                      <span className={`shrink-0 w-2 h-2 rounded-full mt-1 ${e.actif ? 'bg-emerald-500' : 'bg-red-400'}`} />
                    </div>

                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-secondary/10 text-secondary mb-2">
                      <span className="material-symbols-outlined" style={{ fontSize: 10 }}>domain</span>
                      {e.tenants?.nom || '—'}
                    </span>

                    <div className="text-[11px] text-on-surface-variant space-y-1 mb-3">
                      <div className="flex items-center gap-1">
                        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>category</span>
                        {typeMeta.label}
                      </div>
                      {e.capacite && (
                        <div className="flex items-center gap-1">
                          <span className="material-symbols-outlined" style={{ fontSize: 13 }}>people</span>
                          Capacité : {e.capacite} pers.
                        </div>
                      )}
                      {(e.tarif_horaire || e.prix_heure) && (
                        <div className="flex items-center gap-1">
                          <span className="material-symbols-outlined" style={{ fontSize: 13 }}>sell</span>
                          {e.tarif_horaire || e.prix_heure} DT / heure
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => handleToggle(e)}
                      disabled={togglingId === e.id}
                      className={`w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 ${
                        e.actif
                          ? 'border border-red-200/60 text-red-600 hover:bg-red-50'
                          : 'border border-emerald-200/60 text-emerald-700 hover:bg-emerald-50'
                      }`}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 13 }}>
                        {togglingId === e.id ? 'sync' : e.actif ? 'block' : 'check_circle'}
                      </span>
                      {togglingId === e.id ? 'En cours…' : e.actif ? 'Désactiver' : 'Activer'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-xs text-on-surface-variant py-2">
            <span>{total.toLocaleString('fr-FR')} espace(s) au total</span>
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
    </PortalLayout>
  );
}
