// controllers/bookingsController.js — MODULE B : Réservations
const { supabaseAdmin } = require('../config/supabase');
const { getBookingAvailability, getCancellationPolicy, getCancellationPolicyForEspace, buildCancellationInfo, canMarkReservationNoShow, todayISO, insertWithColumnFallback } = require('../models/helpers');
const { applyTenantFilter } = require('../middleware/guards');
const { notifyConfirmationReservation, notifyAnnulationReservation } = require('../services/notificationService');
const { sendEmailUniversal } = require('../utils/sendEmail');

async function getBookingsCalendar(req, res) {
  try {
    const { espace_id, from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'Paramètres from et to requis (ISO date).' });
    }

    const isSuperAdmin = req.profile.role === 'super_admin';
    const isStaff = ['admin', 'staff'].includes(req.profile.role);

    let query = supabaseAdmin
      .from('reservations')
      .select('id, espace_id, user_id, guest_id, date_debut, date_fin, statut, mode, notes, tenant_id, espaces(nom, type, tenant_id), profiles!user_id(nom, prenom, email), guests(nom, prenom, email, telephone), paiements(id, statut, mode, montant, numero_recu)')
      .lt('date_debut', to)
      .gt('date_fin', from)
      .order('date_debut', { ascending: true });

    if (isSuperAdmin) {
      // Super admin voit tout
    } else if (isStaff) {
      // Admin/Staff ne voient QUE les réservations de leurs propres espaces
      if (req.tenantId) {
        const { data: tenantEspaces } = await supabaseAdmin
          .from('espaces')
          .select('id')
          .eq('tenant_id', req.tenantId);

        const espaceIds = (tenantEspaces || []).map((e) => e.id);

        if (espaceIds.length > 0) {
          query = query.in('espace_id', espaceIds);
        } else {
          return res.json({ reservations: [] });
        }
      } else {
        query = query.eq('user_id', req.user.id);
      }
    } else {
      query = query.eq('user_id', req.user.id);
    }

    if (espace_id) {
      query = query.eq('espace_id', espace_id);
    }

    let { data, error } = await query;
    if (error && (error.code === 'PGRST200' || /relationship|column/i.test(error.message))) {
      let fb = supabaseAdmin
        .from('reservations')
        .select('id, espace_id, date_debut, date_fin, statut, reference, tenant_id, espaces(nom, type, tenant_id)')
        .lt('date_debut', to)
        .gt('date_fin', from)
        .order('date_debut', { ascending: true });
      if (!isSuperAdmin) {
        fb = fb.or(`membre_id.eq.${req.user.id},user_id.eq.${req.user.id}`);
      }
      if (espace_id) fb = fb.eq('espace_id', espace_id);
      const fbRes = await fb;
      data = fbRes.data || [];
      error = fbRes.error;
    }
    if (error) {
      console.warn('⚠️ getBookingsCalendar warning:', error.message);
      return res.json({ reservations: [] });
    }

    // Récupération et synchronisation des formations pour l'agenda
    let reservationsList = Array.isArray(data) ? [...data] : [];
    try {
      let formQ = supabaseAdmin
        .from('formations')
        .select('id, titre, description, formateur_id, espace_id, date_debut, date_fin, capacite_max, prix_inscription, statut, tenant_id, reservation_id, profiles!fk_formations_formateur_profiles(id, nom, prenom, email), espaces(id, nom, type)')
        .in('statut', ['planifiee', 'publiee', 'en_cours', 'terminee', 'validee'])
        .lt('date_debut', to)
        .gt('date_fin', from);

      if (isStaff && req.tenantId) {
        formQ = formQ.eq('tenant_id', req.tenantId);
      } else if (!isSuperAdmin && !isStaff) {
        formQ = formQ.eq('formateur_id', req.user.id);
      }
      if (espace_id) {
        formQ = formQ.eq('espace_id', espace_id);
      }

      const { data: formationsData } = await formQ;
      if (Array.isArray(formationsData)) {
        for (const f of formationsData) {
          // Chercher si une réservation existante correspond à cette formation
          let found = reservationsList.find(r => r.id === f.reservation_id || (r.espace_id === f.espace_id && r.date_debut === f.date_debut));
          if (found) {
            found.is_formation = true;
            found.formation_id = f.id;
            found.formation_titre = f.titre;
            found.capacite_max = f.capacite_max;
            found.prix_inscription = f.prix_inscription;
            if (!found.profiles && f.profiles) found.profiles = f.profiles;
          } else {
            // Ajouter la formation comme créneau réservé dans l'agenda
            reservationsList.push({
              id: f.reservation_id || `formation-${f.id}`,
              espace_id: f.espace_id,
              user_id: f.formateur_id,
              date_debut: f.date_debut,
              date_fin: f.date_fin,
              statut: f.statut === 'planifiee' ? (f.reservation_id ? 'pending' : 'confirmed') : f.statut,
              mode: 'on_site',
              tenant_id: f.tenant_id,
              espaces: f.espaces,
              profiles: f.profiles,
              is_formation: true,
              formation_id: f.id,
              formation_titre: f.titre,
              capacite_max: f.capacite_max,
              prix_inscription: f.prix_inscription,
            });
          }
        }
        reservationsList.sort((a, b) => new Date(a.date_debut) - new Date(b.date_debut));
      }
    } catch (formErr) {
      console.warn('⚠️ Synchronisation formations agenda:', formErr.message);
    }

    res.json({ reservations: reservationsList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createBooking(req, res) {
  try {
    const {
      espace_id,
      date_debut,
      date_fin,
      mode,
      client_type,
      entreprise_info,
      floor_plan_item_id,
      floor_plan_item_label,
    } = req.body;

    if (!espace_id || !date_debut || !date_fin) {
      return res.status(400).json({ error: 'espace_id, date_debut et date_fin sont requis.' });
    }

    if (new Date(date_debut) >= new Date(date_fin)) {
      return res.status(400).json({ error: 'date_fin doit être postérieure à date_debut.' });
    }

    const availability = await getBookingAvailability(espace_id, date_debut, date_fin, null, {
      floorPlanItemId: floor_plan_item_id || null,
    });
    if (!availability.isAvailable) {
      return res.status(409).json({
        error: availability.conflictMessage,
        remaining: availability.remaining,
        capacity: availability.capacity,
        overlappingCount: availability.overlappingCount,
      });
    }

    // Calcul automatique du montant total selon le tarif horaire de l'espace
    const { data: espData } = await req.db
      .from('espaces')
      .select('tarif_horaire, tenant_id, type, capacite')
      .eq('id', espace_id)
      .single();

    const rawNbParticipants = req.body.nb_participants ?? entreprise_info?.nb_personnes;
    let parsedParticipants = null;
    if (rawNbParticipants !== undefined && rawNbParticipants !== null && rawNbParticipants !== '') {
      parsedParticipants = parseInt(rawNbParticipants, 10);
    }
    if (espData?.type === 'meeting_room') {
      const maxCap = Math.max(1, parseInt(espData.capacite, 10) || 1);
      if (!Number.isInteger(parsedParticipants) || parsedParticipants < 1 || parsedParticipants > maxCap) {
        return res.status(400).json({
          error: `Pour une salle de réunion, le nombre de participants est obligatoire et doit être compris entre 1 et ${maxCap}.`,
        });
      }
    }

    // Tâche 5 — Type d'espace lié à la tarification :
    // si l'abonnement actif du membre provient d'une formule restreinte à un
    // type d'espace, la réservation n'est possible que pour ce type.
    const today = todayISO();
    const { data: activeSub } = await req.db
      .from('abonnements')
      .select('type_espace')
      .eq('user_id', req.user.id)
      .eq('statut', 'active')
      .lte('date_debut', today)
      .gte('date_fin', today)
      .order('date_fin', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeSub?.type_espace && espData?.type && activeSub.type_espace !== espData.type) {
      const typeLabels = {
        open_space: 'Open space',
        private_office: 'Bureau privé',
        meeting_room: 'Salle de réunion',
        training_room: 'Salle de formation',
        event_space: 'Espace événementiel',
        hot_desk: 'Poste nomade (Hot Desk)',
        dedicated_desk: 'Poste fixe (Dedicated Desk)',
      };
      return res.status(400).json({
        error: `Votre formule d'abonnement est limitée aux espaces de type « ${typeLabels[activeSub.type_espace] || activeSub.type_espace} ». Cet espace est de type « ${typeLabels[espData.type] || espData.type} ».`,
      });
    }

    const hours = Math.max(1, (new Date(date_fin) - new Date(date_debut)) / (1000 * 60 * 60));
    const tarif = parseFloat(espData?.tarif_horaire) || 0;
    const computedMontant = parseFloat((hours * tarif).toFixed(3));

    const bookingTenantId = req.tenantId || espData?.tenant_id || null;

    // CDC v3.0 Chantier 3.2 : champs obligatoires si compte Entreprise
    const isEntreprise = req.profile?.type_membre === 'entreprise' || client_type === 'entreprise';
    let notesObj = {};
    if (isEntreprise) {
      const info = entreprise_info || {};
      const missing = [];
      if (!String(info.raison_sociale || '').trim()) missing.push('Raison sociale');
      if (!String(info.contact_nom || '').trim()) missing.push('Personne de contact');
      if (!String(info.telephone_pro || '').trim()) missing.push('Téléphone professionnel');
      if (!String(info.email_facturation || '').trim()) missing.push('Email de facturation');
      if (!String(info.besoin_description || '').trim()) missing.push('Objet du besoin');
      if (missing.length > 0) {
        return res.status(400).json({
          error: `Champs Entreprise obligatoires manquants : ${missing.join(', ')}.`,
        });
      }
      notesObj = {
        type_client: 'entreprise',
        raison_sociale: info.raison_sociale.trim(),
        contact_nom: info.contact_nom.trim(),
        telephone_pro: info.telephone_pro.trim(),
        email_facturation: info.email_facturation.trim(),
        besoin_description: info.besoin_description.trim(),
      };
    }
    if (parsedParticipants !== null) notesObj.nb_participants = parsedParticipants;
    if (floor_plan_item_id) notesObj.floor_plan_item_id = String(floor_plan_item_id);
    if (floor_plan_item_label) notesObj.floor_plan_item_label = String(floor_plan_item_label).trim();
    const combinedNotes = Object.keys(notesObj).length > 0 ? JSON.stringify(notesObj) : null;

    // Approbation obligatoire par le coworking pour TOUTES les réservations (espaces ou formations)
    const initialStatut = 'pending';

    // Normalisation du mode pour respecter la contrainte CHECK (mode IN ('online', 'on_site', 'phone'))
    // CDC v3.0 D1 : règlement 100 % sur place — « online » n'est plus proposé.
    let dbMode = 'on_site';
    if (mode === 'phone') {
      dbMode = 'phone';
    }

    const { data, error } = await insertWithColumnFallback(
      supabaseAdmin,
      'reservations',
      {
        tenant_id: bookingTenantId,
        user_id: req.user.id,
        espace_id,
        date_debut,
        date_fin,
        statut: initialStatut,
        mode: dbMode,
        ...(floor_plan_item_id ? { floor_plan_item_id } : {}),
        ...(combinedNotes ? { notes: combinedNotes } : {}),
      },
      { aliases: { user_id: 'membre_id' }, select: '*, espaces(nom, type, tarif_horaire)' }
    );

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    let payment = null;
    if (computedMontant > 0) {
      const paymentMode = 'cash'; // règlement sur place
      const { data: paymentRow, error: payErr } = await supabaseAdmin
        .from('paiements')
        .insert({
          user_id: req.user.id,
          reservation_id: data.id,
          montant: computedMontant,
          mode: paymentMode,
          statut: 'pending',
          tenant_id: bookingTenantId,
        })
        .select('*')
        .single();

      if (payErr) {
        console.error('⚠️ Création du paiement à la réservation:', payErr.message);
      } else {
        payment = paymentRow;
      }
    }

    // CDC v3.0 §4.2 : Notifications In-App + E-mail (Manager & Client) à la création de la réservation
    try {
      const targetTenantId = bookingTenantId || req.tenantId;
      let adminsQuery = supabaseAdmin
        .from('profiles')
        .select('id, nom, prenom, email')
        .in('role', ['admin', 'staff']);

      if (targetTenantId) {
        adminsQuery = adminsQuery.eq('tenant_id', targetTenantId);
      }

      const { data: admins } = await adminsQuery;
      const memberProfile = req.profile;
      const clientEmail = req.user.email || memberProfile?.email;
      const espaceNom = data.espaces?.nom || espData?.nom || 'un espace';
      const dateDebutStr = new Date(date_debut).toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis' }) + ' à ' + new Date(date_debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Tunis' });
      const clientName = `${memberProfile?.prenom || ''} ${memberProfile?.nom || ''}`.trim() || 'Client';

      // 1) Alerte Manager / Staff (In-App + Email)
      if (admins && admins.length > 0) {
        for (const admin of admins) {
          await supabaseAdmin.from('notifications').insert({
            user_id: admin.id,
            type: 'nouvelle_demande_reservation',
            canal: 'Dashboard',
            message: `📋 Nouvelle réservation reçue de ${clientName} pour ${espaceNom} (${dateDebutStr}) — Règlement sur place.`,
          });

          if (admin.email) {
            sendEmailUniversal({
              to: admin.email,
              subject: `Nouvelle réservation reçue — ${espaceNom}`,
              text: `Bonjour ${admin.prenom || ''},\n\nUne nouvelle réservation a été reçue de ${clientName} pour ${espaceNom} le ${dateDebutStr}.\nStatut : ${initialStatut === 'confirmed' ? 'Confirmée automatiquement' : 'En attente de validation'}.\nRèglement prévu sur place.\n`,
              html: `<p>Bonjour <strong>${admin.prenom || ''}</strong>,</p><p>Une nouvelle réservation a été enregistrée :</p><ul><li><strong>Client :</strong> ${clientName}</li><li><strong>Espace :</strong> ${espaceNom}</li><li><strong>Date :</strong> ${dateDebutStr}</li><li><strong>Statut :</strong> ${initialStatut === 'confirmed' ? 'Confirmée automatiquement' : 'En attente de validation'}</li><li><strong>Règlement :</strong> Sur place à l'accueil</li></ul>`,
            }).catch(() => {});
          }
        }
      }

      // 2) Confirmation au Client (In-App + Email)
      await supabaseAdmin.from('notifications').insert({
        user_id: req.user.id,
        type: 'confirmation_demande_reservation',
        canal: 'Dashboard',
        message: `📋 Votre demande de réservation pour ${espaceNom} (${dateDebutStr}) a bien été enregistrée.`,
      });

      if (clientEmail) {
        sendEmailUniversal({
          to: clientEmail,
          subject: `Confirmation de votre demande de réservation — ${espaceNom}`,
          text: `Bonjour ${memberProfile?.prenom || ''},\n\nVotre réservation pour ${espaceNom} le ${dateDebutStr} a bien été enregistrée.\nStatut : ${initialStatut === 'confirmed' ? 'Confirmée' : 'En attente de validation'}.\nLe règlement se fera sur place à votre arrivée.\n`,
          html: `<p>Bonjour <strong>${memberProfile?.prenom || ''}</strong>,</p><p>Votre réservation pour l'espace <strong>${espaceNom}</strong> le <strong>${dateDebutStr}</strong> a bien été enregistrée.</p><p>Statut : <strong>${initialStatut === 'confirmed' ? 'Confirmée' : 'En attente de validation'}</strong>.</p><p>Le règlement s'effectuera sur place à votre arrivée.</p>`,
        }).catch(() => {});
      }
    } catch (notifErr) {
      console.error('⚠️ Notification admin/client nouvelle réservation:', notifErr.message);
    }

    res.status(201).json({ reservation: data, payment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function cancelInfoBooking(req, res) {
  const { id } = req.params;
  const isStaff = ['super_admin', 'admin', 'staff'].includes(req.profile.role);

  try {
    const { data: reservation, error: fetchErr } = await supabaseAdmin
      .from('reservations')
      .select('*, espaces(nom, type), paiements(id, montant, statut, montant_rembourse)')
      .eq('id', id)
      .single();

    if (fetchErr || !reservation) {
      return res.status(404).json({ error: 'Réservation introuvable.' });
    }

    if (!isStaff && reservation.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Vous ne pouvez consulter que vos propres réservations.' });
    }

    const tenantId = reservation.tenant_id || req.tenantId;
    const policy = await getCancellationPolicy(tenantId);
    const espacePolicy = await getCancellationPolicyForEspace(tenantId, reservation.espaces?.type);
    const paiement = (reservation.paiements || [])[0];
    const info = buildCancellationInfo(reservation, policy, espacePolicy, isStaff, paiement?.montant);

    res.json({
      info,
      policy: {
        delai_heures: policy.delai_heures,
        penalite_pct: policy.penalite_pct,
        annulation_membre_autorisee: policy.annulation_membre_autorisee,
        remboursement_auto: policy.remboursement_auto,
        message_membre: policy.message_membre,
        type_espace: espacePolicy ? reservation.espaces?.type : null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteBooking(req, res) {
  const { id } = req.params;
  const isStaff = ['super_admin', 'admin', 'staff'].includes(req.profile.role);

  try {
    const { data: reservation, error: fetchErr } = await supabaseAdmin
      .from('reservations')
      .select('*, espaces(nom, type), paiements(id, montant, statut, montant_rembourse)')
      .eq('id', id)
      .single();

    if (fetchErr || !reservation) {
      return res.status(404).json({ error: 'Réservation introuvable.' });
    }

    if (!isStaff && reservation.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Vous ne pouvez annuler que vos propres réservations.' });
    }

    // Tâche 6 — Politique d'annulation : vérifier les conditions, déterminer
    // si un remboursement ou un crédit est applicable, puis les appliquer.
    const tenantId = reservation.tenant_id || req.tenantId;
    const policy = await getCancellationPolicy(tenantId);
    const espacePolicy = await getCancellationPolicyForEspace(tenantId, reservation.espaces?.type);
    const paiement = (reservation.paiements || [])[0];
    const info = buildCancellationInfo(reservation, policy, espacePolicy, isStaff, paiement?.montant);

    if (!info.allowed) {
      return res.status(403).json({
        error: info.reason || 'Annulation non autorisée.',
        policy,
        hoursUntilStart: info.hoursUntilStart,
      });
    }

    const { error: updateErr } = await supabaseAdmin
      .from('reservations')
      .update({ statut: 'cancelled', penalite_pct: info.penalite_pct })
      .eq('id', id);

    if (updateErr) {
      return res.status(400).json({ error: updateErr.message });
    }

    let refund = { montant_rembourse: 0, montant_credit: 0, paiement_updated: false };

    if (paiement) {
      // Remboursement (cash) si la règle le prévoit
      if (info.montantRembourse > 0) {
        const { error: refundErr } = await supabaseAdmin.from('paiements').update({
          montant_rembourse: info.montantRembourse,
          statut: 'refunded',
        }).eq('id', paiement.id);
        if (refundErr) {
          console.error('⚠️ Échec enregistrement remboursement paiement:', refundErr.message);
        } else {
          refund.montant_rembourse = info.montantRembourse;
          refund.paiement_updated = true;
        }
      }

      // Crédit portefeuille (formule avec credit_portefeuille_auto)
      if (info.montantCredit > 0) {
        const { error: creditErr } = await supabaseAdmin.from('credits_membres').insert({
          tenant_id: reservation.tenant_id || tenantId,
          user_id: reservation.user_id,
          montant: info.montantCredit,
          motif: `Annulation réservation — crédit portefeuille (${reservation.espaces?.nom || 'espace'})`,
          reservation_id: reservation.id,
        });
        if (creditErr) {
          console.error('⚠️ Échec inscription crédit portefeuille:', creditErr.message);
        } else {
          const { error: statusErr } = await supabaseAdmin.from('paiements').update({
            statut: 'refunded',
          }).eq('id', paiement.id);
          if (statusErr) console.error('⚠️ Échec mise à jour statut paiement (crédit):', statusErr.message);
          refund.montant_credit = info.montantCredit;
          refund.paiement_updated = true;
        }
      }
    }

    try {
      // 1) Email + notification in-app d'annulation pour le membre
      await notifyAnnulationReservation(
        supabaseAdmin,
        {
          id: reservation.id,
          date_debut: reservation.date_debut,
          date_fin: reservation.date_fin,
          espaces: reservation.espaces
        },
        {
          id: reservation.user_id,
          nom: req.profile.nom,
          prenom: req.profile.prenom,
          email: req.user.email
        }
      );

      // 2) Notification in-app pour le membre (portail / dashboard)
      await supabaseAdmin.from('notifications').insert({
        user_id: reservation.user_id,
        type: 'annulation_reservation',
        canal: 'Dashboard',
        message: `❌ Votre réservation pour ${reservation.espaces?.nom || 'un espace'} a été annulée.`,
      });

      // 3) Notification in-app + Email pour les admins du tenant (avec résolution fiable du tenantId)
      const targetTenantId = reservation.tenant_id || req.tenantId;
      let adminsQuery = supabaseAdmin
        .from('profiles')
        .select('id, nom, prenom, email')
        .in('role', ['admin', 'staff']);

      if (targetTenantId) {
        adminsQuery = adminsQuery.eq('tenant_id', targetTenantId);
      }

      const { data: admins } = await adminsQuery;
      const clientName = `${req.profile?.prenom || ''} ${req.profile?.nom || ''}`.trim() || 'Un client';

      if (admins && admins.length > 0) {
        for (const admin of admins) {
          await supabaseAdmin.from('notifications').insert({
            user_id: admin.id,
            type: 'annulation_reservation',
            canal: 'Dashboard',
            message: `🚫 ${clientName} a annulé sa réservation pour ${reservation.espaces?.nom || 'un espace'}.`,
          });

          if (admin.email) {
            sendEmailUniversal({
              to: admin.email,
              subject: `Annulation de réservation — ${reservation.espaces?.nom || 'Espace'}`,
              text: `Bonjour ${admin.prenom || ''},\n\n${clientName} a annulé sa réservation pour ${reservation.espaces?.nom || 'un espace'}.\n`,
              html: `<p>Bonjour <strong>${admin.prenom || ''}</strong>,</p><p>Le client <strong>${clientName}</strong> a annulé sa réservation pour l'espace <strong>${reservation.espaces?.nom || 'un espace'}</strong>.</p>`,
            }).catch(() => {});
          }
        }
      }
    } catch (notifErr) {
      console.error('⚠️ Échec notification annulation réservation:', notifErr.message);
    }

    res.json({
      message: 'Réservation annulée avec succès.',
      reservation,
      penalite_pct: info.penalite_pct || 0,
      montant_rembourse: refund.montant_rembourse,
      montant_credit: refund.montant_credit,
      mode: info.mode,
    });
  } catch (err) {
    console.error('Erreur annulation réservation:', err);
    res.status(500).json({ error: err.message });
  }
}

async function checkAvailability(req, res) {
  const { espace_id, date_debut, date_fin, exclude_reservation_id, floor_plan_item_id } = req.body;

  if (!espace_id || !date_debut || !date_fin) {
    return res.status(400).json({ error: 'espace_id, date_debut et date_fin sont requis.' });
  }

  if (new Date(date_debut) >= new Date(date_fin)) {
    return res.status(400).json({ error: 'date_fin doit être postérieure à date_debut.' });
  }

  try {
    const availability = await getBookingAvailability(espace_id, date_debut, date_fin, exclude_reservation_id, {
      exclusive: req.body.exclusive === true || req.body.exclusive === 'true',
      floorPlanItemId: floor_plan_item_id || null,
    });
    res.json({
      isAvailable: availability.isAvailable,
      overlapsCount: availability.overlappingCount,
      remaining: availability.remaining,
      capacity: availability.capacity,
      shared: availability.shared,
      spaceType: availability.spaceType,
      message: availability.isAvailable
        ? (availability.shared
          ? `${availability.remaining} place${availability.remaining > 1 ? 's' : ''} restante${availability.remaining > 1 ? 's' : ''} sur ${availability.capacity} (open space partagé).`
          : 'Ce créneau est disponible.')
        : availability.conflictMessage,
    });
  } catch (err) {
    console.error('Erreur disponibilité:', err);
    res.status(500).json({ error: err.message });
  }
}

async function listBookings(req, res) {
  const isSuperAdmin = req.profile.role === 'super_admin';
  const isStaff = ['admin', 'staff'].includes(req.profile.role);
  const { statut, espace_id, from, to } = req.query;

  try {
    let query = supabaseAdmin
      .from('reservations')
      .select('*, espaces(nom, type, tarif_horaire, tenant_id), profiles!user_id(nom, prenom, email, telephone, role), guests(nom, prenom, email, telephone), paiements(id, statut, mode, montant)')
      .order('created_at', { ascending: false });

    if (isSuperAdmin) {
      // Super admin a accès à toutes les réservations
    } else if (isStaff) {
      // Admin et Staff ne voient QUE les réservations de leurs propres espaces
      if (req.tenantId) {
        const { data: tenantEspaces } = await supabaseAdmin
          .from('espaces')
          .select('id')
          .eq('tenant_id', req.tenantId);

        const espaceIds = (tenantEspaces || []).map((e) => e.id);

        if (espaceIds.length > 0) {
          query = query.in('espace_id', espaceIds);
        } else {
          return res.json({ reservations: [] });
        }
      } else {
        query = query.eq('user_id', req.user.id);
      }
    } else {
      // Membre régulier ne voit que ses propres réservations
      query = query.eq('user_id', req.user.id);
    }

    if (statut) query = query.eq('statut', statut);
    if (espace_id) query = query.eq('espace_id', espace_id);
    if (from) query = query.gte('date_debut', from);
    if (to) query = query.lte('date_debut', to);

    let { data, error } = await query;
    if (error && (error.code === 'PGRST200' || /relationship|column/i.test(error.message))) {
      let fb = supabaseAdmin
        .from('reservations')
        .select('*, espaces(nom, type, tarif_horaire, tenant_id)')
        .order('created_at', { ascending: false });
      if (!isSuperAdmin) {
        fb = fb.or(`membre_id.eq.${req.user.id},user_id.eq.${req.user.id}`);
      }
      if (statut) fb = fb.eq('statut', statut);
      if (espace_id) fb = fb.eq('espace_id', espace_id);
      if (from) fb = fb.gte('date_debut', from);
      if (to) fb = fb.lte('date_debut', to);
      const fbRes = await fb;
      data = fbRes.data || [];
      error = fbRes.error;

      if (error) {
        const fbRes2 = await supabaseAdmin.from('reservations').select('*').eq('membre_id', req.user.id);
        data = fbRes2.data || [];
        error = fbRes2.error;
      }
    }
    if (error) {
      console.warn('⚠️ listBookings warning:', error.message);
      return res.json({ reservations: [] });
    }

    const reservations = (data || []).map((b) => {
      const hours = Math.max(0, (new Date(b.date_fin) - new Date(b.date_debut)) / (1000 * 60 * 60));
      const tarif = parseFloat(b.espaces?.tarif_horaire) || 0;
      return { ...b, montant_total: parseFloat((hours * tarif).toFixed(3)) };
    });

    res.json({ reservations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getBookingsOccupation(req, res) {
  const { from, to } = req.query;

  if (!from || !to) {
    return res.status(400).json({ error: 'Paramètres from et to requis (ISO date).' });
  }

  const isSuperAdmin = req.profile.role === 'super_admin';

  try {
    let espQuery = supabaseAdmin.from('espaces').select('id, nom, type, capacite');
    if (!isSuperAdmin && req.tenantId) {
      espQuery = espQuery.eq('tenant_id', req.tenantId);
    }
    const { data: espaces, error: espErr } = await espQuery;
    if (espErr) return res.status(500).json({ error: espErr.message });

    const espaceIds = (espaces || []).map((e) => e.id);

    let resQuery = supabaseAdmin
      .from('reservations')
      .select('id, espace_id, date_debut, date_fin, statut')
      .in('statut', ['confirmed', 'pending'])
      .gte('date_debut', from)
      .lte('date_debut', to);

    if (!isSuperAdmin && req.tenantId && espaceIds.length > 0) {
      resQuery = resQuery.in('espace_id', espaceIds);
    }

    const { data: reservations, error: resErr } = await resQuery;
    if (resErr) return res.status(500).json({ error: resErr.message });

    const periodMs = new Date(to).getTime() - new Date(from).getTime();
    const report = (espaces || []).map((espace) => {
      const espaceReservations = (reservations || []).filter((r) => r.espace_id === espace.id);
      const reservedMs = espaceReservations.reduce((acc, r) => {
        return acc + (new Date(r.date_fin).getTime() - new Date(r.date_debut).getTime());
      }, 0);
      const taux = periodMs > 0 ? Math.min(100, (reservedMs / periodMs) * 100) : 0;

      return {
        espace_id: espace.id,
        nom: espace.nom,
        type: espace.type,
        capacite: espace.capacite,
        reservations_count: espaceReservations.length,
        taux_occupation_pct: Number(taux.toFixed(1)),
      };
    });

    res.json({ from, to, report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateBooking(req, res) {
  const { id } = req.params;
  const { date_debut, date_fin, statut } = req.body;
  const isStaff = ['super_admin', 'admin', 'staff'].includes(req.profile.role);

  try {
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('reservations')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !existing) {
      return res.status(404).json({ error: 'Réservation introuvable.' });
    }

    if (!isStaff && existing.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Modification non autorisée.' });
    }

    const newDebut = date_debut || existing.date_debut;
    const newFin = date_fin || existing.date_fin;

    if (new Date(newDebut) >= new Date(newFin)) {
      return res.status(400).json({ error: 'date_fin doit être postérieure à date_debut.' });
    }

    if (date_debut || date_fin) {
      const availability = await getBookingAvailability(existing.espace_id, newDebut, newFin, id);
      if (!availability.isAvailable) {
        return res.status(409).json({ error: availability.conflictMessage });
      }
    }

    const updates = {};
    if (date_debut) updates.date_debut = date_debut;
    if (date_fin) updates.date_fin = date_fin;
    if (statut && isStaff) {
      const VALID_BOOKING_STATUSES = [
        'pending',
        'confirmed',
        'refused',
        'cancelled',
        'completed',
        'no_show',
        'waitlisted',
      ];
      if (!VALID_BOOKING_STATUSES.includes(statut)) {
        return res.status(400).json({ error: 'statut invalide.' });
      }
      if (statut === 'no_show') {
        const noShowCheck = await canMarkReservationNoShow(id);
        if (!noShowCheck.allowed) {
          return res.status(400).json({ error: noShowCheck.reason });
        }
        updates.no_show = true;
      }
      updates.statut = statut;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Aucune mise à jour fournie.' });
    }

    const { data, error } = await supabaseAdmin
      .from('reservations')
      .update(updates)
      .eq('id', id)
      .select('*, espaces(nom, type)')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Si l'admin confirme la réservation → notifier le membre par email + in-app
    if (updates.statut === 'confirmed') {
      try {
        const { data: memberProfile } = await supabaseAdmin
          .from('profiles')
          .select('id, nom, prenom, email')
          .eq('id', data.user_id)
          .single();

        let memberEmail = memberProfile?.email;
        if (!memberEmail) {
          const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(data.user_id);
          memberEmail = authUser?.user?.email;
        }

        if (memberProfile && memberEmail) {
          const modeLabel = 'sur place à l\'accueil (espèces, chèque ou virement)';

          // 1) Email de confirmation (enregistre aussi la notification en base avec canal: 'Email')
          await notifyConfirmationReservation(
            supabaseAdmin,
            {
              id: data.id,
              date_debut: data.date_debut,
              date_fin: data.date_fin,
              espaces: data.espaces,
              mode: data.mode,
            },
            { ...memberProfile, email: memberEmail }
          );

          // 2) Notification in-app pour le dashboard du membre
          await supabaseAdmin.from('notifications').insert({
            user_id: data.user_id,
            type: 'confirmation_reservation',
            canal: 'Dashboard',
            message: `✅ Votre réservation pour ${data.espaces?.nom || 'l\'espace'} a été acceptée ! Paiement : ${modeLabel}.`,
          });
        }
      } catch (notifErr) {
        console.error('⚠️ Échec notification confirmation réservation:', notifErr.message);
      }
    }

    // Si l'admin annule la réservation → notifier le membre
    if (updates.statut === 'cancelled') {
      try {
        const { data: memberProfile } = await supabaseAdmin
          .from('profiles')
          .select('id, nom, prenom, email')
          .eq('id', data.user_id)
          .single();

        let memberEmail = memberProfile?.email;
        if (!memberEmail) {
          const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(data.user_id);
          memberEmail = authUser?.user?.email;
        }

        if (memberProfile && memberEmail) {
          // 1) Email d'annulation
          await notifyAnnulationReservation(
            supabaseAdmin,
            {
              id: data.id,
              date_debut: data.date_debut,
              date_fin: data.date_fin,
              espaces: data.espaces,
            },
            { ...memberProfile, email: memberEmail }
          );

          // 2) Notification in-app
          await supabaseAdmin.from('notifications').insert({
            user_id: data.user_id,
            type: 'annulation_reservation',
            canal: 'Dashboard',
            message: `❌ Votre réservation pour ${data.espaces?.nom || 'l\'espace'} a été annulée par l'administrateur.`,
          });
        }
      } catch (notifErr) {
        console.error('⚠️ Échec notification annulation réservation (admin):', notifErr.message);
      }
    }

    // Si l'admin refuse la réservation → notifier le membre in-app + Email (CDC v3.0)
    if (updates.statut === 'refused' && data.user_id) {
      try {
        await supabaseAdmin.from('notifications').insert({
          user_id: data.user_id,
          type: 'refus_reservation',
          canal: 'Dashboard',
          message: `❌ Votre demande de réservation pour ${data.espaces?.nom || 'l\'espace'} a été refusée par l'établissement.`,
        });

        const { data: memberProfile } = await supabaseAdmin
          .from('profiles')
          .select('id, nom, prenom, email')
          .eq('id', data.user_id)
          .single();

        let memberEmail = memberProfile?.email;
        if (!memberEmail) {
          const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(data.user_id);
          memberEmail = authUser?.user?.email;
        }

        if (memberEmail) {
          sendEmailUniversal({
            to: memberEmail,
            subject: `Information sur votre demande de réservation — ${data.espaces?.nom || 'Espace'}`,
            text: `Bonjour ${memberProfile?.prenom || ''},\n\nVotre demande de réservation pour l'espace ${data.espaces?.nom || 'un espace'} n'a malheureusement pas pu être acceptée par l'établissement.\n`,
            html: `<p>Bonjour <strong>${memberProfile?.prenom || ''}</strong>,</p><p>Votre demande de réservation pour l'espace <strong>${data.espaces?.nom || 'un espace'}</strong> n'a pas pu être acceptée par l'établissement.</p><p>Nous vous invitons à consulter les disponibilités pour un autre créneau ou un autre espace.</p>`,
          }).catch(() => {});
        }
      } catch (notifErr) {
        console.error('⚠️ Échec notification refus réservation:', notifErr.message);
      }
    }

    res.json({ reservation: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getBookingsCalendar,
  createBooking,
  deleteBooking,
  cancelInfoBooking,
  checkAvailability,
  listBookings,
  getBookingsOccupation,
  updateBooking,
};
