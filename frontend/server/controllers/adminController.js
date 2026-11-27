// controllers/adminController.js — MODULE ADMIN : Tenant, Espaces, Membres, Ressources, Audit (LOT 2)
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const { applyTenantFilter } = require('../middleware/guards');
const {
  SAAS_PACKS,
  PACK_LIST,
  DEFAULT_TVA_PCT,
  resolveTenantPack,
  hasPackFeature,
} = require('../config/deskyworkPacks');
const { roundMillime, computeTTC, computeHTFromTTC } = require('../models/pricingMath');
const {
  logActivity,
  listActivityLogs,
  hasFutureUntreatedReservations,
} = require('../models/activityLogger');
const { isStaffRole } = require('../models/kpisCalculator');
const {
  allocateDocumentNumber,
  getTenantNumberingConfig,
  updateNumberingSettings,
} = require('../models/numbering');
const {
  PERMISSION_DEFINITIONS,
  HARD_LOCKED_KEYS_FOR_STAFF,
  mergeRoleMatrix,
  evaluatePermission,
} = require('../models/permissionsMatrix');
const { loadTenantRolesMatrix } = require('../middleware/requirePermission');
const { getUnpaidBlockingConfig } = require('../models/financeHelpers');
const { generateInvoicePDF } = require('../utils/generateInvoicePdf');
const { runLot4AutomationsForTenant } = require('../cron/lot4Automations');

function isMissingSchemaError(err) {
  const msg = String(err?.message || '').toLowerCase();
  const code = String(err?.code || '');
  return (
    code === '42703' ||
    code === '42P01' ||
    code === 'PGRST204' ||
    code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the') ||
    msg.includes('schema cache')
  );
}

async function readTenantSettings(tid) {
  if (!tid) return {};
  const { data } = await supabaseAdmin.from('tenants').select('settings').eq('id', tid).maybeSingle();
  return (data && data.settings && typeof data.settings === 'object') ? { ...data.settings } : {};
}

async function writeTenantSettingsKey(tid, key, value) {
  const cur = await readTenantSettings(tid);
  const next = { ...cur, [key]: value };
  await supabaseAdmin.from('tenants').update({ settings: next, updated_at: new Date().toISOString() }).eq('id', tid);
  return next;
}

// ── GET /api/admin/tenant ─────────────────────────────────────────────────
async function getTenant(req, res) {
  if (!req.tenantId) return res.status(404).json({ error: 'Aucun coworking associé à votre compte.' });

  const { data: tenant, error } = await supabaseAdmin
    .from('tenants')
    .select('*')
    .eq('id', req.tenantId)
    .single();

  if (error || !tenant) return res.status(404).json({ error: 'Coworking introuvable.' });

  const { count: spaceCount } = await supabaseAdmin
    .from('espaces')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', req.tenantId);

  res.json({
    tenant,
    space_count: spaceCount || 0,
    onboarding_completed: tenant.settings?.onboarding_completed === true,
    module_formations_actif: tenant.settings?.module_formations_actif !== false,
  });
}

// ── PATCH /api/admin/tenant ───────────────────────────────────────────────
async function updateTenant(req, res) {
  if (!req.tenantId) return res.status(404).json({ error: 'Aucun coworking associé à votre compte.' });

  const allowed = ['nom', 'description', 'adresse', 'ville', 'pays', 'email', 'telephone', 'site_web', 'logo_url', 'cover_url'];
  const updates = { updated_at: new Date().toISOString() };

  for (const field of allowed) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  // Fusion sécurisée de settings (module formations, TVA par défaut, taxes, intégrations, etc.)
  const hasSettingsPayload =
    req.body.settings !== undefined ||
    req.body.activite !== undefined ||
    req.body.tarif_depassement_heure !== undefined ||
    req.body.auto_confirmation !== undefined ||
    req.body.gallery_photos !== undefined ||
    req.body.equipements !== undefined ||
    req.body.domiciliation !== undefined ||
    req.body.module_formations_actif !== undefined ||
    req.body.tva_defaut_pct !== undefined ||
    req.body.taxes_facturation !== undefined ||
    req.body.finance_rules !== undefined ||
    req.body.numbering !== undefined ||
    req.body.integrations !== undefined;

  let prevSettingsSnapshot = null;
  if (hasSettingsPayload) {
    const { data: curTenant } = await supabaseAdmin.from('tenants').select('settings').eq('id', req.tenantId).maybeSingle();
    const curSettings = (curTenant && curTenant.settings && typeof curTenant.settings === 'object') ? curTenant.settings : {};
    prevSettingsSnapshot = curSettings;
    const nextSettings = { ...curSettings, ...(req.body.settings && typeof req.body.settings === 'object' ? req.body.settings : {}) };
    if (['coworking', 'centre_formation', 'mixte'].includes(req.body.activite)) nextSettings.activite = req.body.activite;
    if (req.body.tarif_depassement_heure !== undefined) nextSettings.tarif_depassement_heure = Number(req.body.tarif_depassement_heure) || 0;
    if (req.body.auto_confirmation !== undefined) nextSettings.auto_confirmation = Boolean(req.body.auto_confirmation);
    if (req.body.module_formations_actif !== undefined) nextSettings.module_formations_actif = Boolean(req.body.module_formations_actif);
    if (req.body.tva_defaut_pct !== undefined) nextSettings.tva_defaut_pct = Number(req.body.tva_defaut_pct) >= 0 ? Number(req.body.tva_defaut_pct) : DEFAULT_TVA_PCT;
    if (req.body.taxes_facturation && typeof req.body.taxes_facturation === 'object') {
      const tf = { ...(curSettings.taxes_facturation || {}), ...req.body.taxes_facturation };
      const mf = tf.matricule_fiscal || tf.matricule_fiscale || '';
      if (mf) {
        tf.matricule_fiscal = mf;
        tf.matricule_fiscale = mf;
      }
      nextSettings.taxes_facturation = tf;
    }
    if (req.body.finance_rules && typeof req.body.finance_rules === 'object') {
      nextSettings.finance_rules = {
        ...getUnpaidBlockingConfig(curSettings),
        ...req.body.finance_rules,
      };
    }
    if (req.body.integrations && typeof req.body.integrations === 'object') {
      nextSettings.integrations = { ...(curSettings.integrations || {}), ...req.body.integrations };
    }
    if (Array.isArray(req.body.gallery_photos)) nextSettings.gallery_photos = req.body.gallery_photos.filter(Boolean);
    if (Array.isArray(req.body.equipements)) nextSettings.equipements = req.body.equipements.filter(Boolean);
    if (req.body.domiciliation !== undefined) {
      nextSettings.domiciliation = {
        actif: Boolean(req.body.domiciliation?.actif),
        tarif_mensuel: Number(req.body.domiciliation?.tarif_mensuel) || 0,
        tarif_annuel: Number(req.body.domiciliation?.tarif_annuel) || 0,
        description: String(req.body.domiciliation?.description || '').trim(),
      };
    }
    updates.settings = nextSettings;
  }

  if (Object.keys(updates).length === 1) return res.status(400).json({ error: 'Aucune mise à jour fournie.' });

  const { data, error } = await supabaseAdmin
    .from('tenants')
    .update(updates)
    .eq('id', req.tenantId)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  if (req.body.numbering && typeof req.body.numbering === 'object') {
    try {
      const updatedNumbering = await updateNumberingSettings(supabaseAdmin, req.tenantId, req.body.numbering);
      data.settings = { ...(data.settings || {}), numbering: updatedNumbering };
    } catch (_) {}
  } else if (req.body.taxes_facturation?.prefixe_facture) {
    try {
      const updatedNumbering = await updateNumberingSettings(supabaseAdmin, req.tenantId, {
        invoice_prefix: req.body.taxes_facturation.prefixe_facture,
      });
      data.settings = { ...(data.settings || {}), numbering: updatedNumbering };
    } catch (_) {}
  }

  await logActivity({
    tenantId: req.tenantId,
    req,
    action: 'modification',
    entityType: 'etablissement',
    entityId: req.tenantId,
    entityLabel: "Paramètres de l'établissement",
    beforeData: prevSettingsSnapshot,
    afterData: updates.settings || updates,
  });

  res.json({ tenant: data });
}

// ── POST /api/admin/espaces ───────────────────────────────────────────────
async function createEspace(req, res) {
  if (!req.tenantId) return res.status(404).json({ error: 'Aucun coworking associé à votre compte.' });

  const {
    nom, type, capacite,
    tarif_horaire, tarif_journalier, tarif_mensuel,
    tarif_horaire_ht, tarif_journalier_ht, tarif_mensuel_ht, tva_pct, tarifs_actifs,
    description, equipements, horaires, statut, actif, photo_url, photos_urls,
  } = req.body;
  if (!nom || !type || !capacite) {
    return res.status(400).json({ error: 'Nom, type et capacité sont requis.' });
  }

  const validTypes = ['open_space', 'private_office', 'meeting_room', 'training_room', 'event_space', 'hot_desk', 'dedicated_desk'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: "Type d'espace invalide." });
  }

  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('limite_espaces, settings, plan, slug, id')
    .eq('id', req.tenantId)
    .single();

  const pack = resolveTenantPack(tenant);
  const { count: currentCount } = await supabaseAdmin
    .from('espaces')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', req.tenantId);

  const maxEspaces = pack.max_espaces ?? tenant?.limite_espaces ?? 10;
  if (maxEspaces && currentCount >= maxEspaces) {
    return res.status(400).json({ error: `Limite du pack ${pack.name} atteinte (${maxEspaces} espaces max).` });
  }

  const tvaRate = tva_pct !== undefined ? Number(tva_pct) : Number(tenant?.settings?.tva_defaut_pct ?? DEFAULT_TVA_PCT);
  const hHT = tarif_horaire_ht !== undefined ? roundMillime(tarif_horaire_ht) : computeHTFromTTC(tarif_horaire || 0, tvaRate);
  const jHT = tarif_journalier_ht !== undefined ? roundMillime(tarif_journalier_ht) : computeHTFromTTC(tarif_journalier || 0, tvaRate);
  const mHT = tarif_mensuel_ht !== undefined ? roundMillime(tarif_mensuel_ht) : computeHTFromTTC(tarif_mensuel || 0, tvaRate);
  const hTTC = tarif_horaire !== undefined ? roundMillime(tarif_horaire) : computeTTC(hHT, tvaRate);
  const jTTC = tarif_journalier !== undefined ? roundMillime(tarif_journalier) : computeTTC(jHT, tvaRate);
  const mTTC = tarif_mensuel !== undefined ? roundMillime(tarif_mensuel) : computeTTC(mHT, tvaRate);

  const isActif = statut !== undefined ? statut === 'actif' : (actif !== undefined ? Boolean(actif) : true);
  const insertData = {
    nom: String(nom).trim(),
    type,
    capacite: parseInt(capacite, 10),
    tarif_horaire: hTTC,
    tarif_journalier: jTTC,
    tarif_mensuel: mTTC,
    tarif_horaire_ht: hHT,
    tarif_journalier_ht: jHT,
    tarif_mensuel_ht: mHT,
    tva_pct: tvaRate,
    tarifs_actifs: tarifs_actifs && typeof tarifs_actifs === 'object'
      ? tarifs_actifs
      : { horaire: true, journalier: jHT > 0, mensuel: mHT > 0 },
    description: description || null,
    horaires: horaires || '08:00 - 20:00',
    statut: statut || (isActif ? 'actif' : 'inactif'),
    actif: isActif,
    equipements: Array.isArray(equipements) ? equipements : [],
    tenant_id: req.tenantId,
  };
  if (photo_url !== undefined) insertData.photo_url = photo_url;
  if (photos_urls !== undefined) insertData.photos_urls = photos_urls;

  let { data, error } = await supabaseAdmin
    .from('espaces')
    .insert(insertData)
    .select()
    .single();

  if (error && isMissingSchemaError(error)) {
    const fallbackData = {
      nom: String(nom).trim(),
      type,
      capacite: parseInt(capacite, 10),
      tarif_horaire: hTTC,
      tarif_journalier: jTTC,
      tarif_mensuel: mTTC,
      horaires: horaires || '08:00 - 20:00',
      description: description || null,
      actif: isActif,
      statut: statut || (isActif ? 'actif' : 'inactif'),
      tenant_id: req.tenantId,
    };
    if (photo_url) fallbackData.photo_url = photo_url;
    if (Array.isArray(equipements)) fallbackData.equipements = equipements;
    ({ data, error } = await supabaseAdmin.from('espaces').insert(fallbackData).select().single());
  }

  if (error) return res.status(400).json({ error: error.message });

  await logActivity({
    supabaseAdmin,
    tenantId: req.tenantId,
    user: req.user,
    action: 'creation',
    entiteType: 'espace',
    entiteId: data.id,
    details: `Création de l'espace "${data.nom}" (${data.type})`,
    apres: data,
  });

  res.status(201).json({ espace: data });
}

// ── PATCH /api/admin/espaces/:id ──────────────────────────────────────────
async function updateEspace(req, res) {
  if (!req.tenantId) return res.status(404).json({ error: 'Aucun coworking associé à votre compte.' });

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('espaces')
    .select('*')
    .eq('id', req.params.id)
    .eq('tenant_id', req.tenantId)
    .single();

  if (fetchErr || !existing) return res.status(404).json({ error: 'Espace introuvable.' });

  const allowed = [
    'nom', 'type', 'capacite', 'tarif_horaire', 'tarif_journalier', 'tarif_mensuel',
    'tarif_horaire_ht', 'tarif_journalier_ht', 'tarif_mensuel_ht', 'tva_pct', 'tarifs_actifs',
    'description', 'equipements', 'horaires', 'statut', 'actif', 'photo_url', 'photos_urls',
  ];
  const updates = {};
  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      if (['tarif_horaire', 'tarif_journalier', 'tarif_mensuel', 'tarif_horaire_ht', 'tarif_journalier_ht', 'tarif_mensuel_ht', 'tva_pct'].includes(field)) {
        updates[field] = roundMillime(req.body[field]);
      } else if (field === 'capacite') {
        updates[field] = parseInt(req.body[field], 10);
      } else if (field === 'statut') {
        updates[field] = req.body[field];
        updates.actif = req.body[field] === 'actif';
      } else {
        updates[field] = req.body[field];
      }
    }
  }

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Aucune mise à jour fournie.' });

  let { data, error } = await supabaseAdmin
    .from('espaces')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error && isMissingSchemaError(error)) {
    const safeUpdates = { ...updates };
    delete safeUpdates.tarif_horaire_ht;
    delete safeUpdates.tarif_journalier_ht;
    delete safeUpdates.tarif_mensuel_ht;
    delete safeUpdates.tva_pct;
    delete safeUpdates.tarifs_actifs;
    ({ data, error } = await supabaseAdmin.from('espaces').update(safeUpdates).eq('id', req.params.id).select().single());
  }

  if (error) return res.status(400).json({ error: error.message });

  await logActivity({
    supabaseAdmin,
    tenantId: req.tenantId,
    user: req.user,
    action: 'modification',
    entiteType: 'espace',
    entiteId: data.id,
    details: `Modification de l'espace "${data.nom}"`,
    avant: existing,
    apres: updates,
  });

  res.json({ espace: data });
}

