import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { superAdminApi } from '../services/superAdminApi';
import { useSessionUser } from '../hooks/useSessionUser';
import PortalLayout from '../components/layout/PortalLayout';

const ROLES = [
  { value: '', label: 'Tous les rôles' },
  { value: 'member', label: 'Membre' },
  { value: 'admin', label: 'Administrateur' },
  { value: 'staff', label: 'Staff' },
  { value: 'formateur', label: 'Formateur' },
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'guest', label: 'Invité' },
];

const STATUTS = [
  { value: '', label: 'Tous statuts' },
  { value: 'actif', label: 'Actif' },
  { value: 'suspendu', label: 'Suspendu' },
  { value: 'en_attente', label: 'En attente' },
];

const ROLE_COLORS = {
  member:      { bg: 'rgba(249,93,0,0.10)',  text: '#f95d00',  label: 'Membre' },
  admin:       { bg: 'rgba(16,15,13,0.10)',  text: '#100f0d',  label: 'Admin' },
  staff:       { bg: 'rgba(249,93,0,0.10)',  text: '#f95d00',  label: 'Staff' },
  formateur:   { bg: 'rgba(249,93,0,0.12)',  text: '#f95d00',  label: 'Formateur' },
  super_admin: { bg: 'rgba(16,15,13,0.15)',  text: '#100f0d',  label: 'Super Admin' },
  guest:       { bg: 'rgba(16,15,13,0.06)',  text: '#100f0d',  label: 'Invité' },
};

const STATUT_COLORS = {
  actif:      { bg: 'rgba(47,190,143,0.10)', text: '#15803d', label: 'Actif' },
  suspendu:   { bg: 'rgba(220,38,38,0.09)',  text: '#b91c1c', label: 'Suspendu' },
  en_attente: { bg: 'rgba(245,158,11,0.10)', text: '#b45309', label: 'En attente' },
};

const PAGE_SIZE = 30;

const styles = `
@keyframes fadeSlide { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
.user-row { animation: fadeSlide .25s ease-out both; }
`;

