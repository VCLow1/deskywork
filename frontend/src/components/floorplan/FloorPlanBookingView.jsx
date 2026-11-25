// components/floorplan/FloorPlanBookingView.jsx — Réservation interactive sur plan 2D côté Client
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { floorPlansApi } from '../../services/api';
import { useTheme } from '../../context/ThemeContext';
import FloorPlanCanvas from './FloorPlanCanvas';
import {
  getDefaultTunisSlot,
  getTodayTunisDate,
  getItemTypeMeta,
  getFloorPlanPalette,
} from './floorPlanConstants';
import { formatDT } from '../../utils/format';

const START_HOURS = Array.from({ length: 14 }, (_, i) => `${String(7 + i).padStart(2, '0')}:00`);
const END_HOURS = Array.from({ length: 15 }, (_, i) => `${String(8 + i).padStart(2, '0')}:00`);

export default function FloorPlanBookingView({
  tenantId,
  initialPlans = null,
  onReserve = null,
}) {
  const { dark } = useTheme();
  const palette = getFloorPlanPalette(dark);
  const defSlot = useMemo(() => getDefaultTunisSlot(), []);
  const minDate = useMemo(() => getTodayTunisDate(), []);

  const [date, setDate] = useState(defSlot.date);
  const [startTime, setStartTime] = useState(defSlot.start);
  const [endTime, setEndTime] = useState(defSlot.end);
  const [plans, setPlans] = useState(initialPlans || []);
  const [activePlanId, setActivePlanId] = useState(initialPlans?.[0]?.id || null);
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [loading, setLoading] = useState(!initialPlans);
  const [error, setError] = useState('');

  const slotInvalid = startTime >= endTime;

  const refreshAvailability = useCallback(async () => {
    if (!tenantId || slotInvalid) return;
    try {
      setLoading(true);
      setError('');
      const res = await floorPlansApi.getPublic(tenantId, {
        date,
        start: startTime,
        end: endTime,
      });
      const list = res.floor_plans || [];
      setPlans(list);
      setActivePlanId((prev) => (prev && list.some((p) => p.id === prev) ? prev : list[0]?.id || null));
    } catch (e) {
      setError(e.message || 'Impossible de vérifier les disponibilités sur le plan.');
    } finally {
      setLoading(false);
    }
  }, [tenantId, date, startTime, endTime, slotInvalid]);

  useEffect(() => {
    refreshAvailability();
  }, [refreshAvailability]);

  const activePlan = useMemo(
    () => plans.find((p) => p.id === activePlanId) || plans[0] || null,
    [plans, activePlanId]
  );

  const selectedItem = useMemo(() => {
    if (!activePlan || !selectedItemId) return null;
    const item = (activePlan.items || []).find((i) => i.id === selectedItemId) || null;
    if (!item || item.live_status !== 'free' || !item.bookable) return null;
    return item;
  }, [activePlan, selectedItemId]);

  // Désélectionner si le créneau change et rend l'élément occupé
  useEffect(() => {
    if (selectedItemId && !selectedItem) {
      setSelectedItemId(null);
    }
  }, [selectedItemId, selectedItem]);

  const durationHours = useMemo(() => {
    if (slotInvalid) return 0;
    const s = new Date(`${date}T${startTime}:00+01:00`).getTime();
    const e = new Date(`${date}T${endTime}:00+01:00`).getTime();
    return Math.max(1, (e - s) / 3600000);
  }, [date, startTime, endTime, slotInvalid]);

  const freeCount = (activePlan?.items || []).filter((i) => i.live_status === 'free' && i.bookable).length;

  const boxStyle = {
    backgroundColor: dark ? '#1b1a18' : '#ffffff',
    borderColor: dark ? 'rgba(255,255,255,0.1)' : '#e2e8f0',
    color: dark ? '#fbffff' : '#100f0d',
  };

  const inputStyle = {
    backgroundColor: dark ? '#141311' : '#f8fafc',
    borderColor: dark ? 'rgba(255,255,255,0.14)' : '#cbd5e1',
    color: dark ? '#fbffff' : '#0f172a',
  };

  return (
    <div className="space-y-4">
      {/* Barre de sélection Date + Créneau horaire (Africa/Tunis) */}
      <div className="rounded-2xl border p-4 shadow-sm" style={boxStyle}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider opacity-70 mb-1">
              Date (Africa/Tunis)
            </label>
            <input
              type="date"
              min={minDate}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border text-sm font-semibold outline-none"
              style={inputStyle}
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider opacity-70 mb-1">
              Heure de début
            </label>
            <select
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border text-sm font-semibold outline-none"
              style={inputStyle}
            >
              {START_HOURS.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider opacity-70 mb-1">
              Heure de fin
            </label>
            <select
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border text-sm font-semibold outline-none"
              style={inputStyle}
            >
              {END_HOURS.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between gap-2">
            {plans.length > 1 && (
              <select
                value={activePlan?.id || ''}
                onChange={(e) => {
                  setActivePlanId(e.target.value);
                  setSelectedItemId(null);
                }}
                className="w-full px-3 py-2 rounded-xl border text-sm font-bold outline-none"
                style={inputStyle}
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
            <div className="text-xs font-bold whitespace-nowrap px-3 py-2 rounded-xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-300">
              {loading ? 'Mise à jour…' : `${freeCount} disponible${freeCount > 1 ? 's' : ''}`}
            </div>
          </div>
        </div>

        {slotInvalid && (
          <p className="mt-2.5 text-xs font-semibold text-red-500">
            L&apos;heure de fin doit être postérieure à l&apos;heure de début.
          </p>
        )}
        {error && (
          <p className="mt-2.5 text-xs font-semibold text-red-500">{error}</p>
        )}

        {/* Légende */}
        <div className="flex flex-wrap items-center gap-4 mt-3 pt-3 border-t text-xs" style={{ borderColor: boxStyle.borderColor }}>
          <span className="inline-flex items-center gap-1.5 font-medium">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: palette.statuses.free.dot }} />
            Libre (cliquer pour choisir)
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: palette.statuses.occupied.dot }} />
            Occupé sur ce créneau
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: palette.statuses.maintenance.dot }} />
            Maintenance
          </span>
        </div>
      </div>

      {/* Canvas Plan 2D */}
      {activePlan && (
        <FloorPlanCanvas
          plan={activePlan}
          mode="booking"
          selectedTarget={selectedItemId}
          onSelectTarget={(target) => {
            if (!target || target.kind !== 'item') return;
            const clicked = target.data;
            if (clicked?.live_status === 'free' && clicked?.bookable) {
              setSelectedItemId(clicked.id);
            }
          }}
          renderTooltipContent={(item) => {
            const typeMeta = getItemTypeMeta(item.item_type);
            const isFree = item.live_status === 'free' && item.bookable;
            const isMaint = item.live_status === 'maintenance';
            return (
              <div className="space-y-1">
                <p className="font-bold">
                  {typeMeta.shortLabel}, {item.label} ·{' '}
                  <span style={{ color: isFree ? '#10b981' : isMaint ? '#64748b' : '#ef4444' }}>
                    {isFree ? 'Libre' : isMaint ? 'En maintenance' : 'Occupé'}
                  </span>
                </p>
                {item.space_name && <p className="text-[11px] opacity-75">{item.space_name}</p>}
                {isFree && Number(item.tarif_horaire) > 0 && (
                  <p className="text-[11px] font-bold text-[#f95d00]">
                    {formatDT(item.tarif_horaire)}/h · {formatDT(item.tarif_journalier)}/jour
                  </p>
                )}
                {!isFree && item.conflict_reason && (
                  <p className="text-[11px] opacity-80">{item.conflict_reason}</p>
                )}
              </div>
            );
          }}
        />
      )}

      {/* Panneau de confirmation de sélection */}
      <div
        className="rounded-2xl border p-4 sm:p-5 shadow-sm transition-all"
        style={boxStyle}
      >
        {!selectedItem ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2.5 opacity-80">
              <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 22 }}>touch_app</span>
              <span>Sélectionnez un poste ou une salle libre (vert) directement sur le plan ci-dessus pour voir le tarif et réserver.</span>
            </div>
            <span className="text-xs font-semibold opacity-65">Règlement 100 % sur place</span>
          </div>
        ) : (
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase bg-[#f95d00]/15 text-[#f95d00]">
                  {getItemTypeMeta(selectedItem.item_type).shortLabel}
                </span>
                <h4 className="font-sora font-bold text-lg">
                  {selectedItem.label} — {selectedItem.space_name}
                </h4>
              </div>
              <p className="text-xs opacity-80">
                Créneau : <strong>{date}</strong> de <strong>{startTime}</strong> à <strong>{endTime}</strong> ({durationHours} h)
                {selectedItem.capacite ? ` · Capacité ${selectedItem.capacite} pers.` : ''}
                {' · '}Paiement sur place uniquement
              </p>
              {Array.isArray(selectedItem.equipements) && selectedItem.equipements.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {selectedItem.equipements.slice(0, 4).map((eq, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded-full text-[10px] font-semibold border"
                      style={{ borderColor: boxStyle.borderColor }}
                    >
                      ✓ {eq}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <div className="text-right">
                <p className="text-[11px] opacity-70 font-semibold">Estimation créneau</p>
                <p className="font-sora font-extrabold text-xl text-[#f95d00]">
                  {formatDT((selectedItem.tarif_horaire || 0) * durationHours)}
                </p>
              </div>
              <button
                type="button"
                disabled={slotInvalid}
                onClick={() =>
                  onReserve?.({
                    espaceId: selectedItem.space_id,
                    itemId: selectedItem.id,
                    itemLabel: selectedItem.label,
                    date,
                    start: startTime,
                    end: endTime,
                    space: selectedItem,
                  })
                }
                style={{
                  background: 'linear-gradient(135deg, #f95d00 0%, #ff8a3d 100%)',
                  color: '#ffffff',
                  padding: '12px 22px',
                  borderRadius: 12,
                  fontWeight: 800,
                  border: 'none',
                  cursor: 'pointer',
                  boxShadow: '0 10px 22px rgba(249,93,0,0.28)',
                }}
              >
                Réserver cet espace →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
