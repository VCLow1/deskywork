/**
 * routes/modulesHJKLN.js
 * MODULE H — Visiteurs & Guests
 * MODULE J — Politique annulation avancée + crédit portefeuille
 * MODULE K — Documents membres & contrats
 * MODULE L — RGPD
 * MODULE N — Multi-sites
 */
const express = require('express');
const { getBookingAvailability } = require('../models/helpers');

// ─── Factory : reçoit les dépendances au moment du require() ─────────────
module.exports = function createRouter({ supabaseAdmin, authenticate, requireRoles, applyTenantFilter }) {
  const router = express.Router();

// =========================================================================
// MODULE H — Visiteurs & Guests
// =========================================================================

// POST /api/guests — Créer/récupérer un guest (réservation sans compte)
router.post('/guests', async (req, res) => {
  const { nom, prenom, email, telephone, tenant_id } = req.body;
  if (!nom || !prenom || !email || !telephone) {
    return res.status(400).json({ error: 'nom, prenom, email et telephone sont requis.' });
  }

  try {
    // Chercher un guest existant (même email + tenant)
    let { data: existing } = await supabaseAdmin
      .from('guests')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .eq('tenant_id', tenant_id || null)
      .maybeSingle();

    if (existing) {
      // Mettre à jour nom/prénom/téléphone si nécessaire
      const { data: updated } = await supabaseAdmin
        .from('guests')
        .update({ nom, prenom, telephone, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select().single();
      return res.json({ guest: updated, created: false });
    }

    // Créer un nouveau guest
    const { data: guest, error } = await supabaseAdmin
      .from('guests')
      .insert({ nom, prenom, email: email.toLowerCase().trim(), telephone, tenant_id: tenant_id || null })
      .select().single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ guest, created: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/guests/booking — Réservation guest sans compte
router.post('/guests/booking', async (req, res) => {
  const { nom, prenom, email, telephone, espace_id, date_debut, date_fin, tenant_id } = req.body;
  if (!nom || !prenom || !email || !telephone || !espace_id || !date_debut || !date_fin) {
    return res.status(400).json({ error: 'Tous les champs sont requis.' });
  }
  if (new Date(date_debut) >= new Date(date_fin)) {
    return res.status(400).json({ error: 'date_fin doit être postérieure à date_debut.' });
  }

  try {
    const availability = await getBookingAvailability(espace_id, date_debut, date_fin);
    if (!availability.isAvailable) {
      return res.status(409).json({ error: availability.conflictMessage });
    }

    // Créer ou récupérer le guest
    let { data: guest } = await supabaseAdmin
      .from('guests')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .eq('tenant_id', tenant_id || null)
      .maybeSingle();

    if (!guest) {
      const { data: newGuest, error: gErr } = await supabaseAdmin
        .from('guests')
        .insert({ nom, prenom, email: email.toLowerCase().trim(), telephone, tenant_id: tenant_id || null })
        .select().single();
      if (gErr) return res.status(400).json({ error: gErr.message });
      guest = newGuest;
    }

    // Créer la réservation liée au guest (sans user_id)
    const { data: reservation, error: rErr } = await supabaseAdmin
      .from('reservations')
      .insert({
        user_id: null,
        guest_id: guest.id,
        tenant_id: tenant_id || null,
        espace_id,
        date_debut,
        date_fin,
        statut: 'pending',
        mode: 'online'
      })
      .select('*, espaces(nom, type)').single();

    if (rErr) return res.status(400).json({ error: rErr.message });

    res.status(201).json({
      reservation,
      guest,
      message: 'Réservation créée. Un email de confirmation sera envoyé à ' + email,
      cancel_token: guest.token,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/guests/formation — Inscription formation sans compte
router.post('/guests/formation', async (req, res) => {
  const { nom, prenom, email, telephone, formation_id, tenant_id } = req.body;
  if (!nom || !prenom || !email || !telephone || !formation_id) {
    return res.status(400).json({ error: 'Tous les champs sont requis.' });
  }

  try {
    // Vérifier la formation
    const { data: formation, error: fErr } = await supabaseAdmin
      .from('formations').select('*').eq('id', formation_id).single();
    if (fErr || !formation) return res.status(404).json({ error: 'Formation introuvable.' });
    if (formation.statut === 'annulee') return res.status(400).json({ error: 'Formation annulée.' });

    // Vérifier places disponibles
    const { count } = await supabaseAdmin
      .from('inscriptions_formations')
      .select('*', { count: 'exact', head: true })
      .eq('formation_id', formation_id)
      .neq('statut', 'annulee');

    if ((count || 0) >= formation.capacite_max) {
      return res.status(409).json({ error: 'Formation complète — plus de places disponibles.' });
    }

    // Créer/récupérer guest
    let { data: guest } = await supabaseAdmin
      .from('guests').select('*')
      .eq('email', email.toLowerCase().trim())
      .eq('tenant_id', tenant_id || null).maybeSingle();

    if (!guest) {
      const { data: ng, error: gErr } = await supabaseAdmin
        .from('guests')
        .insert({ nom, prenom, email: email.toLowerCase().trim(), telephone, tenant_id: tenant_id || null })
        .select().single();
      if (gErr) return res.status(400).json({ error: gErr.message });
      guest = ng;
    }

    // Créer l'inscription
    const { data: inscription, error: iErr } = await supabaseAdmin
      .from('inscriptions_formations')
      .insert({
        formation_id,
        user_id: null,
        guest_id: guest.id,
        statut: 'confirmee',
        statut_paiement: formation.prix_inscription > 0 ? 'en_attente' : 'gratuit'
      })
      .select().single();

    if (iErr) return res.status(400).json({ error: iErr.message });

    res.status(201).json({ inscription, guest, message: 'Inscription confirmée.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/guests — Liste tous les guests (admin)
router.get('/guests', authenticate, requireRoles('super_admin', 'admin', 'staff'), async (req, res) => {
  try {
    let query = supabaseAdmin
      .from('guests')
      .select('*, reservations(id, statut, date_debut, espaces(nom)), inscriptions_formations(id, statut, formations(titre))')
      .order('created_at', { ascending: false });
    query = applyTenantFilter(query, req);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ guests: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/guests/:id/convert — Convertir guest en membre
router.post('/guests/:id/convert', authenticate, requireRoles('super_admin', 'admin', 'staff'), async (req, res) => {
  const { email, mot_de_passe_temp } = req.body;

  try {
    const { data: guest, error: gErr } = await supabaseAdmin
      .from('guests').select('*').eq('id', req.params.id).single();
    if (gErr || !guest) return res.status(404).json({ error: 'Guest introuvable.' });
    if (guest.converti_en_membre_id) return res.status(400).json({ error: 'Guest déjà converti en membre.' });

    // Créer compte auth
    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: email || guest.email,
      password: mot_de_passe_temp || (Math.random().toString(36).slice(2) + 'Aa1!'),
      email_confirm: true,
      user_metadata: { nom: guest.nom, prenom: guest.prenom, role: 'member', telephone: guest.telephone },
    });
    if (authErr) return res.status(400).json({ error: authErr.message });

    // Transférer les réservations et inscriptions vers le nouveau user_id
    const newId = authData.user.id;
    await supabaseAdmin.from('reservations').update({ user_id: newId, guest_id: null }).eq('guest_id', guest.id);
    await supabaseAdmin.from('inscriptions_formations').update({ user_id: newId, guest_id: null }).eq('guest_id', guest.id);

    // Marquer le guest comme converti
    await supabaseAdmin.from('guests').update({
      converti_en_membre_id: newId, converti_at: new Date().toISOString()
    }).eq('id', guest.id);

    res.json({ message: 'Guest converti en membre. Email de connexion envoyé.', member_id: newId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/guests/booking/:token — Annuler réservation guest via token
router.delete('/guests/booking/:token', async (req, res) => {
  try {
    const { data: guest } = await supabaseAdmin
      .from('guests').select('id').eq('token', req.params.token).single();
    if (!guest) return res.status(404).json({ error: 'Lien invalide ou expiré.' });

    const { data: reservation } = await supabaseAdmin
      .from('reservations')
      .select('id, statut, date_debut')
      .eq('guest_id', guest.id)
      .neq('statut', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(1).maybeSingle();

    if (!reservation) return res.status(404).json({ error: 'Aucune réservation active.' });
    if (new Date(reservation.date_debut) < new Date()) {
      return res.status(400).json({ error: 'Impossible d\'annuler une réservation passée.' });
    }

    await supabaseAdmin.from('reservations').update({ statut: 'cancelled' }).eq('id', reservation.id);
    res.json({ message: 'Réservation annulée avec succès.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// API PUBLIQUE — Coworkings visibles sur la landing & parcours invité
// (Landing page, "Voir plus", étape 1 de réservation guest)
// =========================================================================

// GET /api/public/coworkings — Liste des coworkings actifs (landing page)
router.get('/public/coworkings', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('tenants')
      .select('id, nom, slug, description, adresse, ville, pays, email, telephone, site_web, logo_url, created_at')
      .eq('statut', 'actif')
      .order('nom', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    const today = new Date().toISOString().split('T')[0];

    const enriched = await Promise.all((data || []).map(async (t) => {
      const [
        { count: spaceCount },
        { count: membersCount },
        { data: promos },
      ] = await Promise.all([
        supabaseAdmin.from('espaces').select('*', { count: 'exact', head: true }).eq('tenant_id', t.id),
        supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).eq('tenant_id', t.id).in('role', ['member', 'guest']),
        supabaseAdmin
          .from('codes_promo')
          .select('id, type_reduction, valeur, date_fin')
          .eq('tenant_id', t.id)
          .eq('actif', true)
          .lte('date_debut', today),
      ]);

      // Filtrer les promos non expirées
      const activePromos = (promos || []).filter(p => !p.date_fin || p.date_fin >= today);

      return {
        ...t,
        space_count: spaceCount || 0,
        member_count: membersCount || 0,
        has_promo: activePromos.length > 0,
        promo_count: activePromos.length,
      };
    }));

    res.json({ coworkings: enriched || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/public/coworkings/:id — Détail d'un coworking actif + ses espaces
router.get('/public/coworkings/:id', async (req, res) => {
  try {
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id, nom, slug, description, adresse, ville, pays, email, telephone, site_web, logo_url, settings, created_at')
      .eq('id', req.params.id)
      .eq('statut', 'actif')
      .single();
    if (!tenant) return res.status(404).json({ error: 'Coworking introuvable.' });

    const { data: espaces } = await supabaseAdmin
      .from('espaces')
      .select('id, nom, type, capacite, tarif_horaire')
      .eq('tenant_id', tenant.id)
      .order('tarif_horaire', { ascending: true });

    res.json({ coworking: { ...tenant, espaces: espaces || [] } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/public/coworkings/:id/promos — Promos actives publiques d'un coworking
router.get('/public/coworkings/:id/promos', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Vérifier que le coworking est actif
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id, nom')
      .eq('id', req.params.id)
      .eq('statut', 'actif')
      .single();
    if (!tenant) return res.status(404).json({ error: 'Coworking introuvable.' });

    // Récupérer les codes promo actifs (on expose code, valeur, type, date_fin — pas les usages internes)
    const { data: promos, error } = await supabaseAdmin
      .from('codes_promo')
      .select('id, code, type_reduction, valeur, date_debut, date_fin, utilisations_max, utilisations_count')
      .eq('tenant_id', req.params.id)
      .eq('actif', true)
      .lte('date_debut', today)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    // Filtrer les promos non expirées et pas saturées
    const activePromos = (promos || []).filter(p => {
      const notExpired = !p.date_fin || p.date_fin >= today;
      const notSaturated = !p.utilisations_max || p.utilisations_count < p.utilisations_max;
      return notExpired && notSaturated;
    });

    // Récupérer les tarifs en promotion pour ce tenant (tarifs avec date_fin définie = durée limitée)
    const { data: tarifs } = await supabaseAdmin
      .from('tarifs_abonnements')
      .select('id, type_abonnement, plan_tarifaire, type_espace, prix, tva_pct, date_debut, date_fin')
      .eq('tenant_id', req.params.id)
      .eq('actif', true)
      .lte('date_debut', today)
      .not('date_fin', 'is', null)
      .gte('date_fin', today)
      .order('date_fin', { ascending: true });

    res.json({
      coworking: { id: tenant.id, nom: tenant.nom },
      promo_codes: activePromos,
      tarifs_limites: tarifs || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/public/espaces — Espaces des coworkings actifs (public / guest)
router.get('/public/espaces', async (req, res) => {
  try {
    let query = supabaseAdmin
      .from('espaces')
      .select('id, nom, type, capacite, tarif_horaire, photo_url, photos_urls, tenant_id, tenants!tenant_id(nom, ville, adresse, pays, cover_url, logo_url, latitude, longitude)')
      .order('tarif_horaire', { ascending: true });

    if (req.query.tenant_id) {
      const { data: tenant } = await supabaseAdmin
        .from('tenants').select('id').eq('id', req.query.tenant_id).eq('statut', 'actif').single();
      if (!tenant) return res.status(404).json({ error: 'Coworking introuvable.' });
      query = query.eq('tenant_id', req.query.tenant_id);
    } else {
      const { data: activeIds } = await supabaseAdmin
        .from('tenants').select('id').eq('statut', 'actif');
      query = query.in('tenant_id', (activeIds || []).map(t => t.id));
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ espaces: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// MODULE J — Politique annulation avancée + Crédit portefeuille
// =========================================================================

// GET /api/cancellation-policies/espaces — Règles par type d'espace
router.get('/cancellation-policies/espaces', authenticate, async (req, res) => {
  try {
    let query = supabaseAdmin.from('politique_annulation_espaces').select('*').order('type_espace');
    query = applyTenantFilter(query, req);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ policies: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/cancellation-policies/espaces — Upsert règle pour un type d'espace
router.put('/cancellation-policies/espaces', authenticate, requireRoles('super_admin', 'admin'), async (req, res) => {
  const {
    type_espace, tranche_libre_heures, tranche_tardive_heures,
    penalite_tardive_pct, penalite_tres_tardive_pct, penalite_noshow_pct,
    noshow_note_profil, credit_portefeuille_auto, credit_portefeuille_pct
  } = req.body;

  if (!type_espace) return res.status(400).json({ error: 'type_espace requis.' });

  try {
    const { data, error } = await supabaseAdmin
      .from('politique_annulation_espaces')
      .upsert({
        tenant_id: req.tenantId,
        type_espace, tranche_libre_heures, tranche_tardive_heures,
        penalite_tardive_pct, penalite_tres_tardive_pct, penalite_noshow_pct,
        noshow_note_profil, credit_portefeuille_auto, credit_portefeuille_pct,
        updated_at: new Date().toISOString()
      }, { onConflict: 'tenant_id,type_espace' })
      .select().single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ policy: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bookings/:id/noshow — Marquer no-show (admin/staff)
router.post('/bookings/:id/noshow', authenticate, requireRoles('super_admin', 'admin', 'staff'), async (req, res) => {
  try {
    const { data: reservation, error: rErr } = await supabaseAdmin
      .from('reservations')
      .select('*, espaces(type), profiles!user_id(nom, prenom, notes_admin)')
      .eq('id', req.params.id).single();
    if (rErr || !reservation) return res.status(404).json({ error: 'Réservation introuvable.' });

    // Récupérer la politique pour ce type d'espace
    const { data: policy } = await supabaseAdmin
      .from('politique_annulation_espaces')
      .select('*')
      .eq('type_espace', reservation.espaces?.type)
      .eq('tenant_id', req.tenantId)
      .maybeSingle();

    const penalite = policy?.penalite_noshow_pct ?? 100;

    // Marquer no-show
    await supabaseAdmin.from('reservations').update({
      no_show: true, statut: 'cancelled', penalite_pct: penalite
    }).eq('id', req.params.id);

    // Ajouter note sur le profil si configuré
    if (policy?.noshow_note_profil && reservation.user_id) {
      const noteActuelle = reservation.profiles?.notes_admin || '';
      const nouvelleNote = noteActuelle
        + `\n[${new Date().toLocaleDateString('fr-FR')}] No-show — ${reservation.espaces?.type || 'espace'} — pénalité ${penalite}%`;
      await supabaseAdmin.from('profiles').update({ notes_admin: nouvelleNote.trim() }).eq('id', reservation.user_id);
    }

    res.json({ message: `No-show enregistré. Pénalité : ${penalite}%.`, penalite_pct: penalite });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/members/:id/credits — Crédits portefeuille d'un membre
router.get('/members/:id/credits', authenticate, async (req, res) => {
  const isSelf = req.params.id === req.user.id;
  const isStaff = ['super_admin', 'admin', 'staff'].includes(req.profile.role);
  if (!isSelf && !isStaff) return res.status(403).json({ error: 'Accès refusé.' });

  try {
    const { data, error } = await supabaseAdmin
      .from('credits_membres')
      .select('*')
      .eq('user_id', req.params.id)
      .eq('utilise', false)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    const total = (data || []).reduce((s, c) => s + parseFloat(c.montant || 0), 0);
    res.json({ credits: data || [], total_disponible: Math.round(total * 100) / 100 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/members/:id/credits — Ajouter crédit portefeuille (admin)
router.post('/members/:id/credits', authenticate, requireRoles('super_admin', 'admin', 'staff'), async (req, res) => {
  const { montant, motif, reservation_id, expire_at } = req.body;
  if (!montant || montant <= 0) return res.status(400).json({ error: 'Montant invalide.' });

  try {
    const { data, error } = await supabaseAdmin
      .from('credits_membres')
      .insert({
        tenant_id: req.tenantId, user_id: req.params.id,
        montant: parseFloat(montant), motif: motif || 'Crédit portefeuille',
        reservation_id: reservation_id || null,
        expire_at: expire_at || null
      })
      .select().single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ credit: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// MODULE K — Documents membres & contrats
// =========================================================================

// GET /api/documents/content/:type — Contenu règlement / politique
router.get('/documents/content/:type', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('contenu_documents')
      .select('*')
      .eq('type_doc', req.params.type)
      .eq('actif', true)
      .order('created_at', { ascending: false })
      .limit(1).maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ document: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/documents/content — Créer/mettre à jour contenu document (admin)
router.put('/documents/content', authenticate, requireRoles('super_admin', 'admin'), async (req, res) => {
  const { type_doc, contenu, version } = req.body;
  if (!type_doc || !contenu) return res.status(400).json({ error: 'type_doc et contenu requis.' });

  try {
    // Désactiver l'ancienne version
    await supabaseAdmin.from('contenu_documents')
      .update({ actif: false }).eq('tenant_id', req.tenantId).eq('type_doc', type_doc);

    const { data, error } = await supabaseAdmin
      .from('contenu_documents')
      .insert({ tenant_id: req.tenantId, type_doc, contenu, version: version || '1.0', actif: true })
      .select().single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ document: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/members/me/documents — Documents du membre connecté
router.get('/members/me/documents-k', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('documents_membres')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ documents: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/members/me/documents — Uploader un document
router.post('/members/me/documents-k', authenticate, async (req, res) => {
  const { type_doc, nom, url } = req.body;
  if (!type_doc || !nom) return res.status(400).json({ error: 'type_doc et nom requis.' });

  try {
    const { data, error } = await supabaseAdmin
      .from('documents_membres')
      .insert({
        tenant_id: req.tenantId, user_id: req.user.id,
        type_doc, nom, url: url || null, uploade_par: 'membre'
      })
      .select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ document: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/members/me/accept — Accepter règlement / politique
router.post('/members/me/accept', authenticate, async (req, res) => {
  const { type_doc } = req.body;
  if (!type_doc) return res.status(400).json({ error: 'type_doc requis.' });

  try {
    // Vérifier si déjà accepté
    const { data: existing } = await supabaseAdmin
      .from('documents_membres')
      .select('id').eq('user_id', req.user.id)
      .eq('type_doc', type_doc).eq('accepte', true).maybeSingle();

    if (existing) return res.json({ message: 'Déjà accepté.' });

    const { data, error } = await supabaseAdmin
      .from('documents_membres')
      .insert({
        tenant_id: req.tenantId, user_id: req.user.id,
        type_doc, nom: type_doc, accepte: true,
        accepte_at: new Date().toISOString(), uploade_par: 'membre'
      })
      .select().single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ document: data, message: `${type_doc} accepté.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/documents/sign/:token — Vérifier token de signature
router.get('/documents/sign/:token', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('documents_membres')
      .select('*, profiles!user_id(nom, prenom, email)')
      .eq('signature_token', req.params.token)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Lien de signature invalide.' });
    if (data.signe) return res.status(400).json({ error: 'Document déjà signé.' });
    res.json({ document: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/documents/sign/:token — Signer électroniquement
router.post('/documents/sign/:token', async (req, res) => {
  try {
    const { data: doc } = await supabaseAdmin
      .from('documents_membres')
      .select('id, signe').eq('signature_token', req.params.token).single();

    if (!doc) return res.status(404).json({ error: 'Lien invalide.' });
    if (doc.signe) return res.status(400).json({ error: 'Déjà signé.' });

    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
    const { data, error } = await supabaseAdmin
      .from('documents_membres')
      .update({ signe: true, signe_at: new Date().toISOString(), signature_ip: ip })
      .eq('id', doc.id).select().single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ document: data, message: 'Document signé avec succès.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/members/:id/documents — Documents d'un membre (admin)
router.get('/admin/members/:id/documents', authenticate, requireRoles('super_admin', 'admin', 'staff'), async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('documents_membres')
      .select('*')
      .eq('user_id', req.params.id)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ documents: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/members/:id/documents/send-signature — Envoyer lien de signature
router.post('/admin/members/:id/documents/send-signature', authenticate, requireRoles('super_admin', 'admin'), async (req, res) => {
  const { type_doc, nom } = req.body;
  if (!type_doc) return res.status(400).json({ error: 'type_doc requis.' });

  try {
    const { data: profile } = await supabaseAdmin.from('profiles').select('email').eq('id', req.params.id).single();
    if (!profile) return res.status(404).json({ error: 'Membre introuvable.' });

    const { data: doc, error } = await supabaseAdmin
      .from('documents_membres')
      .insert({
        tenant_id: req.tenantId, user_id: req.params.id,
        type_doc, nom: nom || type_doc, uploade_par: 'admin'
      })
      .select().single();
    if (error) return res.status(400).json({ error: error.message });

    const signUrl = `${process.env.FRONTEND_URL}/sign/${doc.signature_token}`;
    // Note: envoi email du lien de signature géré par Module F
    res.json({ document: doc, sign_url: signUrl, message: `Lien de signature généré pour ${profile.email}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// MODULE L — RGPD
// =========================================================================

// POST /api/rgpd/request — Soumettre une demande RGPD
router.post('/rgpd/request', authenticate, async (req, res) => {
  const { type_demande, details } = req.body;
  const validTypes = ['export', 'suppression', 'rectification', 'opposition_marketing', 'portabilite'];
  if (!type_demande || !validTypes.includes(type_demande)) {
    return res.status(400).json({ error: 'type_demande invalide.' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('rgpd_demandes')
      .insert({
        tenant_id: req.tenantId, user_id: req.user.id,
        type_demande, details: details || null
      })
      .select().single();

    if (error) return res.status(400).json({ error: error.message });

    // Si export immédiat — générer les données
    if (type_demande === 'export') {
      const [{ data: profile }, { data: reservations }, { data: paiements }, { data: abonnements }] = await Promise.all([
        supabaseAdmin.from('profiles').select('*').eq('id', req.user.id).single(),
        supabaseAdmin.from('reservations').select('*, espaces(nom)').eq('user_id', req.user.id),
        supabaseAdmin.from('paiements').select('*').eq('user_id', req.user.id),
        supabaseAdmin.from('abonnements').select('*').eq('user_id', req.user.id),
      ]);

      const exportData = {
        export_date: new Date().toISOString(),
        profil: profile,
        reservations: reservations || [],
        paiements: paiements || [],
        abonnements: abonnements || [],
      };

      // Mettre à jour la demande avec le statut traité
      await supabaseAdmin.from('rgpd_demandes')
        .update({ statut: 'traite', traite_at: new Date().toISOString() })
        .eq('id', data.id);

      return res.json({
        demande: { ...data, statut: 'traite' },
        export_data: exportData,
        message: 'Export généré. Téléchargez vos données.'
      });
    }

    res.status(201).json({
      demande: data,
      message: 'Demande enregistrée. L\'équipe traitera votre demande sous 48h.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rgpd/my-requests — Mes demandes RGPD
router.get('/rgpd/my-requests', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('rgpd_demandes')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ demandes: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/members/me/marketing — Préférences marketing
router.patch('/members/me/marketing', authenticate, async (req, res) => {
  const { marketing_email, marketing_sms } = req.body;
  const updates = { updated_at: new Date().toISOString() };
  if (marketing_email !== undefined) updates.marketing_email = Boolean(marketing_email);
  if (marketing_sms !== undefined) updates.marketing_sms = Boolean(marketing_sms);

  try {
    const { data, error } = await supabaseAdmin
      .from('profiles').update(updates).eq('id', req.user.id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ profile: data, message: 'Préférences marketing mises à jour.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/rgpd — Liste des demandes RGPD (admin)
router.get('/admin/rgpd', authenticate, requireRoles('super_admin', 'admin'), async (req, res) => {
  try {
    let query = supabaseAdmin
      .from('rgpd_demandes')
      .select('*, profiles!user_id(nom, prenom, email)')
      .order('created_at', { ascending: false });
    query = applyTenantFilter(query, req);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ demandes: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/rgpd/:id — Traiter une demande RGPD
router.patch('/admin/rgpd/:id', authenticate, requireRoles('super_admin', 'admin'), async (req, res) => {
  const { statut, details } = req.body;
  if (!statut) return res.status(400).json({ error: 'statut requis.' });

  try {
    const updates = {
      statut, traite_par: req.user.id,
      traite_at: new Date().toISOString()
    };
    if (details) updates.details = details;

    const { data: demande } = await supabaseAdmin
      .from('rgpd_demandes').select('*').eq('id', req.params.id).single();

    // Si suppression demandée et approuvée
    if (demande?.type_demande === 'suppression' && statut === 'traite') {
      await supabaseAdmin.from('profiles').update({
        suppression_demandee: true, suppression_at: new Date().toISOString()
      }).eq('id', demande.user_id);
    }

    const { data, error } = await supabaseAdmin
      .from('rgpd_demandes').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ demande: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// MODULE N — Multi-sites
// =========================================================================

// GET /api/sites — Liste des sites du tenant
router.get('/sites', authenticate, async (req, res) => {
  try {
    let query = supabaseAdmin.from('sites').select('*, espaces(id, nom, type)').order('nom');
    query = applyTenantFilter(query, req);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // Enrichir avec stats
    const enriched = await Promise.all((data || []).map(async (site) => {
      const [{ count: memberCount }, { count: bookingCount }] = await Promise.all([
        supabaseAdmin.from('membres_sites').select('*', { count: 'exact', head: true }).eq('site_id', site.id),
        supabaseAdmin.from('reservations').select('*', { count: 'exact', head: true }).eq('site_id', site.id).in('statut', ['confirmed', 'pending']),
      ]);
      return { ...site, nb_membres: memberCount || 0, nb_reservations: bookingCount || 0 };
    }));

    res.json({ sites: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sites — Créer un site
router.post('/sites', authenticate, requireRoles('super_admin', 'admin'), async (req, res) => {
  const { nom, adresse, ville, telephone, email } = req.body;
  if (!nom) return res.status(400).json({ error: 'nom requis.' });

  try {
    const { data, error } = await supabaseAdmin
      .from('sites')
      .insert({ tenant_id: req.tenantId, nom, adresse, ville, telephone, email })
      .select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ site: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/sites/:id — Modifier un site
router.patch('/sites/:id', authenticate, requireRoles('super_admin', 'admin'), async (req, res) => {
  const allowed = ['nom', 'adresse', 'ville', 'telephone', 'email', 'actif'];
  const updates = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('sites').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ site: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/sites/:id — Supprimer un site
router.delete('/sites/:id', authenticate, requireRoles('super_admin', 'admin'), async (req, res) => {
  try {
    const { count } = await supabaseAdmin
      .from('espaces').select('*', { count: 'exact', head: true }).eq('site_id', req.params.id);
    if ((count || 0) > 0) {
      return res.status(400).json({ error: `Impossible de supprimer : ${count} espace(s) lié(s) à ce site.` });
    }
    const { error } = await supabaseAdmin.from('sites').delete().eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Site supprimé.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sites/:id/members — Membres autorisés pour un site
router.get('/sites/:id/members', authenticate, requireRoles('super_admin', 'admin', 'staff'), async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('membres_sites')
      .select('*, profiles!user_id(id, nom, prenom, email, statut_compte)')
      .eq('site_id', req.params.id)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ membres: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sites/:id/members — Autoriser un membre sur un site
router.post('/sites/:id/members', authenticate, requireRoles('super_admin', 'admin'), async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id requis.' });

  try {
    const { data, error } = await supabaseAdmin
      .from('membres_sites')
      .upsert({ tenant_id: req.tenantId, user_id, site_id: req.params.id }, { onConflict: 'user_id,site_id' })
      .select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ acces: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/sites/:id/members/:userId — Retirer accès d'un membre
router.delete('/sites/:id/members/:userId', authenticate, requireRoles('super_admin', 'admin'), async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('membres_sites')
      .delete().eq('site_id', req.params.id).eq('user_id', req.params.userId);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Accès retiré.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sites/:id/kpis — KPIs d'un site spécifique
router.get('/sites/:id/kpis', authenticate, requireRoles('super_admin', 'admin', 'staff'), async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const debutMois = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

    const [
      { count: membresActifs },
      { count: reservationsAujourd },
      { data: caData },
      { data: espaces },
    ] = await Promise.all([
      supabaseAdmin.from('membres_sites').select('*', { count: 'exact', head: true }).eq('site_id', req.params.id),
      supabaseAdmin.from('reservations').select('*', { count: 'exact', head: true })
        .eq('site_id', req.params.id).in('statut', ['confirmed', 'pending'])
        .gte('date_debut', today + 'T00:00:00').lte('date_debut', today + 'T23:59:59'),
      supabaseAdmin.from('paiements').select('montant')
        .eq('statut', 'paid').gte('date_paiement', debutMois),
      supabaseAdmin.from('espaces').select('id, nom, type').eq('site_id', req.params.id),
    ]);

    const caMois = (caData || []).reduce((s, p) => s + parseFloat(p.montant || 0), 0);

    res.json({
      site_id: req.params.id,
      membres_acces: membresActifs || 0,
      reservations_aujourd_hui: reservationsAujourd || 0,
      ca_mois: Math.round(caMois * 100) / 100,
      espaces: espaces || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sites/kpis/global — KPIs consolidés tous les sites
router.get('/sites/kpis/global', authenticate, requireRoles('super_admin', 'admin'), async (req, res) => {
  try {
    let sitesQuery = supabaseAdmin.from('sites').select('id, nom, actif');
    sitesQuery = applyTenantFilter(sitesQuery, req);
    const { data: sites } = await sitesQuery;

    const sitesKpis = await Promise.all((sites || []).map(async (site) => {
      const [{ count: membres }, { count: reservations }] = await Promise.all([
        supabaseAdmin.from('membres_sites').select('*', { count: 'exact', head: true }).eq('site_id', site.id),
        supabaseAdmin.from('reservations').select('*', { count: 'exact', head: true })
          .eq('site_id', site.id).in('statut', ['confirmed', 'pending']),
      ]);
      return { ...site, nb_membres: membres || 0, nb_reservations: reservations || 0 };
    }));

    res.json({ sites: sitesKpis, total_sites: (sites || []).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

  return router;
};
