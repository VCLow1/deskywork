// controllers/memberPortalController.js — MODULE E : Portail Membre (Historique, Stats, Notifs, Settings)
const { supabaseAdmin } = require('../config/supabase');

// ── GET /api/bookings/history ─────────────────────────────────────────────
async function bookingsHistory(req, res) {
  const { page = 1, limit = 10, statut } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = supabaseAdmin
    .from('reservations')
    .select(`
      *,
      espaces (id, nom, type, tarif_horaire),
      profiles (nom, prenom, email),
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
    const computedCost = parseFloat((hours * tarif).toFixed(2));
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
    totalSpent: totalSpent.toFixed(2),
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
      totalSpent: totalSpent.toFixed(2),
    },
    subscription: activeSub
      ? { type: activeSub.type_abonnement, active: true, date_fin: activeSub.date_fin, daysLeft: Math.max(0, Math.ceil((new Date(activeSub.date_fin) - new Date()) / (1000 * 60 * 60 * 24))) }
      : { active: false },
    payments: {
      total: payments.length,
      paid: payments.filter(p => p.statut === 'paid').length,
      pending: payments.filter(p => p.statut === 'pending').length,
      totalAmount: payments.filter(p => p.statut === 'paid').reduce((a, p) => a + (parseFloat(p.montant) || 0), 0).toFixed(2),
    },
    totalHours: totalHours.toFixed(1),
    memberSince: subs.length > 0 ? subs.sort((a, b) => new Date(a.date_debut) - new Date(b.date_debut))[0].date_debut : null,
  });
}

// ── GET /api/member/spaces-nearby ────────────────────────────────────────
async function spacesNearby(req, res) {
  try {
    const userId = req.user.id;

    // Espaces des coworkings actifs (avec info coworking)
    const { data: tenants } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('statut', 'actif');
    const activeTenantIds = (tenants || []).map(t => t.id);

    let spaceQuery = supabaseAdmin
      .from('espaces')
      .select('id, nom, type, capacite, tarif_horaire, photo_url, tenant_id, tenants!tenant_id(nom, ville, adresse, pays, latitude, longitude)')
      .order('tarif_horaire', { ascending: true });
    if (activeTenantIds.length > 0) spaceQuery = spaceQuery.in('tenant_id', activeTenantIds);

    const { data: espaces, error: espErr } = await spaceQuery;
    if (espErr) return res.status(500).json({ error: espErr.message });

    // Coworking habituel : fréquence des réservations du membre par tenant
    const { data: memberBookings } = await supabaseAdmin
      .from('reservations')
      .select('espaces(tenant_id)')
      .eq('user_id', userId);
    const tenantFreq = {};
    (memberBookings || []).forEach(b => {
      const tid = b.espaces?.tenant_id;
      if (tid) tenantFreq[tid] = (tenantFreq[tid] || 0) + 1;
    });

    // Fenêtre « maintenant » (prochaine heure)
    const now = new Date();
    const windowEnd = new Date(now.getTime() + 60 * 60 * 1000);

    const [bookingsRes, formationsRes] = await Promise.all([
      supabaseAdmin
        .from('reservations')
        .select('espace_id')
        .in('statut', ['confirmed', 'pending'])
        .lt('date_debut', windowEnd.toISOString())
        .gt('date_fin', now.toISOString()),
      supabaseAdmin
        .from('formations')
        .select('espace_id')
        .in('statut', ['planifiee', 'en_cours'])
        .lt('date_debut', windowEnd.toISOString())
        .gt('date_fin', now.toISOString()),
    ]);

    const occupiedByBookings = {};
    (bookingsRes.data || []).forEach(r => {
      occupiedByBookings[r.espace_id] = (occupiedByBookings[r.espace_id] || 0) + 1;
    });
    const occupiedByFormations = new Set((formationsRes.data || []).map(f => f.espace_id));

    const spaces = (espaces || []).map(e => {
      const isExclusive = e.type !== 'open_space';
      const capacity = Math.max(1, parseInt(e.capacite, 10) || 1);
      const overlappingCount = occupiedByBookings[e.id] || 0;
      const blockedByFormation = occupiedByFormations.has(e.id);
      const remaining = isExclusive
        ? (overlappingCount > 0 ? 0 : 1)
        : Math.max(0, capacity - overlappingCount);
      const disponible = !blockedByFormation && remaining > 0;
      return {
        id: e.id,
        nom: e.nom,
        type: e.type,
        capacite: capacity,
        tarif_horaire: parseFloat(e.tarif_horaire) || 0,
        photo_url: e.photo_url || null,
        disponible,
        places_restantes: remaining,
        proche: !!tenantFreq[e.tenant_id],
        coworking: e.tenants
          ? { nom: e.tenants.nom, ville: e.tenants.ville, adresse: e.tenants.adresse, pays: e.tenants.pays }
          : null,
      };
    });

    spaces.sort((a, b) => {
      if (a.disponible !== b.disponible) return a.disponible ? -1 : 1;
      if (!!a.proche !== !!b.proche) return a.proche ? -1 : 1;
      return a.tarif_horaire - b.tarif_horaire;
    });

    res.json({
      espaces: spaces.slice(0, 6),
      total: spaces.length,
      disponibles: spaces.filter(s => s.disponible).length,
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

  res.json({
    notifications: data || [],
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
  const { data, error } = await supabaseAdmin
    .from('inscriptions_formations')
    .select('*, formations (id, titre, date_debut, date_fin, statut, prix_inscription, profiles!formateur_id (nom, prenom)), paiements (id, mode, statut, montant)')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ inscriptions: data });
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
};
