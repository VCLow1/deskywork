// controllers/floorPlansController.js — Plans de salle interactifs 2D & occupation temps réel (CDC v3.0)
'use strict';

const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');

const VALID_ITEM_TYPES = ['desk', 'quiet_desk', 'private_office', 'meeting_room', 'training_room', 'event_space'];
const SHARED_SPACE_TYPES = ['open_space', 'hot_desk'];
const EXCLUSIVE_ITEM_TYPES = ['private_office', 'meeting_room', 'training_room', 'event_space'];

function isMissingTableErr(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || err.details || '');
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    /floor_plan/i.test(msg) && /does not exist|could not find|schema cache/i.test(msg)
  );
}

function nowTunisParts() {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Tunis',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Tunis',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now);
  return { date, time, iso: now.toISOString(), ms: now.getTime() };
}

function tunisSlotToUtcRange(dateStr, startStr, endStr) {
  const tunis = nowTunisParts();
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || '')) ? String(dateStr) : tunis.date;
  const safeStart = /^\d{2}:\d{2}/.test(String(startStr || '')) ? String(startStr).slice(0, 5) : '09:00';
  const safeEnd = /^\d{2}:\d{2}/.test(String(endStr || '')) ? String(endStr).slice(0, 5) : '18:00';
  const startDate = new Date(`${safeDate}T${safeStart}:00+01:00`);
  const endDate = new Date(`${safeDate}T${safeEnd}:00+01:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
    return {
      date: safeDate,
      start: '09:00',
      end: '18:00',
      startDate: new Date(`${safeDate}T09:00:00+01:00`),
      endDate: new Date(`${safeDate}T18:00:00+01:00`),
      invalid: Boolean(dateStr || startStr || endStr),
    };
  }
  return { date: safeDate, start: safeStart, end: safeEnd, startDate, endDate, invalid: false };
}

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

function extractReservationItemId(reservation) {
  if (!reservation) return null;
  if (reservation.floor_plan_item_id) return String(reservation.floor_plan_item_id);
  const parsed = safeParseNotes(reservation.notes);
  return parsed?.floor_plan_item_id ? String(parsed.floor_plan_item_id) : null;
}

function extractClientInfo(reservation) {
  if (!reservation) return { client_name: 'Client', client_email: null, client_type: 'particulier' };
  const notesObj = safeParseNotes(reservation.notes);
  if (reservation.raison_sociale || notesObj?.raison_sociale) {
    const company = reservation.raison_sociale || notesObj?.raison_sociale;
    const contact = reservation.contact_nom || notesObj?.contact_nom || '';
    return {
      client_name: contact ? `${company} (${contact})` : company,
      client_email: reservation.email_facturation || notesObj?.email_facturation || reservation.profiles?.email || null,
      client_type: 'entreprise',
    };
  }
  if (reservation.profiles) {
    const fullName = `${reservation.profiles.prenom || ''} ${reservation.profiles.nom || ''}`.trim();
    return {
      client_name: fullName || reservation.profiles.email || 'Membre',
      client_email: reservation.profiles.email || null,
      client_type: 'particulier',
    };
  }
  if (reservation.guests) {
    const fullName = `${reservation.guests.prenom || ''} ${reservation.guests.nom || ''}`.trim();
    return {
      client_name: fullName || reservation.guests.email || 'Visiteur',
      client_email: reservation.guests.email || null,
      client_type: 'guest',
    };
  }
  return { client_name: 'Client', client_email: null, client_type: 'particulier' };
}

function normalizeElement(el, idx) {
  const validTypes = ['wall', 'partition', 'door', 'zone'];
  return {
    id: String(el?.id || `el-${idx + 1}-${crypto.randomUUID().slice(0, 8)}`),
    type: validTypes.includes(el?.type) ? el.type : 'wall',
    label: el?.label ? String(el.label).slice(0, 80) : '',
    x: Math.round(Number(el?.x) || 0),
    y: Math.round(Number(el?.y) || 0),
    width: Math.max(4, Math.round(Number(el?.width) || 40)),
    height: Math.max(4, Math.round(Number(el?.height) || 40)),
    rotation: ((Math.round(Number(el?.rotation) || 0) % 360) + 360) % 360,
  };
}

function normalizeItem(item, floorPlanId, tenantId, idx) {
  const rawId = item?.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(item.id))
    ? String(item.id)
    : crypto.randomUUID();
  return {
    id: rawId,
    floor_plan_id: floorPlanId,
    tenant_id: tenantId,
    space_id: item?.space_id ? String(item.space_id) : null,
    label: String(item?.label || `P-${idx + 1}`).trim().slice(0, 60) || `P-${idx + 1}`,
    item_type: VALID_ITEM_TYPES.includes(item?.item_type) ? item.item_type : 'desk',
    x: Math.round(Number(item?.x) || 0),
    y: Math.round(Number(item?.y) || 0),
    width: Math.max(24, Math.round(Number(item?.width) || 72)),
    height: Math.max(24, Math.round(Number(item?.height) || 52)),
    rotation: ((Math.round(Number(item?.rotation) || 0) % 360) + 360) % 360,
    status: item?.status === 'maintenance' ? 'maintenance' : 'active',
    metadata: item?.metadata && typeof item.metadata === 'object' ? item.metadata : {},
  };
}

async function resolveTenantByIdOrSlug(rawId) {
  const val = String(rawId || '').trim();
  if (!val) return null;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  const cols = 'id, nom, slug, ville, adresse, telephone, latitude, longitude, logo_url, cover_url, description, statut, settings';
  let q = supabaseAdmin
    .from('tenants')
    .select(cols);
  q = isUuid ? q.eq('id', val) : q.eq('slug', val);
  let { data: tenant } = await q.maybeSingle();

  if (!tenant && !isUuid) {
    const slugSearch = val.toLowerCase();
    const { data: fb } = await supabaseAdmin
      .from('tenants')
      .select(cols)
      .or(`slug.ilike.%${slugSearch}%,nom.ilike.%${slugSearch.replace(/-/g, ' ')}%`)
      .limit(1)
      .maybeSingle();
    if (fb) tenant = fb;
  }
  return tenant || null;
}

// ── Couche de persistance double (SQL natif -> fallback tenants.settings.floor_plans) ──

async function loadTenantPlansWithItems(tenantId, { onlyActive = false } = {}) {
  let q = supabaseAdmin
    .from('floor_plans')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('ordre', { ascending: true })
    .order('created_at', { ascending: true });
  if (onlyActive) q = q.eq('is_active', true);

  const { data: plans, error } = await q;
  if (!error) {
    const planIds = (plans || []).map((p) => p.id);
    let items = [];
    if (planIds.length > 0) {
      const { data: itemRows, error: itemErr } = await supabaseAdmin
        .from('floor_plan_items')
        .select('*')
        .in('floor_plan_id', planIds)
        .order('created_at', { ascending: true });
      if (itemErr && !isMissingTableErr(itemErr)) throw itemErr;
      items = itemRows || [];
    }
    const itemsByPlan = new Map();
    for (const it of items) {
      if (!itemsByPlan.has(it.floor_plan_id)) itemsByPlan.set(it.floor_plan_id, []);
      itemsByPlan.get(it.floor_plan_id).push(it);
    }
    return {
      source: 'sql',
      plans: (plans || []).map((p) => ({
        ...p,
        elements_json: Array.isArray(p.elements_json) ? p.elements_json : [],
        items: itemsByPlan.get(p.id) || [],
      })),
    };
  }

  if (!isMissingTableErr(error)) throw error;

  // Fallback structuré dans tenants.settings.floor_plans
  const { data: tenantRow, error: tErr } = await supabaseAdmin
    .from('tenants')
    .select('id, settings')
    .eq('id', tenantId)
    .maybeSingle();
  if (tErr) throw tErr;
  const rawList = Array.isArray(tenantRow?.settings?.floor_plans) ? tenantRow.settings.floor_plans : [];
  const filtered = onlyActive ? rawList.filter((p) => p.is_active !== false) : rawList;
  const sorted = [...filtered].sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
  return {
    source: 'settings_fallback',
    settings: tenantRow?.settings || {},
    plans: sorted.map((p) => ({
      ...p,
      elements_json: Array.isArray(p.elements_json) ? p.elements_json : [],
      items: Array.isArray(p.items) ? p.items : [],
    })),
  };
}

async function saveTenantPlansFallback(tenantId, nextPlans) {
  const { data: tenantRow, error: fetchErr } = await supabaseAdmin
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .single();
  if (fetchErr) throw fetchErr;
  const curSettings = tenantRow?.settings && typeof tenantRow.settings === 'object' ? tenantRow.settings : {};
  const nextSettings = { ...curSettings, floor_plans: nextPlans };
  const { error: updErr } = await supabaseAdmin
    .from('tenants')
    .update({ settings: nextSettings, updated_at: new Date().toISOString() })
    .eq('id', tenantId);
  if (updErr) throw updErr;
}

async function loadTenantEspacesMap(tenantId) {
  let { data, error } = await supabaseAdmin
    .from('espaces')
    .select('id, tenant_id, nom, type, capacite, tarif_horaire, equipements, actif, description, photo_url, photos_urls')
    .eq('tenant_id', tenantId)
    .order('nom', { ascending: true });
  if (error) {
    ({ data, error } = await supabaseAdmin
      .from('espaces')
      .select('id, tenant_id, nom, type, capacite, tarif_horaire, equipements, actif, description, photo_url')
      .eq('tenant_id', tenantId)
      .order('nom', { ascending: true }));
  }
  if (error) {
    ({ data, error } = await supabaseAdmin
      .from('espaces')
      .select('id, tenant_id, nom, type, capacite, tarif_horaire, equipements, actif')
      .eq('tenant_id', tenantId));
  }
  if (error) throw error;
  const map = new Map();
  for (const esp of data || []) {
    map.set(esp.id, esp);
  }
  return map;
}

async function loadTenantReservationsAndSessions(tenantId, rangeStartIso, rangeEndIso) {
  // Réservations confirmées/pending chevauchant la fenêtre
  let resQ = supabaseAdmin
    .from('reservations')
    .select('*, profiles!user_id(id, nom, prenom, email, telephone), guests(id, nom, prenom, email, telephone)')
    .eq('tenant_id', tenantId)
    .in('statut', ['confirmed', 'pending'])
    .lt('date_debut', rangeEndIso)
    .gt('date_fin', rangeStartIso)
    .order('date_debut', { ascending: true });

  let { data: reservations, error: resErr } = await resQ;
  if (resErr && (resErr.code === 'PGRST200' || /relationship|column/i.test(resErr.message || ''))) {
    const fb = await supabaseAdmin
      .from('reservations')
      .select('*')
      .eq('tenant_id', tenantId)
      .in('statut', ['confirmed', 'pending'])
      .lt('date_debut', rangeEndIso)
      .gt('date_fin', rangeStartIso)
      .order('date_debut', { ascending: true });
    reservations = fb.data || [];
    resErr = fb.error;
  }
  if (resErr) throw resErr;

  // Sessions actives non libérées (peuvent dépasser leur date_fin initiale)
  const { data: openSessions, error: sesErr } = await supabaseAdmin
    .from('sessions')
    .select('*')
    .in('statut', ['active', 'overtime'])
    .is('check_out', null);

  let sessions = sesErr ? [] : (openSessions || []);

  // S'assurer que toute réservation liée à une session ouverte de ce tenant est bien chargée
  const resMap = new Map((reservations || []).map((r) => [r.id, r]));
  const missingSessionResIds = sessions
    .map((s) => s.reservation_id)
    .filter((rid) => rid && !resMap.has(rid));

  if (missingSessionResIds.length > 0) {
    let { data: extraRes, error: extraErr } = await supabaseAdmin
      .from('reservations')
      .select('*, profiles!user_id(id, nom, prenom, email, telephone), guests(id, nom, prenom, email, telephone)')
      .eq('tenant_id', tenantId)
      .in('id', missingSessionResIds);
    if (extraErr) {
      ({ data: extraRes } = await supabaseAdmin
        .from('reservations')
        .select('*')
        .eq('tenant_id', tenantId)
        .in('id', missingSessionResIds));
    }
    for (const r of extraRes || []) {
      resMap.set(r.id, r);
    }
  }

  // Filtrer les sessions appartenant au tenant
  const tenantSessions = sessions.filter((s) => s.tenant_id === tenantId || resMap.has(s.reservation_id));
  const allReservations = Array.from(resMap.values());

  // Paiements en attente (sur place) liés à ces réservations
  const resIds = allReservations.map((r) => r.id);
  const pendingPaymentsByResId = new Map();
  if (resIds.length > 0) {
    const { data: pays } = await supabaseAdmin
      .from('paiements')
      .select('id, reservation_id, montant, mode, statut, reference_externe')
      .in('reservation_id', resIds)
      .eq('statut', 'pending');
    for (const p of pays || []) {
      if (!pendingPaymentsByResId.has(p.reservation_id)) {
        pendingPaymentsByResId.set(p.reservation_id, p);
      }
    }
  }

  // Formations chevauchant la fenêtre
  const { data: formations } = await supabaseAdmin
    .from('formations')
    .select('id, titre, espace_id, date_debut, date_fin, statut')
    .eq('tenant_id', tenantId)
    .in('statut', ['planifiee', 'publiee', 'en_cours'])
    .lt('date_debut', rangeEndIso)
    .gt('date_fin', rangeStartIso);

  return {
    reservations: allReservations,
    sessions: tenantSessions,
    formations: formations || [],
    pendingPaymentsByResId,
  };
}

function enrichPlansForClientOrLive({
  plans,
  espacesById,
  reservations,
  sessions,
  formations,
  pendingPaymentsByResId,
  mode,
  rangeStartMs,
  rangeEndMs,
  nowMs,
  overtimeRate,
}) {
  const sessionByResId = new Map();
  for (const s of sessions) {
    if (!s.check_out && s.statut !== 'completed') {
      sessionByResId.set(s.reservation_id, s);
    }
  }

  // Rassembler tous les items de tous les plans pour résoudre l'occupation par space_id de façon cohérente
  const allItems = plans.flatMap((p) => p.items || []);
  const itemsBySpace = new Map();
  for (const it of allItems) {
    if (!it.space_id) continue;
    if (!itemsBySpace.has(it.space_id)) itemsBySpace.set(it.space_id, []);
    itemsBySpace.get(it.space_id).push(it);
  }

  // Réservations actives sur la fenêtre demandée (ou maintenant en mode live)
  const relevantBookings = reservations.filter((r) => {
    const sess = sessionByResId.get(r.id);
    if (mode === 'live') {
      if (sess) return true; // session non libérée occupe toujours le poste
      const deb = new Date(r.date_debut).getTime();
      const fin = new Date(r.date_fin).getTime();
      return deb <= nowMs && fin >= nowMs;
    }
    // Mode booking [rangeStartMs, rangeEndMs]
    const deb = new Date(r.date_debut).getTime();
    const fin = new Date(r.date_fin).getTime();
    const overlapsWindow = deb < rangeEndMs && fin > rangeStartMs;
    const unReleasedNearNow = Boolean(sess) && rangeStartMs <= nowMs + 2 * 3600 * 1000;
    return overlapsWindow || unReleasedNearNow;
  });

  // Indexation occupation par item_id
  const occupiedByItemId = new Map();
  const genericSharedBySpace = new Map();

  for (const r of relevantBookings) {
    const explicitItemId = extractReservationFloorPlanMetaId(r);
    const space = espacesById.get(r.espace_id);
    const isShared = space ? SHARED_SPACE_TYPES.includes(space.type) : false;

    if (explicitItemId && allItems.some((it) => it.id === explicitItemId)) {
      if (!occupiedByItemId.has(explicitItemId)) {
        occupiedByItemId.set(explicitItemId, r);
      }
      continue;
    }

    if (!isShared) {
      // Espace exclusif : bloque tous les items associés à ce space_id
      for (const it of itemsBySpace.get(r.espace_id) || []) {
        if (!occupiedByItemId.has(it.id)) occupiedByItemId.set(it.id, r);
      }
    } else {
      // Espace partagé sans poste spécifique : empile pour attribuer aux postes disponibles
      if (!genericSharedBySpace.has(r.espace_id)) genericSharedBySpace.set(r.espace_id, []);
      genericSharedBySpace.get(r.espace_id).push(r);
    }
  }

  // Répartir les réservations partagées génériques sur les postes actifs restants
  for (const [spaceId, bookingsList] of genericSharedBySpace.entries()) {
    const space = espacesById.get(spaceId);
    const candidates = (itemsBySpace.get(spaceId) || []).filter((it) => it.status !== 'maintenance');
    const explicitCount = candidates.filter((it) => occupiedByItemId.has(it.id)).length;
    const totalUsed = explicitCount + bookingsList.length;
    const capacity = Math.max(1, parseInt(space?.capacite, 10) || candidates.length || 1);

    if (totalUsed >= capacity) {
      // Capacité atteinte : tous les postes de cet espace partagé deviennent indisponibles
      let bIdx = 0;
      for (const it of candidates) {
        if (!occupiedByItemId.has(it.id)) {
          occupiedByItemId.set(it.id, bookingsList[bIdx % bookingsList.length]);
          bIdx++;
        }
      }
    } else {
      let bIdx = 0;
      for (const it of candidates) {
        if (bIdx >= bookingsList.length) break;
        if (!occupiedByItemId.has(it.id)) {
          occupiedByItemId.set(it.id, bookingsList[bIdx]);
          bIdx++;
        }
      }
    }
  }

  // Formations actives sur la fenêtre
  const formationsBySpace = new Map();
  for (const f of formations) {
    const deb = new Date(f.date_debut).getTime();
    const fin = new Date(f.date_fin).getTime();
    const overlaps = mode === 'live' ? (deb <= nowMs && fin >= nowMs) : (deb < rangeEndMs && fin > rangeStartMs);
    if (overlaps && f.espace_id && !formationsBySpace.has(f.espace_id)) {
      formationsBySpace.set(f.espace_id, f);
    }
  }

  // Prochaines réservations du jour (mode live uniquement, pour info au clic sur un poste libre)
  const upcomingByItemId = new Map();
  if (mode === 'live') {
    for (const r of reservations) {
      const deb = new Date(r.date_debut).getTime();
      if (deb <= nowMs) continue;
      const explicitItemId = extractReservationFloorPlanMetaId(r);
      if (explicitItemId && !upcomingByItemId.has(explicitItemId)) {
        upcomingByItemId.set(explicitItemId, r);
      } else if (!explicitItemId) {
        const space = espacesById.get(r.espace_id);
        if (space && !SHARED_SPACE_TYPES.includes(space.type)) {
          for (const it of itemsBySpace.get(r.espace_id) || []) {
            if (!upcomingByItemId.has(it.id)) upcomingByItemId.set(it.id, r);
          }
        }
      }
    }
  }

  const enrichedPlans = plans.map((plan) => {
    const items = (plan.items || []).map((item) => {
      const space = item.space_id ? espacesById.get(item.space_id) : null;
      const hourly = Number(space?.tarif_horaire || 0);
      const baseFields = {
        ...item,
        space_name: space?.nom || null,
        space_type: space?.type || null,
        capacite: space?.capacite || (EXCLUSIVE_ITEM_TYPES.includes(item.item_type) ? 4 : 1),
        tarif_horaire: hourly,
        tarif_journalier: Number((hourly * 8).toFixed(3)),
        equipements: Array.isArray(space?.equipements) ? space.equipements : [],
        bookable: Boolean(item.space_id) && item.status !== 'maintenance' && space?.actif !== false,
      };

      if (item.status === 'maintenance' || space?.actif === false) {
        return {
          ...baseFields,
          live_status: 'maintenance',
          status_label: 'En maintenance',
          bookable: false,
        };
      }

      const booking = occupiedByItemId.get(item.id) || null;
      const formConflict = !booking && item.space_id ? formationsBySpace.get(item.space_id) : null;

      if (formConflict) {
        return {
          ...baseFields,
          live_status: 'occupied',
          status_label: 'Formation en cours',
          bookable: false,
          is_formation: true,
          formation_titre: formConflict.titre,
          date_debut: formConflict.date_debut,
          date_fin: formConflict.date_fin,
          conflict_reason: `Réservé pour la formation « ${formConflict.titre} »`,
        };
      }

      if (booking) {
        const sess = sessionByResId.get(booking.id) || null;
        const finMs = new Date(booking.date_fin).getTime();
        const secondsRemaining = Math.max(0, Math.floor((finMs - nowMs) / 1000));
        const isOvertime = Boolean(sess) && nowMs > finMs;
        const overtimeSeconds = isOvertime ? Math.floor((nowMs - finMs) / 1000) : 0;
        const isEndingSoon = !isOvertime && secondsRemaining > 0 && secondsRemaining <= 15 * 60;
        const effectiveRate = overtimeRate != null ? overtimeRate : hourly;
        const overtimeMinutes = Math.ceil(overtimeSeconds / 60);
        const montantDepassement = overtimeMinutes > 0 && effectiveRate > 0
          ? Number(((overtimeMinutes / 60) * effectiveRate).toFixed(3))
          : 0;

        let liveStatus = 'occupied';
        let statusLabel = 'Occupé';
        if (mode === 'live') {
          if (isOvertime) {
            liveStatus = 'overtime';
            statusLabel = 'En dépassement';
          } else if (isEndingSoon) {
            liveStatus = 'ending_soon';
            statusLabel = 'Bientôt terminée (-15 min)';
          } else if (!sess && booking.statut === 'pending') {
            statusLabel = 'Réservé (en attente)';
          }
        }

        const client = mode === 'live' ? extractClientInfo(booking) : null;
        const pendingPay = mode === 'live' ? (pendingPaymentsByResId.get(booking.id) || null) : null;

        return {
          ...baseFields,
          live_status: liveStatus,
          status_label: statusLabel,
          bookable: false,
          date_debut: booking.date_debut,
          date_fin: booking.date_fin,
          ...(mode === 'live' ? {
            reservation_id: booking.id,
            reservation_statut: booking.statut,
            session_id: sess?.id || null,
            check_in: sess?.check_in || null,
            needs_checkin: !sess,
            client_name: client.client_name,
            client_email: client.client_email,
            client_type: client.client_type,
            seconds_remaining: secondsRemaining,
            overtime_seconds: overtimeSeconds,
            montant_depassement: montantDepassement,
            pending_payment: pendingPay,
          } : {}),
        };
      }

      const nextRes = upcomingByItemId.get(item.id) || null;
      const nextClient = nextRes ? extractClientInfo(nextRes) : null;

      return {
        ...baseFields,
        live_status: 'free',
        status_label: 'Libre',
        ...(nextRes ? {
          next_reservation: {
            id: nextRes.id,
            date_debut: nextRes.date_debut,
            date_fin: nextRes.date_fin,
            statut: nextRes.statut,
            client_name: nextClient?.client_name || 'Client',
          },
        } : {}),
      };
    });

    return { ...plan, items };
  });

  return enrichedPlans;
}

function extractReservationFloorPlanMetaId(reservation) {
  return extractReservationItemId(reservation);
}

// ── Handlers API ──────────────────────────────────────────────────────────

async function listFloorPlans(req, res) {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'Aucun établissement associé à ce compte.' });
    }
    const { plans } = await loadTenantPlansWithItems(tenantId);
    const espacesMap = await loadTenantEspacesMap(tenantId);
    const enriched = plans.map((p) => ({
      ...p,
      items: (p.items || []).map((it) => {
        const sp = it.space_id ? espacesMap.get(it.space_id) : null;
        return {
          ...it,
          space_name: sp?.nom || null,
          space_type: sp?.type || null,
          tarif_horaire: sp ? Number(sp.tarif_horaire || 0) : 0,
        };
      }),
    }));
    res.json({ floor_plans: enriched });
  } catch (err) {
    console.error('❌ listFloorPlans:', err);
    res.status(500).json({ error: err.message });
  }
}

async function createFloorPlan(req, res) {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Établissement requis.' });

    const {
      name = 'Nouveau plan',
      width = 1200,
      height = 760,
      grid_size = 20,
      background_image_url = null,
      elements_json = [],
      items = [],
      is_active = true,
      ordre = 0,
    } = req.body || {};

    const cleanName = String(name || 'Nouveau plan').trim().slice(0, 120) || 'Nouveau plan';
    const cleanWidth = Math.min(4000, Math.max(400, Math.round(Number(width) || 1200)));
    const cleanHeight = Math.min(3000, Math.max(300, Math.round(Number(height) || 760)));
    const cleanGrid = Math.min(100, Math.max(10, Math.round(Number(grid_size) || 20)));
    const cleanElements = (Array.isArray(elements_json) ? elements_json : []).map(normalizeElement);

    const planId = crypto.randomUUID();
    const cleanItems = (Array.isArray(items) ? items : []).map((it, i) => normalizeItem(it, planId, tenantId, i));

    const { data: created, error } = await supabaseAdmin
      .from('floor_plans')
      .insert({
        id: planId,
        tenant_id: tenantId,
        name: cleanName,
        width: cleanWidth,
        height: cleanHeight,
        grid_size: cleanGrid,
        background_image_url: background_image_url ? String(background_image_url).trim() : null,
        elements_json: cleanElements,
        is_active: Boolean(is_active),
        ordre: Number(ordre) || 0,
      })
      .select('*')
      .single();

    if (!error) {
      let insertedItems = [];
      if (cleanItems.length > 0) {
        const { data: itemRows, error: itemErr } = await supabaseAdmin
          .from('floor_plan_items')
          .insert(cleanItems)
          .select('*');
        if (itemErr) throw itemErr;
        insertedItems = itemRows || [];
      }
      return res.status(201).json({ floor_plan: { ...created, items: insertedItems } });
    }

    if (!isMissingTableErr(error)) return res.status(400).json({ error: error.message });

    // Fallback settings
    const { plans } = await loadTenantPlansWithItems(tenantId);
    const nowIso = new Date().toISOString();
    const newPlan = {
      id: planId,
      tenant_id: tenantId,
      name: cleanName,
      width: cleanWidth,
      height: cleanHeight,
      grid_size: cleanGrid,
      background_image_url: background_image_url ? String(background_image_url).trim() : null,
      elements_json: cleanElements,
      is_active: Boolean(is_active),
      ordre: Number(ordre) || plans.length,
      items: cleanItems,
      created_at: nowIso,
      updated_at: nowIso,
    };
    await saveTenantPlansFallback(tenantId, [...plans, newPlan]);
    return res.status(201).json({ floor_plan: newPlan });
  } catch (err) {
    console.error('❌ createFloorPlan:', err);
    res.status(500).json({ error: err.message });
  }
}

async function updateFloorPlan(req, res) {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Établissement requis.' });

    const {
      name,
      width,
      height,
      grid_size,
      background_image_url,
      elements_json,
      items,
      is_active,
      ordre,
    } = req.body || {};

    // Vérifier appartenance
    const loaded = await loadTenantPlansWithItems(tenantId);
    const existing = loaded.plans.find((p) => p.id === id);
    if (!existing) {
      return res.status(404).json({ error: 'Plan introuvable pour cet établissement.' });
    }

    const cleanName = name !== undefined ? String(name).trim().slice(0, 120) || existing.name : existing.name;
    const cleanWidth = width !== undefined ? Math.min(4000, Math.max(400, Math.round(Number(width) || 1200))) : existing.width;
    const cleanHeight = height !== undefined ? Math.min(3000, Math.max(300, Math.round(Number(height) || 760))) : existing.height;
    const cleanGrid = grid_size !== undefined ? Math.min(100, Math.max(10, Math.round(Number(grid_size) || 20))) : existing.grid_size;
    const cleanBg = background_image_url !== undefined
      ? (background_image_url ? String(background_image_url).trim() : null)
      : existing.background_image_url;
    const cleanElements = elements_json !== undefined
      ? (Array.isArray(elements_json) ? elements_json : []).map(normalizeElement)
      : existing.elements_json;
    const cleanActive = is_active !== undefined ? Boolean(is_active) : existing.is_active !== false;
    const cleanOrdre = ordre !== undefined ? Number(ordre) || 0 : (existing.ordre ?? 0);
    const cleanItems = items !== undefined
      ? (Array.isArray(items) ? items : []).map((it, i) => normalizeItem(it, id, existing.tenant_id, i))
      : existing.items;

    // Vérifier que les space_id référencés appartiennent bien à ce tenant
    const espacesMap = await loadTenantEspacesMap(existing.tenant_id);
    const sanitizedItems = cleanItems.map((it) => ({
      ...it,
      space_id: it.space_id && espacesMap.has(it.space_id) ? it.space_id : null,
    }));

    if (loaded.source === 'sql') {
      const { data: updatedPlan, error: updErr } = await supabaseAdmin
        .from('floor_plans')
        .update({
          name: cleanName,
          width: cleanWidth,
          height: cleanHeight,
          grid_size: cleanGrid,
          background_image_url: cleanBg,
          elements_json: cleanElements,
          is_active: cleanActive,
          ordre: cleanOrdre,
        })
        .eq('id', id)
        .eq('tenant_id', existing.tenant_id)
        .select('*')
        .single();
      if (updErr) return res.status(400).json({ error: updErr.message });

      if (items !== undefined) {
        const keepIds = new Set(sanitizedItems.map((it) => it.id));
        const toDelete = (existing.items || []).map((it) => it.id).filter((oldId) => !keepIds.has(oldId));
        if (toDelete.length > 0) {
          await supabaseAdmin
            .from('floor_plan_items')
            .delete()
            .eq('floor_plan_id', id)
            .eq('tenant_id', existing.tenant_id)
            .in('id', toDelete);
        }
        if (sanitizedItems.length > 0) {
          const { error: upsErr } = await supabaseAdmin
            .from('floor_plan_items')
            .upsert(sanitizedItems, { onConflict: 'id' });
          if (upsErr) return res.status(400).json({ error: upsErr.message });
        }
      }

      const { data: freshItems } = await supabaseAdmin
        .from('floor_plan_items')
        .select('*')
        .eq('floor_plan_id', id)
        .order('created_at', { ascending: true });

      return res.json({ floor_plan: { ...updatedPlan, items: freshItems || [] } });
    }

    // Fallback settings
    const nowIso = new Date().toISOString();
    const updatedPlan = {
      ...existing,
      name: cleanName,
      width: cleanWidth,
      height: cleanHeight,
      grid_size: cleanGrid,
      background_image_url: cleanBg,
      elements_json: cleanElements,
      is_active: cleanActive,
      ordre: cleanOrdre,
      items: sanitizedItems,
      updated_at: nowIso,
    };
    const nextPlans = loaded.plans.map((p) => (p.id === id ? updatedPlan : p));
    await saveTenantPlansFallback(existing.tenant_id, nextPlans);
    return res.json({ floor_plan: updatedPlan });
  } catch (err) {
    console.error('❌ updateFloorPlan:', err);
    res.status(500).json({ error: err.message });
  }
}

async function toggleItemMaintenance(req, res) {
  try {
    const { id, itemId } = req.params;
    const { status } = req.body || {};
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Établissement requis.' });

    const nextStatus = status === 'maintenance' ? 'maintenance' : 'active';
    const loaded = await loadTenantPlansWithItems(tenantId);
    const plan = loaded.plans.find((p) => p.id === id);
    if (!plan) return res.status(404).json({ error: 'Plan introuvable.' });

    if (loaded.source === 'sql') {
      const { data, error } = await supabaseAdmin
        .from('floor_plan_items')
        .update({ status: nextStatus })
        .eq('id', itemId)
        .eq('floor_plan_id', id)
        .eq('tenant_id', tenantId)
        .select('*')
        .single();
      if (error || !data) return res.status(404).json({ error: error?.message || 'Élément introuvable.' });
      return res.json({ item: data });
    }

    let updatedItem = null;
    const nextPlans = loaded.plans.map((p) => {
      if (p.id !== id) return p;
      return {
        ...p,
        updated_at: new Date().toISOString(),
        items: (p.items || []).map((it) => {
          if (it.id !== itemId) return it;
          updatedItem = { ...it, status: nextStatus };
          return updatedItem;
        }),
      };
    });
    if (!updatedItem) return res.status(404).json({ error: 'Élément introuvable.' });
    await saveTenantPlansFallback(tenantId, nextPlans);
    return res.json({ item: updatedItem });
  } catch (err) {
    console.error('❌ toggleItemMaintenance:', err);
    res.status(500).json({ error: err.message });
  }
}

async function deleteFloorPlan(req, res) {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Établissement requis.' });

    const loaded = await loadTenantPlansWithItems(tenantId);
    const exists = loaded.plans.some((p) => p.id === id);
    if (!exists) return res.status(404).json({ error: 'Plan introuvable.' });

    if (loaded.source === 'sql') {
      const { error } = await supabaseAdmin
        .from('floor_plans')
        .delete()
        .eq('id', id)
        .eq('tenant_id', tenantId);
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ deleted: true, id });
    }

    const nextPlans = loaded.plans.filter((p) => p.id !== id);
    await saveTenantPlansFallback(tenantId, nextPlans);
    return res.json({ deleted: true, id });
  } catch (err) {
    console.error('❌ deleteFloorPlan:', err);
    res.status(500).json({ error: err.message });
  }
}

async function getLiveFloorPlanStatus(req, res) {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Établissement requis.' });

    const requestedPlanId = req.params.id || req.query.plan_id || null;
    const tunisNow = nowTunisParts();
    const dayStartIso = new Date(`${tunisNow.date}T00:00:00+01:00`).toISOString();
    const dayEndIso = new Date(`${tunisNow.date}T23:59:59+01:00`).toISOString();

    const [{ plans }, espacesById, { reservations, sessions, formations, pendingPaymentsByResId }, tenantMeta] = await Promise.all([
      loadTenantPlansWithItems(tenantId),
      loadTenantEspacesMap(tenantId),
      loadTenantReservationsAndSessions(tenantId, dayStartIso, dayEndIso),
      supabaseAdmin.from('tenants').select('settings, tarif_depassement_heure').eq('id', tenantId).maybeSingle(),
    ]);

    const tRow = tenantMeta?.data;
    const overtimeRate = tRow?.settings?.tarif_depassement_heure != null
      ? Number(tRow.settings.tarif_depassement_heure)
      : (tRow?.tarif_depassement_heure != null ? Number(tRow.tarif_depassement_heure) : null);

    const enriched = enrichPlansForClientOrLive({
      plans,
      espacesById,
      reservations,
      sessions,
      formations,
      pendingPaymentsByResId,
      mode: 'live',
      rangeStartMs: tunisNow.ms,
      rangeEndMs: tunisNow.ms + 60000,
      nowMs: tunisNow.ms,
      overtimeRate,
    });

    const activePlan = requestedPlanId
      ? enriched.find((p) => p.id === requestedPlanId) || enriched[0] || null
      : enriched.find((p) => p.is_active !== false) || enriched[0] || null;

    const allItems = activePlan ? activePlan.items : [];
    const counts = {
      free: allItems.filter((i) => i.live_status === 'free').length,
      occupied: allItems.filter((i) => i.live_status === 'occupied').length,
      ending_soon: allItems.filter((i) => i.live_status === 'ending_soon').length,
      overtime: allItems.filter((i) => i.live_status === 'overtime').length,
      maintenance: allItems.filter((i) => i.live_status === 'maintenance').length,
      total: allItems.length,
    };

    res.json({
      server_time: tunisNow.iso,
      tunis_date: tunisNow.date,
      tunis_time: tunisNow.time,
      floor_plans: enriched,
      active_plan_id: activePlan?.id || null,
      counts,
    });
  } catch (err) {
    console.error('❌ getLiveFloorPlanStatus:', err);
    res.status(500).json({ error: err.message });
  }
}

async function getPublicFloorPlans(req, res) {
  try {
    const tenant = await resolveTenantByIdOrSlug(req.params.tenantId);
    if (!tenant) return res.status(404).json({ error: 'Établissement introuvable.' });

    const allowedStatuts = ['actif', 'valide', 'approuve', null, undefined];
    if (!allowedStatuts.includes(tenant.statut)) {
      return res.status(404).json({ error: 'Établissement indisponible.' });
    }

    const { date, start, end } = req.query;
    const slot = tunisSlotToUtcRange(date, start, end);
    const tunisNow = nowTunisParts();

    const [{ plans }, espacesById, { reservations, sessions, formations, pendingPaymentsByResId }] = await Promise.all([
      loadTenantPlansWithItems(tenant.id, { onlyActive: true }),
      loadTenantEspacesMap(tenant.id),
      loadTenantReservationsAndSessions(tenant.id, slot.startDate.toISOString(), slot.endDate.toISOString()),
    ]);

    const enriched = enrichPlansForClientOrLive({
      plans,
      espacesById,
      reservations,
      sessions,
      formations,
      pendingPaymentsByResId,
      mode: 'booking',
      rangeStartMs: slot.startDate.getTime(),
      rangeEndMs: slot.endDate.getTime(),
      nowMs: tunisNow.ms,
      overtimeRate: null,
    });

    res.json({
      tenant_id: tenant.id,
      tenant_nom: tenant.nom,
      slot: {
        date: slot.date,
        start: slot.start,
        end: slot.end,
        start_iso: slot.startDate.toISOString(),
        end_iso: slot.endDate.toISOString(),
      },
      server_time: tunisNow.iso,
      floor_plans: enriched,
    });
  } catch (err) {
    console.error('❌ getPublicFloorPlans:', err);
    res.status(500).json({ error: err.message });
  }
}

async function getPublicSpacesLive(req, res) {
  try {
    const tenant = await resolveTenantByIdOrSlug(req.params.tenantId);
    if (!tenant) return res.status(404).json({ error: 'Établissement introuvable.' });

    const allowedStatuts = ['actif', 'valide', 'approuve', null, undefined];
    if (!allowedStatuts.includes(tenant.statut)) {
      return res.status(404).json({ error: 'Établissement indisponible.' });
    }

    const tunisNow = nowTunisParts();
    const { date, start, end, mode } = req.query;
    const useNow = mode === 'now' || (!date && !start && !end);

    let slotDate = tunisNow.date;
    let slotStart = tunisNow.time.slice(0, 5);
    let slotEnd = '18:00';
    let rangeStartDate;
    let rangeEndDate;
    let isNow = useNow;

    if (useNow) {
      rangeStartDate = new Date(tunisNow.ms);
      rangeEndDate = new Date(tunisNow.ms + 2 * 3600 * 1000);
      const endHhMm = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Tunis',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(rangeEndDate);
      slotEnd = endHhMm;
    } else {
      const slot = tunisSlotToUtcRange(date, start, end);
      slotDate = slot.date;
      slotStart = slot.start;
      slotEnd = slot.end;
      rangeStartDate = slot.startDate;
      rangeEndDate = slot.endDate;
      isNow = rangeStartDate.getTime() <= tunisNow.ms && rangeEndDate.getTime() >= tunisNow.ms;
    }

    const rangeStartMs = rangeStartDate.getTime();
    const rangeEndMs = rangeEndDate.getTime();

    const [{ plans }, espacesById, { reservations, sessions, formations, pendingPaymentsByResId }] = await Promise.all([
      loadTenantPlansWithItems(tenant.id, { onlyActive: true }),
      loadTenantEspacesMap(tenant.id),
      loadTenantReservationsAndSessions(tenant.id, rangeStartDate.toISOString(), rangeEndDate.toISOString()),
    ]);

    const enrichedPlans = enrichPlansForClientOrLive({
      plans,
      espacesById,
      reservations,
      sessions,
      formations,
      pendingPaymentsByResId,
      mode: isNow ? 'live' : 'booking',
      rangeStartMs,
      rangeEndMs,
      nowMs: tunisNow.ms,
      overtimeRate: null,
    });

    const activeSessionResIds = new Set(
      (sessions || []).filter((s) => !s.check_out && s.statut !== 'completed').map((s) => s.reservation_id)
    );

    const bookingsBySpace = new Map();
    for (const r of reservations || []) {
      const deb = new Date(r.date_debut).getTime();
      const fin = new Date(r.date_fin).getTime();
      const hasOpenSession = isNow && activeSessionResIds.has(r.id);
      const overlaps = hasOpenSession || (deb < rangeEndMs && fin > rangeStartMs);
      if (overlaps && r.espace_id) {
        if (!bookingsBySpace.has(r.espace_id)) bookingsBySpace.set(r.espace_id, []);
        bookingsBySpace.get(r.espace_id).push(r);
      }
    }

    const formationBySpace = new Map();
    for (const f of formations || []) {
      const deb = new Date(f.date_debut).getTime();
      const fin = new Date(f.date_fin).getTime();
      if (deb < rangeEndMs && fin > rangeStartMs && f.espace_id && !formationBySpace.has(f.espace_id)) {
        formationBySpace.set(f.espace_id, f);
      }
    }

    const planItemsBySpace = new Map();
    let totalPlanItems = 0;
    let freePlanItems = 0;
    for (const pl of enrichedPlans) {
      for (const it of pl.items || []) {
        if (!it.space_id) continue;
        totalPlanItems++;
        if (it.live_status === 'free' && it.bookable) freePlanItems++;
        if (!planItemsBySpace.has(it.space_id)) planItemsBySpace.set(it.space_id, { total: 0, free: 0 });
        const entry = planItemsBySpace.get(it.space_id);
        entry.total++;
        if (it.live_status === 'free' && it.bookable) entry.free++;
      }
    }

    const spaces = Array.from(espacesById.values())
      .map((esp) => {
        const hourly = Number(esp.tarif_horaire || 0);
        const capacity = Math.max(1, parseInt(esp.capacite, 10) || 1);
        const isShared = SHARED_SPACE_TYPES.includes(esp.type);
        const activeBookings = bookingsBySpace.get(esp.id) || [];
        const occupiedCount = activeBookings.length;
        const form = formationBySpace.get(esp.id) || null;
        const photos = [...new Set([
          esp.photo_url,
          ...(Array.isArray(esp.photos_urls) ? esp.photos_urls : []),
          ...(Array.isArray(esp.images) ? esp.images : []),
        ].filter(Boolean))];
        const fpStats = planItemsBySpace.get(esp.id) || { total: 0, free: 0 };

        let remainingSpots = isShared ? Math.max(0, capacity - occupiedCount) : (occupiedCount > 0 ? 0 : 1);
        let liveStatus = 'free';
        let statusLabel = 'Disponible';
        let nextFreeTime = null;
        let conflictReason = null;

        if (esp.actif === false) {
          remainingSpots = 0;
          liveStatus = 'maintenance';
          statusLabel = 'Indisponible';
          conflictReason = 'Espace temporairement en maintenance';
        } else if (form) {
          remainingSpots = 0;
          liveStatus = 'formation';
          statusLabel = 'Formation en cours';
          nextFreeTime = form.date_fin || null;
          conflictReason = `Réservé pour la formation « ${form.titre} »`;
        } else if (remainingSpots === 0) {
          liveStatus = 'occupied';
          statusLabel = isShared ? 'Complet sur ce créneau' : 'Occupé sur ce créneau';
          const endTimes = activeBookings.map((b) => b.date_fin).filter(Boolean).sort();
          nextFreeTime = endTimes[0] || null;
          conflictReason = isShared
            ? `Toutes les places (${capacity}) sont réservées sur ce créneau`
            : 'Cet espace est déjà réservé sur ce créneau';
        } else if (isShared && remainingSpots <= Math.max(2, Math.ceil(capacity * 0.25))) {
          liveStatus = 'limited';
          statusLabel = `Plus que ${remainingSpots} place${remainingSpots > 1 ? 's' : ''}`;
        }

        return {
          id: esp.id,
          tenant_id: esp.tenant_id,
          nom: esp.nom,
          type: esp.type,
          description: esp.description || null,
          capacite: capacity,
          capacity,
          is_shared: isShared,
          tarif_horaire: hourly,
          tarif_journalier: Number((hourly * 8).toFixed(3)),
          photo_url: photos[0] || null,
          photos,
          equipements: Array.isArray(esp.equipements) ? esp.equipements : [],
          occupied_count: occupiedCount,
          remaining_spots: remainingSpots,
          live_status: liveStatus,
          status_label: statusLabel,
          next_free_time: nextFreeTime,
          conflict_reason: conflictReason,
          floor_plan_items_count: fpStats.total,
          floor_plan_free_items_count: fpStats.free,
        };
      })
      .sort((a, b) => {
        const order = { free: 0, limited: 1, occupied: 2, formation: 3, maintenance: 4 };
        const diff = (order[a.live_status] ?? 9) - (order[b.live_status] ?? 9);
        return diff !== 0 ? diff : a.tarif_horaire - b.tarif_horaire;
      });

    const saasPack = tenant.settings?.saas_pack || 'essentiel';
    const freeSpaces = spaces.filter((s) => s.live_status === 'free' || s.live_status === 'limited').length;

    res.json({
      tenant: {
        id: tenant.id,
        nom: tenant.nom,
        slug: tenant.slug,
        ville: tenant.ville || null,
        adresse: tenant.adresse || null,
        telephone: tenant.telephone || null,
        latitude: tenant.latitude != null ? Number(tenant.latitude) : null,
        longitude: tenant.longitude != null ? Number(tenant.longitude) : null,
        logo_url: tenant.logo_url || null,
        cover_url: tenant.cover_url || null,
        description: tenant.description || null,
        is_featured: saasPack === 'premium',
        is_partner: ['premium', 'standard'].includes(saasPack) || Boolean(tenant.settings?.is_partner),
      },
      slot: {
        date: slotDate,
        start: slotStart,
        end: slotEnd,
        start_iso: rangeStartDate.toISOString(),
        end_iso: rangeEndDate.toISOString(),
        is_now: isNow,
      },
      server_time: tunisNow.iso,
      tunis_time: tunisNow.time,
      spaces,
      floor_plans: enrichedPlans,
      summary: {
        total_spaces: spaces.length,
        free_spaces: freeSpaces,
        occupied_spaces: spaces.length - freeSpaces,
        has_floor_plan: enrichedPlans.length > 0,
        total_plan_items: totalPlanItems,
        free_plan_items: freePlanItems,
      },
    });
  } catch (err) {
    console.error('❌ getPublicSpacesLive:', err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  listFloorPlans,
  createFloorPlan,
  updateFloorPlan,
  toggleItemMaintenance,
  deleteFloorPlan,
  getLiveFloorPlanStatus,
  getPublicFloorPlans,
  getPublicSpacesLive,
};

