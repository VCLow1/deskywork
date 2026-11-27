// controllers/sessionsController.js — MODULE B : Sessions check-in/out, Chrono Serveur & Walk-in (LOT 3)
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const { getCancellationPolicy, buildDynamicCancellationMessage, hasActiveSubscription, computeRemainingMinutes, insertWithColumnFallback } = require('../models/helpers');
const { applyTenantFilter } = require('../middleware/guards');
const { emitSessionStarted, emitSessionEnded, emitSessionOvertime, emitNotification } = require('../services/socketService');
const { computeWalkinBilling, computeOvertime15Min, getClosingTimestampTunis } = require('../models/walkinBilling');
const { checkAvailabilityWithBuffer, getTenantTamponMinutes, loadSpaceUnitsForTenant, sweepPastConfirmedReservations } = require('../models/bookingAvailability');
const { logActivity } = require('../models/activityLogger');
const { DEFAULT_TVA_PCT, roundMillime, computeTTC, computeHTFromTTC } = require('../models/pricingMath');
const { verifyDynamicQrOrShortCode } = require('../models/dynamicQr');

function normalizePhoneTN(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00216') && digits.length >= 13) return `+216${digits.slice(5, 13)}`;
  if (digits.startsWith('216') && digits.length >= 11) return `+216${digits.slice(3, 11)}`;
  if (digits.length === 8) return `+216${digits}`;
  return null;
}

async function readTenantSettingsSafe(tenantId) {
  if (!tenantId) return {};
  try {
    const { data } = await supabaseAdmin.from('tenants').select('settings').eq('id', tenantId).maybeSingle();
    return data?.settings && typeof data.settings === 'object' ? data.settings : {};
  } catch {
    return {};
  }
}

