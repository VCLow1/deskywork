// controllers/memberPortalController.js — MODULE E : Portail Membre (Historique, Stats, Notifs, Settings)
const { supabaseAdmin } = require('../config/supabase');
const { sweepPastConfirmedReservations } = require('../models/bookingAvailability');
const { computeTenantLiveAvailability } = require('../models/availabilitySummary');
const { roundMillime } = require('../models/pricingMath');

function getTunisYearMonth(dateInput = new Date()) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Tunis',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(d);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    if (y && m) return `${y}-${m}`;
  } catch (_) {}
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ── GET /api/bookings/history ─────────────────────────────────────────────
async function bookingsHistory(req, res) {
  await sweepPastConfirmedReservations(supabaseAdmin, { userId: req.user.id }).catch(() => {});
  const { page = 1, limit = 10, statut, tab } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));

  const { data: rawBookings, error } = await supabaseAdmin
    .from('reservations')
    .select(`
      *,
      espaces (id, nom, type, tarif_horaire, tenant_id),
      profiles!user_id (nom, prenom, email),
      paiements (id, statut, mode, montant, total_du, montant_paye, reste_a_payer)
    `)
    .eq('user_id', req.user.id)
    .order('date_debut', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const allRows = (rawBookings || []).filter((r) => !r.archived_at);
  const resIds = allRows.map((r) => r.id);
  const tenantIds = Array.from(new Set(allRows.map((r) => r.tenant_id || r.espaces?.tenant_id).filter(Boolean)));

  const [sessRes, tenantRowsRes] = await Promise.all([
    resIds.length > 0
      ? supabaseAdmin
          .from('sessions')
          .select('id, reservation_id, started_at, check_in, check_out, statut')
          .in('reservation_id', resIds)
      : { data: [] },
    tenantIds.length > 0
      ? supabaseAdmin.from('tenants').select('id, nom, settings').in('id', tenantIds)
      : { data: [] },
  ]);

  const activeSessionByRes = new Map();
  const anySessionByRes = new Map();
  for (const s of sessRes?.data || []) {
    if (!anySessionByRes.has(s.reservation_id)) anySessionByRes.set(s.reservation_id, s);
    if (!s.check_out && ['active', 'overtime'].includes(s.statut) && (s.started_at || s.check_in)) {
      activeSessionByRes.set(s.reservation_id, s);
    }
  }

  const refusalByRes = {};
  const payMetaById = {};
  const tenantNameById = new Map();
  for (const t of tenantRowsRes?.data || []) {
    tenantNameById.set(t.id, t.nom);
    const rr = t.settings?.reservation_refusal_reasons;
    if (rr && typeof rr === 'object') {
      Object.assign(refusalByRes, rr);
    }
    const pm = t.settings?.payment_meta;
    if (pm && typeof pm === 'object') {
      Object.assign(payMetaById, pm);
    }
  }

  const nowMs = Date.now();
  const currentMonthKey = getTunisYearMonth(new Date(nowMs));

  let upcomingCount = 0;
  let hoursThisMonth = 0;
  let totalPaid = 0;
  let totalRemaining = 0;
  const tabCounts = { upcoming: 0, ongoing: 0, past: 0, cancelled_refused: 0 };

  const enrichedAll = allRows.map((b) => {
    const startMs = b.date_debut ? new Date(b.date_debut).getTime() : NaN;
    const endMs = b.date_fin ? new Date(b.date_fin).getTime() : NaN;
    const hours = Number.isFinite(startMs) && Number.isFinite(endMs)
      ? Math.max(0, (endMs - startMs) / (1000 * 60 * 60))
      : 0;
    const tarif = parseFloat(b.espaces?.tarif_horaire) || 0;
    const montantTotal = roundMillime(b.montant_ttc ?? b.montant_total ?? (hours * tarif));

    const payList = Array.isArray(b.paiements) ? b.paiements : [];
    let paidForBooking = 0;
    let remainingForBooking = 0;
    for (const p of payList) {
      const meta = payMetaById[p.id] || {};
      const st = meta.logical_status && p.statut === 'pending' ? meta.logical_status : p.statut;
      if (st === 'paid') {
        paidForBooking = roundMillime(paidForBooking + Number(p.montant || 0));
      } else if (st === 'partial') {
        const resteP = Number(p.reste_a_payer ?? meta.reste_a_payer ?? p.montant ?? 0);
        remainingForBooking = roundMillime(remainingForBooking + resteP);
      } else if (st === 'pending') {
        remainingForBooking = roundMillime(remainingForBooking + Number(p.reste_a_payer ?? meta.reste_a_payer ?? p.montant ?? 0));
      }
    }

    const isCancelledOrRefused = b.statut === 'cancelled' || b.statut === 'refused';
    if (!isCancelledOrRefused && payList.length === 0 && montantTotal > 0) {
      remainingForBooking = montantTotal;
    }
    if (isCancelledOrRefused) {
      // Seules les pénalités explicitement maintenues en attente comptent dans remaining
      remainingForBooking = roundMillime(
        payList
          .filter((p) => p.statut === 'pending' && String(p.reference_externe || '').toUpperCase().startsWith('PENALITE'))
          .reduce((s, p) => s + Number(p.montant || 0), 0)
      );
    }

    const activeSess = activeSessionByRes.get(b.id) || null;
    const anySess = anySessionByRes.get(b.id) || null;
    const hasStarted = Boolean(activeSess || anySess?.check_in || (Number.isFinite(startMs) && startMs <= nowMs));

    let tabBucket = 'past';
    if (isCancelledOrRefused) {
      tabBucket = 'cancelled_refused';
    } else if (
      activeSess ||
      (['confirmed', 'pending', 'en_attente_confirmation'].includes(b.statut) &&
        Number.isFinite(startMs) &&
        Number.isFinite(endMs) &&
        startMs <= nowMs &&
        endMs > nowMs)
    ) {
      tabBucket = 'ongoing';
    } else if (
      ['confirmed', 'pending', 'en_attente_confirmation', 'waitlisted'].includes(b.statut) &&
      Number.isFinite(startMs) &&
      startMs > nowMs
    ) {
      tabBucket = 'upcoming';
    }

    tabCounts[tabBucket] = (tabCounts[tabBucket] || 0) + 1;
    if (tabBucket === 'upcoming') upcomingCount++;
    if (!isCancelledOrRefused && b.date_debut && getTunisYearMonth(b.date_debut) === currentMonthKey) {
      hoursThisMonth += hours;
    }
    totalPaid = roundMillime(totalPaid + paidForBooking);
    totalRemaining = roundMillime(totalRemaining + remainingForBooking);

    const tid = b.tenant_id || b.espaces?.tenant_id || null;
    const refusalReason =
      b.motif_refus ||
      refusalByRes[b.id] ||
      (b.statut === 'refused' ? (b.motif_annulation || null) : null);

    return {
      ...b,
      coworking_nom: tid ? (tenantNameById.get(tid) || null) : null,
      montant_total: montantTotal,
      montant_paye: paidForBooking,
      reste_a_payer: remainingForBooking,
      has_active_session: Boolean(activeSess),
      has_started: hasStarted,
      tab_bucket: tabBucket,
      motif_refus: refusalReason,
    };
  });

  let filteredList = enrichedAll;
  if (tab && ['upcoming', 'ongoing', 'past', 'cancelled_refused'].includes(tab)) {
    filteredList = filteredList.filter((b) => b.tab_bucket === tab);
  } else if (statut) {
    filteredList = filteredList.filter((b) => b.statut === statut);
  }

  // Tri : à venir & en cours du plus proche au plus lointain ; passées & annulées du plus récent au plus ancien
  if (tab === 'upcoming' || tab === 'ongoing') {
    filteredList = [...filteredList].sort((a, b) => new Date(a.date_debut) - new Date(b.date_debut));
  }

  const totalCount = filteredList.length;
  const offset = (pageNum - 1) * limitNum;
  const paginated = filteredList.slice(offset, offset + limitNum);

  const stats = {
    total: allRows.length,
    upcomingCount,
    hoursThisMonth: Number(hoursThisMonth.toFixed(1)),
    totalPaid,
    totalRemaining,
    tabCounts,
    confirmed: allRows.filter((b) => b.statut === 'confirmed').length,
    pending: allRows.filter((b) => b.statut === 'pending').length,
    cancelled: allRows.filter((b) => b.statut === 'cancelled').length,
    completed: allRows.filter((b) => b.statut === 'completed').length,
  };

  res.json({
    bookings: paginated,
    stats,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total: totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / limitNum)),
    },
  });
}

