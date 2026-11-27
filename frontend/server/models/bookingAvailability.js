// models/bookingAvailability.js — Contrôle atomique de disponibilité, tampon, alternatives & gardes Responsable (LOT 3 + LOT 1 Membre)
const { parseOpeningHoursRange } = require('./walkinBilling');
const { listActiveHolds } = require('./bookingHolds');

const pastSweepLastRun = new Map();

const SHARED_SPACE_TYPES = ['open_space', 'hot_desk', 'dedicated_desk'];

function isManagerRole(role) {
  return ['admin', 'super_admin'].includes(String(role || '').toLowerCase());
}

/**
 * Règles d'accès réservées au Responsable :
 * - Saisie rétroactive (date_debut passée > 5 min) + motif obligatoire
 * - Dérogation à un conflit horaire
 * - Modification d'une réservation déjà payée (partiel/total) ou ayant un check-in validé
 */
function assertManagerGuards({
  actorRole,
  dateDebut,
  existingBooking = null,
  existingPaid = false,
  existingCheckedIn = false,
  overrideConflit = false,
  motifRetroactif = '',
}) {
  const manager = isManagerRole(actorRole);

  if (dateDebut) {
    const startMs = new Date(dateDebut).getTime();
    const isPast = Number.isFinite(startMs) && startMs < (Date.now() - 5 * 60 * 1000);
    // Vérifier si modification sur réservation existante dont les dates passées n'ont pas changé
    const sameExistingStart = existingBooking?.date_debut
      && Math.abs(new Date(existingBooking.date_debut).getTime() - startMs) < 60 * 1000;

    if (isPast && !sameExistingStart) {
      if (!manager) {
        const err = new Error('Seul le rôle Responsable peut effectuer une saisie rétroactive.');
        err.statusCode = 403;
        throw err;
      }
      if (!String(motifRetroactif || '').trim()) {
        const err = new Error('Un motif obligatoire est requis pour toute saisie rétroactive.');
        err.statusCode = 400;
        throw err;
      }
    }
  }

  if (overrideConflit && !manager) {
    const err = new Error('Seul le rôle Responsable peut déroger à un conflit de disponibilité.');
    err.statusCode = 403;
    throw err;
  }

  if (existingBooking && (existingPaid || existingCheckedIn) && !manager) {
    const err = new Error('Seul le rôle Responsable peut modifier une réservation déjà payée ou ayant un check-in validé.');
    err.statusCode = 403;
    throw err;
  }
}

function intervalsOverlapWithBuffer(startA, endA, startB, endB, bufferMinutes = 15) {
  const sA = new Date(startA).getTime();
  const eA = new Date(endA).getTime();
  const sB = new Date(startB).getTime();
  const eB = new Date(endB).getTime();
  if (![sA, eA, sB, eB].every(Number.isFinite)) return false;
  const bufMs = Math.max(0, Number(bufferMinutes || 0)) * 60 * 1000;
  return sA < (eB + bufMs) && eA > (sB - bufMs);
}

function tunisLocalYmdToUtcMs(dateYmd, hour, minute) {
  const [y, m, d] = String(dateYmd).split('-').map((x) => parseInt(x, 10));
  if (!y || !m || !d) return NaN;
  const tunisOffsetMs = 60 * 60 * 1000; // Africa/Tunis UTC+1
  return Date.UTC(y, m - 1, d, hour, minute, 0, 0) - tunisOffsetMs;
}

