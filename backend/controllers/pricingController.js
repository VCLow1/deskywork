// controllers/pricingController.js — MODULE A : Tarification HT/TTC & codes promo (LOT 2)
const { supabaseAdmin } = require('../config/supabase');
const { SUBSCRIPTION_DURATIONS, MEMBER_TYPE_TO_PLAN, SUBSCRIPTION_LABELS } = require('../config/constants');
const { todayISO, findActiveTarif, findValidPromoCode, applyPromoDiscount, DEFAULT_TARIFS } = require('../models/helpers');
const { applyTenantFilter } = require('../middleware/guards');
const { DEFAULT_TVA_PCT, roundMillime, computeTTC } = require('../models/pricingMath');
const { logActivity } = require('../models/activityLogger');

async function getTenantArchivedList(tid, key) {
  if (!tid) return new Set();
  const { data } = await supabaseAdmin.from('tenants').select('settings').eq('id', tid).maybeSingle();
  return new Set(Array.isArray(data?.settings?.[key]) ? data.settings[key] : []);
}

async function setTenantArchivedId(tid, key, id, add = true) {
  if (!tid) return;
  const { data } = await supabaseAdmin.from('tenants').select('settings').eq('id', tid).maybeSingle();
  const cur = (data?.settings && typeof data.settings === 'object') ? data.settings : {};
  const list = Array.isArray(cur[key]) ? cur[key] : [];
  const next = add ? Array.from(new Set([...list, id])) : list.filter((x) => x !== id);
  await supabaseAdmin.from('tenants').update({ settings: { ...cur, [key]: next } }).eq('id', tid);
}

const ESPACE_TYPES = ['open_space', 'private_office', 'meeting_room', 'training_room', 'event_space', 'hot_desk', 'dedicated_desk'];

function normalizeTypeEspace(value) {
  if (value == null || value === '') return null;
  const v = String(value);
  if (!ESPACE_TYPES.includes(v)) return null;
  return v;
}

