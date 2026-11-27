import React, { useEffect, useState, useMemo } from 'react';
import PortalLayout from '../components/layout/PortalLayout';
import { useSessionUser } from '../hooks/useSessionUser';
import { tenantAdminApi } from '../services/api';
import { normalizeTunisianPhone, validateTunisianPhone } from '../utils/tunisianPhone';
import TunisianPhoneInput from '../components/common/TunisianPhoneInput';
import { PERMISSION_DEFINITIONS, HARD_LOCKED_KEYS_FOR_STAFF } from '../utils/permissionsMatrix';

export default function AdminTeam({ session, embedded = false }) {
  const { userId, email, metadata } = useSessionUser(session);
  const profile = useMemo(
    () => (userId ? { id: userId, email, role: metadata.role || 'admin', prenom: metadata.prenom || '', nom: metadata.nom || '', ...metadata } : null),
    [userId, email, metadata]
  );
  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState([]);
  const [quota, setQuota] = useState({ used: 0, max: 1, pack: 'Essentiel', remaining: 1 });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [tempPwd, setTempPwd] = useState('');
  const [form, setForm] = useState({ nom: '', prenom: '', email: '', telephone: '', custom_role_code: 'staff' });
  const [rolesMatrix, setRolesMatrix] = useState([]);
  const [savingMatrix, setSavingMatrix] = useState(false);
  const [newRoleLabel, setNewRoleLabel] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [res, matrixRes] = await Promise.all([
        tenantAdminApi.getStaff(),
        tenantAdminApi.getRolesPermissions().catch(() => ({ roles: [] })),
      ]);
      setStaff(res.staff || []);
      if (res.quota) setQuota(res.quota);
      if (Array.isArray(matrixRes?.roles)) setRolesMatrix(matrixRes.roles);
    } catch (e) {
      setError(e.message || 'Impossible de charger l\'équipe.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    setTempPwd('');
    if (form.telephone && form.telephone.trim()) {
      const check = validateTunisianPhone(form.telephone);
      if (!check.valid) {
        setError(check.error);
        return;
      }
    }
    setCreating(true);
    try {
      const payload = {
        ...form,
        telephone: form.telephone?.trim() ? normalizeTunisianPhone(form.telephone) : '',
      };
      const res = await tenantAdminApi.createStaff(payload);
      if (res.temporary_password) setTempPwd(res.temporary_password);
      setMsg(res.message || 'Compte Staff créé.');
      setForm({ nom: '', prenom: '', email: '', telephone: '', custom_role_code: 'staff' });
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleToggleRolePerm = (roleCode, permKey) => {
    if (roleCode === 'admin') return;
    if (roleCode === 'staff' && HARD_LOCKED_KEYS_FOR_STAFF.has(permKey)) return;
    setRolesMatrix((prev) =>
      prev.map((r) =>
        r.code === roleCode
          ? { ...r, permissions: { ...(r.permissions || {}), [permKey]: !r.permissions?.[permKey] } }
          : r
      )
    );
  };

  const handleAddCustomRole = () => {
    const label = newRoleLabel.trim();
    if (!label) return;
    const code = label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_');
    if (!code || rolesMatrix.some((r) => r.code === code)) return;
    const emptyPerms = Object.fromEntries(PERMISSION_DEFINITIONS.map((p) => [p.key, false]));
    setRolesMatrix((prev) => [...prev, { code, label, is_system: false, permissions: emptyPerms }]);
    setNewRoleLabel('');
  };

  const handleSaveMatrix = async () => {
    setSavingMatrix(true);
    setError('');
    try {
      const res = await tenantAdminApi.updateRolesPermissions({ roles: rolesMatrix });
      if (Array.isArray(res?.roles)) setRolesMatrix(res.roles);
      setMsg('Matrice des rôles et permissions enregistrée.');
    } catch (err) {
      setError(err.message || 'Erreur lors de la sauvegarde.');
    } finally {
      setSavingMatrix(false);
    }
  };

  const handleAssignMemberRole = async (member, customRoleCode) => {
    try {
      await tenantAdminApi.updateStaff(member.id, { custom_role_code: customRoleCode });
      setMsg('Rôle mis à jour.');
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleToggleSuspend = async (member) => {
    const next = member.statut_compte === 'suspendu' ? 'actif' : 'suspendu';
    try {
      await tenantAdminApi.updateStaff(member.id, { statut_compte: next });
      setMsg(`Compte Staff ${next === 'suspendu' ? 'suspendu' : 'réactivé'}.`);
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (member) => {
    if (!window.confirm(`Archiver le compte Staff "${member.prenom} ${member.nom}" ?`)) return;
    try {
      const res = await tenantAdminApi.deleteStaff(member.id);
      setMsg(res.message || 'Compte archivé.');
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  };

  const quotaPct = quota.max > 0 ? Math.min(100, Math.round((quota.used / quota.max) * 100)) : 100;
  const quotaFull = quota.used >= quota.max;

  const content = (
    <div>
      {!embedded && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-sora font-bold text-2xl sm:text-3xl text-[#100f0d]">Équipe (Staff & Réception)</h1>
            <p className="text-sm text-on-surface-variant">
              Créez des accès Staff avec permissions opérationnelles restreintes (Essentiel : 1, Standard : 3, Premium : 10).
            </p>
          </div>
          <button
            type="button"
            disabled={quotaFull}
            onClick={() => { setTempPwd(''); setShowCreate(true); }}
            className="px-4 py-2.5 rounded-xl bg-[#f95d00] text-white font-semibold text-sm hover:bg-[#e55500] disabled:opacity-45 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>badge</span>
            Ajouter un réceptionniste
          </button>
        </div>
      )}
      {embedded && (
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            disabled={quotaFull}
            onClick={() => { setTempPwd(''); setShowCreate(true); }}
            style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
            className="px-4 py-2 rounded-xl font-semibold text-xs sm:text-sm disabled:opacity-45 flex items-center gap-2"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 17 }}>badge</span>
            Ajouter un réceptionniste
          </button>
        </div>
      )}

      {/* Jauge quota Staff selon Pack actif */}
      <div className="bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              Quota comptes Staff · Pack {quota.pack}
            </p>
            <p className="font-sora font-bold text-lg text-primary">
              {quota.used} / {quota.max} compte(s) utilisé(s)
            </p>
          </div>
          {quotaFull && (
            <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">
              Limite atteinte — Passez au pack supérieur dans « Mon Abonnement »
            </span>
          )}
        </div>
        <div className="h-2.5 rounded-full bg-surface-container-low overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${quotaPct}%`, background: quotaFull ? '#ba1a1a' : '#f95d00' }}
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
      )}
      {msg && (
        <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">{msg}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Liste Staff */}
        <div className="lg:col-span-7 bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15">
          <h2 className="font-sora font-bold text-base text-primary mb-4">Membres du staff</h2>
          {loading ? (
            <p className="text-sm text-on-surface-variant py-6 text-center">Chargement…</p>
          ) : staff.length === 0 ? (
            <div className="py-10 text-center text-sm text-on-surface-variant">
              Aucun compte Staff / Réceptionniste configuré pour cet établissement.
            </div>
          ) : (
            <div className="divide-y divide-outline-variant/10">
              {staff.map((s) => (
                <div key={s.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-[#100f0d] text-sm">{s.prenom} {s.nom}</p>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        s.statut_compte === 'suspendu' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {s.statut_compte || 'actif'}
                      </span>
                    </div>
                    <p className="text-xs text-on-surface-variant">{s.email} {s.telephone ? `· ${s.telephone}` : ''}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={s.custom_role_code || 'staff'}
                      onChange={(e) => handleAssignMemberRole(s, e.target.value)}
                      className="px-2.5 py-1.5 rounded-xl border border-outline-variant/25 bg-white text-xs font-semibold"
                      title="Rôle appliqué"
                    >
                      {(rolesMatrix.length > 0 ? rolesMatrix.filter((r) => r.code !== 'admin') : [{ code: 'staff', label: 'Réceptionniste' }]).map((r) => (
                        <option key={r.code} value={r.code}>{r.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => handleToggleSuspend(s)}
                      className="px-3 py-1.5 rounded-xl bg-surface-container-low text-xs font-semibold hover:bg-surface-container"
                    >
                      {s.statut_compte === 'suspendu' ? 'Réactiver' : 'Suspendre'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(s)}
                      className="px-3 py-1.5 rounded-xl bg-red-50 text-red-700 text-xs font-semibold hover:bg-red-100"
                    >
                      Archiver
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Matrice éditable des permissions par rôle */}
        <div className="lg:col-span-5 bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-sora font-bold text-base text-[#100f0d]">Matrice des rôles et permissions</h2>
              <p className="text-xs text-on-surface-variant">
                Réceptionniste verrouillé (403) sur les modules sensibles ; rôles personnalisables cochables.
              </p>
            </div>
            <button
              type="button"
              disabled={savingMatrix}
              onClick={handleSaveMatrix}
              style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
              className="px-3.5 py-1.5 rounded-xl text-xs font-bold disabled:opacity-50"
            >
              {savingMatrix ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={newRoleLabel}
              onChange={(e) => setNewRoleLabel(e.target.value)}
              placeholder="Nouveau rôle (ex : Caissier)"
              className="flex-1 px-3 py-1.5 rounded-xl border border-outline-variant/30 text-xs"
            />
            <button
              type="button"
              onClick={handleAddCustomRole}
              className="px-3 py-1.5 rounded-xl border border-[#f95d00]/40 text-[#f95d00] text-xs font-bold hover:bg-orange-50"
            >
              + Rôle
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-outline-variant/20 text-on-surface-variant">
                  <th className="py-2 pr-2 font-bold">Permission</th>
                  {rolesMatrix.map((r) => (
                    <th key={r.code} className="py-2 px-1.5 text-center font-bold">{r.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {PERMISSION_DEFINITIONS.map((perm) => (
                  <tr key={perm.key}>
                    <td className="py-2 pr-2 font-medium text-primary">{perm.label}</td>
                    {rolesMatrix.map((r) => {
                      const hardLocked = r.code === 'admin' || (r.code === 'staff' && perm.hardLockedForStaff);
                      const checked = r.code === 'admin' ? true : (r.code === 'staff' && perm.hardLockedForStaff ? false : Boolean(r.permissions?.[perm.key]));
                      return (
                        <td key={`${r.code}-${perm.key}`} className="py-2 px-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={hardLocked}
                            onChange={() => handleToggleRolePerm(r.code, perm.key)}
                            title={hardLocked ? 'Verrouillé système (API 403)' : 'Cocher / décocher'}
                            className="w-4 h-4 accent-[#f95d00] cursor-pointer disabled:opacity-60"
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modale Création Staff */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-sora font-bold text-lg text-[#100f0d]">Nouveau compte Staff</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>
            {tempPwd ? (
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-900">
                  Compte réceptionniste créé ! Mot de passe temporaire :
                  <p className="font-mono font-bold mt-1 text-base select-all">{tempPwd}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setTempPwd(''); setShowCreate(false); }}
                  style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
                  className="w-full py-2.5 rounded-xl font-semibold text-sm"
                >
                  Fermer
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreate} className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Prénom</label>
                    <input
                      type="text"
                      value={form.prenom}
                      onChange={(e) => setForm((p) => ({ ...p, prenom: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Nom *</label>
                    <input
                      required
                      type="text"
                      value={form.nom}
                      onChange={(e) => setForm((p) => ({ ...p, nom: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">E-mail professionnel *</label>
                  <input
                    required
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Téléphone</label>
                  <TunisianPhoneInput
                    value={form.telephone}
                    onChange={(val) => setForm((p) => ({ ...p, telephone: val }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Rôle attribué</label>
                  <select
                    value={form.custom_role_code}
                    onChange={(e) => setForm((p) => ({ ...p, custom_role_code: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white"
                  >
                    {(rolesMatrix.length > 0 ? rolesMatrix.filter((r) => r.code !== 'admin') : [{ code: 'staff', label: 'Réceptionniste' }]).map((r) => (
                      <option key={r.code} value={r.code}>{r.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2 pt-2">
                  <button type="button" onClick={() => setShowCreate(false)} className="flex-1 py-2.5 rounded-xl bg-gray-100 text-sm font-semibold">
                    Annuler
                  </button>
                  <button type="submit" disabled={creating} className="flex-1 py-2.5 rounded-xl bg-[#f95d00] text-white text-sm font-semibold">
                    {creating ? 'Création…' : 'Créer l\'accès'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return embedded ? content : <PortalLayout profile={profile}>{content}</PortalLayout>;
}
