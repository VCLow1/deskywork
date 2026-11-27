import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { memberApi, pricingApi, subscriptionApi } from '../services/api';
import PortalLayout from '../components/layout/PortalLayout';
import Money from '../components/common/Money';
import { formatDateDMY } from '../utils/format';

const SUBSCRIPTION_LABELS = {
  day_pass: 'Pass journée',
  week_pass: 'Pass semaine',
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

const ESPACE_TYPE_LABELS = {
  open_space: 'Open space',
  private_office: 'Bureau privé',
  meeting_room: 'Salle de réunion',
  training_room: 'Salle de formation',
  event_space: 'Espace événementiel',
  hot_desk: 'Poste nomade',
  dedicated_desk: 'Poste fixe',
};

function computeLocalPromoPreview(baseAmount, promo) {
  if (!promo?.valid) return baseAmount;
  const base = Number(baseAmount) || 0;
  if (promo.type_reduction === 'percent') {
    return Math.max(0, Math.round((base * (1 - Number(promo.valeur || 0) / 100)) * 1000) / 1000);
  }
  return Math.max(0, Math.round((base - Number(promo.valeur || 0)) * 1000) / 1000);
}

export default function MemberSubscription({ session }) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [tarifs, setTarifs] = useState([]);
  const [activeSub, setActiveSub] = useState(null);
  const [pendingRequest, setPendingRequest] = useState(null);
  const [history, setHistory] = useState([]);

  // Champ global unique "Code promo"
  const [promoCode, setPromoCode] = useState('');
  const [promoResult, setPromoResult] = useState(null);
  const [validatingPromo, setValidatingPromo] = useState(false);
  const [promoError, setPromoError] = useState('');

  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);
  const [cancellingReq, setCancellingReq] = useState(false);
  const [resiliating, setResiliating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [confirmModal, setConfirmModal] = useState(null);
  const [modalError, setModalError] = useState('');
  const [showResiliateModal, setShowResiliateModal] = useState(false);
  const [resiliateMotif, setResiliateMotif] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [profRes, pricingRes, activeRes, mineRes, histRes] = await Promise.all([
        memberApi.getMe(),
        pricingApi.getPlans(),
        subscriptionApi.getActive().catch(() => ({ subscription: null })),
        subscriptionApi.getMine().catch(() => ({ subscriptions: [] })),
        pricingApi.getMyHistory().catch(() => ({ history: [] })),
      ]);
      setProfile(profRes.profile);
      setTarifs(pricingRes.tarifs || []);
      setActiveSub(activeRes.subscription || null);
      const mine = mineRes.subscriptions || [];
      setPendingRequest(mine.find((s) => s.statut === 'en_attente_paiement') || null);
      setHistory(histRes.history || []);
    } catch (e) {
      if (String(e.message || '').includes('Session expirée')) {
        await supabase.auth.signOut();
        navigate('/login');
        return;
      }
      setError(e.message || 'Impossible de charger les abonnements.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (session) loadData(); }, [session]);

  const handleApplyGlobalPromo = async (e) => {
    e?.preventDefault?.();
    if (!promoCode.trim()) {
      setPromoError('Saisissez un code promo.');
      return;
    }
    setValidatingPromo(true);
    setPromoError('');
    setPromoResult(null);
    try {
      const sampleTarif = tarifs[0];
      const result = await pricingApi.validatePromo({
        code: promoCode.trim(),
        montant_ht: sampleTarif ? Number(sampleTarif.prix_ht ?? sampleTarif.prix ?? 100) : 100,
      });
      setPromoResult(result);
    } catch (err) {
      setPromoError(err.message || 'Code promo invalide ou expiré.');
    } finally {
      setValidatingPromo(false);
    }
  };

  const handleClearPromo = () => {
    setPromoCode('');
    setPromoResult(null);
    setPromoError('');
  };

  const handleSubscribe = async ({ type, isRenewal = false }) => {
    setSubscribing(true);
    setModalError('');
    setError('');
    setSuccess('');
    try {
      const res = await subscriptionApi.selfSubscribe({
        type,
        code_promo: promoResult?.valid ? promoCode.trim() : undefined,
        renouvellement_auto: false,
        is_renewal: isRenewal,
      });
      setConfirmModal(null);
      setSuccess(
        res.message || "Demande enregistrée au statut « En attente de paiement ». Règlement sur place à l'accueil pour activer votre formule."
      );
      await loadData();
    } catch (err) {
      setModalError(err.message);
    } finally {
      setSubscribing(false);
    }
  };

  const handleCancelPendingRequest = async () => {
    if (!pendingRequest) return;
    setCancellingReq(true);
    setError('');
    try {
      await subscriptionApi.cancelRequest(pendingRequest.id);
      setSuccess("Votre demande d'abonnement a été annulée.");
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setCancellingReq(false);
    }
  };

  const handleConfirmResiliate = async (e) => {
    e.preventDefault();
    if (!activeSub) return;
    setResiliating(true);
    setError('');
    try {
      await subscriptionApi.resiliate(activeSub.id, { motif: resiliateMotif.trim() });
      setShowResiliateModal(false);
      setResiliateMotif('');
      setSuccess('Votre abonnement a bien été résilié.');
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setResiliating(false);
    }
  };

  const openRenewModal = () => {
    if (!activeSub) return;
    const matchedTarif = tarifs.find((t) => t.type_abonnement === activeSub.type) || tarifs[0];
    if (!matchedTarif) return;
    const baseHT = Number(matchedTarif.prix_ht ?? 0);
    const tva = Number(matchedTarif.tva_pct ?? 19);
    const finalHT = computeLocalPromoPreview(baseHT, promoResult);
    const finalTTC = Math.round(finalHT * (1 + tva / 100) * 1000) / 1000;
    setModalError('');
    setConfirmModal({
      type: matchedTarif.type_abonnement,
      label: SUBSCRIPTION_LABELS[matchedTarif.type_abonnement] || matchedTarif.label,
      prixHT: finalHT,
      prixTTC: finalTTC,
      tvaPct: tva,
      isRenewal: true,
    });
  };

  const activeQuotaPct = useMemo(() => {
    if (!activeSub || !activeSub.quota_total || activeSub.quota_type === 'illimite') return 0;
    return Math.min(100, Math.round((Number(activeSub.quota_consomme || 0) / Number(activeSub.quota_total)) * 100));
  }, [activeSub]);

  const activeDaysLeft = useMemo(() => {
    if (!activeSub?.date_fin) return 0;
    return Math.max(0, Math.ceil((new Date(activeSub.date_fin).getTime() - Date.now()) / 86400000));
  }, [activeSub]);

  const handleLogout = async () => { await supabase.auth.signOut(); navigate('/'); };

  if (loading) {
    return (
      <PortalLayout profile={profile} onLogout={handleLogout}>
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-[#f95d00] border-t-transparent" />
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout profile={profile} onLogout={handleLogout}>
      <div className="space-y-6">
        <div>
          <h1 className="font-sora text-2xl font-bold text-primary dark:text-white">Mon abonnement</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Consultez votre formule en cours, suivez votre consommation ou souscrivez à une nouvelle offre.
          </p>
        </div>

        {error && (
          <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>error</span>
            {error}
          </div>
        )}
        {success && (
          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>check_circle</span>
            {success}
          </div>
        )}

        {/* Demande en attente de paiement */}
        {pendingRequest && (
          <div className="rounded-3xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-amber-200/70 text-amber-900 text-xs font-bold">
                <span className="material-symbols-outlined" style={{ fontSize: 15 }}>hourglass_top</span>
                En attente de paiement
              </div>
              <h2 className="font-sora font-bold text-lg text-primary dark:text-white">
                {SUBSCRIPTION_LABELS[pendingRequest.type] || pendingRequest.type}
              </h2>
              <p className="text-xs text-amber-900 dark:text-amber-200">
                Période prévue : {formatDateDMY(pendingRequest.date_debut)} → {formatDateDMY(pendingRequest.date_fin)}
                {pendingRequest.montant_ttc > 0 && (
                  <> · Montant à régler à l&apos;accueil : <strong><Money amount={pendingRequest.montant_ttc} showTaxType="TTC" /></strong></>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <Link
                to="/member/payments"
                className="px-4 py-2 rounded-xl bg-[#100f0d] text-white text-xs font-bold"
              >
                Voir mes paiements
              </Link>
              <button
                type="button"
                onClick={handleCancelPendingRequest}
                disabled={cancellingReq}
                className="px-4 py-2 rounded-xl border border-rose-300 text-rose-700 text-xs font-bold hover:bg-rose-50 disabled:opacity-50"
              >
                {cancellingReq ? 'Annulation…' : 'Annuler la demande'}
              </button>
            </div>
          </div>
        )}

        {/* Abonnement actif en tête (jauge, dates, Renouveler / Résilier) */}
        {activeSub && (
          <div className="rounded-3xl p-6 sm:p-7 text-white relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #100f0d, #2c1810)', boxShadow: '0 10px 30px rgba(16,15,13,0.22)' }}>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
              <div className="space-y-3 flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-3 py-1 rounded-full bg-[#f95d00] text-white text-xs font-bold uppercase tracking-wider">
                    {activeSub.statut === 'a_renouveler' ? 'À renouveler' : 'Abonnement actif'}
                  </span>
                  <span className="text-xs text-[#d6d3d1]">
                    {activeDaysLeft} jour{activeDaysLeft > 1 ? 's' : ''} restant{activeDaysLeft > 1 ? 's' : ''}
                  </span>
                </div>
                <h2 className="font-sora text-2xl font-bold">
                  {SUBSCRIPTION_LABELS[activeSub.type] || activeSub.type}
                </h2>
                <p className="text-xs sm:text-sm text-[#d6d3d1]">
                  Valable du <strong>{formatDateDMY(activeSub.date_debut)}</strong> au <strong>{formatDateDMY(activeSub.date_fin)}</strong>
                  {activeSub.unite?.code ? ` · Bureau ${activeSub.unite.code}` : ''}
                </p>

                {/* Jauge de consommation */}
                <div className="pt-1 max-w-md space-y-1.5">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-[#d6d3d1]">Consommation incluse</span>
                    <span>
                      {activeSub.quota_total > 0 && activeSub.quota_type !== 'illimite'
                        ? `${activeSub.quota_consomme || 0} / ${activeSub.quota_total} ${activeSub.quota_type === 'jours' ? 'j' : 'h'} (${activeQuotaPct}%)`
                        : 'Accès illimité'}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-white/15 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${activeSub.quota_total > 0 && activeSub.quota_type !== 'illimite' ? activeQuotaPct : 100}%`,
                        backgroundColor: activeQuotaPct >= 90 ? '#f59e0b' : '#f95d00',
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={openRenewModal}
                  disabled={Boolean(pendingRequest)}
                  style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
                  className="px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold hover:opacity-95 disabled:opacity-50"
                >
                  Renouveler
                </button>
                <button
                  type="button"
                  onClick={() => setShowResiliateModal(true)}
                  className="px-4 py-2.5 rounded-xl border border-white/25 text-white text-xs sm:text-sm font-bold hover:bg-white/10"
                >
                  Résilier
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Champ global unique "Code promo" */}
        <form onSubmit={handleApplyGlobalPromo} className="bg-white dark:bg-[#1a1917] rounded-3xl p-5 border border-outline-variant/15 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 20 }}>local_offer</span>
            <span className="font-sora text-sm font-bold text-primary dark:text-white">Code promo</span>
          </div>
          <input
            type="text"
            value={promoCode}
            onChange={(e) => { setPromoCode(e.target.value.toUpperCase()); setPromoResult(null); setPromoError(''); }}
            placeholder="Saisissez un code promo (optionnel)"
            className="flex-1 px-4 py-2.5 rounded-xl border border-outline-variant/25 text-sm uppercase bg-white dark:bg-[#141311] text-primary dark:text-white focus:outline-none focus:border-[#f95d00]"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={validatingPromo || !promoCode.trim()}
              style={{ backgroundColor: '#100f0d', color: '#ffffff' }}
              className="px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold disabled:opacity-40"
            >
              {validatingPromo ? 'Vérification…' : 'Appliquer'}
            </button>
            {promoResult?.valid && (
              <button type="button" onClick={handleClearPromo} className="px-3 py-2.5 rounded-xl text-xs font-semibold border border-outline-variant/25">
                Retirer
              </button>
            )}
          </div>
        </form>

        {promoError && (
          <p className="text-xs font-semibold text-rose-700 px-2">{promoError}</p>
        )}
        {promoResult?.valid && (
          <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs sm:text-sm font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>check_circle</span>
            Code {promoResult.code} actif : remise de{' '}
            {promoResult.type_reduction === 'percent' ? `${promoResult.valeur}%` : <Money amount={promoResult.valeur} />} appliquée aux offres ci-dessous.
          </div>
        )}

        {/* Offres disponibles — 1 carte unique dédupliquée par formule */}
        <section className="space-y-4">
          <h2 className="font-sora text-lg font-bold text-primary dark:text-white">Offres disponibles</h2>

          {tarifs.length === 0 ? (
            <div className="bg-white dark:bg-[#1a1917] rounded-2xl p-8 text-center text-sm text-on-surface-variant border border-outline-variant/15">
              Aucune formule disponible pour le moment. Contactez votre établissement.
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {tarifs.map((tarif) => {
                const baseHT = Number(tarif.prix_ht ?? tarif.prix ?? 0);
                const tvaPct = Number(tarif.tva_pct ?? 19);
                const baseTTC = Number(tarif.prix_ttc ?? Math.round(baseHT * (1 + tvaPct / 100) * 1000) / 1000);
                const finalHT = computeLocalPromoPreview(baseHT, promoResult);
                const finalTTC = Math.round(finalHT * (1 + tvaPct / 100) * 1000) / 1000;
                const hasDiscount = promoResult?.valid && finalTTC < baseTTC;
                const blockedByActiveOrPending = Boolean(pendingRequest) || (Boolean(activeSub) && activeSub.statut === 'active');

                return (
                  <div
                    key={tarif.id || `${tarif.type_abonnement}-${tarif.type_espace || 'all'}`}
                    className="bg-white dark:bg-[#1a1917] rounded-3xl border border-outline-variant/20 p-5 flex flex-col justify-between gap-4 shadow-xs"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start gap-3">
                        <span className="w-11 h-11 rounded-xl flex items-center justify-center bg-[#f95d00]/10 text-[#f95d00] shrink-0">
                          <span className="material-symbols-outlined" style={{ fontSize: 22 }}>
                            {SUBSCRIPTION_ICONS[tarif.type_abonnement] || 'card_membership'}
                          </span>
                        </span>
                        <div className="min-w-0">
                          <h3 className="font-sora font-bold text-base text-primary dark:text-white">
                            {SUBSCRIPTION_LABELS[tarif.type_abonnement] || tarif.label}
                          </h3>
                          {tarif.type_espace && (
                            <span className="inline-flex mt-1 items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-[#ffedd8] text-[#9a3412]">
                              {ESPACE_TYPE_LABELS[tarif.type_espace] || tarif.type_espace}
                            </span>
                          )}
                        </div>
                      </div>

                      {tarif.description && (
                        <p className="text-xs text-on-surface-variant leading-relaxed">{tarif.description}</p>
                      )}

                      {Array.isArray(tarif.avantages) && tarif.avantages.length > 0 && (
                        <ul className="space-y-1.5 text-xs text-primary dark:text-slate-200">
                          {tarif.avantages.map((av, idx) => (
                            <li key={idx} className="flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-emerald-600 shrink-0" style={{ fontSize: 15 }}>check_circle</span>
                              <span>{av}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="pt-3 border-t border-outline-variant/15 space-y-3">
                      <div>
                        {hasDiscount && (
                          <p className="text-xs text-on-surface-variant line-through">
                            <Money amount={baseTTC} showTaxType="TTC" />
                          </p>
                        )}
                        <p className="font-sora text-xl font-extrabold text-[#f95d00]">
                          <Money amount={finalTTC} zeroLabel="Gratuit" showTaxType="TTC" />
                        </p>
                        <p className="text-xs text-on-surface-variant">
                          Soit <Money amount={finalHT} zeroLabel="Gratuit" showTaxType="HT" /> · TVA {tvaPct}%
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setModalError('');
                          setConfirmModal({
                            type: tarif.type_abonnement,
                            label: SUBSCRIPTION_LABELS[tarif.type_abonnement] || tarif.label,
                            prixHT: finalHT,
                            prixTTC: finalTTC,
                            tvaPct,
                            isRenewal: false,
                          });
                        }}
                        disabled={blockedByActiveOrPending}
                        style={!blockedByActiveOrPending ? { backgroundColor: '#f95d00', color: '#ffffff' } : undefined}
                        className="w-full py-2.5 rounded-xl text-sm font-bold transition disabled:opacity-40 disabled:bg-slate-200 disabled:text-slate-500 cursor-pointer"
                      >
                        {pendingRequest ? 'Demande en cours' : activeSub ? 'Abonnement actif' : 'Souscrire'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Historique éventuel */}
        {history.length > 0 && (
          <section className="bg-white dark:bg-[#1a1917] rounded-3xl p-5 sm:p-6 border border-outline-variant/15">
            <h2 className="font-sora text-base font-bold text-primary dark:text-white mb-4">Historique tarifaire</h2>
            <div className="space-y-2.5">
              {history.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-3.5 rounded-xl bg-surface-container-low/40">
                  <div>
                    <p className="text-sm font-semibold text-primary dark:text-white">
                      {SUBSCRIPTION_LABELS[item.type_abonnement] || item.type_abonnement}
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      {formatDateDMY(item.created_at)}{item.codes_promo?.code ? ` · Code ${item.codes_promo.code}` : ''}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-[#f95d00]"><Money amount={item.prix_final} /></p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Modale confirmation souscription / renouvellement */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmModal(null)}>
          <div className="bg-white dark:bg-[#1a1917] rounded-3xl p-6 max-w-md w-full border border-outline-variant/20 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-sora text-lg font-bold text-primary dark:text-white">
              {confirmModal.isRenewal ? "Renouveler l'abonnement" : "Confirmer la demande d'abonnement"}
            </h3>
            <div className="rounded-2xl bg-surface-container-low/50 p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Formule</span>
                <span className="font-bold text-primary dark:text-white">{confirmModal.label}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Montant HT</span>
                <span><Money amount={confirmModal.prixHT} showTaxType="HT" /></span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">TVA ({confirmModal.tvaPct}%)</span>
                <span><Money amount={Math.max(0, confirmModal.prixTTC - confirmModal.prixHT)} /></span>
              </div>
              <div className="flex justify-between border-t border-outline-variant/15 pt-2 font-bold">
                <span>Total TTC</span>
                <span className="text-[#f95d00]"><Money amount={confirmModal.prixTTC} showTaxType="TTC" /></span>
              </div>
            </div>
            <p className="text-xs text-on-surface-variant leading-relaxed">
              Votre demande sera enregistrée au statut <strong>En attente de paiement</strong>. Elle sera activée dès l&apos;encaissement à l&apos;accueil.
            </p>
            {modalError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">{modalError}</div>
            )}
            <div className="flex gap-3">
              <button type="button" onClick={() => setConfirmModal(null)} className="flex-1 py-2.5 rounded-xl border border-outline-variant/30 text-xs font-bold">
                Annuler
              </button>
              <button
                type="button"
                disabled={subscribing}
                onClick={() => handleSubscribe({ type: confirmModal.type, isRenewal: confirmModal.isRenewal })}
                style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold disabled:opacity-50"
              >
                {subscribing ? 'Envoi…' : 'Valider la demande'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale résiliation membre */}
      {showResiliateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowResiliateModal(false)}>
          <form onSubmit={handleConfirmResiliate} className="bg-white dark:bg-[#1a1917] rounded-3xl p-6 max-w-md w-full border border-outline-variant/20 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-sora text-lg font-bold text-primary dark:text-white">Résilier mon abonnement ?</h3>
            <p className="text-xs text-on-surface-variant">
              Cette action met fin à votre abonnement et désactive tout renouvellement.
            </p>
            <div>
              <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Motif (optionnel)</label>
              <input
                type="text"
                value={resiliateMotif}
                onChange={(e) => setResiliateMotif(e.target.value)}
                placeholder="Ex : Fin de projet, changement de rythme…"
                className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant/30 text-sm"
              />
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShowResiliateModal(false)} className="flex-1 py-2.5 rounded-xl border border-outline-variant/30 text-xs font-bold">
                Conserver
              </button>
              <button
                type="submit"
                disabled={resiliating}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 text-white text-xs font-bold disabled:opacity-50"
              >
                {resiliating ? 'Résiliation…' : 'Confirmer la résiliation'}
              </button>
            </div>
          </form>
        </div>
      )}
    </PortalLayout>
  );
}
