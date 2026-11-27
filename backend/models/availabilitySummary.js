// models/availabilitySummary.js — Source unique de vérité pour la disponibilité (Accueil / Tunnel / Plan 2D)
const { loadSpaceUnitsForTenant, SHARED_SPACE_TYPES } = require('./bookingAvailability');
const { listActiveHolds } = require('./bookingHolds');
const { computeHTFromTTC, DEFAULT_TVA_PCT, roundMillime } = require('./pricingMath');

function safeParseNotes(notes) {
  if (!notes) return null;
  if (typeof notes === 'object') return notes;
  try {
    const parsed = JSON.parse(String(notes));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function extractResFpItemId(r) {
  if (!r) return null;
  if (r.floor_plan_item_id) return String(r.floor_plan_item_id);
  const parsed = safeParseNotes(r.notes);
  return parsed?.floor_plan_item_id ? String(parsed.floor_plan_item_id) : null;
}

/**
 * Calcule de manière uniforme la disponibilité temps réel des espaces et unités d'un établissement.
 * Aligné sur `unites` + réservations + sessions ouvertes + formations + contrats longs + holds 5 min.
 */
async function computeTenantLiveAvailability(
  supabaseAdmin,
  {
    tenantId,
    rangeStartDate,
    rangeEndDate,
    isNow = true,
    excludeUserId = null,
    excludeHoldId = null,
    tenantSettings = null,
  }
) {
  const startIso = (rangeStartDate instanceof Date ? rangeStartDate : new Date(rangeStartDate)).toISOString();
  const endIso = (rangeEndDate instanceof Date ? rangeEndDate : new Date(rangeEndDate)).toISOString();
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  const nowMs = Date.now();
  const todayYmd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Tunis',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const [espRes, unites, resData, openSessRes, formRes, subsRes, activeHolds, tMetaRes] = await Promise.all([
    supabaseAdmin
      .from('espaces')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('tarif_horaire', { ascending: true }),
    loadSpaceUnitsForTenant(supabaseAdmin, tenantId),
    supabaseAdmin
      .from('reservations')
      .select('id, tenant_id, espace_id, unite_id, floor_plan_item_id, date_debut, date_fin, statut, archived_at, notes')
      .eq('tenant_id', tenantId)
      .in('statut', ['confirmed', 'pending', 'en_attente_confirmation'])
      .lt('date_debut', endIso)
      .gt('date_fin', startIso)
      .then((r) => (r.error ? supabaseAdmin.from('reservations').select('id, tenant_id, espace_id, date_debut, date_fin, statut, notes').eq('tenant_id', tenantId).in('statut', ['confirmed', 'pending']).lt('date_debut', endIso).gt('date_fin', startIso) : r)),
    supabaseAdmin
      .from('sessions')
      .select('id, tenant_id, espace_id, unite_id, reservation_id, is_walkin, statut, check_out')
      .in('statut', ['active', 'overtime'])
      .is('check_out', null)
      .catch(() => ({ data: [] })),
    supabaseAdmin
      .from('formations')
      .select('id, titre, espace_id, date_debut, date_fin, statut')
      .eq('tenant_id', tenantId)
      .in('statut', ['planifiee', 'publiee', 'en_cours'])
      .lt('date_debut', endIso)
      .gt('date_fin', startIso),
    supabaseAdmin
      .from('abonnements')
      .select('id, unite_id, statut, date_fin, archived_at')
      .eq('tenant_id', tenantId)
      .in('statut', ['active', 'actif', 'a_renouveler'])
      .gte('date_fin', todayYmd)
      .catch(() => ({ data: [] })),
    listActiveHolds(supabaseAdmin, {
      tenantId,
      dateDebut: startIso,
      dateFin: endIso,
      excludeUserId,
      excludeHoldId,
    }),
    tenantSettings
      ? Promise.resolve({ data: { settings: tenantSettings } })
      : supabaseAdmin.from('tenants').select('settings').eq('id', tenantId).maybeSingle(),
  ]);

  const settings = tMetaRes?.data?.settings || tenantSettings || {};
  const archivedEspaces = new Set(Array.isArray(settings.archived_espaces) ? settings.archived_espaces : []);
  const archivedSubs = new Set(Array.isArray(settings.archived_subscriptions) ? settings.archived_subscriptions : []);
  const subMetaMap = settings.subscription_meta || {};

  const espacesList = (espRes?.data || []).filter((e) => !e.archived_at && !archivedEspaces.has(e.id));
  const reservations = (resData?.data || []).filter((r) => !r.archived_at);
  const formations = formRes?.data || [];

  // Contrats actifs liés à une unité (Occupé - contrat)
  const contractUniteIds = new Set();
  for (const s of subsRes?.data || []) {
    if (s.archived_at || archivedSubs.has(s.id)) continue;
    const uId = s.unite_id || subMetaMap[s.id]?.unite_id || null;
    if (uId) contractUniteIds.add(uId);
  }

  // Sessions encore ouvertes du tenant
  const tenantOpenSessions = (openSessRes?.data || []).filter(
    (s) => !s.check_out && s.statut !== 'completed' && (!s.tenant_id || s.tenant_id === tenantId)
  );
  const activeSessionResIds = new Set(tenantOpenSessions.map((s) => s.reservation_id).filter(Boolean));
  const walkinOpenBySpace = new Map();
  const walkinOpenByUnit = new Set();
  for (const s of tenantOpenSessions) {
    if (s.is_walkin && s.espace_id && isNow) {
      walkinOpenBySpace.set(s.espace_id, (walkinOpenBySpace.get(s.espace_id) || 0) + 1);
      if (s.unite_id) walkinOpenByUnit.add(s.unite_id);
    }
  }

  const unitesBySpace = new Map();
  for (const u of unites || []) {
    if (u.archived_at) continue;
    if (!unitesBySpace.has(u.espace_id)) unitesBySpace.set(u.espace_id, []);
    unitesBySpace.get(u.espace_id).push(u);
  }

  const bookingsBySpace = new Map();
  for (const r of reservations) {
    const deb = new Date(r.date_debut).getTime();
    const fin = new Date(r.date_fin).getTime();
    const openNow = isNow && activeSessionResIds.has(r.id);
    if (openNow || (deb < endMs && fin > startMs)) {
      if (!bookingsBySpace.has(r.espace_id)) bookingsBySpace.set(r.espace_id, []);
      bookingsBySpace.get(r.espace_id).push(r);
    }
  }

  const holdsBySpace = new Map();
  for (const h of activeHolds || []) {
    if (!holdsBySpace.has(h.espace_id)) holdsBySpace.set(h.espace_id, []);
    holdsBySpace.get(h.espace_id).push(h);
  }

  const formationBySpace = new Map();
  for (const f of formations) {
    const deb = new Date(f.date_debut).getTime();
    const fin = new Date(f.date_fin).getTime();
    if (deb < endMs && fin > startMs && f.espace_id && !formationBySpace.has(f.espace_id)) {
      formationBySpace.set(f.espace_id, f);
    }
  }

  let totalUnitsAll = 0;
  let availableUnitsAll = 0;

  const spaces = espacesList.map((esp) => {
    const tvaPct = Number(esp.tva_pct ?? settings.tva_defaut_pct ?? DEFAULT_TVA_PCT);
    const hourlyTTC = roundMillime(esp.tarif_horaire || 0);
    const hourlyHT = esp.tarif_horaire_ht != null ? roundMillime(esp.tarif_horaire_ht) : computeHTFromTTC(hourlyTTC, tvaPct);
    const dailyTTC = esp.tarif_journalier != null ? roundMillime(esp.tarif_journalier) : roundMillime(hourlyTTC * 8);
    const spaceUnits = unitesBySpace.get(esp.id) || [];
    const activeBookings = bookingsBySpace.get(esp.id) || [];
    const spaceHolds = holdsBySpace.get(esp.id) || [];
    const form = formationBySpace.get(esp.id) || null;
    const isShared = SHARED_SPACE_TYPES.includes(esp.type);
    const fallbackCap = Math.max(1, parseInt(esp.capacite, 10) || 1);

    const photos = [...new Set([
      esp.photo_url,
      ...(Array.isArray(esp.photos_urls) ? esp.photos_urls : []),
      ...(Array.isArray(esp.images) ? esp.images : []),
    ].filter(Boolean))];

    // Statut détaillé par unité (si des unités existent)
    const busyUnitIds = new Set();
    const busyFpItemIds = new Set();
    let genericOccupiedUnitsCount = walkinOpenBySpace.get(esp.id) || 0;

    for (const r of activeBookings) {
      const fpId = extractResFpItemId(r);
      if (r.unite_id) busyUnitIds.add(r.unite_id);
      else if (fpId) busyFpItemIds.add(fpId);
      else genericOccupiedUnitsCount += 1;
    }
    for (const h of spaceHolds) {
      if (h.unite_id) busyUnitIds.add(h.unite_id);
      else if (h.floor_plan_item_id) busyFpItemIds.add(String(h.floor_plan_item_id));
      else genericOccupiedUnitsCount += 1;
    }

    let unitDetails = [];
    if (spaceUnits.length > 0) {
      unitDetails = spaceUnits.map((u) => {
        const isMaint = u.statut === 'en_maintenance' || u.statut === 'maintenance';
        const isUnavail = u.statut === 'non_disponible' || u.statut === 'unavailable';
        const hasContract = contractUniteIds.has(u.id);
        const hasSession = walkinOpenByUnit.has(u.id);
        const hasRes = busyUnitIds.has(u.id) || (u.floor_plan_item_id && busyFpItemIds.has(String(u.floor_plan_item_id)));
        const isFree = esp.actif !== false && !form && !isMaint && !isUnavail && !hasContract && !hasSession && !hasRes;
        return {
          id: u.id,
          code: u.code,
          nom: u.nom,
          type_unite: u.type_unite,
          capacite: u.capacite,
          statut: u.statut || 'disponible',
          floor_plan_item_id: u.floor_plan_item_id || null,
          is_free: isFree,
        };
      });

      // Appliquer les réservations génériques sans unité ciblée aux unités restantes libres (en mode partagé)
      if (!isShared && genericOccupiedUnitsCount > 0) {
        unitDetails = unitDetails.map((u) => ({ ...u, is_free: false }));
      } else if (genericOccupiedUnitsCount > 0) {
        let toConsume = genericOccupiedUnitsCount;
        unitDetails = unitDetails.map((u) => {
          if (u.is_free && toConsume > 0) {
            toConsume -= 1;
            return { ...u, is_free: false };
          }
          return u;
        });
      }
    }

    const totalUnits = spaceUnits.length > 0 ? spaceUnits.length : (isShared ? fallbackCap : 1);
    const freeUnitsCount = spaceUnits.length > 0
      ? unitDetails.filter((u) => u.is_free).length
      : (esp.actif === false || form
          ? 0
          : isShared
            ? Math.max(0, fallbackCap - (activeBookings.length + spaceHolds.length + (walkinOpenBySpace.get(esp.id) || 0)))
            : (activeBookings.length + spaceHolds.length + (walkinOpenBySpace.get(esp.id) || 0) > 0 ? 0 : 1));

    totalUnitsAll += totalUnits;
    availableUnitsAll += freeUnitsCount;

    const capacity = spaceUnits.length > 0 ? Math.max(fallbackCap, spaceUnits.length) : fallbackCap;
    const occupiedCount = Math.max(0, totalUnits - freeUnitsCount);

    let liveStatus = 'free';
    let statusLabel = 'Disponible';
    let nextFreeTime = null;
    let conflictReason = null;

    if (esp.actif === false) {
      liveStatus = 'maintenance';
      statusLabel = 'Indisponible';
      conflictReason = 'Espace temporairement en maintenance';
    } else if (form) {
      liveStatus = 'formation';
      statusLabel = 'Formation en cours';
      nextFreeTime = form.date_fin || null;
      conflictReason = `Réservé pour la formation « ${form.titre} »`;
    } else if (freeUnitsCount <= 0) {
      liveStatus = 'occupied';
      statusLabel = isShared || spaceUnits.length > 1 ? 'Complet sur ce créneau' : 'Occupé sur ce créneau';
      const endTimes = activeBookings.map((b) => b.date_fin).filter(Boolean).sort();
      nextFreeTime = endTimes[0] || null;
      conflictReason = isShared
        ? `Toutes les places (${totalUnits}) sont occupées sur ce créneau`
        : 'Cet espace est déjà réservé sur ce créneau';
    } else if ((isShared || spaceUnits.length > 1) && freeUnitsCount <= Math.max(2, Math.ceil(totalUnits * 0.25))) {
      liveStatus = 'limited';
      statusLabel = `Plus que ${freeUnitsCount} place${freeUnitsCount > 1 ? 's' : ''}`;
    }

    return {
      id: esp.id,
      tenant_id: esp.tenant_id,
      nom: esp.nom,
      type: esp.type,
      description: esp.description || null,
      horaires: esp.horaires || settings.horaires_ouverture || '08:00 - 20:00',
      capacite: capacity,
      capacity,
      total_units: totalUnits,
      available_units: freeUnitsCount,
      unites: unitDetails,
      is_shared: isShared,
      tarif_horaire: hourlyTTC,
      tarif_horaire_ht: hourlyHT,
      tva_pct: tvaPct,
      tarif_journalier: dailyTTC,
      photo_url: photos[0] || null,
      photos,
      equipements: Array.isArray(esp.equipements) ? esp.equipements : [],
      occupied_count: occupiedCount,
      remaining_spots: freeUnitsCount,
      live_status: liveStatus,
      status_label: statusLabel,
      next_free_time: nextFreeTime,
      conflict_reason: conflictReason,
    };
  });

  const freeSpaces = spaces.filter((s) => s.live_status === 'free' || s.live_status === 'limited').length;

  return {
    spaces,
    summary: {
      total_spaces: spaces.length,
      free_spaces: freeSpaces,
      occupied_spaces: spaces.length - freeSpaces,
      total_units: totalUnitsAll,
      available_units: availableUnitsAll,
    },
  };
}

module.exports = {
  computeTenantLiveAvailability,
};