/* ─── Modal Modifier Utilisateur ─── */
function EditUserModal({ user, onClose, onSave, loading }) {
  const [form, setForm] = useState({
    role: user.role || 'member',
    statut_compte: user.statut_compte || 'actif',
    nom: user.nom || '',
    prenom: user.prenom || '',
  });

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl p-7"
        style={{ animation: 'popIn 0.2s cubic-bezier(.34,1.56,.64,1)' }}>
        <style>{`@keyframes popIn { from { transform:scale(.95) translateY(8px); opacity:0; } to { transform:scale(1) translateY(0); opacity:1; } }`}</style>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-secondary/10 flex items-center justify-center">
            <span className="material-symbols-outlined text-secondary" style={{ fontSize: 20 }}>manage_accounts</span>
          </div>
          <div>
            <h2 className="font-sora font-bold text-primary text-lg leading-tight">Modifier l'utilisateur</h2>
            <p className="text-xs text-on-surface-variant">{user.prenom} {user.nom} · {user.email}</p>
          </div>
          <button onClick={onClose} className="ml-auto text-on-surface-variant hover:text-primary">
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">Prénom</label>
            <input value={form.prenom} onChange={e => setForm(f => ({ ...f, prenom: e.target.value }))}
              className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-low px-3.5 py-2.5 text-sm outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/15" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">Nom</label>
            <input value={form.nom} onChange={e => setForm(f => ({ ...f, nom: e.target.value }))}
              className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-low px-3.5 py-2.5 text-sm outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/15" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">Rôle</label>
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-low px-3.5 py-2.5 text-sm outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/15">
              {ROLES.filter(r => r.value && r.value !== 'super_admin').map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">Statut du compte</label>
            <select value={form.statut_compte} onChange={e => setForm(f => ({ ...f, statut_compte: e.target.value }))}
              className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-low px-3.5 py-2.5 text-sm outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/15">
              {STATUTS.filter(s => s.value).map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2.5 border border-outline-variant/30 text-on-surface-variant rounded-xl font-semibold text-sm hover:bg-surface-container transition-colors">
            Annuler
          </button>
          <button onClick={() => onSave(form)} disabled={loading}
            className="flex-1 py-2.5 bg-secondary text-white rounded-xl font-bold text-sm hover:bg-secondary/90 disabled:opacity-50 transition-colors">
            {loading ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SuperAdminUsers({ session }) {
  const navigate = useNavigate();
  const { userId, email, metadata } = useSessionUser(session);
  const [profile, setProfile] = useState(() =>
    userId ? { id: userId, email, role: metadata.role || 'super_admin', ...metadata } : null
  );
  const [users, setUsers] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ role: '', statut: '', search: '' });
  const [searchInput, setSearchInput] = useState('');
  const [editUser, setEditUser] = useState(null);
  const [toast, setToast] = useState('');
  const [toastErr, setToastErr] = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3500); };
  const showError = (msg) => { setToastErr(msg); setTimeout(() => setToastErr(''), 4000); };

  useEffect(() => {
    if (!userId) { navigate('/login'); return; }
    if (profile?.role && profile.role !== 'super_admin') { navigate('/super-admin/dashboard'); return; }
  }, [userId, navigate]);

  const loadData = useCallback(async () => {
    try {
      const params = { page, limit: PAGE_SIZE };
      if (filters.role) params.role = filters.role;
      if (filters.statut) params.statut = filters.statut;
      if (filters.search) params.search = filters.search;
      const [res, sumRes] = await Promise.all([
        superAdminApi.getUsers(params),
        superAdminApi.getRolesSummary().catch(() => ({ summary: [] })),
      ]);
      setUsers(res?.users || []);
      setTotal(res?.pagination?.total || 0);
      if (sumRes?.summary) setSummary(sumRes.summary);
    } catch (e) { showError(e.message); }
    finally { setLoading(false); }
  }, [page, filters]);

  useEffect(() => { if (profile) loadData(); }, [profile, loadData]);

  const handleSearch = (e) => {
    e.preventDefault();
    setFilters(f => ({ ...f, search: searchInput }));
    setPage(1);
  };

  const handleFilter = (key, val) => {
    setFilters(f => ({ ...f, [key]: val }));
    setPage(1);
  };

  const handleEdit = async (form) => {
    setActionLoading(true);
    try {
      await superAdminApi.updateUser(editUser.id, form);
      showToast('Utilisateur mis à jour avec succès.');
      setEditUser(null);
      loadData();
    } catch (e) { showError(e.message); }
    setActionLoading(false);
  };

  const handleDelete = async (user) => {
    if (!confirm(`Supprimer définitivement "${user.prenom} ${user.nom}" (${user.email}) ? Cette action est irréversible.`)) return;
    setActionLoading(true);
    try {
      await superAdminApi.deleteUser(user.id);
      showToast(`Utilisateur "${user.prenom} ${user.nom}" supprimé.`);
      loadData();
    } catch (e) { showError(e.message); }
    setActionLoading(false);
  };

  const handleLogout = async () => { await supabase.auth.signOut(); navigate('/login'); };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (!profile) return null;


  return (
    <PortalLayout profile={profile} onLogout={handleLogout}>
      <style>{styles}</style>

      {/* Toast */}
      {toast && (
        <div className="fixed top-20 right-4 z-[9998] flex items-center gap-2 px-5 py-3 bg-emerald-600 text-white rounded-2xl shadow-xl text-sm font-semibold animate-bounce">
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>check_circle</span>
          {toast}
        </div>
      )}
      {toastErr && (
        <div className="fixed top-20 right-4 z-[9998] flex items-center gap-2 px-5 py-3 bg-red-600 text-white rounded-2xl shadow-xl text-sm font-semibold">
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>error</span>
          {toastErr}
        </div>
      )}

      {/* Modal */}
      {editUser && (
        <EditUserModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onSave={handleEdit}
          loading={actionLoading}
        />
      )}

      {/* Header */}
      <div className="mb-6 sm:mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-2xl bg-secondary/10 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-secondary" style={{ fontSize: 22 }}>group</span>
          </div>
          <h1 className="font-sora text-xl sm:text-2xl font-bold text-primary">Gestion des Utilisateurs</h1>
        </div>
        <p className="text-on-surface-variant text-sm">Gérez tous les utilisateurs de la plateforme VCLOW</p>
      </div>

      {/* Résumé par rôle */}
      {summary.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3 mb-6 sm:mb-8">
          {summary.map(({ role, count }) => {
            const cfg = ROLE_COLORS[role] || { bg: '#f0f0f0', text: '#666', label: role };
            return (
              <button
                key={role}
                onClick={() => { handleFilter('role', filters.role === role ? '' : role); }}
                className={`rounded-2xl p-3 sm:p-4 text-left transition-all hover:-translate-y-0.5 cursor-pointer border-2 ${filters.role === role ? 'border-secondary shadow-md' : 'border-transparent'}`}
                style={{ background: cfg.bg }}
              >
                <p className="font-sora font-bold text-lg sm:text-xl" style={{ color: cfg.text }}>{count}</p>
                <p className="text-xs font-semibold mt-0.5" style={{ color: cfg.text }}>{cfg.label}</p>
              </button>
            );
          })}
        </div>
      )}

      {/* Filtres */}
      <div className="bg-surface-container-lowest rounded-3xl p-4 sm:p-5 mb-6 shadow-sm flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 items-stretch sm:items-center">
        <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1 min-w-[200px]">
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant" style={{ fontSize: 18 }}>search</span>
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Rechercher par nom, prénom, email…"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-outline-variant/30 bg-surface-container-low text-sm outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/15"
            />
          </div>
          <button type="submit" className="px-4 py-2.5 bg-secondary text-white rounded-xl text-sm font-semibold hover:bg-secondary/90 transition-colors shrink-0">
            Filtrer
          </button>
        </form>

        <div className="flex items-center gap-2 flex-wrap">
          <select value={filters.role} onChange={e => handleFilter('role', e.target.value)}
            className="flex-1 sm:flex-none px-3.5 py-2.5 rounded-xl border border-outline-variant/30 bg-surface-container-low text-sm outline-none focus:border-secondary">
            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>

          <select value={filters.statut} onChange={e => handleFilter('statut', e.target.value)}
            className="flex-1 sm:flex-none px-3.5 py-2.5 rounded-xl border border-outline-variant/30 bg-surface-container-low text-sm outline-none focus:border-secondary">
            {STATUTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>

          {(filters.role || filters.statut || filters.search) && (
            <button onClick={() => { setFilters({ role: '', statut: '', search: '' }); setSearchInput(''); setPage(1); }}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-on-surface-variant border border-outline-variant/30 rounded-xl hover:bg-surface-container transition-colors">
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
              Réinitialiser
            </button>
          )}
        </div>

        <span className="sm:ml-auto text-xs sm:text-sm text-on-surface-variant font-medium shrink-0">
          {total.toLocaleString('fr-FR')} utilisateur{total > 1 ? 's' : ''}
        </span>
      </div>

      {/* Tableau */}
      <div className="bg-surface-container-lowest rounded-3xl shadow-sm overflow-hidden">
        {loading && users.length === 0 ? (
          <div className="p-6 space-y-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 animate-pulse">
                <div className="w-9 h-9 rounded-2xl bg-gray-200" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-32 bg-gray-200 rounded" />
                  <div className="h-3 w-48 bg-gray-100 rounded" />
                </div>
                <div className="h-5 w-20 bg-gray-200 rounded-full" />
                <div className="h-5 w-20 bg-gray-200 rounded-full" />
              </div>
            ))}
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <span className="material-symbols-outlined text-[48px] text-on-surface-variant/30 mb-3">person_off</span>
            <p className="font-semibold text-primary">Aucun utilisateur trouvé</p>
            <p className="text-sm text-on-surface-variant mt-1">Modifiez vos filtres pour afficher des résultats.</p>
          </div>
        ) : (
          <div className="table-responsive-wrapper">
            <table className="w-full text-sm min-w-[680px]">
              <thead>
                <tr className="border-b border-outline-variant/15">

                  <th className="text-left px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Utilisateur</th>
                  <th className="text-left px-4 py-3.5 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Rôle</th>
                  <th className="text-left px-4 py-3.5 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Coworking</th>
                  <th className="text-left px-4 py-3.5 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Statut</th>
                  <th className="text-left px-4 py-3.5 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Inscription</th>
                  <th className="text-right px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/8">
                {users.map((u, i) => {
                  const roleCfg = ROLE_COLORS[u.role] || { bg: '#f0f0f0', text: '#666', label: u.role };
                  const statutCfg = STATUT_COLORS[u.statut_compte] || { bg: 'rgba(100,116,139,0.1)', text: '#475569', label: u.statut_compte };
                  const initials = `${u.prenom?.[0] || ''}${u.nom?.[0] || ''}`.toUpperCase() || '?';
                  const dateInscrit = u.created_at ? new Date(u.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
                  return (
                    <tr key={u.id} className="user-row hover:bg-surface-container-low/50 transition-colors" style={{ animationDelay: `${i * 0.02}s` }}>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-2xl flex items-center justify-center font-bold text-sm shrink-0"
                            style={{ background: roleCfg.bg, color: roleCfg.text }}>
                            {initials}
                          </div>
                          <div>
                            <p className="font-semibold text-primary">{u.prenom} {u.nom}</p>
                            <p className="text-xs text-on-surface-variant">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold"
                          style={{ background: roleCfg.bg, color: roleCfg.text }}>
                          {roleCfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        {u.tenants ? (
                          <span className="text-xs font-semibold text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded-lg">
                            {u.tenants.nom}
                          </span>
                        ) : (
                          <span className="text-xs text-on-surface-variant/50">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold"
                          style={{ background: statutCfg.bg, color: statutCfg.text }}>
                          {statutCfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-on-surface-variant">{dateInscrit}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1.5 justify-end">
                          {/* Activer / Suspendre / Approuver */}
                          {u.statut_compte === 'actif' ? (
                            <button
                              onClick={() => superAdminApi.updateUser(u.id, { statut_compte: 'suspendu' }).then(() => { showToast('Compte suspendu.'); loadData(); }).catch(e => showError(e.message))}
                              title="Suspendre"
                              className="w-8 h-8 rounded-xl flex items-center justify-center text-amber-500 hover:bg-amber-50 transition-colors"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>pause_circle</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => superAdminApi.updateUser(u.id, { statut_compte: 'actif' }).then(() => { showToast('Compte approuvé et activé.'); loadData(); }).catch(e => showError(e.message))}
                              title={u.statut_compte === 'en_attente' ? "Approuver le compte" : "Activer"}
                              className={`h-8 px-2.5 rounded-xl flex items-center gap-1 font-bold text-xs ${
                                u.statut_compte === 'en_attente'
                                  ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm'
                                  : 'text-emerald-600 hover:bg-emerald-50'
                              } transition-colors`}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                                {u.statut_compte === 'en_attente' ? 'check_circle' : 'play_circle'}
                              </span>
                              {u.statut_compte === 'en_attente' && <span>Approuver</span>}
                            </button>
                          )}
                          {/* Modifier */}
                          <button
                            onClick={() => setEditUser(u)}
                            title="Modifier"
                            className="w-8 h-8 rounded-xl flex items-center justify-center text-secondary hover:bg-secondary/10 transition-colors"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>edit</span>
                          </button>
                          {/* Supprimer (sauf super_admin) */}
                          {u.role !== 'super_admin' && (
                            <button
                              onClick={() => handleDelete(u)}
                              title="Supprimer"
                              className="w-8 h-8 rounded-xl flex items-center justify-center text-red-400 hover:bg-red-50 transition-colors"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-4 border-t border-outline-variant/15">
            <p className="text-xs text-on-surface-variant">
              Page {page} sur {totalPages} · {total} utilisateurs
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="w-8 h-8 rounded-xl border border-outline-variant/30 flex items-center justify-center text-on-surface-variant hover:bg-surface-container disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_left</span>
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const pg = page <= 3 ? i + 1 : page - 2 + i;
                if (pg > totalPages) return null;
                return (
                  <button key={pg} onClick={() => setPage(pg)}
                    className={`w-8 h-8 rounded-xl text-sm font-semibold transition-colors ${pg === page ? 'bg-secondary text-white' : 'border border-outline-variant/30 text-on-surface-variant hover:bg-surface-container'}`}>
                    {pg}
                  </button>
                );
              })}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="w-8 h-8 rounded-xl border border-outline-variant/30 flex items-center justify-center text-on-surface-variant hover:bg-surface-container disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_right</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