async function saveWalkinFallback(tenantId, walkins) {
  const settings = await readTenantSettingsSafe(tenantId);
  await supabaseAdmin
    .from('tenants')
    .update({ settings: { ...settings, walkin_sessions: walkins }, updated_at: new Date().toISOString() })
    .eq('id', tenantId);
}

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
      delai_annulation_gratuite,
      penalite_pct,
      annulation_membre_autorisee,
      remboursement_auto,
      message_membre,
    } = req.body;

    const current = await getCancellationPolicy(req.tenantId);
    const effectiveDelay = delai_annulation_gratuite ?? delai_heures ?? current.delai_heures ?? 24;
    const effectivePenalty = penalite_pct ?? current.penalite_pct ?? 0;
    const effectiveAllowed = annulation_membre_autorisee ?? current.annulation_membre_autorisee ?? true;
    const dynamicMsg = buildDynamicCancellationMessage({
      delai_annulation_gratuite: effectiveDelay,
      penalite_pct: effectivePenalty,
      annulation_membre_autorisee: effectiveAllowed,
    });
    const values = {
      delai_heures: Number(effectiveDelay),
      penalite_pct: effectivePenalty,
      annulation_membre_autorisee: effectiveAllowed,
      remboursement_auto: remboursement_auto ?? current.remboursement_auto,
      message_membre: (message_membre && String(message_membre).trim()) ? String(message_membre).trim() : dynamicMsg,
      updated_at: new Date().toISOString(),
    };

    if (req.tenantId) {
      try {
        const { data: tRow } = await supabaseAdmin.from('tenants').select('settings').eq('id', req.tenantId).maybeSingle();
        const nextSettings = { ...(tRow?.settings || {}), delai_annulation_gratuite: Number(effectiveDelay) };
        await supabaseAdmin.from('tenants').update({ settings: nextSettings }).eq('id', req.tenantId);
      } catch (_) {}
    }

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

    const nowIso = new Date().toISOString();
    const sessions = (data || []).map((session) => ({
      ...session,
      started_at: session.started_at || session.check_in,
      temps_restant: session.statut === 'active'
        ? computeRemainingMinutes(session.reservations?.date_fin)
        : session.temps_restant,
    }));

    const activeSession = sessions.find((s) => s.statut === 'active') || null;
    res.json({ sessions, activeSession, server_now: nowIso });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getMyActiveSessions(req, res) {
  try {
    await sweepPastConfirmedReservations(supabaseAdmin, { userId: req.user.id }).catch(() => {});
    const nowIso = new Date().toISOString();

    const { data: reservations } = await supabaseAdmin
      .from('reservations')
      .select('id, tenant_id, espace_id, unite_id, date_debut, date_fin, statut, archived_at, espaces(id, nom, type, tarif_horaire, tarif_horaire_ht, tva_pct, tenant_id)')
      .eq('user_id', req.user.id)
      .order('date_debut', { ascending: true });

    const activeReservations = (reservations || []).filter((r) => !r.archived_at);
    const reservationIds = activeReservations.map((r) => r.id);

    let activeSession = null;
    if (reservationIds.length > 0) {
      const { data, error } = await supabaseAdmin
        .from('sessions')
        .select(`
          *,
          reservations (
            id, tenant_id, espace_id, unite_id, date_debut, date_fin, statut,
            espaces (id, nom, type, tarif_horaire, tarif_horaire_ht, tva_pct, tenant_id)
          )
        `)
        .in('reservation_id', reservationIds)
        .in('statut', ['active', 'overtime'])
        .is('check_out', null)
        .order('check_in', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) return res.status(500).json({ error: error.message });
      if (data && (data.started_at || data.check_in)) {
        const resTenant = data.tenant_id || data.reservations?.tenant_id || data.reservations?.espaces?.tenant_id || null;
        const overtimeRate = await getTenantOvertimeRate(resTenant);
        const details = computeWorkSessionDetails(data, overtimeRate);
        activeSession = {
          ...data,
          started_at: data.started_at || data.check_in,
          temps_restant: details.temps_restant,
          overtime_rate: details.hourly_overtime_rate,
          details,
        };
      }
    }

    let nextBooking = null;
    if (!activeSession) {
      const { data: allMySessions } = reservationIds.length > 0
        ? await supabaseAdmin.from('sessions').select('reservation_id, check_out, statut').in('reservation_id', reservationIds)
        : { data: [] };
      const closedResIds = new Set(
        (allMySessions || []).filter((s) => s.check_out || s.statut === 'completed').map((s) => s.reservation_id)
      );

      nextBooking = activeReservations.find(
        (r) =>
          ['confirmed', 'pending', 'en_attente_confirmation'].includes(r.statut) &&
          !closedResIds.has(r.id) &&
          new Date(r.date_fin).getTime() > Date.now()
      ) || null;
    }

    res.json({
      server_now: nowIso,
      session: activeSession,
      next_booking: nextBooking,
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
    let qrMethod = null;

    if (qr_token && isStaff) {
      const verification = await verifyDynamicQrOrShortCode(supabaseAdmin, qr_token, {
        tenantId: req.tenantId || null,
      });

      if (!verification.valid) {
        const statusCode = verification.status === 'blocked' ? 403 : verification.status === 'expired' ? 410 : 404;
        return res.status(statusCode).json({
          error: verification.error,
          qr_status: verification.status,
          member: verification.member || undefined,
          overdue_days: verification.overdue_days,
          overdue_amount: verification.overdue_amount,
        });
      }

      qrMethod = verification.method;
      targetUserId = verification.member.id;
      checkedInMember = verification.member;

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
          member: checkedInMember,
        });
      }
    } else if (reservation_id) {
      if (!isStaff) {
        return res.status(403).json({
          error: "Seul l'accueil (ou le scan de votre QR code par l'équipe) peut démarrer votre session de travail.",
        });
      }
      const { data, error } = await supabaseAdmin
        .from('reservations')
        .select('*, espaces(nom, type)')
        .eq('id', reservation_id)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: 'Réservation introuvable.' });
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
      qr_method: qrMethod || undefined,
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
        reservations (
          id, user_id, tenant_id, date_debut, date_fin,
          espaces(id, nom, type, tarif_horaire, tarif_horaire_ht, tva_pct),
          profiles!user_id(id, nom, prenom, email)
        )
      `);

    if (session_id) query = query.eq('id', session_id);
    else query = query.eq('reservation_id', reservation_id);

    const { data: session, error: fetchErr } = await query.maybeSingle();

    if (fetchErr || !session) {
      return res.status(404).json({ error: 'Session introuvable.' });
    }

    if (!isStaff && session.reservations?.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Action non autorisée.' });
    }

    if (session.check_out && session.statut === 'completed') {
      return res.json({
        already_stopped: true,
        session,
        server_now: new Date().toISOString(),
        message: 'Cette session est déjà terminée.',
      });
    }

    const nowIso = new Date().toISOString();
    const resTenant = session.tenant_id || session.reservations?.tenant_id || req.tenantId || null;
    const overtimeRate = await getTenantOvertimeRate(resTenant);
    const esp = session.reservations?.espaces || {};
    const effectiveRate = overtimeRate != null ? Number(overtimeRate) : Number(esp.tarif_horaire || 0);
    const tvaPct = Number(esp.tva_pct ?? DEFAULT_TVA_PCT);

    const overtimeCalc = computeOvertime15Min({
      dateFin: session.reservations?.date_fin || nowIso,
      nowOrStop: nowIso,
      tarifHoraireTTC: effectiveRate,
      tvaPct,
    });
    const overtime = overtimeCalc.overtimeSeconds > 0;

    let { data, error } = await supabaseAdmin
      .from('sessions')
      .update({
        check_out: nowIso,
        stopped_at: nowIso,
        statut: overtime ? 'overtime' : 'completed',
        temps_restant: 0,
        ended_by_member: !isStaff,
        overtime_tranches_15min: overtimeCalc.slices15Min,
        overtime_montant_ttc: overtimeCalc.montantTTC,
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

    if (error && /column|does not exist|schema cache/i.test(error.message || '')) {
      ({ data, error } = await supabaseAdmin
        .from('sessions')
        .update({
          check_out: nowIso,
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
        .single());
    }

    if (error) return res.status(400).json({ error: error.message });

    if (session.reservation_id) {
      await supabaseAdmin
        .from('reservations')
        .update({ statut: 'completed' })
        .eq('id', session.reservation_id)
        .catch(() => {});
    }

    let paiement = null;
    if (overtimeCalc.montantTTC > 0 && session.reservations?.user_id) {
      const { data: pRow } = await supabaseAdmin
        .from('paiements')
        .insert({
          user_id: session.reservations.user_id,
          reservation_id: session.reservation_id,
          montant: overtimeCalc.montantTTC,
          mode: 'cash',
          statut: 'pending',
          tenant_id: resTenant,
          reference_externe: `DEPASSEMENT-${overtimeCalc.slices15Min}T`,
        })
        .select('*')
        .maybeSingle();
      paiement = pRow || null;
    }

    // Si arrêté par le membre, alerter en temps réel l'accueil + tracer dans le journal
    if (!isStaff && resTenant) {
      const memberName = session.reservations?.profiles
        ? `${session.reservations.profiles.prenom || ''} ${session.reservations.profiles.nom || ''}`.trim()
        : `${req.profile?.prenom || ''} ${req.profile?.nom || ''}`.trim() || 'Membre';
      const spaceName = esp.nom || 'Espace';
      const msg = overtimeCalc.montantTTC > 0
        ? `${memberName} a terminé sa session (${spaceName}) avec un dépassement de ${overtimeCalc.overtimeMinutes} min (${overtimeCalc.montantTTC.toFixed(3)} DT TTC).`
        : `${memberName} a terminé sa session de travail (${spaceName}).`;

      const { data: admins } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('tenant_id', resTenant)
        .in('role', ['admin', 'staff']);
      for (const adm of admins || []) {
        const notifPayload = {
          user_id: adm.id,
          type: 'session_terminee_membre',
          canal: 'Dashboard',
          lu: false,
          message: `${msg} [Lien: /admin/reservations]`,
        };
        const { data: insertedNotif } = await supabaseAdmin
          .from('notifications')
          .insert(notifPayload)
          .select('*')
          .maybeSingle();
        if (insertedNotif) emitNotification(adm.id, insertedNotif);
      }

      await logActivity({
        tenantId: resTenant,
        req,
        action: 'fin_session_membre',
        entityType: 'session',
        entityId: session.id,
        entityLabel: `${memberName} · ${spaceName}`,
        afterData: { check_out: nowIso, overtime: overtimeCalc },
      });
    }

    res.json({
      server_now: nowIso,
      session: data,
      overtime,
      billing_summary: overtimeCalc,
      paiement,
      message: overtime
        ? `Session terminée avec dépassement (${overtimeCalc.overtimeMinutes} min · ${overtimeCalc.montantTTC.toFixed(3)} DT TTC à régler sur place).`
        : 'Votre session est terminée et l’accueil a été prévenu.',
    });

    const sessionEventData = {
      id: data.id,
      user_id: session.reservations?.user_id,
      reservation_id: session.reservation_id,
      check_out: data.check_out,
      statut: data.statut,
      ended_by_member: !isStaff,
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

    const hourlyRate = overtimeRateOverride != null ? Number(overtimeRateOverride) : Number(res.espaces?.tarif_horaire || 0);
    const overtimeCalc = overtime_seconds > 0
      ? computeOvertime15Min({
        dateFin: res.date_fin,
        nowOrStop: isReleased && sessionRow.check_out ? sessionRow.check_out : new Date(nowMs).toISOString(),
        tarifHoraireTTC: hourlyRate,
        tvaPct: Number(res.espaces?.tva_pct ?? DEFAULT_TVA_PCT),
      })
      : { overtimeMinutes: 0, slices15Min: 0, montantHT: 0, montantTTC: 0 };

    return {
      etat,
      etat_label,
      is_released: isReleased,
      started_at: sessionRow.started_at || sessionRow.check_in || null,
      seconds_remaining,
      temps_restant: Math.ceil(seconds_remaining / 60),
      overtime_seconds,
      overtime_minutes: overtimeCalc.overtimeMinutes,
      overtime_slices_15min: overtimeCalc.slices15Min,
      hourly_overtime_rate: hourlyRate,
      montant_depassement: overtimeCalc.montantTTC,
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

async function runAutoCloseSweepForTenant(tenantId, req = null) {
  if (!tenantId) return [];
  const closedAlerts = [];
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  try {
    const [{ data: activeSql }, { data: espRows }, settings] = await Promise.all([
      supabaseAdmin
        .from('sessions')
        .select('*, reservations(id, user_id, espace_id, tenant_id, date_debut, date_fin, unite_id, espaces(id, nom, type, horaires, tarif_horaire, tarif_horaire_ht, tarif_journalier_ht, tva_pct))')
        .in('statut', ['active', 'overtime'])
        .is('check_out', null),
      supabaseAdmin.from('espaces').select('*').eq('tenant_id', tenantId),
      readTenantSettingsSafe(tenantId),
    ]);

    const espById = new Map((espRows || []).map((e) => [e.id, e]));
    const tenantSessions = (activeSql || []).filter((s) => s.tenant_id === tenantId || s.reservations?.tenant_id === tenantId);

    for (const s of tenantSessions) {
      const esp = s.reservations?.espaces || espById.get(s.espace_id) || {};
      const startIso = s.started_at || s.check_in || s.created_at;
      if (!startIso) continue;
      const closeIso = getClosingTimestampTunis(esp.horaires || '08:00 - 20:00', startIso);
      if (nowMs <= new Date(closeIso).getTime() + 5 * 60 * 1000) continue;

      // Clôture automatique à l'heure de fermeture
      if (s.is_walkin) {
        const bill = computeWalkinBilling({
          startedAt: startIso,
          stoppedAt: closeIso,
          tarifHoraireHT: esp.tarif_horaire_ht ?? computeHTFromTTC(esp.tarif_horaire || 0, esp.tva_pct ?? DEFAULT_TVA_PCT),
          tarifJournalierHT: esp.tarif_journalier_ht ?? computeHTFromTTC(esp.tarif_journalier || 0, esp.tva_pct ?? DEFAULT_TVA_PCT),
          tvaPct: esp.tva_pct ?? DEFAULT_TVA_PCT,
        });
        await supabaseAdmin
          .from('sessions')
          .update({
            check_out: closeIso,
            stopped_at: closeIso,
            statut: 'completed',
            temps_restant: 0,
            tranches_15min: bill.billedSlices,
            montant_calcule_ht: bill.montantHT,
            montant_calcule_ttc: bill.montantTTC,
            auto_closed_at: nowIso,
            auto_close_alert: true,
          })
          .eq('id', s.id)
          .catch(() => supabaseAdmin.from('sessions').update({ check_out: closeIso, statut: 'completed', temps_restant: 0 }).eq('id', s.id));
        if (bill.montantTTC > 0 && (s.personne_id || s.reservations?.user_id)) {
          await supabaseAdmin.from('paiements').insert({
            user_id: s.personne_id || s.reservations?.user_id,
            montant: bill.montantTTC,
            mode: 'cash',
            statut: 'pending',
            tenant_id: tenantId,
            reference_externe: `WALKIN-AUTOCLOSE-${bill.billedSlices}T`,
          }).catch(() => {});
        }
        closedAlerts.push({
          session_id: s.id,
          client_nom: s.client_nom || 'Client sur place',
          espace_nom: esp.nom || 'Espace',
          closed_at: closeIso,
          montant_ttc: bill.montantTTC,
          reason: 'Oubli d\'arrêt détecté — clôture automatique à l\'heure de fermeture.',
        });
      } else {
        await supabaseAdmin
          .from('sessions')
          .update({
            check_out: closeIso,
            stopped_at: closeIso,
            statut: 'completed',
            temps_restant: 0,
            auto_closed_at: nowIso,
            auto_close_alert: true,
          })
          .eq('id', s.id)
          .catch(() => supabaseAdmin.from('sessions').update({ check_out: closeIso, statut: 'completed', temps_restant: 0 }).eq('id', s.id));
        closedAlerts.push({
          session_id: s.id,
          client_nom: s.reservations?.profiles ? `${s.reservations.profiles.prenom || ''} ${s.reservations.profiles.nom || ''}`.trim() : 'Client',
          espace_nom: esp.nom || 'Espace',
          closed_at: closeIso,
          reason: 'Oubli d\'arrêt détecté — clôture automatique à l\'heure de fermeture.',
        });
      }
    }

    // Même contrôle sur fallback settings walkin_sessions
    const fallbackWalkins = Array.isArray(settings.walkin_sessions) ? settings.walkin_sessions : [];
    let fbChanged = false;
    const nextFallback = fallbackWalkins.map((w) => {
      if (w.check_out || w.statut === 'completed') return w;
      const esp = espById.get(w.espace_id) || {};
      const closeIso = getClosingTimestampTunis(esp.horaires || '08:00 - 20:00', w.started_at || w.check_in);
      if (nowMs <= new Date(closeIso).getTime() + 5 * 60 * 1000) return w;
      fbChanged = true;
      const bill = computeWalkinBilling({
        startedAt: w.started_at || w.check_in,
        stoppedAt: closeIso,
        tarifHoraireHT: esp.tarif_horaire_ht ?? computeHTFromTTC(esp.tarif_horaire || 0, esp.tva_pct ?? DEFAULT_TVA_PCT),
        tarifJournalierHT: esp.tarif_journalier_ht ?? computeHTFromTTC(esp.tarif_journalier || 0, esp.tva_pct ?? DEFAULT_TVA_PCT),
        tvaPct: esp.tva_pct ?? DEFAULT_TVA_PCT,
      });
      closedAlerts.push({
        session_id: w.id,
        client_nom: w.client_nom || 'Client sur place',
        espace_nom: esp.nom || w.espace_nom || 'Espace',
        closed_at: closeIso,
        montant_ttc: bill.montantTTC,
        reason: 'Oubli d\'arrêt détecté — clôture automatique à l\'heure de fermeture.',
      });
      return {
        ...w,
        check_out: closeIso,
        stopped_at: closeIso,
        statut: 'completed',
        auto_closed_at: nowIso,
        auto_close_alert: true,
        tranches_15min: bill.billedSlices,
        montant_calcule_ht: bill.montantHT,
        montant_calcule_ttc: bill.montantTTC,
      };
    });
    if (fbChanged) await saveWalkinFallback(tenantId, nextFallback);

    if (closedAlerts.length > 0) {
      const { data: admins } = await supabaseAdmin.from('profiles').select('id').eq('tenant_id', tenantId).in('role', ['admin', 'staff']);
      for (const a of closedAlerts) {
        for (const adm of admins || []) {
          await supabaseAdmin.from('notifications').insert({
            user_id: adm.id,
            type: 'cloture_auto_session',
            canal: 'Dashboard',
            message: `Alerte chrono : la session de ${a.client_nom} (${a.espace_nom}) a été clôturée automatiquement à la fermeture.`,
          }).catch(() => {});
        }
        await logActivity({
          tenantId,
          req,
          action: 'cloture_automatique',
          entityType: 'session',
          entityId: a.session_id,
          entityLabel: `${a.client_nom} (${a.espace_nom})`,
          afterData: a,
        });
      }
    }
  } catch (err) {
    console.warn('autoCloseSweep warning:', err.message);
  }
  return closedAlerts;
}

async function getLiveSessions(req, res) {
  try {
    const overtimeRate = await getTenantOvertimeRate(req.tenantId);
    const autoClosedAlerts = req.tenantId ? await runAutoCloseSweepForTenant(req.tenantId, req) : [];

    // 1. Sessions en base (priorité aux non libérées : check_out IS NULL)
    let q = supabaseAdmin
      .from('sessions')
      .select(`
        *,
        reservations (
          id, user_id, guest_id, espace_id, unite_id, tenant_id, date_debut, date_fin, statut,
          espaces (id, nom, type, tarif_horaire, tarif_horaire_ht, tarif_journalier_ht, tva_pct, horaires),
          profiles!user_id (id, nom, prenom, email, telephone)
        )
      `)
      .order('check_in', { ascending: false })
      .limit(80);
    const { data: sessionRows, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    const filtered = (sessionRows || []).filter((s) => {
      if (!req.tenantId) return true;
      return s.tenant_id === req.tenantId || s.reservations?.tenant_id === req.tenantId;
    });

    const settings = await readTenantSettingsSafe(req.tenantId);
    const { data: allSpaces } = req.tenantId
      ? await supabaseAdmin.from('espaces').select('*').eq('tenant_id', req.tenantId)
      : { data: [] };
    const espById = new Map((allSpaces || []).map((e) => [e.id, e]));

    const sqlLive = filtered
      .filter((s) => !s.check_out && s.statut !== 'completed')
      .map((s) => {
        if (s.is_walkin) {
          const esp = espById.get(s.espace_id) || {};
          const bill = computeWalkinBilling({
            startedAt: s.started_at || s.check_in,
            tarifHoraireHT: esp.tarif_horaire_ht ?? computeHTFromTTC(esp.tarif_horaire || 0, esp.tva_pct ?? DEFAULT_TVA_PCT),
            tarifJournalierHT: esp.tarif_journalier_ht ?? computeHTFromTTC(esp.tarif_journalier || 0, esp.tva_pct ?? DEFAULT_TVA_PCT),
            tvaPct: esp.tva_pct ?? DEFAULT_TVA_PCT,
          });
          return {
            ...s,
            started_at: s.started_at || s.check_in,
            membre: s.client_nom || 'Client sur place',
            espace_nom: esp.nom || 'Espace',
            etat: 'en_cours',
            etat_label: 'Client sur place',
            is_walkin: true,
            walkin_estimate: bill,
            seconds_remaining: 0,
            overtime_seconds: 0,
            montant_depassement: 0,
          };
        }
        return {
          ...s,
          started_at: s.started_at || s.check_in,
          membre: s.reservations?.profiles
            ? `${s.reservations.profiles.prenom || ''} ${s.reservations.profiles.nom || ''}`.trim() || s.reservations.profiles.email
            : 'Visiteur',
          espace_nom: s.reservations?.espaces?.nom || 'Espace',
          ...computeWorkSessionDetails(s, overtimeRate),
        };
      });

    const fallbackWalkins = (Array.isArray(settings.walkin_sessions) ? settings.walkin_sessions : [])
      .filter((w) => !w.check_out && w.statut !== 'completed')
      .map((w) => {
        const esp = espById.get(w.espace_id) || {};
        const bill = computeWalkinBilling({
          startedAt: w.started_at || w.check_in,
          tarifHoraireHT: esp.tarif_horaire_ht ?? computeHTFromTTC(esp.tarif_horaire || 0, esp.tva_pct ?? DEFAULT_TVA_PCT),
          tarifJournalierHT: esp.tarif_journalier_ht ?? computeHTFromTTC(esp.tarif_journalier || 0, esp.tva_pct ?? DEFAULT_TVA_PCT),
          tvaPct: esp.tva_pct ?? DEFAULT_TVA_PCT,
        });
        return {
          ...w,
          membre: w.client_nom || 'Client sur place',
          espace_nom: esp.nom || w.espace_nom || 'Espace',
          etat: 'en_cours',
          etat_label: 'Client sur place',
          is_walkin: true,
          walkin_estimate: bill,
          seconds_remaining: 0,
          overtime_seconds: 0,
          montant_depassement: 0,
        };
      });

    const live = [...sqlLive, ...fallbackWalkins];

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

    const nowIso = new Date().toISOString();
    res.json({
      server_now: nowIso,
      live_sessions: [...live, ...upcoming],
      auto_closed_alerts: autoClosedAlerts,
      counts: {
        total_open: live.length,
        en_cours: live.filter((s) => s.etat === 'en_cours').length,
        walkin: live.filter((s) => s.is_walkin).length,
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

// POST /api/sessions/start — Démarrage idempotent côté serveur (réservé accueil/staff, bloqué au membre)
async function startSession(req, res) {
  try {
    const { reservation_id, idempotency_key } = req.body || {};
    if (!reservation_id) {
      return res.status(400).json({ error: 'reservation_id est requis.' });
    }
    const isStaff = ['super_admin', 'admin', 'staff'].includes(req.profile?.role);
    if (!isStaff) {
      return res.status(403).json({
        error: "Vous ne pouvez pas démarrer votre session vous-même. Présentez votre QR code à l'accueil.",
      });
    }
    const { data: reservation, error: resErr } = await supabaseAdmin
      .from('reservations')
      .select('*, espaces(id, nom, type, tenant_id)')
      .eq('id', reservation_id)
      .single();
    if (resErr || !reservation) return res.status(404).json({ error: 'Réservation introuvable.' });

    const nowIso = new Date().toISOString();
    const { data: existing } = await supabaseAdmin
      .from('sessions')
      .select('*, reservations(id, date_debut, date_fin, statut, espaces(nom, type))')
      .eq('reservation_id', reservation_id)
      .is('check_out', null)
      .maybeSingle();

    if (existing) {
      return res.json({
        already_started: true,
        server_now: nowIso,
        session: { ...existing, started_at: existing.started_at || existing.check_in },
      });
    }

    const remaining = computeRemainingMinutes(reservation.date_fin);
    const payload = {
      tenant_id: reservation.tenant_id || req.tenantId || null,
      espace_id: reservation.espace_id,
      unite_id: reservation.unite_id || null,
      reservation_id,
      started_at: nowIso,
      check_in: nowIso,
      statut: 'active',
      temps_restant: remaining,
      ...(idempotency_key ? { idempotency_key: String(idempotency_key) } : {}),
    };

    const { data: created, error: insErr } = await insertWithColumnFallback(
      supabaseAdmin,
      'sessions',
      payload,
      { select: '*, reservations(id, date_debut, date_fin, statut, espaces(nom, type))' }
    );
    if (insErr) return res.status(400).json({ error: insErr.message });

    await logActivity({
      tenantId: reservation.tenant_id || req.tenantId,
      req,
      action: 'demarrage_session',
      entityType: 'session',
      entityId: created.id,
      entityLabel: reservation.espaces?.nom || 'Session',
    });

    emitSessionStarted({
      id: created.id,
      user_id: reservation.user_id,
      reservation_id,
      check_in: created.check_in,
      started_at: created.started_at || created.check_in,
      temps_restant: remaining,
      espace: reservation.espaces,
    });

    res.status(201).json({
      server_now: nowIso,
      session: { ...created, started_at: created.started_at || created.check_in },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/sessions/walkin/start — Client sur place sans réservation + chrono serveur
async function startWalkinSession(req, res) {
  try {
    const tid = req.tenantId;
    if (!tid) return res.status(400).json({ error: 'Établissement requis.' });

    const { nom, prenom = '', telephone, espace_id, unite_id = null, idempotency_key = null } = req.body || {};
    if (!nom || !espace_id || !telephone) {
      return res.status(400).json({ error: 'Nom, téléphone (+216) et espace sont obligatoires.' });
    }

    const phone = normalizePhoneTN(telephone);
    if (!phone) {
      return res.status(400).json({ error: 'Numéro invalide : saisissez +216 suivi de 8 chiffres.' });
    }

    const nowIso = new Date().toISOString();

    // Idempotence : vérifier idempotency_key ou walk-in déjà ouvert sur la même unité
    if (idempotency_key) {
      const { data: dupSql } = await supabaseAdmin
        .from('sessions')
        .select('*')
        .eq('tenant_id', tid)
        .eq('idempotency_key', String(idempotency_key))
        .maybeSingle()
        .catch(() => ({ data: null }));
      if (dupSql) {
        return res.json({ already_started: true, server_now: nowIso, session: dupSql });
      }
      const settings = await readTenantSettingsSafe(tid);
      const dupFb = (Array.isArray(settings.walkin_sessions) ? settings.walkin_sessions : [])
        .find((w) => w.idempotency_key === String(idempotency_key));
      if (dupFb) {
        return res.json({ already_started: true, server_now: nowIso, session: dupFb });
      }
    }

    // Dédoublonnage téléphone sur personnes / profiles / guests
    const [{ data: profs }, { data: gs }, persRes] = await Promise.all([
      supabaseAdmin.from('profiles').select('id, nom, prenom, email, telephone').eq('tenant_id', tid),
      supabaseAdmin.from('guests').select('id, nom, prenom, email, telephone').eq('tenant_id', tid),
      Promise.resolve(supabaseAdmin.from('personnes').select('*').eq('tenant_id', tid)).catch(() => ({ data: [] })),
    ]);

    let personneRecord = (persRes?.data || []).find((p) => normalizePhoneTN(p.telephone) === phone)
      || (profs || []).find((p) => normalizePhoneTN(p.telephone) === phone)
      || (gs || []).find((g) => normalizePhoneTN(g.telephone) === phone)
      || null;

    let duplicateReused = Boolean(personneRecord);
    if (!personneRecord) {
      const cleanEmail = `invite-${phone.replace('+', '')}@deskywork.local`;
      const newPers = {
        tenant_id: tid,
        type_personne: 'invite',
        nom: String(nom).trim(),
        prenom: String(prenom).trim(),
        telephone: phone,
        email: cleanEmail,
        created_at: nowIso,
      };
      const { data: persCreated, error: persErr } = await supabaseAdmin.from('personnes').insert(newPers).select().maybeSingle();
      if (!persErr && persCreated) {
        personneRecord = persCreated;
      } else {
        const { data: gCreated } = await insertWithColumnFallback(supabaseAdmin, 'guests', {
          tenant_id: tid,
          nom: String(nom).trim(),
          prenom: String(prenom).trim(),
          telephone: phone,
          email: cleanEmail,
        });
        personneRecord = gCreated || { id: crypto.randomUUID(), ...newPers };
        if (!gCreated) {
          const settings = await readTenantSettingsSafe(tid);
          const list = Array.isArray(settings.personnes) ? settings.personnes : [];
          await supabaseAdmin.from('tenants').update({
            settings: { ...settings, personnes: [personneRecord, ...list] },
          }).eq('id', tid);
        }
      }
    }

    const fullName = `${personneRecord.prenom || prenom || ''} ${personneRecord.nom || nom}`.trim();
    const { data: esp } = await supabaseAdmin.from('espaces').select('*').eq('id', espace_id).single();
    if (!esp) return res.status(404).json({ error: 'Espace introuvable.' });

    const sessionId = crypto.randomUUID();
    const rowPayload = {
      id: sessionId,
      tenant_id: tid,
      espace_id,
      unite_id: unite_id || null,
      started_at: nowIso,
      check_in: nowIso,
      statut: 'active',
      temps_restant: 0,
      is_walkin: true,
      client_nom: fullName,
      client_telephone: phone,
      personne_id: personneRecord.id || null,
      ...(idempotency_key ? { idempotency_key: String(idempotency_key) } : {}),
    };

    let createdSession = null;
    const { data: sqlRow, error: sqlErr } = await supabaseAdmin.from('sessions').insert(rowPayload).select().maybeSingle();
    if (!sqlErr && sqlRow && sqlRow.is_walkin !== undefined) {
      createdSession = sqlRow;
    } else {
      // Fallback structuré dans tenants.settings.walkin_sessions
      const settings = await readTenantSettingsSafe(tid);
      const list = Array.isArray(settings.walkin_sessions) ? settings.walkin_sessions : [];
      createdSession = { ...rowPayload, espace_nom: esp.nom };
      await saveWalkinFallback(tid, [createdSession, ...list]);
    }

    await logActivity({
      tenantId: tid,
      req,
      action: 'demarrage_walkin',
      entityType: 'session',
      entityId: createdSession.id,
      entityLabel: `${fullName} · ${esp.nom}`,
      afterData: { telephone: phone, espace_id, unite_id, duplicate_reused: duplicateReused },
    });

    res.status(201).json({
      server_now: nowIso,
      session: createdSession,
      personne: personneRecord,
      duplicate_reused: duplicateReused,
      espace: esp,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/sessions/:id/stop — Arrêt idempotent + calcul Walk-in (15min / min 1h / plafond jour) ou Overtime 15min
async function stopSession(req, res) {
  try {
    const { id } = req.params;
    const { encaisser_maintenant = false, mode_paiement = 'cash' } = req.body || {};
    const tid = req.tenantId;
    const nowIso = new Date().toISOString();

    // 1. Chercher en base SQL
    const { data: sqlSess } = await supabaseAdmin
      .from('sessions')
      .select('*, reservations(id, user_id, guest_id, espace_id, tenant_id, date_debut, date_fin, espaces(id, nom, type, tarif_horaire, tarif_horaire_ht, tarif_journalier, tarif_journalier_ht, tva_pct))')
      .eq('id', id)
      .maybeSingle();

    if (sqlSess) {
      if (sqlSess.check_out && sqlSess.statut === 'completed') {
        return res.json({ already_stopped: true, session: sqlSess, server_now: nowIso });
      }
      const effectiveTid = sqlSess.tenant_id || sqlSess.reservations?.tenant_id || tid;

      if (sqlSess.is_walkin) {
        const { data: esp } = await supabaseAdmin.from('espaces').select('*').eq('id', sqlSess.espace_id).maybeSingle();
        const bill = computeWalkinBilling({
          startedAt: sqlSess.started_at || sqlSess.check_in,
          stoppedAt: nowIso,
          tarifHoraireHT: esp?.tarif_horaire_ht ?? computeHTFromTTC(esp?.tarif_horaire || 0, esp?.tva_pct ?? DEFAULT_TVA_PCT),
          tarifJournalierHT: esp?.tarif_journalier_ht ?? computeHTFromTTC(esp?.tarif_journalier || 0, esp?.tva_pct ?? DEFAULT_TVA_PCT),
          tvaPct: esp?.tva_pct ?? DEFAULT_TVA_PCT,
        });

        await supabaseAdmin
          .from('sessions')
          .update({
            check_out: nowIso,
            stopped_at: nowIso,
            statut: 'completed',
            temps_restant: 0,
            tranches_15min: bill.billedSlices,
            montant_calcule_ht: bill.montantHT,
            montant_calcule_ttc: bill.montantTTC,
          })
          .eq('id', id)
          .catch(() => supabaseAdmin.from('sessions').update({ check_out: nowIso, statut: 'completed', temps_restant: 0 }).eq('id', id));

        let paiement = null;
        if (bill.montantTTC > 0) {
          const validModes = ['cash', 'check', 'bank_transfer', 'card'];
          const { data: payRow } = await supabaseAdmin
            .from('paiements')
            .insert({
              user_id: sqlSess.personne_id || null,
              montant: bill.montantTTC,
              mode: validModes.includes(mode_paiement) ? mode_paiement : 'cash',
              statut: encaisser_maintenant ? 'paid' : 'pending',
              ...(encaisser_maintenant ? { date_paiement: nowIso, montant_encaisse: bill.montantTTC } : {}),
              tenant_id: effectiveTid,
              reference_externe: `WALKIN-${bill.billedSlices}T`,
            })
            .select('*')
            .maybeSingle();
          paiement = payRow || null;
        }

        await logActivity({
          tenantId: effectiveTid,
          req,
          action: 'arret_walkin',
          entityType: 'session',
          entityId: id,
          entityLabel: `${sqlSess.client_nom || 'Client sur place'} (${bill.montantTTC.toFixed(3)} DT TTC)`,
          afterData: bill,
        });

        return res.json({
          server_now: nowIso,
          session: { ...sqlSess, check_out: nowIso, stopped_at: nowIso, statut: 'completed' },
          billing: bill,
          paiement,
        });
      }

      // Session liée à une réservation : arrêt + dépassement 15 min
      const overtimeRate = await getTenantOvertimeRate(effectiveTid);
      const esp = sqlSess.reservations?.espaces || {};
      const overtime = computeOvertime15Min({
        dateFin: sqlSess.reservations?.date_fin || nowIso,
        nowOrStop: nowIso,
        tarifHoraireTTC: overtimeRate != null ? overtimeRate : Number(esp.tarif_horaire || 0),
        tvaPct: Number(esp.tva_pct ?? DEFAULT_TVA_PCT),
      });

      const { data: updSess } = await supabaseAdmin
        .from('sessions')
        .update({
          check_out: nowIso,
          stopped_at: nowIso,
          statut: 'completed',
          temps_restant: 0,
          overtime_tranches_15min: overtime.slices15Min,
          overtime_montant_ttc: overtime.montantTTC,
        })
        .eq('id', id)
        .select('*')
        .maybeSingle()
        .catch(async () => supabaseAdmin.from('sessions').update({ check_out: nowIso, statut: 'completed', temps_restant: 0 }).eq('id', id).select('*').maybeSingle());

      if (sqlSess.reservation_id) {
        await supabaseAdmin.from('reservations').update({ statut: 'completed' }).eq('id', sqlSess.reservation_id).catch(() => {});
      }

      let overtimePay = null;
      if (overtime.montantTTC > 0 && sqlSess.reservations?.user_id) {
        const { data: pRow } = await supabaseAdmin
          .from('paiements')
          .insert({
            user_id: sqlSess.reservations.user_id,
            reservation_id: sqlSess.reservation_id,
            montant: overtime.montantTTC,
            mode: 'cash',
            statut: encaisser_maintenant ? 'paid' : 'pending',
            ...(encaisser_maintenant ? { date_paiement: nowIso, montant_encaisse: overtime.montantTTC } : {}),
            tenant_id: effectiveTid,
            reference_externe: `DEPASSEMENT-${overtime.slices15Min}T`,
          })
          .select('*')
          .maybeSingle();
        overtimePay = pRow || null;
      }

      emitSessionEnded({
        id,
        user_id: sqlSess.reservations?.user_id,
        reservation_id: sqlSess.reservation_id,
        check_out: nowIso,
        statut: 'completed',
        espace: esp,
      });

      return res.json({
        server_now: nowIso,
        session: updSess || { ...sqlSess, check_out: nowIso, statut: 'completed' },
        overtime,
        paiement: overtimePay,
      });
    }

    // 2. Chercher dans fallback walkin_sessions
    if (tid) {
      const settings = await readTenantSettingsSafe(tid);
      const walkins = Array.isArray(settings.walkin_sessions) ? settings.walkin_sessions : [];
      const idx = walkins.findIndex((w) => w.id === id);
      if (idx >= 0) {
        const w = walkins[idx];
        if (w.check_out && w.statut === 'completed') {
          return res.json({ already_stopped: true, session: w, server_now: nowIso });
        }
        const { data: esp } = await supabaseAdmin.from('espaces').select('*').eq('id', w.espace_id).maybeSingle();
        const bill = computeWalkinBilling({
          startedAt: w.started_at || w.check_in,
          stoppedAt: nowIso,
          tarifHoraireHT: esp?.tarif_horaire_ht ?? computeHTFromTTC(esp?.tarif_horaire || 0, esp?.tva_pct ?? DEFAULT_TVA_PCT),
          tarifJournalierHT: esp?.tarif_journalier_ht ?? computeHTFromTTC(esp?.tarif_journalier || 0, esp?.tva_pct ?? DEFAULT_TVA_PCT),
          tvaPct: esp?.tva_pct ?? DEFAULT_TVA_PCT,
        });
        const updated = {
          ...w,
          check_out: nowIso,
          stopped_at: nowIso,
          statut: 'completed',
          tranches_15min: bill.billedSlices,
          montant_calcule_ht: bill.montantHT,
          montant_calcule_ttc: bill.montantTTC,
        };
        const nextList = [...walkins];
        nextList[idx] = updated;
        await saveWalkinFallback(tid, nextList);

        let paiement = null;
        if (bill.montantTTC > 0) {
          const validModes = ['cash', 'check', 'bank_transfer', 'card'];
          const { data: payRow } = await supabaseAdmin
            .from('paiements')
            .insert({
              user_id: w.personne_id || null,
              montant: bill.montantTTC,
              mode: validModes.includes(mode_paiement) ? mode_paiement : 'cash',
              statut: encaisser_maintenant ? 'paid' : 'pending',
              ...(encaisser_maintenant ? { date_paiement: nowIso, montant_encaisse: bill.montantTTC } : {}),
              tenant_id: tid,
              reference_externe: `WALKIN-${bill.billedSlices}T`,
            })
            .select('*')
            .maybeSingle();
          paiement = payRow || null;
        }

        await logActivity({
          tenantId: tid,
          req,
          action: 'arret_walkin',
          entityType: 'session',
          entityId: id,
          entityLabel: `${w.client_nom || 'Client sur place'} (${bill.montantTTC.toFixed(3)} DT TTC)`,
          afterData: bill,
        });

        return res.json({ server_now: nowIso, session: updated, billing: bill, paiement });
      }
    }

    return res.status(404).json({ error: 'Session introuvable.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/sessions/:id/extend — Prolongation 1 clic facturable (+15/+30/+60 membre) si créneau suivant libre
async function extendSession(req, res) {
  try {
    const { id } = req.params;
    const isStaff = ['super_admin', 'admin', 'staff'].includes(req.profile?.role);
    const requestedMin = parseInt(req.body?.minutes, 10) || 30;
    if (!isStaff && ![15, 30, 60].includes(requestedMin)) {
      return res.status(400).json({ error: 'Durée de prolongation membre autorisée : 15, 30 ou 60 minutes.' });
    }
    const minutes = Math.max(15, Math.min(240, requestedMin));

    const { data: sess, error: sErr } = await supabaseAdmin
      .from('sessions')
      .select('*, reservations(*, espaces(*))')
      .eq('id', id)
      .maybeSingle();

    if (sErr || !sess || !sess.reservations) {
      return res.status(404).json({ error: 'Session liée à une réservation introuvable.' });
    }

    const resRow = sess.reservations;
    if (!isStaff && resRow.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Action non autorisée.' });
    }

    const tid = resRow.tenant_id || req.tenantId || resRow.espaces?.tenant_id;
    const tamponMinutes = await getTenantTamponMinutes(supabaseAdmin, tid);
    const units = tid ? await loadSpaceUnitsForTenant(supabaseAdmin, tid, resRow.espace_id) : [];
    const targetUnite = resRow.unite_id ? units.find((u) => u.id === resRow.unite_id) : null;
    const oldEndMs = new Date(resRow.date_fin).getTime();
    const newEndIso = new Date(oldEndMs + minutes * 60 * 1000).toISOString();

    const avail = await checkAvailabilityWithBuffer({
      supabaseAdmin,
      tenantId: tid,
      espace: resRow.espaces || { id: resRow.espace_id, type: 'open_space', capacite: 1, nom: 'Espace' },
      unite: targetUnite,
      dateDebut: resRow.date_fin,
      dateFin: newEndIso,
      tamponMinutes,
      excludeReservationId: resRow.id,
      excludeUserId: req.user.id,
    });
    if (!avail.isAvailable) {
      return res.status(409).json({
        error: avail.reason || 'Impossible de prolonger : créneau suivant déjà réservé.',
        conflict: true,
        alternatives: avail.alternatives,
      });
    }

    const tva = Number(resRow.tva_pct_applique ?? resRow.espaces?.tva_pct ?? DEFAULT_TVA_PCT);
    const tarifTTC = roundMillime(resRow.espaces?.tarif_horaire || 0);
    const tarifHT = resRow.tarif_applique_ht != null
      ? roundMillime(resRow.tarif_applique_ht)
      : (resRow.espaces?.tarif_horaire_ht != null ? roundMillime(resRow.espaces.tarif_horaire_ht) : computeHTFromTTC(tarifTTC, tva));
    const supplementHT = roundMillime((minutes / 60) * tarifHT);
    const supplementTTC = computeTTC(supplementHT, tva);

    await supabaseAdmin
      .from('reservations')
      .update({
        date_fin: newEndIso,
        montant_ht: roundMillime(Number(resRow.montant_ht || 0) + supplementHT),
        montant_ttc: roundMillime(Number(resRow.montant_ttc ?? resRow.montant_total ?? 0) + supplementTTC),
        montant_total: roundMillime(Number(resRow.montant_total || 0) + supplementTTC),
      })
      .eq('id', resRow.id)
      .catch(() => supabaseAdmin.from('reservations').update({ date_fin: newEndIso }).eq('id', resRow.id));

    await supabaseAdmin
      .from('sessions')
      .update({ temps_restant: computeRemainingMinutes(newEndIso), statut: 'active' })
      .eq('id', id);

    let paiement = null;
    if (supplementTTC > 0 && resRow.user_id) {
      const { data: pRow } = await supabaseAdmin
        .from('paiements')
        .insert({
          user_id: resRow.user_id,
          reservation_id: resRow.id,
          montant: supplementTTC,
          mode: 'cash',
          statut: 'pending',
          tenant_id: tid,
          reference_externe: `PROLONGATION-${minutes}MIN`,
        })
        .select('*')
        .maybeSingle();
      paiement = pRow || null;
    }

    await logActivity({
      tenantId: tid,
      req,
      action: 'prolongation_session',
      entityType: 'session',
      entityId: id,
      entityLabel: `+${minutes} min (${supplementTTC.toFixed(3)} DT TTC)`,
      afterData: { date_fin: newEndIso, supplement_ht: supplementHT, supplement_ttc: supplementTTC },
    });

    if (!isStaff && tid) {
      const { data: admins } = await supabaseAdmin.from('profiles').select('id').eq('tenant_id', tid).in('role', ['admin', 'staff']);
      const memberName = `${req.profile?.prenom || ''} ${req.profile?.nom || ''}`.trim() || 'Membre';
      for (const adm of admins || []) {
        await supabaseAdmin.from('notifications').insert({
          user_id: adm.id,
          type: 'prolongation_session',
          canal: 'Dashboard',
          lu: false,
          message: `${memberName} a prolongé sa session (${resRow.espaces?.nom || 'Espace'}) de +${minutes} min (${supplementTTC.toFixed(3)} DT TTC à régler sur place). [Lien: /admin/reservations]`,
        }).catch(() => {});
      }
    }

    res.json({
      server_now: new Date().toISOString(),
      reservation_id: resRow.id,
      date_fin: newEndIso,
      supplement_ht: supplementHT,
      supplement_ttc: supplementTTC,
      paiement,
      message: `Session prolongée de ${minutes} min (+${supplementTTC.toFixed(3)} DT TTC à régler sur place).`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// PATCH /api/sessions/:id/adjust — Correction tracée par le staff (après arrêt membre ou oubli)
async function adjustSession(req, res) {
  try {
    const { id } = req.params;
    const { check_out, montant_override_ttc, motif } = req.body || {};
    if (!String(motif || '').trim()) {
      return res.status(400).json({ error: 'Un motif de correction est obligatoire.' });
    }

    const { data: sess, error: sErr } = await supabaseAdmin
      .from('sessions')
      .select('*, reservations(id, user_id, tenant_id, date_debut, date_fin, espaces(id, nom, tarif_horaire, tva_pct))')
      .eq('id', id)
      .maybeSingle();

    if (sErr || !sess) {
      return res.status(404).json({ error: 'Session introuvable.' });
    }

    const resTenant = sess.tenant_id || sess.reservations?.tenant_id || req.tenantId || null;
    const nowIso = new Date().toISOString();
    const effectiveCheckOut = check_out ? new Date(check_out).toISOString() : (sess.check_out || nowIso);

    const esp = sess.reservations?.espaces || {};
    const overtimeRate = await getTenantOvertimeRate(resTenant);
    const effectiveRate = overtimeRate != null ? Number(overtimeRate) : Number(esp.tarif_horaire || 0);
    const overtime = computeOvertime15Min({
      dateFin: sess.reservations?.date_fin || effectiveCheckOut,
      nowOrStop: effectiveCheckOut,
      tarifHoraireTTC: effectiveRate,
      tvaPct: Number(esp.tva_pct ?? DEFAULT_TVA_PCT),
    });

    const finalOvertimeTTC = montant_override_ttc !== undefined && montant_override_ttc !== null
      ? roundMillime(montant_override_ttc)
      : overtime.montantTTC;

    const patch = {
      check_out: effectiveCheckOut,
      stopped_at: effectiveCheckOut,
      overtime_tranches_15min: overtime.slices15Min,
      overtime_montant_ttc: finalOvertimeTTC,
      staff_adjusted_at: nowIso,
      staff_adjusted_by: req.user.id,
      staff_adjustment_reason: String(motif).trim(),
    };

    let { data: updated, error: updErr } = await supabaseAdmin
      .from('sessions')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();

    if (updErr && /column|does not exist|schema cache/i.test(updErr.message || '')) {
      ({ data: updated, error: updErr } = await supabaseAdmin
        .from('sessions')
        .update({ check_out: effectiveCheckOut })
        .eq('id', id)
        .select('*')
        .single());
    }
    if (updErr) return res.status(400).json({ error: updErr.message });

    if (sess.reservation_id) {
      await supabaseAdmin
        .from('paiements')
        .update({ montant: finalOvertimeTTC })
        .eq('reservation_id', sess.reservation_id)
        .eq('statut', 'pending')
        .ilike('reference_externe', 'DEPASSEMENT-%')
        .catch(() => {});
    }

    await logActivity({
      tenantId: resTenant,
      req,
      action: 'correction_session',
      entityType: 'session',
      entityId: id,
      entityLabel: `${esp.nom || 'Session'} (${finalOvertimeTTC.toFixed(3)} DT TTC)`,
      beforeData: { check_out: sess.check_out, overtime_montant_ttc: sess.overtime_montant_ttc },
      afterData: { check_out: effectiveCheckOut, overtime_montant_ttc: finalOvertimeTTC, motif: String(motif).trim() },
    });

    res.json({
      server_now: nowIso,
      session: updated,
      overtime_montant_ttc: finalOvertimeTTC,
      message: 'Session ajustée et journalisée.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/sessions/auto-close-sweep
async function autoCloseSweep(req, res) {
  try {
    const alerts = await runAutoCloseSweepForTenant(req.tenantId, req);
    res.json({ server_now: new Date().toISOString(), auto_closed_alerts: alerts });
  } catch (err) {
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
  startSession,
  startWalkinSession,
  stopSession,
  extendSession,
  adjustSession,
  autoCloseSweep,
};
