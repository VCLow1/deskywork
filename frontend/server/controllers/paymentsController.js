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

async function createPayment(req, res) {
  try {
    const { user_id, reservation_id, abonnement_id, montant, mode, statut, date_paiement } = req.body;

    if (!user_id || !montant || !mode) {
      return res.status(400).json({ error: 'user_id, montant et mode sont requis.' });
    }

    if (!reservation_id && !abonnement_id) {
      return res.status(400).json({ error: 'Un paiement doit être lié à une réservation ou un abonnement.' });
    }

    const validModes = ['cash', 'bank_transfer', 'check', 'online'];
    if (!validModes.includes(mode)) {
      return res.status(400).json({ error: 'Mode de paiement invalide. Valeurs acceptées : cash, bank_transfer, check, online.' });
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

    const validModes = ['cash', 'bank_transfer', 'check', 'online'];
    if (!validModes.includes(mode)) {
      return res.status(400).json({ error: `Mode de paiement invalide: '${mode}'. Valeurs acceptées : sur_place, on_site, cash, bank_transfer, check, online.` });
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
      statut: statut || 'pending',
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

    res.json({
      payments: data,
      total: data.length,
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
    if (statut === 'paid' && !date_paiement) {
      updates.date_paiement = new Date().toISOString();
    }
  }

  if (mode !== undefined) {
    const validModes = ['cash', 'bank_transfer', 'check', 'online'];
    if (!validModes.includes(mode)) {
      return res.status(400).json({ error: 'Mode de paiement invalide. Valeurs acceptées : cash, bank_transfer, check, online.' });
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

    const pdfBuffer = await generateReceiptPDF(payment, {
      coworkingName: process.env.COWORKING_NAME || 'DeskyWork',
      coworkingEmail: process.env.COWORKING_EMAIL || 'contact@deskywork.tn',
      coworkingTel: process.env.COWORKING_TEL || '+216 52 882 880 / +216 52 882 930',
      coworkingAdresse: process.env.COWORKING_ADRESSE || 'Tunis, Tunisie',
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

module.exports = {
  createPayment,
  createPaymentSelf,
  listPayments,
  getMemberPayments,
  getPendingPayments,
  updatePayment,
  getPaymentReceipt,
  stripePay,
  stripeVerify,
  stripeWebhookHandler,
};
