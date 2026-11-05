// controllers/bookingsController.js — MODULE B : Réservations
const { supabaseAdmin } = require('../config/supabase');
const { getBookingAvailability, getCancellationPolicy, getCancellationPolicyForEspace, buildCancellationInfo, todayISO } = require('../models/helpers');
const { applyTenantFilter } = require('../middleware/guards');
const { notifyConfirmationReservation, notifyAnnulationReservation } = require('../services/notificationService');

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
      .select('id, espace_id, user_id, date_debut, date_fin, statut, mode, tenant_id, espaces(nom, type, tenant_id), profiles(nom, prenom, email)')
      .eq('statut', 'confirmed')  // Le calendrier n'affiche que les réservations confirmées
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

    const { data, error } = await query;
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ reservations: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createBooking(req, res) {
  try {
    const { espace_id, date_debut, date_fin, mode } = req.body;

    if (!espace_id || !date_debut || !date_fin) {
      return res.status(400).json({ error: 'espace_id, date_debut et date_fin sont requis.' });
    }

    if (new Date(date_debut) >= new Date(date_fin)) {
      return res.status(400).json({ error: 'date_fin doit être postérieure à date_debut.' });
    }

    const availability = await getBookingAvailability(espace_id, date_debut, date_fin);
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
      .select('tarif_horaire, tenant_id, type')
      .eq('id', espace_id)
      .single();

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
      };
      return res.status(400).json({
        error: `Votre formule d'abonnement est limitée aux espaces de type « ${typeLabels[activeSub.type_espace] || activeSub.type_espace} ». Cet espace est de type « ${typeLabels[espData.type] || espData.type} ».`,
      });
    }

    const hours = Math.max(1, (new Date(date_fin) - new Date(date_debut)) / (1000 * 60 * 60));
    const tarif = parseFloat(espData?.tarif_horaire) || 0;
    const computedMontant = parseFloat((hours * tarif).toFixed(2));

    const bookingTenantId = req.tenantId || espData?.tenant_id || null;

    // Normalisation du mode pour respecter la contrainte CHECK (mode IN ('online', 'on_site', 'phone'))
    let dbMode = 'online';
    if (mode === 'sur_place' || mode === 'on_site') {
      dbMode = 'on_site';
    } else if (mode === 'phone') {
      dbMode = 'phone';
    } else {
      dbMode = 'online';
    }

    const { data, error } = await req.db
      .from('reservations')
      .insert({
        tenant_id: bookingTenantId,
        user_id: req.user.id,
        espace_id,
        date_debut,
        date_fin,
        statut: 'pending',
        mode: dbMode,
      })
      .select('*, espaces(nom, type, tarif_horaire)')
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    let payment = null;
    if (computedMontant > 0) {
      const paymentMode = dbMode === 'online' ? 'online' : 'cash';
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

    // Notifier les admins/staff du tenant qu'une nouvelle réservation est en attente
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

      if (admins && admins.length > 0) {
        const memberProfile = req.profile;
        const modeLabel = (mode === 'sur_place' || mode === 'cash' || mode === 'on_site') ? 'Sur place' : 'En ligne';
        for (const admin of admins) {
          await supabaseAdmin.from('notifications').insert({
            user_id: admin.id,
            type: 'nouvelle_demande_reservation',
            canal: 'Dashboard',
            message: `📋 Nouvelle demande de réservation de ${memberProfile?.prenom || ''} ${memberProfile?.nom || ''} pour ${data.espaces?.nom || 'un espace'} — Paiement : ${modeLabel}`,
          });
        }
      }
    } catch (notifErr) {
      console.error('⚠️ Notification admin nouvelle réservation:', notifErr.message);
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

      // 3) Notification in-app pour les admins du tenant
      const { data: admins } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('tenant_id', req.tenantId)
        .in('role', ['admin', 'staff']);

      if (admins && admins.length > 0) {
        for (const admin of admins) {
          await supabaseAdmin.from('notifications').insert({
            user_id: admin.id,
            type: 'annulation_reservation',
            canal: 'Dashboard',
            message: `🚫 ${req.profile?.prenom || ''} ${req.profile?.nom || ''} a annulé sa réservation pour ${reservation.espaces?.nom || 'un espace'}.`,
          });
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
  const { espace_id, date_debut, date_fin, exclude_reservation_id } = req.body;

  if (!espace_id || !date_debut || !date_fin) {
    return res.status(400).json({ error: 'espace_id, date_debut et date_fin sont requis.' });
  }

  if (new Date(date_debut) >= new Date(date_fin)) {
    return res.status(400).json({ error: 'date_fin doit être postérieure à date_debut.' });
  }

  try {
    const availability = await getBookingAvailability(espace_id, date_debut, date_fin, exclude_reservation_id, {
      exclusive: req.body.exclusive === true || req.body.exclusive === 'true',
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
      .select('*, espaces(nom, type, tarif_horaire, tenant_id), profiles(nom, prenom, email, telephone, role), guests(nom, prenom, email, telephone), paiements(id, statut, mode, montant)')
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

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const reservations = (data || []).map((b) => {
      const hours = Math.max(0, (new Date(b.date_fin) - new Date(b.date_debut)) / (1000 * 60 * 60));
      const tarif = parseFloat(b.espaces?.tarif_horaire) || 0;
      return { ...b, montant_total: parseFloat((hours * tarif).toFixed(2)) };
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
      if (!['pending', 'confirmed', 'cancelled'].includes(statut)) {
        return res.status(400).json({ error: 'statut invalide.' });
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
          const modeLabel = (data.mode === 'on_site' || data.mode === 'sur_place') ? '💵 sur place à l\'accueil' : '💳 en ligne depuis votre espace membre';

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
