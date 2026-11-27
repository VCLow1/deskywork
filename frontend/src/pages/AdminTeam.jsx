import React, { useEffect, useState, useMemo } from 'react';
import PortalLayout from '../components/layout/PortalLayout';
import { useSessionUser } from '../hooks/useSessionUser';
import { tenantAdminApi } from '../services/api';
import { normalizeTunisianPhone, validateTunisianPhone } from '../utils/tunisianPhone';
import TunisianPhoneInput from '../components/common/TunisianPhoneInput';

const PERM_LABELS = [
  { key: 'agenda_checkin', label: 'Agenda & Check-in / Libération des sessions', allowed: true },
  { key: 'reservations', label: 'Gestion des réservations & accueil', allowed: true },
  { key: 'encaissement_place', label: 'Encaissements sur place (espèces/chèque/virement)', allowed: true },
  { key: 'membres_lecture', label: 'Consultation membres & Invités', allowed: true },
  { key: 'tarifs_acces', label: 'Tarification & codes promo (Verrouillé Staff)', allowed: false },
  { key: 'rapports_financiers', label: 'Rapports financiers & CA (Verrouillé Staff)', allowed: false },
  { key: 'equipe_gestion', label: 'Gestion équipe & abonnement SaaS (Verrouillé Staff)', allowed: false },
];

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
  const [form, setForm] = useState({ nom: '', prenom: '', email: '', telephone: '' });

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await tenantAdminApi.getStaff();
      setStaff(res.staff || []);
      if (res.quota) setQuota(res.quota);
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
      setForm({ nom: '', prenom: '', email: '', telephone: '' });
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
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
                  <div className="flex items-center gap-2">
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
                      Supprimer
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Matrice des permissions Staff */}
        <div className="lg:col-span-5 bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15">
          <h2 className="font-sora font-bold text-base text-[#100f0d] mb-2">Permissions du rôle Staff (Niveau 2)</h2>
          <p className="text-xs text-on-surface-variant mb-4">
            Le Staff gère l&apos;accueil quotidien mais n&apos;a aucun accès aux tarifs, rapports financiers ni à la gestion d&apos;équipe.
          </p>
          <div className="space-y-2.5">
            {PERM_LABELS.map((p) => (
              <div
                key={p.key}
                className={`p-3 rounded-2xl border flex items-center gap-3 text-xs font-semibold ${
                  p.allowed
                    ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                    : 'bg-slate-50 border-slate-200 text-slate-500'
                }`}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  {p.allowed ? 'check_circle' : 'lock'}
                </span>
                <span>{p.label}</span>
              </div>
            ))}
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
