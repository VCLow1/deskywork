// controllers/subscriptionsController.js — MODULE A : Abonnements & Demandes en attente de paiement
const { supabaseAdmin } = require('../config/supabase');
const { SUBSCRIPTION_DURATIONS, MEMBER_TYPE_TO_PLAN } = require('../config/constants');
const { todayISO, addDays, findActiveTarif, findValidPromoCode, applyPromoDiscount, insertWithColumnFallback } = require('../models/helpers');
const { applyTenantFilter } = require('../middleware/guards');
const { DEFAULT_TVA_PCT, roundMillime, computeTTC, computeHTFromTTC } = require('../models/pricingMath');
const { allocateDocumentNumber } = require('../models/numbering');
const { logActivity } = require('../models/activityLogger');

async function loadSubscriptionMetaForTenants(tenantIds = []) {
  const uniqueIds = Array.from(new Set(tenantIds.filter(Boolean)));
  const subMetaMap = {};
  const archSet = new Set();
  if (uniqueIds.length === 0) return { subMetaMap, archSet };
  try {
    const { data: rows } = await supabaseAdmin.from('tenants').select('id, settings').in('id', uniqueIds);
    for (const r of rows || []) {
      const s = r?.settings && typeof r.settings === 'object' ? r.settings : {};
      if (s.subscription_meta && typeof s.subscription_meta === 'object') {
        Object.assign(subMetaMap, s.subscription_meta);
      }
      if (Array.isArray(s.archived_subscriptions)) {
        for (const id of s.archived_subscriptions) archSet.add(id);
      }
    }
  } catch (_) {}
  return { subMetaMap, archSet };
}

function enrichSubscriptionRow(a, subMetaMap = {}, unitesMap = new Map(), archSet = new Set()) {
  const meta = subMetaMap[a.id] || {};
  const uniteId = a.unite_id || meta.unite_id || null;
  const quotaType = a.quota_type || meta.quota_type || 'illimite';
  const quotaTotal = a.quota_total != null ? Number(a.quota_total) : (meta.quota_total != null ? Number(meta.quota_total) : null);
  const quotaConsomme = Number(a.quota_consomme ?? meta.quota_consomme ?? 0) || 0;
  const quotaRestant = quotaTotal != null ? Math.max(0, Math.round((quotaTotal - quotaConsomme) * 100) / 100) : null;
  const quotaPct = quotaTotal && quotaTotal > 0 ? Math.min(100, Math.round((quotaConsomme / quotaTotal) * 100)) : 0;
  const unite = uniteId ? unitesMap.get(uniteId) || null : null;
  const effectiveStatut = meta.logical_status && a.statut === 'suspended' ? meta.logical_status : a.statut;

  return {
    ...a,
    statut: effectiveStatut,
    pending_payment: effectiveStatut === 'en_attente_paiement' || Boolean(meta.pending_payment),
    paiement_id: a.paiement_id || meta.paiement_id || null,
    montant_ht: a.montant_ht != null ? roundMillime(a.montant_ht) : (meta.montant_ht != null ? roundMillime(meta.montant_ht) : null),
    montant_ttc: a.montant_ttc != null ? roundMillime(a.montant_ttc) : (meta.montant_ttc != null ? roundMillime(meta.montant_ttc) : null),
    tva_pct: a.tva_pct ?? meta.tva_pct ?? DEFAULT_TVA_PCT,
    code_promo: a.code_promo || meta.code_promo || null,
    is_renewal: Boolean(meta.is_renewal),
    renew_from_subscription_id: meta.renew_from_subscription_id || null,
    motif_refus: a.motif_refus || meta.motif_refus || null,
    motif_resiliation: a.motif_resiliation || meta.motif_resiliation || null,
    unite_id: uniteId,
    unite,
    quota_type: quotaType,
    quota_total: quotaTotal,
    quota_consomme: quotaConsomme,
    quota_restant: quotaRestant,
    quota_pct: quotaPct,
    motif_suspension: a.motif_suspension || meta.motif_suspension || null,
    archived_at: a.archived_at || (archSet.has(a.id) ? (a.updated_at || a.created_at) : null),
  };
}