// ── GET /api/member/stats ─────────────────────────────────────────────────
async function memberStats(req, res) {
  const userId = req.user.id;
  await sweepPastConfirmedReservations(supabaseAdmin, { userId }).catch(() => {});

  const [bookingsRes, subsRes, paymentsRes] = await Promise.all([
    supabaseAdmin.from('reservations').select('id, statut, date_debut, date_fin, espaces(tarif_horaire)').eq('user_id', userId),
    supabaseAdmin.from('abonnements').select('id, statut, date_debut, date_fin, type_abonnement').eq('user_id', userId),
    supabaseAdmin.from('paiements').select('id, montant, statut, mode_paiement, created_at').eq('user_id', userId),
  ]);

  const bookings = bookingsRes.data || [];
  const subs = subsRes.data || [];
  const payments = paymentsRes.data || [];
  let totalHours = 0;
  let totalSpent = 0;

  bookings.forEach(b => {
    if (b.date_debut && b.date_fin) {
      const h = Math.max(0, (new Date(b.date_fin) - new Date(b.date_debut)) / (1000 * 60 * 60));
      if (b.statut !== 'cancelled') {
        totalHours += h;
        totalSpent += h * (parseFloat(b.espaces?.tarif_horaire) || 0);
      }
    }
  });

  const activeSub = subs.find(s => s.statut === 'active');

  res.json({
    bookings: {
      total: bookings.length,
      confirmed: bookings.filter(b => b.statut === 'confirmed').length,
      completed: bookings.filter(b => b.statut === 'completed').length,
      cancelled: bookings.filter(b => b.statut === 'cancelled').length,
      totalSpent: totalSpent.toFixed(3),
    },
    subscription: activeSub
      ? { type: activeSub.type_abonnement, active: true, date_fin: activeSub.date_fin, daysLeft: Math.max(0, Math.ceil((new Date(activeSub.date_fin) - new Date()) / (1000 * 60 * 60 * 24))) }
      : { active: false },
    payments: {
      total: payments.length,
      paid: payments.filter(p => p.statut === 'paid').length,
      pending: payments.filter(p => p.statut === 'pending').length,
      totalAmount: payments.filter(p => p.statut === 'paid').reduce((a, p) => a + (parseFloat(p.montant) || 0), 0).toFixed(3),
    },
    totalHours: totalHours.toFixed(1),
    memberSince: subs.length > 0 ? subs.sort((a, b) => new Date(a.date_debut) - new Date(b.date_debut))[0].date_debut : null,
  });
}

