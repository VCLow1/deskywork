// pages/BookingStep2.jsx — Choix créneau réel (horaires d'ouverture, Maintenant 15min, Journée complète & unités)
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useSessionUser } from '../hooks/useSessionUser';
import { useTheme } from '../context/ThemeContext';
import { bookingApi } from '../services/api';
import { getBookerNav } from '../utils/roles';
import { getNextQuarterHourTunis, parseOpeningHours, tunisLocalToISO } from '../utils/format';
import { spaceTypeLabel } from '../constants/spaceTypes';
import { getDefaultTunisSlot, getTodayTunisDate } from '../components/floorplan/floorPlanConstants';
import Money from '../components/common/Money';
import BookingShell from '../components/booking/BookingShell';

export default function BookingStep2({ session }) {
  const { metadata } = useSessionUser(session);
  const { dark } = useTheme();
  const [searchParams] = useSearchParams();
  const espaceId = searchParams.get('espaceId');
  const itemId = searchParams.get('itemId') || '';
  const itemLabel = searchParams.get('itemLabel') || '';
  const initialUniteId = searchParams.get('uniteId') || '';
  const navigate = useNavigate();
  const [nav] = useState(() => getBookerNav(metadata.role || 'member'));

  const defSlot = useMemo(() => getDefaultTunisSlot(), []);
  const minDate = useMemo(() => getTodayTunisDate(), []);

  const [space, setSpace] = useState(null);
  const [coworking, setCoworking] = useState(null);
  const [date, setDate] = useState(defSlot.date);
  const [startTime, setStartTime] = useState(defSlot.start);
  const [endTime, setEndTime] = useState(defSlot.end);
  const [selectedUniteId, setSelectedUniteId] = useState(initialUniteId);
  const [slotsMeta, setSlotsMeta] = useState({
    horaires: '08:00 - 20:00',
    min_duration_minutes: 60,
    tampon_minutes: 15,
    available_slots: [],
    units_status: [],
  });

  const [checking, setChecking] = useState(false);
  const [availabilityMessage, setAvailabilityMessage] = useState('');
  const [isAvailable, setIsAvailable] = useState(false);
  const [occupancy, setOccupancy] = useState(null);

  useEffect(() => {
    if (!espaceId) {
      navigate('/book/step1');
      return;
    }
    let active = true;
    (async () => {
      const { data: sp } = await supabase.from('espaces').select('*').eq('id', espaceId).single();
      if (!active || !sp) return;
      setSpace(sp);
      if (sp.tenant_id) {
        const { data: tn } = await supabase
          .from('tenants')
          .select('id, nom, slug, ville, adresse, cover_url, logo_url, horaires_ouverture')
          .eq('id', sp.tenant_id)
          .maybeSingle();
        if (active && tn) setCoworking(tn);
      }
    })();
    return () => {
      active = false;
    };
  }, [espaceId, navigate]);

  // Charger les créneaux disponibles selon horaires d'ouverture, durée minimale & tampon
  useEffect(() => {
    if (!espaceId || !date) return;
    bookingApi
      .checkSlots({
        espace_id: espaceId,
        unite_id: selectedUniteId || null,
        date,
        duration_minutes: slotsMeta.min_duration_minutes || 60,
      })
      .then((res) => {
        setSlotsMeta({
          horaires: res.horaires || '08:00 - 20:00',
          min_duration_minutes: res.min_duration_minutes || 60,
          tampon_minutes: res.tampon_minutes ?? 15,
          available_slots: Array.isArray(res.available_slots) ? res.available_slots : [],
          units_status: Array.isArray(res.units_status) ? res.units_status : [],
        });
      })
      .catch(() => {});
  }, [espaceId, date, selectedUniteId]);

  const verifyAvailability = useCallback(async () => {
    if (!espaceId || !date || !startTime || !endTime) return;

    const startDateTime = tunisLocalToISO(`${date}T${startTime}`);
    const endDateTime = tunisLocalToISO(`${date}T${endTime}`);

    if (!startDateTime || !endDateTime || new Date(startDateTime) >= new Date(endDateTime)) {
      setIsAvailable(false);
      setOccupancy(null);
      setAvailabilityMessage("L'heure de fin doit être postérieure à l'heure de début.");
      return;
    }

    const durMin = Math.round((new Date(endDateTime) - new Date(startDateTime)) / 60000);
    if (durMin < (slotsMeta.min_duration_minutes || 30)) {
      setIsAvailable(false);
      setAvailabilityMessage(`Durée minimale requise : ${slotsMeta.min_duration_minutes || 60} minutes.`);
      return;
    }

    setChecking(true);
    try {
      const result = await bookingApi.checkAvailability({
        espace_id: espaceId,
        date_debut: startDateTime,
        date_fin: endDateTime,
        ...(itemId ? { floor_plan_item_id: itemId } : {}),
      });

      if (result.shared) {
        setOccupancy({
          remaining: result.remaining ?? 0,
          capacity: result.capacity ?? space?.capacite ?? 0,
          occupied: result.overlapsCount ?? 0,
        });
      } else {
        setOccupancy(null);
      }

      if (result.isAvailable) {
        setIsAvailable(true);
        setAvailabilityMessage(result.message || 'Créneau disponible en temps réel. Vous pouvez confirmer.');
      } else {
        setIsAvailable(false);
        setAvailabilityMessage(result.message || 'Ce créneau est déjà réservé. Choisissez un autre horaire.');
      }
    } catch (err) {
      setIsAvailable(false);
      setAvailabilityMessage(err.message || 'Impossible de vérifier la disponibilité.');
    } finally {
      setChecking(false);
    }
  }, [espaceId, date, startTime, endTime, itemId, space?.capacite, slotsMeta.min_duration_minutes]);

  // Vérification automatique temps réel (debounce 250ms) dès que le créneau change
  useEffect(() => {
    if (!space) return undefined;
    const t = setTimeout(() => {
      verifyAvailability();
    }, 250);
    return () => clearTimeout(t);
  }, [space, verifyAvailability]);

  const durationHours = useMemo(() => {
    if (!date || !startTime || !endTime) return 0;
    const s = new Date(`${date}T${startTime}:00+01:00`).getTime();
    const e = new Date(`${date}T${endTime}:00+01:00`).getTime();
    if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return 0;
    return Number(((e - s) / 3600000).toFixed(2));
  }, [date, startTime, endTime]);

  const totalEstimate = useMemo(() => {
    const rate = Number(space?.tarif_horaire || 0);
    return rate * Math.max(0, durationHours);
  }, [space?.tarif_horaire, durationHours]);

  const selectedUnitObj = useMemo(
    () => slotsMeta.units_status.find((u) => u.id === selectedUniteId) || null,
    [slotsMeta.units_status, selectedUniteId]
  );

  const handleProceed = () => {
    const effItemId = itemId || selectedUnitObj?.floor_plan_item_id || '';
    const effItemLabel = itemLabel || selectedUnitObj?.code || selectedUnitObj?.nom || '';
    const qs = new URLSearchParams({
      espaceId,
      date,
      start: startTime,
      end: endTime,
      ...(selectedUniteId ? { uniteId: selectedUniteId } : {}),
      ...(effItemId ? { itemId: effItemId } : {}),
      ...(effItemLabel ? { itemLabel: effItemLabel } : {}),
    }).toString();
    navigate(`/book/step3?${qs}`);
  };

  const applyPreset = (type) => {
    const parsed = parseOpeningHours(slotsMeta.horaires);
    const openStr = `${String(parsed.openHour).padStart(2, '0')}:${String(parsed.openMin).padStart(2, '0')}`;
    const closeStr = `${String(parsed.closeHour).padStart(2, '0')}:${String(parsed.closeMin).padStart(2, '0')}`;
    if (type === 'now') {
      const q = getNextQuarterHourTunis({
        horaires: slotsMeta.horaires,
        durationMinutes: Math.max(60, slotsMeta.min_duration_minutes || 60),
      });
      setDate(q.date);
      setStartTime(q.start);
      setEndTime(q.end);
    } else if (type === 'day') {
      setStartTime(openStr);
      setEndTime(closeStr);
    } else if (type === 'morning') {
      setStartTime(openStr);
      setEndTime('13:00');
    } else if (type === 'afternoon') {
      setStartTime('14:00');
      setEndTime(closeStr);
    }
  };

  const cardBg = dark ? '#181715' : '#ffffff';
  const cardBorder = dark ? 'rgba(255,255,255,0.09)' : 'rgba(16,15,13,0.08)';
  const subtleBg = dark ? '#1f1d1a' : '#f8f6f2';
  const textMain = dark ? '#fbffff' : '#100f0d';
  const textMuted = dark ? '#cfcac3' : '#5e5a55';

  if (!space) {
    return (
      <BookingShell activeStep={2} nav={nav}>
        <div className="flex items-center justify-center py-24">
          <div className="w-12 h-12 rounded-full border-4 border-[#f95d00] border-t-transparent animate-spin" />
        </div>
      </BookingShell>
    );
  }

  const backHref = space.tenant_id ? `/book/step1?tenantId=${space.tenant_id}` : '/book/step1';

  return (
    <BookingShell
      activeStep={2}
      nav={nav}
      subtitle={coworking?.nom || space.nom}
      onStepClick={(st) => {
        if (st === 1) navigate('/book/step1?browse=1');
      }}
    >
      <div className="max-w-3xl mx-auto space-y-6 animate-fadeIn">
        {/* Bandeau espace sélectionné */}
        <div
          className="rounded-3xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          style={{
            backgroundColor: cardBg,
            border: `1px solid ${cardBorder}`,
            boxShadow: dark ? '0 12px 32px rgba(0,0,0,0.35)' : '0 8px 24px rgba(16,15,13,0.05)',
          }}
        >
          <div className="flex items-center gap-4 min-w-0">
            <img
              src={
                space.photo_url ||
                coworking?.cover_url ||
                'https://images.unsplash.com/photo-1497366216548-37526070297c?w=600&h=400&fit=crop'
              }
              alt={space.nom}
              className="w-20 h-20 rounded-2xl object-cover shrink-0 border border-black/10"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span
                  className="px-2.5 py-0.5 rounded-full text-xs font-extrabold uppercase"
                  style={{ backgroundColor: dark ? 'rgba(249,93,0,0.18)' : '#ffedd8', color: '#f95d00' }}
                >
                  {spaceTypeLabel(space.type)}
                </span>
                {(itemLabel || selectedUnitObj) && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
                    Unité : {itemLabel || selectedUnitObj?.code || selectedUnitObj?.nom}
                  </span>
                )}
              </div>
              <h1 className="font-sora font-extrabold text-xl m-0 truncate" style={{ color: textMain }}>
                {space.nom}
              </h1>
              <p className="text-xs mt-0.5 mb-0" style={{ color: textMuted }}>
                {coworking ? `${coworking.nom}${coworking.ville ? ` · ${coworking.ville}` : ''} · ` : ''}
                Horaires : {slotsMeta.horaires} · Durée min. {slotsMeta.min_duration_minutes} min · Tampon {slotsMeta.tampon_minutes} min
              </p>
            </div>
          </div>

          <div className="text-left sm:text-right shrink-0">
            <span className="text-xs font-semibold block" style={{ color: textMuted }}>Tarif horaire</span>
            <span className="font-sora font-extrabold text-xl text-[#f95d00]">
              <Money amount={space.tarif_horaire} zeroLabel="Gratuit" unit="/ h" />
            </span>
          </div>
        </div>

        {/* Formulaire créneau temps réel */}
        <div
          className="rounded-3xl p-6 sm:p-8 space-y-6"
          style={{
            backgroundColor: cardBg,
            border: `1px solid ${cardBorder}`,
            boxShadow: dark ? '0 14px 36px rgba(0,0,0,0.4)' : '0 10px 30px rgba(16,15,13,0.06)',
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-sora font-extrabold text-xl sm:text-2xl m-0" style={{ color: textMain }}>
                Choisissez votre créneau
              </h2>
              <p className="text-xs sm:text-sm mt-1 mb-0" style={{ color: textMuted }}>
                Vérification automatique instantanée (fuseau Africa/Tunis).
              </p>
            </div>
            <Link
              to={backHref}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold"
              style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}`, textDecoration: 'none' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 15 }}>swap_horiz</span>
              Changer d&apos;espace
            </Link>
          </div>

          {/* Raccourcis rapides conformes : Maintenant (quart d'heure) & Journée complète */}
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'now', label: '⚡ Maintenant (prochain quart d’heure)' },
              { id: 'morning', label: 'Matinée' },
              { id: 'afternoon', label: 'Après-midi' },
              { id: 'day', label: `Journée complète (${slotsMeta.horaires})` },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer transition-all hover:scale-[1.02]"
                style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}` }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Choix d'unité / poste si l'espace comporte des unités */}
          {slotsMeta.units_status.length > 0 && !itemId && (
            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wide" style={{ color: textMuted }}>
                Poste / Unité (optionnel)
              </label>
              <div className="flex flex-wrap gap-2">
                {slotsMeta.units_status.map((u) => {
                  const unavailable = u.statut && u.statut !== 'disponible';
                  const active = selectedUniteId === u.id;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      disabled={unavailable}
                      onClick={() => setSelectedUniteId(active ? '' : u.id)}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{
                        backgroundColor: active ? '#f95d00' : subtleBg,
                        color: active ? '#ffffff' : textMain,
                        border: `1px solid ${active ? '#f95d00' : cardBorder}`,
                      }}
                    >
                      {u.code || u.nom} {unavailable ? `(${u.statut === 'en_maintenance' ? 'Maintenance' : 'Indispo'})` : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="date" className="block text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: textMuted }}>
                  Date
                </label>
                <input
                  id="date"
                  type="date"
                  required
                  min={minDate}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3.5 py-3 rounded-2xl text-sm font-semibold outline-none"
                  style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}` }}
                />
              </div>

              <div>
                <label htmlFor="start" className="block text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: textMuted }}>
                  Heure de début
                </label>
                <input
                  id="start"
                  type="time"
                  required
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full px-3.5 py-3 rounded-2xl text-sm font-semibold outline-none"
                  style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}` }}
                />
              </div>

              <div>
                <label htmlFor="end" className="block text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: textMuted }}>
                  Heure de fin
                </label>
                <input
                  id="end"
                  type="time"
                  required
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full px-3.5 py-3 rounded-2xl text-sm font-semibold outline-none"
                  style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}` }}
                />
              </div>
            </div>

            {/* Créneaux libres suggérés du jour */}
            {slotsMeta.available_slots.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-xs font-bold" style={{ color: textMuted }}>
                  Créneaux suggérés libres ce jour :
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {slotsMeta.available_slots.slice(0, 8).map((s) => {
                    const isPicked = startTime === s.heure_debut && endTime === s.heure_fin;
                    return (
                      <button
                        key={s.label}
                        type="button"
                        onClick={() => {
                          setStartTime(s.heure_debut);
                          setEndTime(s.heure_fin);
                        }}
                        className="px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer"
                        style={{
                          backgroundColor: isPicked ? '#f95d00' : subtleBg,
                          color: isPicked ? '#ffffff' : textMain,
                          border: `1px solid ${isPicked ? '#f95d00' : cardBorder}`,
                        }}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Statut temps réel */}
            {checking && (
              <div
                className="p-4 rounded-2xl flex items-center gap-3 text-xs font-bold"
                style={{ backgroundColor: subtleBg, color: textMuted }}
              >
                <div className="w-4 h-4 rounded-full border-2 border-[#f95d00] border-t-transparent animate-spin" />
                <span>Vérification de la disponibilité en temps réel...</span>
              </div>
            )}

            {!checking && occupancy && (
              <div
                className="p-4 rounded-2xl space-y-2"
                style={{
                  backgroundColor: occupancy.remaining > 0
                    ? (dark ? 'rgba(16,185,129,0.14)' : '#ecfdf5')
                    : (dark ? 'rgba(239,68,68,0.14)' : '#fef2f2'),
                  border: `1px solid ${occupancy.remaining > 0 ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)'}`,
                }}
              >
                <div className="flex justify-between items-baseline">
                  <span className="text-xs font-bold" style={{ color: occupancy.remaining > 0 ? '#10b981' : '#ef4444' }}>
                    Places libres sur ce créneau
                  </span>
                  <span className="font-sora font-extrabold text-xl" style={{ color: occupancy.remaining > 0 ? '#10b981' : '#ef4444' }}>
                    {occupancy.remaining} <span className="text-xs opacity-70">/ {occupancy.capacity}</span>
                  </span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: dark ? 'rgba(255,255,255,0.1)' : '#e2e8f0' }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${occupancy.capacity > 0 ? Math.min(100, (occupancy.occupied / occupancy.capacity) * 100) : 0}%`,
                      backgroundColor: occupancy.remaining > 0 ? '#10b981' : '#ef4444',
                    }}
                  />
                </div>
                {availabilityMessage && (
                  <p className="text-xs font-semibold m-0" style={{ color: textMain }}>
                    {availabilityMessage}
                  </p>
                )}
              </div>
            )}

            {!checking && !occupancy && availabilityMessage && (
              <div
                className="p-4 rounded-2xl flex items-center gap-2.5 text-xs sm:text-sm font-bold"
                style={{
                  backgroundColor: isAvailable
                    ? (dark ? 'rgba(16,185,129,0.14)' : '#ecfdf5')
                    : (dark ? 'rgba(239,68,68,0.14)' : '#fef2f2'),
                  color: isAvailable ? (dark ? '#6ee7b7' : '#065f46') : (dark ? '#fca5a5' : '#991b1b'),
                  border: `1px solid ${isAvailable ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)'}`,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 19 }}>
                  {isAvailable ? 'check_circle' : 'error'}
                </span>
                <span>{availabilityMessage}</span>
              </div>
            )}

            {/* Récapitulatif tarifaire + CTA (sans bouton Revérifier) */}
            <div
              className="pt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              style={{ borderTop: `1px solid ${cardBorder}` }}
            >
              <div>
                <span className="text-xs font-semibold block" style={{ color: textMuted }}>
                  Estimation ({durationHours > 0 ? `${durationHours} h` : 'créneau invalide'}) · Paiement sur place
                </span>
                <span className="font-sora font-extrabold text-2xl text-[#f95d00]">
                  <Money amount={totalEstimate} zeroLabel="Gratuit" />
                </span>
              </div>

              <button
                type="button"
                disabled={!isAvailable || checking || durationHours <= 0}
                onClick={handleProceed}
                className="px-6 py-3 rounded-2xl text-sm font-extrabold cursor-pointer transition-transform hover:scale-[1.02] disabled:opacity-45 disabled:cursor-not-allowed"
                style={{
                  background: 'linear-gradient(135deg, #f95d00 0%, #ff8234 100%)',
                  color: '#ffffff',
                  border: 'none',
                  boxShadow: '0 8px 20px rgba(249,93,0,0.3)',
                }}
              >
                Continuer vers la confirmation →
              </button>
            </div>
          </div>
        </div>
      </div>
    </BookingShell>
  );
}
