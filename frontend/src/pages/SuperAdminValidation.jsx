// pages/SuperAdminValidation.jsx — Écran Super Admin de validation des organisations & formateurs
import React, { useState, useEffect } from 'react';
import PortalLayout from '../components/layout/PortalLayout';
import { useLanguage } from '../context/LanguageContext';
import { authUnifiedApi } from '../services/api/authUnified';

export default function SuperAdminValidation({ session }) {
  const { t } = useLanguage();

  const [activeTab, setActiveTab] = useState('organizations'); // 'organizations' | 'trainers'
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ pendingOrganizations: [], pendingTrainers: [] });
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Modal de rejet avec motif
  const [rejectModal, setRejectModal] = useState({ open: false, targetType: null, id: null, title: '' });
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
      } else {
        await authUnifiedApi.validateTrainer(rejectModal.id, {
          action: 'reject',
          notes: rejectReason,
        });
        setSuccessMsg(`Le profil formateur a été rejeté.`);
      }
      setRejectModal({ open: false, targetType: null, id: null, title: '' });
      setRejectReason('');
      fetchValidations();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <PortalLayout session={session}>
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