// ── GET /api/member/spaces-nearby ────────────────────────────────────────
async function spacesNearby(req, res) {
  try {
    const userId = req.user.id;

    const [{ data: prof }, { data: tenants }, { data: memberBookings }] = await Promise.all([
      supabaseAdmin.from('profiles').select('tenant_id').eq('id', userId).maybeSingle(),
      supabaseAdmin.from('tenants').select('id, nom, ville, adresse, pays, settings').eq('statut', 'actif'),
      supabaseAdmin
        .from('reservations')
        .select('id, espace_id, tenant_id, statut, date_fin, espaces(tenant_id)')
        .eq('user_id', userId),
    ]);

    const nowMs = Date.now();
    const tenantById = new Map((tenants || []).map((t) => [t.id, t]));
    const tenantFreq = {};
    const spacePastCount = {};
    (memberBookings || []).forEach((b) => {
      const tid = b.tenant_id || b.espaces?.tenant_id;
      if (tid) tenantFreq[tid] = (tenantFreq[tid] || 0) + 1;
      const isPast = b.date_fin && new Date(b.date_fin).getTime() <= nowMs;
      if (b.espace_id && isPast && !['cancelled', 'refused'].includes(b.statut)) {
        spacePastCount[b.espace_id] = (spacePastCount[b.espace_id] || 0) + 1;
      }
    });

    const homeTenantId = prof?.tenant_id && tenantById.has(prof.tenant_id) ? prof.tenant_id : null;
    const now = new Date();
    const windowEnd = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    // Source unique de vérité alignée sur `unites` (comme Tunnel étape 2 & Plan 2D)
    const targetTenants = homeTenantId
      ? [tenantById.get(homeTenantId)]
      : (tenants || []).slice(0, 6);

    const results = await Promise.all(
      targetTenants.map(async (t) => {
        const live = await computeTenantLiveAvailability(supabaseAdmin, {
          tenantId: t.id,
          rangeStartDate: now,
          rangeEndDate: windowEnd,
          isNow: true,
          excludeUserId: userId,
          tenantSettings: t.settings || {},
        });
        return { tenant: t, live };
      })
    );

    const spaces = [];
    let totalUnits = 0;
    let availableUnits = 0;
    let totalSpacesCount = 0;
    let freeSpacesCount = 0;

    for (const { tenant, live } of results) {
      totalUnits += live.summary.total_units || 0;
      availableUnits += live.summary.available_units || 0;
      totalSpacesCount += live.summary.total_spaces || 0;
      freeSpacesCount += live.summary.free_spaces || 0;

      for (const sp of live.spaces || []) {
        const pastCount = spacePastCount[sp.id] || 0;
        const isHabituel = pastCount >= 2;
        spaces.push({
          id: sp.id,
          tenant_id: sp.tenant_id,
          nom: sp.nom,
          type: sp.type,
          capacite: sp.capacite,
          tarif_horaire: sp.tarif_horaire,
          tarif_horaire_ht: sp.tarif_horaire_ht,
          tva_pct: sp.tva_pct,
          photo_url: sp.photo_url || null,
          disponible: sp.live_status === 'free' || sp.live_status === 'limited',
          live_status: sp.live_status,
          status_label: sp.status_label,
          places_restantes: sp.available_units ?? sp.remaining_spots,
          total_units: sp.total_units,
          available_units: sp.available_units,
          past_bookings_count: pastCount,
          habituel: isHabituel,
          proche: isHabituel,
          coworking: { nom: tenant.nom, ville: tenant.ville, adresse: tenant.adresse, pays: tenant.pays },
        });
      }
    }

    spaces.sort((a, b) => {
      if (a.disponible !== b.disponible) return a.disponible ? -1 : 1;
      if (!!a.habituel !== !!b.habituel) return a.habituel ? -1 : 1;
      return a.tarif_horaire - b.tarif_horaire;
    });

    res.json({
      home_tenant_id: homeTenantId,
      espaces: spaces.slice(0, 6),
      total: totalSpacesCount,
      disponibles: freeSpacesCount,
      total_units: totalUnits,
      available_units: availableUnits,
      heure: now.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/member/notifications ────────────────────────────────────────
async function listNotifications(req, res) {
  const { page = 1, limit = 20, unread_only } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = supabaseAdmin
    .from('notifications')
    .select('*', { count: 'exact' })
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });
  if (unread_only === 'true') query = query.eq('lu', false);

  const { data, error, count } = await query.range(offset, offset + parseInt(limit) - 1);
  if (error) return res.status(500).json({ error: error.message });

  const { count: unreadCount } = await supabaseAdmin
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', req.user.id)
    .eq('lu', false);

  const enrichedNotifications = (data || []).map((n) => {
    const match = typeof n.message === 'string' ? n.message.match(/\[Lien:\s*([^\]]+)\]\s*$/) : null;
    const targetUrl = n.target_url || n.metadata?.target_url || (match ? match[1].trim() : null);
    const cleanMessage = match ? n.message.replace(match[0], '').trim() : n.message;
    return {
      ...n,
      message: cleanMessage,
      target_url: targetUrl,
    };
  });

  res.json({
    notifications: enrichedNotifications,
    unreadCount: unreadCount || 0,
    pagination: { page: parseInt(page), limit: parseInt(limit), total: count || 0, totalPages: Math.ceil((count || 0) / parseInt(limit)) },
  });
}

// ── PATCH /api/member/notifications/:id/read ─────────────────────────────
async function markNotificationRead(req, res) {
  const { error } = await supabaseAdmin
    .from('notifications')
    .update({ lu: true })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
}

// ── POST /api/member/notifications/read-all ───────────────────────────────
async function markAllNotificationsRead(req, res) {
  const { error } = await supabaseAdmin
    .from('notifications')
    .update({ lu: true })
    .eq('user_id', req.user.id)
    .eq('lu', false);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
}

// ── PATCH /api/members/me/settings ───────────────────────────────────────
async function updateSettings(req, res) {
  const allowed = ['notif_email_reservations', 'notif_email_abonnements', 'notif_email_formations'];
  const updates = {};
  for (const field of allowed) { if (req.body[field] !== undefined) updates[field] = req.body[field]; }
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Aucune préférence fournie.' });
  const { data, error } = await supabaseAdmin.from('profiles').update(updates).eq('id', req.user.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ profile: data });
}

