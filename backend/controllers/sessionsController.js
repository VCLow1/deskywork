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
          profiles!user_id (nom, prenom, email)
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
            profiles!user_id (nom, prenom, email)
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
            profiles!user_id (nom, prenom, email)
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


// ─── CDC v3.0 D3 & D4 : Calcul temps réel & tarification dépassement ────────
function computeWorkSessionDetails(sessionRow, overtimeRateOverride = null) {
  const res = sessionRow.reservations || {};
  const nowMs = Date.now();
  const debutMs = res.date_debut ? new Date(res.date_debut).getTime() : nowMs;
  const finMs = res.date_fin ? new Date(res.date_fin).getTime() : nowMs;
  const isReleased = Boolean(sessionRow.check_out) || sessionRow.statut === 'completed';

  let etat = 'en_cours';
  let etat_label = 'En cours';
  let seconds_remaining = Math.max(0, Math.floor((finMs - nowMs) / 1000));
  let overtime_seconds = 0;

  if (isReleased) {
    etat = 'terminee';
    etat_label = 'Terminée';
    seconds_remaining = 0;
    if (sessionRow.check_out && finMs) {
      overtime_seconds = Math.max(0, Math.floor((new Date(sessionRow.check_out).getTime() - finMs) / 1000));
    }
  } else if (!sessionRow.check_in && nowMs < debutMs) {
    etat = 'a_venir';
    etat_label = 'À venir';
    seconds_remaining = Math.max(0, Math.floor((finMs - debutMs) / 1000));
  } else if (nowMs > finMs) {
    etat = 'en_depassement';
    etat_label = 'En dépassement';
    seconds_remaining = 0;
    overtime_seconds = Math.floor((nowMs - finMs) / 1000);
  } else if (seconds_remaining <= 15 * 60) {
    etat = 'bientot_terminee';
    etat_label = 'Bientôt terminée';
  }

  const overtime_minutes = Math.ceil(overtime_seconds / 60);
  const hourlyRate = Number(
    overtimeRateOverride != null ? overtimeRateOverride : (res.espaces?.tarif_horaire || 0)
  );
  const montant_depassement = overtime_minutes > 0 && hourlyRate > 0
    ? Number(((overtime_minutes / 60) * hourlyRate).toFixed(3))
    : 0;

  return {
    etat,
    etat_label,
    is_released: isReleased,
    seconds_remaining,
    temps_restant: Math.ceil(seconds_remaining / 60),
    overtime_seconds,
    overtime_minutes,
    hourly_overtime_rate: hourlyRate,
    montant_depassement,
  };
}

async function getTenantOvertimeRate(tenantId) {
  if (!tenantId) return null;
  try {
    const { data } = await supabaseAdmin.from('tenants').select('settings').eq('id', tenantId).maybeSingle();
    if (data?.settings?.tarif_depassement_heure != null) {
      return Number(data.settings.tarif_depassement_heure);
    }
  } catch (_) {}
  return null;
}

