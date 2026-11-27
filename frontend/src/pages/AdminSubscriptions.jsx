import React, { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import PortalLayout from '../components/layout/PortalLayout';
import { useSessionUser } from '../hooks/useSessionUser';
import { subscriptionApi, memberApi, tenantAdminApi } from '../services/api';
import { formatDateDMY } from '../utils/format';
import Money from '../components/common/Money';

const STATUS_TABS = [
  { id: 'demandes', label: 'Demandes', icon: 'pending_actions' },
  { id: 'active', label: 'Actifs', icon: 'verified' },
  { id: 'a_renouveler', label: 'À renouveler', icon: 'autorenew' },
  { id: 'expired', label: 'Expirés', icon: 'event_busy' },
  { id: 'suspended', label: 'Suspendus', icon: 'pause_circle' },
  { id: 'resilie', label: 'Résiliés', icon: 'cancel' },
];

const STATUS_META = {
  demandes: { label: 'En attente de paiement', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  en_attente_paiement: { label: 'En attente de paiement', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  active: { label: 'Actif', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  actif: { label: 'Actif', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  a_renouveler: { label: 'À renouveler', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  expired: { label: 'Expiré', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  suspended: { label: 'Suspendu', cls: 'bg-orange-100 text-orange-800 border-orange-200' },
  resilie: { label: 'Résilié', cls: 'bg-red-100 text-red-800 border-red-200' },
  refuse: { label: 'Refusé', cls: 'bg-rose-100 text-rose-800 border-rose-200' },
};

const TYPE_LABELS = {
  day_pass: 'Pass journée',
  week_pass: 'Pass semaine',
  mensuel: 'Mensuel',
  trimestriel: 'Trimestriel',
  annuel: 'Annuel',
  bureau_prive: 'Bureau privé',
};

function normalizeBucket(sub) {
  const st = String(sub?.statut || 'active').toLowerCase();
  if (st === 'en_attente_paiement' || sub?.pending_payment) return 'demandes';
  if (st === 'resilie' || st === 'refuse') return 'resilie';
  if (st === 'suspended') return 'suspended';
  if (st === 'expired') return 'expired';
  if (st === 'a_renouveler') return 'a_renouveler';
  // Vérifier si date_fin <= aujourd'hui + 7 jours pour classer visuellement dans À renouveler si actif
  if (sub?.date_fin) {
    const daysLeft = Math.ceil((new Date(sub.date_fin).getTime() - Date.now()) / 86400000);
    if (daysLeft < 0) return 'expired';
    if (daysLeft <= 7) return 'a_renouveler';
  }
  return 'active';
}

export default function AdminSubscriptions({ session }) {
  const { userId, email, metadata } = useSessionUser(session);
  const profile = useMemo(
    () => (userId ? { id: userId, email, role: metadata.role || 'admin', prenom: metadata.prenom || '', nom: metadata.nom || '', ...metadata } : null),
    [userId, email, metadata]
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = STATUS_TABS.some((t) => t.id === searchParams.get('tab')) ? searchParams.get('tab') : 'active';
  const [tab, setTab] = useState(initialTab);
  const [subscriptions, setSubscriptions] = useState([]);
  const [members, setMembers] = useState([]);
  const [unites, setUnites] = useState([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [creating, setCreating] = useState(false);
  const [suspendTarget, setSuspendTarget] = useState(null);
  const [suspendMotif, setSuspendMotif] = useState('');
  const [approveTarget, setApproveTarget] = useState(null);
  const [approveMode, setApproveMode] = useState('cash');
  const [approving, setApproving] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectMotif, setRejectMotif] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [form, setForm] = useState({
    user_id: '',
    type: 'mensuel',
    date_debut: new Date().toISOString().slice(0, 10),
    date_fin: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    quota_type: 'illimite',
    quota_total: '',
    unite_id: '',
    renouvellement_auto: false,
  });

  useEffect(() => {
    const qTab = searchParams.get('tab');
    if (qTab && STATUS_TABS.some((t) => t.id === qTab)) {
      setTab(qTab);
    }
  }, [searchParams]);

  const showToast = (m) => { setMsg(m); setTimeout(() => setMsg(''), 3500); };

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [subRes, memRes, uniRes] = await Promise.all([
        subscriptionApi.getAll({ include_archived: includeArchived ? 'true' : undefined }),
        memberApi.getAll().catch(() => ({ members: [] })),
        tenantAdminApi.getUnites().catch(() => ({ unites: [] })),
      ]);
      setSubscriptions(subRes.subscriptions || []);
      setMembers((memRes.members || []).filter((m) => !['admin', 'staff', 'super_admin'].includes(m.role)));
      setUnites(uniRes.unites || []);
    } catch (e) {
      setError(e.message || 'Erreur lors du chargement des abonnements.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [includeArchived]);

  const counts = useMemo(() => {
    const map = { demandes: 0, active: 0, a_renouveler: 0, expired: 0, suspended: 0, resilie: 0 };
    subscriptions.forEach((s) => {
      if (s.archived_at) return;
      const b = normalizeBucket(s);
      map[b] = (map[b] || 0) + 1;
    });
    return map;
  }, [subscriptions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return subscriptions.filter((s) => {
      if (!includeArchived && s.archived_at) return false;
      if (!s.archived_at && normalizeBucket(s) !== tab) return false;
      if (!q) return true;
      const name = `${s.profiles?.prenom || ''} ${s.profiles?.nom || ''} ${s.profiles?.email || ''}`.toLowerCase();
      return name.includes(q) || String(s.type || '').toLowerCase().includes(q);
    });
  }, [subscriptions, tab, search, includeArchived]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.user_id) { setError('Sélectionnez un membre.'); return; }
    setCreating(true);
    setError('');
    try {
      await subscriptionApi.create(form);
      setShowNew(false);
      showToast('Abonnement créé avec succès.');
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleChangeStatus = async (sub, statut) => {
    if (statut === 'suspended') {
      setSuspendTarget(sub);
      setSuspendMotif('');
      return;
    }
    try {
      await subscriptionApi.update(sub.id, { statut });
      showToast('Statut de l\'abonnement mis à jour.');
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleConfirmSuspend = async (e) => {
    e.preventDefault();
    if (!suspendTarget) return;
    if (suspendMotif.trim().length < 3) {
      setError('Un motif (minimum 3 caractères) est obligatoire pour suspendre un abonnement.');
      return;
    }
    try {
      await subscriptionApi.update(suspendTarget.id, {
        statut: 'suspended',
        confirm_suspension: true,
        motif_suspension: suspendMotif.trim(),
      });
      setSuspendTarget(null);
      setSuspendMotif('');
      showToast('Abonnement suspendu après validation humaine.');
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleArchive = async (sub) => {
    if (!window.confirm('Archiver cet abonnement ? Vous pourrez le restaurer depuis « Afficher les archivés ».')) return;
    try {
      await subscriptionApi.archive(sub.id);
      showToast('Abonnement archivé.');
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRestore = async (sub) => {
    try {
      await subscriptionApi.restore(sub.id);
      showToast('Abonnement restauré.');
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleConfirmApprovePayment = async (e) => {
    e.preventDefault();
    if (!approveTarget) return;
    setApproving(true);
    setError('');
    try {
      const res = await subscriptionApi.approvePayment(approveTarget.id, { mode: approveMode });
      setApproveTarget(null);
      showToast(res.message || 'Abonnement encaissé et activé !');
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setApproving(false);
    }
  };

  const handleConfirmRejectRequest = async (e) => {
    e.preventDefault();
    if (!rejectTarget) return;
    if (rejectMotif.trim().length < 3) {
      setError('Saisissez un motif de refus (minimum 3 caractères).');
      return;
    }
    setRejecting(true);
    setError('');
    try {
      await subscriptionApi.rejectRequest(rejectTarget.id, { motif: rejectMotif.trim() });
      setRejectTarget(null);
      setRejectMotif('');
      showToast("Demande d'abonnement refusée.");
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setRejecting(false);
    }
  };

  return (
    <PortalLayout profile={profile}>
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="text-left">
            <h1 className="font-sora font-bold text-2xl sm:text-3xl text-primary">Abonnements</h1>
            <p className="text-sm text-on-surface-variant mt-1">
              Cycle de vie complet : actifs, renouvellements imminents, expirés, suspendus et résiliés.
            </p>
          </div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-outline-variant/25 bg-surface-container-lowest text-xs font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
                className="accent-[#f95d00]"
              />
              Afficher les archivés
            </label>
            <button
              type="button"
              onClick={() => setShowNew(true)}
              style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm shadow-sm hover:opacity-95 transition"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
              Nouvel abonnement
            </button>
          </div>
        </div>

        {msg && <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-semibold">{msg}</div>}
        {error && <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-semibold">{error}</div>}

        {/* Onglets statuts */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex flex-wrap gap-2">
            {STATUS_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                style={tab === t.id ? { backgroundColor: '#f95d00', color: '#ffffff' } : undefined}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition ${
                  tab === t.id
                    ? 'shadow-xs'
                    : 'bg-surface-container-lowest border border-outline-variant/20 text-on-surface-variant hover:bg-surface-container-low'
                }`}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 17 }}>{t.icon}</span>
                <span>{t.label}</span>
                <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${tab === t.id ? 'bg-white/20 text-white' : 'bg-surface-container text-primary'}`}>
                  {counts[t.id] || 0}
                </span>
              </button>
            ))}
          </div>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un membre ou formule…"
            className="px-3.5 py-2 rounded-xl border border-outline-variant/25 bg-surface-container-lowest text-sm w-full sm:w-64 outline-none focus:border-[#f95d00]"
          />
        </div>

        <div className="bg-surface-container-lowest rounded-3xl border border-outline-variant/15 shadow-xs overflow-hidden">
          {loading ? (
            <div className="p-10 text-center text-sm text-on-surface-variant">Chargement des abonnements…</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-on-surface-variant">Aucun abonnement dans cette catégorie.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-outline-variant/15 text-xs uppercase text-on-surface-variant bg-surface-container-low/40">
                    <th className="py-3 px-4">Membre</th>
                    <th className="py-3 px-4">Formule &amp; Bureau</th>
                    <th className="py-3 px-4">Quota consommé</th>
                    <th className="py-3 px-4">Période</th>
                    <th className="py-3 px-4">Statut</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {filtered.map((s) => {
                    const stMeta = STATUS_META[normalizeBucket(s)] || STATUS_META.active;
                    const qTotal = s.quota_total != null ? Number(s.quota_total) : null;
                    const qConso = Number(s.quota_consomme || 0);
                    const qUnit = s.quota_type === 'jours' ? 'j' : 'h';
                    const qPct = qTotal > 0 ? Math.min(100, Math.round((qConso / qTotal) * 100)) : 0;
                    return (
                      <tr key={s.id} className={s.archived_at ? 'opacity-60 bg-slate-50/60' : ''}>
                        <td className="py-3 px-4">
                          <p className="font-semibold text-primary">
                            {s.profiles ? `${s.profiles.prenom || ''} ${s.profiles.nom || ''}`.trim() || s.profiles.email : 'Membre'}
                          </p>
                          <p className="text-xs text-on-surface-variant">{s.profiles?.email || '—'}</p>
                        </td>
                        <td className="py-3 px-4 font-semibold text-primary">
                          {TYPE_LABELS[s.type] || s.type || 'Mensuel'}
                          {s.unite && (
                            <span className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-50 border border-[#f95d00]/30 text-xs font-bold text-[#9a3412]">
                              Bureau {s.unite.code} · Occupé - contrat
                            </span>
                          )}
                          {s.montant_ttc > 0 && (
                            <span className="block text-xs text-on-surface-variant"><Money amount={s.montant_ttc} showTaxType="TTC" /></span>
                          )}
                        </td>
                        <td className="py-3 px-4 min-w-[160px]">
                          {qTotal != null && s.quota_type !== 'illimite' ? (
                            <div className="space-y-1">
                              <div className="flex justify-between text-xs font-semibold">
                                <span>{qConso}{qUnit} / {qTotal}{qUnit}</span>
                                <span className="text-[#f95d00]">{qPct}%</span>
                              </div>
                              <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{ width: `${qPct}%`, backgroundColor: qPct >= 90 ? '#d97706' : '#f95d00' }}
                                />
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs font-semibold text-on-surface-variant">Illimité</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs text-on-surface-variant whitespace-nowrap">
                          {formatDateDMY(s.date_debut)} → {formatDateDMY(s.date_fin)}
                          <span className="block text-xs text-on-surface-variant">
                            {s.renouvellement_auto ? 'Renouvellement auto' : 'Renouvellement manuel'}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold border ${stMeta.cls}`}>
                            {s.archived_at ? 'Archivé' : stMeta.label}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {s.archived_at ? (
                              <button
                                type="button"
                                onClick={() => handleRestore(s)}
                                className="px-2.5 py-1 rounded-lg border border-emerald-300 text-emerald-700 text-xs font-semibold hover:bg-emerald-50"
                              >
                                Restaurer
                              </button>
                            ) : (
                              <>
                                {normalizeBucket(s) === 'demandes' ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => { setApproveTarget(s); setApproveMode('cash'); }}
                                      style={{ backgroundColor: '#16a34a', color: '#ffffff' }}
                                      className="px-2.5 py-1 rounded-lg text-xs font-bold hover:opacity-95"
                                    >
                                      Encaisser &amp; activer
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => { setRejectTarget(s); setRejectMotif(''); }}
                                      className="px-2.5 py-1 rounded-lg border border-rose-300 text-rose-700 text-xs font-semibold hover:bg-rose-50"
                                    >
                                      Refuser
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    {normalizeBucket(s) !== 'active' && (
                                      <button
                                        type="button"
                                        onClick={() => handleChangeStatus(s, 'active')}
                                        className="px-2.5 py-1 rounded-lg border border-emerald-300 text-emerald-700 text-xs font-semibold hover:bg-emerald-50"
                                      >
                                        Activer
                                      </button>
                                    )}
                                    {normalizeBucket(s) === 'active' && (
                                      <button
                                        type="button"
                                        onClick={() => handleChangeStatus(s, 'suspended')}
                                        className="px-2.5 py-1 rounded-lg border border-amber-300 text-amber-800 text-xs font-semibold hover:bg-amber-50"
                                      >
                                        Suspendre
                                      </button>
                                    )}
                                    {normalizeBucket(s) !== 'resilie' && (
                                      <button
                                        type="button"
                                        onClick={() => handleChangeStatus(s, 'resilie')}
                                        className="px-2.5 py-1 rounded-lg border border-red-200 text-red-700 text-xs font-semibold hover:bg-red-50"
                                      >
                                        Résilier
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => handleArchive(s)}
                                      className="px-2.5 py-1 rounded-lg border border-outline-variant/30 text-on-surface-variant text-xs font-semibold hover:bg-surface-container-low"
                                    >
                                      Archiver
                                    </button>
                                  </>
                                )}
                              </>
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
        </div>

        {showNew && (
          <div className="fixed inset-0 z-[100] bg-black/45 flex items-center justify-center p-4">
            <form onSubmit={handleCreate} className="bg-white dark:bg-[#1a1815] rounded-3xl p-6 max-w-md w-full border border-outline-variant/20 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-sora font-bold text-lg text-primary">Nouvel abonnement</h2>
                <button type="button" onClick={() => setShowNew(false)} className="text-on-surface-variant">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Membre *</label>
                <select
                  required
                  value={form.user_id}
                  onChange={(e) => setForm((f) => ({ ...f, user_id: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-outline-variant/30 text-sm bg-white"
                >
                  <option value="">Sélectionner un membre…</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{`${m.prenom || ''} ${m.nom || ''}`.trim() || m.email} ({m.email})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Formule</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-outline-variant/30 text-sm bg-white"
                >
                  {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Début</label>
                  <input type="date" required value={form.date_debut} onChange={(e) => setForm((f) => ({ ...f, date_debut: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-outline-variant/30 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Fin</label>
                  <input type="date" required value={form.date_fin} onChange={(e) => setForm((f) => ({ ...f, date_fin: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-outline-variant/30 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Quota inclus</label>
                  <select
                    value={form.quota_type}
                    onChange={(e) => setForm((f) => ({ ...f, quota_type: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl border border-outline-variant/30 text-sm bg-white"
                  >
                    <option value="illimite">Illimité</option>
                    <option value="heures">Heures incluses</option>
                    <option value="jours">Jours inclus</option>
                  </select>
                </div>
                {form.quota_type !== 'illimite' && (
                  <div>
                    <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">
                      Total ({form.quota_type === 'jours' ? 'jours' : 'heures'}) *
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="0.5"
                      required
                      value={form.quota_total}
                      onChange={(e) => setForm((f) => ({ ...f, quota_total: e.target.value }))}
                      placeholder="Ex : 40"
                      className="w-full px-3 py-2.5 rounded-xl border border-outline-variant/30 text-sm"
                    />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">
                  Bureau privé dédié (optionnel — statut « Occupé - contrat »)
                </label>
                <select
                  value={form.unite_id}
                  onChange={(e) => setForm((f) => ({ ...f, unite_id: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-outline-variant/30 text-sm bg-white"
                >
                  <option value="">Aucun bureau exclusif</option>
                  {unites.filter((u) => !u.archived_at).map((u) => (
                    <option key={u.id} value={u.id}>{u.code} — {u.nom || u.espaces?.nom || 'Unité'}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={form.renouvellement_auto} onChange={(e) => setForm((f) => ({ ...f, renouvellement_auto: e.target.checked }))} className="accent-[#f95d00]" />
                Renouvellement automatique
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowNew(false)} className="px-4 py-2 rounded-xl border border-outline-variant/30 text-sm font-semibold">Annuler</button>
                <button type="submit" disabled={creating} style={{ backgroundColor: '#f95d00', color: '#ffffff' }} className="px-5 py-2 rounded-xl text-sm font-bold">
                  {creating ? 'Création…' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        )}

        {approveTarget && (
          <div className="fixed inset-0 z-[100] bg-black/45 flex items-center justify-center p-4">
            <form onSubmit={handleConfirmApprovePayment} className="bg-white dark:bg-[#1a1815] rounded-3xl p-6 max-w-md w-full border border-outline-variant/20 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-sora font-bold text-lg text-primary">Encaisser &amp; activer l&apos;abonnement</h2>
                <button type="button" onClick={() => setApproveTarget(null)} className="text-on-surface-variant">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div className="p-3.5 rounded-2xl bg-surface-container-low/50 text-xs space-y-1">
                <p><strong>Membre :</strong> {approveTarget.profiles ? `${approveTarget.profiles.prenom || ''} ${approveTarget.profiles.nom || ''}`.trim() : 'Membre'}</p>
                <p><strong>Formule :</strong> {TYPE_LABELS[approveTarget.type] || approveTarget.type}</p>
                {approveTarget.montant_ttc > 0 && (
                  <p><strong>Montant à encaisser :</strong> <Money amount={approveTarget.montant_ttc} showTaxType="TTC" /></p>
                )}
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Mode d&apos;encaissement *</label>
                <select
                  value={approveMode}
                  onChange={(e) => setApproveMode(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-outline-variant/30 text-sm bg-white"
                >
                  <option value="cash">Espèces</option>
                  <option value="bank_transfer">Virement bancaire</option>
                  <option value="check">Chèque</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setApproveTarget(null)} className="px-4 py-2 rounded-xl border border-outline-variant/30 text-sm font-semibold">Annuler</button>
                <button type="submit" disabled={approving} style={{ backgroundColor: '#16a34a', color: '#ffffff' }} className="px-5 py-2 rounded-xl text-sm font-bold disabled:opacity-50">
                  {approving ? 'Validation…' : 'Encaisser & activer'}
                </button>
              </div>
            </form>
          </div>
        )}

        {rejectTarget && (
          <div className="fixed inset-0 z-[100] bg-black/45 flex items-center justify-center p-4">
            <form onSubmit={handleConfirmRejectRequest} className="bg-white dark:bg-[#1a1815] rounded-3xl p-6 max-w-md w-full border border-outline-variant/20 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-sora font-bold text-lg text-primary">Refuser la demande</h2>
                <button type="button" onClick={() => setRejectTarget(null)} className="text-on-surface-variant">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Motif du refus *</label>
                <input
                  required
                  minLength={3}
                  value={rejectMotif}
                  onChange={(e) => setRejectMotif(e.target.value)}
                  placeholder="Ex : Formulaire incomplet ou créneau non éligible"
                  className="w-full px-3 py-2.5 rounded-xl border border-outline-variant/30 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setRejectTarget(null)} className="px-4 py-2 rounded-xl border border-outline-variant/30 text-sm font-semibold">Annuler</button>
                <button type="submit" disabled={rejecting} className="px-5 py-2 rounded-xl bg-rose-600 text-white text-sm font-bold disabled:opacity-50">
                  {rejecting ? 'Envoi…' : 'Confirmer le refus'}
                </button>
              </div>
            </form>
          </div>
        )}

        {suspendTarget && (
          <div className="fixed inset-0 z-[100] bg-black/45 flex items-center justify-center p-4">
            <form onSubmit={handleConfirmSuspend} className="bg-white dark:bg-[#1a1815] rounded-3xl p-6 max-w-md w-full border border-outline-variant/20 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-sora font-bold text-lg text-primary">Confirmation humaine de suspension</h2>
                <button type="button" onClick={() => setSuspendTarget(null)} className="text-on-surface-variant">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <p className="text-xs text-on-surface-variant">
                Conformément à la politique DeskyWork, une suspension d&apos;abonnement nécessite une validation humaine explicite.
              </p>
              <div>
                <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Motif de suspension *</label>
                <input
                  required
                  minLength={3}
                  value={suspendMotif}
                  onChange={(e) => setSuspendMotif(e.target.value)}
                  placeholder="Ex : Demande du client / Impayé prolongé"
                  className="w-full px-3 py-2.5 rounded-xl border border-outline-variant/30 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setSuspendTarget(null)} className="px-4 py-2 rounded-xl border border-outline-variant/30 text-sm font-semibold">Annuler</button>
                <button type="submit" style={{ backgroundColor: '#d97706', color: '#ffffff' }} className="px-5 py-2 rounded-xl text-sm font-bold">
                  Confirmer la suspension
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