// ── DELETE /api/admin/espaces/:id & POST /api/admin/espaces/:id/archive ──
// LOT 2 : Aucune suppression physique — soft-delete uniquement (bloqué si réservations futures)
async function archiveEspace(req, res) {
  if (!req.tenantId) return res.status(404).json({ error: 'Aucun coworking associé à votre compte.' });

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('espaces')
    .select('id, nom, statut, actif')
    .eq('id', req.params.id)
    .eq('tenant_id', req.tenantId)
    .single();

  if (fetchErr || !existing) return res.status(404).json({ error: 'Espace introuvable.' });

  const check = await hasFutureUntreatedReservations({
    supabaseAdmin,
    tenantId: req.tenantId,
    espaceId: req.params.id,
  });
  if (check.blocked) {
    return res.status(409).json({
      error: `Impossible d'archiver "${existing.nom}" : ${check.count} réservation(s) future(s) non traitée(s) y sont rattachées.`,
      future_count: check.count,
    });
  }

  const nowIso = new Date().toISOString();
  let { data, error } = await supabaseAdmin
    .from('espaces')
    .update({ archived_at: nowIso, archived_by: req.user?.id || null, actif: false, statut: 'inactif' })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error && isMissingSchemaError(error)) {
    ({ data, error } = await supabaseAdmin
      .from('espaces')
      .update({ actif: false, statut: 'inactif' })
      .eq('id', req.params.id)
      .select()
      .single());
  }

  if (error) return res.status(400).json({ error: error.message });

  const settings = await readTenantSettings(req.tenantId);
  const archivedIds = Array.from(new Set([...(Array.isArray(settings.archived_espaces) ? settings.archived_espaces : []), req.params.id]));
  await writeTenantSettingsKey(req.tenantId, 'archived_espaces', archivedIds);

  await logActivity({
    supabaseAdmin,
    tenantId: req.tenantId,
    user: req.user,
    action: 'archivage',
    entiteType: 'espace',
    entiteId: req.params.id,
    details: `Archivage de l'espace "${existing.nom}"`,
    avant: existing,
    apres: { archived_at: nowIso },
  });

  res.json({ espace: { ...data, archived_at: data?.archived_at || nowIso }, message: `Espace "${existing.nom}" archivé.` });
}

async function restoreEspace(req, res) {
  if (!req.tenantId) return res.status(404).json({ error: 'Aucun coworking associé à votre compte.' });

  const { data: existing } = await supabaseAdmin
    .from('espaces')
    .select('id, nom')
    .eq('id', req.params.id)
    .eq('tenant_id', req.tenantId)
    .single();

  if (!existing) return res.status(404).json({ error: 'Espace introuvable.' });

  let { data, error } = await supabaseAdmin
    .from('espaces')
    .update({ archived_at: null, archived_by: null, actif: true, statut: 'actif' })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error && isMissingSchemaError(error)) {
    ({ data, error } = await supabaseAdmin
      .from('espaces')
      .update({ actif: true, statut: 'actif' })
      .eq('id', req.params.id)
      .select()
      .single());
  }
  if (error) return res.status(400).json({ error: error.message });

  const settings = await readTenantSettings(req.tenantId);
  const nextIds = (Array.isArray(settings.archived_espaces) ? settings.archived_espaces : []).filter((id) => id !== req.params.id);
  await writeTenantSettingsKey(req.tenantId, 'archived_espaces', nextIds);

  await logActivity({
    supabaseAdmin,
    tenantId: req.tenantId,
    user: req.user,
    action: 'restauration',
    entiteType: 'espace',
    entiteId: req.params.id,
    details: `Restauration de l'espace "${existing.nom}"`,
  });

  res.json({ espace: data, message: `Espace "${existing.nom}" restauré.` });
}

async function deleteEspace(req, res) {
  return archiveEspace(req, res);
}

// ── PUT /api/admin/espaces/:id/tarifs & GET /api/admin/tarifs/historique ──
async function updateEspaceTarifs(req, res) {
  if (!req.tenantId) return res.status(404).json({ error: 'Aucun coworking associé à votre compte.' });
  const { id } = req.params;

  const { data: espace, error: fetchErr } = await supabaseAdmin
    .from('espaces')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', req.tenantId)
    .single();

  if (fetchErr || !espace) return res.status(404).json({ error: 'Espace introuvable.' });

  const tvaPct = req.body.tva_pct !== undefined ? Number(req.body.tva_pct) : Number(espace.tva_pct ?? DEFAULT_TVA_PCT);
  const tarifsActifs = req.body.tarifs_actifs && typeof req.body.tarifs_actifs === 'object'
    ? {
        horaire: Boolean(req.body.tarifs_actifs.horaire),
        journalier: Boolean(req.body.tarifs_actifs.journalier),
        mensuel: Boolean(req.body.tarifs_actifs.mensuel),
      }
    : (espace.tarifs_actifs || { horaire: true, journalier: true, mensuel: true });

  if (!tarifsActifs.horaire && !tarifsActifs.journalier && !tarifsActifs.mensuel) {
    return res.status(400).json({ error: 'Au moins un type de tarif (Horaire, Journalier ou Mensuel) doit être actif.' });
  }

  const hHT = tarifsActifs.horaire ? roundMillime(req.body.tarif_horaire_ht ?? computeHTFromTTC(req.body.tarif_horaire ?? espace.tarif_horaire, tvaPct)) : 0;
  const jHT = tarifsActifs.journalier ? roundMillime(req.body.tarif_journalier_ht ?? computeHTFromTTC(req.body.tarif_journalier ?? espace.tarif_journalier, tvaPct)) : 0;
  const mHT = tarifsActifs.mensuel ? roundMillime(req.body.tarif_mensuel_ht ?? computeHTFromTTC(req.body.tarif_mensuel ?? espace.tarif_mensuel, tvaPct)) : 0;

  const updates = {
    tva_pct: tvaPct,
    tarifs_actifs: tarifsActifs,
    tarif_horaire_ht: hHT,
    tarif_journalier_ht: jHT,
    tarif_mensuel_ht: mHT,
    tarif_horaire: computeTTC(hHT, tvaPct),
    tarif_journalier: computeTTC(jHT, tvaPct),
    tarif_mensuel: computeTTC(mHT, tvaPct),
  };

  let { data: updated, error } = await supabaseAdmin.from('espaces').update(updates).eq('id', id).select().single();
  if (error && isMissingSchemaError(error)) {
    ({ data: updated, error } = await supabaseAdmin.from('espaces').update({
      tarif_horaire: updates.tarif_horaire,
      tarif_journalier: updates.tarif_journalier,
      tarif_mensuel: updates.tarif_mensuel,
    }).eq('id', id).select().single());
  }
  if (error) return res.status(400).json({ error: error.message });

  const histRow = {
    id: crypto.randomUUID(),
    tenant_id: req.tenantId,
    espace_id: id,
    espace_nom: espace.nom,
    tarif_horaire_ht: hHT,
    tarif_journalier_ht: jHT,
    tarif_mensuel_ht: mHT,
    tva_pct: tvaPct,
    tarifs_actifs: tarifsActifs,
    modifie_par: req.user?.id || null,
    modifie_par_nom: `${req.user?.prenom || ''} ${req.user?.nom || ''}`.trim() || req.user?.email || 'Admin',
    note: String(req.body.note || '').trim() || null,
    created_at: new Date().toISOString(),
  };

  try {
    const ins = await supabaseAdmin.from('tarif_historique').insert({
      tenant_id: req.tenantId,
      espace_id: id,
      tarif_horaire_ht: hHT,
      tarif_journalier_ht: jHT,
      tarif_mensuel_ht: mHT,
      tva_pct: tvaPct,
      tarifs_actifs: tarifsActifs,
      modifie_par: req.user?.id || null,
      note: histRow.note,
    });
    if (ins.error) throw ins.error;
  } catch (_) {
    const settings = await readTenantSettings(req.tenantId);
    const list = Array.isArray(settings.tarif_historique) ? settings.tarif_historique : [];
    await writeTenantSettingsKey(req.tenantId, 'tarif_historique', [histRow, ...list].slice(0, 100));
  }

  await logActivity({
    supabaseAdmin,
    tenantId: req.tenantId,
    user: req.user,
    action: 'modification',
    entiteType: 'tarif',
    entiteId: id,
    details: `Mise à jour des tarifs HT/TTC pour "${espace.nom}" (TVA ${tvaPct}%)`,
    avant: {
      tarif_horaire: espace.tarif_horaire,
      tarif_journalier: espace.tarif_journalier,
      tarif_mensuel: espace.tarif_mensuel,
    },
    apres: updates,
  });

  res.json({ espace: updated, history_entry: histRow });
}

async function getTarifHistory(req, res) {
  try {
    const tid = req.tenantId;
    let q = supabaseAdmin
      .from('tarif_historique')
      .select('*, espaces(id, nom)')
      .eq('tenant_id', tid)
      .order('created_at', { ascending: false })
      .limit(80);
    if (req.query.espace_id) q = q.eq('espace_id', req.query.espace_id);
    const { data, error } = await q;
    if (!error && Array.isArray(data)) {
      return res.json({ historique: data });
    }
    const settings = await readTenantSettings(tid);
    const list = Array.isArray(settings.tarif_historique) ? settings.tarif_historique : [];
    const filtered = req.query.espace_id ? list.filter((h) => h.espace_id === req.query.espace_id) : list;
    res.json({ historique: filtered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── POST /api/admin/onboarding/complete ───────────────────────────────────
async function completeOnboarding(req, res) {
  if (!req.tenantId) return res.status(404).json({ error: 'Aucun coworking associé à votre compte.' });

  const { count: spaceCount } = await supabaseAdmin
    .from('espaces')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', req.tenantId);

  if (!spaceCount || spaceCount < 1) {
    return res.status(400).json({ error: 'Ajoutez au moins un espace avant de terminer la configuration.' });
  }

  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('settings')
    .eq('id', req.tenantId)
    .single();

  const settings = { ...(tenant?.settings || {}), onboarding_completed: true };

  const { data, error } = await supabaseAdmin
    .from('tenants')
    .update({ settings, updated_at: new Date().toISOString() })
    .eq('id', req.tenantId)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ tenant: data, message: 'Configuration terminée avec succès.' });
}

// ── GET /api/admin/members ─────────────────────────────────────────────────
async function listMembers(req, res) {
  const { search = '' } = req.query;

  let query = supabaseAdmin
    .from('profiles')
    .select('id, nom, prenom, email, telephone, type_membre, role, created_at')
    .in('role', ['member', 'guest', 'formateur'])
    .order('nom', { ascending: true });

  query = applyTenantFilter(query, req);

  if (search.trim()) {
    query = query.or(`nom.ilike.%${search}%,prenom.ilike.%${search}%,email.ilike.%${search}%`);
  }

  const { data, error } = await query.limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ members: data || [] });
}

// ── POST /api/admin/conversations ─────────────────────────────────────────
async function createAdminConversation(req, res) {
  const { member_id, title } = req.body;
  if (!member_id) return res.status(400).json({ error: 'member_id requis.' });

  const { data: member } = await supabaseAdmin
    .from('profiles')
    .select('id, nom, prenom')
    .eq('id', member_id)
    .single();

  if (!member) return res.status(404).json({ error: 'Membre introuvable.' });

  // Vérifier si une conversation support existe déjà entre cet admin et ce membre
  const { data: existingMemberships } = await supabaseAdmin
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', req.user.id);

  if (existingMemberships && existingMemberships.length > 0) {
    const adminConvIds = existingMemberships.map(m => m.conversation_id);
    const { data: memberInConvs } = await supabaseAdmin
      .from('conversation_members')
      .select('conversation_id')
      .in('conversation_id', adminConvIds)
      .eq('user_id', member_id);

    if (memberInConvs && memberInConvs.length > 0) {
      const convId = memberInConvs[0].conversation_id;
      const { data: conv } = await supabaseAdmin.from('conversations').select('*').eq('id', convId).single();
      return res.json({ conversation: conv, existing: true });
    }
  }

  const convTitle = title || `${member.prenom} ${member.nom}`;
  const { data: conv, error } = await supabaseAdmin
    .from('conversations')
    .insert({ title: convTitle, type: 'support', created_by: req.user.id, tenant_id: req.tenantId })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await supabaseAdmin.from('conversation_members').insert([
    { conversation_id: conv.id, user_id: req.user.id },
    { conversation_id: conv.id, user_id: member_id },
  ]);

  const { emitToUser } = require('../services/socketService');
  emitToUser(member_id, 'conversation:update', {
    conversation_id: conv.id,
    last_message: null,
    title: convTitle,
  });

  res.status(201).json({ conversation: conv, existing: false });
}

