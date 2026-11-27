// controllers/paymentsController.js — MODULE C : Paiements, Stripe, Reçus PDF
const { supabaseAdmin } = require('../config/supabase');
const { applyTenantFilter } = require('../middleware/guards');
const { generateReceiptPDF } = require('../utils/generateReceipt');
const { sendReceiptEmail, isEmailConfigured } = require('../utils/sendEmail');
const { finalizeOnlinePayment } = require('../services/onlinePaymentService');
const {
  isStripeConfigured,
  createCheckoutSession,
  retrieveCheckoutSession,
  validateCheckoutSession,
  isCheckoutSessionPaid,
  getExternalReference,
  constructWebhookEvent,
} = require('../services/stripeService');
const { notifyPaiementEnregistre } = require('../services/notificationService');
const { roundMillime } = require('../models/pricingMath');
const { logActivity } = require('../models/activityLogger');
const { allocateDocumentNumber } = require('../models/numbering');
const {
  computePartialPaymentState,
  computeAgingBucket,
  getUnpaidBlockingConfig,
  buildReminderTemplates,
} = require('../models/financeHelpers');
const { generateInvoicePDF } = require('../utils/generateInvoicePdf');

async function createPayment(req, res) {
  try {
    const { user_id, reservation_id, abonnement_id, montant, mode, statut, date_paiement } = req.body;

    if (!user_id || !montant || !mode) {
      return res.status(400).json({ error: 'user_id, montant et mode sont requis.' });
    }

    if (!reservation_id && !abonnement_id) {
      return res.status(400).json({ error: 'Un paiement doit être lié à une réservation ou un abonnement.' });
    }

    const validModes = ['cash', 'bank_transfer', 'check']; // D1 : plus de mode « online »
    if (!validModes.includes(mode)) {
      return res.status(400).json({ error: 'Mode de paiement invalide. Valeurs acceptées : cash, bank_transfer, check.' });
    }

    const validStatuts = ['pending', 'paid', 'failed', 'refunded'];
    if (statut && !validStatuts.includes(statut)) {
      return res.status(400).json({ error: 'Statut invalide. Valeurs acceptées : pending, paid, failed, refunded.' });
    }

    if (montant <= 0) {
      return res.status(400).json({ error: 'Le montant doit être supérieur à 0.' });
    }

    const { data: member, error: memberError } = await supabaseAdmin
      .from('profiles')
      .select('id, nom, prenom, email')
      .eq('id', user_id)
      .single();

    if (memberError || !member) {
      return res.status(404).json({ error: 'Membre introuvable.' });
    }

    if (reservation_id) {
      const { data: reservation, error: resError } = await supabaseAdmin
        .from('reservations')
        .select('id, user_id')
        .eq('id', reservation_id)
        .single();

      if (resError || !reservation) {
        return res.status(404).json({ error: 'Réservation introuvable.' });
      }

      if (reservation.user_id !== user_id) {
        return res.status(400).json({ error: "La réservation n'appartient pas à ce membre." });
      }
    }

    if (abonnement_id) {
      const { data: abonnement, error: abError } = await supabaseAdmin
        .from('abonnements')
        .select('id, user_id')
        .eq('id', abonnement_id)
        .single();

      if (abError || !abonnement) {
        return res.status(404).json({ error: 'Abonnement introuvable.' });
      }

      if (abonnement.user_id !== user_id) {
        return res.status(400).json({ error: "L'abonnement n'appartient pas à ce membre." });
      }
    }

    const paymentData = {
      user_id,
      reservation_id: reservation_id || null,
      abonnement_id: abonnement_id || null,
      montant: parseFloat(montant),
      mode,
      statut: statut || 'pending',
      date_paiement: date_paiement || null,
      tenant_id: req.tenantId,
    };

    const { data, error } = await supabaseAdmin
      .from('paiements')
      .insert(paymentData)
      .select('*, profiles(nom, prenom, email)')
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json({ payment: data, message: 'Paiement créé avec succès.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createPaymentSelf(req, res) {
  try {
    const { reservation_id, abonnement_id, montant, statut } = req.body;
    const userId = req.user.id;
    // 'sur_place' est le mode frontend → correspond à 'cash' en DB
    let mode = req.body.mode;

    if (!montant || !mode) {
      return res.status(400).json({ error: 'montant et mode sont requis.' });
    }

    if (!reservation_id && !abonnement_id) {
      return res.status(400).json({ error: 'Un paiement doit être lié à une réservation ou un abonnement.' });
    }

    // Normaliser 'sur_place' / 'on_site' → 'cash' pour la base de données
    if (mode === 'sur_place' || mode === 'on_site') mode = 'cash';

    const validModes = ['cash', 'bank_transfer', 'check']; // D1 : plus de mode « online »
    if (!validModes.includes(mode)) {
      return res.status(400).json({ error: `Mode de paiement invalide: '${mode}'. Valeurs acceptées : sur_place, on_site, cash, bank_transfer, check.` });
    }

    const validStatuts = ['pending', 'paid', 'failed', 'refunded'];
    if (statut && !validStatuts.includes(statut)) {
      return res.status(400).json({ error: 'Statut invalide. Valeurs acceptées : pending, paid, failed, refunded.' });
    }

    if (montant <= 0) {
      return res.status(400).json({ error: 'Le montant doit être supérieur à 0.' });
    }

    if (reservation_id) {
      const { data: reservation, error: resError } = await supabaseAdmin
        .from('reservations')
        .select('id, user_id, tenant_id')
        .eq('id', reservation_id)
        .single();

      if (resError || !reservation) {
        return res.status(404).json({ error: 'Réservation introuvable.' });
      }

      if (reservation.user_id !== userId) {
        return res.status(403).json({ error: 'Vous ne pouvez créer un paiement que pour vos propres réservations.' });
      }

      req.tenantId = reservation.tenant_id;

      const { data: existing } = await supabaseAdmin
        .from('paiements')
        .select('*')
        .eq('reservation_id', reservation_id)
        .eq('user_id', userId)
        .in('statut', ['pending', 'paid'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        return res.status(200).json({ payment: existing, message: 'Paiement déjà existant.' });
      }
    }

    if (abonnement_id) {
      const { data: abonnement, error: abError } = await supabaseAdmin
        .from('abonnements')
        .select('id, user_id, tenant_id')
        .eq('id', abonnement_id)
        .single();

      if (abError || !abonnement) {
        return res.status(404).json({ error: 'Abonnement introuvable.' });
      }

      if (abonnement.user_id !== userId) {
        return res.status(403).json({ error: 'Vous ne pouvez créer un paiement que pour vos propres abonnements.' });
      }

      req.tenantId = abonnement.tenant_id;
    }

    const paymentData = {
      user_id: userId,
      reservation_id: reservation_id || null,
      abonnement_id: abonnement_id || null,
      montant: parseFloat(montant),
      mode,
      statut: 'pending', // D1 : seul le staff encaisse (statut « paid » réservé à createPayment)
      tenant_id: req.tenantId,
    };

    const { data, error } = await supabaseAdmin
      .from('paiements')
      .insert(paymentData)
      .select('*, profiles(nom, prenom, email)')
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json({ payment: data, message: 'Montant dû enregistré. Règlement à effectuer sur place.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function listPayments(req, res) {
  const { statut, mode, user_id, limit = 50, offset = 0 } = req.query;

  try {
    let query = supabaseAdmin
      .from('paiements')
      .select(`
        *,
        profiles(nom, prenom, email, type_membre),
        reservations(date_debut, date_fin, espaces(nom)),
        abonnements(type, date_debut, date_fin)
      `)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    query = applyTenantFilter(query, req);

    if (statut) query = query.eq('statut', statut);
    if (mode) query = query.eq('mode', mode);
    if (user_id) query = query.eq('user_id', user_id);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    let payMetaMap = {};
    if (req.tenantId) {
      const { data: tRow } = await supabaseAdmin.from('tenants').select('settings').eq('id', req.tenantId).maybeSingle();
      payMetaMap = (tRow?.settings?.payment_meta && typeof tRow.settings.payment_meta === 'object')
        ? tRow.settings.payment_meta
        : {};
    }

    const enriched = (data || []).map((p) => {
      const meta = payMetaMap[p.id] || {};
      const totalDu = roundMillime(p.total_du ?? meta.total_du ?? p.montant ?? 0);
      const resteAPayer = p.statut === 'paid' || p.statut === 'refunded'
        ? 0
        : roundMillime(p.reste_a_payer ?? meta.reste_a_payer ?? p.montant ?? 0);
      const montantPaye = p.statut === 'paid'
        ? totalDu
        : roundMillime(p.montant_paye ?? meta.montant_paye ?? Math.max(0, totalDu - resteAPayer));
      const logicalStatut = meta.logical_status && p.statut === 'pending' ? meta.logical_status : p.statut;
      const aging = (logicalStatut === 'pending' || logicalStatut === 'partial')
        ? computeAgingBucket(p.due_date || p.reservations?.date_fin || p.created_at)
        : { daysOverdue: 0, bucket: 'regle', label: 'Réglé' };

      return {
        ...p,
        statut: logicalStatut,
        total_du: totalDu,
        montant_paye: montantPaye,
        reste_a_payer: resteAPayer,
        days_overdue: aging.daysOverdue,
        aging_bucket: aging.bucket,
        aging_label: aging.label,
        promesse_paiement_date: p.promesse_paiement_date || meta.promesse_paiement_date || null,
        promesse_paiement_note: p.promesse_paiement_note || meta.promesse_paiement_note || null,
        last_reminder_at: p.last_reminder_at || meta.last_reminder_at || null,
        last_reminder_channel: p.last_reminder_channel || meta.last_reminder_channel || null,
        reminder_count: p.reminder_count ?? meta.reminder_count ?? 0,
        avoir_document_id: p.avoir_document_id || meta.avoir_document_id || null,
        avoir_numero: meta.avoir_numero || null,
        motif_remboursement: p.motif_remboursement || meta.motif_remboursement || null,
      };
    });

    res.json({
      payments: enriched,
      total: enriched.length,
      offset: parseInt(offset),
      limit: parseInt(limit),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getMemberPayments(req, res) {
  const { memberId } = req.params;
  const isSelf = memberId === req.user.id;
  const isStaff = ['super_admin', 'admin', 'staff'].includes(req.profile.role);

  if (!isSelf && !isStaff) {
    return res.status(403).json({ error: 'Accès refusé. Vous ne pouvez consulter que vos propres paiements.' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('paiements')
      .select(`
        *,
        profiles(nom, prenom, email),
        reservations(date_debut, date_fin, espaces(nom, type)),
        abonnements(type, date_debut, date_fin),
        inscriptions_formations ( formations (id, titre) )
      `)
      .eq('user_id', memberId)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    const stats = {
      total_paiements: data.length,
      total_montant: data.reduce((sum, p) => sum + parseFloat(p.montant || 0), 0),
      pending: data.filter(p => p.statut === 'pending').length,
      paid: data.filter(p => p.statut === 'paid').length,
      failed: data.filter(p => p.statut === 'failed').length,
      refunded: data.filter(p => p.statut === 'refunded').length,
    };

    res.json({ payments: data, statistics: stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getPendingPayments(req, res) {
  try {
    let query = supabaseAdmin
      .from('paiements')
      .select(`
        *,
        profiles(nom, prenom, email, telephone),
        reservations(date_debut, date_fin, espaces(nom)),
        abonnements(type, date_debut, date_fin)
      `)
      .eq('statut', 'pending')
      .order('created_at', { ascending: true });
    query = applyTenantFilter(query, req);
    const { data, error } = await query;

    if (error) return res.status(500).json({ error: error.message });

    const totalImpaye = data.reduce((sum, p) => sum + parseFloat(p.montant || 0), 0);
    const today = new Date();
    const paymentsEnRetard = data.filter(p => {
      const createdDate = new Date(p.created_at);
      const diffTime = Math.abs(today - createdDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays > 3;
    });

    res.json({
      pending_payments: data,
      total_count: data.length,
      total_amount: totalImpaye,
      overdue_count: paymentsEnRetard.length,
      overdue_payments: paymentsEnRetard,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updatePayment(req, res) {
  const { id } = req.params;
  const { statut, mode, montant, date_paiement } = req.body;
  const updates = {};

  if (statut !== undefined) {
    const validStatuts = ['pending', 'paid', 'failed', 'refunded'];
    if (!validStatuts.includes(statut)) {
      return res.status(400).json({ error: 'Statut invalide. Valeurs acceptées : pending, paid, failed, refunded.' });
    }
    updates.statut = statut;
    if (statut === 'paid') {
      if (!date_paiement) updates.date_paiement = new Date().toISOString();
      if (req.body.numero_recu) {
        updates.numero_recu = req.body.numero_recu;
      } else {
        const { data: curPay } = await supabaseAdmin.from('paiements').select('tenant_id, numero_recu').eq('id', id).maybeSingle();
        updates.numero_recu = curPay?.numero_recu || await allocateDocumentNumber(supabaseAdmin, curPay?.tenant_id || req.tenantId, 'receipt');
      }
    }
  }

  if (mode !== undefined) {
    const validModes = ['cash', 'bank_transfer', 'check']; // D1 : plus de mode « online »
    if (!validModes.includes(mode)) {
      return res.status(400).json({ error: 'Mode de paiement invalide. Valeurs acceptées : cash, bank_transfer, check.' });
    }
    updates.mode = mode;
  }

  if (montant !== undefined) {
    if (montant <= 0) {
      return res.status(400).json({ error: 'Le montant doit être supérieur à 0.' });
    }
    updates.montant = parseFloat(montant);
  }

  if (date_paiement !== undefined) {
    updates.date_paiement = date_paiement;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Aucune mise à jour fournie.' });
  }

  try {
    const { data: existing, error: checkError } = await supabaseAdmin
      .from('paiements')
      .select('id')
      .eq('id', id)
      .single();

    if (checkError || !existing) {
      return res.status(404).json({ error: 'Paiement introuvable.' });
    }

    const { data, error } = await supabaseAdmin
      .from('paiements')
      .update(updates)
      .eq('id', id)
      .select(`
        *,
        profiles(nom, prenom, email),
        reservations(date_debut, date_fin, espaces(nom)),
        abonnements(type, date_debut, date_fin)
      `)
      .single();

    if (error) return res.status(400).json({ error: error.message });

    if (statut === 'paid') {
      try {
        await notifyPaiementEnregistre(
          supabaseAdmin,
          {
            id: data.id,
            montant: data.montant,
            mode: data.mode,
            statut: data.statut,
            date_paiement: data.date_paiement,
            numero_recu: data.numero_recu,
            reservations: data.reservations,
            abonnements: data.abonnements
          },
          {
            id: data.user_id,
            nom: data.profiles.nom,
            prenom: data.profiles.prenom,
            email: data.profiles.email
          }
        );

        if (isEmailConfigured()) {
          const pdfBuffer = await generateReceiptPDF(data, {
            coworkingName: process.env.COWORKING_NAME || 'DeskyWork',
            coworkingEmail: process.env.COWORKING_EMAIL || 'contact@deskywork.tn',
            coworkingTel: process.env.COWORKING_TEL || '+216 52 882 880 / +216 52 882 930',
            coworkingAdresse: process.env.COWORKING_ADRESSE || 'Tunis, Tunisie',
          });

          await sendReceiptEmail(data, pdfBuffer, {
            coworkingName: process.env.COWORKING_NAME || 'DeskyWork',
            coworkingEmail: process.env.COWORKING_EMAIL || 'contact@deskywork.tn',
            coworkingTel: process.env.COWORKING_TEL || '+216 52 882 880 / +216 52 882 930',
          });
        }
      } catch (emailErr) {
        console.error('⚠️ Échec notification/email paiement:', emailErr.message);
      }
    }

    res.json({ payment: data, message: 'Paiement mis à jour avec succès.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getPaymentReceipt(req, res) {
  const { id } = req.params;
  const isStaff = ['super_admin', 'admin', 'staff'].includes(req.profile.role);

  try {
    const { data: payment, error } = await supabaseAdmin
      .from('paiements')
      .select(`
        *,
        profiles(nom, prenom, email, telephone),
        reservations(date_debut, date_fin, espaces(nom, type)),
        abonnements(type, date_debut, date_fin)
      `)
      .eq('id', id)
      .single();

    if (error || !payment) {
      return res.status(404).json({ error: 'Paiement introuvable.' });
    }

    if (!isStaff && payment.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Accès refusé. Ce reçu ne vous appartient pas.' });
    }

    // Ne JAMAIS allouer de numéro de reçu au téléchargement PDF (uniquement à l'encaissement)
    let tenantRow = null;
    if (payment.tenant_id) {
      const { data: t } = await supabaseAdmin.from('tenants').select('nom, email, telephone, adresse').eq('id', payment.tenant_id).maybeSingle();
      tenantRow = t;
    }

    const pdfBuffer = await generateReceiptPDF(payment, {
      coworkingName: tenantRow?.nom || process.env.COWORKING_NAME || 'DeskyWork',
      coworkingEmail: tenantRow?.email || process.env.COWORKING_EMAIL || 'contact@deskywork.tn',
      coworkingTel: tenantRow?.telephone || process.env.COWORKING_TEL || '+216 52 882 880 / +216 52 882 930',
      coworkingAdresse: tenantRow?.adresse || process.env.COWORKING_ADRESSE || 'Tunis, Tunisie',
    });

    const filename = `recu-${payment.numero_recu || payment.id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: 'Impossible de générer le reçu PDF : ' + err.message });
  }
}

async function stripePay(req, res) {
  const { paymentId } = req.body;
  if (!paymentId) return res.status(400).json({ error: 'paymentId requis' });

  try {
    if (!isStripeConfigured()) {
      return res.status(503).json({ error: 'Stripe non configuré. Ajoutez STRIPE_SECRET_KEY dans .env.' });
    }

    const { data: payment, error } = await supabaseAdmin
      .from('paiements')
      .select(`*, inscriptions_formations ( formations (titre) )`)
      .eq('id', paymentId)
      .eq('user_id', req.user.id)
      .single();

    if (error || !payment) return res.status(404).json({ error: 'Paiement introuvable.' });
    if (payment.statut === 'paid') return res.status(400).json({ error: 'Ce paiement est déjà réglé.' });

    const paymentsPath = req.profile.role === 'formateur' ? '/trainer/payments' : '/member/payments';
    const session = await createCheckoutSession(payment, req.user.id, { paymentsPath });

    if (session.id) {
      await supabaseAdmin
        .from('paiements')
        .update({ reference_externe: session.id })
        .eq('id', paymentId);
    }

    res.json({ link: session.url, session_id: session.id });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Impossible de contacter Stripe.' });
  }
}

async function stripeVerify(req, res) {
  const { paymentId, session_id: sessionId } = req.body;
  if (!paymentId) return res.status(400).json({ error: 'paymentId requis' });

  try {
    const { data: payment, error: fetchErr } = await supabaseAdmin
      .from('paiements')
      .select('*')
      .eq('id', paymentId)
      .eq('user_id', req.user.id)
      .single();

    if (fetchErr || !payment) return res.status(404).json({ error: 'Paiement introuvable.' });

    if (payment.statut === 'paid') {
      return res.json({ success: true, payment });
    }

    const stripeSessionId = sessionId || payment.reference_externe;
    if (!stripeSessionId) {
      return res.status(400).json({ error: 'Référence session Stripe manquante.' });
    }

    const session = await retrieveCheckoutSession(stripeSessionId);
    validateCheckoutSession(session, paymentId, req.user.id);

    if (isCheckoutSessionPaid(session)) {
      const updatedPayment = await finalizeOnlinePayment(
        supabaseAdmin,
        paymentId,
        req.user.id,
        getExternalReference(session)
      );
      return res.json({ success: true, payment: updatedPayment });
    }

    res.json({ success: false, message: "Le paiement n'a pas été validé par Stripe." });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erreur lors de la vérification Stripe' });
  }
}

async function stripeWebhookHandler(req, res) {
  const signature = req.headers['stripe-signature'];
  if (!signature) return res.status(400).send('Signature Stripe manquante.');

  try {
    const event = constructWebhookEvent(req.body, signature);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const paymentId = session.metadata?.paymentId;
      const userId = session.metadata?.userId;

      if (paymentId && userId && isCheckoutSessionPaid(session)) {
        await finalizeOnlinePayment(
          supabaseAdmin,
          paymentId,
          userId,
          getExternalReference(session)
        );
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Erreur Stripe Webhook:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
}


// Numérotation continue assurée exclusivement par models/numbering.js (allocateDocumentNumber)
// Ne jamais allouer de numéro aléatoire ni lors du téléchargement PDF.

// GET /api/montant-du — Entité « Montant dû » unifiée (réservations, dépassements, prolongations, formations, abonnements)
async function getMontantDu(req, res) {
  try {
    const isStaff = ['super_admin', 'admin', 'staff'].includes(req.profile.role);
    const targetUserId = isStaff ? (req.query.user_id || null) : req.user.id;

    let q = supabaseAdmin
      .from('paiements')
      .select(`
        *,
        profiles(id, nom, prenom, email, telephone, type_membre),
        reservations(id, date_debut, date_fin, espaces(nom, type)),
        abonnements(id, type, date_debut, date_fin),
        inscriptions_formations(id, formation_id, formations(id, titre))
      `)
      .in('statut', ['pending', 'partial'])
      .order('created_at', { ascending: false });

    if (targetUserId) q = q.eq('user_id', targetUserId);
    if (isStaff && req.tenantId) q = q.eq('tenant_id', req.tenantId);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    let payMetaMap = {};
    if (req.tenantId) {
      const { data: tRow } = await supabaseAdmin.from('tenants').select('settings').eq('id', req.tenantId).maybeSingle();
      payMetaMap = (tRow?.settings?.payment_meta && typeof tRow.settings.payment_meta === 'object')
        ? tRow.settings.payment_meta
        : {};
    }

    const items = (data || []).map((p) => {
      const ref = String(p.reference_externe || '').toUpperCase();
      let categorie = 'autre';
      let libelle = 'Frais';
      const meta = payMetaMap[p.id] || {};
      const totalDu = roundMillime(p.total_du ?? meta.total_du ?? p.montant ?? 0);
      const resteAPayer = roundMillime(p.reste_a_payer ?? meta.reste_a_payer ?? p.montant ?? 0);
      const montantPaye = roundMillime(p.montant_paye ?? meta.montant_paye ?? Math.max(0, totalDu - resteAPayer));
      const aging = computeAgingBucket(p.due_date || p.reservations?.date_fin || p.created_at);
      if (ref.startsWith('DEPASSEMENT')) {
        categorie = 'depassement';
        libelle = `Dépassement horaire — ${p.reservations?.espaces?.nom || 'Espace'}`;
      } else if (ref.startsWith('PENALITE') || ref.startsWith('NOSHOW') || ref.startsWith('ANNULATION')) {
        categorie = 'penalite';
        libelle = ref.replace(/^PENALITE[:\-\s]*/i, '').trim() || `Pénalité — ${p.reservations?.espaces?.nom || 'Établissement'}`;
      } else if (ref.startsWith('PROLONGATION')) {
        categorie = 'prolongation';
        libelle = `Prolongation — ${p.reservations?.espaces?.nom || 'Espace'}`;
      } else if (p.inscriptions_formations?.length > 0 || ref.startsWith('FORMATION')) {
        categorie = 'formation';
        const titre = p.inscriptions_formations?.[0]?.formations?.titre || 'Session de formation';
        libelle = `Formation : ${titre}`;
      } else if (p.abonnement_id) {
        categorie = 'abonnement';
        libelle = `Abonnement : ${p.abonnements?.type || 'Standard'}`;
      } else if (p.reservation_id) {
        categorie = 'reservation';
        libelle = `Réservation — ${p.reservations?.espaces?.nom || 'Espace'}`;
      } else if (p.reference_externe) {
        libelle = p.reference_externe;
      }
      return {
        ...p,
        statut: meta.logical_status && p.statut === 'pending' ? meta.logical_status : p.statut,
        categorie,
        libelle,
        montant_du: Number(parseFloat(resteAPayer || p.montant || 0).toFixed(3)),
        total_du: totalDu,
        montant_paye: montantPaye,
        reste_a_payer: resteAPayer,
        days_overdue: aging.daysOverdue,
        aging_bucket: aging.bucket,
        aging_label: aging.label,
        promesse_paiement_date: p.promesse_paiement_date || meta.promesse_paiement_date || null,
        promesse_paiement_note: p.promesse_paiement_note || meta.promesse_paiement_note || null,
        last_reminder_at: p.last_reminder_at || meta.last_reminder_at || null,
        last_reminder_channel: p.last_reminder_channel || meta.last_reminder_channel || null,
        reminder_count: p.reminder_count ?? meta.reminder_count ?? 0,
      };
    });

    const totalDu = Number(items.reduce((sum, it) => sum + it.montant_du, 0).toFixed(3));
    res.json({ items, total_du: totalDu, count: items.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/payments/:id/collect — Encaissement sur place (complet ou partiel) + Reçu PDF numéroté (CDC v3.0 D1 & Chantier 4.2)
async function collectPayment(req, res) {
  const { id } = req.params;
  const { mode = 'cash', montant_encaisse } = req.body;
  const validModes = ['cash', 'bank_transfer', 'check'];
  if (!validModes.includes(mode)) {
    return res.status(400).json({ error: 'Mode invalide. Valeurs acceptées : cash (Espèces), bank_transfer (Virement), check (Chèque).' });
  }

  try {
    const { data: pendingRow, error: fetchErr } = await supabaseAdmin
      .from('paiements')
      .select('*, profiles(nom, prenom, email), reservations(date_debut, date_fin, espaces(nom)), abonnements(type, date_debut, date_fin)')
      .eq('id', id)
      .single();

    if (fetchErr || !pendingRow) return res.status(404).json({ error: 'Montant dû introuvable.' });
    if (pendingRow.statut === 'paid') return res.status(400).json({ error: 'Ce montant est déjà intégralement encaissé.' });

    let paidPayment = null;
    let remainingPayment = null;
    const tid = pendingRow.tenant_id || req.tenantId;

    // Charger métadonnées partiel existantes si pré-migration
    let tenantSettings = {};
    if (tid) {
      const { data: tRow } = await supabaseAdmin.from('tenants').select('settings').eq('id', tid).maybeSingle();
      tenantSettings = (tRow?.settings && typeof tRow.settings === 'object') ? tRow.settings : {};
    }
    const payMetaMap = (tenantSettings.payment_meta && typeof tenantSettings.payment_meta === 'object')
      ? { ...tenantSettings.payment_meta }
      : {};
    const existingMeta = payMetaMap[pendingRow.id] || {};

    const totalInitialDue = roundMillime(pendingRow.total_du ?? existingMeta.total_du ?? pendingRow.montant ?? 0);
    const alreadyPaid = roundMillime(pendingRow.montant_paye ?? existingMeta.montant_paye ?? 0);
    const desiredCollect = montant_encaisse != null
      ? roundMillime(montant_encaisse)
      : roundMillime(pendingRow.reste_a_payer ?? pendingRow.montant ?? 0);

    const calc = computePartialPaymentState({
      totalDue: totalInitialDue,
      alreadyPaid,
      collectedNow: desiredCollect,
    });
    if (!calc.valid) {
      return res.status(400).json({ error: calc.error });
    }

    const encaisse = calc.collectedNow;
    const reste = calc.resteAPayer;
    const nowIso = new Date().toISOString();
    // Numérotation continue et sans trou : allouée UNIQUEMENT au moment de l'encaissement
    const numeroRecu = await allocateDocumentNumber(supabaseAdmin, tid, 'receipt');

    if (reste > 0.001) {
      // Encaissement partiel : le dossier passe en "partial" (repli "pending" si pré-migration) + création d'une tranche encaissée numérotée
      const remPayloadFull = {
        montant: reste,
        statut: 'partial',
        total_du: totalInitialDue,
        montant_paye: calc.montantPayeTotal,
        reste_a_payer: reste,
        updated_at: nowIso,
      };
      let { data: rem, error: remErr } = await supabaseAdmin
        .from('paiements')
        .update(remPayloadFull)
        .eq('id', pendingRow.id)
        .select('*')
        .single();
      if (remErr) {
        ({ data: rem, error: remErr } = await supabaseAdmin
          .from('paiements')
          .update({ montant: reste, statut: 'pending' })
          .eq('id', pendingRow.id)
          .select('*')
          .single());
      }
      if (remErr) return res.status(400).json({ error: remErr.message });
      remainingPayment = {
        ...rem,
        total_du: totalInitialDue,
        montant_paye: calc.montantPayeTotal,
        reste_a_payer: reste,
        statut: 'partial',
      };

      const trancheFull = {
        user_id: pendingRow.user_id,
        reservation_id: pendingRow.reservation_id,
        abonnement_id: pendingRow.abonnement_id,
        tenant_id: pendingRow.tenant_id,
        parent_payment_id: pendingRow.id,
        montant: encaisse,
        total_du: totalInitialDue,
        montant_paye: calc.montantPayeTotal,
        reste_a_payer: reste,
        mode,
        statut: 'paid',
        date_paiement: nowIso,
        numero_recu: numeroRecu,
        reference_externe: `PARTIEL-${pendingRow.reference_externe || pendingRow.id.slice(0, 8)}`,
      };
      let { data: tranche, error: trErr } = await supabaseAdmin
        .from('paiements')
        .insert(trancheFull)
        .select('*, profiles(nom, prenom, email), reservations(date_debut, date_fin, espaces(nom)), abonnements(type, date_debut, date_fin)')
        .single();
      if (trErr && /column|does not exist|schema cache/i.test(trErr.message || '')) {
        ({ data: tranche, error: trErr } = await supabaseAdmin
          .from('paiements')
          .insert({
            user_id: pendingRow.user_id,
            reservation_id: pendingRow.reservation_id,
            abonnement_id: pendingRow.abonnement_id,
            tenant_id: pendingRow.tenant_id,
            montant: encaisse,
            mode,
            statut: 'paid',
            date_paiement: nowIso,
            numero_recu: numeroRecu,
            reference_externe: `PARTIEL-${pendingRow.reference_externe || pendingRow.id.slice(0, 8)}`,
          })
          .select('*, profiles(nom, prenom, email), reservations(date_debut, date_fin, espaces(nom)), abonnements(type, date_debut, date_fin)')
          .single());
      }
      if (trErr) return res.status(400).json({ error: trErr.message });
      paidPayment = {
        ...tranche,
        total_du: totalInitialDue,
        montant_paye: calc.montantPayeTotal,
        reste_a_payer: reste,
      };

      if (tid) {
        payMetaMap[pendingRow.id] = {
          ...existingMeta,
          total_du: totalInitialDue,
          montant_paye: calc.montantPayeTotal,
          reste_a_payer: reste,
          logical_status: 'partial',
        };
        payMetaMap[paidPayment.id] = {
          total_du: totalInitialDue,
          montant_paye: calc.montantPayeTotal,
          reste_a_payer: reste,
          parent_payment_id: pendingRow.id,
        };
        await supabaseAdmin.from('tenants').update({
          settings: { ...tenantSettings, payment_meta: payMetaMap },
        }).eq('id', tid);
      }
    } else {
      // Encaissement total du solde restant
      let { data: fullPaid, error: fpErr } = await supabaseAdmin
        .from('paiements')
        .update({
          statut: 'paid',
          mode,
          date_paiement: nowIso,
          numero_recu: numeroRecu,
          total_du: totalInitialDue,
          montant_paye: totalInitialDue,
          reste_a_payer: 0,
        })
        .eq('id', pendingRow.id)
        .select('*, profiles(nom, prenom, email), reservations(date_debut, date_fin, espaces(nom)), abonnements(type, date_debut, date_fin)')
        .single();
      if (fpErr && /column|does not exist|schema cache/i.test(fpErr.message || '')) {
        ({ data: fullPaid, error: fpErr } = await supabaseAdmin
          .from('paiements')
          .update({
            statut: 'paid',
            mode,
            date_paiement: nowIso,
            numero_recu: numeroRecu,
          })
          .eq('id', pendingRow.id)
          .select('*, profiles(nom, prenom, email), reservations(date_debut, date_fin, espaces(nom)), abonnements(type, date_debut, date_fin)')
          .single());
      }
      if (fpErr) return res.status(400).json({ error: fpErr.message });
      paidPayment = {
        ...fullPaid,
        total_du: totalInitialDue,
        montant_paye: totalInitialDue,
        reste_a_payer: 0,
      };

      if (tid) {
        payMetaMap[pendingRow.id] = {
          ...existingMeta,
          total_du: totalInitialDue,
          montant_paye: totalInitialDue,
          reste_a_payer: 0,
          logical_status: 'paid',
        };
        await supabaseAdmin.from('tenants').update({
          settings: { ...tenantSettings, payment_meta: payMetaMap },
        }).eq('id', tid);
      }

      // Mettre à jour statut paiement sur inscription_formation éventuelle
      try {
        await supabaseAdmin
          .from('inscriptions_formations')
          .update({ statut_paiement: 'paye', updated_at: nowIso })
          .eq('paiement_id', pendingRow.id);
      } catch (_) {}
    }

    // Notifier & envoyer le Reçu PDF par e-mail (D1 & D2)
    try {
      if (paidPayment?.profiles) {
        await notifyPaiementEnregistre(
          supabaseAdmin,
          paidPayment,
          { id: paidPayment.user_id, nom: paidPayment.profiles.nom, prenom: paidPayment.profiles.prenom, email: paidPayment.profiles.email }
        );
        if (isEmailConfigured()) {
          const pdfBuffer = await generateReceiptPDF(paidPayment, {
            coworkingName: process.env.COWORKING_NAME || 'DeskyWork',
            coworkingEmail: process.env.COWORKING_EMAIL || 'contact@deskywork.tn',
            coworkingTel: process.env.COWORKING_TEL || '+216 52 882 880 / +216 52 882 930',
            coworkingAdresse: process.env.COWORKING_ADRESSE || 'Tunis, Tunisie',
          });
          await sendReceiptEmail(paidPayment, pdfBuffer, {
            coworkingName: process.env.COWORKING_NAME || 'DeskyWork',
            coworkingEmail: process.env.COWORKING_EMAIL || 'contact@deskywork.tn',
          });
        }
      }
    } catch (e) {
      console.warn('⚠️ Notification/Reçu email encaissement:', e.message);
    }

    try {
      await logActivity({
        tenantId: req.tenantId || remainingPayment?.tenant_id || paidPayment?.tenant_id,
        req,
        action: 'encaissement',
        entityType: 'paiement',
        entityId: paidPayment?.id || pendingRow.id,
        entityLabel: `${encaisse.toFixed(3)} DT (Reçu ${paidPayment?.numero_recu || ''})`,
        afterData: {
          montant_encaisse: encaisse,
          mode,
          total_du: totalInitialDue,
          montant_paye: calc.montantPayeTotal,
          reste_a_payer: reste,
          numero_recu: paidPayment?.numero_recu,
        },
      });
    } catch (_) {}

    res.json({
      partial: reste > 0.001,
      total_du: totalInitialDue,
      montant_paye: calc.montantPayeTotal,
      reste_a_payer: reste,
      paid_payment: paidPayment,
      remaining_payment: remainingPayment,
      numero_recu: paidPayment.numero_recu,
      message: reste > 0.001
        ? `Encaissement partiel de ${encaisse.toFixed(3)} DT enregistré (Reçu ${paidPayment.numero_recu}). Reste à payer : ${reste.toFixed(3)} DT.`
        : `Encaissement complet de ${encaisse.toFixed(3)} DT enregistré (Reçu ${paidPayment.numero_recu}).`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/payments/:id/refund — Remboursement total ou partiel (Responsable uniquement) + génération automatique d'Avoir
async function refundPayment(req, res) {
  try {
    const { id } = req.params;
    const { montant_rembourse, motif_remboursement = '' } = req.body || {};

    const cleanMotif = String(motif_remboursement || '').trim();
    if (cleanMotif.length < 3) {
      return res.status(400).json({
        error: 'Un motif explicite (minimum 3 caractères) est obligatoire pour valider un remboursement.',
        code: 'REFUND_MOTIF_REQUIRED',
      });
    }

    let q = supabaseAdmin.from('paiements').select('*, profiles(id, nom, prenom, email, telephone)').eq('id', id);
    if (req.tenantId) q = q.eq('tenant_id', req.tenantId);
    const { data: existing, error: fetchErr } = await q.single();
    if (fetchErr || !existing) return res.status(404).json({ error: 'Paiement introuvable.' });

    if (existing.statut !== 'paid') {
      return res.status(400).json({ error: 'Seul un paiement encaissé peut être remboursé.' });
    }

    const totalInitial = roundMillime(existing.montant || 0);
    const refundAmount = montant_rembourse !== undefined ? roundMillime(montant_rembourse) : totalInitial;
    if (!Number.isFinite(refundAmount) || refundAmount <= 0 || refundAmount > totalInitial) {
      return res.status(400).json({ error: `Le montant à rembourser doit être compris entre 0,001 DT et ${totalInitial.toFixed(3)} DT.` });
    }

    const nowIso = new Date().toISOString();
    const tid = req.tenantId || existing.tenant_id;

    // Générer automatiquement un Avoir comptable continu (AV-YYYY-XXXX)
    let avoirDoc = null;
    if (tid) {
      try {
        const numeroAvoir = await allocateDocumentNumber(supabaseAdmin, tid, 'credit_note');
        const { data: tenantRow } = await supabaseAdmin.from('tenants').select('*').eq('id', tid).maybeSingle();
        const tvaPct = Number(tenantRow?.settings?.tva_defaut_pct ?? 19);
        const montantHT = roundMillime(refundAmount / (1 + tvaPct / 100));
        const totalTVA = roundMillime(refundAmount - montantHT);
        const clientNom = existing.profiles
          ? `${existing.profiles.prenom || ''} ${existing.profiles.nom || ''}`.trim() || 'Client'
          : 'Client';

        const avoirPayload = {
          tenant_id: tid,
          type: 'avoir',
          numero: numeroAvoir,
          user_id: existing.user_id || null,
          paiement_id: existing.id,
          reservation_id: existing.reservation_id || null,
          abonnement_id: existing.abonnement_id || null,
          client_nom: clientNom,
          client_email: existing.profiles?.email || null,
          client_telephone: existing.profiles?.telephone || null,
          montant_ht: -montantHT,
          tva_pct: tvaPct,
          total_tva: -totalTVA,
          timbre_fiscal: 0,
          montant_ttc: -refundAmount,
          statut: 'emise',
          date_emission: nowIso.slice(0, 10),
          motif_avoir: cleanMotif,
          lignes: [
            {
              designation: `Avoir sur remboursement paiement ${existing.numero_recu || existing.id.slice(0, 8)} — ${cleanMotif}`,
              quantite: 1,
              prix_unitaire_ht: -montantHT,
              total_ht: -montantHT,
            },
          ],
          locked: true,
          locked_at: nowIso,
          created_by: req.user?.id || null,
          created_at: nowIso,
          updated_at: nowIso,
        };

        const { data: insertedAvoir, error: avErr } = await supabaseAdmin
          .from('devis_factures')
          .insert(avoirPayload)
          .select()
          .single();

        if (!avErr && insertedAvoir) {
          avoirDoc = insertedAvoir;
        } else {
          const settings = (tenantRow?.settings && typeof tenantRow.settings === 'object') ? tenantRow.settings : {};
          const existingDocs = Array.isArray(settings.devis_factures) ? settings.devis_factures : [];
          avoirDoc = { id: `av-${Date.now()}`, ...avoirPayload };
          await supabaseAdmin.from('tenants').update({
            settings: { ...settings, devis_factures: [avoirDoc, ...existingDocs] },
          }).eq('id', tid);
        }
      } catch (_) {}
    }

    let { data, error } = await supabaseAdmin
      .from('paiements')
      .update({
        statut: 'refunded',
        montant_rembourse: refundAmount,
        motif_remboursement: cleanMotif,
        avoir_document_id: avoirDoc?.id || null,
        refunded_at: nowIso,
        refunded_by: req.user?.id || null,
        updated_at: nowIso,
      })
      .eq('id', id)
      .select('*, profiles(id, nom, prenom, email)')
      .single();

    if (error && /column|does not exist|schema cache/i.test(error.message || '')) {
      ({ data, error } = await supabaseAdmin
        .from('paiements')
        .update({
          statut: 'refunded',
          reference_externe: `REMBOURSEMENT ${refundAmount.toFixed(3)} DT${cleanMotif ? ` — ${cleanMotif}` : ''}`,
          updated_at: nowIso,
        })
        .eq('id', id)
        .select('*, profiles(id, nom, prenom, email)')
        .single());
    }

    if (error) return res.status(400).json({ error: error.message });

    if (tid) {
      try {
        const { data: tRow } = await supabaseAdmin.from('tenants').select('settings').eq('id', tid).maybeSingle();
        const cur = (tRow?.settings && typeof tRow.settings === 'object') ? tRow.settings : {};
        const payMeta = { ...(cur.payment_meta || {}) };
        payMeta[id] = {
          ...(payMeta[id] || {}),
          montant_rembourse: refundAmount,
          motif_remboursement: cleanMotif,
          avoir_document_id: avoirDoc?.id || null,
          avoir_numero: avoirDoc?.numero || null,
          refunded_at: nowIso,
        };
        await supabaseAdmin.from('tenants').update({ settings: { ...cur, payment_meta: payMeta } }).eq('id', tid);
      } catch (_) {}
    }

    await logActivity({
      tenantId: tid,
      req,
      action: 'remboursement',
      entityType: 'paiement',
      entityId: id,
      entityLabel: `Remboursement ${refundAmount.toFixed(3)} DT${avoirDoc?.numero ? ` (${avoirDoc.numero})` : ''}`,
      beforeData: { statut: existing.statut, montant: totalInitial },
      afterData: {
        statut: 'refunded',
        montant_rembourse: refundAmount,
        motif_remboursement: cleanMotif,
        avoir_numero: avoirDoc?.numero || null,
      },
    });

    res.json({
      payment: {
        ...data,
        montant_rembourse: refundAmount,
        refunded_at: nowIso,
        motif_remboursement: cleanMotif,
        avoir_document_id: avoirDoc?.id || null,
        avoir_numero: avoirDoc?.numero || null,
      },
      avoir: avoirDoc,
      message: `Remboursement de ${refundAmount.toFixed(3)} DT enregistré${avoirDoc?.numero ? ` avec génération de l’avoir ${avoirDoc.numero}` : ''}.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/montant-du — Ajouter manuellement un montant dû (pénalité, dépassement, prolongation, frais)
async function createMontantDu(req, res) {
  try {
    const { user_id, reservation_id = null, categorie = 'penalite', motif = '', montant } = req.body;
    const m = parseFloat(montant);
    if (!user_id || !Number.isFinite(m) || m <= 0) {
      return res.status(400).json({ error: 'user_id et montant positif requis.' });
    }

    const prefixMap = {
      penalite: 'PENALITE',
      depassement: 'DEPASSEMENT',
      prolongation: 'PROLONGATION',
      formation: 'FORMATION',
      autre: 'FRAIS',
    };
    const prefix = prefixMap[categorie] || 'PENALITE';
    const refExterne = `${prefix}${motif ? ` : ${String(motif).trim()}` : ''}`;

    const { data, error } = await supabaseAdmin
      .from('paiements')
      .insert({
        user_id,
        reservation_id: reservation_id || null,
        tenant_id: req.tenantId,
        montant: Number(m.toFixed(3)),
        mode: 'cash',
        statut: 'pending',
        reference_externe: refExterne,
      })
      .select('*, profiles(id, nom, prenom, email)')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    try {
      await supabaseAdmin.from('notifications').insert({
        user_id,
        titre: 'Nouveau montant dû enregistré',
        message: `Un montant de ${Number(m).toFixed(3)} DT (${refExterne}) a été ajouté à régler sur place.`,
        type: 'warning',
        lu: false,
      });
    } catch (_) {}

    res.status(201).json({ item: data, message: 'Montant dû enregistré.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/payments/unpaid/summary — Impayés classés par ancienneté (J+1, J+7, J+15) + règle de blocage
async function getUnpaidSummary(req, res) {
  try {
    const tid = req.tenantId;
    let q = supabaseAdmin
      .from('paiements')
      .select(`
        *,
        profiles(id, nom, prenom, email, telephone, type_membre),
        reservations(id, date_debut, date_fin, espaces(nom, type)),
        abonnements(id, type, date_debut, date_fin)
      `)
      .in('statut', ['pending', 'partial'])
      .order('created_at', { ascending: true });
    if (tid) q = q.eq('tenant_id', tid);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    let tenantSettings = {};
    let tenantName = 'DeskyWork';
    if (tid) {
      const { data: tRow } = await supabaseAdmin.from('tenants').select('nom, settings').eq('id', tid).maybeSingle();
      tenantSettings = tRow?.settings || {};
      tenantName = tRow?.nom || 'DeskyWork';
    }
    const payMetaMap = tenantSettings.payment_meta || {};
    const rules = getUnpaidBlockingConfig(tenantSettings);

    const items = (data || []).map((p) => {
      const meta = payMetaMap[p.id] || {};
      const totalDu = roundMillime(p.total_du ?? meta.total_du ?? p.montant ?? 0);
      const reste = roundMillime(p.reste_a_payer ?? meta.reste_a_payer ?? p.montant ?? 0);
      const paye = roundMillime(p.montant_paye ?? meta.montant_paye ?? Math.max(0, totalDu - reste));
      const aging = computeAgingBucket(p.due_date || p.reservations?.date_fin || p.created_at);
      const clientNom = p.profiles ? `${p.profiles.prenom || ''} ${p.profiles.nom || ''}`.trim() : 'Client';
      const promesseDate = p.promesse_paiement_date || meta.promesse_paiement_date || null;

      return {
        ...p,
        statut: meta.logical_status && p.statut === 'pending' ? meta.logical_status : p.statut,
        total_du: totalDu,
        montant_paye: paye,
        reste_a_payer: reste,
        days_overdue: aging.daysOverdue,
        aging_bucket: aging.bucket,
        aging_label: aging.label,
        promesse_paiement_date: promesseDate,
        promesse_paiement_note: p.promesse_paiement_note || meta.promesse_paiement_note || null,
        last_reminder_at: p.last_reminder_at || meta.last_reminder_at || null,
        last_reminder_channel: p.last_reminder_channel || meta.last_reminder_channel || null,
        reminder_count: p.reminder_count ?? meta.reminder_count ?? 0,
        templates: buildReminderTemplates({
          clientName: clientNom || 'Client',
          amountRemaining: reste,
          daysOverdue: aging.daysOverdue,
          tenantName,
          reference: p.reference_externe || '',
          promiseDate: promesseDate,
        }),
      };
    });

    const buckets = {
      a_echeance: items.filter((i) => i.aging_bucket === 'a_echeance'),
      j1: items.filter((i) => i.aging_bucket === 'j1'),
      j7: items.filter((i) => i.aging_bucket === 'j7'),
      j15: items.filter((i) => i.aging_bucket === 'j15'),
    };

    res.json({
      items,
      buckets: {
        a_echeance_count: buckets.a_echeance.length,
        j1_count: buckets.j1.length,
        j7_count: buckets.j7.length,
        j15_count: buckets.j15.length,
      },
      total_unpaid_amount: roundMillime(items.reduce((s, i) => s + Number(i.reste_a_payer || 0), 0)),
      rules,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/payments/:id/relance — Relancer un impayé (WhatsApp / Email) + historique
async function sendPaymentReminder(req, res) {
  try {
    const { id } = req.params;
    const { channel = 'whatsapp', custom_message = null } = req.body || {};
    if (!['whatsapp', 'email'].includes(channel)) {
      return res.status(400).json({ error: 'Canal de relance invalide (whatsapp ou email).' });
    }

    let q = supabaseAdmin
      .from('paiements')
      .select('*, profiles(id, nom, prenom, email, telephone), reservations(date_fin)')
      .eq('id', id);
    if (req.tenantId) q = q.eq('tenant_id', req.tenantId);
    const { data: row, error } = await q.single();
    if (error || !row) return res.status(404).json({ error: 'Impayé introuvable.' });

    const tid = req.tenantId || row.tenant_id;
    const { data: tRow } = tid
      ? await supabaseAdmin.from('tenants').select('nom, settings').eq('id', tid).maybeSingle()
      : { data: null };
    const settings = tRow?.settings || {};
    const payMeta = { ...(settings.payment_meta || {}) };
    const meta = payMeta[id] || {};

    const reste = roundMillime(row.reste_a_payer ?? meta.reste_a_payer ?? row.montant ?? 0);
    const aging = computeAgingBucket(row.due_date || row.reservations?.date_fin || row.created_at);
    const clientName = row.profiles ? `${row.profiles.prenom || ''} ${row.profiles.nom || ''}`.trim() : 'Client';
    const templates = buildReminderTemplates({
      clientName,
      amountRemaining: reste,
      daysOverdue: aging.daysOverdue,
      tenantName: tRow?.nom || 'DeskyWork',
      reference: row.reference_externe || '',
      promiseDate: row.promesse_paiement_date || meta.promesse_paiement_date || null,
    });

    const nowIso = new Date().toISOString();
    const nextCount = (parseInt(row.reminder_count ?? meta.reminder_count ?? 0, 10) || 0) + 1;

    await supabaseAdmin
      .from('paiements')
      .update({
        last_reminder_at: nowIso,
        last_reminder_channel: channel,
        reminder_count: nextCount,
        updated_at: nowIso,
      })
      .eq('id', id)
      .then(() => {})
      .catch(() => {});

    if (tid) {
      payMeta[id] = {
        ...meta,
        last_reminder_at: nowIso,
        last_reminder_channel: channel,
        reminder_count: nextCount,
      };
      await supabaseAdmin.from('tenants').update({
        settings: { ...settings, payment_meta: payMeta },
      }).eq('id', tid);
    }

    // Envoi email automatique si canal=email & transport configuré
    let emailSent = false;
    if (channel === 'email' && row.profiles?.email && isEmailConfigured()) {
      try {
        const { sendEmailUniversal } = require('../utils/sendEmail');
        await sendEmailUniversal({
          to: row.profiles.email,
          subject: templates.emailSubject,
          text: custom_message || templates.emailBody,
        });
        emailSent = true;
      } catch (_) {}
    }

    await logActivity({
      tenantId: tid,
      req,
      action: 'relance_impaye',
      entityType: 'paiement',
      entityId: id,
      entityLabel: `Relance ${channel === 'whatsapp' ? 'WhatsApp' : 'E-mail'} — ${clientName}`,
      afterData: { channel, reminder_count: nextCount, reste_a_payer: reste },
    });

    res.json({
      relance: {
        channel,
        reminder_count: nextCount,
        last_reminder_at: nowIso,
        email_sent: emailSent,
        templates,
      },
      message: channel === 'whatsapp'
        ? 'Message WhatsApp de relance préparé et journalisé.'
        : (emailSent ? 'Relance e-mail envoyée et journalisée.' : 'Modèle e-mail préparé et relance journalisée.'),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/payments/:id/promesse — Enregistrer une « Promesse de paiement » avec date
async function recordPaymentPromise(req, res) {
  try {
    const { id } = req.params;
    const { promesse_paiement_date, promesse_paiement_note = '' } = req.body || {};
    if (!promesse_paiement_date) {
      return res.status(400).json({ error: 'La date de promesse de paiement est obligatoire.' });
    }

    let q = supabaseAdmin.from('paiements').select('*, profiles(nom, prenom)').eq('id', id);
    if (req.tenantId) q = q.eq('tenant_id', req.tenantId);
    const { data: row, error } = await q.single();
    if (error || !row) return res.status(404).json({ error: 'Paiement introuvable.' });

    const tid = req.tenantId || row.tenant_id;
    const nowIso = new Date().toISOString();
    const cleanNote = String(promesse_paiement_note || '').trim();

    await supabaseAdmin
      .from('paiements')
      .update({
        promesse_paiement_date,
        promesse_paiement_note: cleanNote,
        updated_at: nowIso,
      })
      .eq('id', id)
      .then(() => {})
      .catch(() => {});

    if (tid) {
      const { data: tRow } = await supabaseAdmin.from('tenants').select('settings').eq('id', tid).maybeSingle();
      const settings = tRow?.settings || {};
      const payMeta = { ...(settings.payment_meta || {}) };
      payMeta[id] = {
        ...(payMeta[id] || {}),
        promesse_paiement_date,
        promesse_paiement_note: cleanNote,
      };
      await supabaseAdmin.from('tenants').update({
        settings: { ...settings, payment_meta: payMeta },
      }).eq('id', tid);
    }

    const clientName = row.profiles ? `${row.profiles.prenom || ''} ${row.profiles.nom || ''}`.trim() : 'Client';
    await logActivity({
      tenantId: tid,
      req,
      action: 'promesse_paiement',
      entityType: 'paiement',
      entityId: id,
      entityLabel: `Promesse au ${promesse_paiement_date} — ${clientName}`,
      afterData: { promesse_paiement_date, promesse_paiement_note: cleanNote },
    });

    res.json({
      promesse_paiement_date,
      promesse_paiement_note: cleanNote,
      message: 'Promesse de paiement enregistrée.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  createPayment,
  createPaymentSelf,
  listPayments,
  getMemberPayments,
  getPendingPayments,
  updatePayment,
  getMontantDu,
  createMontantDu,
  getUnpaidSummary,
  collectPayment,
  refundPayment,
  sendPaymentReminder,
  recordPaymentPromise,
  getPaymentReceipt,
  stripePay,
  stripeVerify,
  stripeWebhookHandler,
};