async function getLiveSessions(req, res) {
  try {
    const overtimeRate = await getTenantOvertimeRate(req.tenantId);

    // 1. Sessions en base (priorité aux non libérées : check_out IS NULL)
    let q = supabaseAdmin
      .from('sessions')
      .select(`
        *,
        reservations (
          id, user_id, guest_id, espace_id, tenant_id, date_debut, date_fin, statut,
          espaces (id, nom, type, tarif_horaire),
          profiles!user_id (id, nom, prenom, email, telephone)
        )
      `)
      .order('check_in', { ascending: false })
      .limit(80);
    const { data: sessionRows, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    const filtered = (sessionRows || []).filter((s) => {
      if (!req.tenantId) return true;
      return s.reservations?.tenant_id === req.tenantId;
    });

    const live = filtered
      .filter((s) => !s.check_out && s.statut !== 'completed')
      .map((s) => ({
        ...s,
        membre: s.reservations?.profiles
          ? `${s.reservations.profiles.prenom || ''} ${s.reservations.profiles.nom || ''}`.trim() || s.reservations.profiles.email
          : 'Visiteur',
        espace_nom: s.reservations?.espaces?.nom || 'Espace',
        ...computeWorkSessionDetails(s, overtimeRate),
      }));

    // 2. Réservations confirmées du jour pas encore check-in (statut "À venir")
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    let rQ = supabaseAdmin
      .from('reservations')
      .select('id, user_id, espace_id, tenant_id, date_debut, date_fin, statut, espaces(id, nom, type, tarif_horaire), profiles!user_id(id, nom, prenom, email)')
      .eq('statut', 'confirmed')
      .gte('date_fin', new Date(Date.now() - 3600000).toISOString())
      .lte('date_debut', todayEnd.toISOString())
      .order('date_debut', { ascending: true });
    if (req.tenantId) rQ = rQ.eq('tenant_id', req.tenantId);
    const { data: confirmedToday } = await rQ;

    const checkedReservationIds = new Set(filtered.map((s) => s.reservation_id));
    const upcoming = (confirmedToday || [])
      .filter((r) => !checkedReservationIds.has(r.id))
      .map((r) => ({
        id: `upcoming-${r.id}`,
        reservation_id: r.id,
        statut: 'upcoming',
        check_in: null,
        check_out: null,
        reservations: r,
        membre: r.profiles ? `${r.profiles.prenom || ''} ${r.profiles.nom || ''}`.trim() || r.profiles.email : 'Visiteur',
        espace_nom: r.espaces?.nom || 'Espace',
        etat: 'a_venir',
        etat_label: 'À venir',
        is_released: false,
        seconds_remaining: Math.max(0, Math.floor((new Date(r.date_fin).getTime() - new Date(r.date_debut).getTime()) / 1000)),
        temps_restant: Math.ceil(Math.max(0, (new Date(r.date_fin).getTime() - new Date(r.date_debut).getTime()) / 60000)),
        overtime_seconds: 0,
        overtime_minutes: 0,
        montant_depassement: 0,
      }));

    res.json({
      live_sessions: [...live, ...upcoming],
      counts: {
        total_open: live.length,
        en_cours: live.filter((s) => s.etat === 'en_cours').length,
        bientot_terminee: live.filter((s) => s.etat === 'bientot_terminee').length,
        en_depassement: live.filter((s) => s.etat === 'en_depassement').length,
        a_venir: upcoming.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/sessions/:id/release — Bouton explicite « C'est bon, libérée » (CDC v3.0 D3 & D4)
async function releaseSession(req, res) {
  const { id } = req.params;
  try {
    const { data: session, error: fetchErr } = await supabaseAdmin
      .from('sessions')
      .select(`
        *,
        reservations (id, user_id, tenant_id, date_debut, date_fin, espaces(nom, type, tarif_horaire))
      `)
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !session) {
      return res.status(404).json({ error: 'Session de travail introuvable.' });
    }
    if (session.check_out && session.statut === 'completed') {
      return res.status(400).json({ error: 'Cette ressource a déjà été libérée.' });
    }

    const resTenant = session.reservations?.tenant_id || req.tenantId || null;
    const overtimeRate = await getTenantOvertimeRate(resTenant);
    const details = computeWorkSessionDetails(session, overtimeRate);
    const nowIso = new Date().toISOString();

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('sessions')
      .update({
        check_out: nowIso,
        statut: 'completed',
        temps_restant: 0,
      })
      .eq('id', session.id)
      .select('*, reservations(id, user_id, date_debut, date_fin, espaces(nom, type, tarif_horaire))')
      .single();

    if (updErr) return res.status(400).json({ error: updErr.message });

    // D4 : Si dépassement de temps, créer automatiquement le Montant dû sur place
    let overtimePayment = null;
    if (details.montant_depassement > 0 && session.reservations?.user_id) {
      const { data: payRow, error: payErr } = await supabaseAdmin
        .from('paiements')
        .insert({
          user_id: session.reservations.user_id,
          reservation_id: session.reservation_id,
          montant: details.montant_depassement,
          mode: 'cash',
          statut: 'pending',
          tenant_id: resTenant,
          reference_externe: `DEPASSEMENT-${details.overtime_minutes}MIN`,
        })
        .select('*')
        .single();
      if (!payErr) overtimePayment = payRow;
    }

    emitSessionEnded({
      id: updated.id,
      user_id: session.reservations?.user_id,
      reservation_id: session.reservation_id,
      check_out: updated.check_out,
      statut: 'completed',
      espace: session.reservations?.espaces,
    });

    res.json({
      session: updated,
      released: true,
      overtime_minutes: details.overtime_minutes,
      overtime_amount: details.montant_depassement,
      montant_du_payment: overtimePayment,
      message: details.montant_depassement > 0
        ? `C'est bon, ressource libérée ! Dépassement de ${details.overtime_minutes} min facturé (${details.montant_depassement.toFixed(3)} DT) ajouté au Montant dû.`
        : "C'est bon, la ressource a été libérée dans le calendrier.",
    });
  } catch (err) {
    console.error('Erreur releaseSession:', err);
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
  getLiveSessions,
  releaseSession,
};
