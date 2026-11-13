import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { memberApi, pricingApi, subscriptionApi } from '../services/api';
import PortalLayout from '../components/layout/PortalLayout';

const SUBSCRIPTION_LABELS = {
  day_pass: 'Day Pass',
  week_pass: 'Week Pass',
  mensuel: 'Mensuel',
  trimestriel: 'Trimestriel',
  annuel: 'Annuel',
  bureau_prive: 'Bureau privé',
};

const SUBSCRIPTION_ICONS = {
  day_pass: 'today',
  week_pass: 'date_range',
  mensuel: 'calendar_month',
  trimestriel: 'calendar_view_month',
  annuel: 'event',
  bureau_prive: 'meeting_room',
};

const PLAN_LABELS = {
  standard: 'Standard',
  etudiant: 'Étudiant',
  entreprise: 'Entreprise',
};

const ESPACE_TYPE_LABELS = {
  open_space: 'Open space',
  private_office: 'Bureau privé',
  meeting_room: 'Salle de réunion',
  training_room: 'Salle de formation',
  event_space: 'Espace événementiel',
  hot_desk: 'Poste nomade (Hot Desk)',
  dedicated_desk: 'Poste fixe (Dedicated Desk)',
};

export default function MemberSubscription({ session }) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [tarifs, setTarifs] = useState([]);
  const [planTarifaire, setPlanTarifaire] = useState('standard');
  const [activeSub, setActiveSub] = useState(null);
  const [history, setHistory] = useState([]);
  const [promoCode, setPromoCode] = useState('');
  const [promoResult, setPromoResult] = useState(null);
  const [selectedType, setSelectedType] = useState(null);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmModal, setConfirmModal] = useState(null);
  const [modalError, setModalError] = useState('');

  useEffect(() => {
    if (session) loadData();
  }, [session]);

  const loadData = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const [{ profile: prof }, pricing, activeRes] = await Promise.all([
        memberApi.getMe(),
        pricingApi.getPlans(),
        subscriptionApi.getActive().catch(() => ({ subscription: null })),
      ]);
      setProfile(prof);
      setPlanTarifaire(pricing.plan_tarifaire);
      setTarifs(pricing.tarifs || []);
      setActiveSub(activeRes.subscription || null);
    } catch (e) {
      if (e.message.includes('Session expirée')) {
        await supabase.auth.signOut();
        navigate('/login');
        return;
      }
      setError(e.message);
    }

    try {
      const hist = await pricingApi.getMyHistory();
      setHistory(hist.history || []);
    } catch {
      setHistory([]);
    } finally {
      setLoading(false);
    }
  };

  const handleValidatePromo = useCallback(async (typeAbonnement) => {
    if (!promoCode.trim()) {
      setError('Saisissez un code promo.');
      return;
    }
    setValidating(true);
    setError('');
    setPromoResult(null);
    setSelectedType(typeAbonnement);
    try {
      const result = await pricingApi.validatePromo({
        code: promoCode.trim(),
        type_abonnement: typeAbonnement,
        plan_tarifaire: planTarifaire,
      });
      setPromoResult(result);
    } catch (e) {
      if (e.message.includes('Session expirée')) {
        await supabase.auth.signOut();
        navigate('/login');
        return;
      }
      setError(e.message);
    } finally {
      setValidating(false);
    }
  }, [promoCode, planTarifaire, navigate]);

  const handleSubscribe = async (type) => {
    setSubscribing(true);
    setModalError('');
    setError('');
    setSuccess('');
    try {
      const result = await subscriptionApi.selfSubscribe({
        type,
        code_promo: promoResult?.valid ? promoCode.trim() : undefined,
        renouvellement_auto: false,
      });
      setSuccess('Abonnement créé avec succès !');
      setConfirmModal(null);
      setPromoResult(null);
      setSelectedType(null);
      await loadData();
    } catch (e) {
      if (e.message.includes('Session expirée')) {
        await supabase.auth.signOut();
        navigate('/login');
        return;
      }
      setModalError(e.message);
      setError(e.message);
    } finally {
      setSubscribing(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  const getTarifDisplayPrice = (tarif) => {
    if (promoResult?.valid && selectedType === tarif.type_abonnement) {
      return promoResult.prix_final;
    }
    return Number(tarif.prix);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F6F9]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-secondary" />
      </div>
    );
  }

  return (
    <PortalLayout profile={profile} onLogout={handleLogout}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1
            className="text-2xl font-bold text-primary mb-1"
            style={{ fontFamily: 'Sora, sans-serif' }}
          >
            Abonnements & tarifs
          </h1>
          <p className="text-on-surface-variant text-sm">
            Plan {PLAN_LABELS[planTarifaire] || planTarifaire}
          </p>
        </div>

        {/* Alert messages */}
        {error && (
          <div className="mb-6 p-4 bg-[#FFF0ED] border border-[#FF6F59]/20 text-[#FF6F59] text-sm rounded-2xl flex items-center gap-3">
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>error</span>
            {error}
          </div>
        )}
        {success && (
          <div className="mb-6 p-4 bg-[#E8FBF3] border border-[#2FBE8F]/20 text-[#1a7a5a] text-sm rounded-2xl flex items-center gap-3">
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>check_circle</span>
            {success}
          </div>
        )}

        {/* Active Subscription Card */}
        {activeSub && (
          <div
            className="mb-8 rounded-3xl overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #100f0d, #f95d00)', boxShadow: '0 8px 32px rgba(249,93,0,0.2)' }}
          >
            <div className="p-6 sm:p-8 text-white">
              <div className="flex items-center gap-2 mb-1">
                <span className="material-symbols-outlined" style={{ fontSize: 20, opacity: 0.7 }}>verified</span>
                <span className="text-xs font-semibold uppercase tracking-wider opacity-70">Abonnement actif</span>
              </div>
              <h2 className="text-2xl font-bold mb-3" style={{ fontFamily: 'Sora, sans-serif' }}>
                {SUBSCRIPTION_LABELS[activeSub.type] || activeSub.type}
              </h2>
              <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                <div>
                  <p className="text-xs opacity-60 mb-0.5">Début</p>
                  <p className="text-sm font-semibold">{new Date(activeSub.date_debut).toLocaleDateString('fr-FR')}</p>
                </div>
                <div>
                  <p className="text-xs opacity-60 mb-0.5">Fin</p>
                  <p className="text-sm font-semibold">{new Date(activeSub.date_fin).toLocaleDateString('fr-FR')}</p>
                </div>
                <div>
                  <p className="text-xs opacity-60 mb-0.5">Statut</p>
                  <p className="text-sm font-semibold flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#2FBE8F]" />
                    Actif
                  </p>
                </div>
                <div>
                  <p className="text-xs opacity-60 mb-0.5">Jours restants</p>
                  <p className="text-sm font-semibold">
                    {Math.max(0, Math.ceil((new Date(activeSub.date_fin) - new Date()) / (1000 * 60 * 60 * 24)))} jours
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left — Plans */}
          <div className="lg:col-span-8 space-y-6">
            {/* Promo Code Input */}
            <div className="bg-white rounded-3xl p-6 border border-outline-variant/10" style={{ boxShadow: '0 2px 8px rgba(16,35,63,0.04)' }}>
              <div className="flex items-center gap-2 mb-4">
                <span className="material-symbols-outlined text-secondary" style={{ fontSize: 20 }}>local_offer</span>
                <h2 className="text-sm font-bold text-primary" style={{ fontFamily: 'Sora, sans-serif' }}>
                  Code promo
                </h2>
              </div>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={promoCode}
                  onChange={(e) => { setPromoCode(e.target.value.toUpperCase()); setPromoResult(null); }}
                  placeholder="Ex: WELCOME10"
                  className="flex-1 px-4 py-2.5 rounded-xl border border-outline-variant/20 text-sm focus:outline-none focus:border-secondary/40 transition-colors uppercase"
                />
                <button
                  onClick={() => selectedType && handleValidatePromo(selectedType)}
                  disabled={validating || !promoCode.trim() || !selectedType}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold text-secondary border border-secondary/20 hover:bg-secondary/5 transition-all disabled:opacity-40"
                >
                  {validating ? '...' : 'Vérifier'}
                </button>
              </div>
              {promoResult?.valid && (
                <div className="mt-4 p-4 bg-[#E8FBF3] border border-[#2FBE8F]/20 rounded-xl">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="material-symbols-outlined text-[#2FBE8F]" style={{ fontSize: 18 }}>check_circle</span>
                    <span className="text-sm font-bold text-[#1a7a5a]">
                      Code {promoResult.code} appliqué !
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-on-surface-variant line-through">{promoResult.prix_initial.toFixed(3)} DT</span>
                    <span className="text-on-surface-variant">→</span>
                    <span className="font-bold text-[#1a7a5a]">{promoResult.prix_final.toFixed(3)} DT</span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#2FBE8F]/15 text-[#1a7a5a]">
                      −{promoResult.reduction.toFixed(3)} DT
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Plans Grid */}
            <div className="bg-white rounded-3xl p-6 border border-outline-variant/10" style={{ boxShadow: '0 2px 8px rgba(16,35,63,0.04)' }}>
              <h2 className="text-sm font-bold text-primary mb-5" style={{ fontFamily: 'Sora, sans-serif' }}>
                Choisir un abonnement
              </h2>
              {tarifs.length === 0 ? (
                <p className="text-sm text-on-surface-variant">
                  Tarifs non configurés. Exécutez la migration{' '}
                  <code className="text-xs bg-surface-container-high px-1 rounded">s2_dev1_tarifs_promo.sql</code>{' '}
                  dans Supabase.
                </p>
              ) : (
                <div className="grid sm:grid-cols-2 gap-4">
                  {tarifs.map((tarif) => {
                    const displayPrice = getTarifDisplayPrice(tarif);
                    const hasDiscount = promoResult?.valid && selectedType === tarif.type_abonnement;
                    const isDisabled = activeSub && activeSub.statut === 'active';

                    return (
                      <div
                        key={tarif.id}
                        className={`relative rounded-2xl border-2 p-5 transition-all duration-200 ${
                          isDisabled
                            ? 'border-outline-variant/10 bg-surface-variant/10 opacity-60'
                            : 'border-outline-variant/15 hover:border-secondary/30 hover:-translate-y-0.5'
                        }`}
                        style={!isDisabled ? { boxShadow: '0 2px 8px rgba(16,35,63,0.04)' } : {}}
                      >
                        <div className="flex items-start gap-3 mb-3">
                          <span
                            className="flex items-center justify-center w-10 h-10 rounded-xl shrink-0"
                            style={{ background: 'rgba(0,84,203,0.06)' }}
                          >
                            <span className="material-symbols-outlined text-secondary" style={{ fontSize: 22 }}>
                              {SUBSCRIPTION_ICONS[tarif.type_abonnement] || 'card_membership'}
                            </span>
                          </span>
                          <div className="flex-1 min-w-0">
                            <h3 className="text-sm font-bold text-primary" style={{ fontFamily: 'Sora, sans-serif' }}>
                              {SUBSCRIPTION_LABELS[tarif.type_abonnement] || tarif.label}
                            </h3>
                            {tarif.type_espace && (
                              <span className="inline-flex mt-1 items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
                                style={{ background: 'rgba(249,93,0,0.1)', color: '#b34a00' }}
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 12 }}>meeting_room</span>
                                {ESPACE_TYPE_LABELS[tarif.type_espace] || tarif.type_espace}
                              </span>
                            )}
                            {tarif.duree_jours && (
                              <span className="text-xs text-on-surface-variant/60">{tarif.duree_jours} jours</span>
                            )}
                          </div>
                        </div>

                        <div className="mb-4">
                          {hasDiscount && (
                            <p className="text-xs text-on-surface-variant/50 line-through mb-0.5">
                              {Number(tarif.prix).toFixed(3)} DT TTC
                            </p>
                          )}
                          <p className="text-xl font-bold text-secondary" style={{ fontFamily: 'Sora, sans-serif' }}>
                            {displayPrice.toFixed(3)} DT
                            <span className="text-xs font-normal text-on-surface-variant ml-1">TTC</span>
                          </p>
                          <p className="text-xs text-on-surface-variant/50 mt-0.5">TVA {tarif.tva_pct}%</p>
                        </div>

                        <div className="flex flex-col gap-2">
                          {!promoCode.trim() ? (
                            <button
                              onClick={() => {
                                setSelectedType(tarif.type_abonnement);
                                document.querySelector('#promo-input-ref')?.focus();
                              }}
                              disabled={isDisabled}
                              className="w-full py-2.5 rounded-xl text-sm font-semibold border border-secondary/20 text-secondary hover:bg-secondary/5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              Appliquer un code promo
                            </button>
                          ) : (
                            <button
                              onClick={() => handleValidatePromo(tarif.type_abonnement)}
                              disabled={validating || isDisabled}
                              className="w-full py-2.5 rounded-xl text-sm font-semibold border border-secondary/20 text-secondary hover:bg-secondary/5 transition-all disabled:opacity-40"
                            >
                              {validating && selectedType === tarif.type_abonnement ? 'Vérification...' : 'Vérifier le code'}
                            </button>
                          )}
                          <button
                            onClick={() => { setConfirmModal({ type: tarif.type_abonnement, label: SUBSCRIPTION_LABELS[tarif.type_abonnement], price: displayPrice }); setModalError(''); }}
                            disabled={isDisabled}
                            className="w-full py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.98]"
                            style={!isDisabled ? { background: 'linear-gradient(135deg, #f95d00, #ff7a28)', boxShadow: '0 4px 12px rgba(249,93,0,0.2)' } : { background: '#ccc' }}
                          >
                            Souscrire maintenant
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* History */}
            {history.length > 0 && (
              <div className="bg-white rounded-3xl p-6 border border-outline-variant/10" style={{ boxShadow: '0 2px 8px rgba(16,35,63,0.04)' }}>
                <h2 className="text-sm font-bold text-primary mb-4" style={{ fontFamily: 'Sora, sans-serif' }}>
                  Historique des abonnements
                </h2>
                <div className="space-y-3">
                  {history.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-4 rounded-xl bg-surface-variant/15"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="flex items-center justify-center w-9 h-9 rounded-lg"
                          style={{ background: 'rgba(0,84,203,0.06)' }}
                        >
                          <span className="material-symbols-outlined text-secondary" style={{ fontSize: 18 }}>
                            {SUBSCRIPTION_ICONS[item.type_abonnement] || 'card_membership'}
                          </span>
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-primary">
                            {SUBSCRIPTION_LABELS[item.type_abonnement] || item.type_abonnement}
                          </p>
                          <p className="text-xs text-on-surface-variant/60">
                            {new Date(item.created_at).toLocaleDateString('fr-FR')}
                            {item.codes_promo?.code ? ` · Code ${item.codes_promo.code}` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        {item.prix_initial !== item.prix_final && (
                          <p className="text-xs text-on-surface-variant/50 line-through">
                            {Number(item.prix_initial).toFixed(3)} DT
                          </p>
                        )}
                        <p className="text-sm font-bold text-secondary">{Number(item.prix_final).toFixed(3)} DT</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Sidebar */}
          <div className="lg:col-span-4 space-y-4">
            <div className="bg-surface-variant/15 rounded-2xl p-5 border border-outline-variant/10">
              <div className="flex gap-3 items-start">
                <span className="material-symbols-outlined text-secondary" style={{ fontSize: 20 }}>info</span>
                <div>
                  <p className="text-sm font-semibold text-primary mb-1" style={{ fontFamily: 'Sora, sans-serif' }}>
                    Comment ça marche ?
                  </p>
                  <ol className="text-xs text-on-surface-variant/70 space-y-1.5 list-decimal list-inside">
                    <li>Saisissez un code promo (optionnel)</li>
                    <li>Cliquez « Vérifier le code » pour voir le prix réduit</li>
                    <li>Cliquez « Souscrire maintenant »</li>
                    <li>Le règlement s&apos;effectue sur place à l&apos;accueil (espèces, chèque ou virement)</li>
                  </ol>
                </div>
              </div>
            </div>

            {activeSub && (
              <div className="bg-white rounded-2xl p-5 border border-outline-variant/10" style={{ boxShadow: '0 2px 8px rgba(16,35,63,0.04)' }}>
                <p className="text-xs text-on-surface-variant/60 mb-2">
                  Vous avez déjà un abonnement actif.
                </p>
                <p className="text-sm font-semibold text-primary">
                  {SUBSCRIPTION_LABELS[activeSub.type]} — expire le {new Date(activeSub.date_fin).toLocaleDateString('fr-FR')}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Confirm Modal */}
        {confirmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
            <div
              className="bg-white rounded-3xl p-6 sm:p-8 w-full max-w-md"
              style={{ boxShadow: '0 24px 64px rgba(0,13,35,0.2)' }}
            >
              <div className="flex items-center gap-3 mb-5">
                <span
                  className="flex items-center justify-center w-11 h-11 rounded-full"
                  style={{ background: 'rgba(0,84,203,0.06)' }}
                >
                  <span className="material-symbols-outlined text-secondary" style={{ fontSize: 22 }}>card_membership</span>
                </span>
                <div>
                  <h3 className="text-lg font-bold text-primary" style={{ fontFamily: 'Sora, sans-serif' }}>
                    Confirmer la souscription
                  </h3>
                  <p className="text-xs text-on-surface-variant/60">{confirmModal.label}</p>
                </div>
              </div>

              <div className="bg-surface-variant/15 rounded-xl p-4 mb-5">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-on-surface-variant">Abonnement</span>
                  <span className="text-sm font-semibold text-primary">{confirmModal.label}</span>
                </div>
                {promoResult?.valid && selectedType === confirmModal.type && (
                  <>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm text-on-surface-variant">Réduction</span>
                      <span className="text-sm font-semibold text-[#2FBE8F]">−{promoResult.reduction.toFixed(3)} DT</span>
                    </div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs text-on-surface-variant/50 line-through">{promoResult.prix_initial.toFixed(3)} DT</span>
                      <span />
                    </div>
                  </>
                )}
                <div className="border-t border-outline-variant/15 pt-2 mt-2 flex justify-between items-center">
                  <span className="text-sm font-bold text-primary">Total</span>
                  <span className="text-lg font-bold text-secondary" style={{ fontFamily: 'Sora, sans-serif' }}>
                    {confirmModal.price.toFixed(3)} DT
                  </span>
                </div>
              </div>

              {modalError && (
                <div className="mb-4 p-3 bg-[#FFF0ED] border border-[#FF6F59]/20 text-[#FF6F59] text-xs rounded-xl flex items-center gap-2">
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>error</span>
                  {modalError}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmModal(null)}
                  disabled={subscribing}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold border border-outline-variant/20 text-on-surface-variant hover:bg-surface-variant/20 transition-all"
                >
                  Annuler
                </button>
                <button
                  onClick={() => handleSubscribe(confirmModal.type)}
                  disabled={subscribing}
                  className="flex-1 py-3 rounded-xl text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #f95d00, #ff7a28)', boxShadow: '0 4px 12px rgba(249,93,0,0.2)' }}
                >
                  {subscribing ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="material-symbols-outlined animate-spin" style={{ fontSize: 16 }}>progress_activity</span>
                      Création...
                    </span>
                  ) : (
                    'Confirmer'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
