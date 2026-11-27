// models/bookingHolds.js — Verrou temporaire 5 min lors du passage à l'étape 3 (RM-08)
const crypto = require('crypto');

const HOLD_TTL_SECONDS = 300; // 5 minutes
const memoryHolds = new Map();

function isOverlapping(sA, eA, sB, eB) {
  const a1 = new Date(sA).getTime();
  const a2 = new Date(eA).getTime();
  const b1 = new Date(sB).getTime();
  const b2 = new Date(eB).getTime();
  if (![a1, a2, b1, b2].every(Number.isFinite)) return false;
  return a1 < b2 && a2 > b1;
}

function pruneExpiredHolds(list, nowMs) {
  return (Array.isArray(list) ? list : []).filter(
    (h) => h && h.expires_at && new Date(h.expires_at).getTime() > nowMs
  );
}

async function listActiveHolds(
  supabaseAdmin,
  {
    tenantId = null,
    espaceId = null,
    dateDebut = null,
    dateFin = null,
    excludeUserId = null,
    excludeHoldId = null,
    now = new Date(),
  } = {}
) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowIso = nowDate.toISOString();
  const nowMs = nowDate.getTime();
  let rows = [];
  let loadedFromSql = false;

  try {
    let q = supabaseAdmin
      .from('booking_holds')
      .select('*')
      .gt('expires_at', nowIso);
    if (tenantId) q = q.eq('tenant_id', tenantId);
    if (espaceId) q = q.eq('espace_id', espaceId);
    const { data, error } = await q;
    if (!error && Array.isArray(data)) {
      rows = data;
      loadedFromSql = true;
    }
  } catch (_) {}

  if (!loadedFromSql) {
    if (tenantId) {
      try {
        const { data: tRow } = await supabaseAdmin
          .from('tenants')
          .select('settings')
          .eq('id', tenantId)
          .maybeSingle();
        const raw = tRow?.settings?.booking_holds;
        rows = pruneExpiredHolds(raw, nowMs);
      } catch (_) {}
    }
    for (const h of memoryHolds.values()) {
      if (new Date(h.expires_at).getTime() <= nowMs) {
        memoryHolds.delete(h.id);
        continue;
      }
      if (tenantId && h.tenant_id !== tenantId) continue;
      if (!rows.some((r) => r.id === h.id)) rows.push(h);
    }
  }

  return rows.filter((h) => {
    if (espaceId && h.espace_id !== espaceId) return false;
    if (excludeUserId && h.user_id === excludeUserId) return false;
    if (excludeHoldId && h.id === excludeHoldId) return false;
    if (dateDebut && dateFin && !isOverlapping(h.date_debut, h.date_fin, dateDebut, dateFin)) return false;
    return true;
  });
}

async function createBookingHold(
  supabaseAdmin,
  {
    tenantId,
    espaceId,
    uniteId = null,
    floorPlanItemId = null,
    userId,
    dateDebut,
    dateFin,
    now = new Date(),
  }
) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();
  const nowIso = nowDate.toISOString();
  const expiresAtIso = new Date(nowMs + HOLD_TTL_SECONDS * 1000).toISOString();
  const holdId = crypto.randomUUID();

  const holdRecord = {
    id: holdId,
    tenant_id: tenantId,
    espace_id: espaceId,
    unite_id: uniteId || null,
    floor_plan_item_id: floorPlanItemId || null,
    user_id: userId,
    date_debut: new Date(dateDebut).toISOString(),
    date_fin: new Date(dateFin).toISOString(),
    expires_at: expiresAtIso,
    created_at: nowIso,
  };

  let savedSql = false;
  try {
    // Nettoyer les verrous expirés et l'éventuel verrou précédent du même utilisateur sur cet espace
    await supabaseAdmin.from('booking_holds').delete().lte('expires_at', nowIso);
    if (userId) {
      await supabaseAdmin
        .from('booking_holds')
        .delete()
        .eq('user_id', userId)
        .eq('espace_id', espaceId);
    }
    const { error } = await supabaseAdmin.from('booking_holds').insert(holdRecord);
    if (!error) savedSql = true;
  } catch (_) {}

  if (!savedSql) {
    for (const [k, v] of memoryHolds.entries()) {
      if (new Date(v.expires_at).getTime() <= nowMs || (v.user_id === userId && v.espace_id === espaceId)) {
        memoryHolds.delete(k);
      }
    }
    memoryHolds.set(holdId, holdRecord);
    if (tenantId) {
      try {
        const { data: tRow } = await supabaseAdmin
          .from('tenants')
          .select('settings')
          .eq('id', tenantId)
          .maybeSingle();
        const cur = tRow?.settings && typeof tRow.settings === 'object' ? tRow.settings : {};
        const cleaned = pruneExpiredHolds(cur.booking_holds, nowMs).filter(
          (h) => !(h.user_id === userId && h.espace_id === espaceId)
        );
        await supabaseAdmin
          .from('tenants')
          .update({ settings: { ...cur, booking_holds: [holdRecord, ...cleaned].slice(0, 80) } })
          .eq('id', tenantId);
      } catch (_) {}
    }
  }

  return {
    hold_id: holdId,
    hold: holdRecord,
    expires_at: expiresAtIso,
    server_now: nowIso,
    seconds_remaining: HOLD_TTL_SECONDS,
  };
}

async function releaseBookingHold(supabaseAdmin, { holdId, userId = null, tenantId = null }) {
  if (!holdId) return { released: false };
  memoryHolds.delete(holdId);

  try {
    let q = supabaseAdmin.from('booking_holds').delete().eq('id', holdId);
    if (userId) q = q.eq('user_id', userId);
    await q;
  } catch (_) {}

  if (tenantId) {
    try {
      const { data: tRow } = await supabaseAdmin
        .from('tenants')
        .select('settings')
        .eq('id', tenantId)
        .maybeSingle();
      const cur = tRow?.settings && typeof tRow.settings === 'object' ? tRow.settings : {};
      if (Array.isArray(cur.booking_holds)) {
        const next = cur.booking_holds.filter((h) => h.id !== holdId);
        await supabaseAdmin
          .from('tenants')
          .update({ settings: { ...cur, booking_holds: next } })
          .eq('id', tenantId);
      }
    } catch (_) {}
  }

  return { released: true };
}

module.exports = {
  HOLD_TTL_SECONDS,
  listActiveHolds,
  createBookingHold,
  releaseBookingHold,
};
