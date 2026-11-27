// controllers/unitesController.js — Gestion des Unités/Postes, statuts & impact réservations futures (LOT 3)
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const { logActivity } = require('../models/activityLogger');
const { loadSpaceUnitsForTenant } = require('../models/bookingAvailability');

const VALID_UNIT_STATUSES = ['disponible', 'non_disponible', 'en_maintenance'];
const VALID_UNIT_TYPES = ['bureau_prive', 'poste_open_space', 'poste_fixe', 'salle'];

function isMissingUnitesSchema(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || err.details || '');
  return code === '42P01' || code === 'PGRST205' || /unites|does not exist|schema cache|could not find/i.test(msg);
}

async function readSettings(tenantId) {
  const { data } = await supabaseAdmin.from('tenants').select('settings').eq('id', tenantId).maybeSingle();
  return data?.settings && typeof data.settings === 'object' ? data.settings : {};
}

async function writeSettingsUnites(tenantId, nextUnites) {
  const cur = await readSettings(tenantId);
  await supabaseAdmin
    .from('tenants')
    .update({ settings: { ...cur, unites: nextUnites }, updated_at: new Date().toISOString() })
    .eq('id', tenantId);
}

/**
 * Synchronise automatiquement le floor_plan_item rattaché à une unité (si présent).
 */
async function syncFloorPlanItemStatus(tenantId, unite, nextUniteStatus) {
  if (!tenantId || !unite) return;
  const fpStatus = nextUniteStatus === 'en_maintenance'
    ? 'maintenance'
    : nextUniteStatus === 'non_disponible'
      ? 'unavailable'
      : 'active';

  try {
    if (unite.floor_plan_item_id) {
      await supabaseAdmin
        .from('floor_plan_items')
        .update({ status: fpStatus })
        .eq('id', unite.floor_plan_item_id)
        .eq('tenant_id', tenantId);
    } else if (unite.espace_id && unite.code) {
      await supabaseAdmin
        .from('floor_plan_items')
        .update({ status: fpStatus })
        .eq('tenant_id', tenantId)
        .eq('space_id', unite.espace_id)
        .ilike('label', unite.code);
    }
  } catch (_) {}

  // Fallback settings floor_plans si existant
  try {
    const settings = await readSettings(tenantId);
    if (Array.isArray(settings.floor_plans) && settings.floor_plans.length > 0) {
      let changed = false;
      const nextPlans = settings.floor_plans.map((pl) => ({
        ...pl,
        items: (pl.items || []).map((it) => {
          const matchById = unite.floor_plan_item_id && it.id === unite.floor_plan_item_id;
          const matchByCode = !unite.floor_plan_item_id
            && it.space_id === unite.espace_id
            && String(it.label || '').trim().toLowerCase() === String(unite.code || '').trim().toLowerCase();
          if (matchById || matchByCode) {
            changed = true;
            return { ...it, status: fpStatus };
          }
          return it;
        }),
      }));
      if (changed) {
        await supabaseAdmin
          .from('tenants')
          .update({ settings: { ...settings, floor_plans: nextPlans }, updated_at: new Date().toISOString() })
          .eq('id', tenantId);
      }
    }
  } catch (_) {}
}

/**
 * Auto-restaure les unités dont la date_retour_auto est dépassée.
 */
async function autoRestoreExpired(tenantId) {
  if (!tenantId) return;
  const nowIso = new Date().toISOString();
  try {
    await supabaseAdmin
      .from('unites')
      .update({ statut: 'disponible', date_retour_auto: null, updated_at: nowIso })
      .eq('tenant_id', tenantId)
      .is('archived_at', null)
      .in('statut', ['non_disponible', 'en_maintenance'])
      .not('date_retour_auto', 'is', null)
      .lte('date_retour_auto', nowIso);
  } catch (_) {}

  try {
    const settings = await readSettings(tenantId);
    if (Array.isArray(settings.unites)) {
      let changed = false;
      const next = settings.unites.map((u) => {
        if (!u.archived_at && u.statut !== 'disponible' && u.date_retour_auto && u.date_retour_auto <= nowIso) {
          changed = true;
          return { ...u, statut: 'disponible', date_retour_auto: null, updated_at: nowIso };
        }
        return u;
      });
      if (changed) await writeSettingsUnites(tenantId, next);
    }
  } catch (_) {}
}

