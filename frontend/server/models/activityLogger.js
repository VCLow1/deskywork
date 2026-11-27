// models/activityLogger.js — Audit log transverse (journal_activite + fallback settings) & garde soft-delete
const { supabaseAdmin } = require('../config/supabase');

const MAX_FALLBACK_LOGS = 120;

async function logActivity({
  tenantId,
  req = null,
  action,
  entityType,
  entityId = null,
  entityLabel = '',
  beforeData = null,
  afterData = null,
  metadata = {},
} = {}) {
  if (!tenantId || !action || !entityType) return null;

  const actorId = req?.user?.id || req?.profile?.id || null;
  const actorName = req?.profile
    ? `${req.profile.prenom || ''} ${req.profile.nom || ''}`.trim() || req.profile.email || 'Administrateur'
    : 'Système';
  const actorRole = req?.profile?.role || 'system';
  const nowIso = new Date().toISOString();

  const row = {
    tenant_id: tenantId,
    actor_id: actorId,
    actor_name: actorName,
    actor_role: actorRole,
    action,
    entity_type: entityType,
    entity_id: entityId != null ? String(entityId) : null,
    entity_label: String(entityLabel || ''),
    before_data: beforeData || null,
    after_data: afterData || null,
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
    created_at: nowIso,
  };

  try {
    const { data, error } = await supabaseAdmin
      .from('journal_activite')
      .insert(row)
      .select()
      .maybeSingle();

    if (!error && data) return data;
    if (error && !/does not exist|relation|schema cache/i.test(error.message || '')) {
      console.warn('journal_activite insert warning:', error.message);
    }
  } catch (_) {}

  // Fallback sûr dans tenants.settings tant que s22_lot2_unified_schema_rls.sql n'est pas exécutée
  try {
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('settings')
      .eq('id', tenantId)
      .maybeSingle();

    const curSettings = tenant?.settings && typeof tenant.settings === 'object' ? tenant.settings : {};
    const prevList = Array.isArray(curSettings.activity_log_fallback) ? curSettings.activity_log_fallback : [];
    const fallbackItem = { id: `LOG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...row };
    const nextList = [fallbackItem, ...prevList].slice(0, MAX_FALLBACK_LOGS);
    await supabaseAdmin
      .from('tenants')
      .update({ settings: { ...curSettings, activity_log_fallback: nextList } })
      .eq('id', tenantId);
    return fallbackItem;
  } catch (_) {
    return null;
  }
}

async function listActivityLogs({ tenantId, action = null, entityType = null, limit = 100 } = {}) {
  if (!tenantId) return [];

  try {
    let q = supabaseAdmin
      .from('journal_activite')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(Math.min(200, Number(limit) || 100));

    if (action) q = q.eq('action', action);
    if (entityType) q = q.eq('entity_type', entityType);

    const { data, error } = await q;
    if (!error && Array.isArray(data)) {
      return data;
    }
  } catch (_) {}

  // Fallback settings
  try {
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('settings')
      .eq('id', tenantId)
      .maybeSingle();

    let rows = Array.isArray(tenant?.settings?.activity_log_fallback) ? tenant.settings.activity_log_fallback : [];
    if (action) rows = rows.filter((r) => r.action === action);
    if (entityType) rows = rows.filter((r) => r.entity_type === entityType);
    return rows.slice(0, Math.min(200, Number(limit) || 100));
  } catch (_) {
    return [];
  }
}

/**
 * Vérifie si un espace ou un membre possède des réservations futures non traitées
 * (statut pending ou confirmed, date_fin > NOW()). Bloque l'archivage le cas échéant.
 */
async function hasFutureUntreatedReservations({ tenantId, espaceId = null, userId = null } = {}) {
  const nowIso = new Date().toISOString();
  try {
    let q = supabaseAdmin
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .in('statut', ['pending', 'confirmed'])
      .gt('date_fin', nowIso);

    if (tenantId) q = q.eq('tenant_id', tenantId);
    if (espaceId) q = q.eq('espace_id', espaceId);
    if (userId) q = q.eq('user_id', userId);

    const { count, error } = await q;
    if (error) return 0;
    return Number(count || 0);
  } catch (_) {
    return 0;
  }
}

module.exports = {
  logActivity,
  listActivityLogs,
  hasFutureUntreatedReservations,
};
