// controllers/inscriptionsController.js — MODULE G : Inscriptions Formations
const { supabaseAdmin } = require('../config/supabase');
const { notifyInscriptionFormation } = require('../services/notificationService');

async function resolveFormationReservationId(formation) {
  if (formation?.espace_id) {
    const { data: matchedRes } = await supabaseAdmin
      .from('reservations')
      .select('id')
      .eq('espace_id', formation.espace_id)
      .eq('date_debut', formation.date_debut)
      .maybeSingle();
    if (matchedRes?.id) return matchedRes.id;
  }

  if (formation?.tenant_id) {
    const { data: tenantRes } = await supabaseAdmin
      .from('reservations')
      .select('id')
      .eq('tenant_id', formation.tenant_id)
      .limit(1)
      .maybeSingle();
    if (tenantRes?.id) return tenantRes.id;
  }

  const { data: anyRes } = await supabaseAdmin
    .from('reservations')
    .select('id')
    .limit(1)
    .maybeSingle();
  if (anyRes?.id) return anyRes.id;

  return null;
}

async function createInscription(req, res) {
  const formationId = req.params.id;
  const rawMode = req.body?.mode || 'sur_place';
  const paymentMode = (rawMode === 'sur_place' || rawMode === 'cash' || rawMode === 'on_site') ? 'cash' : 'online';

  try {
    const { data: formation, error: fErr } = await supabaseAdmin
      .from('formations').select('*').eq('id', formationId).single();
    if (fErr || !formation) return res.status(404).json({ error: 'Formation introuvable.' });
    if (formation.statut === 'annulee') return res.status(400).json({ error: 'Cette formation est annulée.' });
    if (formation.statut === 'terminee') return res.status(400).json({ error: 'Cette formation est terminée.' });

    const { data: existing } = await supabaseAdmin
      .from('inscriptions_formations').select('id, statut').eq('formation_id', formationId).eq('user_id', req.user.id).maybeSingle();

    if (existing && existing.statut !== 'annulee') {
      return res.status(409).json({ error: 'Vous êtes déjà inscrit à cette formation.' });
    }

    const { count: nbInscrits } = await supabaseAdmin
      .from('inscriptions_formations').select('*', { count: 'exact', head: true })
      .eq('formation_id', formationId).neq('statut', 'annulee');

    const placesRestantes = formation.capacite_max - (nbInscrits || 0);

    if (placesRestantes <= 0) {
      const { data: attente, error: atErr } = await supabaseAdmin
        .from('inscriptions_formations')
        .upsert({ formation_id: formationId, user_id: req.user.id, statut: 'en_attente', statut_paiement: formation.prix_inscription > 0 ? 'en_attente' : 'gratuit', updated_at: new Date().toISOString() }, { onConflict: 'formation_id,user_id' })
        .select().single();
      if (atErr) return res.status(400).json({ error: atErr.message });
      return res.status(201).json({ inscription: attente, message: 'Formation complète — ajouté en liste d\'attente.', liste_attente: true });
    }

    const { data: inscription, error: insErr } = await supabaseAdmin
      .from('inscriptions_formations')
      .upsert({ formation_id: formationId, user_id: req.user.id, statut: 'confirmee', statut_paiement: formation.prix_inscription > 0 ? 'en_attente' : 'gratuit', updated_at: new Date().toISOString() }, { onConflict: 'formation_id,user_id' })
      .select().single();

    if (insErr) return res.status(400).json({ error: insErr.message });

    let createdPayment = null;
    if (formation.prix_inscription > 0 && !inscription.paiement_id) {
      const reservationId = await resolveFormationReservationId(formation);
      const targetTenantId = formation.tenant_id || req.tenantId || null;

      const { data: payment, error: payErr } = await supabaseAdmin
        .from('paiements')
        .insert({
          user_id: req.user.id,
          reservation_id: reservationId,
          abonnement_id: null,
          montant: parseFloat(formation.prix_inscription),
          mode: paymentMode,
          statut: 'pending',
          tenant_id: targetTenantId,
        })
        .select()
        .single();

      if (payErr) {
        console.error('Erreur création paiement formation:', payErr.message);
        return res.status(500).json({ error: 'Impossible de créer le paiement associé à l\'inscription: ' + payErr.message });
      }

      createdPayment = payment;

      await supabaseAdmin
        .from('inscriptions_formations')
        .update({ paiement_id: payment.id })
        .eq('id', inscription.id);

      inscription.paiement_id = payment.id;
    }

    try {
      await notifyInscriptionFormation(supabaseAdmin,
        { id: formationId, titre: formation.titre, date_debut: formation.date_debut, date_fin: formation.date_fin },
        { id: req.user.id, nom: req.profile.nom, prenom: req.profile.prenom, email: req.user.email }
      );
    } catch (notifErr) { console.warn('⚠️ Notif inscription formation:', notifErr.message); }

    const confirmMsg = formation.prix_inscription > 0
      ? (paymentMode === 'cash' ? 'Inscription confirmée ! Le règlement s\'effectuera sur place à l\'accueil.' : 'Inscription confirmée ! Vous pouvez procéder au paiement en ligne.')
      : 'Inscription confirmée avec succès !';

    res.status(201).json({
      inscription,
      payment: createdPayment,
      message: confirmMsg,
      places_restantes: placesRestantes - 1,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createInscriptionPayment(req, res) {
  const formationId = req.params.id;
  const rawMode = req.body?.mode || 'online';
  const paymentMode = (rawMode === 'sur_place' || rawMode === 'cash' || rawMode === 'on_site') ? 'cash' : 'online';

  try {
    const { data: inscription, error: insErr } = await supabaseAdmin
      .from('inscriptions_formations')
      .select('*')
      .eq('formation_id', formationId)
      .eq('user_id', req.user.id)
      .single();

    if (insErr || !inscription) return res.status(404).json({ error: 'Inscription introuvable.' });
    if (inscription.statut !== 'confirmee') {
      return res.status(400).json({ error: 'Paiement possible uniquement pour une inscription confirmée.' });
    }

    const { data: formation, error: formationErr } = await supabaseAdmin
      .from('formations')
      .select('id, titre, prix_inscription, espace_id, date_debut, tenant_id')
      .eq('id', formationId)
      .single();

    if (formationErr || !formation) {
      return res.status(500).json({ error: 'Impossible de récupérer la formation liée.' });
    }
    if (parseFloat(formation.prix_inscription) <= 0) {
      return res.status(400).json({ error: 'Cette formation est gratuite, aucun paiement requis.' });
    }

    if (inscription.paiement_id) {
      const { data: existingPayment, error: payErr } = await supabaseAdmin
        .from('paiements')
        .select('*')
        .eq('id', inscription.paiement_id)
        .single();
      if (!payErr && existingPayment) {
        if (existingPayment.mode !== paymentMode) {
          const { data: updatedPay } = await supabaseAdmin
            .from('paiements')
            .update({ mode: paymentMode })
            .eq('id', existingPayment.id)
            .select()
            .single();
          return res.json({ payment: updatedPay || existingPayment });
        }
        return res.json({ payment: existingPayment });
      }
    }

    const reservationId = await resolveFormationReservationId(formation);
    const targetTenantId = formation.tenant_id || req.tenantId || null;

    const { data: payment, error: payErr } = await supabaseAdmin
      .from('paiements')
      .insert({
        user_id: req.user.id,
        reservation_id: reservationId,
        abonnement_id: null,
        montant: parseFloat(formation.prix_inscription),
        mode: paymentMode,
        statut: 'pending',
        tenant_id: targetTenantId,
      })
      .select()
      .single();

    if (payErr) {
      return res.status(500).json({ error: payErr.message || 'Impossible de créer le paiement.' });
    }

    await supabaseAdmin
      .from('inscriptions_formations')
      .update({ paiement_id: payment.id })
      .eq('id', inscription.id);

    res.status(201).json({ payment });
  } catch (err) {
    console.error('Erreur route /inscriptions/payment :', err);
    res.status(500).json({ error: 'Erreur serveur lors de la création du paiement.' });
  }
}

async function cancelInscription(req, res) {
  const isStaff = ['super_admin', 'admin', 'staff'].includes(req.profile.role);
  const targetUserId = (isStaff && req.body.user_id) ? req.body.user_id : req.user.id;

  try {
    const { data: inscription, error: fetchErr } = await supabaseAdmin
      .from('inscriptions_formations').select('*').eq('formation_id', req.params.id).eq('user_id', targetUserId).single();
    if (fetchErr || !inscription) return res.status(404).json({ error: 'Inscription introuvable.' });

    const { error } = await supabaseAdmin
      .from('inscriptions_formations')
      .update({ statut: 'annulee', updated_at: new Date().toISOString() })
      .eq('id', inscription.id);
    if (error) return res.status(400).json({ error: error.message });

    const { data: premier } = await supabaseAdmin
      .from('inscriptions_formations').select('*').eq('formation_id', req.params.id).eq('statut', 'en_attente').order('created_at', { ascending: true }).limit(1).maybeSingle();
    if (premier) {
      const { data: payment } = await supabaseAdmin
        .from('formations')
        .select('prix_inscription, espace_id, date_debut, tenant_id')
        .eq('id', req.params.id)
        .single();

      const updates = { statut: 'confirmee', updated_at: new Date().toISOString() };

      if (payment?.prix_inscription > 0 && !premier.paiement_id) {
        const reservationId = await resolveFormationReservationId(payment);
        const { data: newPayment, error: payInsertErr } = await supabaseAdmin
          .from('paiements')
          .insert({
            user_id: premier.user_id,
            reservation_id: reservationId,
            abonnement_id: null,
            montant: parseFloat(payment.prix_inscription),
            mode: 'online',
            statut: 'pending',
            tenant_id: payment.tenant_id || null,
          })
          .select()
          .single();

        if (payInsertErr) {
          console.error('Erreur création paiement promotion liste d\'attente :', payInsertErr.message);
        } else {
          updates.paiement_id = newPayment.id;
        }
      }

      await supabaseAdmin.from('inscriptions_formations')
        .update(updates).eq('id', premier.id);
    }

    res.json({ message: 'Inscription annulée.', promoted: !!premier });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function listInscriptions(req, res) {
  try {
    const isStaff = ['super_admin', 'admin', 'staff'].includes(req.profile.role);
    const { data: formation } = await supabaseAdmin.from('formations').select('formateur_id').eq('id', req.params.id).single();
    const isFormateur = req.profile.role === 'formateur' && formation?.formateur_id === req.user.id;
    if (!isStaff && !isFormateur) return res.status(403).json({ error: 'Accès réservé à l\'admin ou au formateur.' });

    const { data, error } = await supabaseAdmin
      .from('inscriptions_formations')
      .select('*, profiles!user_id (id, nom, prenom, email, telephone, type_membre)')
      .eq('formation_id', req.params.id)
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    const confirmes = (data || []).filter(i => i.statut === 'confirmee');
    const attente = (data || []).filter(i => i.statut === 'en_attente');

    res.json({ participants: confirmes, liste_attente: attente, total: data.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updatePresence(req, res) {
  try {
    const isStaff = ['super_admin', 'admin', 'staff'].includes(req.profile.role);
    const { data: formation } = await supabaseAdmin.from('formations').select('formateur_id').eq('id', req.params.id).single();
    const isFormateur = req.profile.role === 'formateur' && formation?.formateur_id === req.user.id;
    if (!isStaff && !isFormateur) return res.status(403).json({ error: 'Droits insuffisants.' });

    const { data, error } = await supabaseAdmin
      .from('inscriptions_formations')
      .update({ present: req.body.present !== false, updated_at: new Date().toISOString() })
      .eq('formation_id', req.params.id)
      .eq('user_id', req.params.userId)
      .select().single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ inscription: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getEmargement(req, res) {
  try {
    const isStaff = ['super_admin', 'admin', 'staff'].includes(req.profile.role);
    const { data: formation } = await supabaseAdmin
      .from('formations')
      .select('*, profiles!formateur_id (nom, prenom), espaces (nom)')
      .eq('id', req.params.id).single();
    if (!formation) return res.status(404).json({ error: 'Formation introuvable.' });

    const isFormateur = req.profile.role === 'formateur' && formation.formateur_id === req.user.id;
    if (!isStaff && !isFormateur) return res.status(403).json({ error: 'Droits insuffisants.' });

    const { data: inscrits } = await supabaseAdmin
      .from('inscriptions_formations')
      .select('*, profiles!user_id (nom, prenom, email, telephone)')
      .eq('formation_id', req.params.id)
      .eq('statut', 'confirmee')
      .order('created_at', { ascending: true });

    res.json({
      formation: {
        titre: formation.titre,
        date: new Date(formation.date_debut).toLocaleDateString('fr-FR'),
        horaire: `${new Date(formation.date_debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} – ${new Date(formation.date_fin).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`,
        formateur: formation.profiles ? `${formation.profiles.prenom} ${formation.profiles.nom}` : '—',
        salle: formation.espaces?.nom || '—',
      },
      participants: (inscrits || []).map((i, idx) => ({
        numero: idx + 1,
        nom: i.profiles?.nom || '—',
        prenom: i.profiles?.prenom || '—',
        email: i.profiles?.email || '—',
        telephone: i.profiles?.telephone || '—',
        present: i.present,
        statut_paiement: i.statut_paiement,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  createInscription,
  createInscriptionPayment,
  cancelInscription,
  listInscriptions,
  updatePresence,
  getEmargement,
  resolveFormationReservationId,
};