// ── GET /api/admin/conversations ──────────────────────────────────────────
async function listAdminConversations(req, res) {
  const { page = 1, limit = 50, search = '' } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = supabaseAdmin
    .from('conversations')
    .select('*', { count: 'exact' })
    .order('updated_at', { ascending: false });

  query = applyTenantFilter(query, req);

  const { data: conversations, error, count } = await query.range(offset, offset + parseInt(limit) - 1);
  if (error) return res.status(500).json({ error: error.message });

  const enriched = await Promise.all((conversations || []).map(async (conv) => {
    const { data: members } = await supabaseAdmin
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conv.id);

    const memberIds = (members || []).map(m => m.user_id);

    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, nom, prenom, email, role, type_membre')
      .in('id', memberIds);

    const memberProfile = (profiles || []).find(p => !['super_admin', 'admin', 'staff'].includes(p.role));
    const staffProfiles = (profiles || []).filter(p => ['super_admin', 'admin', 'staff'].includes(p.role));

    const { data: lastMsg } = await supabaseAdmin
      .from('messages')
      .select('id, content, sender_id, created_at')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: adminMembership } = await supabaseAdmin
      .from('conversation_members')
      .select('last_read_at')
      .eq('conversation_id', conv.id)
      .eq('user_id', req.user.id)
      .maybeSingle();

    const lastRead = adminMembership?.last_read_at || '1970-01-01T00:00:00Z';
    const { count: unreadCount } = await supabaseAdmin
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conv.id)
      .neq('sender_id', req.user.id)
      .gt('created_at', lastRead);

    return {
      ...conv,
      member: memberProfile || null,
      staff: staffProfiles || [],
      last_message: lastMsg,
      unread_count: unreadCount || 0,
    };
  }));

  let result = enriched;
  if (search.trim()) {
    const s = search.toLowerCase();
    result = enriched.filter(c =>
      c.member && (
        (c.member.nom || '').toLowerCase().includes(s) ||
        (c.member.prenom || '').toLowerCase().includes(s) ||
        (c.member.email || '').toLowerCase().includes(s)
      )
    );
  }

  res.json({ conversations: result, pagination: { page: parseInt(page), limit: parseInt(limit), total: count || 0 } });
}

