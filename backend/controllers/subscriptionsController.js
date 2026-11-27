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
    const {
      user_id,
      type,
      date_debut,
      renouvellement_auto,
      code_promo,
      plan_tarifaire,
      unite_id,
      quota_type = 'illimite',
      quota_total = null,
    } = req.body;
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

    const { insertWithColumnFallback } = require('../models/helpers');
    const normalizedQuotaType = ['heures', 'jours', 'illimite'].includes(quota_type) ? quota_type : 'illimite';
    const numericQuotaTotal = normalizedQuotaType === 'illimite' || quota_total == null || quota_total === ''
      ? null
      : Math.max(0, Number(quota_total) || 0);

    const baseInsert = {
      tenant_id: req.tenantId,
      user_id,
      type,
      date_debut,
      date_fin,
      renouvellement_auto: Boolean(renouvellement_auto),
      statut: 'active',
      type_espace: tarifInfo?.type_espace || type_espace || null,
      unite_id: unite_id || null,
      quota_type: normalizedQuotaType,
      quota_total: numericQuotaTotal,
      quota_consomme: 0,
    };

    const { data, error } = await insertWithColumnFallback('abonnements', baseInsert);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Mémoriser les métadonnées LOT 4 (unite_id / quota) en fallback settings si les colonnes SQL ne sont pas encore migrées
    if (req.tenantId && data?.id) {
      try {
        const { data: tRow } = await supabaseAdmin.from('tenants').select('settings').eq('id', req.tenantId).maybeSingle();
        const curSettings = (tRow?.settings && typeof tRow.settings === 'object') ? tRow.settings : {};
        const subMeta = (curSettings.subscription_meta && typeof curSettings.subscription_meta === 'object')
          ? { ...curSettings.subscription_meta }
          : {};
        subMeta[data.id] = {
          unite_id: unite_id || data.unite_id || null,
          quota_type: normalizedQuotaType,
          quota_total: numericQuotaTotal,
          quota_consomme: 0,
        };
        await supabaseAdmin.from('tenants').update({
          settings: { ...curSettings, subscription_meta: subMeta },
        }).eq('id', req.tenantId);
      } catch (_) {}
    }

    const { logActivity } = require('../models/activityLogger');
    await logActivity({
      tenantId: req.tenantId,
      req,
      action: 'creation',
      entityType: 'abonnement',
      entityId: data.id,
      entityLabel: `${type}${unite_id ? ' (Bureau dédié)' : ''}`,
      afterData: { ...data, unite_id: unite_id || null, quota_type: normalizedQuotaType, quota_total: numericQuotaTotal },
    });

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

      try {
        await supabaseAdmin.from('historique_tarifs').insert({
          user_id,
          abonnement_id: data.id,
          type_abonnement: type,
          plan_tarifaire: plan,
          prix_initial: Number(tarifInfo.prix),
          prix_final: prixFinal,
          code_promo_id: promoInfo?.id || null,
        });
      } catch (e) {
        console.warn('historique_tarifs insert skipped:', e.message);
      }

      if (promoInfo && promoInfo.id) {
        try {
          await supabaseAdmin
            .from('codes_promo')
            .update({ utilisations_count: (promoInfo.utilisations_count || 0) + 1 })
            .eq('id', promoInfo.id);
        } catch (e) {
          console.warn('codes_promo update skipped:', e.message);
        }
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

      try {
        await supabaseAdmin.from('historique_tarifs').insert({
          user_id: userId,
          abonnement_id: data.id,
          type_abonnement: type,
          plan_tarifaire: plan,
          prix_initial: Number(tarifInfo.prix),
          prix_final: prixFinal,
          code_promo_id: promoInfo?.id || null,
        });
      } catch (e) {
        console.warn('historique_tarifs insert skipped in subscribeSelf:', e.message);
      }

      if (promoInfo && promoInfo.id) {
        try {
          await supabaseAdmin
            .from('codes_promo')
            .update({ utilisations_count: (promoInfo.utilisations_count || 0) + 1 })
            .eq('id', promoInfo.id);
        } catch (e) {
          console.warn('codes_promo update skipped in subscribeSelf:', e.message);
        }
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
    const {
      statut,
      renouvellement_auto,
      date_fin,
      unite_id,
      quota_type,
      quota_total,
      quota_consomme,
      motif_suspension,
      confirm_suspension,
    } = req.body;
    const updates = {};
    const validStatuses = ['active', 'actif', 'a_renouveler', 'expired', 'suspended', 'resilie'];

    if (statut !== undefined) {
      if (!validStatuses.includes(statut)) {
        return res.status(400).json({ error: 'statut invalide.' });
      }
      if (statut === 'suspended') {
        const hasMotif = typeof motif_suspension === 'string' && motif_suspension.trim().length >= 3;
        if (!confirm_suspension && !hasMotif) {
          return res.status(400).json({
            error: 'La suspension d’un abonnement nécessite obligatoirement une confirmation humaine et un motif.',
            code: 'SUSPENSION_REQUIRES_HUMAN_CONFIRMATION',
          });
        }
        if (hasMotif) updates.motif_suspension = motif_suspension.trim();
      }
      updates.statut = statut === 'actif' ? 'active' : statut;
    }

    if (renouvellement_auto !== undefined) {
      updates.renouvellement_auto = Boolean(renouvellement_auto);
    }

    if (date_fin !== undefined) {
      updates.date_fin = date_fin;
    }
    if (unite_id !== undefined) {
      updates.unite_id = unite_id || null;
    }
    if (quota_type !== undefined && ['heures', 'jours', 'illimite'].includes(quota_type)) {
      updates.quota_type = quota_type;
    }
    if (quota_total !== undefined) {
      updates.quota_total = quota_total == null || quota_total === '' ? null : Math.max(0, Number(quota_total) || 0);
    }
    if (quota_consomme !== undefined) {
      updates.quota_consomme = Math.max(0, Number(quota_consomme) || 0);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Aucune mise à jour fournie.' });
    }

    let { data, error } = await supabaseAdmin
      .from('abonnements')
      .update(updates)
      .eq('id', req.params.id)
      .select('*, profiles(nom, prenom, email)')
      .single();

    if (error && /column|does not exist|schema cache/i.test(error.message || '')) {
      const safeUpdates = {};
      for (const k of ['statut', 'renouvellement_auto', 'date_fin', 'type_espace']) {
        if (updates[k] !== undefined) safeUpdates[k] = updates[k];
      }
      ({ data, error } = await supabaseAdmin
        .from('abonnements')
        .update(safeUpdates)
        .eq('id', req.params.id)
        .select('*, profiles(nom, prenom, email)')
        .single());
    }

    if (error && updates.statut === 'resilie') {
      // Repli si la contrainte SQL n'autorise pas encore 'resilie'
      ({ data, error } = await supabaseAdmin
        .from('abonnements')
        .update({ ...updates, statut: 'suspended' })
        .eq('id', req.params.id)
        .select('*, profiles(nom, prenom, email)')
        .single());
    }

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    const tid = req.tenantId || data?.tenant_id;
    if (tid && data?.id) {
      try {
        const { data: tRow } = await supabaseAdmin.from('tenants').select('settings').eq('id', tid).maybeSingle();
        const curSettings = (tRow?.settings && typeof tRow.settings === 'object') ? tRow.settings : {};
        const subMeta = (curSettings.subscription_meta && typeof curSettings.subscription_meta === 'object')
          ? { ...curSettings.subscription_meta }
          : {};
        const prevMeta = subMeta[data.id] || {};
        subMeta[data.id] = {
          ...prevMeta,
          ...(unite_id !== undefined ? { unite_id: unite_id || null } : {}),
          ...(quota_type !== undefined ? { quota_type } : {}),
          ...(quota_total !== undefined ? { quota_total: updates.quota_total } : {}),
          ...(quota_consomme !== undefined ? { quota_consomme: updates.quota_consomme } : {}),
          ...(updates.motif_suspension ? { motif_suspension: updates.motif_suspension } : {}),
        };
        await supabaseAdmin.from('tenants').update({
          settings: { ...curSettings, subscription_meta: subMeta },
        }).eq('id', tid);
      } catch (_) {}
    }

    const { logActivity } = require('../models/activityLogger');
    await logActivity({
      tenantId: tid,
      req,
      action: updates.statut === 'suspended' ? 'suspension_abonnement' : 'changement_statut',
      entityType: 'abonnement',
      entityId: req.params.id,
      entityLabel: `Abonnement ${data?.type || req.params.id}`,
      afterData: updates,
    });

    res.json({ subscription: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function listSubscriptions(req, res) {
  try {
    const includeArchived = req.query.include_archived === 'true' || req.query.include_archived === '1';

    // Automatisations P1 LOT 4 (J-7 -> a_renouveler, échéance dépassée -> expired, JAMAIS suspended)
    if (req.tenantId) {
      try {
        const { runLot4AutomationsForTenant } = require('../cron/lot4Automations');
        await runLot4AutomationsForTenant(supabaseAdmin, req.tenantId);
      } catch (_) {}
    }

    let query = supabaseAdmin
      .from('abonnements')
      .select('*, profiles(nom, prenom, email, telephone)')
      .order('created_at', { ascending: false });

    query = applyTenantFilter(query, req);
    const { data, error } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    let archIds = new Set();
    let subMetaMap = {};
    let unitesMap = new Map();
    if (req.tenantId) {
      const { data: tRow } = await supabaseAdmin.from('tenants').select('settings').eq('id', req.tenantId).maybeSingle();
      if (Array.isArray(tRow?.settings?.archived_subscriptions)) {
        archIds = new Set(tRow.settings.archived_subscriptions);
      }
      if (tRow?.settings?.subscription_meta && typeof tRow.settings.subscription_meta === 'object') {
        subMetaMap = tRow.settings.subscription_meta;
      }
      try {
        const { loadSpaceUnitsForTenant } = require('../models/bookingAvailability');
        const unites = await loadSpaceUnitsForTenant(supabaseAdmin, req.tenantId);
        for (const u of unites || []) unitesMap.set(u.id, u);
      } catch (_) {}
    }

    const list = (data || []).map((a) => {
      const meta = subMetaMap[a.id] || {};
      const uniteId = a.unite_id || meta.unite_id || null;
      const quotaType = a.quota_type || meta.quota_type || 'illimite';
      const quotaTotal = a.quota_total != null ? Number(a.quota_total) : (meta.quota_total != null ? Number(meta.quota_total) : null);
      const quotaConsomme = Number(a.quota_consomme ?? meta.quota_consomme ?? 0) || 0;
      const quotaRestant = quotaTotal != null ? Math.max(0, Math.round((quotaTotal - quotaConsomme) * 100) / 100) : null;
      const quotaPct = quotaTotal && quotaTotal > 0 ? Math.min(100, Math.round((quotaConsomme / quotaTotal) * 100)) : 0;
      const unite = uniteId ? unitesMap.get(uniteId) || null : null;

      return {
        ...a,
        unite_id: uniteId,
        unite,
        quota_type: quotaType,
        quota_total: quotaTotal,
        quota_consomme: quotaConsomme,
        quota_restant: quotaRestant,
        quota_pct: quotaPct,
        motif_suspension: a.motif_suspension || meta.motif_suspension || null,
        archived_at: a.archived_at || (archIds.has(a.id) ? (a.updated_at || a.created_at) : null),
      };
    });

    res.json({ subscriptions: includeArchived ? list : list.filter((a) => !a.archived_at) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/subscriptions/:id/consumptions — Historique des déductions de quota
async function getSubscriptionConsumptions(req, res) {
  try {
    const subId = req.params.id;
    let items = [];
    try {
      const { data, error } = await supabaseAdmin
        .from('abonnement_consommations')
        .select('*, reservations(id, date_debut, date_fin, espaces(nom))')
        .eq('abonnement_id', subId)
        .order('created_at', { ascending: false });
      if (!error && Array.isArray(data)) items = data;
    } catch (_) {}

    if (items.length === 0 && req.tenantId) {
      const { data: tRow } = await supabaseAdmin.from('tenants').select('settings').eq('id', req.tenantId).maybeSingle();
      const raw = Array.isArray(tRow?.settings?.abonnement_consommations) ? tRow.settings.abonnement_consommations : [];
      items = raw.filter((c) => c.abonnement_id === subId);
    }

    res.json({ consumptions: items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function archiveSubscription(req, res) {
  try {
    const nowIso = new Date().toISOString();
    let { data, error } = await supabaseAdmin
      .from('abonnements')
      .update({ archived_at: nowIso, archived_by: req.user?.id || null, statut: 'suspended' })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error && /column|does not exist|schema cache/i.test(error.message || '')) {
      ({ data, error } = await supabaseAdmin.from('abonnements').update({ statut: 'suspended' }).eq('id', req.params.id).select().single());
    }
    if (error) return res.status(400).json({ error: error.message });

    if (req.tenantId) {
      const { data: tRow } = await supabaseAdmin.from('tenants').select('settings').eq('id', req.tenantId).maybeSingle();
      const cur = (tRow?.settings && typeof tRow.settings === 'object') ? tRow.settings : {};
      const next = Array.from(new Set([...(Array.isArray(cur.archived_subscriptions) ? cur.archived_subscriptions : []), req.params.id]));
      await supabaseAdmin.from('tenants').update({ settings: { ...cur, archived_subscriptions: next } }).eq('id', req.tenantId);
    }

    const { logActivity } = require('../models/activityLogger');
    await logActivity({
      tenantId: req.tenantId || data?.tenant_id,
      req,
      action: 'archivage',
      entityType: 'abonnement',
      entityId: req.params.id,
      entityLabel: `Abonnement ${data?.type || req.params.id}`,
      afterData: { archived_at: nowIso },
    });

    res.json({ subscription: { ...data, archived_at: nowIso }, message: 'Abonnement archivé.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function restoreSubscription(req, res) {
  try {
    let { data, error } = await supabaseAdmin
      .from('abonnements')
      .update({ archived_at: null, archived_by: null, statut: 'active' })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error && /column|does not exist|schema cache/i.test(error.message || '')) {
      ({ data, error } = await supabaseAdmin.from('abonnements').update({ statut: 'active' }).eq('id', req.params.id).select().single());
    }
    if (error) return res.status(400).json({ error: error.message });

    if (req.tenantId) {
      const { data: tRow } = await supabaseAdmin.from('tenants').select('settings').eq('id', req.tenantId).maybeSingle();
      const cur = (tRow?.settings && typeof tRow.settings === 'object') ? tRow.settings : {};
      const next = (Array.isArray(cur.archived_subscriptions) ? cur.archived_subscriptions : []).filter((x) => x !== req.params.id);
      await supabaseAdmin.from('tenants').update({ settings: { ...cur, archived_subscriptions: next } }).eq('id', req.tenantId);
    }

    const { logActivity } = require('../models/activityLogger');
    await logActivity({
      tenantId: req.tenantId || data?.tenant_id,
      req,
      action: 'restauration',
      entityType: 'abonnement',
      entityId: req.params.id,
      entityLabel: `Abonnement ${data?.type || req.params.id}`,
    });

    res.json({ subscription: data, message: 'Abonnement restauré.' });
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
  getSubscriptionConsumptions,
  archiveSubscription,
  restoreSubscription,
};