async function getMySubscriptions(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('abonnements')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const tenantIds = (data || []).map((s) => s.tenant_id || req.tenantId).filter(Boolean);
    const { subMetaMap, archSet } = await loadSubscriptionMetaForTenants(tenantIds);
    const enriched = (data || [])
      .map((row) => enrichSubscriptionRow(row, subMetaMap, new Map(), archSet))
      .filter((row) => !row.archived_at);

    res.json({ subscriptions: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getMyActiveSubscription(req, res) {
  try {
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabaseAdmin
      .from('abonnements')
      .select('*')
      .eq('user_id', req.user.id)
      .in('statut', ['active', 'actif', 'a_renouveler'])
      .lte('date_debut', today)
      .gte('date_fin', today)
      .order('date_fin', { ascending: false })
      .limit(5);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const rows = data || [];
    const { subMetaMap, archSet } = await loadSubscriptionMetaForTenants(rows.map((r) => r.tenant_id || req.tenantId));
    const enriched = rows
      .map((r) => enrichSubscriptionRow(r, subMetaMap, new Map(), archSet))
      .filter((r) => !r.archived_at && ['active', 'actif', 'a_renouveler'].includes(r.statut));

    res.json({ subscription: enriched[0] || null });
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

    const { data, error } = await insertWithColumnFallback(supabaseAdmin, 'abonnements', baseInsert);

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
    const { type, code_promo, renouvellement_auto, is_renewal = false } = req.body || {};
    const type_espace = req.body?.type_espace || null;
    const userId = req.user.id;

    if (!type) {
      return res.status(400).json({ error: "Le type d'abonnement est requis." });
    }

    if (!SUBSCRIPTION_DURATIONS[type] && type !== 'bureau_prive') {
      return res.status(400).json({ error: "Type d'abonnement invalide." });
    }

    if (type === 'bureau_prive') {
      return res.status(400).json({ error: 'Le bureau privé sur contrat doit être configuré avec l’établissement.' });
    }

    const today = todayISO();
    const { data: mySubs } = await supabaseAdmin
      .from('abonnements')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    const { data: memberProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, nom, prenom, email, type_membre, tenant_id')
      .eq('id', userId)
      .maybeSingle();

    const effectiveTenantId = req.tenantId || memberProfile?.tenant_id || null;
    const { subMetaMap, archSet } = await loadSubscriptionMetaForTenants([effectiveTenantId]);
    const enrichedSubs = (mySubs || [])
      .map((s) => enrichSubscriptionRow(s, subMetaMap, new Map(), archSet))
      .filter((s) => !s.archived_at);

    const existingPending = enrichedSubs.find((s) => s.statut === 'en_attente_paiement');
    if (existingPending) {
      return res.status(400).json({
        error: 'Vous avez déjà une demande d’abonnement en attente de paiement à l’accueil.',
      });
    }

    const existingActive = enrichedSubs.find(
      (s) => ['active', 'actif', 'a_renouveler'].includes(s.statut) && s.date_fin >= today
    );
    if (existingActive && !is_renewal) {
      return res.status(400).json({
        error: `Vous avez déjà un abonnement actif jusqu'au ${existingActive.date_fin}. Utilisez l'action Renouveler pour anticiper le prochain cycle.`,
      });
    }

    const date_debut = existingActive && is_renewal ? addDays(existingActive.date_fin, 1) : today;
    const date_fin = addDays(date_debut, SUBSCRIPTION_DURATIONS[type] - 1);

    const plan = MEMBER_TYPE_TO_PLAN[memberProfile?.type_membre] || 'standard';
    let tarifInfo = null;
    let promoInfo = null;

    try {
      tarifInfo = await findActiveTarif(type, plan, effectiveTenantId, type_espace);
      if (code_promo) {
        promoInfo = await findValidPromoCode(code_promo, effectiveTenantId);
        if (!promoInfo) {
          return res.status(400).json({ error: 'Code promo invalide ou expiré.' });
        }
      }
    } catch (e) {
      console.warn('Tarification non disponible:', e.message);
    }

    const tvaPct = Number(tarifInfo?.tva_pct ?? DEFAULT_TVA_PCT);
    const baseHT = roundMillime(tarifInfo?.prix_ht ?? tarifInfo?.prix ?? 0);
    const { prixFinal: finalHT, reduction: redHT } = applyPromoDiscount(baseHT, promoInfo);
    const finalTTC = computeTTC(finalHT, tvaPct);
    const quotaType = tarifInfo?.quota_type || 'illimite';
    const quotaTotal = quotaType !== 'illimite' && tarifInfo?.quota_total != null ? Number(tarifInfo.quota_total) : null;

    // Création de la demande au statut "en_attente_paiement" (activation dès encaissement par l'Admin)
    const insertPayload = {
      tenant_id: effectiveTenantId,
      user_id: userId,
      type,
      date_debut,
      date_fin,
      renouvellement_auto: Boolean(renouvellement_auto),
      statut: 'en_attente_paiement',
      type_espace: tarifInfo?.type_espace || type_espace || null,
      quota_type: quotaType,
      quota_total: quotaTotal,
      quota_consomme: 0,
      montant_ht: roundMillime(finalHT),
      montant_ttc: finalTTC,
      tva_pct: tvaPct,
      code_promo: promoInfo?.code || null,
    };

    let usedFallbackStatut = false;
    let { data, error } = await insertWithColumnFallback(supabaseAdmin, 'abonnements', insertPayload);
    if (error && /check constraint|abonnements_statut|violates check/i.test(error.message || '')) {
      usedFallbackStatut = true;
      ({ data, error } = await insertWithColumnFallback(supabaseAdmin, 'abonnements', {
        ...insertPayload,
        statut: 'suspended',
      }));
    }

    if (error || !data) {
      return res.status(400).json({ error: error?.message || "Impossible d'enregistrer votre demande." });
    }

    // Créer immédiatement le montant dû (statut pending) lié à cette demande
    let paymentRow = null;
    if (finalTTC > 0) {
      const { data: pCreated } = await insertWithColumnFallback(supabaseAdmin, 'paiements', {
        user_id: userId,
        abonnement_id: data.id,
        tenant_id: effectiveTenantId,
        montant: finalTTC,
        total_du: finalTTC,
        montant_paye: 0,
        reste_a_payer: finalTTC,
        mode: 'cash',
        statut: 'pending',
        reference_externe: `DEMANDE-ABONNEMENT-${type.toUpperCase()}`,
      });
      paymentRow = pCreated || null;

      if (paymentRow?.id) {
        await supabaseAdmin
          .from('abonnements')
          .update({ paiement_id: paymentRow.id })
          .eq('id', data.id)
          .catch(() => {});
      }
    }

    if (effectiveTenantId) {
      try {
        const { data: tRow } = await supabaseAdmin.from('tenants').select('settings').eq('id', effectiveTenantId).maybeSingle();
        const curSettings = (tRow?.settings && typeof tRow.settings === 'object') ? tRow.settings : {};
        const subMeta = (curSettings.subscription_meta && typeof curSettings.subscription_meta === 'object')
          ? { ...curSettings.subscription_meta }
          : {};
        subMeta[data.id] = {
          ...(subMeta[data.id] || {}),
          logical_status: 'en_attente_paiement',
          pending_payment: true,
          used_fallback_statut: usedFallbackStatut,
          paiement_id: paymentRow?.id || null,
          montant_ht: roundMillime(finalHT),
          montant_ttc: finalTTC,
          tva_pct: tvaPct,
          code_promo: promoInfo?.code || null,
          quota_type: quotaType,
          quota_total: quotaTotal,
          quota_consomme: 0,
          is_renewal: Boolean(is_renewal && existingActive),
          renew_from_subscription_id: existingActive?.id || null,
        };
        await supabaseAdmin
          .from('tenants')
          .update({ settings: { ...curSettings, subscription_meta: subMeta } })
          .eq('id', effectiveTenantId);
      } catch (_) {}
    }

    const pricingResult = {
      type_abonnement: type,
      prix_initial: computeTTC(baseHT, tvaPct),
      prix_initial_ht: baseHT,
      prix_final_ht: roundMillime(finalHT),
      prix_final: finalTTC,
      reduction_ht: roundMillime(redHT),
      reduction: roundMillime(computeTTC(baseHT, tvaPct) - finalTTC),
      tva_pct: tvaPct,
      code_promo: promoInfo?.code || null,
      type_espace: tarifInfo?.type_espace || null,
    };

    try {
      await supabaseAdmin.from('historique_tarifs').insert({
        user_id: userId,
        abonnement_id: data.id,
        type_abonnement: type,
        plan_tarifaire: plan,
        prix_initial: computeTTC(baseHT, tvaPct),
        prix_final: finalTTC,
        code_promo_id: promoInfo?.id || null,
      });
    } catch (_) {}

    if (promoInfo?.id) {
      await supabaseAdmin
        .from('codes_promo')
        .update({ utilisations_count: (promoInfo.utilisations_count || 0) + 1 })
        .eq('id', promoInfo.id)
        .catch(() => {});
    }

    // Notifier les admins/staff de l'établissement pour la file "Demandes d'abonnement"
    if (effectiveTenantId) {
      try {
        const { data: staffRows } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('tenant_id', effectiveTenantId)
          .in('role', ['admin', 'staff']);
        const clientNom = memberProfile ? `${memberProfile.prenom || ''} ${memberProfile.nom || ''}`.trim() : 'Un membre';
        for (const st of staffRows || []) {
          await supabaseAdmin.from('notifications').insert({
            user_id: st.id,
            type: 'abonnement_demande',
            canal: 'Dashboard',
            message: `Nouvelle demande d'abonnement (${type}) de ${clientNom} — en attente d'encaissement (${finalTTC.toFixed(3)} DT). [Lien: /admin/abonnements?tab=demandes]`,
          }).catch(() => {});
        }
      } catch (_) {}
    }

    const { emitToStaff } = require('../services/socketService');
    emitToStaff('subscription:request', { subscription_id: data.id, user_id: userId, type, pricing: pricingResult });

    res.status(201).json({
      subscription: { ...data, statut: 'en_attente_paiement', pending_payment: true, montant_ht: roundMillime(finalHT), montant_ttc: finalTTC, tva_pct: tvaPct, paiement_id: paymentRow?.id || null },
      payment: paymentRow,
      pricing: pricingResult,
      message: "Votre demande d'abonnement est enregistrée au statut « En attente de paiement ». Réglez à l'accueil pour l'activer immédiatement.",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/subscriptions/:id/approve-payment — Admin encaisse et active la demande d'abonnement
async function approveSubscriptionPayment(req, res) {
  try {
    const { id } = req.params;
    const { mode = 'cash' } = req.body || {};
    if (!['cash', 'bank_transfer', 'check'].includes(mode)) {
      return res.status(400).json({ error: 'Mode invalide (cash, bank_transfer, check).' });
    }

    const { data: sub, error: subErr } = await supabaseAdmin
      .from('abonnements')
      .select('*, profiles(id, nom, prenom, email)')
      .eq('id', id)
      .single();
    if (subErr || !sub) return res.status(404).json({ error: "Demande d'abonnement introuvable." });

    const tid = req.tenantId || sub.tenant_id;
    const { subMetaMap } = await loadSubscriptionMetaForTenants([tid]);
    const meta = subMetaMap[id] || {};
    const nowIso = new Date().toISOString();
    const today = todayISO();

    // Si ce n'est pas un renouvellement futur, recaler date_debut/date_fin à la date d'activation effective
    let nextDebut = sub.date_debut;
    let nextFin = sub.date_fin;
    if (!meta.is_renewal && SUBSCRIPTION_DURATIONS[sub.type] && sub.date_debut < today) {
      nextDebut = today;
      nextFin = addDays(today, SUBSCRIPTION_DURATIONS[sub.type] - 1);
    }

    const { data: updatedSub, error: updErr } = await supabaseAdmin
      .from('abonnements')
      .update({
        statut: 'active',
        date_debut: nextDebut,
        date_fin: nextFin,
        updated_at: nowIso,
      })
      .eq('id', id)
      .select('*, profiles(id, nom, prenom, email)')
      .single();
    if (updErr) return res.status(400).json({ error: updErr.message });

    // Encaisser le paiement pending lié avec numéro continu REC-AAAA-NNNNNN
    let { data: pendingPay } = await supabaseAdmin
      .from('paiements')
      .select('*')
      .eq('abonnement_id', id)
      .in('statut', ['pending', 'partial'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let collectedPay = null;
    if (pendingPay) {
      const numeroRecu = pendingPay.numero_recu || await allocateDocumentNumber(supabaseAdmin, tid || pendingPay.tenant_id, 'receipt');
      const totalAmt = roundMillime(pendingPay.total_du ?? meta.montant_ttc ?? pendingPay.montant ?? 0);
      const { data: paidRow } = await supabaseAdmin
        .from('paiements')
        .update({
          statut: 'paid',
          mode,
          date_paiement: nowIso,
          numero_recu: numeroRecu,
          total_du: totalAmt,
          montant_paye: totalAmt,
          reste_a_payer: 0,
        })
        .eq('id', pendingPay.id)
        .select('*')
        .maybeSingle()
        .catch(async () =>
          supabaseAdmin
            .from('paiements')
            .update({ statut: 'paid', mode, date_paiement: nowIso, numero_recu: numeroRecu })
            .eq('id', pendingPay.id)
            .select('*')
            .maybeSingle()
        );
      collectedPay = paidRow || { ...pendingPay, statut: 'paid', numero_recu: numeroRecu };
    }

    if (tid) {
      try {
        const { data: tRow } = await supabaseAdmin.from('tenants').select('settings').eq('id', tid).maybeSingle();
        const cur = (tRow?.settings && typeof tRow.settings === 'object') ? tRow.settings : {};
        const nextMetaMap = { ...(cur.subscription_meta || {}) };
        if (nextMetaMap[id]) {
          nextMetaMap[id] = {
            ...nextMetaMap[id],
            logical_status: 'active',
            pending_payment: false,
          };
          await supabaseAdmin.from('tenants').update({ settings: { ...cur, subscription_meta: nextMetaMap } }).eq('id', tid);
        }
      } catch (_) {}
    }

    await supabaseAdmin.from('notifications').insert({
      user_id: sub.user_id,
      type: 'abonnement_active',
      canal: 'Dashboard',
      message: `Votre abonnement (${sub.type}) est activé !${collectedPay?.numero_recu ? ` Reçu ${collectedPay.numero_recu}.` : ''} [Lien: /dashboard/abonnement]`,
    }).catch(() => {});

    await logActivity({
      tenantId: tid,
      req,
      action: 'activation_abonnement',
      entityType: 'abonnement',
      entityId: id,
      entityLabel: `Activation ${sub.type}${collectedPay?.numero_recu ? ` (${collectedPay.numero_recu})` : ''}`,
      afterData: { statut: 'active', mode, numero_recu: collectedPay?.numero_recu || null },
    });

    res.json({
      subscription: updatedSub,
      payment: collectedPay,
      message: `Abonnement activé${collectedPay?.numero_recu ? ` et encaissé (${collectedPay.numero_recu})` : ''}.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/subscriptions/:id/reject-request — Admin refuse une demande en attente de paiement
async function rejectSubscriptionRequest(req, res) {
  try {
    const { id } = req.params;
    const motif = String(req.body?.motif || '').trim();
    if (motif.length < 3) {
      return res.status(400).json({ error: 'Un motif explicite (minimum 3 caractères) est obligatoire.' });
    }

    const { data: sub, error: subErr } = await supabaseAdmin
      .from('abonnements')
      .select('*')
      .eq('id', id)
      .single();
    if (subErr || !sub) return res.status(404).json({ error: 'Demande introuvable.' });

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('abonnements')
      .update({ statut: 'resilie', motif_resiliation: motif })
      .eq('id', id)
      .select('*')
      .single()
      .catch(async () =>
        supabaseAdmin.from('abonnements').update({ statut: 'resilie' }).eq('id', id).select('*').single()
      );
    if (updErr) return res.status(400).json({ error: updErr.message });

    await supabaseAdmin
      .from('paiements')
      .update({ statut: 'failed' })
      .eq('abonnement_id', id)
      .in('statut', ['pending', 'partial'])
      .catch(() => {});

    const tid = req.tenantId || sub.tenant_id;
    if (tid) {
      try {
        const { data: tRow } = await supabaseAdmin.from('tenants').select('settings').eq('id', tid).maybeSingle();
        const cur = (tRow?.settings && typeof tRow.settings === 'object') ? tRow.settings : {};
        const nextMeta = { ...(cur.subscription_meta || {}) };
        nextMeta[id] = { ...(nextMeta[id] || {}), logical_status: 'refuse', pending_payment: false, motif_refus: motif };
        await supabaseAdmin.from('tenants').update({ settings: { ...cur, subscription_meta: nextMeta } }).eq('id', tid);
      } catch (_) {}
    }

    await supabaseAdmin.from('notifications').insert({
      user_id: sub.user_id,
      type: 'abonnement_refuse',
      canal: 'Dashboard',
      message: `Votre demande d'abonnement (${sub.type}) n'a pas été retenue. Motif : ${motif}. [Lien: /dashboard/abonnement]`,
    }).catch(() => {});

    res.json({ subscription: updated, message: 'Demande refusée.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/subscriptions/:id/cancel-request — Membre annule sa demande en attente de paiement
async function cancelMySubscriptionRequest(req, res) {
  try {
    const { id } = req.params;
    const { data: sub } = await supabaseAdmin.from('abonnements').select('*').eq('id', id).single();
    if (!sub || sub.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Demande introuvable.' });
    }
    const { subMetaMap } = await loadSubscriptionMetaForTenants([sub.tenant_id]);
    const enriched = enrichSubscriptionRow(sub, subMetaMap);
    if (enriched.statut !== 'en_attente_paiement') {
      return res.status(400).json({ error: 'Seule une demande en attente de paiement peut être annulée ici.' });
    }

    await supabaseAdmin.from('abonnements').update({ statut: 'resilie' }).eq('id', id).catch(() => {});
    await supabaseAdmin
      .from('paiements')
      .update({ statut: 'cancelled' })
      .eq('abonnement_id', id)
      .eq('statut', 'pending')
      .catch(() => supabaseAdmin.from('paiements').update({ statut: 'failed' }).eq('abonnement_id', id).eq('statut', 'pending').catch(() => {}));

    if (sub.tenant_id) {
      try {
        const { data: tRow } = await supabaseAdmin.from('tenants').select('settings').eq('id', sub.tenant_id).maybeSingle();
        const cur = (tRow?.settings && typeof tRow.settings === 'object') ? tRow.settings : {};
        const nextMeta = { ...(cur.subscription_meta || {}) };
        nextMeta[id] = { ...(nextMeta[id] || {}), logical_status: 'resilie', pending_payment: false };
        await supabaseAdmin.from('tenants').update({ settings: { ...cur, subscription_meta: nextMeta } }).eq('id', sub.tenant_id);
      } catch (_) {}
    }

    res.json({ success: true, message: "Demande d'abonnement annulée." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/subscriptions/:id/resiliate — Membre résilie son abonnement actif
async function resiliateMySubscription(req, res) {
  try {
    const { id } = req.params;
    const motif = String(req.body?.motif || '').trim() || 'Résiliation demandée par le membre';
    const { data: sub } = await supabaseAdmin.from('abonnements').select('*').eq('id', id).single();
    if (!sub || sub.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Abonnement introuvable.' });
    }
    if (!['active', 'actif', 'a_renouveler'].includes(sub.statut)) {
      return res.status(400).json({ error: 'Cet abonnement ne peut pas être résilié.' });
    }

    const nowIso = new Date().toISOString();
    let { data: updated, error } = await supabaseAdmin
      .from('abonnements')
      .update({
        statut: 'resilie',
        renouvellement_auto: false,
        motif_resiliation: motif,
        demande_resiliation_at: nowIso,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error && /column|does not exist|schema cache/i.test(error.message || '')) {
      ({ data: updated, error } = await supabaseAdmin
        .from('abonnements')
        .update({ statut: 'resilie', renouvellement_auto: false })
        .eq('id', id)
        .select('*')
        .single());
    }
    if (error) return res.status(400).json({ error: error.message });

    if (sub.tenant_id) {
      try {
        const { data: tRow } = await supabaseAdmin.from('tenants').select('settings').eq('id', sub.tenant_id).maybeSingle();
        const cur = (tRow?.settings && typeof tRow.settings === 'object') ? tRow.settings : {};
        const nextMeta = { ...(cur.subscription_meta || {}) };
        nextMeta[id] = { ...(nextMeta[id] || {}), logical_status: 'resilie', motif_resiliation: motif };
        await supabaseAdmin.from('tenants').update({ settings: { ...cur, subscription_meta: nextMeta } }).eq('id', sub.tenant_id);
      } catch (_) {}
    }

    await logActivity({
      tenantId: sub.tenant_id,
      req,
      action: 'resiliation_abonnement',
      entityType: 'abonnement',
      entityId: id,
      entityLabel: `Résiliation membre (${sub.type})`,
      afterData: { statut: 'resilie', motif_resiliation: motif },
    });

    res.json({ subscription: updated, message: 'Votre abonnement a bien été résilié.' });
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

    const list = (data || []).map((a) => enrichSubscriptionRow(a, subMetaMap, unitesMap, archIds));

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
  approveSubscriptionPayment,
  rejectSubscriptionRequest,
  cancelMySubscriptionRequest,
  resiliateMySubscription,
  updateSubscription,
  listSubscriptions,
  getSubscriptionConsumptions,
  archiveSubscription,
  restoreSubscription,
};
