// controllers/subscriptionsController.js — MODULE A : Abonnements
const { supabaseAdmin } = require('../config/supabase');
const { SUBSCRIPTION_DURATIONS, MEMBER_TYPE_TO_PLAN } = require('../config/constants');
const { todayISO, addDays, findActiveTarif, findValidPromoCode, applyPromoDiscount } = require('../models/helpers');
const { applyTenantFilter } = require('../middleware/guards');

async function getMySubscriptions(req, res) {
  try {
    const { data, error } = await req.db
      .from('abonnements')
      .select('*')
      .eq('user_id', req.user.id)
      .order('date_debut', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ subscriptions: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getMyActiveSubscription(req, res) {
  try {
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await req.db
      .from('abonnements')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('statut', 'active')
      .lte('date_debut', today)
      .gte('date_fin', today)
      .order('date_fin', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ subscription: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createSubscription(req, res) {
  try {
    const { user_id, type, date_debut, renouvellement_auto, code_promo, plan_tarifaire } = req.body;
    const type_espace = req.body.type_espace || null;

    if (!user_id || !type || !date_debut) {
      return res.status(400).json({ error: 'user_id, type et date_debut sont requis.' });
    }

    if (!SUBSCRIPTION_DURATIONS[type] && type !== 'bureau_prive') {
      return res.status(400).json({ error: "Type d'abonnement invalide." });
    }

    let date_fin = req.body.date_fin;
    if (!date_fin) {
      if (type === 'bureau_prive') {
        return res.status(400).json({ error: 'date_fin requise pour bureau_prive.' });
      }
      date_fin = addDays(date_debut, SUBSCRIPTION_DURATIONS[type] - 1);
    }

    if (date_fin < date_debut) {
      return res.status(400).json({ error: 'date_fin doit être >= date_debut.' });
    }

    const { data: memberProfile, error: memberErr } = await supabaseAdmin
      .from('profiles')
      .select('type_membre')
      .eq('id', user_id)
      .single();

    if (memberErr || !memberProfile) {
      return res.status(404).json({ error: 'Membre introuvable.' });
    }

    const plan = plan_tarifaire || MEMBER_TYPE_TO_PLAN[memberProfile.type_membre] || 'standard';
    let tarifInfo = null;
    let promoInfo = null;

    try {
      const tarif = await findActiveTarif(type, plan, req.tenantId, type_espace);
      if (tarif) {
        tarifInfo = tarif;
        if (code_promo) {
          promoInfo = await findValidPromoCode(code_promo, req.tenantId);
          if (!promoInfo) {
            return res.status(400).json({ error: 'Code promo invalide ou expiré.' });
          }
        }
      }
    } catch (pricingErr) {
      console.warn('Tarification non disponible:', pricingErr.message);
    }

    const { data, error } = await supabaseAdmin
      .from('abonnements')
      .insert({
        tenant_id: req.tenantId,
        user_id,
        type,
        date_debut,
        date_fin,
        renouvellement_auto: Boolean(renouvellement_auto),
        statut: 'active',
        type_espace: tarifInfo?.type_espace || type_espace || null,
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    let pricingResult = null;
    if (tarifInfo) {
      const { prixFinal, reduction } = applyPromoDiscount(Number(tarifInfo.prix), promoInfo);
      pricingResult = {
        type_abonnement: type,
        plan_tarifaire: plan,
        prix_initial: Number(tarifInfo.prix),
        prix_final: prixFinal,
        reduction,
        tva_pct: Number(tarifInfo.tva_pct),
        code_promo: promoInfo?.code || null,
        type_espace: tarifInfo.type_espace || null,
      };

      await supabaseAdmin.from('historique_tarifs').insert({
        user_id,
        abonnement_id: data.id,
        type_abonnement: type,
        plan_tarifaire: plan,
        prix_initial: Number(tarifInfo.prix),
        prix_final: prixFinal,
        code_promo_id: promoInfo?.id || null,
      });

      if (promoInfo) {
        await supabaseAdmin
          .from('codes_promo')
          .update({ utilisations_count: promoInfo.utilisations_count + 1 })
          .eq('id', promoInfo.id);
      }
    }

    res.status(201).json({ subscription: data, pricing: pricingResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function subscribeSelf(req, res) {
  try {
    const { type, code_promo, renouvellement_auto } = req.body;
    const type_espace = req.body.type_espace || null;
    const userId = req.user.id;

    if (!type) {
      return res.status(400).json({ error: "Le type d'abonnement est requis." });
    }

    if (!SUBSCRIPTION_DURATIONS[type] && type !== 'bureau_prive') {
      return res.status(400).json({ error: "Type d'abonnement invalide." });
    }

    const today = todayISO();
    const { data: existing } = await supabaseAdmin
      .from('abonnements')
      .select('id, type, date_fin')
      .eq('user_id', userId)
      .eq('statut', 'active')
      .gte('date_fin', today)
      .limit(1);

    if (existing && existing.length > 0) {
      return res.status(400).json({ error: 'Vous avez déjà un abonnement actif. Il expire le ' + existing[0].date_fin + '.' });
    }

    const date_debut = today;
    let date_fin;
    if (type === 'bureau_prive') {
      return res.status(400).json({ error: 'Le bureau privé doit être configuré par un admin.' });
    }
    date_fin = addDays(date_debut, SUBSCRIPTION_DURATIONS[type] - 1);

    const { data: memberProfile } = await supabaseAdmin
      .from('profiles').select('type_membre').eq('id', userId).single();

    const plan = MEMBER_TYPE_TO_PLAN[memberProfile?.type_membre] || 'standard';
    let tarifInfo = null;
    let promoInfo = null;

    try {
      tarifInfo = await findActiveTarif(type, plan, req.tenantId, type_espace);
      if (code_promo && tarifInfo) {
        promoInfo = await findValidPromoCode(code_promo, req.tenantId);
        if (!promoInfo) {
          return res.status(400).json({ error: 'Code promo invalide ou expiré.' });
        }
      }
    } catch (e) {
      console.warn('Tarification non disponible:', e.message);
    }

    const { data, error } = await supabaseAdmin
      .from('abonnements')
      .insert({
        user_id: userId,
        type,
        date_debut,
        date_fin,
        renouvellement_auto: Boolean(renouvellement_auto),
        statut: 'active',
        type_espace: tarifInfo?.type_espace || type_espace || null,
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    let pricingResult = null;
    if (tarifInfo) {
      const { prixFinal, reduction } = applyPromoDiscount(Number(tarifInfo.prix), promoInfo);
      pricingResult = {
        type_abonnement: type,
        plan_tarifaire: plan,
        prix_initial: Number(tarifInfo.prix),
        prix_final: prixFinal,
        reduction,
        tva_pct: Number(tarifInfo.tva_pct),
        code_promo: promoInfo?.code || null,
        type_espace: tarifInfo.type_espace || null,
      };

      await supabaseAdmin.from('historique_tarifs').insert({
        user_id: userId,
        abonnement_id: data.id,
        type_abonnement: type,
        plan_tarifaire: plan,
        prix_initial: Number(tarifInfo.prix),
        prix_final: prixFinal,
        code_promo_id: promoInfo?.id || null,
      });

      if (promoInfo) {
        await supabaseAdmin
          .from('codes_promo')
          .update({ utilisations_count: promoInfo.utilisations_count + 1 })
          .eq('id', promoInfo.id);
      }
    }

    const { emitToStaff } = require('../services/socketService');
    emitToStaff('subscription:created', { user_id: userId, type, plan, pricing: pricingResult });

    res.status(201).json({ subscription: data, pricing: pricingResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateSubscription(req, res) {
  try {
    const { statut, renouvellement_auto, date_fin } = req.body;
    const updates = {};

    if (statut !== undefined) {
      if (!['active', 'suspended', 'expired'].includes(statut)) {
        return res.status(400).json({ error: 'statut invalide.' });
      }
      updates.statut = statut;
    }

    if (renouvellement_auto !== undefined) {
      updates.renouvellement_auto = Boolean(renouvellement_auto);
    }

    if (date_fin !== undefined) {
      updates.date_fin = date_fin;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Aucune mise à jour fournie.' });
    }

    const { data, error } = await supabaseAdmin
      .from('abonnements')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ subscription: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function listSubscriptions(req, res) {
  try {
    let query = supabaseAdmin
      .from('abonnements')
      .select('*, profiles(nom, prenom, email)')
      .order('created_at', { ascending: false });

    query = applyTenantFilter(query, req);
    const { data, error } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ subscriptions: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getMySubscriptions,
  getMyActiveSubscription,
  createSubscription,
  subscribeSelf,
  updateSubscription,
  listSubscriptions,
};
