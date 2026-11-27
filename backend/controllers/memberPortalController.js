// controllers/memberPortalController.js — MODULE E : Portail Membre (Historique, Stats, Notifs, Settings)
const { supabaseAdmin } = require('../config/supabase');
const { sweepPastConfirmedReservations } = require('../models/bookingAvailability');
const { computeTenantLiveAvailability } = require('../models/availabilitySummary');

// ── GET /api/bookings/history ─────────────────────────────────────────────
async function bookingsHistory(req, res) {
  await sweepPastConfirmedReservations(supabaseAdmin, { userId: req.user.id }).catch(() => {});
  const { page = 1, limit = 10, statut } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = supabaseAdmin
    .from('reservations')
    .select(`
      *,
      espaces (id, nom, type, tarif_horaire),
      profiles!user_id (nom, prenom, email),
      paiements (id, statut, mode, montant)
    `, { count: 'exact' })
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (statut) query = query.eq('statut', statut);

  const { data: rawData, error, count } = await query.range(offset, offset + parseInt(limit) - 1);
  if (error) return res.status(500).json({ error: error.message });

  const { data: allBookings } = await supabaseAdmin
    .from('reservations')
    .select('id, statut, date_debut, date_fin, espaces(tarif_horaire)')
    .eq('user_id', req.user.id);

  let totalHours = 0;
  let totalSpent = 0;

  (allBookings || []).forEach(b => {
    let hours = 0;
    if (b.date_debut && b.date_fin) {
      hours = Math.max(0, (new Date(b.date_fin) - new Date(b.date_debut)) / (1000 * 60 * 60));
    }
    if (b.statut !== 'cancelled') {
      totalHours += hours;
      const tarif = parseFloat(b.espaces?.tarif_horaire) || 0;
      totalSpent += (hours * tarif);
    }
  });

  const enrichedBookings = (rawData || []).map(b => {
    let hours = 0;
    if (b.date_debut && b.date_fin) {
      hours = Math.max(0, (new Date(b.date_fin) - new Date(b.date_debut)) / (1000 * 60 * 60));
    }
    const tarif = parseFloat(b.espaces?.tarif_horaire) || 0;
    const computedCost = parseFloat((hours * tarif).toFixed(3));
    return {
      ...b,
      montant_total: computedCost,
    };
  });

  const stats = {
    total: allBookings?.length || 0,
    confirmed: allBookings?.filter(b => b.statut === 'confirmed').length || 0,
    pending: allBookings?.filter(b => b.statut === 'pending').length || 0,
    cancelled: allBookings?.filter(b => b.statut === 'cancelled').length || 0,
    completed: allBookings?.filter(b => b.statut === 'completed').length || 0,
    totalHours: totalHours.toFixed(1),
    totalSpent: totalSpent.toFixed(3),
  };

  res.json({
    bookings: enrichedBookings,
    stats,
    pagination: { page: parseInt(page), limit: parseInt(limit), total: count || 0, totalPages: Math.ceil((count || 0) / parseInt(limit)) },
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
      supabaseAdmin.from('reservations').select('tenant_id, espaces(tenant_id)').eq('user_id', userId),
    ]);

    const tenantById = new Map((tenants || []).map((t) => [t.id, t]));
    const tenantFreq = {};
    (memberBookings || []).forEach((b) => {
      const tid = b.tenant_id || b.espaces?.tenant_id;
      if (tid) tenantFreq[tid] = (tenantFreq[tid] || 0) + 1;
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
          proche: tenant.id === homeTenantId || !!tenantFreq[tenant.id],
          coworking: { nom: tenant.nom, ville: tenant.ville, adresse: tenant.adresse, pays: tenant.pays },
        });
      }
    }

    spaces.sort((a, b) => {
      if (a.disponible !== b.disponible) return a.disponible ? -1 : 1;
      if (!!a.proche !== !!b.proche) return a.proche ? -1 : 1;
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