async function getPricing(req, res) {
  try {
    const plan = req.query.plan_tarifaire
      || MEMBER_TYPE_TO_PLAN[req.profile.type_membre]
      || 'standard';
    const today = todayISO();
    const typeEspace = normalizeTypeEspace(req.query.type_espace);

    let q = supabaseAdmin
      .from('tarifs_abonnements')
      .select('*')
      .eq('plan_tarifaire', plan)
      .eq('actif', true)
      .lte('date_debut', today);
    if (req.tenantId) q = q.eq('tenant_id', req.tenantId);
    // Si un type d'espace est précisé : montrer les formules qui lui sont
    // dédiées, ainsi que les formules génériques (tous types d'espaces).
    if (typeEspace) {
      q = q.or(`type_espace.is.null,type_espace.eq.${typeEspace}`);
    }
    const { data, error } = await q.order('type_abonnement', { ascending: true });

    let tarifs = [];
    if (!error && data && data.length > 0) {
      tarifs = data.filter((t) => !t.date_fin || t.date_fin >= today);
    }
    if (tarifs.length === 0) {
      tarifs = DEFAULT_TARIFS.filter((t) => t.plan_tarifaire === plan);
    }
    res.json({
      plan_tarifaire: plan,
      tarifs: tarifs.map((t) => ({
        ...t,
        label: SUBSCRIPTION_LABELS[t.type_abonnement] || t.type_abonnement,
        duree_jours: SUBSCRIPTION_DURATIONS[t.type_abonnement] || null,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getPricingAll(req, res) {
  try {
    const includeArchived = req.query.include_archived === 'true' || req.query.include_archived === '1';
    let query = supabaseAdmin
      .from('tarifs_abonnements')
      .select('*')
      .order('type_abonnement', { ascending: true });
    query = applyTenantFilter(query, req);
    const { data, error } = await query;

    let list = data;
    if (error || !list || list.length === 0) {
      list = DEFAULT_TARIFS;
    }
    const archIds = await getTenantArchivedList(req.tenantId, 'archived_pricing');
    const enriched = (list || []).map((t) => {
      const tvaPct = Number(t.tva_pct ?? DEFAULT_TVA_PCT);
      const prixHT = Number(t.prix_ht ?? t.prix ?? 0);
      const prixTTC = t.prix_ttc !== undefined && t.prix_ttc !== null ? Number(t.prix_ttc) : computeTTC(prixHT, tvaPct);
      return {
        ...t,
        prix_ht: roundMillime(prixHT),
        tva_pct: tvaPct,
        prix_ttc: roundMillime(prixTTC),
        archived_at: t.archived_at || (archIds.has(t.id) ? (t.updated_at || t.created_at || new Date().toISOString()) : null),
      };
    });
    res.json({ tarifs: includeArchived ? enriched : enriched.filter((t) => !t.archived_at) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createPricing(req, res) {
  try {
    const { type_abonnement, plan_tarifaire, prix, prix_ht, tva_pct, date_debut, date_fin, actif } = req.body;
    const type_espace = normalizeTypeEspace(req.body.type_espace);
    const baseHT = prix_ht !== undefined ? Number(prix_ht) : Number(prix);
    const tvaRate = tva_pct !== undefined ? Number(tva_pct) : DEFAULT_TVA_PCT;

    if (!type_abonnement || !plan_tarifaire || !Number.isFinite(baseHT)) {
      return res.status(400).json({ error: 'type_abonnement, plan_tarifaire et prix HT sont requis.' });
    }

    if (req.body.type_espace != null && req.body.type_espace !== '' && !type_espace) {
      return res.status(400).json({ error: 'type_espace invalide. Valeurs possibles : ' + ESPACE_TYPES.join(', ') + '.' });
    }

    const htRounded = roundMillime(baseHT);
    const ttcRounded = computeTTC(htRounded, tvaRate);
    let { data, error } = await supabaseAdmin
      .from('tarifs_abonnements')
      .insert({
        tenant_id: req.tenantId,
        type_abonnement,
        plan_tarifaire,
        prix: htRounded,
        prix_ht: htRounded,
        prix_ttc: ttcRounded,
        tva_pct: tvaRate,
        date_debut: date_debut || todayISO(),
        date_fin: date_fin || null,
        actif: actif !== false,
        type_espace,
      })
      .select()
      .single();

    if (error && /column|does not exist|schema cache/i.test(error.message || '')) {
      ({ data, error } = await supabaseAdmin
        .from('tarifs_abonnements')
        .insert({
          tenant_id: req.tenantId,
          type_abonnement,
          plan_tarifaire,
          prix: htRounded,
          tva_pct: tvaRate,
          date_debut: date_debut || todayISO(),
          date_fin: date_fin || null,
          actif: actif !== false,
          type_espace,
        })
        .select()
        .single());
    }

    if (error) return res.status(400).json({ error: error.message });

    await logActivity({
      supabaseAdmin,
      tenantId: req.tenantId,
      user: req.user,
      action: 'creation',
      entiteType: 'tarif',
      entiteId: data.id,
      details: `Création formule ${type_abonnement} (${htRounded.toFixed(3)} DT HT / ${ttcRounded.toFixed(3)} DT TTC)`,
      apres: data,
    });

    res.status(201).json({ tarif: { ...data, prix_ht: htRounded, prix_ttc: ttcRounded, tva_pct: tvaRate } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updatePricing(req, res) {
  try {
    const allowed = ['prix', 'prix_ht', 'tva_pct', 'date_debut', 'date_fin', 'actif', 'type_espace'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (updates.type_espace !== undefined) {
      updates.type_espace = normalizeTypeEspace(updates.type_espace);
      if (req.body.type_espace != null && req.body.type_espace !== '' && !updates.type_espace) {
        return res.status(400).json({ error: 'type_espace invalide. Valeurs possibles : ' + ESPACE_TYPES.join(', ') + '.' });
      }
    }
    if (updates.prix_ht !== undefined || updates.prix !== undefined) {
      const ht = roundMillime(updates.prix_ht ?? updates.prix);
      const tva = Number(updates.tva_pct ?? DEFAULT_TVA_PCT);
      updates.prix = ht;
      updates.prix_ht = ht;
      updates.prix_ttc = computeTTC(ht, tva);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Aucune mise à jour fournie.' });
    }

    let { data, error } = await supabaseAdmin
      .from('tarifs_abonnements')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error && /column|does not exist|schema cache/i.test(error.message || '')) {
      const safeUpdates = { ...updates };
      delete safeUpdates.prix_ht;
      delete safeUpdates.prix_ttc;
      ({ data, error } = await supabaseAdmin.from('tarifs_abonnements').update(safeUpdates).eq('id', req.params.id).select().single());
    }

    if (error) return res.status(400).json({ error: error.message });

    await logActivity({
      supabaseAdmin,
      tenantId: req.tenantId,
      user: req.user,
      action: 'modification',
      entiteType: 'tarif',
      entiteId: req.params.id,
      details: `Mise à jour de la formule tarifaire ${data.type_abonnement || req.params.id}`,
      apres: updates,
    });

    res.json({ tarif: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function validatePromoCode(req, res) {
  try {
    const { code, type_abonnement, plan_tarifaire } = req.body;
    const type_espace = normalizeTypeEspace(req.body.type_espace);

    if (!code || !type_abonnement) {
      return res.status(400).json({ error: 'code et type_abonnement sont requis.' });
    }

    const plan = plan_tarifaire
      || MEMBER_TYPE_TO_PLAN[req.profile.type_membre]
      || 'standard';

    const promo = await findValidPromoCode(code, req.tenantId);
    if (!promo) {
      return res.status(404).json({ valid: false, error: 'Code promo invalide ou expiré.' });
    }

    const tarif = await findActiveTarif(type_abonnement, plan, req.tenantId, type_espace);
    if (!tarif) {
      return res.status(404).json({ valid: false, error: 'Tarif introuvable pour cet abonnement.' });
    }

    const prixInitial = Number(tarif.prix);
    const { prixFinal, reduction } = applyPromoDiscount(prixInitial, promo);

    res.json({
      valid: true,
      code: promo.code,
      type_reduction: promo.type_reduction,
      valeur: Number(promo.valeur),
      plan_tarifaire: plan,
      type_abonnement,
      prix_initial: prixInitial,
      prix_final: prixFinal,
      reduction,
      tva_pct: Number(tarif.tva_pct),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function listPromoCodes(req, res) {
  try {
    const includeArchived = req.query.include_archived === 'true' || req.query.include_archived === '1';
    let query = supabaseAdmin
      .from('codes_promo')
      .select('*')
      .order('created_at', { ascending: false });
    query = applyTenantFilter(query, req);
    const { data, error } = await query;

    if (error) return res.status(500).json({ error: error.message });
    const archIds = await getTenantArchivedList(req.tenantId, 'archived_promo_codes');
    const enriched = (data || []).map((c) => ({
      ...c,
      archived_at: c.archived_at || (archIds.has(c.id) ? (c.updated_at || c.created_at) : null),
    }));
    res.json({ promoCodes: includeArchived ? enriched : enriched.filter((c) => !c.archived_at) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createPromoCode(req, res) {
  try {
    const { code, type_reduction, valeur, date_debut, date_fin, utilisations_max, actif } = req.body;

    if (!code || !type_reduction || valeur == null) {
      return res.status(400).json({ error: 'code, type_reduction et valeur sont requis.' });
    }

    const { data, error } = await supabaseAdmin
      .from('codes_promo')
      .insert({
        tenant_id: req.tenantId,
        code: code.toUpperCase(),
        type_reduction,
        valeur,
        date_debut: date_debut || todayISO(),
        date_fin: date_fin || null,
        utilisations_max: utilisations_max ?? null,
        actif: actif !== false,
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ promoCode: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updatePromoCode(req, res) {
  try {
    const allowed = ['type_reduction', 'valeur', 'date_debut', 'date_fin', 'utilisations_max', 'actif'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Aucune mise à jour fournie.' });
    }

    const { data, error } = await supabaseAdmin
      .from('codes_promo')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ promoCode: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getMyPricingHistory(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('historique_tarifs')
      .select('*, codes_promo(code, type_reduction, valeur)')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) return res.json({ history: [] });
    res.json({ history: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function archivePricing(req, res) {
  try {
    const nowIso = new Date().toISOString();
    let { data, error } = await supabaseAdmin
      .from('tarifs_abonnements')
      .update({ actif: false, archived_at: nowIso, archived_by: req.user?.id || null })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error && /column|does not exist|schema cache/i.test(error.message || '')) {
      ({ data, error } = await supabaseAdmin.from('tarifs_abonnements').update({ actif: false }).eq('id', req.params.id).select().single());
    }
    if (error) return res.status(400).json({ error: error.message });
    await setTenantArchivedId(req.tenantId, 'archived_pricing', req.params.id, true);
    await logActivity({
      supabaseAdmin,
      tenantId: req.tenantId,
      user: req.user,
      action: 'archivage',
      entiteType: 'tarif',
      entiteId: req.params.id,
      details: `Archivage du tarif ${data?.type_abonnement || req.params.id}`,
    });
    res.json({ tarif: { ...data, archived_at: nowIso }, message: 'Tarif archivé.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function restorePricing(req, res) {
  try {
    let { data, error } = await supabaseAdmin
      .from('tarifs_abonnements')
      .update({ actif: true, archived_at: null, archived_by: null })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error && /column|does not exist|schema cache/i.test(error.message || '')) {
      ({ data, error } = await supabaseAdmin.from('tarifs_abonnements').update({ actif: true }).eq('id', req.params.id).select().single());
    }
    if (error) return res.status(400).json({ error: error.message });
    await setTenantArchivedId(req.tenantId, 'archived_pricing', req.params.id, false);
    await logActivity({
      supabaseAdmin,
      tenantId: req.tenantId,
      user: req.user,
      action: 'restauration',
      entiteType: 'tarif',
      entiteId: req.params.id,
      details: `Restauration du tarif ${data?.type_abonnement || req.params.id}`,
    });
    res.json({ tarif: data, message: 'Tarif restauré.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function archivePromoCode(req, res) {
  try {
    const nowIso = new Date().toISOString();
    let { data, error } = await supabaseAdmin
      .from('codes_promo')
      .update({ actif: false, archived_at: nowIso, archived_by: req.user?.id || null })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error && /column|does not exist|schema cache/i.test(error.message || '')) {
      ({ data, error } = await supabaseAdmin.from('codes_promo').update({ actif: false }).eq('id', req.params.id).select().single());
    }
    if (error) return res.status(400).json({ error: error.message });
    await setTenantArchivedId(req.tenantId, 'archived_promo_codes', req.params.id, true);
    await logActivity({
      supabaseAdmin,
      tenantId: req.tenantId,
      user: req.user,
      action: 'archivage',
      entiteType: 'code_promo',
      entiteId: req.params.id,
      details: `Archivage du code promo ${data?.code || req.params.id}`,
    });
    res.json({ promoCode: { ...data, archived_at: nowIso }, message: 'Code promo archivé.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function restorePromoCode(req, res) {
  try {
    let { data, error } = await supabaseAdmin
      .from('codes_promo')
      .update({ actif: true, archived_at: null, archived_by: null })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error && /column|does not exist|schema cache/i.test(error.message || '')) {
      ({ data, error } = await supabaseAdmin.from('codes_promo').update({ actif: true }).eq('id', req.params.id).select().single());
    }
    if (error) return res.status(400).json({ error: error.message });
    await setTenantArchivedId(req.tenantId, 'archived_promo_codes', req.params.id, false);
    await logActivity({
      supabaseAdmin,
      tenantId: req.tenantId,
      user: req.user,
      action: 'restauration',
      entiteType: 'code_promo',
      entiteId: req.params.id,
      details: `Restauration du code promo ${data?.code || req.params.id}`,
    });
    res.json({ promoCode: data, message: 'Code promo restauré.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getPricing,
  getPricingAll,
  createPricing,
  updatePricing,
  archivePricing,
  restorePricing,
  validatePromoCode,
  listPromoCodes,
  createPromoCode,
  updatePromoCode,
  archivePromoCode,
  restorePromoCode,
  getMyPricingHistory,
};
