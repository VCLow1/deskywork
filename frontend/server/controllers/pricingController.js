// controllers/pricingController.js — MODULE A : Tarification & codes promo
const { supabaseAdmin } = require('../config/supabase');
const { SUBSCRIPTION_DURATIONS, MEMBER_TYPE_TO_PLAN, SUBSCRIPTION_LABELS } = require('../config/constants');
const { todayISO, findActiveTarif, findValidPromoCode, applyPromoDiscount } = require('../models/helpers');
const { applyTenantFilter } = require('../middleware/guards');

const ESPACE_TYPES = ['open_space', 'private_office', 'meeting_room', 'training_room', 'event_space'];

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

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const tarifs = (data || []).filter((t) => !t.date_fin || t.date_fin >= today);
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
    let query = supabaseAdmin
      .from('tarifs_abonnements')
      .select('*')
      .order('type_abonnement', { ascending: true });
    query = applyTenantFilter(query, req);
    const { data, error } = await query;

    if (error) return res.status(500).json({ error: error.message });
    res.json({ tarifs: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createPricing(req, res) {
  try {
    const { type_abonnement, plan_tarifaire, prix, tva_pct, date_debut, date_fin, actif } = req.body;
    const type_espace = normalizeTypeEspace(req.body.type_espace);

    if (!type_abonnement || !plan_tarifaire || prix == null) {
      return res.status(400).json({ error: 'type_abonnement, plan_tarifaire et prix sont requis.' });
    }

    if (req.body.type_espace != null && req.body.type_espace !== '' && !type_espace) {
      return res.status(400).json({ error: 'type_espace invalide. Valeurs possibles : ' + ESPACE_TYPES.join(', ') + '.' });
    }

    const { data, error } = await supabaseAdmin
      .from('tarifs_abonnements')
      .insert({
        tenant_id: req.tenantId,
        type_abonnement,
        plan_tarifaire,
        prix,
        tva_pct: tva_pct ?? 19,
        date_debut: date_debut || todayISO(),
        date_fin: date_fin || null,
        actif: actif !== false,
        type_espace,
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ tarif: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updatePricing(req, res) {
  try {
    const allowed = ['prix', 'tva_pct', 'date_debut', 'date_fin', 'actif', 'type_espace'];
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

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Aucune mise à jour fournie.' });
    }

    const { data, error } = await supabaseAdmin
      .from('tarifs_abonnements')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
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
    let query = supabaseAdmin
      .from('codes_promo')
      .select('*')
      .order('created_at', { ascending: false });
    query = applyTenantFilter(query, req);
    const { data, error } = await query;

    if (error) return res.status(500).json({ error: error.message });
    res.json({ promoCodes: data });
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

    if (error) return res.status(500).json({ error: error.message });
    res.json({ history: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getPricing,
  getPricingAll,
  createPricing,
  updatePricing,
  validatePromoCode,
  listPromoCodes,
  createPromoCode,
  updatePromoCode,
  getMyPricingHistory,
};
