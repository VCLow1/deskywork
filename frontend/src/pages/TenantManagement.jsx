import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { superAdminApi } from '../services/superAdminApi';
import { supabase } from '../supabaseClient';
import { useSessionUser } from '../hooks/useSessionUser';
import PortalLayout from '../components/layout/PortalLayout';

const PLAN_LABELS = { free: 'Essentiel', starter: 'Essentiel', pro: 'Standard', enterprise: 'Premium', essentiel: 'Essentiel', standard: 'Standard', premium: 'Premium' };
const TIER_COLORS = { A: 'bg-secondary/10 text-secondary', B: 'bg-[#f95d00]/10 text-[#f95d00]', C: 'bg-surface-container text-on-surface-variant' };
const STATUT_STYLES = {
  actif: 'bg-[#2fbe8f1a] text-[#2fbe8f]',
  suspendu: 'bg-[#ff6f591a] text-[#ff6f59]',
  inactif: 'bg-surface-container text-on-surface-variant',
};

export default function TenantManagement({ session }) {
  const navigate = useNavigate();
  const { userId, email, metadata } = useSessionUser(session);
  const [profile, setProfile] = useState(() =>
    userId ? { id: userId, email, role: metadata.role || 'super_admin', ...metadata } : null
  );
  const [tenants, setTenants] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatut, setFilterStatut] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0 });
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = { page, limit: 10 };
      if (filterStatut) params.statut = filterStatut;
      if (search) params.search = search;
      const [data, s] = await Promise.all([
        superAdminApi.getTenants(params),
        superAdminApi.getStats().catch(() => null),
      ]);
      setTenants(data?.tenants || []);
      setPagination(data?.pagination || { total: 0 });
      if (s) setStats(s);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [page, filterStatut, search]);

  useEffect(() => {
    if (!userId) { navigate('/login'); return; }
    if (profile?.role && profile.role !== 'super_admin') { navigate('/admin/dashboard'); }
  }, [userId, profile, navigate]);

  useEffect(() => { if (profile) load(); }, [load, profile]);

  const handleLogout = async () => { await supabase.auth.signOut(); navigate('/login'); };

  const openEdit = (t) => { setForm({ ...t }); setModal('edit'); };

  const handleSave = async () => {
    setSaving(true);
    try {
      await superAdminApi.updateTenant(form.id, form);
      setModal(null);
      await load();
    } catch (e) { alert(e.message); }
    setSaving(false);
  };

  const handleToggleStatut = async (t) => {
    const newStatut = t.statut === 'actif' ? 'suspendu' : 'actif';
    try {
      await superAdminApi.updateTenant(t.id, { statut: newStatut });
      await load();
    } catch (e) { alert(e.message); }
  };

  const handleDelete = async (t) => {
    if (!confirm(`Supprimer "${t.nom}" ? Cette action est irréversible.`)) return;
    try {
      await superAdminApi.deleteTenant(t.id);
      await load();
    } catch (e) { alert(e.message); }
  };

  if (!profile) {
    return null;
  }


  const miniStats = [
    { label: 'Total', value: pagination.total, icon: 'domain', color: '#f95d00' },
    { label: 'Actifs', value: stats?.activeTenants ?? 0, icon: 'check_circle', color: '#f95d00' },
    { label: 'Suspendus', value: stats?.suspendedTenants ?? 0, icon: 'block', color: '#100f0d' },
  ];

  return (
    <PortalLayout profile={profile} onLogout={handleLogout}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-sora text-xl sm:text-2xl font-bold text-primary">Gestion des Coworkings</h1>
          <p className="text-on-surface-variant text-sm mt-1">Validez les inscriptions et gérez les coworkings de la plateforme.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
        {miniStats.map((s, i) => (
          <div key={i} className="bg-surface-container-lowest rounded-2xl p-4 shadow-[0px_2px_4px_rgba(16,35,63,0.04)] border border-outline-variant/10">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: s.color }}>{s.icon}</span>
              <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">{s.label}</span>
            </div>
            <p className="font-sora text-xl sm:text-2xl font-bold text-primary">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" style={{ fontSize: 20 }}>search</span>
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Rechercher un coworking..." className="w-full pl-10 pr-4 py-2.5 rounded-full bg-surface-container-low border border-outline-variant/30 text-sm focus:outline-none focus:border-secondary" />
        </div>
        <select value={filterStatut} onChange={(e) => { setFilterStatut(e.target.value); setPage(1); }} className="px-4 py-2.5 rounded-full bg-surface-container-low border border-outline-variant/30 text-sm focus:outline-none focus:border-secondary">
          <option value="">Tous les statuts</option>
          <option value="actif">Actif</option>
          <option value="suspendu">Suspendu</option>
          <option value="inactif">Inactif</option>
        </select>
      </div>

      <div className="bg-surface-container-lowest rounded-3xl shadow-[0px_8px_16px_rgba(16,35,63,0.08)] overflow-hidden">
        <div className="table-responsive-wrapper">
          <table className="w-full text-sm min-w-[650px]">

            <thead>
              <tr className="bg-primary-container text-white">
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider text-xs">Coworking</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider text-xs">Statut</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider text-xs">Niveau</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider text-xs">Plan</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider text-xs">Membres</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider text-xs">Espaces</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider text-xs">Montant</th>
                <th className="px-4 py-3 text-right font-semibold uppercase tracking-wider text-xs">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-b border-outline-variant/15 hover:bg-surface-container-low/50 transition-colors group">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-secondary/10 flex items-center justify-center font-sora font-bold text-secondary text-sm">{(t.nom || '?')[0]}</div>
                      <div>
                        <p className="font-semibold text-primary">{t.nom}</p>
                        <p className="text-xs text-on-surface-variant">{t.ville || '—'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3"><span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${STATUT_STYLES[t.statut] || ''}`}><span className="w-1.5 h-1.5 rounded-full bg-current" />{t.statut === 'actif' ? 'Actif' : t.statut === 'suspendu' ? 'Suspendu' : 'Inactif'}</span></td>
                  <td className="px-4 py-3"><span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${TIER_COLORS[t.tier] || ''}`}><span className="w-1.5 h-1.5 rounded-full bg-current" />Tier {t.tier}</span></td>
                  <td className="px-4 py-3"><span className="text-xs font-semibold text-on-surface-variant">{PLAN_LABELS[t.plan] || t.plan}</span></td>
                  <td className="px-4 py-3"><span className="font-semibold text-primary">{t.member_count || 0}</span></td>
                  <td className="px-4 py-3"><span className="font-semibold text-primary">{t.space_count || 0}</span></td>
                  <td className="px-4 py-3"><span className="font-semibold text-primary">{parseFloat(t.montant_mensuel || 0).toLocaleString('fr-TN')} DT</span></td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                      <button onClick={() => openEdit(t)} className="p-2 rounded-lg hover:bg-surface-container-high text-on-surface-variant" title="Gérer"><span className="material-symbols-outlined" style={{ fontSize: 18 }}>settings</span></button>
                      {t.statut === 'actif' ? (
                        <button onClick={() => handleToggleStatut(t)} className="p-2 rounded-lg hover:bg-[#ff6f591a] text-[#ff6f59]" title="Suspendre"><span className="material-symbols-outlined" style={{ fontSize: 18 }}>block</span></button>
                      ) : (
                        <button onClick={() => handleToggleStatut(t)} className="p-2 rounded-lg hover:bg-[#2fbe8f1a] text-[#2fbe8f]" title="Activer"><span className="material-symbols-outlined" style={{ fontSize: 18 }}>check_circle</span></button>
                      )}
                      <button onClick={() => handleDelete(t)} className="p-2 rounded-lg hover:bg-[#ff6f591a] text-[#ff6f59]" title="Supprimer"><span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete</span></button>
                    </div>
                  </td>
                </tr>
              ))}
              {tenants.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-on-surface-variant">Aucun coworking trouvé.</td></tr>
              )}

            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t border-outline-variant/15">
          <span className="text-xs text-on-surface-variant">{pagination.total} résultat(s)</span>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 rounded-lg border border-outline-variant/30 text-xs font-semibold disabled:opacity-40 hover:bg-surface-container-low">Précédent</button>
            <span className="text-xs font-semibold text-secondary px-2">Page {page}</span>
            <button disabled={tenants.length < 10} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 rounded-lg border border-outline-variant/30 text-xs font-semibold disabled:opacity-40 hover:bg-surface-container-low">Suivant</button>
          </div>
        </div>
      </div>

      {typeof document !== 'undefined' && modal === 'edit' && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.5)' }} onClick={() => setModal(null)}>
          <div style={{ background: 'var(--color-surface-container)', borderRadius: 16, width: '100%', maxWidth: 520, padding: 28, boxShadow: '0 25px 50px rgba(0,0,0,0.25)', maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontFamily: 'Sora, sans-serif', fontSize: 20, fontWeight: 700, color: '#100f0d', marginBottom: 20 }}>Modifier le Coworking</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { key: 'nom', label: 'Nom du coworking', required: true },
                { key: 'description', label: 'Description' },
                { key: 'adresse', label: 'Adresse' },
                { key: 'ville', label: 'Ville' },
                { key: 'email', label: 'Email de contact', type: 'email' },
                { key: 'telephone', label: 'Telephone' },
              ].map((f) => (
                <div key={f.key}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#44474d', marginBottom: 4, display: 'block' }}>{f.label}{f.required && ' *'}</label>
                  <input type={f.type || 'text'} value={form[f.key] || ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #c5c6ce', fontSize: 14, outline: 'none', background: '#f5f3f6', boxSizing: 'border-box' }} />
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#44474d', marginBottom: 4, display: 'block' }}>Plan</label>
                  <select value={form.plan || 'essentiel'} onChange={(e) => setForm({ ...form, plan: e.target.value })} style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #c5c6ce', fontSize: 14, background: '#f5f3f6', boxSizing: 'border-box' }}>
                    <option value="essentiel">Essentiel (90 DT HT)</option><option value="standard">Standard (150 DT HT)</option><option value="premium">Premium (220 DT HT)</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#44474d', marginBottom: 4, display: 'block' }}>Tier</label>
                  <select value={form.tier || 'C'} onChange={(e) => setForm({ ...form, tier: e.target.value })} style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #c5c6ce', fontSize: 14, background: '#f5f3f6', boxSizing: 'border-box' }}>
                    <option value="A">Tier A</option><option value="B">Tier B</option><option value="C">Tier C</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#44474d', marginBottom: 4, display: 'block' }}>Montant/Mois (DT)</label>
                  <input type="number" value={form.montant_mensuel || 0} onChange={(e) => setForm({ ...form, montant_mensuel: parseFloat(e.target.value) || 0 })} style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #c5c6ce', fontSize: 14, background: '#f5f3f6', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#44474d', marginBottom: 4, display: 'block' }}>Limite Membres</label>
                  <input type="number" value={form.limite_membres || 100} onChange={(e) => setForm({ ...form, limite_membres: parseInt(e.target.value) || 100 })} style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #c5c6ce', fontSize: 14, background: '#f5f3f6', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#44474d', marginBottom: 4, display: 'block' }}>Limite Espaces</label>
                  <input type="number" value={form.limite_espaces || 10} onChange={(e) => setForm({ ...form, limite_espaces: parseInt(e.target.value) || 10 })} style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #c5c6ce', fontSize: 14, background: '#f5f3f6', boxSizing: 'border-box' }} />
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
              <button onClick={() => setModal(null)} style={{ padding: '10px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600, border: '1px solid #c5c6ce', background: 'var(--color-surface-container)', cursor: 'pointer' }}>Annuler</button>
              <button onClick={handleSave} disabled={saving || !form.nom} style={{ padding: '10px 24px', borderRadius: 10, fontSize: 14, fontWeight: 600, background: '#f95d00', color: '#fff', border: 'none', cursor: 'pointer', opacity: saving || !form.nom ? 0.5 : 1 }}>{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </PortalLayout>
  );
}
