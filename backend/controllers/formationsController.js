// controllers/formationsController.js — MODULE G : Formations catalogue & creation
const { supabaseAdmin } = require('../config/supabase');
const {
  getBookingAvailability,
  createReservationWithPayment,
  FORMATION_ROOM_UNAVAILABLE,
} = require('../models/helpers');
const { applyTenantFilter } = require('../middleware/guards');
const { broadcastNouvelleFormation } = require('../services/notificationService');

async function listFormations(req, res) {
  try {
    const { statut, formateur_id, from, to } = req.query;
    let query = supabaseAdmin
      .from('formations')
      .select(`
        *,
        profiles!formateur_id (id, nom, prenom, specialite),
        espaces (id, nom, type),
        inscriptions_formations (count)
      `)
      .order('date_debut', { ascending: true });

    if (statut) query = query.eq('statut', statut);
    if (formateur_id) query = query.eq('formateur_id', formateur_id);
    if (from) query = query.gte('date_debut', from);
    if (to) query = query.lte('date_debut', to);
    query = applyTenantFilter(query, req);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const formatted = await Promise.all((data || []).map(async (f) => {
      const { count } = await supabaseAdmin
        .from('inscriptions_formations')
        .select('*', { count: 'exact', head: true })
        .eq('formation_id', f.id)
        .neq('statut', 'annulee');
      return { ...f, nb_inscrits: count || 0, places_restantes: f.capacite_max - (count || 0) };
    }));

    res.json({ formations: formatted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getFormation(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('formations')
      .select(`*, profiles!formateur_id (id, nom, prenom, email, specialite, biographie), espaces (id, nom, type, capacite)`)
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Formation introuvable.' });

    const { data: inscrits, count } = await supabaseAdmin
      .from('inscriptions_formations')
      .select('*, profiles!user_id (id, nom, prenom, email, telephone)', { count: 'exact' })
      .eq('formation_id', req.params.id)
      .neq('statut', 'annulee');

    const isStaff = ['super_admin', 'admin', 'staff'].includes(req.profile.role);
    const isFormateur = req.profile.role === 'formateur' && data.formateur_id === req.user.id;

    res.json({
      formation: { ...data, nb_inscrits: count || 0, places_restantes: data.capacite_max - (count || 0) },
      participants: (isStaff || isFormateur) ? (inscrits || []) : [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createFormation(req, res) {
  try {
    const { titre, description, formateur_id, espace_id, date_debut, date_fin, capacite_max, prix_inscription, programme, prerequis, materiel, mode, tenant_id } = req.body;

    if (!titre || !formateur_id || !date_debut || !date_fin || !capacite_max) {
      return res.status(400).json({ error: 'titre, formateur_id, date_debut, date_fin et capacite_max sont requis.' });
    }
    if (new Date(date_debut) >= new Date(date_fin)) {
      return res.status(400).json({ error: 'date_fin doit être postérieure à date_debut.' });
    }

    if (formateur_id !== req.user.id) {
      return res.status(403).json({ error: 'Vous ne pouvez créer des formations que pour votre propre compte.' });
    }

    const { data: formateur, error: fErr } = await supabaseAdmin
      .from('profiles').select('id').eq('id', formateur_id).eq('role', 'formateur').single();
    if (fErr || !formateur) return res.status(404).json({ error: 'Formateur introuvable.' });

    let reservationId = null;
    let targetTenantId = tenant_id || req.tenantId;

    if (espace_id) {
      const availability = await getBookingAvailability(espace_id, date_debut, date_fin, null, { exclusive: true });
      if (!availability.isAvailable) {
        return res.status(409).json({
          error: availability.conflictMessage || FORMATION_ROOM_UNAVAILABLE,
          code: 'SALLE_INDISPONIBLE',
        });
      }

      const { reservation, tenantId: bookingTenantId } = await createReservationWithPayment({
        userId: req.user.id,
        espaceId: espace_id,
        dateDebut: date_debut,
        dateFin: date_fin,
        tenantId: targetTenantId,
        mode: mode || 'sur_place',
      });
      reservationId = reservation.id;
      if (bookingTenantId) targetTenantId = bookingTenantId;

      try {
        const { data: admins } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .in('role', ['admin', 'staff'])
          .eq('tenant_id', reservation.tenant_id || targetTenantId);
        for (const admin of admins || []) {
          await supabaseAdmin.from('notifications').insert({
            user_id: admin.id,
            type: 'nouvelle_demande_reservation',
            canal: 'Dashboard',
            message: `📋 Réservation (${mode === 'online' ? 'en ligne' : 'sur place'}) liée à la formation « ${titre} » — ${reservation.espaces?.nom || 'espace'} (en attente de confirmation).`,
          });
        }
      } catch (notifErr) {
        console.error('⚠️ Notification réservation formation:', notifErr.message);
      }
    }

    const insertPayload = {
      titre,
      description: description || null,
      formateur_id,
      espace_id: espace_id || null,
      date_debut,
      date_fin,
      capacite_max: parseInt(capacite_max),
      prix_inscription: parseFloat(prix_inscription || 0),
      programme: programme || null,
      prerequis: prerequis || null,
      materiel: materiel || null,
      statut: 'planifiee',
      tenant_id: targetTenantId,
    };
    if (reservationId) insertPayload.reservation_id = reservationId;

    let { data, error } = await supabaseAdmin
      .from('formations')
      .insert(insertPayload)
      .select(`*, profiles!formateur_id (id, nom, prenom), espaces (id, nom, type)`)
      .single();

    if (error && reservationId && /reservation_id/.test(error.message || '')) {
      delete insertPayload.reservation_id;
      const retry = await supabaseAdmin
        .from('formations')
        .insert(insertPayload)
        .select(`*, profiles!formateur_id (id, nom, prenom), espaces (id, nom, type)`)
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      if (reservationId) {
        await supabaseAdmin.from('reservations').update({ statut: 'cancelled' }).eq('id', reservationId);
      }
      return res.status(400).json({ error: error.message });
    }

    // Diffusion de la notification à tous les membres (étudiant, entreprise, individuel)
    broadcastNouvelleFormation(supabaseAdmin, data).catch((notifErr) => {
      console.warn('⚠️ Erreur diffusion notification nouvelle formation:', notifErr.message);
    });

    res.status(201).json({
      formation: data,
      reservation_id: reservationId,
      message: reservationId
        ? 'Formation créée. Une réservation de salle a été enregistrée en parallèle (en attente de confirmation admin).'
        : 'Formation créée.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateFormation(req, res) {
  try {
    const isStaff = ['super_admin', 'admin', 'staff'].includes(req.profile.role);
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('formations').select('*').eq('id', req.params.id).single();
    if (fetchErr || !existing) return res.status(404).json({ error: 'Formation introuvable.' });

    const isFormateur = req.profile.role === 'formateur' && existing.formateur_id === req.user.id;
    if (!isStaff && !isFormateur) return res.status(403).json({ error: 'Droits insuffisants.' });

    const allowed = ['titre', 'description', 'espace_id', 'date_debut', 'date_fin', 'capacite_max', 'prix_inscription', 'statut', 'programme', 'prerequis', 'materiel'];
    const updates = { updated_at: new Date().toISOString() };
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const newDebut = updates.date_debut || existing.date_debut;
    const newFin = updates.date_fin || existing.date_fin;
    const newEspace = updates.espace_id !== undefined ? (updates.espace_id || null) : existing.espace_id;

    if (new Date(newDebut) >= new Date(newFin)) {
      return res.status(400).json({ error: 'date_fin doit être postérieure à date_debut.' });
    }

    const scheduleChanged = updates.date_debut || updates.date_fin || updates.espace_id !== undefined;
    const existingReservationId = existing.reservation_id || null;

    if (scheduleChanged && newEspace) {
      const availability = await getBookingAvailability(newEspace, newDebut, newFin, existingReservationId, {
        exclusive: true,
        excludeFormationId: existing.id,
      });
      if (!availability.isAvailable) {
        return res.status(409).json({
          error: availability.conflictMessage || FORMATION_ROOM_UNAVAILABLE,
          code: 'SALLE_INDISPONIBLE',
        });
      }

      if (existingReservationId) {
        const { error: resErr } = await supabaseAdmin
          .from('reservations')
          .update({
            espace_id: newEspace,
            date_debut: newDebut,
            date_fin: newFin,
          })
          .eq('id', existingReservationId);
        if (resErr) return res.status(400).json({ error: resErr.message });
      } else {
        const { reservation } = await createReservationWithPayment({
          userId: existing.formateur_id,
          espaceId: newEspace,
          dateDebut: newDebut,
          dateFin: newFin,
          tenantId: existing.tenant_id || req.tenantId,
          mode: 'online',
        });
        updates.reservation_id = reservation.id;
      }
    }

    if (scheduleChanged && !newEspace && existingReservationId) {
      await supabaseAdmin.from('reservations').update({ statut: 'cancelled' }).eq('id', existingReservationId);
      updates.reservation_id = null;
    }

    if (updates.statut === 'annulee' && existingReservationId) {
      await supabaseAdmin.from('reservations').update({ statut: 'cancelled' }).eq('id', existingReservationId);
    }

    const { data, error } = await supabaseAdmin
      .from('formations').update(updates).eq('id', req.params.id)
      .select(`*, profiles!formateur_id (id, nom, prenom), espaces (id, nom, type)`).single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ formation: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteFormation(req, res) {
  try {
    const isAdmin = ['super_admin', 'admin'].includes(req.profile.role);
    const isFormateur = req.profile.role === 'formateur';

    if (!isAdmin && !isFormateur) {
      return res.status(403).json({ error: 'Droits insuffisants pour cette action.' });
    }

    const { data: formation, error: fetchErr } = await supabaseAdmin
      .from('formations').select('*').eq('id', req.params.id).single();
    if (fetchErr || !formation) return res.status(404).json({ error: 'Formation introuvable.' });

    if (isFormateur && formation.formateur_id !== req.user.id) {
      return res.status(403).json({ error: 'Vous ne pouvez supprimer que vos propres formations.' });
    }

    const { count } = await supabaseAdmin
      .from('inscriptions_formations').select('*', { count: 'exact', head: true })
      .eq('formation_id', req.params.id).neq('statut', 'annulee');

    if ((count || 0) > 0) {
      const { error } = await supabaseAdmin
        .from('formations').update({ statut: 'annulee', updated_at: new Date().toISOString() }).eq('id', req.params.id);
      if (error) return res.status(400).json({ error: error.message });
      if (formation.reservation_id) {
        await supabaseAdmin.from('reservations').update({ statut: 'cancelled' }).eq('id', formation.reservation_id);
      }
      return res.json({ message: `Formation "${formation.titre}" marquée comme annulée (${count} inscrit(s) concerné(s)).` });
    }

    if (formation.reservation_id) {
      await supabaseAdmin.from('reservations').update({ statut: 'cancelled' }).eq('id', formation.reservation_id);
    }

    const { error } = await supabaseAdmin.from('formations').delete().eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Formation supprimée.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  listFormations,
  getFormation,
  createFormation,
  updateFormation,
  deleteFormation,
};