function formatTunisHHMM(utcMs) {
  const tunisOffsetMs = 60 * 60 * 1000;
  const d = new Date(utcMs + tunisOffsetMs);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * Propose des créneaux alternatifs libres le même jour selon les horaires d'ouverture et le tampon.
 */
function findAlternativeSlots({
  dateYmd,
  durationMinutes = 60,
  minDurationMinutes = 30,
  horaires = '08:00 - 20:00',
  busyIntervals = [],
  bufferMinutes = 15,
  maxResults = 6,
  stepMinutes = 15,
  skipPast = false,
}) {
  const { openHour, openMin, closeHour, closeMin } = parseOpeningHoursRange(horaires);
  const openMs = tunisLocalYmdToUtcMs(dateYmd, openHour, openMin);
  const closeMs = tunisLocalYmdToUtcMs(dateYmd, closeHour, closeMin);
  if (!Number.isFinite(openMs) || !Number.isFinite(closeMs) || closeMs <= openMs) return [];

  const minDur = Math.max(15, Number(minDurationMinutes) || 30);
  const durMs = Math.max(minDur, Number(durationMinutes) || 60) * 60 * 1000;
  const stepMs = Math.max(15, Number(stepMinutes) || 15) * 60 * 1000;
  const nowMs = Date.now();
  const slots = [];

  for (let start = openMs; start + durMs <= closeMs; start += stepMs) {
    if (skipPast && start < nowMs - 5 * 60 * 1000) continue;
    const end = start + durMs;
    const hasConflict = busyIntervals.some((b) =>
      intervalsOverlapWithBuffer(start, end, b.date_debut, b.date_fin, bufferMinutes)
    );
    if (!hasConflict) {
      slots.push({
        date_debut: new Date(start).toISOString(),
        date_fin: new Date(end).toISOString(),
        label: `${formatTunisHHMM(start)} - ${formatTunisHHMM(end)}`,
        heure_debut: formatTunisHHMM(start),
        heure_fin: formatTunisHHMM(end),
      });
      if (slots.length >= maxResults) break;
    }
  }
  return slots;
}

function findAlternativeUnits({
  units = [],
  busyUnitIds = new Set(),
  minCapacity = 1,
  excludeUnitId = null,
}) {
  return (units || [])
    .filter((u) => {
      if (u.archived_at) return false;
      if (u.statut && u.statut !== 'disponible') return false;
      if (excludeUnitId && u.id === excludeUnitId) return false;
      if (busyUnitIds.has(u.id)) return false;
      if (Number(u.capacite || 1) < Math.max(1, Number(minCapacity) || 1)) return false;
      return true;
    })
    .map((u) => ({
      id: u.id,
      code: u.code,
      nom: u.nom,
      type_unite: u.type_unite,
      capacite: u.capacite,
      espace_id: u.espace_id,
    }));
}

async function getTenantTamponMinutes(supabaseAdmin, tenantId) {
  if (!tenantId) return 15;
  try {
    const { data } = await supabaseAdmin.from('tenants').select('settings').eq('id', tenantId).maybeSingle();
    const raw = data?.settings?.tampon_minutes;
    if (raw !== undefined && raw !== null && Number.isFinite(Number(raw))) {
      return Math.max(0, Math.min(120, parseInt(raw, 10)));
    }
  } catch (_) {}
  return 15;
}

async function loadSpaceUnitsForTenant(supabaseAdmin, tenantId, espaceId = null, { includeInternal = false } = {}) {
  if (!tenantId) return [];
  const selectCols = includeInternal
    ? 'id, tenant_id, espace_id, code, nom, type_unite, capacite, statut, motif_interne, date_retour_auto, floor_plan_item_id, archived_at'
    : 'id, tenant_id, espace_id, code, nom, type_unite, capacite, statut, date_retour_auto, floor_plan_item_id, archived_at';

  const sanitizeUnit = (u) => {
    const base = u.statut !== 'disponible' && u.date_retour_auto && new Date(u.date_retour_auto).getTime() <= Date.now()
      ? { ...u, statut: 'disponible', date_retour_auto: null }
      : { ...u };
    if (!includeInternal) delete base.motif_interne;
    return base;
  };

  try {
    let q = supabaseAdmin
      .from('unites')
      .select(selectCols)
      .eq('tenant_id', tenantId)
      .is('archived_at', null);
    if (espaceId) q = q.eq('espace_id', espaceId);
    const { data, error } = await q.order('code', { ascending: true });
    if (!error && Array.isArray(data)) {
      return data.map(sanitizeUnit);
    }
  } catch (_) {}

  try {
    const { data: t } = await supabaseAdmin.from('tenants').select('settings').eq('id', tenantId).maybeSingle();
    const raw = Array.isArray(t?.settings?.unites) ? t.settings.unites : [];
    return raw
      .filter((u) => !u.archived_at && (!espaceId || u.espace_id === espaceId))
      .map(sanitizeUnit);
  } catch (_) {
    return [];
  }
}

/**
 * Vérification JS complète de disponibilité (utilisée comme fallback si la RPC PostgreSQL
 * n'est pas encore déployée, ET pour calculer les créneaux/unités alternatifs).
 */
async function checkAvailabilityWithBuffer({
  supabaseAdmin,
  tenantId,
  espace,
  unite = null,
  dateDebut,
  dateFin,
  tamponMinutes = 15,
  nbParticipants = 1,
  excludeReservationId = null,
  excludeUserId = null,
  excludeHoldId = null,
}) {
  const bufMs = Math.max(0, Number(tamponMinutes || 0)) * 60 * 1000;
  const startMs = new Date(dateDebut).getTime();
  const endMs = new Date(dateFin).getTime();
  const windowStartIso = new Date(startMs - bufMs).toISOString();
  const windowEndIso = new Date(endMs + bufMs).toISOString();

  if (unite && unite.statut && unite.statut !== 'disponible') {
    const allUnits = await loadSpaceUnitsForTenant(supabaseAdmin, tenantId, espace.id);
    const altUnits = findAlternativeUnits({ units: allUnits, minCapacity: nbParticipants, excludeUnitId: unite.id });
    return {
      isAvailable: false,
      conflict: true,
      reason: `Cette unité est actuellement ${unite.statut === 'en_maintenance' ? 'en maintenance' : 'non disponible'}.`,
      alternatives: { slots: [], units: altUnits },
    };
  }

  let resQ = supabaseAdmin
    .from('reservations')
    .select('id, espace_id, unite_id, date_debut, date_fin, statut, confirmation_expires_at, notes, archived_at')
    .eq('espace_id', espace.id)
    .in('statut', ['pending', 'confirmed', 'en_attente_confirmation'])
    .lt('date_debut', windowEndIso)
    .gt('date_fin', windowStartIso);
  if (excludeReservationId) resQ = resQ.neq('id', excludeReservationId);

  let { data: overlappingRows, error: ovErr } = await resQ;
  if (ovErr && /column|does not exist/i.test(ovErr.message || '')) {
    let fb = supabaseAdmin
      .from('reservations')
      .select('id, espace_id, date_debut, date_fin, statut, notes')
      .eq('espace_id', espace.id)
      .in('statut', ['pending', 'confirmed'])
      .lt('date_debut', windowEndIso)
      .gt('date_fin', windowStartIso);
    if (excludeReservationId) fb = fb.neq('id', excludeReservationId);
    const fbRes = await fb;
    overlappingRows = fbRes.data || [];
  }

  const nowMs = Date.now();
  const activeOverlaps = (overlappingRows || []).filter((r) => {
    if (r.archived_at) return false;
    if (r.statut === 'en_attente_confirmation' && r.confirmation_expires_at) {
      if (new Date(r.confirmation_expires_at).getTime() <= nowMs) return false;
    }
    return true;
  });

  // Verrous temporaires 5 min actifs d'autres utilisateurs (RM-08)
  const activeHolds = await listActiveHolds(supabaseAdmin, {
    tenantId,
    espaceId: espace.id,
    dateDebut: windowStartIso,
    dateFin: windowEndIso,
    excludeUserId,
    excludeHoldId,
  }).catch(() => []);

  for (const h of activeHolds) {
    activeOverlaps.push({
      id: `hold-${h.id}`,
      espace_id: h.espace_id,
      unite_id: h.unite_id || null,
      date_debut: h.date_debut,
      date_fin: h.date_fin,
      statut: 'hold',
      is_hold: true,
    });
  }

  // Vérifier sessions encore actives (non libérées)
  let activeSessionOverlaps = 0;
  if (startMs <= nowMs + 2 * 3600 * 1000) {
    try {
      const { data: openSess } = await supabaseAdmin
        .from('sessions')
        .select('id, reservation_id, unite_id, espace_id, is_walkin')
        .in('statut', ['active', 'overtime'])
        .is('check_out', null);
      for (const s of openSess || []) {
        if (s.is_walkin && s.espace_id === espace.id) {
          if (!unite || !s.unite_id || s.unite_id === unite.id) activeSessionOverlaps++;
        }
      }
    } catch (_) {}
  }

  const allUnits = await loadSpaceUnitsForTenant(supabaseAdmin, tenantId, espace.id);
  const busyUnitIds = new Set(activeOverlaps.map((r) => r.unite_id).filter(Boolean));
  const isShared = SHARED_SPACE_TYPES.includes(espace.type) && !unite;
  const maxCap = Math.max(1, parseInt(unite?.capacite || espace.capacite, 10) || 1);

  let isConflict = false;
  let reason = null;

  if (unite) {
    const unitOverlaps = activeOverlaps.filter((r) => !r.unite_id || r.unite_id === unite.id);
    if (unitOverlaps.length > 0 || activeSessionOverlaps > 0) {
      isConflict = true;
      reason = `L'unité ${unite.code || unite.nom} est déjà occupée sur ce créneau (tampon ${tamponMinutes} min inclus).`;
    }
  } else if (!isShared) {
    if (activeOverlaps.length > 0 || activeSessionOverlaps > 0) {
      isConflict = true;
      reason = `L'espace ${espace.nom} est déjà réservé sur ce créneau (tampon ${tamponMinutes} min inclus).`;
    }
  } else {
    const used = activeOverlaps.length + activeSessionOverlaps;
    if (used + Math.max(1, Number(nbParticipants) || 1) > maxCap) {
      isConflict = true;
      reason = `Capacité maximale atteinte pour ${espace.nom} (${used}/${maxCap} places).`;
    }
  }

  let alternatives = { slots: [], units: [] };
  if (isConflict) {
    // Récupérer les réservations de toute la journée pour proposer d'autres créneaux libres
    const tunisDateYmd = new Date(startMs + 3600000).toISOString().slice(0, 10);
    const dayStartIso = new Date(tunisLocalYmdToUtcMs(tunisDateYmd, 0, 0)).toISOString();
    const dayEndIso = new Date(tunisLocalYmdToUtcMs(tunisDateYmd, 23, 59)).toISOString();
    const { data: dayRows } = await supabaseAdmin
      .from('reservations')
      .select('id, unite_id, date_debut, date_fin, statut')
      .eq('espace_id', espace.id)
      .in('statut', ['pending', 'confirmed', 'en_attente_confirmation'])
      .lt('date_debut', dayEndIso)
      .gt('date_fin', dayStartIso);

    const relevantDay = (dayRows || []).filter((r) => {
      if (excludeReservationId && r.id === excludeReservationId) return false;
      if (unite) return !r.unite_id || r.unite_id === unite.id;
      return true;
    });

    const durMinutes = Math.max(30, Math.round((endMs - startMs) / 60000));
    alternatives.slots = findAlternativeSlots({
      dateYmd: tunisDateYmd,
      durationMinutes: durMinutes,
      horaires: espace.horaires || '08:00 - 20:00',
      busyIntervals: relevantDay,
      bufferMinutes: tamponMinutes,
      skipPast: true,
    });

    alternatives.units = findAlternativeUnits({
      units: allUnits,
      busyUnitIds,
      minCapacity: nbParticipants,
      excludeUnitId: unite?.id || null,
    });
  }

  return {
    isAvailable: !isConflict,
    conflict: isConflict,
    reason,
    alternatives,
  };
}

/**
 * Expire automatiquement les réservations en attente de confirmation téléphone dépassées
 * et déclenche un rappel 30 min avant l'expiration.
 */
async function sweepExpiredConfirmations({ supabaseAdmin, tenantId }) {
  if (!tenantId) return { expired: 0, reminded: 0 };
  const nowIso = new Date().toISOString();
  const plus30Iso = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  let expired = 0;
  let reminded = 0;

  try {
    const { data: rows, error } = await supabaseAdmin
      .from('reservations')
      .select('id, user_id, espace_id, date_debut, confirmation_expires_at, confirmation_reminder_sent_at, spaces:espaces(nom)')
      .eq('tenant_id', tenantId)
      .eq('statut', 'en_attente_confirmation')
      .not('confirmation_expires_at', 'is', null);
    if (error || !rows) return { expired: 0, reminded: 0 };

    for (const r of rows) {
      if (r.confirmation_expires_at <= nowIso) {
        const { error: uErr } = await supabaseAdmin
          .from('reservations')
          .update({
            statut: 'cancelled',
            motif_annulation: 'Expirée automatiquement (confirmation téléphonique non reçue dans le délai).',
          })
          .eq('id', r.id);
        if (!uErr) expired++;
      } else if (r.confirmation_expires_at <= plus30Iso && !r.confirmation_reminder_sent_at) {
        await supabaseAdmin
          .from('reservations')
          .update({ confirmation_reminder_sent_at: nowIso })
          .eq('id', r.id);
        // Notifier les admins du tenant
        const { data: admins } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('tenant_id', tenantId)
          .in('role', ['admin', 'staff']);
        for (const adm of admins || []) {
          await supabaseAdmin.from('notifications').insert({
            user_id: adm.id,
            type: 'rappel_confirmation_reservation',
            canal: 'Dashboard',
            message: `Rappel : une réservation en attente de confirmation (${r.spaces?.nom || 'Espace'}) expire dans moins de 30 minutes.`,
          }).catch(() => {});
        }
        reminded++;
      }
    }
  } catch (_) {}

  return { expired, reminded };
}

/**
 * Transition automatique d'état :
 * Une réservation dont la date_fin est passée ne doit JAMAIS rester au statut `confirmed`
 * (ni en `pending` / `en_attente_confirmation`).
 */
async function sweepPastConfirmedReservations(supabaseAdmin, { tenantId = null, userId = null, force = false } = {}) {
  const scopeKey = tenantId ? `t:${tenantId}` : userId ? `u:${userId}` : 'global';
  const lastRun = pastSweepLastRun.get(scopeKey) || 0;
  if (!force && Date.now() - lastRun < 30 * 1000) {
    return { skipped: true, updated: 0 };
  }
  pastSweepLastRun.set(scopeKey, Date.now());

  const nowIso = new Date().toISOString();
  let updated = 0;

  try {
    let q = supabaseAdmin
      .from('reservations')
      .select('id, statut, date_fin, tenant_id, user_id')
      .in('statut', ['confirmed', 'pending', 'en_attente_confirmation'])
      .lt('date_fin', nowIso)
      .limit(60);

    if (tenantId) q = q.eq('tenant_id', tenantId);
    if (userId) q = q.eq('user_id', userId);

    const { data: rows, error } = await q;
    if (error || !rows || rows.length === 0) return { updated: 0 };

    const { canMarkReservationNoShow } = require('./helpers');

    for (const r of rows) {
      if (r.statut === 'pending' || r.statut === 'en_attente_confirmation') {
        const { error: uErr } = await supabaseAdmin
          .from('reservations')
          .update({ statut: 'cancelled', motif_annulation: 'Créneau expiré sans validation.' })
          .eq('id', r.id)
          .catch(() => supabaseAdmin.from('reservations').update({ statut: 'cancelled' }).eq('id', r.id));
        if (!uErr) updated++;
        continue;
      }

      // Ne pas fermer si une session encore active (non libérée) est liée à cette réservation
      const { data: openSess } = await supabaseAdmin
        .from('sessions')
        .select('id')
        .eq('reservation_id', r.id)
        .is('check_out', null)
        .limit(1);
      if ((openSess || []).length > 0) continue;

      const noShowCheck = await canMarkReservationNoShow(r.id);
      if (noShowCheck.allowed) {
        const { error: nsErr } = await supabaseAdmin
          .from('reservations')
          .update({ statut: 'no_show', no_show: true })
          .eq('id', r.id)
          .catch(() => supabaseAdmin.from('reservations').update({ statut: 'no_show' }).eq('id', r.id));
        if (!nsErr) updated++;
      } else {
        const { error: cmpErr } = await supabaseAdmin
          .from('reservations')
          .update({ statut: 'completed' })
          .eq('id', r.id);
        if (!cmpErr) updated++;
      }
    }
  } catch (err) {
    console.warn('sweepPastConfirmedReservations warning:', err.message);
  }

  return { updated };
}

module.exports = {
  SHARED_SPACE_TYPES,
  isManagerRole,
  assertManagerGuards,
  intervalsOverlapWithBuffer,
  tunisLocalYmdToUtcMs,
  findAlternativeSlots,
  findAlternativeUnits,
  getTenantTamponMinutes,
  loadSpaceUnitsForTenant,
  checkAvailabilityWithBuffer,
  sweepExpiredConfirmations,
  sweepPastConfirmedReservations,
};
