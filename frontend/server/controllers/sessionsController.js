// controllers/sessionsController.js — MODULE B : Politique d'annulation & Sessions check-in/out
const { supabaseAdmin } = require('../config/supabase');
const { getCancellationPolicy, hasActiveSubscription, computeRemainingMinutes } = require('../models/helpers');
const { applyTenantFilter } = require('../middleware/guards');
const { emitSessionStarted, emitSessionEnded, emitSessionOvertime } = require('../services/socketService');

async function getCancellationPolicyRoute(req, res) {
  try {
    const policy = await getCancellationPolicy(req.tenantId);
    res.json({ policy });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateCancellationPolicyRoute(req, res) {
  try {
    const {
      delai_heures,
      penalite_pct,
      annulation_membre_autorisee,
      remboursement_auto,
      message_membre,
    } = req.body;

    const current = await getCancellationPolicy(req.tenantId);
    const values = {
      delai_heures: delai_heures ?? current.delai_heures,
      penalite_pct: penalite_pct ?? current.penalite_pct,
      annulation_membre_autorisee: annulation_membre_autorisee ?? current.annulation_membre_autorisee,
      remboursement_auto: remboursement_auto ?? current.remboursement_auto,
      message_membre: message_membre ?? current.message_membre,
      updated_at: new Date().toISOString(),
    };

    let data, error;
    if (current.id) {
      ({ data, error } = await supabaseAdmin
        .from('politique_annulation')
        .update(values)
        .eq('id', current.id)
        .select()
        .single());
    } else {
      // Aucune ligne pour ce tenant : création (politique configurable par l'Admin Coworking)
      ({ data, error } = await supabaseAdmin
        .from('politique_annulation')
        .insert({ ...values, tenant_id: req.tenantId || null })
        .select()
        .single());
    }

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ policy: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function listSessions(req, res) {
  try {
    const { statut, from, to } = req.query;

    let query = supabaseAdmin
      .from('sessions')
      .select(`
        *,
        reservations (
          id, user_id, espace_id, date_debut, date_fin, statut,
          espaces (nom, type),
          profiles (nom, prenom, email)
        )
      `)
      .order('created_at', { ascending: false });

    if (statut) query = query.eq('statut', statut);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);
    query = applyTenantFilter(query, req);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ sessions: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getMySessions(req, res) {
  try {
    const { data: reservations, error: resErr } = await supabaseAdmin
      .from('reservations')
      .select('id')
      .eq('user_id', req.user.id);

    if (resErr) return res.status(500).json({ error: resErr.message });

    const reservationIds = (reservations || []).map((r) => r.id);
    if (reservationIds.length === 0) {
      return res.json({ sessions: [], activeSession: null });
    }

    const { data, error } = await supabaseAdmin
      .from('sessions')
      .select(`
        *,
        reservations (
          id, date_debut, date_fin, statut,
          espaces (nom, type)
        )
      `)
      .in('reservation_id', reservationIds)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    const sessions = (data || []).map((session) => ({
      ...session,
      temps_restant: session.statut === 'active'
        ? computeRemainingMinutes(session.reservations?.date_fin)
        : session.temps_restant,
    }));

    const activeSession = sessions.find((s) => s.statut === 'active') || null;
    res.json({ sessions, activeSession });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getMyActiveSessions(req, res) {
  try {
    const { data: reservations } = await supabaseAdmin
      .from('reservations')
      .select('id')
      .eq('user_id', req.user.id);

    const reservationIds = (reservations || []).map((r) => r.id);
    if (reservationIds.length === 0) {
      return res.json({ session: null });
    }

    const { data, error } = await supabaseAdmin
      .from('sessions')
      .select(`
        *,
        reservations (
          id, date_debut, date_fin, statut,
          espaces (nom, type)
        )
      `)
      .in('reservation_id', reservationIds)
      .eq('statut', 'active')
      .order('check_in', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });

    if (!data) {
      return res.json({ session: null });
    }

    res.json({
      session: {
        ...data,
        temps_restant: computeRemainingMinutes(data.reservations?.date_fin),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function checkIn(req, res) {
  const { reservation_id, qr_token, force } = req.body;
  const isStaff = ['super_admin', 'admin', 'staff'].includes(req.profile.role);

  try {
    let targetUserId = req.user.id;
    let reservation;
    let checkedInMember;

    if (qr_token && isStaff) {
      // Le QR scanné peut être le token brut ou le payload JSON complet
      let token = String(qr_token).trim();
      if (token.startsWith('{')) {
        try {
          const parsed = JSON.parse(token);
          token = parsed.qr_token || parsed.token || token;
        } catch {
          // token brut
        }
      }

      const { data: memberProfile, error: profErr } = await supabaseAdmin
        .from('profiles')
        .select('id, nom, prenom, email, statut_compte')
        .eq('qr_token', token)
        .single();

      if (profErr || !memberProfile) {
        return res.status(404).json({ error: 'QR code invalide ou expiré.' });
      }

      targetUserId = memberProfile.id;
      checkedInMember = {
        id: memberProfile.id,
        nom: memberProfile.nom,
        prenom: memberProfile.prenom,
        email: memberProfile.email,
        statut_compte: memberProfile.statut_compte,
      };

      const now = new Date();
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      const { data: candidateReservations } = await supabaseAdmin
        .from('reservations')
        .select('*, espaces(nom, type)')
        .eq('user_id', targetUserId)
        .eq('statut', 'confirmed')
        .gte('date_fin', todayStart.toISOString())
        .order('date_debut', { ascending: true })
        .limit(10);

      const inProgress = (candidateReservations || []).find(
        (r) => new Date(r.date_debut) <= now && new Date(r.date_fin) >= now
      );
      const todayBooking = (candidateReservations || []).find(
        (r) => new Date(r.date_debut) >= todayStart && new Date(r.date_debut) <= todayEnd
      );
      reservation = inProgress || todayBooking || (candidateReservations || [])?.[0];

      if (!reservation) {
        return res.status(404).json({
          error: "Aucune réservation confirmée en cours ou à venir pour ce membre.",
          member: memberProfile,
        });
      }
    } else if (reservation_id) {
      const { data, error } = await supabaseAdmin
        .from('reservations')
        .select('*, espaces(nom, type)')
        .eq('id', reservation_id)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: 'Réservation introuvable.' });
      }

      if (!isStaff && data.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Check-in non autorisé.' });
      }

      if (data.statut !== 'confirmed' && !isStaff) {
        return res.status(400).json({ error: 'Seules les réservations confirmées peuvent être check-in.' });
      }

      reservation = data;
      targetUserId = data.user_id;
    } else {
      return res.status(400).json({ error: 'reservation_id ou qr_token requis.' });
    }

    const hasSub = await hasActiveSubscription(targetUserId);
    if (!hasSub && !force && !isStaff) {
      return res.status(403).json({ error: 'Abonnement actif requis pour le check-in.' });
    }

    const remaining = computeRemainingMinutes(reservation.date_fin);
    const now = new Date().toISOString();

    const { data: existingSession } = await supabaseAdmin
      .from('sessions')
      .select('*')
      .eq('reservation_id', reservation.id)
      .maybeSingle();

    let session;
    if (existingSession) {
      const { data, error } = await supabaseAdmin
        .from('sessions')
        .update({
          check_in: existingSession.check_in || now,
          statut: 'active',
          temps_restant: remaining,
        })
        .eq('id', existingSession.id)
        .select(`
          *,
          reservations (
            id, date_debut, date_fin, statut,
            espaces (nom, type),
            profiles (nom, prenom, email)
          )
        `)
        .single();

      if (error) return res.status(400).json({ error: error.message });
      session = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from('sessions')
        .insert({
          reservation_id: reservation.id,
          check_in: now,
          statut: 'active',
          temps_restant: remaining,
        })
        .select(`
          *,
          reservations (
            id, date_debut, date_fin, statut,
            espaces (nom, type),
            profiles (nom, prenom, email)
          )
        `)
        .single();

      if (error) return res.status(400).json({ error: error.message });
      session = data;
    }

    res.status(201).json({
      session: { ...session, temps_restant: remaining },
      member: checkedInMember || undefined,
      warning: !hasSub ? 'Check-in effectué sans abonnement actif.' : null,
    });

    emitSessionStarted({
      id: session.id,
      user_id: targetUserId,
      reservation_id: reservation.id,
      check_in: session.check_in,
      temps_restant: remaining,
      espace: reservation.espaces,
    });
  } catch (err) {
    console.error('Erreur check-in:', err);
    res.status(500).json({ error: err.message });
  }
}

async function checkOut(req, res) {
  const { session_id, reservation_id } = req.body;
  const isStaff = ['super_admin', 'admin', 'staff'].includes(req.profile.role);

  if (!session_id && !reservation_id) {
    return res.status(400).json({ error: 'session_id ou reservation_id requis.' });
  }

  try {
    let query = supabaseAdmin
      .from('sessions')
      .select(`
        *,
        reservations (id, user_id, date_debut, date_fin, espaces(nom, type))
      `);

    if (session_id) query = query.eq('id', session_id);
    else query = query.eq('reservation_id', reservation_id);

    const { data: session, error: fetchErr } = await query.maybeSingle();

    if (fetchErr || !session) {
      return res.status(404).json({ error: 'Session introuvable.' });
    }

    if (!isStaff && session.reservations?.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Check-out non autorisé.' });
    }

    const now = new Date().toISOString();
    const endTime = new Date(session.reservations?.date_fin || now);
    const overtime = new Date(now) > endTime;

    const { data, error } = await supabaseAdmin
      .from('sessions')
      .update({
        check_out: now,
        statut: overtime ? 'overtime' : 'completed',
        temps_restant: 0,
      })
      .eq('id', session.id)
      .select(`
        *,
        reservations (
          id, date_debut, date_fin, statut,
          espaces (nom, type)
        )
      `)
      .single();

    if (error) return res.status(400).json({ error: error.message });

    res.json({
      session: data,
      overtime,
      message: overtime ? 'Session terminée avec dépassement horaire.' : 'Check-out enregistré.',
    });

    const sessionEventData = {
      id: data.id,
      user_id: session.reservations?.user_id,
      reservation_id: session.reservation_id,
      check_out: data.check_out,
      statut: data.statut,
      espace: session.reservations?.espaces,
    };
    if (overtime) {
      emitSessionOvertime(sessionEventData);
    } else {
      emitSessionEnded(sessionEventData);
    }
  } catch (err) {
    console.error('Erreur check-out:', err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getCancellationPolicyRoute,
  updateCancellationPolicyRoute,
  listSessions,
  getMySessions,
  getMyActiveSessions,
  checkIn,
  checkOut,
};
