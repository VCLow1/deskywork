// pages/SuperAdminValidation.jsx — Écran Super Admin de validation des organisations & formateurs
import React, { useState, useEffect } from 'react';
import PortalLayout from '../components/layout/PortalLayout';
import { useLanguage } from '../context/LanguageContext';
import { authUnifiedApi } from '../services/api/authUnified';
import { useSessionUser } from '../hooks/useSessionUser';

export default function SuperAdminValidation({ session }) {
  const { t } = useLanguage();
  const { userId, email, metadata } = useSessionUser(session);
  const profile = userId
    ? { id: userId, email, role: metadata.role || 'super_admin', ...metadata }
    : null;

  const [activeTab, setActiveTab] = useState('organizations'); // 'organizations' | 'trainers' | 'pack_upgrades'
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ pendingOrganizations: [], pendingTrainers: [], pendingPackUpgrades: [] });
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Modal de rejet avec motif
  const [rejectModal, setRejectModal] = useState({ open: false, targetType: null, id: null, tenantId: null, title: '' });
  const [rejectReason, setRejectReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const fetchValidations = async () => {
    setLoading(true);
    try {
      const res = await authUnifiedApi.getPendingValidations();
      setData(res);
    } catch (err) {
      setErrorMsg(err.message || 'Impossible de charger les demandes.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchValidations();
  }, []);

  // ── Approbation d'une organisation ──
  const handleApproveOrg = async (org) => {
    if (!window.confirm(t('validation.confirmApproveOrg'))) return;
    setActionLoading(true);
    setErrorMsg('');
    try {
      await authUnifiedApi.validateOrganization(org.id, { action: 'approve' });
      setSuccessMsg(`L'espace "${org.nom}" a été approuvé avec succès.`);
      fetchValidations();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // ── Approbation d'un formateur ──
  const handleApproveTrainer = async (trainer) => {
    setActionLoading(true);
    setErrorMsg('');
    try {
      await authUnifiedApi.validateTrainer(trainer.id, { action: 'approve' });
      const name = `${trainer.profiles?.prenom || ''} ${trainer.profiles?.nom || ''}`.trim();
      setSuccessMsg(`Le formateur "${name}" a été approuvé.`);
      fetchValidations();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // ── Approbation d'une demande de changement de pack (CDC §4.5) ──
  const handleApprovePackUpgrade = async (item) => {
    if (!window.confirm(`Confirmer le passage de l'établissement "${item.tenant_nom}" vers le ${item.target_pack_name} (${item.target_prix_label}) ?`)) return;
    setActionLoading(true);
    setErrorMsg('');
    try {
      const res = await authUnifiedApi.validatePackUpgrade(item.tenant_id, item.request_id, { action: 'approve' });
      setSuccessMsg(res.message || `Le pack de "${item.tenant_nom}" a été mis à jour avec succès.`);
      fetchValidations();
    } catch (err) {
      setErrorMsg(err.message || 'Impossible d\'approuver le changement de pack.');
    } finally {
      setActionLoading(false);
    }
  };

  // ── Confirmer Rejet avec motif ──
  const handleConfirmReject = async () => {
    if (!rejectModal.id) return;
    setActionLoading(true);
    setErrorMsg('');
    try {
      if (rejectModal.targetType === 'organization') {
        await authUnifiedApi.validateOrganization(rejectModal.id, {
          action: 'reject',
          notes: rejectReason,
        });
        setSuccessMsg(`L'organisation a été rejetée.`);
      } else if (rejectModal.targetType === 'pack_upgrade') {
        const res = await authUnifiedApi.validatePackUpgrade(rejectModal.tenantId, rejectModal.id, {
          action: 'reject',
          notes: rejectReason,
        });
        setSuccessMsg(res.message || `La demande de changement de pack a été refusée.`);
      } else {
        await authUnifiedApi.validateTrainer(rejectModal.id, {
          action: 'reject',
          notes: rejectReason,
        });
        setSuccessMsg(`Le profil formateur a été rejeté.`);
      }
      setRejectModal({ open: false, targetType: null, id: null, tenantId: null, title: '' });
      setRejectReason('');
      fetchValidations();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <PortalLayout profile={profile}>
      <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">

        {/* Titre & Sous-titre */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="font-sora text-2xl sm:text-3xl font-bold text-[#100f0d]">
              {t('validation.title')}
            </h1>
            <p className="text-sm text-on-surface-variant mt-1">
              {t('validation.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={fetchValidations}
            disabled={loading}
            className="btn-outline px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 self-start"
          >
            <span className={`material-symbols-outlined text-[16px] ${loading ? 'animate-spin' : ''}`}>
              refresh
            </span>
            Actualiser
          </button>
        </div>

        {/* Messages */}
        {errorMsg && (
          <div className="p-4 rounded-2xl bg-red-50 text-red-700 text-sm flex items-center gap-2 border border-red-200">
            <span className="material-symbols-outlined text-[18px]">error</span>
            {errorMsg}
          </div>
        )}
        {successMsg && (
          <div className="p-4 rounded-2xl bg-emerald-50 text-emerald-800 text-sm flex items-center gap-2 border border-emerald-200">
            <span className="material-symbols-outlined text-[18px]">check_circle</span>
            {successMsg}
          </div>
        )}

        {/* Onglets */}
        <div className="flex border-b border-outline-variant/20 gap-4">
          <button
            type="button"
            onClick={() => setActiveTab('organizations')}
            className={`pb-3 text-sm font-semibold flex items-center gap-2 relative transition-colors ${
              activeTab === 'organizations' ? 'text-[#f95d00]' : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">domain</span>
            {t('validation.tabOrgs')}
            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-orange-100 text-orange-900">
              {data.pendingOrganizations?.length || 0}
            </span>
            {activeTab === 'organizations' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#f95d00] rounded-t-full" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('trainers')}
            className={`pb-3 text-sm font-semibold flex items-center gap-2 relative transition-colors ${
              activeTab === 'trainers' ? 'text-[#f95d00]' : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">school</span>
            {t('validation.tabTrainers')}
            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900">
              {data.pendingTrainers?.length || 0}
            </span>
            {activeTab === 'trainers' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#f95d00] rounded-t-full" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('pack_upgrades')}
            className={`pb-3 text-sm font-semibold flex items-center gap-2 relative transition-colors ${
              activeTab === 'pack_upgrades' ? 'text-[#f95d00]' : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">workspace_premium</span>
            Changements de pack
            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-900">
              {data.pendingPackUpgrades?.length || 0}
            </span>
            {activeTab === 'pack_upgrades' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#f95d00] rounded-t-full" />
            )}
          </button>
        </div>

        {/* ── ONGLET 1 : ORGANISATIONS EN ATTENTE ── */}
        {activeTab === 'organizations' && (
          <div>
            {data.pendingOrganizations?.length === 0 ? (
              <div className="glass-card rounded-3xl p-10 text-center text-on-surface-variant space-y-2">
                <span className="material-symbols-outlined text-[44px] text-outline">verified</span>
                <p className="text-sm">{t('validation.emptyOrgs')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {data.pendingOrganizations.map((org) => {
                  const owner = org.profiles;
                  return (
                    <div key={org.id} className="glass-card rounded-3xl p-6 shadow-sm border border-outline-variant/20 flex flex-col justify-between space-y-4">
                      <div>
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="flex items-center gap-3">
                            {org.logo_url ? (
                              <img src={org.logo_url} alt={org.nom} className="w-12 h-12 rounded-xl object-cover border" />
                            ) : (
                              <div className="w-12 h-12 rounded-xl bg-[#100f0d] text-white flex items-center justify-center">
                                <span className="material-symbols-outlined text-[24px]">
                                  {org.type === 'centre_formation' ? 'school' : 'domain'}
                                </span>
                              </div>
                            )}
                            <div>
                              <h2 className="font-sora text-lg font-bold text-[#100f0d]">{org.nom}</h2>
                              <span className="text-[11px] font-semibold text-on-surface-variant">
                                {org.type === 'centre_formation' ? 'Centre de formation' : 'Espace Coworking'} · {org.ville}
                              </span>
                            </div>
                          </div>
                          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                            {org.statut}
                          </span>
                        </div>

                        <p className="text-xs text-on-surface-variant line-clamp-2 mb-3">
                          {org.description || 'Aucune description fournie.'}
                        </p>

                        <div className="p-3 rounded-xl bg-surface-container-low text-xs space-y-1 border border-outline-variant/10">
                          <div><strong>Adresse :</strong> {org.adresse}</div>
                          <div><strong>Propriétaire :</strong> {owner?.prenom} {owner?.nom} ({owner?.email} · {owner?.telephone || 'Pas de tél'})</div>
                          <div><strong>Soumis le :</strong> {new Date(org.created_at).toLocaleDateString()}</div>
                        </div>

                        {/* CDC v3.0 — Détails complets du Pack choisi par l'établissement */}
                        <div className="mt-3 p-3 rounded-2xl bg-orange-50/80 border border-orange-200/90 text-xs space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1 font-bold text-[#f95d00]">
                              <span className="material-symbols-outlined text-[16px]">workspace_premium</span>
                              {org.pack_details?.name || 'Pack Standard'}
                            </span>
                            <span className="font-sora font-extrabold text-xs text-[#100f0d]">
                              {org.pack_details?.prix_label || '150,000 DT/mois HT'}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-700 flex flex-wrap gap-x-3 gap-y-0.5">
                            <span>📦 <strong>Ressources :</strong> {org.pack_details?.max_espaces}</span>
                            <span>👥 <strong>Membres :</strong> {org.pack_details?.max_membres}</span>
                            <span>👔 <strong>Staff :</strong> {org.pack_details?.max_staff}</span>
                          </div>
                          <div className="text-[11px] text-slate-600 pt-1 border-t border-orange-200/60">
                            🎯 <strong>Activité sélectionnée :</strong> {org.pack_details?.activite_label}
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-3 pt-2">
                        <button
                          type="button"
                          disabled={actionLoading}
                          onClick={() => setRejectModal({ open: true, targetType: 'organization', id: org.id, title: org.nom })}
                          className="btn-outline flex-1 py-2 rounded-xl text-xs font-semibold text-red-600 hover:bg-red-50"
                        >
                          {t('validation.rejectBtn')}
                        </button>
                        <button
                          type="button"
                          disabled={actionLoading}
                          onClick={() => handleApproveOrg(org)}
                          className="btn-primary flex-1 py-2 rounded-xl text-xs font-semibold shadow-sm"
                        >
                          {t('validation.approveBtn')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── ONGLET 2 : FORMATEURS EN ATTENTE ── */}
        {activeTab === 'trainers' && (
          <div>
            {data.pendingTrainers?.length === 0 ? (
              <div className="glass-card rounded-3xl p-10 text-center text-on-surface-variant space-y-2">
                <span className="material-symbols-outlined text-[44px] text-outline">verified</span>
                <p className="text-sm">{t('validation.emptyTrainers')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {data.pendingTrainers.map((tr) => {
                  const prof = tr.profiles;
                  const name = `${prof?.prenom || ''} ${prof?.nom || ''}`.trim() || 'Formateur';
                  return (
                    <div key={tr.id} className="glass-card rounded-3xl p-6 shadow-sm border border-outline-variant/20 flex flex-col justify-between space-y-4">
                      <div>
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center">
                              <span className="material-symbols-outlined text-[24px]">school</span>
                            </div>
                            <div>
                              <h2 className="font-sora text-lg font-bold text-[#100f0d]">{name}</h2>
                              <span className="text-[11px] font-semibold text-on-surface-variant">
                                {prof?.email} · {tr.telephone_pro || prof?.telephone || 'Pas de tél'}
                              </span>
                            </div>
                          </div>
                          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                            {tr.statut_validation}
                          </span>
                        </div>

                        <div className="space-y-2 mb-3 text-xs">
                          <div>
                            <strong>Domaines :</strong>{' '}
                            {Array.isArray(tr.domaines) && tr.domaines.length > 0
                              ? tr.domaines.join(', ')
                              : 'Non spécifiés'}
                          </div>
                          <p className="text-on-surface-variant bg-surface-container-low p-3 rounded-xl border border-outline-variant/10">
                            {tr.bio || 'Aucune biographie rédigée.'}
                          </p>
                        </div>
                      </div>

                      <div className="flex gap-3 pt-2">
                        <button
                          type="button"
                          disabled={actionLoading}
                          onClick={() => setRejectModal({ open: true, targetType: 'trainer', id: tr.id, title: name })}
                          className="btn-outline flex-1 py-2 rounded-xl text-xs font-semibold text-red-600 hover:bg-red-50"
                        >
                          {t('validation.rejectBtn')}
                        </button>
                        <button
                          type="button"
                          disabled={actionLoading}
                          onClick={() => handleApproveTrainer(tr)}
                          className="btn-primary flex-1 py-2 rounded-xl text-xs font-semibold shadow-sm"
                        >
                          {t('validation.approveBtn')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── ONGLET 3 : DEMANDES DE CHANGEMENT DE PACK ── */}
        {activeTab === 'pack_upgrades' && (
          <div>
            {!data.pendingPackUpgrades || data.pendingPackUpgrades.length === 0 ? (
              <div className="glass-card rounded-3xl p-10 text-center text-on-surface-variant space-y-2">
                <span className="material-symbols-outlined text-[44px] text-outline">verified</span>
                <p className="text-sm">Aucune demande de changement de pack en attente.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {data.pendingPackUpgrades.map((item) => (
                  <div key={item.request_id} className="glass-card rounded-3xl p-6 shadow-sm border border-purple-200/80 bg-gradient-to-b from-purple-50/20 to-white flex flex-col justify-between space-y-4">
                    <div>
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-xl bg-purple-100 text-purple-900 flex items-center justify-center">
                            <span className="material-symbols-outlined text-[24px]">upgrade</span>
                          </div>
                          <div>
                            <h2 className="font-sora text-lg font-bold text-[#100f0d]">{item.tenant_nom}</h2>
                            <span className="text-[11px] font-semibold text-on-surface-variant">
                              Demandé par : {item.requested_by || item.owner?.email || 'Gérant'}
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-purple-100 text-purple-800 border border-purple-200">
                          En attente
                        </span>
                      </div>

                      {/* Transition de pack */}
                      <div className="p-3.5 rounded-2xl bg-white border border-purple-100 space-y-2 shadow-sm">
                        <div className="flex items-center justify-between text-xs">
                          <div>
                            <span className="text-[10px] uppercase font-bold text-slate-400 block">Pack actuel</span>
                            <span className="font-bold text-slate-700">{item.current_pack_name}</span> ({item.current_prix_label})
                          </div>
                          <span className="material-symbols-outlined text-purple-600 text-[20px]">arrow_forward</span>
                          <div className="text-right">
                            <span className="text-[10px] uppercase font-bold text-purple-600 block">Nouveau pack demandé</span>
                            <span className="font-extrabold text-[#f95d00] text-sm">{item.target_pack_name}</span>
                            <div className="text-[11px] font-bold text-slate-800">{item.target_prix_label}</div>
                          </div>
                        </div>
                        <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-600">
                          ✨ <strong>Nouvelles limites :</strong> {item.target_limits}
                        </div>
                        {item.note && (
                          <div className="pt-1 text-[11px] text-slate-500 italic">
                            💬 « {item.note} »
                          </div>
                        )}
                        <div className="text-[10px] text-slate-400 pt-1">
                          Demande reçue le {new Date(item.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-3 pt-2">
                      <button
                        type="button"
                        disabled={actionLoading}
                        onClick={() => setRejectModal({
                          open: true,
                          targetType: 'pack_upgrade',
                          id: item.request_id,
                          tenantId: item.tenant_id,
                          title: `${item.tenant_nom} — Passage vers ${item.target_pack_name}`,
                        })}
                        className="btn-outline flex-1 py-2 rounded-xl text-xs font-semibold text-red-600 hover:bg-red-50"
                      >
                        Refuser
                      </button>
                      <button
                        type="button"
                        disabled={actionLoading}
                        onClick={() => handleApprovePackUpgrade(item)}
                        className="btn-primary flex-1 py-2 rounded-xl text-xs font-semibold shadow-sm bg-purple-700 hover:bg-purple-800 text-white"
                      >
                        Approuver
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>

      {/* ── MODAL DE REJET AVEC MOTIF ── */}
      {rejectModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="glass-card rounded-3xl max-w-md w-full p-6 space-y-4 bg-white">
            <h3 className="font-sora text-lg font-bold text-red-700">
              Refuser la demande : {rejectModal.title}
            </h3>
            <p className="text-xs text-on-surface-variant">
              Veuillez indiquer le motif du refus. Un message sera automatiquement envoyé au demandeur.
            </p>
            <textarea
              rows={3}
              required
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Ex: Informations incomplètes, logo non conforme, etc."
              className="form-input text-xs"
            />
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRejectModal({ open: false, targetType: null, id: null, title: '' })}
                className="btn-outline flex-1 py-2 rounded-xl text-xs"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleConfirmReject}
                className="bg-red-600 hover:bg-red-700 text-white flex-1 py-2 rounded-xl text-xs font-semibold"
              >
                Confirmer le refus
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}