// ── POST /api/upload ──────────────────────────────────────────────────────
async function uploadPhoto(req, res) {
  try {
    const { base64Data, fileName, fileType, folder } = req.body;

    if (!base64Data || !fileName) {
      return res.status(400).json({ error: 'base64Data et fileName sont requis.' });
    }

    const cleanType = String(fileType || '').toLowerCase();
    const validMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
    if (cleanType && !validMimes.includes(cleanType)) {
      return res.status(400).json({ error: 'Format d\'image non supporté. Formats acceptés : JPEG, PNG, WEBP, GIF, SVG.' });
    }

    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'La taille de l\'image ne doit pas dépasser 5 Mo.' });
    }

    const ext = fileName.split('.').pop()?.toLowerCase() || 'jpg';
    const targetFolder = folder || 'espaces';
    const primaryBucket = ['avatars', 'documents'].includes(targetFolder) ? targetFolder : 'coworking-images';
    const candidateBuckets = [primaryBucket, 'coworking-images', 'documents', 'avatars'].filter((v, i, a) => a.indexOf(v) === i);

    let publicUrl = null;
    let lastError = null;

    for (const b of candidateBuckets) {
      try {
        const targetPath = `${targetFolder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabaseAdmin.storage
          .from(b)
          .upload(targetPath, buffer, {
            contentType: fileType || 'image/jpeg',
            upsert: true,
          });

        if (!upErr) {
          const { data: pubData } = supabaseAdmin.storage.from(b).getPublicUrl(targetPath);
          if (pubData?.publicUrl) {
            publicUrl = pubData.publicUrl;
            break;
          }
        } else {
          lastError = upErr;
        }
      } catch (e) {
        lastError = e;
      }
    }

    if (!publicUrl) {
      return res.status(400).json({ error: `Upload échoué : ${lastError?.message || 'Impossible d\'enregistrer l\'image.'}` });
    }

    // Si c'est l'avatar de l'utilisateur connecté, persister aussi dans profiles et metadata
    if (folder === 'avatars' && req.user?.id) {
      try {
        await supabaseAdmin
          .from('profiles')
          .update({ photo_url: publicUrl, updated_at: new Date().toISOString() })
          .eq('id', req.user.id);

        await supabaseAdmin.auth.admin.updateUserById(req.user.id, {
          user_metadata: { photo_url: publicUrl, avatar_url: publicUrl },
        });
      } catch (_) {}
    }

    res.json({ publicUrl });
  } catch (err) {
    console.error('❌ Erreur uploadPhoto:', err);
    res.status(500).json({ error: err.message || 'Erreur lors de l\'upload de la photo.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PACKS SAAS DESKYWORK — source centralisée ../config/deskyworkPacks.js
// ══════════════════════════════════════════════════════════════════════════════

function buildDeskyWorkInvoices(tenant, pack) {
  const saved = Array.isArray(tenant?.settings?.factures_deskywork) ? tenant.settings.factures_deskywork : [];
  if (saved.length > 0) return saved;

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dueDate = tenant?.prochaine_echeance ? new Date(tenant.prochaine_echeance) : null;
  const lastPaid = tenant?.derniere_facture ? new Date(tenant.derniere_facture) : null;

  let statut = 'Émise';
  if (lastPaid && lastPaid.getFullYear() === yyyy && lastPaid.getMonth() === now.getMonth()) {
    statut = 'Payée';
  } else if (dueDate && dueDate < now) {
    statut = 'En retard';
  }

  const currentInvoice = {
    id: `DW-${yyyy}-${mm}`,
    numero: `DW-${yyyy}-${mm}`,
    periode: now.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
    pack: pack.name,
    montant: pack.prix,
    statut,
    date_emission: new Date(yyyy, now.getMonth(), 1).toISOString(),
    date_echeance: dueDate ? dueDate.toISOString() : new Date(yyyy, now.getMonth(), 15).toISOString(),
    date_paiement: lastPaid ? lastPaid.toISOString() : null,
  };
  return [currentInvoice];
}

const DEFAULT_ALERT_SETTINGS = {
  alerte_fin_session_inapp: true,
  alerte_depassement_inapp: true,
  confirmation_reservation_email: true,
  recu_paiement_email: true,
  rappel_echeance_abonnement_email: true,
  relance_impaye_email: false,
  nouvelle_inscription_email: true,
};

// ── GET /api/admin/global-search?q=... ───────────────────────────────────────
async function globalSearch(req, res) {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ membres: [], reservations: [], espaces: [] });

    const like = `%${q}%`;
    const tid = req.tenantId;

    let memQ = supabaseAdmin
      .from('profiles')
      .select('id, nom, prenom, email, telephone, role, type_membre, statut_compte')
      .in('role', ['member', 'guest', 'formateur', 'staff'])
      .or(`nom.ilike.${like},prenom.ilike.${like},email.ilike.${like},telephone.ilike.${like}`)
      .limit(6);
    if (tid) memQ = memQ.eq('tenant_id', tid);

    let espQ = supabaseAdmin
      .from('espaces')
      .select('id, nom, type, capacite, tarif_horaire, actif')
      .or(`nom.ilike.${like},type.ilike.${like}`)
      .limit(6);
    if (tid) espQ = espQ.eq('tenant_id', tid);

    let resQ = supabaseAdmin
      .from('reservations')
      .select('id, date_debut, date_fin, statut, guest_nom, guest_email, notes, spaces:espaces(id, nom), profiles!user_id(id, nom, prenom, email)')
      .order('date_debut', { ascending: false })
      .limit(60);
    if (tid) resQ = resQ.eq('tenant_id', tid);

    const [{ data: membres }, { data: espaces }, { data: recentRes }] = await Promise.all([memQ, espQ, resQ]);

    const lower = q.toLowerCase();
    const reservations = (recentRes || [])
      .filter((r) => {
        const hay = [
          r.id,
          r.guest_nom,
          r.guest_email,
          r.spaces?.nom,
          r.profiles?.nom,
          r.profiles?.prenom,
          r.profiles?.email,
          r.notes,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(lower);
      })
      .slice(0, 6);

    res.json({
      membres: membres || [],
      reservations,
      espaces: espaces || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/admin/clients/overview ──────────────────────────────────────────
async function getClientsOverview(req, res) {
  try {
    const tid = req.tenantId;
    const includeArchived = req.query.include_archived === 'true' || req.query.include_archived === '1';

    let profQ = supabaseAdmin
      .from('profiles')
      .select('id, nom, prenom, email, telephone, role, type_membre, statut_compte, created_at')
      .order('created_at', { ascending: false });
    let guestQ = supabaseAdmin.from('guests').select('*').order('created_at', { ascending: false });
    let persQ = supabaseAdmin.from('personnes').select('*').order('created_at', { ascending: false });
    let resQ = supabaseAdmin
      .from('reservations')
      .select('id, user_id, espace_id, date_debut, date_fin, statut, montant_total, mode_reservation, guest_nom, guest_email, guest_telephone, notes, created_at, espaces(id, nom, type)')
      .order('created_at', { ascending: false });
    let payQ = supabaseAdmin.from('paiements').select('id, user_id, reservation_id, montant, statut, mode, created_at');
    let aboQ = supabaseAdmin.from('abonnements').select('id, user_id, type, statut, date_debut, date_fin');
    let contQ = supabaseAdmin.from('contenu_documents').select('*');
    let docMemQ = supabaseAdmin
      .from('documents_membres')
      .select('*, profiles:user_id(id, nom, prenom, email)')
      .order('created_at', { ascending: false });

    if (tid) {
      profQ = profQ.eq('tenant_id', tid);
      guestQ = guestQ.eq('tenant_id', tid);
      persQ = persQ.eq('tenant_id', tid);
      resQ = resQ.eq('tenant_id', tid);
      payQ = payQ.eq('tenant_id', tid);
      aboQ = aboQ.eq('tenant_id', tid);
      contQ = contQ.eq('tenant_id', tid);
      docMemQ = docMemQ.eq('tenant_id', tid);
    }

    const [
      { data: profilesRaw },
      { data: guestsRaw },
      persRes,
      { data: reservations },
      { data: paiements },
      { data: abonnements },
      { data: contenus },
      { data: signatures },
      settings,
    ] = await Promise.all([
      profQ,
      guestQ,
      Promise.resolve(persQ).catch(() => ({ data: [], error: true })),
      resQ,
      payQ,
      aboQ,
      contQ,
      docMemQ,
      readTenantSettings(tid),
    ]);

    const archivedProfileIds = new Set(Array.isArray(settings?.archived_profiles) ? settings.archived_profiles : []);
    // Exclure strictement les comptes staff / admin / super_admin
    const profiles = (profilesRaw || []).filter((p) => {
      if (isStaffRole(p.role)) return false;
      const isArch = Boolean(p.archived_at) || archivedProfileIds.has(p.id);
      return includeArchived ? true : !isArch;
    });

    const guests = (guestsRaw || []).filter((g) => {
      const isArch = Boolean(g.archived_at) || archivedProfileIds.has(g.id);
      return includeArchived ? true : !isArch;
    });

    const resByUser = {};
    (reservations || []).forEach((r) => {
      if (!r.user_id) return;
      if (!resByUser[r.user_id]) resByUser[r.user_id] = [];
      resByUser[r.user_id].push(r);
    });

    const payByUser = {};
    (paiements || []).forEach((p) => {
      if (!p.user_id) return;
      if (!payByUser[p.user_id]) payByUser[p.user_id] = { paye: 0, du: 0 };
      const m = parseFloat(p.montant || 0);
      if (p.statut === 'paid') payByUser[p.user_id].paye += m;
      else if (p.statut === 'pending') payByUser[p.user_id].du += m;
    });

    const aboByUser = {};
    (abonnements || []).forEach((a) => {
      if (a.user_id && ['active', 'actif', 'a_renouveler'].includes(String(a.statut || '').toLowerCase())) {
        aboByUser[a.user_id] = a;
      }
    });

    const members = profiles.map((m) => ({
      ...m,
      type_personne: m.role === 'guest' ? 'invite' : 'membre',
      archived_at: m.archived_at || (archivedProfileIds.has(m.id) ? (m.updated_at || m.created_at) : null),
      reservations_count: (resByUser[m.id] || []).length,
      total_paye: Number((payByUser[m.id]?.paye || 0).toFixed(3)),
      total_du: Number((payByUser[m.id]?.du || 0).toFixed(3)),
      abonnement_actif: aboByUser[m.id] || null,
    }));

    // Table unifiée personnes (table Supabase OU fallback settings + fusion membres/invités)
    const fallbackPersonnes = Array.isArray(settings?.personnes) ? settings.personnes : [];
    const tablePersonnes = !persRes?.error && Array.isArray(persRes?.data) && persRes.data.length > 0
      ? persRes.data
      : [];
    const customPersonnes = (tablePersonnes.length > 0 ? tablePersonnes : fallbackPersonnes)
      .filter((p) => {
        const isArch = Boolean(p.archived_at) || archivedProfileIds.has(p.id);
        return includeArchived ? true : !isArch;
      });

    const unifiedMap = new Map();
    members.forEach((m) => {
      unifiedMap.set(`prof-${m.id}`, {
        id: m.id,
        profile_id: m.id,
        source: 'profile',
        type_personne: m.role === 'guest' ? 'invite' : 'membre',
        nom: m.nom,
        prenom: m.prenom,
        email: m.email,
        telephone: m.telephone,
        type_membre: m.type_membre || 'particulier',
        statut_compte: m.statut_compte,
        reservations_count: m.reservations_count,
        total_paye: m.total_paye,
        total_du: m.total_du,
        abonnement_actif: m.abonnement_actif,
        archived_at: m.archived_at,
        created_at: m.created_at,
      });
    });
    guests.forEach((g) => {
      const k = g.email ? `email-${g.email.toLowerCase()}` : `guest-${g.id}`;
      if (!Array.from(unifiedMap.values()).some((v) => v.email && g.email && v.email.toLowerCase() === g.email.toLowerCase())) {
        unifiedMap.set(k, {
          id: g.id,
          source: 'guest',
          type_personne: 'invite',
          nom: g.nom,
          prenom: g.prenom || '',
          email: g.email || '',
          telephone: g.telephone || '',
          type_membre: 'particulier',
          statut_compte: 'actif',
          reservations_count: 0,
          total_paye: 0,
          total_du: 0,
          archived_at: g.archived_at || (archivedProfileIds.has(g.id) ? g.created_at : null),
          created_at: g.created_at,
        });
      }
    });
    customPersonnes.forEach((p) => {
      const existingByProfile = p.profile_id ? unifiedMap.get(`prof-${p.profile_id}`) : null;
      if (existingByProfile) return;
      unifiedMap.set(`pers-${p.id}`, {
        ...p,
        source: 'personnes',
        archived_at: p.archived_at || (archivedProfileIds.has(p.id) ? p.created_at : null),
      });
    });

    const entrepriseMap = new Map();
    members
      .filter((m) => m.type_membre === 'entreprise')
      .forEach((m) => {
        entrepriseMap.set(m.id, {
          id: m.id,
          raison_sociale: `${m.prenom || ''} ${m.nom || ''}`.trim() || m.email,
          contact_nom: `${m.prenom || ''} ${m.nom || ''}`.trim(),
          email: m.email,
          telephone: m.telephone || '—',
          matricule_fiscale: null,
          adresse: null,
          reservations_count: m.reservations_count,
          total_ca: m.total_paye,
          total_du: m.total_du,
          source: 'compte_entreprise',
        });
      });

    (reservations || []).forEach((r) => {
      let parsed = null;
      if (r.notes && String(r.notes).trim().startsWith('{')) {
        try { parsed = JSON.parse(r.notes); } catch (_) {}
      }
      const isEnt = r.mode_reservation === 'entreprise' || Boolean(parsed?.raison_sociale || parsed?.entreprise || parsed?.matricule_fiscale);
      if (!isEnt) return;

      const key = parsed?.raison_sociale || parsed?.entreprise || r.user_id || r.guest_email || r.id;
      const prev = entrepriseMap.get(key) || {
        id: r.user_id || r.id,
        raison_sociale: parsed?.raison_sociale || parsed?.entreprise || r.guest_nom || 'Client Entreprise',
        contact_nom: r.guest_nom || parsed?.contact_nom || '—',
        email: r.guest_email || parsed?.email || '—',
        telephone: r.guest_telephone || parsed?.telephone || '—',
        matricule_fiscale: parsed?.matricule_fiscale || null,
        adresse: parsed?.adresse || null,
        reservations_count: 0,
        total_ca: 0,
        total_du: 0,
        source: 'reservation',
      };
      prev.reservations_count += 1;
      prev.total_ca = Number((prev.total_ca + parseFloat(r.montant_total || 0)).toFixed(3));
      entrepriseMap.set(key, prev);
    });

    res.json({
      members,
      guests,
      personnes: Array.from(unifiedMap.values()),
      entreprises: Array.from(entrepriseMap.values()),
      documents: {
        contenus: contenus || [],
        signatures: signatures || [],
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── POST /api/admin/members — Créer rapidement un membre ────────────────────
async function createMember(req, res) {
  try {
    const { nom, prenom, email, telephone = '', type_membre = 'particulier', password } = req.body;
    if (!nom || !email) {
      return res.status(400).json({ error: 'Le nom et l\'e-mail sont obligatoires.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('id, email')
      .ilike('email', cleanEmail)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'Un compte existe déjà avec cette adresse e-mail.' });
    }

    if (req.tenantId) {
      const { data: tenant } = await supabaseAdmin.from('tenants').select('*').eq('id', req.tenantId).single();
      const pack = resolveTenantPack(tenant);
      if (pack.max_membres) {
        const { count } = await supabaseAdmin
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', req.tenantId)
          .in('role', ['member', 'guest']);
        if ((count || 0) >= pack.max_membres) {
          return res.status(403).json({
            error: `Limite du pack ${pack.name} atteinte (${pack.max_membres} membres max). Passez au pack supérieur.`,
            code: 'PACK_MEMBER_LIMIT_REACHED',
          });
        }
      }
    }

    const tempPassword = password && String(password).length >= 8
      ? String(password)
      : `Dw!${Math.random().toString(36).slice(2, 8)}${Math.floor(100 + Math.random() * 899)}A`;

    const { data: createdAuth, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: cleanEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { nom, prenom: prenom || '', role: 'member', tenant_id: req.tenantId },
    });

    if (authErr || !createdAuth?.user) {
      return res.status(400).json({ error: authErr?.message || 'Impossible de créer le compte auth.' });
    }

    const uid = createdAuth.user.id;
    const { data: profile, error: profErr } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: uid,
        nom: String(nom).trim(),
        prenom: String(prenom || '').trim(),
        email: cleanEmail,
        telephone: String(telephone || '').trim() || null,
        role: 'member',
        type_membre: type_membre === 'entreprise' ? 'entreprise' : 'particulier',
        statut_compte: 'actif',
        tenant_id: req.tenantId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (profErr) {
      try { await supabaseAdmin.auth.admin.deleteUser(uid); } catch (_) {}
      return res.status(400).json({ error: profErr.message });
    }

    try {
      await supabaseAdmin.from('memberships').upsert({
        user_id: uid,
        tenant_id: req.tenantId,
        role: 'member',
        statut: 'actif',
      }, { onConflict: 'user_id,tenant_id' });
    } catch (_) {}

    res.status(201).json({
      member: profile,
      temporary_password: password ? undefined : tempPassword,
      message: `Membre ${prenom || ''} ${nom} créé avec succès.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/admin/members/:id/history ──────────────────────────────────────
async function getMemberHistory(req, res) {
  try {
    const memberId = req.params.id;
    const tid = req.tenantId;

    const { data: member, error: memErr } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', memberId)
      .single();
    if (memErr || !member) return res.status(404).json({ error: 'Membre introuvable.' });
    if (tid && member.tenant_id && member.tenant_id !== tid) {
      return res.status(403).json({ error: 'Accès non autorisé.' });
    }

    let rQ = supabaseAdmin
      .from('reservations')
      .select('id, date_debut, date_fin, statut, montant_total, espaces(nom, type)')
      .eq('user_id', memberId)
      .order('date_debut', { ascending: false })
      .limit(30);
    let pQ = supabaseAdmin
      .from('paiements')
      .select('id, montant, statut, mode, numero_recu, date_paiement, created_at, reference_externe')
      .eq('user_id', memberId)
      .order('created_at', { ascending: false })
      .limit(30);
    let cQ = supabaseAdmin
      .from('credits_membres')
      .select('*')
      .eq('user_id', memberId)
      .order('created_at', { ascending: false })
      .limit(20);
    let dQ = supabaseAdmin
      .from('documents_membres')
      .select('*')
      .eq('user_id', memberId)
      .order('created_at', { ascending: false });

    if (tid) {
      rQ = rQ.eq('tenant_id', tid);
      pQ = pQ.eq('tenant_id', tid);
      cQ = cQ.eq('tenant_id', tid);
      dQ = dQ.eq('tenant_id', tid);
    }

    const [{ data: reservations }, { data: paiements }, { data: credits }, { data: documents }] = await Promise.all([
      rQ, pQ, cQ, dQ,
    ]);

    res.json({
      member,
      reservations: reservations || [],
      paiements: paiements || [],
      credits: credits || [],
      documents: documents || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GESTION ÉQUIPE (STAFF) ──────────────────────────────────────────────────
async function listStaff(req, res) {
  try {
    const tid = req.tenantId;
    const { data: tenant } = tid
      ? await supabaseAdmin.from('tenants').select('*').eq('id', tid).single()
      : { data: null };

    const pack = resolveTenantPack(tenant);
    const { data: staff, error } = await supabaseAdmin
      .from('profiles')
      .select('id, nom, prenom, email, telephone, role, statut_compte, created_at')
      .eq('tenant_id', tid)
      .eq('role', 'staff')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    const { matrix } = await loadTenantRolesMatrix(tid);
    const permMap = tenant?.settings?.staff_permissions || {};
    const enriched = (staff || []).map((s) => {
      const staffMeta = permMap[s.id] || {};
      const resolvedPerms = {};
      for (const def of PERMISSION_DEFINITIONS) {
        resolvedPerms[def.key] = evaluatePermission({
          profileRole: s.role,
          staffMeta,
          rolesMatrix: matrix,
          permKey: def.key,
        });
      }
      return {
        ...s,
        custom_role_code: staffMeta.custom_role_code || 'staff',
        custom_role_label: matrix[staffMeta.custom_role_code || 'staff']?.label || 'Réceptionniste',
        permissions: resolvedPerms,
      };
    });

    res.json({
      staff: enriched,
      quota: {
        used: enriched.length,
        max: pack.max_staff,
        pack: pack.name,
        remaining: Math.max(0, pack.max_staff - enriched.length),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createStaff(req, res) {
  try {
    const { nom, prenom = '', email, telephone = '', password } = req.body;
    if (!nom || !email) return res.status(400).json({ error: 'Nom et e-mail requis.' });

    const cleanEmail = String(email).trim().toLowerCase();
    const { data: tenant } = await supabaseAdmin.from('tenants').select('*').eq('id', req.tenantId).single();
    const pack = resolveTenantPack(tenant);

    const { count: currentStaffCount } = await supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', req.tenantId)
      .eq('role', 'staff');

    if ((currentStaffCount || 0) >= pack.max_staff) {
      return res.status(403).json({
        error: `Quota Staff du pack ${pack.name} atteint (${currentStaffCount}/${pack.max_staff}). Passez au pack supérieur pour ajouter un autre réceptionniste.`,
        code: 'STAFF_QUOTA_REACHED',
      });
    }

    const { data: existing } = await supabaseAdmin.from('profiles').select('id').ilike('email', cleanEmail).maybeSingle();
    if (existing) return res.status(409).json({ error: 'Cette adresse e-mail est déjà utilisée.' });

    const tempPassword = password && String(password).length >= 8
      ? String(password)
      : `Stf!${Math.random().toString(36).slice(2, 8)}${Math.floor(100 + Math.random() * 899)}`;

    const { data: createdAuth, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: cleanEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { nom, prenom, role: 'staff', tenant_id: req.tenantId },
    });
    if (authErr || !createdAuth?.user) {
      return res.status(400).json({ error: authErr?.message || 'Échec création compte Staff.' });
    }

    const uid = createdAuth.user.id;
    const { data: profile, error: profErr } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: uid,
        nom: String(nom).trim(),
        prenom: String(prenom || '').trim(),
        email: cleanEmail,
        telephone: String(telephone || '').trim() || null,
        role: 'staff',
        statut_compte: 'actif',
        tenant_id: req.tenantId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (profErr) {
      try { await supabaseAdmin.auth.admin.deleteUser(uid); } catch (_) {}
      return res.status(400).json({ error: profErr.message });
    }

    if (req.tenantId && (req.body.custom_role_code || req.body.permissions)) {
      const s = tenant?.settings || {};
      const permMap = { ...(s.staff_permissions || {}) };
      const customCode = req.body.custom_role_code || 'staff';
      const sanitizedOverrides = {};
      if (req.body.permissions && typeof req.body.permissions === 'object') {
        for (const def of PERMISSION_DEFINITIONS) {
          if (req.body.permissions[def.key] !== undefined) {
            sanitizedOverrides[def.key] = customCode === 'staff' && HARD_LOCKED_KEYS_FOR_STAFF.has(def.key)
              ? false
              : Boolean(req.body.permissions[def.key]);
          }
        }
      }
      permMap[uid] = {
        custom_role_code: customCode,
        permissions: sanitizedOverrides,
      };
      await supabaseAdmin.from('tenants').update({ settings: { ...s, staff_permissions: permMap } }).eq('id', req.tenantId);
    }

    await logActivity({
      tenantId: req.tenantId,
      req,
      action: 'creation',
      entityType: 'staff',
      entityId: uid,
      entityLabel: `${prenom ? prenom + ' ' : ''}${nom} (${req.body.custom_role_code || 'Réceptionniste'})`,
    });

    res.status(201).json({
      staff: profile,
      temporary_password: password ? undefined : tempPassword,
      message: `Compte Staff créé pour ${prenom ? prenom + ' ' : ''}${nom}.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateStaff(req, res) {
  try {
    const { id } = req.params;
    const { data: target } = await supabaseAdmin
      .from('profiles')
      .select('id, role, tenant_id')
      .eq('id', id)
      .single();

    if (!target || target.role !== 'staff' || target.tenant_id !== req.tenantId) {
      return res.status(404).json({ error: 'Compte Staff introuvable.' });
    }

    const updates = { updated_at: new Date().toISOString() };
    if (req.body.nom !== undefined) updates.nom = String(req.body.nom).trim();
    if (req.body.prenom !== undefined) updates.prenom = String(req.body.prenom).trim();
    if (req.body.telephone !== undefined) updates.telephone = String(req.body.telephone || '').trim() || null;
    if (['actif', 'suspendu'].includes(req.body.statut_compte)) updates.statut_compte = req.body.statut_compte;

    const { data, error } = await supabaseAdmin.from('profiles').update(updates).eq('id', id).select().single();
    if (error) return res.status(400).json({ error: error.message });

    if ((req.body.permissions && typeof req.body.permissions === 'object') || req.body.custom_role_code !== undefined) {
      const { data: t } = await supabaseAdmin.from('tenants').select('settings').eq('id', req.tenantId).maybeSingle();
      const s = t?.settings || {};
      const permMap = { ...(s.staff_permissions || {}) };
      const prevEntry = permMap[id] || {};
      const customCode = req.body.custom_role_code !== undefined
        ? (String(req.body.custom_role_code || '').trim() || 'staff')
        : (prevEntry.custom_role_code || 'staff');

      const nextPerms = { ...(prevEntry.permissions || {}) };
      if (req.body.permissions && typeof req.body.permissions === 'object') {
        for (const def of PERMISSION_DEFINITIONS) {
          if (req.body.permissions[def.key] !== undefined) {
            nextPerms[def.key] = customCode === 'staff' && HARD_LOCKED_KEYS_FOR_STAFF.has(def.key)
              ? false
              : Boolean(req.body.permissions[def.key]);
          }
        }
      }
      permMap[id] = {
        custom_role_code: customCode,
        permissions: nextPerms,
      };
      await supabaseAdmin.from('tenants').update({ settings: { ...s, staff_permissions: permMap } }).eq('id', req.tenantId);
    }

    await logActivity({
      tenantId: req.tenantId,
      req,
      action: 'modification',
      entityType: 'staff',
      entityId: id,
      entityLabel: `${data.prenom || ''} ${data.nom || ''}`.trim(),
      afterData: { custom_role_code: req.body.custom_role_code, statut_compte: updates.statut_compte },
    });

    res.json({ staff: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteStaff(req, res) {
  try {
    const { id } = req.params;
    const { data: target } = await supabaseAdmin
      .from('profiles')
      .select('id, role, tenant_id, nom, prenom, statut_compte')
      .eq('id', id)
      .single();

    if (!target || target.role !== 'staff' || target.tenant_id !== req.tenantId) {
      return res.status(404).json({ error: 'Compte Staff introuvable.' });
    }

    const nowIso = new Date().toISOString();
    let { error } = await supabaseAdmin
      .from('profiles')
      .update({ statut_compte: 'suspendu', archived_at: nowIso, archived_by: req.user?.id || null, updated_at: nowIso })
      .eq('id', id);

    if (error && isMissingSchemaError(error)) {
      ({ error } = await supabaseAdmin.from('profiles').update({ statut_compte: 'suspendu', updated_at: nowIso }).eq('id', id));
    }
    if (error) return res.status(400).json({ error: error.message });

    const settings = await readTenantSettings(req.tenantId);
    const archivedIds = Array.from(new Set([...(Array.isArray(settings.archived_profiles) ? settings.archived_profiles : []), id]));
    await writeTenantSettingsKey(req.tenantId, 'archived_profiles', archivedIds);

    await logActivity({
      supabaseAdmin,
      tenantId: req.tenantId,
      user: req.user,
      action: 'archivage',
      entiteType: 'staff',
      entiteId: id,
      details: `Archivage du compte Staff "${target.prenom || ''} ${target.nom}"`,
      avant: target,
      apres: { statut_compte: 'suspendu', archived_at: nowIso },
    });

    res.json({ message: `Compte Staff "${target.prenom || ''} ${target.nom}" archivé.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── MON ABONNEMENT DESKYWORK ──────────────────────────────────────────────────
async function getSubscriptionOverview(req, res) {
  try {
    const tid = req.tenantId;
    const { data: tenant, error } = await supabaseAdmin.from('tenants').select('*').eq('id', tid).single();
    if (error || !tenant) return res.status(404).json({ error: 'Établissement introuvable.' });

    const pack = resolveTenantPack(tenant);
    const [{ count: espacesCount }, { count: membresCount }, { count: staffCount }] = await Promise.all([
      supabaseAdmin.from('espaces').select('*', { count: 'exact', head: true }).eq('tenant_id', tid),
      supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).eq('tenant_id', tid).in('role', ['member', 'guest']),
      supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).eq('tenant_id', tid).eq('role', 'staff'),
    ]);

    const invoices = buildDeskyWorkInvoices(tenant, pack);

    res.json({
      pack,
      all_packs: Object.values(SAAS_PACKS),
      tenant: {
        id: tenant.id,
        nom: tenant.nom,
        statut: tenant.statut,
        derniere_facture: tenant.derniere_facture,
        prochaine_echeance: tenant.prochaine_echeance,
        upgrade_requests: tenant.settings?.upgrade_requests || [],
      },
      usage: {
        espaces: { used: espacesCount || 0, max: pack.max_espaces },
        membres: { used: membresCount || 0, max: pack.max_membres },
        staff: { used: staffCount || 0, max: pack.max_staff },
      },
      invoices,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function requestPackUpgrade(req, res) {
  try {
    const { target_pack, note = '' } = req.body;
    const normalized = String(target_pack || '').toLowerCase();
    if (!SAAS_PACKS[normalized]) {
      return res.status(400).json({ error: 'Pack cible invalide (essentiel, standard ou premium).' });
    }

    const { data: tenant } = await supabaseAdmin.from('tenants').select('*').eq('id', req.tenantId).single();
    const curSettings = tenant?.settings || {};
    const reqEntry = {
      id: `UPG-${Date.now()}`,
      target_pack: normalized,
      target_label: SAAS_PACKS[normalized].name,
      note: String(note || '').trim(),
      statut: 'en_attente',
      created_at: new Date().toISOString(),
      requested_by: req.profile.email,
    };

    const nextSettings = {
      ...curSettings,
      upgrade_requests: [reqEntry, ...(curSettings.upgrade_requests || [])].slice(0, 10),
    };
    await supabaseAdmin.from('tenants').update({ settings: nextSettings, updated_at: new Date().toISOString() }).eq('id', req.tenantId);

    try {
      const { data: supers } = await supabaseAdmin.from('profiles').select('id').eq('role', 'super_admin');
      for (const sa of supers || []) {
        await supabaseAdmin.from('notifications').insert({
          user_id: sa.id,
          titre: `Demande changement de pack — ${tenant.nom}`,
          message: `L'établissement "${tenant.nom}" souhaite passer au pack ${SAAS_PACKS[normalized].name} (${SAAS_PACKS[normalized].prix} DT/mois).`,
          type: 'info',
          lu: false,
        });
      }
    } catch (_) {}

    res.json({ request: reqEntry, message: `Demande de passage au pack ${SAAS_PACKS[normalized].name} envoyée à l'équipe DeskyWork.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function downloadDeskyInvoicePdf(req, res) {
  try {
    const PDFDocument = require('pdfkit');
    const { invoiceId } = req.params;
    const { data: tenant } = await supabaseAdmin.from('tenants').select('*').eq('id', req.tenantId).single();
    if (!tenant) return res.status(404).json({ error: 'Établissement introuvable.' });

    const pack = resolveTenantPack(tenant);
    const invoices = buildDeskyWorkInvoices(tenant, pack);
    const inv = invoices.find((i) => i.id === invoiceId || i.numero === invoiceId) || invoices[0];

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => {
      const buf = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Facture-${inv.numero}.pdf"`);
      res.send(buf);
    });

    doc.rect(0, 0, doc.page.width, 95).fill('#282522');
    doc.fillColor('#f95d00').font('Helvetica-Bold').fontSize(22).text('DESKYWORK SaaS', 50, 28);
    doc.fillColor('#ffffff').font('Helvetica').fontSize(9.5).text('Facturation Plateforme B2B · Tunisie', 50, 56);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text(`FACTURE ${inv.numero}`, 320, 34, { width: 220, align: 'right' });
    doc.fillColor('#cbd5e1').font('Helvetica').fontSize(9).text(`Statut : ${inv.statut}`, 320, 52, { width: 220, align: 'right' });

    doc.fillColor('#18181b').font('Helvetica-Bold').fontSize(11).text('ÉTABLISSEMENT CLIENT', 50, 125);
    doc.font('Helvetica').fontSize(10).text(tenant.nom || '—', 50, 144);
    doc.text(tenant.adresse ? `${tenant.adresse}, ${tenant.ville || ''}` : (tenant.ville || 'Tunisie'), 50, 160);
    doc.text(tenant.email || '—', 50, 176);

    doc.font('Helvetica-Bold').fontSize(11).text('DÉTAILS DE FACTURATION', 50, 220);
    doc.rect(50, 240, 495, 26).fill('#282522');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9.5);
    doc.text('DESCRIPTION', 60, 249);
    doc.text('PÉRIODE', 280, 249);
    doc.text('MONTANT HT', 440, 249, { width: 95, align: 'right' });

    doc.rect(50, 266, 495, 34).fill('#f7f4f0');
    doc.fillColor('#18181b').font('Helvetica').fontSize(9.5);
    doc.text(`Abonnement DeskyWork — Pack ${inv.pack || pack.name}`, 60, 278);
    doc.text(inv.periode || 'Mensuel', 280, 278);
    doc.font('Helvetica-Bold').text(`${Number(inv.montant || pack.prix).toFixed(3)} DT`, 440, 278, { width: 95, align: 'right' });

    doc.rect(345, 320, 200, 36).fill('#f95d00');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text('TOTAL À RÉGLER', 355, 332);
    doc.text(`${Number(inv.montant || pack.prix).toFixed(3)} DT`, 430, 332, { width: 105, align: 'right' });

    doc.fillColor('#64748b').font('Helvetica').fontSize(8.5).text(
      'Document émis par DeskyWork. Règlement par virement bancaire, chèque ou espèces auprès de votre gestionnaire DeskyWork.',
      50, 400, { width: 495, align: 'center' }
    );
    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── NOTIFICATIONS & SUPPORT DESKYWORK ─────────────────────────────────────────
async function getNotificationsSupportState(req, res) {
  try {
    const tid = req.tenantId;
    const [{ data: tenant }, { data: notifications }] = await Promise.all([
      tid ? supabaseAdmin.from('tenants').select('id, nom, settings').eq('id', tid).single() : Promise.resolve({ data: null }),
      supabaseAdmin
        .from('notifications')
        .select('*')
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false })
        .limit(40),
    ]);

    const rawAlertes = tenant?.settings?.alertes || {};
    const alert_settings = { ...DEFAULT_ALERT_SETTINGS };
    Object.keys(DEFAULT_ALERT_SETTINGS).forEach((k) => {
      if (rawAlertes[k] !== undefined) alert_settings[k] = Boolean(rawAlertes[k]);
    });

    const tickets = Array.isArray(tenant?.settings?.support_tickets) ? tenant.settings.support_tickets : [];
    res.json({
      alert_settings,
      tickets,
      notifications: notifications || [],
      channels: ['in_app', 'email'],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateAlertSettings(req, res) {
  try {
    const tid = req.tenantId;
    const { data: tenant } = await supabaseAdmin.from('tenants').select('settings').eq('id', tid).single();
    const curSettings = tenant?.settings || {};
    const curAlertes = { ...DEFAULT_ALERT_SETTINGS, ...(curSettings.alertes || {}) };

    Object.keys(DEFAULT_ALERT_SETTINGS).forEach((k) => {
      if (req.body[k] !== undefined) curAlertes[k] = Boolean(req.body[k]);
    });

    const nextSettings = { ...curSettings, alertes: curAlertes };
    await supabaseAdmin.from('tenants').update({ settings: nextSettings, updated_at: new Date().toISOString() }).eq('id', tid);

    res.json({ alert_settings: curAlertes, message: 'Préférences d\'alertes (In-App & E-mail) enregistrées.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createSupportTicket(req, res) {
  try {
    const { sujet, categorie = 'Technique', priorite = 'normale', message } = req.body;
    if (!sujet || !message) {
      return res.status(400).json({ error: 'Sujet et message sont obligatoires.' });
    }

    const tid = req.tenantId;
    const { data: tenant } = await supabaseAdmin.from('tenants').select('id, nom, email, settings').eq('id', tid).single();

    const ticket = {
      id: `TKT-${Date.now().toString().slice(-6)}`,
      sujet: String(sujet).trim(),
      categorie: String(categorie).trim(),
      priorite: ['basse', 'normale', 'haute', 'urgente'].includes(priorite) ? priorite : 'normale',
      message: String(message).trim(),
      statut: 'ouvert',
      created_at: new Date().toISOString(),
      created_by: req.profile.email,
    };

    const curSettings = tenant?.settings || {};
    const nextTickets = [ticket, ...(Array.isArray(curSettings.support_tickets) ? curSettings.support_tickets : [])].slice(0, 50);
    await supabaseAdmin.from('tenants').update({
      settings: { ...curSettings, support_tickets: nextTickets },
      updated_at: new Date().toISOString(),
    }).eq('id', tid);

    try {
      await supabaseAdmin.from('contacts').insert({
        nom: `${tenant?.nom || 'Établissement'} (${req.profile.nom || req.profile.email})`,
        email: req.profile.email || tenant?.email || 'contact@deskywork.tn',
        sujet: `[Support ${ticket.id} · ${ticket.categorie}] ${ticket.sujet}`,
        message: ticket.message,
        statut: 'nouveau',
      });
    } catch (_) {}

    try {
      const { data: supers } = await supabaseAdmin.from('profiles').select('id').eq('role', 'super_admin');
      for (const sa of supers || []) {
        await supabaseAdmin.from('notifications').insert({
          user_id: sa.id,
          titre: `Nouveau ticket support ${ticket.id}`,
          message: `${tenant?.nom || 'Admin'} : ${ticket.sujet}`,
          type: 'warning',
          lu: false,
        });
      }
    } catch (_) {}

    res.status(201).json({ ticket, tickets: nextTickets, message: `Ticket ${ticket.id} transmis au support DeskyWork.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/admin/marketplace-stats (Premium uniquement) ───────────────────
async function getMarketplaceStats(req, res) {
  try {
    const tid = req.tenantId;
    const { data: tenant } = await supabaseAdmin.from('tenants').select('*').eq('id', tid).single();
    if (!tenant) return res.status(404).json({ error: 'Établissement introuvable.' });

    const pack = resolveTenantPack(tenant);
    const locked = !pack.is_partner && pack.key !== 'premium';
    const mp = tenant.settings?.marketplace_stats || {};
    const defaultVues = tenant.slug === 'nero-coworking' || tenant.id === 'a1111111-1111-4111-8111-111111111111' ? 142 : 118;
    const defaultClics = tenant.slug === 'nero-coworking' || tenant.id === 'a1111111-1111-4111-8111-111111111111' ? 38 : 29;
    const vues = Number(mp.vues ?? (pack.is_partner ? defaultVues : 0));
    const clics = Number(mp.clics ?? (pack.is_partner ? defaultClics : 0));

    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const { count: reservations30j } = await supabaseAdmin
      .from('reservations')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tid)
      .gte('created_at', since)
      .neq('statut', 'cancelled');

    const tauxConversion = vues > 0 ? Math.min(100, Math.round(((reservations30j || 0) / vues) * 1000) / 10) : 0;

    res.json({
      locked,
      required_pack: 'premium',
      current_pack: pack.key,
      is_partner: pack.is_partner,
      pack_name: pack.name,
      prix_mensuel: pack.prix,
      stats: locked
        ? { vues: null, clics: null, reservations: null, taux_conversion: null }
        : {
            vues,
            clics,
            reservations: reservations30j || 0,
            taux_conversion: tauxConversion,
            last_updated: mp.last_updated || null,
          },
      marketplace_url: tenant.slug ? `/coworking/${tenant.slug}` : `/coworking/${tenant.id}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// LOT 2 : PERSONNES (INVITÉ / PROSPECT / MEMBRE), SOFT-ARCHIVE, AUDIT, HUB CRUD
// ══════════════════════════════════════════════════════════════════════════════

async function createPersonne(req, res) {
  try {
    const tid = req.tenantId;
    const { nom, prenom = '', email = '', telephone = '', type_personne = 'prospect', entreprise_nom = '', notes = '' } = req.body;
    if (!nom) return res.status(400).json({ error: 'Le nom est obligatoire.' });
    const cleanType = ['membre', 'invite', 'prospect'].includes(type_personne) ? type_personne : 'prospect';

    const payload = {
      tenant_id: tid,
      type_personne: cleanType,
      nom: String(nom).trim(),
      prenom: String(prenom).trim(),
      email: String(email).trim().toLowerCase() || null,
      telephone: String(telephone).trim() || null,
      entreprise_nom: String(entreprise_nom).trim() || null,
      notes: String(notes).trim() || null,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin.from('personnes').insert(payload).select().single();
    let row = data;
    if (error && isMissingSchemaError(error)) {
      row = { id: crypto.randomUUID(), ...payload };
      const settings = await readTenantSettings(tid);
      const list = Array.isArray(settings.personnes) ? settings.personnes : [];
      await writeTenantSettingsKey(tid, 'personnes', [row, ...list]);
    } else if (error) {
      return res.status(400).json({ error: error.message });
    }

    await logActivity({
      supabaseAdmin,
      tenantId: tid,
      user: req.user,
      action: 'creation',
      entiteType: 'personne',
      entiteId: row.id,
      details: `Ajout ${cleanType} : ${row.prenom} ${row.nom}`.trim(),
      apres: row,
    });

    res.status(201).json({ personne: row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function archivePersonne(req, res) {
  try {
    const tid = req.tenantId;
    const { id } = req.params;
    const check = await hasFutureUntreatedReservations({ supabaseAdmin, tenantId: tid, userId: id });
    if (check.blocked) {
      return res.status(409).json({
        error: `Impossible d'archiver : cette fiche possède ${check.count} réservation(s) future(s) non traitée(s).`,
        future_count: check.count,
      });
    }

    const nowIso = new Date().toISOString();
    await supabaseAdmin.from('personnes').update({ archived_at: nowIso, archived_by: req.user?.id || null }).eq('id', id).eq('tenant_id', tid).then(() => {}).catch(() => {});
    await supabaseAdmin.from('profiles').update({ archived_at: nowIso, archived_by: req.user?.id || null, statut_compte: 'suspendu' }).eq('id', id).eq('tenant_id', tid).then(() => {}).catch(() => {});
    await supabaseAdmin.from('guests').update({ archived_at: nowIso, archived_by: req.user?.id || null }).eq('id', id).eq('tenant_id', tid).then(() => {}).catch(() => {});

    const settings = await readTenantSettings(tid);
    const archIds = Array.from(new Set([...(Array.isArray(settings.archived_profiles) ? settings.archived_profiles : []), id]));
    const persList = (Array.isArray(settings.personnes) ? settings.personnes : []).map((p) => (p.id === id ? { ...p, archived_at: nowIso } : p));
    await supabaseAdmin.from('tenants').update({
      settings: { ...settings, archived_profiles: archIds, personnes: persList },
      updated_at: nowIso,
    }).eq('id', tid);

    await logActivity({
      supabaseAdmin,
      tenantId: tid,
      user: req.user,
      action: 'archivage',
      entiteType: 'personne',
      entiteId: id,
      details: 'Archivage d\'une fiche membre / invité / prospect',
      apres: { archived_at: nowIso },
    });

    res.json({ message: 'Fiche archivée.', archived_at: nowIso });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function restorePersonne(req, res) {
  try {
    const tid = req.tenantId;
    const { id } = req.params;
    const nowIso = new Date().toISOString();

    await supabaseAdmin.from('personnes').update({ archived_at: null, archived_by: null }).eq('id', id).eq('tenant_id', tid).then(() => {}).catch(() => {});
    await supabaseAdmin.from('profiles').update({ archived_at: null, archived_by: null, statut_compte: 'actif' }).eq('id', id).eq('tenant_id', tid).then(() => {}).catch(() => {});
    await supabaseAdmin.from('guests').update({ archived_at: null, archived_by: null }).eq('id', id).eq('tenant_id', tid).then(() => {}).catch(() => {});

    const settings = await readTenantSettings(tid);
    const archIds = (Array.isArray(settings.archived_profiles) ? settings.archived_profiles : []).filter((x) => x !== id);
    const persList = (Array.isArray(settings.personnes) ? settings.personnes : []).map((p) => (p.id === id ? { ...p, archived_at: null } : p));
    await supabaseAdmin.from('tenants').update({
      settings: { ...settings, archived_profiles: archIds, personnes: persList },
      updated_at: nowIso,
    }).eq('id', tid);

    await logActivity({
      supabaseAdmin,
      tenantId: tid,
      user: req.user,
      action: 'restauration',
      entiteType: 'personne',
      entiteId: id,
      details: 'Restauration d\'une fiche archivée',
    });

    res.json({ message: 'Fiche restaurée.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getActivityLog(req, res) {
  try {
    const logs = await listActivityLogs({
      supabaseAdmin,
      tenantId: req.tenantId,
      entiteType: req.query.entite_type || null,
      action: req.query.action || null,
      limit: Number(req.query.limit || 100),
    });
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getPacks(req, res) {
  res.json({ packs: PACK_LIST, map: SAAS_PACKS, default_tva_pct: DEFAULT_TVA_PCT });
}

// Helper CRUD générique (table Supabase avec repli automatique settings.<key> + soft-archive)
function makeCollectionHandlers({ table, settingsKey, entiteType, requiredField = 'nom', labelFn }) {
  return {
    list: async (req, res) => {
      try {
        const tid = req.tenantId;
        const includeArchived = req.query.include_archived === 'true' || req.query.include_archived === '1';
        let q = supabaseAdmin.from(table).select('*').eq('tenant_id', tid).order('created_at', { ascending: false });
        if (!includeArchived) q = q.is('archived_at', null);
        const { data, error } = await q;
        if (!error && Array.isArray(data)) {
          return res.json({ items: data });
        }
        const settings = await readTenantSettings(tid);
        const raw = Array.isArray(settings[settingsKey]) ? settings[settingsKey] : [];
        const items = includeArchived ? raw : raw.filter((i) => !i.archived_at);
        res.json({ items });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
    create: async (req, res) => {
      try {
        const tid = req.tenantId;
        if (!req.body[requiredField]) {
          return res.status(400).json({ error: `Le champ "${requiredField}" est obligatoire.` });
        }
        const nowIso = new Date().toISOString();
        const payload = { ...req.body, tenant_id: tid, created_at: nowIso, updated_at: nowIso };
        delete payload.id;

        const { data, error } = await supabaseAdmin.from(table).insert(payload).select().single();
        let row = data;
        if (error && isMissingSchemaError(error)) {
          row = { id: crypto.randomUUID(), ...payload, archived_at: null };
          const settings = await readTenantSettings(tid);
          const raw = Array.isArray(settings[settingsKey]) ? settings[settingsKey] : [];
          await writeTenantSettingsKey(tid, settingsKey, [row, ...raw]);
        } else if (error) {
          return res.status(400).json({ error: error.message });
        }

        await logActivity({
          supabaseAdmin,
          tenantId: tid,
          user: req.user,
          action: 'creation',
          entiteType,
          entiteId: row.id,
          details: `Création ${entiteType} : ${labelFn ? labelFn(row) : row[requiredField]}`,
          apres: row,
        });
        res.status(201).json({ item: row });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
    update: async (req, res) => {
      try {
        const tid = req.tenantId;
        const { id } = req.params;
        const nowIso = new Date().toISOString();
        const patch = { ...req.body, updated_at: nowIso };
        delete patch.id;
        delete patch.tenant_id;

        const { data, error } = await supabaseAdmin.from(table).update(patch).eq('id', id).eq('tenant_id', tid).select().single();
        let row = data;
        if (error && isMissingSchemaError(error)) {
          const settings = await readTenantSettings(tid);
          const raw = Array.isArray(settings[settingsKey]) ? settings[settingsKey] : [];
          const next = raw.map((it) => (it.id === id ? { ...it, ...patch } : it));
          row = next.find((it) => it.id === id);
          if (!row) return res.status(404).json({ error: 'Élément introuvable.' });
          await writeTenantSettingsKey(tid, settingsKey, next);
        } else if (error) {
          return res.status(400).json({ error: error.message });
        }

        await logActivity({
          supabaseAdmin,
          tenantId: tid,
          user: req.user,
          action: 'modification',
          entiteType,
          entiteId: id,
          details: `Modification ${entiteType} : ${labelFn ? labelFn(row) : (row[requiredField] || id)}`,
          apres: patch,
        });
        res.json({ item: row });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
    archive: async (req, res) => {
      try {
        const tid = req.tenantId;
        const { id } = req.params;
        const nowIso = new Date().toISOString();
        const { data, error } = await supabaseAdmin
          .from(table)
          .update({ archived_at: nowIso, archived_by: req.user?.id || null, updated_at: nowIso })
          .eq('id', id)
          .eq('tenant_id', tid)
          .select()
          .single();

        let row = data;
        if (error && isMissingSchemaError(error)) {
          const settings = await readTenantSettings(tid);
          const raw = Array.isArray(settings[settingsKey]) ? settings[settingsKey] : [];
          const next = raw.map((it) => (it.id === id ? { ...it, archived_at: nowIso, archived_by: req.user?.id || null } : it));
          row = next.find((it) => it.id === id);
          await writeTenantSettingsKey(tid, settingsKey, next);
        } else if (error) {
          return res.status(400).json({ error: error.message });
        }

        await logActivity({
          supabaseAdmin,
          tenantId: tid,
          user: req.user,
          action: 'archivage',
          entiteType,
          entiteId: id,
          details: `Archivage ${entiteType} (${id})`,
          apres: { archived_at: nowIso },
        });
        res.json({ item: row, message: 'Élément archivé.' });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
    restore: async (req, res) => {
      try {
        const tid = req.tenantId;
        const { id } = req.params;
        const nowIso = new Date().toISOString();
        const { data, error } = await supabaseAdmin
          .from(table)
          .update({ archived_at: null, archived_by: null, updated_at: nowIso })
          .eq('id', id)
          .eq('tenant_id', tid)
          .select()
          .single();

        let row = data;
        if (error && isMissingSchemaError(error)) {
          const settings = await readTenantSettings(tid);
          const raw = Array.isArray(settings[settingsKey]) ? settings[settingsKey] : [];
          const next = raw.map((it) => (it.id === id ? { ...it, archived_at: null, archived_by: null } : it));
          row = next.find((it) => it.id === id);
          await writeTenantSettingsKey(tid, settingsKey, next);
        } else if (error) {
          return res.status(400).json({ error: error.message });
        }

        await logActivity({
          supabaseAdmin,
          tenantId: tid,
          user: req.user,
          action: 'restauration',
          entiteType,
          entiteId: id,
          details: `Restauration ${entiteType} (${id})`,
        });
        res.json({ item: row, message: 'Élément restauré.' });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  };
}

const ressourcesHandlers = makeCollectionHandlers({
  table: 'ressources',
  settingsKey: 'ressources',
  entiteType: 'ressource',
  requiredField: 'nom',
});

const servicesHandlers = makeCollectionHandlers({
  table: 'services_additionnels',
  settingsKey: 'services_additionnels',
  entiteType: 'service',
  requiredField: 'nom',
});

const incidentsHandlers = makeCollectionHandlers({
  table: 'incidents_maintenance',
  settingsKey: 'incidents_maintenance',
  entiteType: 'incident',
  requiredField: 'titre',
});

// ── LOT 4 : Factures verrouillées, Devis, Avoirs & PDF conforme ────────────
async function loadDevisFacturesStore(tid) {
  const { data, error } = await supabaseAdmin
    .from('devis_factures')
    .select('*')
    .eq('tenant_id', tid)
    .order('created_at', { ascending: false });
  if (!error && Array.isArray(data)) {
    return { mode: 'sql', items: data };
  }
  const settings = await readTenantSettings(tid);
  return { mode: 'settings', items: Array.isArray(settings.devis_factures) ? settings.devis_factures : [] };
}

function normalizeInvoiceLinesAndTotals(rawLines, body = {}, defaultTva = 19) {
  const tvaPct = Number(body.tva_pct ?? body.tva_rate ?? defaultTva);
  const safeTva = Number.isFinite(tvaPct) && tvaPct >= 0 ? tvaPct : 19;
  const lines = Array.isArray(rawLines) && rawLines.length > 0
    ? rawLines.map((l) => {
        const q = Math.max(1, Number(l.quantite || 1));
        const pu = roundMillime(l.prix_unitaire_ht ?? l.pu_ht ?? 0);
        const totalHt = roundMillime(q * pu);
        return {
          designation: String(l.designation || 'Prestation coworking').trim(),
          quantite: q,
          prix_unitaire_ht: pu,
          total_ht: totalHt,
        };
      })
    : [
        {
          designation: String(body.notes || 'Prestation DESKYWORK').trim() || 'Prestation DESKYWORK',
          quantite: 1,
          prix_unitaire_ht: roundMillime(body.montant_ht || 0),
          total_ht: roundMillime(body.montant_ht || 0),
        },
      ];

  const montantHT = body.montant_ht != null && (!Array.isArray(rawLines) || rawLines.length === 0)
    ? roundMillime(body.montant_ht)
    : roundMillime(lines.reduce((s, l) => s + l.total_ht, 0));
  const totalTVA = roundMillime(montantHT * (safeTva / 100));
  const timbreFiscal = body.timbre_fiscal !== undefined
    ? roundMillime(body.timbre_fiscal)
    : ((body.type || 'facture') === 'facture' ? 1 : 0);
  const montantTTC = roundMillime(montantHT + totalTVA + timbreFiscal);

  return { lines, montantHT, tvaPct: safeTva, totalTVA, timbreFiscal, montantTTC };
}

const devisFacturesHandlers = {
  list: async (req, res) => {
    try {
      const tid = req.tenantId;
      const includeArchived = req.query.include_archived === 'true' || req.query.include_archived === '1';
      const { items } = await loadDevisFacturesStore(tid);
      const filtered = includeArchived ? items : items.filter((d) => !d.archived_at);
      res.json({ items: filtered });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  create: async (req, res) => {
    try {
      const tid = req.tenantId;
      const body = req.body || {};
      const type = ['devis', 'facture', 'avoir'].includes(body.type) ? body.type : 'facture';
      const statut = body.statut || (type === 'facture' ? 'emise' : 'brouillon');
      const clientNom = String(body.client_nom || '').trim();
      if (!clientNom) {
        return res.status(400).json({ error: 'Le nom du client est obligatoire.' });
      }

      const { data: tenantRow } = await supabaseAdmin.from('tenants').select('*').eq('id', tid).maybeSingle();
      const settings = (tenantRow?.settings && typeof tenantRow.settings === 'object') ? tenantRow.settings : {};
      const defaultTva = Number(settings.tva_defaut_pct ?? 19);
      const docTypeCounter = type === 'avoir' ? 'credit_note' : type === 'devis' ? 'quote' : 'invoice';

      // Numérotation continue et sans trou allouée UNIQUEMENT à l'émission (les brouillons gardent un numéro temporaire)
      let numero = body.numero ? String(body.numero).trim() : '';
      if (!numero) {
        numero = statut === 'brouillon'
          ? `BROUILLON-${Date.now().toString().slice(-6)}`
          : await allocateDocumentNumber(supabaseAdmin, tid, docTypeCounter);
      }

      const calc = normalizeInvoiceLinesAndTotals(body.lignes, { ...body, type }, defaultTva);
      const nowIso = new Date().toISOString();
      const isLockedInvoice = type === 'facture' && statut !== 'brouillon';

      const payload = {
        tenant_id: tid,
        type,
        numero,
        client_nom: clientNom,
        client_email: body.client_email || null,
        client_telephone: body.client_telephone || null,
        client_matricule_fiscal: body.client_matricule_fiscal || null,
        client_adresse: body.client_adresse || null,
        user_id: body.user_id || null,
        personne_id: body.personne_id || null,
        reservation_id: body.reservation_id || null,
        abonnement_id: body.abonnement_id || null,
        paiement_id: body.paiement_id || null,
        lignes: calc.lines,
        montant_ht: calc.montantHT,
        tva_pct: calc.tvaPct,
        total_tva: calc.totalTVA,
        timbre_fiscal: calc.timbreFiscal,
        montant_ttc: calc.montantTTC,
        statut,
        date_emission: body.date_emission || nowIso.slice(0, 10),
        date_echeance: body.date_echeance || null,
        notes: body.notes || null,
        mentions_legales: settings?.taxes_facturation?.mentions_legales || null,
        emetteur_snapshot: {
          nom: tenantRow?.nom || 'DeskyWork',
          adresse: tenantRow?.adresse || '',
          telephone: tenantRow?.telephone || '',
          email: tenantRow?.email || '',
          matricule_fiscal:
            settings?.taxes_facturation?.matricule_fiscal ||
            settings?.taxes_facturation?.matricule_fiscale ||
            settings?.matricule_fiscal ||
            '',
        },
        locked: isLockedInvoice,
        locked_at: isLockedInvoice ? nowIso : null,
        created_by: req.user?.id || null,
        created_at: nowIso,
        updated_at: nowIso,
      };

      const { data, error } = await supabaseAdmin.from('devis_factures').insert(payload).select().single();
      let row = data;
      if (error && isMissingSchemaError(error)) {
        row = { id: crypto.randomUUID(), ...payload, archived_at: null };
        const raw = Array.isArray(settings.devis_factures) ? settings.devis_factures : [];
        await writeTenantSettingsKey(tid, 'devis_factures', [row, ...raw]);
      } else if (error) {
        return res.status(400).json({ error: error.message });
      }

      await logActivity({
        tenantId: tid,
        req,
        action: 'creation',
        entityType: 'devis_facture',
        entityId: row.id,
        entityLabel: `${type.toUpperCase()} ${row.numero} (${calc.montantTTC.toFixed(3)} DT TTC)`,
        afterData: row,
      });

      res.status(201).json({ item: row });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  update: async (req, res) => {
    try {
      const tid = req.tenantId;
      const { id } = req.params;
      const { mode, items } = await loadDevisFacturesStore(tid);
      const existing = items.find((d) => d.id === id);
      if (!existing) return res.status(404).json({ error: 'Document introuvable.' });

      const isFactureLocked =
        existing.locked === true ||
        (existing.type === 'facture' && existing.statut !== 'brouillon') ||
        existing.type === 'avoir';

      if (isFactureLocked) {
        return res.status(409).json({
          error: 'Une facture émise ou un avoir est définitivement verrouillé(e). Pour toute correction ou annulation, générez un avoir.',
          code: 'INVOICE_LOCKED',
        });
      }

      const body = req.body || {};
      const nowIso = new Date().toISOString();
      const nextStatut = body.statut || existing.statut;
      let nextNumero = existing.numero;
      let shouldLock = false;

      // Émission d'un brouillon de facture -> attribuer un numéro continu et verrouiller
      if (existing.type === 'facture' && nextStatut !== 'brouillon') {
        if (!existing.numero || String(existing.numero).startsWith('BROUILLON-')) {
          nextNumero = await allocateDocumentNumber(supabaseAdmin, tid, 'invoice');
        }
        shouldLock = true;
      }

      const calc = normalizeInvoiceLinesAndTotals(body.lignes ?? existing.lignes, {
        ...existing,
        ...body,
        type: existing.type,
      });

      const patch = {
        ...(body.client_nom !== undefined ? { client_nom: body.client_nom } : {}),
        ...(body.client_email !== undefined ? { client_email: body.client_email } : {}),
        ...(body.client_telephone !== undefined ? { client_telephone: body.client_telephone } : {}),
        ...(body.client_matricule_fiscal !== undefined ? { client_matricule_fiscal: body.client_matricule_fiscal } : {}),
        ...(body.client_adresse !== undefined ? { client_adresse: body.client_adresse } : {}),
        ...(body.date_echeance !== undefined ? { date_echeance: body.date_echeance } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        statut: nextStatut,
        numero: nextNumero,
        lignes: calc.lines,
        montant_ht: calc.montantHT,
        tva_pct: calc.tvaPct,
        total_tva: calc.totalTVA,
        timbre_fiscal: calc.timbreFiscal,
        montant_ttc: calc.montantTTC,
        locked: shouldLock,
        locked_at: shouldLock ? nowIso : existing.locked_at,
        updated_at: nowIso,
      };

      let row = null;
      if (mode === 'sql') {
        const { data, error } = await supabaseAdmin
          .from('devis_factures')
          .update(patch)
          .eq('id', id)
          .eq('tenant_id', tid)
          .select()
          .single();
        if (error) return res.status(400).json({ error: error.message });
        row = data;
      } else {
        const nextList = items.map((it) => (it.id === id ? { ...it, ...patch } : it));
        row = nextList.find((it) => it.id === id);
        await writeTenantSettingsKey(tid, 'devis_factures', nextList);
      }

      await logActivity({
        tenantId: tid,
        req,
        action: 'modification',
        entityType: 'devis_facture',
        entityId: id,
        entityLabel: `${row.type.toUpperCase()} ${row.numero}`,
        beforeData: existing,
        afterData: patch,
      });

      res.json({ item: row });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  archive: async (req, res) => {
    try {
      const tid = req.tenantId;
      const { id } = req.params;
      const { mode, items } = await loadDevisFacturesStore(tid);
      const existing = items.find((d) => d.id === id);
      if (!existing) return res.status(404).json({ error: 'Document introuvable.' });

      if (existing.type === 'facture' && existing.statut !== 'brouillon') {
        return res.status(409).json({
          error: 'Une facture émise ne peut pas être archivée directement : générez un avoir comptable.',
          code: 'INVOICE_LOCKED',
        });
      }

      const nowIso = new Date().toISOString();
      const patch = { archived_at: nowIso, archived_by: req.user?.id || null, updated_at: nowIso };
      let row = null;
      if (mode === 'sql') {
        const { data, error } = await supabaseAdmin.from('devis_factures').update(patch).eq('id', id).eq('tenant_id', tid).select().single();
        if (error) return res.status(400).json({ error: error.message });
        row = data;
      } else {
        const nextList = items.map((it) => (it.id === id ? { ...it, ...patch } : it));
        row = nextList.find((it) => it.id === id);
        await writeTenantSettingsKey(tid, 'devis_factures', nextList);
      }

      await logActivity({
        tenantId: tid,
        req,
        action: 'archivage',
        entityType: 'devis_facture',
        entityId: id,
        entityLabel: `${existing.numero}`,
      });
      res.json({ item: row, message: 'Document archivé.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  restore: async (req, res) => {
    try {
      const tid = req.tenantId;
      const { id } = req.params;
      const { mode, items } = await loadDevisFacturesStore(tid);
      const nowIso = new Date().toISOString();
      const patch = { archived_at: null, archived_by: null, updated_at: nowIso };
      let row = null;
      if (mode === 'sql') {
        const { data, error } = await supabaseAdmin.from('devis_factures').update(patch).eq('id', id).eq('tenant_id', tid).select().single();
        if (error) return res.status(400).json({ error: error.message });
        row = data;
      } else {
        const nextList = items.map((it) => (it.id === id ? { ...it, ...patch } : it));
        row = nextList.find((it) => it.id === id);
        await writeTenantSettingsKey(tid, 'devis_factures', nextList);
      }

      await logActivity({
        tenantId: tid,
        req,
        action: 'restauration',
        entityType: 'devis_facture',
        entityId: id,
        entityLabel: row?.numero || id,
      });
      res.json({ item: row, message: 'Document restauré.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
};

// POST /api/admin/devis-factures/:id/avoir — Émission d'un Avoir pour corriger/annuler une facture verrouillée
async function createAvoirFromFacture(req, res) {
  try {
    const tid = req.tenantId;
    const { id } = req.params;
    const { motif_avoir = '' } = req.body || {};
    const cleanMotif = String(motif_avoir || '').trim();
    if (cleanMotif.length < 3) {
      return res.status(400).json({ error: 'Le motif de l’avoir est obligatoire (minimum 3 caractères).' });
    }

    const { mode, items } = await loadDevisFacturesStore(tid);
    const parent = items.find((d) => d.id === id);
    if (!parent) return res.status(404).json({ error: 'Facture introuvable.' });
    if (parent.type !== 'facture') {
      return res.status(400).json({ error: 'Un avoir ne peut être émis que sur une facture.' });
    }
    if (parent.statut === 'avoir_emis') {
      return res.status(409).json({ error: 'Un avoir a déjà été émis pour cette facture.' });
    }

    const numeroAvoir = await allocateDocumentNumber(supabaseAdmin, tid, 'credit_note');
    const nowIso = new Date().toISOString();
    const negLines = (Array.isArray(parent.lignes) ? parent.lignes : []).map((l) => ({
      designation: `Avoir — ${l.designation || parent.numero}`,
      quantite: Number(l.quantite || 1),
      prix_unitaire_ht: -Math.abs(Number(l.prix_unitaire_ht || parent.montant_ht || 0)),
      total_ht: -Math.abs(Number(l.total_ht || parent.montant_ht || 0)),
    }));
    const mHT = -Math.abs(roundMillime(parent.montant_ht || 0));
    const mTVA = -Math.abs(roundMillime(parent.total_tva ?? (Math.abs(mHT) * (Number(parent.tva_pct ?? 19) / 100))));
    const mTimbre = -Math.abs(roundMillime(parent.timbre_fiscal || 0));
    const mTTC = -Math.abs(roundMillime(parent.montant_ttc || 0));

    const avoirPayload = {
      tenant_id: tid,
      type: 'avoir',
      numero: numeroAvoir,
      parent_facture_id: parent.id,
      client_nom: parent.client_nom,
      client_email: parent.client_email || null,
      client_telephone: parent.client_telephone || null,
      client_matricule_fiscal: parent.client_matricule_fiscal || null,
      client_adresse: parent.client_adresse || null,
      user_id: parent.user_id || null,
      personne_id: parent.personne_id || null,
      lignes: negLines.length > 0 ? negLines : [{ designation: `Avoir sur facture ${parent.numero}`, quantite: 1, prix_unitaire_ht: mHT, total_ht: mHT }],
      montant_ht: mHT,
      tva_pct: parent.tva_pct ?? 19,
      total_tva: mTVA,
      timbre_fiscal: mTimbre,
      montant_ttc: mTTC,
      statut: 'emise',
      date_emission: nowIso.slice(0, 10),
      motif_avoir: cleanMotif,
      mentions_legales: parent.mentions_legales || null,
      emetteur_snapshot: parent.emetteur_snapshot || {},
      locked: true,
      locked_at: nowIso,
      created_by: req.user?.id || null,
      created_at: nowIso,
      updated_at: nowIso,
    };

    let avoirRow = null;
    if (mode === 'sql') {
      const { data, error } = await supabaseAdmin.from('devis_factures').insert(avoirPayload).select().single();
      if (error) return res.status(400).json({ error: error.message });
      avoirRow = data;
      await supabaseAdmin.from('devis_factures').update({ statut: 'avoir_emis', updated_at: nowIso }).eq('id', parent.id).eq('tenant_id', tid);
    } else {
      avoirRow = { id: crypto.randomUUID(), ...avoirPayload, archived_at: null };
      const nextList = [
        avoirRow,
        ...items.map((it) => (it.id === parent.id ? { ...it, statut: 'avoir_emis', updated_at: nowIso } : it)),
      ];
      await writeTenantSettingsKey(tid, 'devis_factures', nextList);
    }

    await logActivity({
      tenantId: tid,
      req,
      action: 'creation_avoir',
      entityType: 'devis_facture',
      entityId: avoirRow.id,
      entityLabel: `Avoir ${numeroAvoir} sur facture ${parent.numero}`,
      afterData: { parent_facture: parent.numero, motif_avoir: cleanMotif, montant_ttc: mTTC },
    });

    res.status(201).json({ item: avoirRow, message: `Avoir ${numeroAvoir} généré avec succès.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/admin/devis-factures/:id/pdf — Téléchargement PDF sans modifier la numérotation continue
async function downloadDevisFacturePdf(req, res) {
  try {
    const tid = req.tenantId;
    const { id } = req.params;
    const { items } = await loadDevisFacturesStore(tid);
    const doc = items.find((d) => d.id === id);
    if (!doc) return res.status(404).json({ error: 'Document introuvable.' });

    const { data: tenantRow } = await supabaseAdmin.from('tenants').select('*').eq('id', tid).maybeSingle();
    const pdfBuffer = await generateInvoicePDF(doc, tenantRow || {});
    const safeName = `${doc.type || 'document'}-${doc.numero || doc.id}.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── LOT 4 : Permissions RBAC & Rôles personnalisables ──────────────────────
async function getMyPermissions(req, res) {
  try {
    const profile = req.profile;
    const tid = req.tenantId || profile?.tenant_id;
    const { matrix, tenantSettings } = await loadTenantRolesMatrix(tid);
    const staffMeta = tenantSettings?.staff_permissions?.[profile.id] || {};
    const permissions = {};
    for (const def of PERMISSION_DEFINITIONS) {
      permissions[def.key] = evaluatePermission({
        profileRole: profile.role,
        staffMeta,
        rolesMatrix: matrix,
        permKey: def.key,
      });
    }
    res.json({
      role: profile.role,
      custom_role_code: staffMeta.custom_role_code || (profile.role === 'staff' ? 'staff' : 'admin'),
      permissions,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getRolesPermissions(req, res) {
  try {
    const tid = req.tenantId;
    const { matrix } = await loadTenantRolesMatrix(tid);
    res.json({
      definitions: PERMISSION_DEFINITIONS,
      roles: Object.values(matrix),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateRolesPermissions(req, res) {
  try {
    const tid = req.tenantId;
    const incomingRoles = Array.isArray(req.body?.roles)
      ? req.body.roles
      : Object.values(req.body?.roles || {});

    const storedMap = {};
    for (const r of incomingRoles) {
      const code = String(r.code || r.role_code || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_');
      if (!code || code === 'admin' || code === 'super_admin') continue;

      const sanitizedPerms = {};
      for (const def of PERMISSION_DEFINITIONS) {
        const val = Boolean(r.permissions?.[def.key]);
        sanitizedPerms[def.key] = code === 'staff' && HARD_LOCKED_KEYS_FOR_STAFF.has(def.key) ? false : val;
      }

      storedMap[code] = {
        code,
        label: String(r.label || r.role_label || code).trim(),
        is_system: code === 'staff',
        permissions: sanitizedPerms,
      };

      await supabaseAdmin
        .from('roles_permissions')
        .upsert(
          {
            tenant_id: tid,
            role_code: code,
            role_label: storedMap[code].label,
            permissions: sanitizedPerms,
            is_system: code === 'staff',
            updated_by: req.user?.id || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'tenant_id,role_code' }
        )
        .then(() => {})
        .catch(() => {});
    }

    const merged = mergeRoleMatrix(storedMap);
    const curSettings = await readTenantSettings(tid);
    await writeTenantSettingsKey(tid, 'roles_matrix', merged);

    await logActivity({
      tenantId: tid,
      req,
      action: 'modification',
      entityType: 'roles_permissions',
      entityId: tid,
      entityLabel: 'Matrice des rôles et permissions',
      beforeData: curSettings.roles_matrix || null,
      afterData: merged,
    });

    res.json({
      definitions: PERMISSION_DEFINITIONS,
      roles: Object.values(merged),
      message: 'Matrice des permissions enregistrée.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/admin/personnes/merge — Fusion de doublons (verrouillée Responsable, 403 Staff)
async function mergePersonnes(req, res) {
  try {
    const tid = req.tenantId;
    const { source_id, target_id } = req.body || {};
    if (!source_id || !target_id || source_id === target_id) {
      return res.status(400).json({ error: 'source_id et target_id distincts sont requis.' });
    }

    const nowIso = new Date().toISOString();
    await supabaseAdmin.from('reservations').update({ user_id: target_id }).eq('user_id', source_id).eq('tenant_id', tid).then(() => {}).catch(() => {});
    await supabaseAdmin.from('paiements').update({ user_id: target_id }).eq('user_id', source_id).eq('tenant_id', tid).then(() => {}).catch(() => {});
    await supabaseAdmin.from('abonnements').update({ user_id: target_id }).eq('user_id', source_id).eq('tenant_id', tid).then(() => {}).catch(() => {});
    await supabaseAdmin.from('personnes').update({ archived_at: nowIso, archived_by: req.user?.id || null }).eq('id', source_id).eq('tenant_id', tid).then(() => {}).catch(() => {});

    await logActivity({
      tenantId: tid,
      req,
      action: 'fusion_membres',
      entityType: 'personne',
      entityId: target_id,
      entityLabel: `Fusion fiche ${source_id} -> ${target_id}`,
    });

    res.json({ message: 'Fiches fusionnées et doublon archivé.', target_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/admin/automations/run — Déclenchement manuel / opportuniste des automatisations P1 LOT 4
async function triggerLot4Automations(req, res) {
  try {
    const result = await runLot4AutomationsForTenant(supabaseAdmin, req.tenantId, { force: Boolean(req.body?.force) });
    res.json({ summary: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

function normalizePhoneTNAdmin(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00216') && digits.length >= 13) return `+216${digits.slice(5, 13)}`;
  if (digits.startsWith('216') && digits.length >= 11) return `+216${digits.slice(3, 11)}`;
  if (digits.length === 8) return `+216${digits}`;
  return null;
}

// GET /api/admin/personnes/check-phone?telephone=...
async function checkPersonnePhone(req, res) {
  try {
    const tid = req.tenantId;
    const phone = normalizePhoneTNAdmin(req.query.telephone || '');
    if (!phone) return res.json({ valid: false, exists: false, match: null });

    const [{ data: profiles }, { data: guests }, persRes, settings] = await Promise.all([
      supabaseAdmin.from('profiles').select('id, nom, prenom, email, telephone, role').eq('tenant_id', tid),
      supabaseAdmin.from('guests').select('id, nom, prenom, email, telephone').eq('tenant_id', tid),
      Promise.resolve(supabaseAdmin.from('personnes').select('*').eq('tenant_id', tid)).catch(() => ({ data: [] })),
      readTenantSettings(tid),
    ]);

    const matchProfile = (profiles || []).find((p) => !isStaffRole(p.role) && normalizePhoneTNAdmin(p.telephone) === phone);
    if (matchProfile) {
      return res.json({ valid: true, normalized: phone, exists: true, match: { ...matchProfile, source: 'profile', type_personne: 'membre' } });
    }
    const persList = Array.isArray(persRes?.data) && persRes.data.length > 0
      ? persRes.data
      : (Array.isArray(settings?.personnes) ? settings.personnes : []);
    const matchPers = persList.find((p) => normalizePhoneTNAdmin(p.telephone) === phone);
    if (matchPers) {
      return res.json({ valid: true, normalized: phone, exists: true, match: { ...matchPers, source: 'personnes' } });
    }
    const matchGuest = (guests || []).find((g) => normalizePhoneTNAdmin(g.telephone) === phone);
    if (matchGuest) {
      return res.json({ valid: true, normalized: phone, exists: true, match: { ...matchGuest, source: 'guest', type_personne: 'invite' } });
    }

    res.json({ valid: true, normalized: phone, exists: false, match: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/admin/personnes/:id/360 — Fiche Membre / Invité / Prospect 360°
async function getPersonne360(req, res) {
  try {
    const tid = req.tenantId;
    const { id } = req.params;

    const [{ data: prof }, { data: guest }, persRes, settings] = await Promise.all([
      supabaseAdmin.from('profiles').select('*').eq('id', id).maybeSingle(),
      supabaseAdmin.from('guests').select('*').eq('id', id).maybeSingle(),
      Promise.resolve(supabaseAdmin.from('personnes').select('*').eq('id', id).maybeSingle()).catch(() => ({ data: null })),
      readTenantSettings(tid),
    ]);

    const fbPers = (Array.isArray(settings?.personnes) ? settings.personnes : []).find((p) => p.id === id) || null;
    const rawPers = persRes?.data || fbPers;

    if (!prof && !guest && !rawPers) {
      return res.status(404).json({ error: 'Fiche personne introuvable.' });
    }

    const personTenant = prof?.tenant_id || guest?.tenant_id || rawPers?.tenant_id || tid;
    if (tid && personTenant && personTenant !== tid) {
      return res.status(403).json({ error: 'Accès non autorisé.' });
    }

    const linkedUserId = prof?.id || rawPers?.profile_id || null;
    const linkedGuestId = guest?.id || null;

    const personne = {
      id,
      profile_id: linkedUserId,
      guest_id: linkedGuestId,
      source: prof ? 'profile' : rawPers ? 'personnes' : 'guest',
      type_personne: rawPers?.type_personne || (guest ? 'invite' : 'membre'),
      nom: rawPers?.nom || prof?.nom || guest?.nom || '',
      prenom: rawPers?.prenom || prof?.prenom || guest?.prenom || '',
      email: rawPers?.email || prof?.email || guest?.email || null,
      telephone: rawPers?.telephone || prof?.telephone || guest?.telephone || null,
      type_membre: prof?.type_membre || rawPers?.type_membre || 'particulier',
      statut_compte: prof?.statut_compte || (rawPers?.archived_at ? 'archive' : 'actif'),
      entreprise_id: prof?.entreprise_id || rawPers?.entreprise_id || null,
      entreprise_nom: rawPers?.entreprise_nom || null,
      notes_internes: (settings?.personnes_notes && settings.personnes_notes[id] !== undefined)
        ? settings.personnes_notes[id]
        : (rawPers?.notes_internes || rawPers?.notes || prof?.notes_internes || ''),
      created_at: rawPers?.created_at || prof?.created_at || guest?.created_at,
    };

    const userIdsToQuery = [linkedUserId, id].filter(Boolean);
    const [
      { data: entreprise },
      { data: abonnements },
      { data: reservations },
      { data: paiements },
      { data: documents },
      { data: formationsInsc },
      incRes,
      logs,
    ] = await Promise.all([
      personne.entreprise_id
        ? supabaseAdmin.from('entreprises').select('*').eq('id', personne.entreprise_id).maybeSingle()
        : Promise.resolve({ data: null }),
      linkedUserId
        ? supabaseAdmin.from('abonnements').select('*').eq('user_id', linkedUserId).order('date_fin', { ascending: false })
        : Promise.resolve({ data: [] }),
      supabaseAdmin
        .from('reservations')
        .select('*, espaces(id, nom, type, tarif_horaire), paiements(id, statut, mode, montant)')
        .eq('tenant_id', tid)
        .or([
          linkedUserId ? `user_id.eq.${linkedUserId}` : null,
          linkedGuestId ? `guest_id.eq.${linkedGuestId}` : null,
        ].filter(Boolean).join(',') || `user_id.eq.${id}`)
        .order('date_debut', { ascending: false })
        .limit(50),
      supabaseAdmin
        .from('paiements')
        .select('*')
        .eq('tenant_id', tid)
        .in('user_id', userIdsToQuery)
        .order('created_at', { ascending: false })
        .limit(50),
      linkedUserId
        ? supabaseAdmin.from('documents_membres').select('*').eq('user_id', linkedUserId).order('created_at', { ascending: false })
        : Promise.resolve({ data: [] }),
      linkedUserId
        ? supabaseAdmin.from('inscriptions_formations').select('*, formations(id, titre, date_debut, date_fin, statut)').eq('user_id', linkedUserId).order('created_at', { ascending: false })
        : Promise.resolve({ data: [] }),
      Promise.resolve(supabaseAdmin.from('incidents_maintenance').select('*').eq('tenant_id', tid).order('created_at', { ascending: false })).catch(() => ({ data: [] })),
      listActivityLogs({ supabaseAdmin, tenantId: tid, limit: 150 }),
    ]);

    const aboList = abonnements || [];
    const activeAbo = aboList.find((a) => ['active', 'actif', 'a_renouveler'].includes(String(a.statut || '').toLowerCase())) || aboList[0] || null;
    const devisFactures = (Array.isArray(settings?.devis_factures) ? settings.devis_factures : [])
      .filter((df) => df.user_id === id || df.personne_id === id || df.client_nom === `${personne.prenom} ${personne.nom}`.trim());

    const incidentsList = (incRes?.data && Array.isArray(incRes.data) ? incRes.data : (Array.isArray(settings?.incidents_maintenance) ? settings.incidents_maintenance : []))
      .filter((inc) => inc.user_id === id || inc.personne_id === id);

    const resIdsSet = new Set((reservations || []).map((r) => r.id));
    const payIdsSet = new Set((paiements || []).map((p) => p.id));
    const chronologie = (logs || []).filter((l) =>
      l.entity_id === id
      || (linkedUserId && l.entity_id === linkedUserId)
      || resIdsSet.has(l.entity_id)
      || payIdsSet.has(l.entity_id)
    );

    res.json({
      personne,
      entreprise: entreprise || (personne.entreprise_nom ? { raison_sociale: personne.entreprise_nom } : null),
      abonnement_actif: activeAbo,
      abonnements: aboList,
      reservations: reservations || [],
      paiements: paiements || [],
      devis_factures: devisFactures,
      documents_signes: documents || [],
      formations: formationsInsc || [],
      incidents: incidentsList,
      chronologie,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// PATCH /api/admin/personnes/:id/notes — Mise à jour notes internes 360°
async function updatePersonneNotes(req, res) {
  try {
    const tid = req.tenantId;
    const { id } = req.params;
    const notes = String(req.body?.notes_internes ?? req.body?.notes ?? '');

    await supabaseAdmin.from('personnes').update({ notes_internes: notes, notes }).eq('id', id).eq('tenant_id', tid).then(() => {}).catch(() => {});
    await supabaseAdmin.from('profiles').update({ notes_internes: notes }).eq('id', id).eq('tenant_id', tid).then(() => {}).catch(() => {});

    const settings = await readTenantSettings(tid);
    const nextNotesMap = { ...(settings.personnes_notes || {}), [id]: notes };
    const nextPers = (Array.isArray(settings.personnes) ? settings.personnes : [])
      .map((p) => (p.id === id ? { ...p, notes_internes: notes, notes } : p));
    await supabaseAdmin
      .from('tenants')
      .update({ settings: { ...settings, personnes_notes: nextNotesMap, personnes: nextPers }, updated_at: new Date().toISOString() })
      .eq('id', tid);

    await logActivity({
      tenantId: tid,
      req,
      action: 'modification_notes',
      entityType: 'personne',
      entityId: id,
      entityLabel: 'Mise à jour des notes internes (Fiche 360°)',
      afterData: { notes_internes: notes },
    });

    res.json({ notes_internes: notes, message: 'Notes internes enregistrées.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getTenant,
  updateTenant,
  createEspace,
  updateEspace,
  deleteEspace,
  archiveEspace,
  restoreEspace,
  updateEspaceTarifs,
  getTarifHistory,
  completeOnboarding,
  listMembers,
  createAdminConversation,
  listAdminConversations,
  uploadPhoto,
  globalSearch,
  getClientsOverview,
  createMember,
  createPersonne,
  archivePersonne,
  restorePersonne,
  mergePersonnes,
  checkPersonnePhone,
  getPersonne360,
  updatePersonneNotes,
  getMemberHistory,
  listStaff,
  createStaff,
  updateStaff,
  deleteStaff,
  getMyPermissions,
  getRolesPermissions,
  updateRolesPermissions,
  getSubscriptionOverview,
  requestPackUpgrade,
  downloadDeskyInvoicePdf,
  getNotificationsSupportState,
  updateAlertSettings,
  createSupportTicket,
  getMarketplaceStats,
  getActivityLog,
  getPacks,
  triggerLot4Automations,
  ressourcesHandlers,
  servicesHandlers,
  incidentsHandlers,
  devisFacturesHandlers,
  createAvoirFromFacture,
  downloadDevisFacturePdf,
};