// ── GET /api/members/me/formations ───────────────────────────────────────
async function myFormations(req, res) {
  try {
    let { data, error } = await supabaseAdmin
      .from('inscriptions_formations')
      .select('*, formations (id, titre, date_debut, date_fin, statut, prix), paiements (id, mode, statut, montant)')
      .eq('membre_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error && (error.code === 'PGRST200' || /relationship|column/i.test(error.message))) {
      const fb = await supabaseAdmin
        .from('inscriptions_formations')
        .select('*')
        .or(`membre_id.eq.${req.user.id},user_id.eq.${req.user.id}`)
        .order('created_at', { ascending: false });
      data = fb.data || [];
      error = fb.error;
    }

    if (error) {
      console.warn('⚠️ myFormations warning:', error.message);
      return res.json({ inscriptions: [] });
    }

    res.json({ inscriptions: data || [] });
  } catch (err) {
    console.error('❌ myFormations error:', err);
    res.json({ inscriptions: [] });
  }
}

// ── GET /api/member/booking-recommendations ──────────────────────────────
async function bookingRecommendations(req, res) {
  try {
    const userId = req.user.id;
    const [profRes, resRes] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('tenant_id, ville, type_membre')
        .eq('id', userId)
        .maybeSingle(),
      supabaseAdmin
        .from('reservations')
        .select('id, date_debut, tenant_id, espaces(tenant_id, type)')
        .eq('user_id', userId)
        .neq('statut', 'cancelled')
        .order('date_debut', { ascending: false })
        .limit(50),
    ]);

    const profile = profRes?.data || {};
    const bookings = resRes?.data || [];

    const frequentTenants = {};
    const recentTenantIds = [];
    const seenTenants = new Set();
    const typeCounts = {};

    bookings.forEach((b) => {
      const tid = b.tenant_id || b.espaces?.tenant_id || null;
      if (tid) {
        frequentTenants[tid] = (frequentTenants[tid] || 0) + 1;
        if (!seenTenants.has(tid)) {
          seenTenants.add(tid);
          recentTenantIds.push(tid);
        }
      }
      const spType = b.espaces?.type;
      if (spType) {
        typeCounts[spType] = (typeCounts[spType] || 0) + 1;
      }
    });

    const favoriteSpaceTypes = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([type]) => type);

    res.json({
      home_tenant_id: profile.tenant_id || null,
      user_city: profile.ville || null,
      frequent_tenants: frequentTenants,
      recent_tenant_ids: recentTenantIds,
      favorite_space_types: favoriteSpaceTypes,
    });
  } catch (err) {
    console.error('❌ bookingRecommendations error:', err);
    res.json({
      home_tenant_id: null,
      user_city: null,
      frequent_tenants: {},
      recent_tenant_ids: [],
      favorite_space_types: [],
    });
  }
}

module.exports = {
  bookingsHistory,
  memberStats,
  spacesNearby,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  updateSettings,
  myFormations,
  bookingRecommendations,
};
