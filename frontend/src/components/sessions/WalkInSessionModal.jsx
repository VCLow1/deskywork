// components/sessions/WalkInSessionModal.jsx — Parcours rapide Client sur place (Walk-in) & Chrono serveur (LOT 3)
import React, { useState, useEffect, useMemo } from 'react';
import { sessionApi, tenantAdminApi } from '../../services/api';
import { validateTunisianPhone } from '../../utils/tunisianPhone';
import { DEFAULT_TVA_PCT, computeHTFromTTC } from '../../utils/pricingMath';
import { computeWalkinBilling } from '../../utils/walkinBilling';
import { useServerTimer } from '../../hooks/useServerTimer';
import TunisianPhoneInput from '../common/TunisianPhoneInput';
import Money from '../common/Money';

function generateIdemKey() {
  return `walkin-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function WalkInSessionModal({
  isOpen,
  onClose,
  onSuccess,
  espaces = [],
  existingSession = null,
  serverNow: initialServerNow = null,
}) {
  const [nom, setNom] = useState('');
  const [prenom, setPrenom] = useState('');
  const [telephone, setTelephone] = useState('');
  const [dupMatch, setDupMatch] = useState(null);
  const [espaceId, setEspaceId] = useState('');
  const [uniteId, setUniteId] = useState('');
  const [unites, setUnites] = useState([]);
  const [idemKey, setIdemKey] = useState(() => generateIdemKey());

  const [activeWalkin, setActiveWalkin] = useState(existingSession);
  const [serverNow, setServerNow] = useState(initialServerNow);
  const [stoppedBilling, setStoppedBilling] = useState(null);
  const [encaisserMaintenant, setEncaisserMaintenant] = useState(true);
  const [modePaiement, setModePaiement] = useState('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setActiveWalkin(existingSession);
    setServerNow(initialServerNow);
    setStoppedBilling(null);
    setError('');
    setIdemKey(generateIdemKey());
    tenantAdminApi.getUnites().then((r) => setUnites(r.unites || [])).catch(() => {});
  }, [isOpen, existingSession, initialServerNow]);

  useEffect(() => {
    const check = validateTunisianPhone(telephone);
    if (!check.valid || !check.normalized || activeWalkin) {
      setDupMatch(null);
      return;
    }
    tenantAdminApi
      .checkPersonnePhone(check.normalized)
      .then((res) => setDupMatch(res.exists ? res.match : null))
      .catch(() => setDupMatch(null));
  }, [telephone, activeWalkin]);

  const timer = useServerTimer({
    startedAt: activeWalkin?.started_at || activeWalkin?.check_in || null,
    serverNow,
    active: Boolean(isOpen && activeWalkin && !stoppedBilling),
  });

  const selectedEspace = useMemo(
    () => espaces.find((e) => e.id === (activeWalkin?.espace_id || espaceId)) || null,
    [espaces, espaceId, activeWalkin]
  );

  const spaceUnits = useMemo(
    () => unites.filter((u) => u.espace_id === espaceId && !u.archived_at && u.statut === 'disponible'),
    [unites, espaceId]
  );

  const liveBillingEstimate = useMemo(() => {
    if (!activeWalkin || !selectedEspace) return null;
    const tvaPct = Number(selectedEspace.tva_pct ?? DEFAULT_TVA_PCT);
    const tarifHT = selectedEspace.tarif_horaire_ht != null
      ? Number(selectedEspace.tarif_horaire_ht)
      : computeHTFromTTC(selectedEspace.tarif_horaire || 0, tvaPct);
    const tarifDayHT = selectedEspace.tarif_journalier_ht != null
      ? Number(selectedEspace.tarif_journalier_ht)
      : computeHTFromTTC(selectedEspace.tarif_journalier || 0, tvaPct);
    return computeWalkinBilling({
      startedAt: activeWalkin.started_at || activeWalkin.check_in,
      stoppedAt: new Date(timer.nowServerMs).toISOString(),
      tarifHoraireHT: tarifHT,
      tarifJournalierHT: tarifDayHT,
      tvaPct,
    });
  }, [activeWalkin, selectedEspace, timer.nowServerMs]);

  if (!isOpen) return null;

  const handleStartWalkin = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    const pCheck = validateTunisianPhone(telephone, { required: true });
    if (!pCheck.valid) {
      setError(pCheck.error);
      return;
    }
    if (!nom.trim() || !espaceId) {
      setError('Veuillez saisir le nom et sélectionner un espace.');
      return;
    }
    setBusy(true);
    try {
      const res = await sessionApi.startWalkin({
        nom: nom.trim(),
        prenom: prenom.trim(),
        telephone: pCheck.normalized,
        espace_id: espaceId,
        unite_id: uniteId || null,
        idempotency_key: idemKey,
      });
      setActiveWalkin(res.session);
      setServerNow(res.server_now);
      onSuccess?.(res);
    } catch (err) {
      setError(err.message || 'Impossible de démarrer la session sur place.');
    } finally {
      setBusy(false);
    }
  };

  const handleStopWalkin = async () => {
    if (!activeWalkin || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await sessionApi.stop(activeWalkin.id, {
        encaisser_maintenant: encaisserMaintenant,
        mode_paiement: modePaiement,
      });
      setStoppedBilling(res.billing || liveBillingEstimate);
      onSuccess?.(res);
    } catch (err) {
      setError(err.message || 'Erreur lors de l\'arrêt du chronomètre.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl space-y-4 text-left">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[#f95d00]">Chronomètre serveur</p>
            <h3 className="font-sora text-lg font-bold text-slate-900">Client sur place</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-3 py-1 text-xs font-bold text-slate-600">
            Fermer
          </button>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-800">{error}</div>
        )}

        {!activeWalkin ? (
          <form onSubmit={handleStartWalkin} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">Nom *</label>
                <input required value={nom} onChange={(e) => setNom(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs" />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">Prénom</label>
                <input value={prenom} onChange={(e) => setPrenom(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">Téléphone (+216) *</label>
              <TunisianPhoneInput
                required
                value={telephone}
                onChange={setTelephone}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
              />
              {dupMatch && (
                <p className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-2 mt-1.5">
                  Client existant détecté : <strong>{dupMatch.prenom} {dupMatch.nom}</strong> — sa fiche sera réutilisée sans doublon.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">Espace *</label>
                <select
                  required
                  value={espaceId}
                  onChange={(e) => {
                    setEspaceId(e.target.value);
                    setUniteId('');
                  }}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold"
                >
                  <option value="">— Choisir un espace —</option>
                  {espaces.filter((e) => !e.archived_at).map((esp) => (
                    <option key={esp.id} value={esp.id}>{esp.nom}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">Unité / Poste</label>
                <select
                  value={uniteId}
                  onChange={(e) => setUniteId(e.target.value)}
                  disabled={!espaceId || spaceUnits.length === 0}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-50"
                >
                  <option value="">{spaceUnits.length === 0 ? 'Aucune unité' : '— Libre choix —'}</option>
                  {spaceUnits.map((u) => (
                    <option key={u.id} value={u.id}>{u.code} · {u.nom}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700">
              Facturation transparente : tranches de 15 min entamées, minimum 1 h facturée, plafond automatique au tarif journalier.
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold">
                Annuler
              </button>
              <button
                type="submit"
                disabled={busy}
                style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
                className="rounded-xl px-5 py-2.5 text-xs font-bold shadow-sm hover:opacity-95 disabled:opacity-50 flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>play_arrow</span>
                {busy ? 'Démarrage…' : 'Démarrer le chronomètre'}
              </button>
            </div>
          </form>
        ) : stoppedBilling ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 space-y-2 text-xs">
              <p className="font-bold text-emerald-900">Session sur place clôturée</p>
              <div className="flex justify-between">
                <span>Durée mesurée</span>
                <strong>{stoppedBilling.elapsedMinutes} min ({stoppedBilling.billedSlices} tranches de 15 min)</strong>
              </div>
              <div className="flex justify-between">
                <span>Montant HT</span>
                <Money amount={stoppedBilling.montantHT} showTaxType="HT" />
              </div>
              <div className="flex justify-between font-bold text-slate-900 border-t border-emerald-200 pt-1.5">
                <span>Total TTC {stoppedBilling.capped ? '(Plafond journée appliqué)' : ''}</span>
                <span className="text-[#f95d00]"><Money amount={stoppedBilling.montantTTC} showTaxType="TTC" /></span>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
                className="rounded-xl px-5 py-2 text-xs font-bold"
              >
                Terminer
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl border border-orange-200 bg-orange-50/70 p-4 text-center space-y-1">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-700">
                {activeWalkin.client_nom || 'Client sur place'} · {selectedEspace?.nom || activeWalkin.espace_nom || 'Espace'}
              </p>
              <p className="font-mono text-3xl font-extrabold text-[#f95d00]">{timer.formattedElapsed}</p>
              <p className="text-xs text-slate-600">Chronomètre synchronisé serveur (UTC)</p>
            </div>

            {liveBillingEstimate && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span>Tranches facturées (min 1h)</span>
                  <strong>{liveBillingEstimate.billedSlices} × 15 min ({liveBillingEstimate.billedMinutes} min)</strong>
                </div>
                <div className="flex justify-between">
                  <span>Estimation HT</span>
                  <Money amount={liveBillingEstimate.montantHT} showTaxType="HT" />
                </div>
                <div className="flex justify-between font-bold text-slate-900">
                  <span>Estimation TTC {liveBillingEstimate.capped ? '(Plafond journalier atteint)' : ''}</span>
                  <span className="text-[#f95d00]"><Money amount={liveBillingEstimate.montantTTC} showTaxType="TTC" /></span>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 p-3 space-y-2 text-xs">
              <label className="flex items-center gap-2 font-semibold cursor-pointer">
                <input type="checkbox" checked={encaisserMaintenant} onChange={(e) => setEncaisserMaintenant(e.target.checked)} className="accent-[#f95d00]" />
                <span>Encaisser immédiatement à l&apos;arrêt</span>
              </label>
              {encaisserMaintenant && (
                <select value={modePaiement} onChange={(e) => setModePaiement(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold">
                  <option value="cash">Espèces</option>
                  <option value="card">Carte bancaire (TPE)</option>
                  <option value="check">Chèque</option>
                  <option value="bank_transfer">Virement bancaire</option>
                </select>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold">
                Laisser tourner en arrière-plan
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleStopWalkin}
                style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
                className="rounded-xl px-5 py-2.5 text-xs font-bold shadow-sm hover:opacity-95 disabled:opacity-50 flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>stop</span>
                {busy ? 'Arrêt…' : 'Arrêter et facturer'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
