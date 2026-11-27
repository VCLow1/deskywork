// components/floorplan/FloorPlanLiveView.jsx — Occupation en direct Admin/Staff (Africa/Tunis + Supabase Realtime)
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { floorPlansApi, sessionApi, paymentApi } from '../../services/api';
import { useTheme } from '../../context/ThemeContext';
import FloorPlanCanvas from './FloorPlanCanvas';
import {
  getItemTypeMeta,
  getFloorPlanPalette,
  formatCountdown,
} from './floorPlanConstants';
import { formatDT, formatTimeTunis } from '../../utils/format';
import Money from '../common/Money';
import UnitStatusModal from '../units/UnitStatusModal';

export default function FloorPlanLiveView({ onToast, onError }) {
  const { dark } = useTheme();
  const palette = getFloorPlanPalette(dark);

  const [plans, setPlans] = useState([]);
  const [activePlanId, setActivePlanId] = useState(null);
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState(false);
  const [tunisClock, setTunisClock] = useState('');
  const [tickNowMs, setTickNowMs] = useState(() => Date.now());
  const [serverDriftMs, setServerDriftMs] = useState(0);
  const [collectMode, setCollectMode] = useState('cash');
  const [statusModalUnit, setStatusModalUnit] = useState(null);

  const loadLive = useCallback(async (planIdOverride = null, silent = false) => {
    try {
      if (!silent) setLoading(true);
      const data = await floorPlansApi.getLive(planIdOverride);
      const list = data.floor_plans || [];
      setPlans(list);
      if (data.server_time) {
        setServerDriftMs(new Date(data.server_time).getTime() - Date.now());
      }
      setActivePlanId((prev) => {
        if (planIdOverride && list.some((p) => p.id === planIdOverride)) return planIdOverride;
        if (prev && list.some((p) => p.id === prev)) return prev;
        return data.active_plan_id || list[0]?.id || null;
      });
    } catch (e) {
      onError?.(e.message || 'Impossible de charger l’occupation en direct.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    loadLive(null, false);
    const pollId = setInterval(() => loadLive(activePlanId, true), 30000);
    const channel = supabase
      .channel('deskywork-floorplan-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => loadLive(activePlanId, true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, () => loadLive(activePlanId, true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'paiements' }, () => loadLive(activePlanId, true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'unites' }, () => loadLive(activePlanId, true))
      .subscribe();

    return () => {
      clearInterval(pollId);
      supabase.removeChannel(channel);
    };
  }, [loadLive, activePlanId]);

  // Horloge Africa/Tunis + minuteurs live chaque seconde
  useEffect(() => {
    const updateClock = () => {
      const now = Date.now() + serverDriftMs;
      setTickNowMs(now);
      setTunisClock(
        new Intl.DateTimeFormat('fr-FR', {
          timeZone: 'Africa/Tunis',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(new Date(now))
      );
    };
    updateClock();
    const t = setInterval(updateClock, 1000);
    return () => clearInterval(t);
  }, [serverDriftMs]);

  const activePlan = useMemo(
    () => plans.find((p) => p.id === activePlanId) || plans[0] || null,
    [plans, activePlanId]
  );

  const selectedItem = useMemo(
    () => activePlan?.items?.find((it) => it.id === selectedItemId) || null,
    [activePlan, selectedItemId]
  );

  const counts = useMemo(() => {
    const items = activePlan?.items || [];
    return {
      free: items.filter((i) => i.live_status === 'free').length,
      occupied: items.filter((i) => i.live_status === 'occupied').length,
      contract_occupied: items.filter((i) => i.live_status === 'contract_occupied').length,
      alert: items.filter((i) => ['ending_soon', 'overtime'].includes(i.live_status)).length,
      maintenance: items.filter((i) => i.live_status === 'maintenance').length,
      unavailable: items.filter((i) => i.live_status === 'unavailable').length,
    };
  }, [activePlan]);

  // Calcul live côté client basé sur serverDriftMs + started_at
  const computeLiveTiming = (item) => {
    if (!item) return { secondsRemaining: 0, overtimeSeconds: 0, elapsedSeconds: 0, isOvertime: false, isEndingSoon: false };
    const startRef = item.started_at || item.check_in;
    const elapsedSeconds = startRef ? Math.max(0, Math.floor((tickNowMs - new Date(startRef).getTime()) / 1000)) : 0;
    if (!item.date_fin) return { secondsRemaining: 0, overtimeSeconds: 0, elapsedSeconds, isOvertime: false, isEndingSoon: false };
    const finMs = new Date(item.date_fin).getTime();
    const diffSec = Math.floor((finMs - tickNowMs) / 1000);
    if (item.session_id && diffSec < 0) {
      return { secondsRemaining: 0, overtimeSeconds: Math.abs(diffSec), elapsedSeconds, isOvertime: true, isEndingSoon: false };
    }
    return {
      secondsRemaining: Math.max(0, diffSec),
      overtimeSeconds: 0,
      elapsedSeconds,
      isOvertime: false,
      isEndingSoon: diffSec > 0 && diffSec <= 15 * 60,
    };
  };

  const handleRelease = async (item) => {
    if (!item?.session_id) return;
    try {
      setBusyAction(true);
      const res = await sessionApi.stop(item.session_id);
      onToast?.(res.message || "C'est bon, la ressource a été libérée.");
      await loadLive(activePlan?.id, true);
    } catch (e) {
      onError?.(e.message || 'Impossible de libérer cette session.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleExtend = async (item, minutes = 30) => {
    if (!item?.session_id) return;
    try {
      setBusyAction(true);
      const res = await sessionApi.extend(item.session_id, { minutes });
      onToast?.(res.message || `Prolongée de ${minutes} min.`);
      await loadLive(activePlan?.id, true);
    } catch (e) {
      onError?.(e.message || 'Créneau suivant occupé, prolongation impossible.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleCheckIn = async (item) => {
    if (!item?.reservation_id) return;
    try {
      setBusyAction(true);
      const res = await sessionApi.start({ reservation_id: item.reservation_id });
      onToast?.(res.already_started ? 'Chronomètre déjà actif.' : 'Chronomètre démarré côté serveur.');
      await loadLive(activePlan?.id, true);
    } catch (e) {
      onError?.(e.message || 'Erreur lors du démarrage.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleCollectPayment = async (item) => {
    if (!item?.pending_payment?.id) return;
    try {
      setBusyAction(true);
      const res = await paymentApi.collect(item.pending_payment.id, { mode_paiement: collectMode });
      onToast?.(res.message || 'Encaissement enregistré.');
      await loadLive(activePlan?.id, true);
    } catch (e) {
      onError?.(e.message || 'Erreur lors de l’encaissement.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleToggleMaintenance = async (item) => {
    if (!activePlan || !item) return;
    const nextStatus = item.status === 'maintenance' ? 'active' : 'maintenance';
    try {
      setBusyAction(true);
      await floorPlansApi.toggleItemStatus(activePlan.id, item.id, nextStatus);
      onToast?.(
        nextStatus === 'maintenance'
          ? `${item.label} passé en maintenance.`
          : `${item.label} remis en service.`
      );
      await loadLive(activePlan.id, true);
    } catch (e) {
      onError?.(e.message || 'Erreur lors de la mise à jour du statut.');
    } finally {
      setBusyAction(false);
    }
  };

  const cardCls = `rounded-2xl border p-4 ${dark ? 'bg-[#1b1a18] border-white/10 text-white' : 'bg-white border-outline-variant/20 text-primary'
    }`;

  if (loading) {
    return (
      <div className={cardCls}>
        <div className="h-96 animate-pulse rounded-xl bg-slate-200/40" />
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <div className={`${cardCls} text-center py-14`}>
        <span className="material-symbols-outlined text-secondary/60 block mb-3" style={{ fontSize: 52 }}>map</span>
        <h3 className="font-sora font-bold text-lg mb-2">Aucun plan 2D configuré pour cet établissement</h3>
        <p className="text-sm opacity-75 max-w-md mx-auto mb-6">
          Créez d&apos;abord votre plan dans « Mes Espaces → Plan interactif » pour suivre l&apos;occupation en direct et libérer les postes en un clic.
        </p>
        <Link
          to="/admin/espaces?tab=plan"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-secondary text-white rounded-xl font-bold text-sm hover:bg-secondary/90"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>edit_location_alt</span>
          Configurer le plan interactif
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* En-tête Temps Réel & Compteurs */}
      <div className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {plans.length > 1 && (
              <select
                value={activePlan?.id || ''}
                onChange={(e) => {
                  setActivePlanId(e.target.value);
                  setSelectedItemId(null);
                  loadLive(e.target.value, true);
                }}
                className={`px-3.5 py-2 rounded-xl border text-sm font-bold outline-none ${dark ? 'bg-[#141311] border-white/15 text-white' : 'bg-slate-50 border-outline-variant/30 text-primary'
                  }`}
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}

            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-300 text-xs font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Temps réel · Tunis {tunisClock || '--:--:--'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
            <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
              {counts.free} Libre{counts.free > 1 ? 's' : ''}
            </span>
            <span className="px-2.5 py-1 rounded-full bg-red-500/15 text-red-700 dark:text-red-300">
              {counts.occupied} Occupé{counts.occupied > 1 ? 's' : ''}
            </span>
            {counts.contract_occupied > 0 && (
              <span className="px-2.5 py-1 rounded-full bg-[#f95d00]/15 text-[#c2410c] dark:text-[#fdba74]">
                {counts.contract_occupied} Occupé - contrat
              </span>
            )}
            <span className="px-2.5 py-1 rounded-full bg-orange-500/15 text-orange-700 dark:text-orange-300">
              {counts.alert} Fin / Dépassement
            </span>
            <span className="px-2.5 py-1 rounded-full bg-slate-500/15 text-slate-600 dark:text-slate-300">
              {counts.maintenance} Maintenance
            </span>
            {counts.unavailable > 0 && (
              <span className="px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-800 dark:text-amber-300">
                {counts.unavailable} Non disponible
              </span>
            )}
            <button
              type="button"
              onClick={() => loadLive(activePlan?.id, true)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-outline-variant/30 hover:bg-secondary/10 text-secondary"
              title="Actualiser"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>refresh</span>
              Actualiser
            </button>
          </div>
        </div>

        {/* Légende couleurs */}
        <div className="flex flex-wrap items-center gap-4 mt-3 pt-3 border-t border-outline-variant/15 text-xs">
          {[
            { key: 'free', label: 'Libre' },
            { key: 'occupied', label: 'Occupé / Réservé' },
            { key: 'ending_soon', label: 'Bientôt terminée (-15 min)' },
            { key: 'overtime', label: 'En dépassement' },
            { key: 'contract_occupied', label: 'Occupé - contrat' },
            { key: 'maintenance', label: 'En maintenance (hachuré)' },
            { key: 'unavailable', label: 'Non disponible' },
          ].map((lg) => {
            const st = palette.statuses[lg.key];
            return (
              <span key={lg.key} className="inline-flex items-center gap-1.5 font-medium">
                <span className="w-3 h-3 rounded-sm border" style={{ background: st.dot, borderColor: st.stroke }} />
                {lg.label}
              </span>
            );
          })}
        </div>
      </div>

      {/* Canvas Live + Panneau latéral au clic */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4 items-start">
        <FloorPlanCanvas
          plan={activePlan}
          mode="live"
          selectedTarget={selectedItemId}
          onSelectTarget={(target) => setSelectedItemId(target?.kind === 'item' ? target.id : null)}
          renderTooltipContent={(item) => {
            const typeMeta = getItemTypeMeta(item.item_type);
            const st = palette.statuses[item.live_status || 'free'];
            return (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold">{typeMeta.shortLabel} · {item.label}</span>
                  <span className="inline-flex items-center gap-1 font-bold" style={{ color: st?.dot }}>
                    ● {item.status_label}
                  </span>
                </div>
                {item.space_name && <p className="opacity-75 text-[11px]">{item.space_name}</p>}
                {item.date_fin && (
                  <p className="text-[11px] font-semibold">
                    Fin prévue : {formatTimeTunis(item.date_fin)}
                    {item.client_name ? ` · ${item.client_name}` : ''}
                  </p>
                )}
              </div>
            );
          }}
        />

        {/* Panneau latéral détaillé */}
        <div className={`${cardCls} space-y-4`}>
          <h3 className="font-sora font-bold text-sm flex items-center gap-2 border-b border-outline-variant/15 pb-3">
            <span className="material-symbols-outlined text-secondary" style={{ fontSize: 18 }}>sensors</span>
            Détail poste / salle en direct
          </h3>

          {!selectedItem ? (
            <div className="py-8 text-center text-xs opacity-70 space-y-2">
              <span className="material-symbols-outlined block opacity-40" style={{ fontSize: 36 }}>touch_app</span>
              <p>Cliquez sur un poste ou une salle du plan pour consulter son occupation, démarrer un check-in, encaisser ou libérer la session.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-secondary">
                    {getItemTypeMeta(selectedItem.item_type).shortLabel}
                  </span>
                  <h4 className="font-sora font-bold text-lg">{selectedItem.label}</h4>
                  <p className="text-xs opacity-75">{selectedItem.space_name || 'Non associé à un espace'}</p>
                </div>
                <span
                  className="px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0"
                  style={{
                    backgroundColor: palette.statuses[selectedItem.live_status || 'free']?.dot + '22',
                    color: palette.statuses[selectedItem.live_status || 'free']?.dot,
                  }}
                >
                  {selectedItem.status_label}
                </span>
              </div>

              {selectedItem.live_status === 'contract_occupied' && (
                <div className="p-3 rounded-xl bg-[#f95d00]/10 border border-[#f95d00]/30 text-xs space-y-1.5">
                  <p className="font-bold text-[#9a3412] dark:text-[#fed7aa]">Occupé - contrat</p>
                  {selectedItem.occupied_by && (
                    <p className="font-semibold text-primary">Titulaire : {selectedItem.occupied_by}</p>
                  )}
                  {selectedItem.contract_end_date && (
                    <p className="opacity-85">
                      Fin de contrat : {new Date(selectedItem.contract_end_date).toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis' })}
                    </p>
                  )}
                </div>
              )}

              {selectedItem.live_status === 'free' && (
                <div className="space-y-3 text-xs">
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-700 dark:text-emerald-300">
                    Cet emplacement est actuellement libre et disponible à la réservation.
                  </div>
                  {selectedItem.next_reservation && (
                    <div className="p-3 rounded-xl border border-outline-variant/20 space-y-1">
                      <p className="font-bold opacity-75">Prochaine réservation aujourd&apos;hui</p>
                      <p className="font-semibold">{selectedItem.next_reservation.client_name}</p>
                      <p className="opacity-80">
                        {formatTimeTunis(selectedItem.next_reservation.date_debut)} → {formatTimeTunis(selectedItem.next_reservation.date_fin)}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {selectedItem.is_formation && (
                <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/25 text-xs space-y-1">
                  <p className="font-bold text-purple-700 dark:text-purple-300">Session de formation en cours</p>
                  <p className="font-semibold">{selectedItem.formation_titre}</p>
                  <p className="opacity-80">
                    {formatTimeTunis(selectedItem.date_debut)} → {formatTimeTunis(selectedItem.date_fin)}
                  </p>
                </div>
              )}

              {selectedItem.reservation_id && (
                <div className="space-y-3">
                  {/* Infos client */}
                  <div className="p-3 rounded-xl border border-outline-variant/20 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="opacity-70">Client</span>
                      <span className="font-bold">{selectedItem.client_name}</span>
                    </div>
                    {selectedItem.client_email && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="opacity-70">E-mail</span>
                        <span className="truncate font-medium">{selectedItem.client_email}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="opacity-70">Créneau (Tunis)</span>
                      <span className="font-semibold">
                        {formatTimeTunis(selectedItem.date_debut)} → {formatTimeTunis(selectedItem.date_fin)}
                      </span>
                    </div>
                  </div>

                  {/* Minuteur live */}
                  {(() => {
                    const t = computeLiveTiming(selectedItem);
                    return (
                      <div
                        className={`p-3.5 rounded-xl border text-center ${t.isOvertime
                            ? 'bg-orange-500/15 border-orange-500/40 text-orange-700 dark:text-orange-200'
                            : 'bg-slate-500/10 border-outline-variant/20'
                          }`}
                      >
                        <p className="text-[10px] font-bold uppercase tracking-wider opacity-75">
                          {t.isOvertime ? 'En dépassement depuis' : 'Temps restant (Minuteur live)'}
                        </p>
                        <p className="font-sora text-2xl font-extrabold mt-1">
                          {formatCountdown(t.isOvertime ? t.overtimeSeconds : t.secondsRemaining, t.isOvertime)}
                        </p>
                        {t.isOvertime && selectedItem.montant_depassement > 0 && (
                          <p className="text-xs font-bold mt-1">
                            Dépassement estimé : {formatDT(selectedItem.montant_depassement)}
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  {/* Actions staff obligatoires */}
                  <div className="space-y-2">
                    {selectedItem.session_id ? (
                      <>
                        <button
                          type="button"
                          disabled={busyAction}
                          onClick={() => handleExtend(selectedItem, 30)}
                          style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
                          className="w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm hover:opacity-95 disabled:opacity-50"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 17 }}>more_time</span>
                          Prolonger (+30 min facturable)
                        </button>
                        <button
                          type="button"
                          disabled={busyAction}
                          onClick={() => handleRelease(selectedItem)}
                          className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>check_circle</span>
                          Arrêter / Libérer la ressource
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={() => handleCheckIn(selectedItem)}
                        style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
                        className="w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 17 }}>play_arrow</span>
                        Démarrer le chronomètre (Check-in)
                      </button>
                    )}

                    {/* Encaisser sur place si paiement en attente */}
                    {selectedItem.pending_payment && (
                      <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2 text-xs">
                        <div className="flex items-center justify-between font-bold text-amber-800 dark:text-amber-300">
                          <span>Paiement sur place en attente</span>
                          <span>{formatDT(selectedItem.pending_payment.montant)}</span>
                        </div>
                        <div className="flex gap-2">
                          <select
                            value={collectMode}
                            onChange={(e) => setCollectMode(e.target.value)}
                            className={`px-2.5 py-2 rounded-lg border text-xs font-semibold ${dark ? 'bg-[#141311] border-white/15 text-white' : 'bg-white border-amber-300 text-slate-800'
                              }`}
                          >
                            <option value="cash">Espèces</option>
                            <option value="cheque">Chèque</option>
                            <option value="virement">Virement</option>
                          </select>
                          <button
                            type="button"
                            disabled={busyAction}
                            onClick={() => handleCollectPayment(selectedItem)}
                            className="flex-1 py-2 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs flex items-center justify-center gap-1 disabled:opacity-50"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>payments</span>
                            Encaisser
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Toggle maintenance / statut unité si poste libre ou en maintenance */}
              {!selectedItem.reservation_id && !selectedItem.is_formation && !selectedItem.is_walkin && (
                selectedItem.unite_id ? (
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() =>
                      setStatusModalUnit({
                        id: selectedItem.unite_id,
                        code: selectedItem.unite_code || selectedItem.label,
                        nom: selectedItem.label,
                        statut: selectedItem.unite_statut || 'disponible',
                        motif_interne: selectedItem.motif_interne || '',
                        date_retour_auto: selectedItem.date_retour_auto || null,
                      })
                    }
                    className="w-full py-2 px-3 rounded-xl border border-outline-variant/30 text-xs font-semibold hover:bg-slate-500/10 flex items-center justify-center gap-1.5"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>construction</span>
                    Changer statut unité ({selectedItem.status_label})
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => handleToggleMaintenance(selectedItem)}
                    className="w-full py-2 px-3 rounded-xl border border-outline-variant/30 text-xs font-semibold hover:bg-slate-500/10 flex items-center justify-center gap-1.5"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>construction</span>
                    {selectedItem.status === 'maintenance' ? 'Remettre en service' : 'Passer en maintenance'}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      </div>

      <UnitStatusModal
        unite={statusModalUnit}
        isOpen={Boolean(statusModalUnit)}
        onClose={() => setStatusModalUnit(null)}
        onSaved={() => {
          onToast?.('Statut de l\'unité mis à jour.');
          loadLive(activePlan?.id, true);
        }}
      />
    </div>
  );
}