// GET /api/admin/unites
async function listAdminUnites(req, res) {
  try {
    const tid = req.tenantId;
    if (!tid) return res.status(400).json({ error: 'Établissement requis.' });
    const { espace_id, include_archived } = req.query;
    const withArchived = include_archived === 'true' || include_archived === '1';

    await autoRestoreExpired(tid);

    let q = supabaseAdmin
      .from('unites')
      .select('*, espaces(id, nom, type, capacite)')
      .eq('tenant_id', tid)
      .order('code', { ascending: true });
    if (espace_id) q = q.eq('espace_id', espace_id);
    if (!withArchived) q = q.is('archived_at', null);

    const { data, error } = await q;
    if (!error && Array.isArray(data)) {
      return res.json({ unites: data });
    }

    if (!isMissingUnitesSchema(error)) {
      return res.status(400).json({ error: error.message });
    }

    const settings = await readSettings(tid);
    const raw = Array.isArray(settings.unites) ? settings.unites : [];
    const filtered = raw.filter((u) => {
      if (!withArchived && u.archived_at) return false;
      if (espace_id && u.espace_id !== espace_id) return false;
      return true;
    });
    res.json({ unites: filtered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/unites/public — OMET STRICTEMENT motif_interne !
async function listPublicUnites(req, res) {
  try {
    const tenantId = req.query.tenant_id || req.tenantId;
    const espaceId = req.query.espace_id || null;
    if (!tenantId) return res.status(400).json({ error: 'tenant_id requis.' });

    await autoRestoreExpired(tenantId);
    const rawUnits = await loadSpaceUnitsForTenant(supabaseAdmin, tenantId, espaceId);
    const safeUnits = rawUnits.map((u) => ({
      id: u.id,
      tenant_id: u.tenant_id,
      espace_id: u.espace_id,
      code: u.code,
      nom: u.nom,
      type_unite: u.type_unite,
      capacite: u.capacite,
      statut: u.statut,
      date_retour_auto: u.date_retour_auto || null,
      floor_plan_item_id: u.floor_plan_item_id || null,
      // SÉCURITÉ : motif_interne strictement exclu de toute réponse publique/membre
    }));
    res.json({ unites: safeUnits });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/admin/unites — Création unitaire ou en lot (ex: B-01..B-05)
async function createUnite(req, res) {
  try {
    const tid = req.tenantId;
    if (!tid) return res.status(400).json({ error: 'Établissement requis.' });

    const {
      espace_id,
      code,
      nom,
      type_unite = 'poste_open_space',
      capacite = 1,
      floor_plan_item_id = null,
      batch_prefix,
      batch_count,
      batch_start = 1,
    } = req.body || {};

    if (!espace_id) return res.status(400).json({ error: 'espace_id est requis.' });
    const safeType = VALID_UNIT_TYPES.includes(type_unite) ? type_unite : 'poste_open_space';
    const safeCap = Math.max(1, parseInt(capacite, 10) || 1);
    const nowIso = new Date().toISOString();

    const toCreate = [];
    const count = parseInt(batch_count, 10);
    if (batch_prefix && Number.isInteger(count) && count > 0) {
      const start = Math.max(1, parseInt(batch_start, 10) || 1);
      const bounded = Math.min(60, count);
      for (let i = 0; i < bounded; i++) {
        const num = String(start + i).padStart(2, '0');
        const c = `${String(batch_prefix).trim()}-${num}`;
        toCreate.push({
          id: crypto.randomUUID(),
          tenant_id: tid,
          espace_id,
          code: c,
          nom: nom ? `${String(nom).trim()} ${num}` : c,
          type_unite: safeType,
          capacite: safeCap,
          statut: 'disponible',
          motif_interne: null,
          date_retour_auto: null,
          floor_plan_item_id: null,
          archived_at: null,
          created_at: nowIso,
          updated_at: nowIso,
        });
      }
    } else {
      if (!code && !nom) {
        return res.status(400).json({ error: 'Le code ou le nom de l\'unité est requis.' });
      }
      const cleanCode = String(code || nom).trim().slice(0, 40);
      toCreate.push({
        id: crypto.randomUUID(),
        tenant_id: tid,
        espace_id,
        code: cleanCode,
        nom: String(nom || code).trim().slice(0, 100),
        type_unite: safeType,
        capacite: safeCap,
        statut: 'disponible',
        motif_interne: null,
        date_retour_auto: null,
        floor_plan_item_id: floor_plan_item_id || null,
        archived_at: null,
        created_at: nowIso,
        updated_at: nowIso,
      });
    }

    const dbPayloads = toCreate.map(({ id, tenant_id, espace_id: eid, code: c, nom: n, type_unite: tu, capacite: cap, statut, floor_plan_item_id: fp, created_at, updated_at }) => ({
      id,
      tenant_id,
      espace_id: eid,
      code: c,
      nom: n,
      type_unite: tu,
      capacite: cap,
      statut,
      floor_plan_item_id: fp,
      created_at,
      updated_at,
    }));

    const { data, error } = await supabaseAdmin.from('unites').insert(dbPayloads).select('*');
    let createdRows = data;

    if (error && isMissingUnitesSchema(error)) {
      const settings = await readSettings(tid);
      const existing = Array.isArray(settings.unites) ? settings.unites : [];
      await writeSettingsUnites(tid, [...existing, ...toCreate]);
      createdRows = toCreate;
    } else if (error) {
      return res.status(400).json({ error: error.message });
    }

    await logActivity({
      tenantId: tid,
      req,
      action: 'creation',
      entityType: 'unite',
      entityId: createdRows[0]?.id,
      entityLabel: createdRows.length > 1 ? `${createdRows.length} unités (${createdRows[0].code}…)` : createdRows[0]?.code,
      afterData: { count: createdRows.length, espace_id },
    });

    res.status(201).json({
      unite: createdRows[0],
      unites: createdRows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// PATCH /api/admin/unites/:id
async function updateUnite(req, res) {
  try {
    const tid = req.tenantId;
    const { id } = req.params;
    const { code, nom, type_unite, capacite, floor_plan_item_id } = req.body || {};
    const nowIso = new Date().toISOString();

    const patch = { updated_at: nowIso };
    if (code !== undefined) patch.code = String(code).trim();
    if (nom !== undefined) patch.nom = String(nom).trim();
    if (type_unite !== undefined && VALID_UNIT_TYPES.includes(type_unite)) patch.type_unite = type_unite;
    if (capacite !== undefined) patch.capacite = Math.max(1, parseInt(capacite, 10) || 1);
    if (floor_plan_item_id !== undefined) patch.floor_plan_item_id = floor_plan_item_id || null;

    const { data, error } = await supabaseAdmin
      .from('unites')
      .update(patch)
      .eq('id', id)
      .eq('tenant_id', tid)
      .select('*')
      .maybeSingle();

    let updated = data;
    if (error && isMissingUnitesSchema(error)) {
      const settings = await readSettings(tid);
      const list = Array.isArray(settings.unites) ? settings.unites : [];
      const next = list.map((u) => (u.id === id ? { ...u, ...patch } : u));
      updated = next.find((u) => u.id === id);
      if (!updated) return res.status(404).json({ error: 'Unité introuvable.' });
      await writeSettingsUnites(tid, next);
    } else if (error) {
      return res.status(400).json({ error: error.message });
    } else if (!updated) {
      return res.status(404).json({ error: 'Unité introuvable.' });
    }

    await logActivity({
      tenantId: tid,
      req,
      action: 'modification',
      entityType: 'unite',
      entityId: id,
      entityLabel: updated.code || updated.nom,
      afterData: patch,
    });

    res.json({ unite: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * Récupère une unité (SQL ou fallback settings).
 */
async function loadSingleUnite(tenantId, uniteId) {
  const { data, error } = await supabaseAdmin
    .from('unites')
    .select('*')
    .eq('id', uniteId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (!error) return { unite: data, source: 'sql' };
  if (!isMissingUnitesSchema(error)) throw error;

  const settings = await readSettings(tenantId);
  const found = (Array.isArray(settings.unites) ? settings.unites : []).find((u) => u.id === uniteId) || null;
  return { unite: found, source: 'settings' };
}

/**
 * Récupère les réservations futures non traitées impactées par la fermeture/maintenance d'une unité.
 */
async function findImpactedFutureBookings(tenantId, unite) {
  const nowIso = new Date().toISOString();
  let resQ = supabaseAdmin
    .from('reservations')
    .select('id, user_id, guest_id, espace_id, unite_id, date_debut, date_fin, statut, montant_ttc, montant_total, notes, profiles!user_id(id, nom, prenom, email, telephone), guests(id, nom, prenom, email, telephone)')
    .eq('tenant_id', tenantId)
    .eq('espace_id', unite.espace_id)
    .gt('date_fin', nowIso)
    .in('statut', ['pending', 'confirmed', 'en_attente_confirmation'])
    .order('date_debut', { ascending: true });

  let { data, error } = await resQ;
  if (error && /column|relationship/i.test(error.message || '')) {
    const fb = await supabaseAdmin
      .from('reservations')
      .select('id, user_id, espace_id, date_debut, date_fin, statut, notes')
      .eq('tenant_id', tenantId)
      .eq('espace_id', unite.espace_id)
      .gt('date_fin', nowIso)
      .in('statut', ['pending', 'confirmed'])
      .order('date_debut', { ascending: true });
    data = fb.data || [];
  }

  return (data || []).filter((r) => {
    if (r.archived_at) return false;
    if (r.unite_id) return r.unite_id === unite.id;
    // Si aucune unité spécifique sur une réservation d'un espace exclusif, elle est impactée
    if (unite.type_unite === 'bureau_prive' || unite.type_unite === 'salle') {
      return !unite.floor_plan_item_id || !r.floor_plan_item_id || r.floor_plan_item_id === unite.floor_plan_item_id;
    }
    if (unite.floor_plan_item_id && r.floor_plan_item_id) {
      return r.floor_plan_item_id === unite.floor_plan_item_id;
    }
    return false;
  });
}

// POST /api/admin/unites/:id/status — Changement statut + contrôle & résolution réservations futures
async function changeUniteStatus(req, res) {
  try {
    const tid = req.tenantId;
    const { id } = req.params;
    const {
      statut,
      motif_interne = '',
      date_retour_auto = null,
      resolutions = [],
    } = req.body || {};

    if (!VALID_UNIT_STATUSES.includes(statut)) {
      return res.status(400).json({ error: 'Statut invalide (disponible, non_disponible ou en_maintenance).' });
    }

    const { unite, source } = await loadSingleUnite(tid, id);
    if (!unite || unite.archived_at) {
      return res.status(404).json({ error: 'Unité introuvable.' });
    }

    const impacted = statut !== 'disponible'
      ? await findImpactedFutureBookings(tid, unite)
      : [];

    if (impacted.length > 0) {
      const resolutionMap = new Map((Array.isArray(resolutions) ? resolutions : []).map((r) => [r.reservation_id, r]));
      const unresolved = impacted.filter((b) => {
        const resChoice = resolutionMap.get(b.id);
        if (!resChoice) return true;
        if (resChoice.action === 'move') return !resChoice.target_unite_id;
        if (resChoice.action === 'cancel') return !String(resChoice.motif || '').trim();
        return true;
      });

      if (unresolved.length > 0) {
        const allSpaceUnits = await loadSpaceUnitsForTenant(supabaseAdmin, tid, unite.espace_id);
        const availableUnits = allSpaceUnits.filter((u) => u.id !== unite.id && u.statut === 'disponible' && !u.archived_at);
        return res.status(409).json({
          code: 'UNIT_HAS_FUTURE_BOOKINGS',
          error: `Cette unité possède ${impacted.length} réservation(s) future(s). Vous devez les déplacer ou les annuler avant de changer le statut.`,
          impacted_bookings: impacted,
          available_units: availableUnits,
        });
      }

      // Exécuter toutes les résolutions (déplacer ou annuler)
      for (const b of impacted) {
        const resChoice = resolutionMap.get(b.id);
        if (resChoice.action === 'move') {
          const { unite: targetU } = await loadSingleUnite(tid, resChoice.target_unite_id);
          if (!targetU || targetU.statut !== 'disponible') {
            return res.status(409).json({ error: `L'unité cible pour la réservation ${b.id} n'est pas disponible.` });
          }
          const patch = {
            unite_id: targetU.id,
            espace_id: targetU.espace_id,
            ...(targetU.floor_plan_item_id ? { floor_plan_item_id: targetU.floor_plan_item_id } : {}),
          };
          const { error: mvErr } = await supabaseAdmin.from('reservations').update(patch).eq('id', b.id);
          if (mvErr && /column/i.test(mvErr.message || '')) {
            await supabaseAdmin.from('reservations').update({ espace_id: targetU.espace_id }).eq('id', b.id);
          }
          await logActivity({
            tenantId: tid,
            req,
            action: 'deplacement',
            entityType: 'reservation',
            entityId: b.id,
            entityLabel: `Déplacement suite maintenance ${unite.code} → ${targetU.code}`,
            beforeData: { unite_id: unite.id },
            afterData: { unite_id: targetU.id },
          });
        } else if (resChoice.action === 'cancel') {
          const cancelPatch = {
            statut: 'cancelled',
            motif_annulation: String(resChoice.motif || `Unité ${unite.code} indisponible`).trim(),
          };
          const { error: cnErr } = await supabaseAdmin.from('reservations').update(cancelPatch).eq('id', b.id);
          if (cnErr && /column/i.test(cnErr.message || '')) {
            await supabaseAdmin.from('reservations').update({ statut: 'cancelled' }).eq('id', b.id);
          }
          if (b.user_id) {
            await supabaseAdmin.from('notifications').insert({
              user_id: b.user_id,
              type: 'annulation_reservation',
              canal: 'Dashboard',
              message: `Votre réservation du ${new Date(b.date_debut).toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis' })} a été annulée : ${cancelPatch.motif_annulation}`,
            }).catch(() => {});
          }
          await logActivity({
            tenantId: tid,
            req,
            action: 'annulation',
            entityType: 'reservation',
            entityId: b.id,
            entityLabel: `Annulation suite statut unité ${unite.code}`,
            afterData: cancelPatch,
          });
        }
      }
    }

    const nowIso = new Date().toISOString();
    const statusPatch = {
      statut,
      motif_interne: statut === 'disponible' ? null : (String(motif_interne || '').trim() || null),
      date_retour_auto: statut === 'disponible' || !date_retour_auto ? null : new Date(date_retour_auto).toISOString(),
      updated_at: nowIso,
    };

    let updated = { ...unite, ...statusPatch };
    if (source === 'sql') {
      const { data, error } = await supabaseAdmin
        .from('unites')
        .update(statusPatch)
        .eq('id', id)
        .eq('tenant_id', tid)
        .select('*')
        .single();
      if (error) return res.status(400).json({ error: error.message });
      updated = data;
    } else {
      const settings = await readSettings(tid);
      const list = Array.isArray(settings.unites) ? settings.unites : [];
      const next = list.map((u) => (u.id === id ? updated : u));
      await writeSettingsUnites(tid, next);
    }

    await syncFloorPlanItemStatus(tid, updated, statut);

    await logActivity({
      tenantId: tid,
      req,
      action: 'changement_statut',
      entityType: 'unite',
      entityId: id,
      entityLabel: `${updated.code} → ${statut}`,
      beforeData: { statut: unite.statut },
      afterData: { statut, motif_interne: statusPatch.motif_interne, date_retour_auto: statusPatch.date_retour_auto, resolved_bookings: impacted.length },
    });

    res.json({
      unite: updated,
      resolved_count: impacted.length,
      message: `Statut de ${updated.code || updated.nom} mis à jour (${statut}).`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/admin/unites/:id/archive
async function archiveUnite(req, res) {
  try {
    const tid = req.tenantId;
    const { id } = req.params;
    const { unite, source } = await loadSingleUnite(tid, id);
    if (!unite) return res.status(404).json({ error: 'Unité introuvable.' });

    const impacted = await findImpactedFutureBookings(tid, unite);
    if (impacted.length > 0) {
      return res.status(409).json({
        error: `Impossible d'archiver ${unite.code} : ${impacted.length} réservation(s) future(s) active(s).`,
        impacted_bookings: impacted,
      });
    }

    const nowIso = new Date().toISOString();
    const archPatch = { archived_at: nowIso, archived_by: req.user?.id || null, updated_at: nowIso };
    if (source === 'sql') {
      await supabaseAdmin.from('unites').update(archPatch).eq('id', id).eq('tenant_id', tid);
    } else {
      const settings = await readSettings(tid);
      const next = (settings.unites || []).map((u) => (u.id === id ? { ...u, ...archPatch } : u));
      await writeSettingsUnites(tid, next);
    }

    await logActivity({
      tenantId: tid,
      req,
      action: 'archivage',
      entityType: 'unite',
      entityId: id,
      entityLabel: unite.code || unite.nom,
    });

    res.json({ message: 'Unité archivée.', archived_at: nowIso });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/admin/unites/:id/restore
async function restoreUnite(req, res) {
  try {
    const tid = req.tenantId;
    const { id } = req.params;
    const { unite, source } = await loadSingleUnite(tid, id);
    if (!unite) return res.status(404).json({ error: 'Unité introuvable.' });

    const nowIso = new Date().toISOString();
    const resPatch = { archived_at: null, archived_by: null, updated_at: nowIso };
    if (source === 'sql') {
      await supabaseAdmin.from('unites').update(resPatch).eq('id', id).eq('tenant_id', tid);
    } else {
      const settings = await readSettings(tid);
      const next = (settings.unites || []).map((u) => (u.id === id ? { ...u, ...resPatch } : u));
      await writeSettingsUnites(tid, next);
    }

    await logActivity({
      tenantId: tid,
      req,
      action: 'restauration',
      entityType: 'unite',
      entityId: id,
      entityLabel: unite.code || unite.nom,
    });

    res.json({ message: 'Unité restaurée.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  listAdminUnites,
  listPublicUnites,
  createUnite,
  updateUnite,
  changeUniteStatus,
  archiveUnite,
  restoreUnite,
};
