/**
 * routes/modulesHJKLN.js
 * MODULE H — Visiteurs & Guests
 * MODULE J — Politique annulation avancée + crédit portefeuille
 * MODULE K — Documents membres & contrats
 * MODULE L — RGPD
 * MODULE N — Multi-sites
 */
const express = require('express');
const { getBookingAvailability, insertWithColumnFallback } = require('../models/helpers');

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
// CDC v3.0 : aucun paiement en ligne — la réservation est enregistrée « pending » (validation manuelle)
// ou « confirmed » (confirmation automatique), le règlement s'effectue sur place.
router.post('/guests/booking', async (req, res) => {
  const { nom, prenom, email, telephone, espace_id, date_debut, date_fin, client_type, entreprise_info, floor_plan_item_id, floor_plan_item_label } = req.body;
  if (!nom || !prenom || !email || !telephone || !espace_id || !date_debut || !date_fin) {
    return res.status(400).json({ error: 'Tous les champs sont requis.' });
  }
  let notesObj = {};
  if (client_type === 'entreprise') {
    const info = entreprise_info || {};
    if (!String(info.raison_sociale || '').trim() || !String(info.contact_nom || '').trim() || !String(info.telephone_pro || '').trim() || !String(info.email_facturation || '').trim() || !String(info.besoin_description || '').trim()) {
      return res.status(400).json({ error: 'Pour une réservation Entreprise, raison sociale, personne de contact, téléphone professionnel, e-mail de facturation et description du besoin sont obligatoires.' });
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
  if (floor_plan_item_id) notesObj.floor_plan_item_id = String(floor_plan_item_id);
  if (floor_plan_item_label) notesObj.floor_plan_item_label = String(floor_plan_item_label).trim();
  const combinedNotes = Object.keys(notesObj).length > 0 ? JSON.stringify(notesObj) : null;
  if (new Date(date_debut) >= new Date(date_fin)) {
    return res.status(400).json({ error: 'date_fin doit être postérieure à date_debut.' });
  }

  try {
    // Le tenant est TOUJOURS déduit de l'espace (le client ne peut pas forcer un autre établissement)
    const { data: espace, error: espErr } = await supabaseAdmin
      .from('espaces')
      .select('id, nom, type, tenant_id, tarif_horaire')
      .eq('id', espace_id)
      .maybeSingle();
    if (espErr || !espace) {
      return res.status(404).json({ error: "Espace introuvable. Veuillez choisir un espace dans la liste de l'établissement." });
    }
    const tenantId = espace.tenant_id || req.body.tenant_id || null;
    if (req.body.tenant_id && espace.tenant_id && req.body.tenant_id !== espace.tenant_id) {
      return res.status(400).json({ error: "Cet espace n'appartient pas à l'établissement sélectionné." });
    }

    const availability = await getBookingAvailability(espace_id, date_debut, date_fin, null, {
      floorPlanItemId: floor_plan_item_id || null,
    });
    if (!availability.isAvailable) {
      return res.status(409).json({ error: availability.conflictMessage });
    }

    // Statut : validation manuelle (par défaut, et toujours pour un Event Space) ou confirmation automatique
    let autoConfirm = false;
    if (tenantId && espace.type !== 'event_space') {
      const { data: tenant } = await supabaseAdmin.from('tenants').select('settings').eq('id', tenantId).maybeSingle();
      autoConfirm = tenant?.settings?.auto_confirmation === true;
    }
    const statut = autoConfirm ? 'confirmed' : 'pending';

    // Créer ou récupérer le guest (tolérant au schéma : colonnes prenom / tenant_id facultatives)
    const cleanEmail = email.toLowerCase().trim();
    let guest = null;
    {
      let q = supabaseAdmin.from('guests').select('*').eq('email', cleanEmail);
      if (tenantId) q = q.eq('tenant_id', tenantId);
      const { data: found, error: findErr } = await q.limit(1).maybeSingle();
      if (!findErr) guest = found;
    }
    if (!guest) {
      const guestPayload = { nom, prenom, email: cleanEmail, telephone, tenant_id: tenantId };
      let { data: created, error: gErr, dropped } = await insertWithColumnFallback(supabaseAdmin, 'guests', guestPayload);
      if (gErr) return res.status(400).json({ error: gErr.message });
      // Si la colonne « prenom » n'existe pas, on conserve l'information dans « nom »
      if (dropped.includes('prenom') && created?.id) {
        await supabaseAdmin.from('guests').update({ nom: `${prenom} ${nom}`.trim() }).eq('id', created.id);
        created.nom = `${prenom} ${nom}`.trim();
      }
      guest = created;
    }

    // Créer la réservation liée au guest (sans compte) — user_id nul, remplacé par membre_id si le schéma l'impose
    const { data: reservation, error: rErr } = await insertWithColumnFallback(
      supabaseAdmin,
      'reservations',
      {
        user_id: null,
        guest_id: guest.id,
        tenant_id: tenantId,
        espace_id,
        date_debut,
        date_fin,
        statut,
        mode: 'on_site',
        mode_reservation: client_type === 'entreprise' ? 'entreprise' : 'guest',
        ...(floor_plan_item_id ? { floor_plan_item_id } : {}),
        ...(combinedNotes ? { notes: combinedNotes } : {}),
        source: 'marketplace',
      },
      { aliases: { user_id: 'membre_id' } },
    );
    if (rErr) return res.status(400).json({ error: rErr.message });

    // Alerte temps réel In-App pour les gérants/staff du coworking (réservation invité)
    try {
      if (tenantId) {
        const { data: admins } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('tenant_id', tenantId)
          .in('role', ['admin', 'staff']);
        if (admins && admins.length > 0) {
          const guestLabel = `${prenom} ${nom}`.trim() || email;
          const dateLabel = new Date(date_debut).toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis' }) +
            ' à ' +
            new Date(date_debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Tunis' });
          const posteTxt = floor_plan_item_label ? ` (${floor_plan_item_label})` : '';
          await supabaseAdmin.from('notifications').insert(
            admins.map((a) => ({
              user_id: a.id,
              type: 'nouvelle_demande_reservation',
              canal: 'Dashboard',
              lu: false,
              message: `👤 Nouvelle réservation invité de ${guestLabel} pour ${espace.nom}${posteTxt} (${dateLabel}) — Règlement sur place.`,
            }))
          );
        }
      }
    } catch (_) {}

    res.status(201).json({
      reservation: { ...reservation, espaces: { nom: espace.nom, type: espace.type } },
      guest,
      statut,
      message: statut === 'confirmed'
        ? 'Réservation confirmée. Règlement à effectuer sur place (espèces, chèque ou virement) lors de votre arrivée.'
        : "Réservation enregistrée, en attente de validation par l'établissement. Règlement à effectuer sur place (espèces, chèque ou virement) lors de votre arrivée.",
      payment_on_site: true,
      cancel_token: guest.token || null,
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

// GET /api/public/coworkings — Liste des coworkings actifs (landing page & parcours réservation)
router.get('/public/coworkings', async (req, res) => {
  try {
    let { data, error } = await supabaseAdmin
      .from('tenants')
      .select('id, nom, slug, description, adresse, ville, pays, email, telephone, site_web, logo_url, cover_url, latitude, longitude, settings, created_at')
      .or('statut.eq.actif,statut.eq.valide,statut.eq.approuve,statut.is.null')
      .order('nom', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    if (!data || data.length === 0) {
      const { data: allTenants } = await supabaseAdmin
        .from('tenants')
        .select('id, nom, slug, description, adresse, ville, pays, email, telephone, site_web, logo_url, cover_url, latitude, longitude, settings, created_at')
        .limit(10);
      if (allTenants && allTenants.length > 0) {
        data = allTenants;
      }
    }

    const tenantsList = data || [];
    const tenantIds = tenantsList.map((t) => t.id).filter(Boolean);
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const nowIso = now.toISOString();
    const windowEndIso = new Date(now.getTime() + 60 * 60 * 1000).toISOString();

    let allSpaces = [];
    let activeBookings = [];
    let activeFormations = [];
    const sqlFloorPlanTenantIds = new Set();

    if (tenantIds.length > 0) {
      let espRes = await supabaseAdmin
        .from('espaces')
        .select('id, tenant_id, type, capacite, tarif_horaire, photo_url, actif')
        .in('tenant_id', tenantIds);
      if (espRes.error) {
        espRes = await supabaseAdmin
          .from('espaces')
          .select('id, tenant_id, type, capacite, tarif_horaire')
          .in('tenant_id', tenantIds);
      }
      allSpaces = (espRes.data || []).filter((s) => s.actif !== false);

      const [bookRes, formRes, fpRes] = await Promise.all([
        supabaseAdmin
          .from('reservations')
          .select('espace_id, tenant_id')
          .in('tenant_id', tenantIds)
          .in('statut', ['confirmed', 'pending'])
          .lt('date_debut', windowEndIso)
          .gt('date_fin', nowIso),
        supabaseAdmin
          .from('formations')
          .select('espace_id, tenant_id')
          .in('tenant_id', tenantIds)
          .in('statut', ['planifiee', 'publiee', 'en_cours'])
          .lt('date_debut', windowEndIso)
          .gt('date_fin', nowIso),
        supabaseAdmin
          .from('floor_plans')
          .select('tenant_id')
          .eq('is_active', true)
          .in('tenant_id', tenantIds)
          .then((r) => r)
          .catch(() => ({ data: null })),
      ]);

      activeBookings = bookRes.data || [];
      activeFormations = formRes.data || [];
      (fpRes?.data || []).forEach((fp) => {
        if (fp?.tenant_id) sqlFloorPlanTenantIds.add(fp.tenant_id);
      });
    }

    const bookingsBySpace = {};
    activeBookings.forEach((b) => {
      if (b.espace_id) bookingsBySpace[b.espace_id] = (bookingsBySpace[b.espace_id] || 0) + 1;
    });
    const formationSpaces = new Set(activeFormations.map((f) => f.espace_id).filter(Boolean));
    const spacesByTenant = {};
    allSpaces.forEach((sp) => {
      if (!spacesByTenant[sp.tenant_id]) spacesByTenant[sp.tenant_id] = [];
      spacesByTenant[sp.tenant_id].push(sp);
    });

    const enriched = await Promise.all(tenantsList.map(async (t) => {
      const [
        { count: membersCount },
        { data: promos },
      ] = await Promise.all([
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
      const tSpaces = spacesByTenant[t.id] || [];
      const tarifs = tSpaces.map((s) => Number(s.tarif_horaire || 0)).filter((v) => v > 0);
      const liveSpacesFree = tSpaces.filter((s) => {
        if (formationSpaces.has(s.id)) return false;
        const cap = Math.max(1, parseInt(s.capacite, 10) || 1);
        const occ = bookingsBySpace[s.id] || 0;
        const isShared = s.type === 'open_space' || s.type === 'hot_desk';
        return isShared ? occ < cap : occ === 0;
      }).length;

      const { settings, ...publicTenant } = t;
      const galleryPhotos = Array.isArray(settings?.gallery_photos) ? settings.gallery_photos : [];
      const spacePhotos = tSpaces.map((s) => s.photo_url).filter(Boolean);
      const galleryPreview = [...new Set([t.cover_url, ...galleryPhotos, ...spacePhotos].filter(Boolean))].slice(0, 4);
      const saasPack = settings?.saas_pack || 'essentiel';
      const hasSettingsFp = Array.isArray(settings?.floor_plans) && settings.floor_plans.some((p) => p.is_active !== false);

      return {
        ...publicTenant,
        latitude: t.latitude != null ? Number(t.latitude) : null,
        longitude: t.longitude != null ? Number(t.longitude) : null,
        // Pack SaaS de l'établissement (stocké dans tenants.settings.saas_pack : essentiel | standard | premium)
        saas_pack: saasPack,
        is_featured: saasPack === 'premium',
        is_partner: ['premium', 'standard'].includes(saasPack) || Boolean(settings?.is_partner),
        has_floor_plan: sqlFloorPlanTenantIds.has(t.id) || hasSettingsFp,
        space_count: tSpaces.length,
        live_spaces_total: tSpaces.length,
        live_spaces_free: liveSpacesFree,
        min_tarif_horaire: tarifs.length > 0 ? Math.min(...tarifs) : null,
        space_types: [...new Set(tSpaces.map((s) => s.type).filter(Boolean))],
        equipements: Array.isArray(settings?.equipements) ? settings.equipements : [],
        gallery_preview: galleryPreview,
        member_count: membersCount || 0,
        has_promo: activePromos.length > 0,
        promo_count: activePromos.length,
        has_domiciliation: Boolean(settings?.domiciliation?.actif),
        domiciliation: settings?.domiciliation && settings.domiciliation.actif ? settings.domiciliation : null,
      };
    }));

    // Pack Premium : badge « Mis en avant » + priorité algorithmique TOURNANTE.
    // Les établissements Premium passent en tête ; leur ordre tourne toutes les heures
    // (rotation équitable), les autres restent triés par nom.
    const featured = enriched.filter((t) => t.is_featured);
    const regular = enriched.filter((t) => !t.is_featured);
    if (featured.length > 1) {
      const offset = Math.floor(Date.now() / 3600000) % featured.length;
      featured.push(...featured.splice(0, offset));
    }

    res.json({ coworkings: [...featured, ...regular] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/public/coworkings/:id — Détail d'un coworking actif (+ aperçu propriétaire / super admin)
router.get('/public/coworkings/:id', async (req, res) => {
  try {
    const rawId = String(req.params.id || '').trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId);
    let tenantQuery = supabaseAdmin
      .from('tenants')
      .select('id, nom, slug, description, adresse, ville, pays, email, telephone, site_web, logo_url, cover_url, latitude, longitude, statut, settings, created_at');
    
    tenantQuery = isUuid ? tenantQuery.eq('id', rawId) : tenantQuery.eq('slug', rawId);
    let { data: tenant } = await tenantQuery.maybeSingle();

    if (!tenant && !isUuid) {
      const slugSearch = rawId.toLowerCase();
      const { data: fallbackTenant } = await supabaseAdmin
        .from('tenants')
        .select('id, nom, slug, description, adresse, ville, pays, email, telephone, site_web, logo_url, cover_url, latitude, longitude, statut, settings, created_at')
        .or(`slug.ilike.%${slugSearch}%,nom.ilike.%${slugSearch.replace(/-/g, ' ')}%`)
        .limit(1)
        .maybeSingle();
      if (fallbackTenant) tenant = fallbackTenant;
    }

    if (!tenant) return res.status(404).json({ error: 'Coworking introuvable.' });

    if (tenant.statut !== 'actif') {
      let authorizedOwner = false;
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (token) {
        try {
          const { data: authData } = await supabaseAdmin.auth.getUser(token);
          if (authData?.user?.id) {
            const { data: prof } = await supabaseAdmin
              .from('profiles')
              .select('role, is_super_admin, tenant_id')
              .eq('id', authData.user.id)
              .single();
            if (
              prof &&
              (prof.role === 'super_admin' ||
                prof.is_super_admin === true ||
                (['admin', 'staff'].includes(prof.role) && prof.tenant_id === tenant.id))
            ) {
              authorizedOwner = true;
            }
          }
        } catch (_) {}
      }
      if (!authorizedOwner) {
        return res.status(404).json({ error: 'Coworking introuvable.' });
      }
    }

    // Colonnes enrichies (visuels, équipements) : on retombe sur la projection minimale si le schéma ne les a pas.
    let { data: espaces, error: espErr } = await supabaseAdmin
      .from('espaces')
      .select('id, nom, type, capacite, tarif_horaire, photo_url, photos_urls, equipements, description, tenant_id')
      .eq('tenant_id', tenant.id)
      .order('tarif_horaire', { ascending: true });
    if (espErr) {
      ({ data: espaces, error: espErr } = await supabaseAdmin
        .from('espaces')
        .select('id, nom, type, capacite, tarif_horaire, images, equipements, description, tenant_id')
        .eq('tenant_id', tenant.id)
        .order('tarif_horaire', { ascending: true }));
    }
    if (espErr) {
      ({ data: espaces } = await supabaseAdmin
        .from('espaces')
        .select('id, nom, type, capacite, tarif_horaire')
        .eq('tenant_id', tenant.id)
        .order('tarif_horaire', { ascending: true }));
    }

    const normalizedEspaces = (espaces || []).map((e) => ({
      ...e,
      photo_url: e.photo_url || (Array.isArray(e.images) ? e.images[0] : null) || null,
    }));

    // Incrémenter compteur de vues Marketplace si fiche active (sans bloquer la réponse)
    if (tenant.statut === 'actif') {
      const s = tenant.settings && typeof tenant.settings === 'object' ? tenant.settings : {};
      const mp = s.marketplace_stats && typeof s.marketplace_stats === 'object' ? s.marketplace_stats : {};
      const nextMp = { ...mp, vues: Number(mp.vues || 0) + 1, last_updated: new Date().toISOString() };
      supabaseAdmin
        .from('tenants')
        .update({ settings: { ...s, marketplace_stats: nextMp } })
        .eq('id', tenant.id)
        .then(() => {})
        .catch(() => {});
    }

    const { settings: _settings, statut: tenantStatut, ...publicTenant } = tenant;
    const saasPack = tenant.settings?.saas_pack || 'essentiel';
    const hasSettingsFp = Array.isArray(tenant.settings?.floor_plans) && tenant.settings.floor_plans.some((p) => p.is_active !== false);
    res.json({
      coworking: {
        ...publicTenant,
        latitude: tenant.latitude != null ? Number(tenant.latitude) : null,
        longitude: tenant.longitude != null ? Number(tenant.longitude) : null,
        is_preview: tenantStatut !== 'actif',
        preview_statut: tenantStatut,
        saas_pack: saasPack,
        is_featured: saasPack === 'premium',
        is_partner: ['premium', 'standard'].includes(saasPack) || Boolean(tenant.settings?.is_partner),
        has_floor_plan: hasSettingsFp,
        gallery_photos: Array.isArray(tenant.settings?.gallery_photos) ? tenant.settings.gallery_photos : [],
        equipements: Array.isArray(tenant.settings?.equipements) ? tenant.settings.equipements : [],
        domiciliation: tenant.settings?.domiciliation && tenant.settings.domiciliation.actif ? tenant.settings.domiciliation : null,
        espaces: normalizedEspaces,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/public/coworkings/:id/track — Suivi clics / interactions Marketplace (Pack Premium)
router.post('/public/coworkings/:id/track', async (req, res) => {
  try {
    const rawId = String(req.params.id || '').trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId);
    const action = req.body?.action === 'booking' ? 'booking' : 'click';
    let query = supabaseAdmin.from('tenants').select('id, settings');
    query = isUuid ? query.eq('id', rawId) : query.eq('slug', rawId);
    let { data: tenant } = await query.maybeSingle();

    if (!tenant && !isUuid) {
      const slugSearch = rawId.toLowerCase();
      const { data: fb } = await supabaseAdmin
        .from('tenants')
        .select('id, settings')
        .or(`slug.ilike.%${slugSearch}%,nom.ilike.%${slugSearch.replace(/-/g, ' ')}%`)
        .limit(1)
        .maybeSingle();
      if (fb) tenant = fb;
    }
    if (!tenant) return res.status(404).json({ error: 'Coworking introuvable.' });

    const s = tenant.settings && typeof tenant.settings === 'object' ? tenant.settings : {};
    const mp = s.marketplace_stats && typeof s.marketplace_stats === 'object' ? s.marketplace_stats : {};
    const nextMp = {
      ...mp,
      clics: Number(mp.clics || 0) + (action === 'click' ? 1 : 0),
      last_updated: new Date().toISOString(),
    };
    await supabaseAdmin.from('tenants').update({ settings: { ...s, marketplace_stats: nextMp } }).eq('id', tenant.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/public/coworkings/:id/promos — Promos actives publiques d'un coworking
router.get('/public/coworkings/:id/promos', async (req, res) => {
  try {
    const rawId = String(req.params.id || '').trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId);
    const today = new Date().toISOString().split('T')[0];

    // Vérifier que le coworking est actif
    let query = supabaseAdmin.from('tenants').select('id, nom').eq('statut', 'actif');
    query = isUuid ? query.eq('id', rawId) : query.eq('slug', rawId);
    let { data: tenant } = await query.maybeSingle();

    if (!tenant && !isUuid) {
      const slugSearch = rawId.toLowerCase();
      const { data: fb } = await supabaseAdmin
        .from('tenants')
        .select('id, nom')
        .eq('statut', 'actif')
        .or(`slug.ilike.%${slugSearch}%,nom.ilike.%${slugSearch.replace(/-/g, ' ')}%`)
        .limit(1)
        .maybeSingle();
      if (fb) tenant = fb;
    }
    if (!tenant) return res.status(404).json({ error: 'Coworking introuvable.' });

    // Récupérer les codes promo actifs (on expose code, valeur, type, date_fin — pas les usages internes)
    const { data: promos, error } = await supabaseAdmin
      .from('codes_promo')
      .select('id, code, type_reduction, valeur, date_debut, date_fin, utilisations_max, utilisations_count')
      .eq('tenant_id', tenant.id)
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
    const richCols = 'id, nom, type, capacite, tarif_horaire, photo_url, photos_urls, equipements, description, tenant_id, tenants!tenant_id(nom, ville, adresse, pays, cover_url, logo_url, latitude, longitude)';
    const compatCols = 'id, nom, type, capacite, tarif_horaire, images, equipements, description, tenant_id, tenants!tenant_id(nom, ville, adresse, pays, cover_url, logo_url)';
    const minCols = 'id, nom, type, capacite, tarif_horaire, tenant_id';

    let activeTenantIds = null;
    if (!req.query.tenant_id) {
      const { data: activeIds } = await supabaseAdmin
        .from('tenants').select('id')
        .or('statut.eq.actif,statut.eq.valide,statut.eq.approuve,statut.is.null');
      activeTenantIds = (activeIds || []).map((t) => t.id);
    } else {
      const { data: tenant } = await supabaseAdmin
        .from('tenants').select('id').eq('id', req.query.tenant_id)
        .or('statut.eq.actif,statut.eq.valide,statut.eq.approuve,statut.is.null').maybeSingle();
      if (!tenant) return res.status(404).json({ error: 'Coworking introuvable.' });
    }

    const runSelect = async (cols) => {
      let q = supabaseAdmin.from('espaces').select(cols).order('tarif_horaire', { ascending: true });
      if (req.query.tenant_id) q = q.eq('tenant_id', req.query.tenant_id);
      else if (activeTenantIds) q = q.in('tenant_id', activeTenantIds);
      return q;
    };

    let { data, error } = await runSelect(richCols);
    if (error) ({ data, error } = await runSelect(compatCols));
    if (error) ({ data, error } = await runSelect(minCols));
    if (error) return res.status(500).json({ error: error.message });

    const normalized = (data || []).map((e) => ({
      ...e,
      photo_url: e.photo_url || (Array.isArray(e.images) ? e.images[0] : null) || null,
    }));
    res.json({ espaces: normalized });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/public/formations — Prochaines sessions de formation ouvertes au public (carrousel landing)
router.get('/public/formations', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 12, 30);
    const nowIso = new Date().toISOString();

    const { data: tenants } = await supabaseAdmin.from('tenants').select('id, nom, ville').eq('statut', 'actif');
    const tenantMap = Object.fromEntries((tenants || []).map((t) => [t.id, t]));

    let q = supabaseAdmin
      .from('formations')
      .select('*')
      .in('statut', ['planifiee', 'publiee'])
      .gte('date_debut', nowIso)
      .order('date_debut', { ascending: true })
      .limit(limit * 3);
    if (req.query.tenant_id) q = q.eq('tenant_id', req.query.tenant_id);
    const { data, error } = await q;
    if (error) return res.json({ formations: [] }); // module Formation non déployé : pas d'erreur côté visiteur

    const formations = (data || [])
      .filter((f) => !f.tenant_id || tenantMap[f.tenant_id])
      .map((f) => {
        const inscrits = Number(f.nb_inscrits || 0);
        const capacite = Number(f.capacite_max ?? f.places_max ?? 0);
        return {
          id: f.id,
          titre: f.titre,
          description: f.description || null,
          programme: f.programme || null,
          formateur_nom: f.formateur_nom || (f.formateur_id ? 'Formateur Certifié' : null),
          date_debut: f.date_debut,
          date_fin: f.date_fin,
          prix_inscription: Number(f.prix_inscription ?? f.prix ?? 0),
          places_restantes: capacite > 0 ? Math.max(0, capacite - inscrits) : null,
          liste_attente: capacite > 0 && inscrits >= capacite,
          tenant_id: f.tenant_id || null,
          etablissement: f.tenant_id ? tenantMap[f.tenant_id]?.nom : null,
          ville: f.tenant_id ? tenantMap[f.tenant_id]?.ville : null,
        };
      })
      .slice(0, limit);

    res.json({ formations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/public/trainer-application — Candidature "Devenir Formateur" (CDC v3.0)
router.post('/public/trainer-application', async (req, res) => {
  try {
    const {
      nom, prenom, email, telephone, password,
      specialite, biographie, documents, tenant_id,
    } = req.body;

    if (!nom?.trim() || !prenom?.trim() || !email?.trim() || !specialite?.trim() || !biographie?.trim()) {
      return res.status(400).json({ error: 'Nom, prénom, email, spécialité et biographie sont requis.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanNom = nom.trim();
    const cleanPrenom = prenom.trim();
    const cleanPhone = telephone ? telephone.trim() : '';

    // 1. Unicité stricte : une adresse e-mail ne peut créer qu'un seul compte
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .ilike('email', cleanEmail)
      .limit(1)
      .maybeSingle();

    if (existingProfile?.id) {
      return res.status(409).json({
        error: 'Cette adresse e-mail est déjà associée à un compte existant. Veuillez vous connecter.',
      });
    }

    const pwd = password && password.length >= 6 ? password : Math.random().toString(36).slice(-10) + 'A1!';
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: cleanEmail,
      password: pwd,
      email_confirm: Boolean(password && password.length >= 6),
      user_metadata: { nom: cleanNom, prenom: cleanPrenom, telephone: cleanPhone, role: 'formateur' },
    });

    if (createErr) {
      if (/already|registered|exists/i.test(createErr.message || '')) {
        return res.status(409).json({
          error: 'Cette adresse e-mail est déjà associée à un compte existant. Veuillez vous connecter.',
        });
      }
      return res.status(400).json({ error: createErr.message });
    }
    const userId = created.user.id;

    // 2. Mettre à jour ou créer le profil + trainer_profiles en statut "en_validation" (Pending)
    if (userId) {
      await supabaseAdmin.from('profiles').upsert({
        id: userId,
        nom: cleanNom,
        prenom: cleanPrenom,
        email: cleanEmail,
        telephone: cleanPhone || null,
        role: 'formateur',
        specialite: specialite.trim(),
        biographie: biographie.trim(),
        statut_compte: 'en_attente',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });

      const domaines = specialite.split(',').map((d) => d.trim()).filter(Boolean);
      const certs = Array.isArray(documents)
        ? documents
        : (documents ? [{ titre: String(documents).trim() }] : []);

      const tpRes = await supabaseAdmin.from('trainer_profiles').upsert({
        user_id: userId,
        bio: biographie.trim(),
        domaines,
        certificats: certs,
        telephone_pro: cleanPhone || null,
        statut_validation: 'en_validation',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (tpRes.error && /column/i.test(tpRes.error.message || '')) {
        await supabaseAdmin.from('trainer_profiles').upsert({
          user_id: userId,
          bio: biographie.trim(),
          domaines,
          certificats: certs,
          statut_validation: 'en_validation',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
      }
    }

    // 3. Enregistrer aussi dans contacts pour traçabilité & suivi
    await supabaseAdmin.from('contacts').insert({
      nom: `${cleanPrenom} ${cleanNom}`.trim(),
      email: cleanEmail,
      sujet: `Candidature Formateur — ${specialite.trim()}`,
      message: `Spécialité: ${specialite}\nTéléphone: ${cleanPhone || 'Non précisé'}\nÉtablissement ciblé: ${tenant_id || 'Marketplace'}\nBiographie: ${biographie}\nDocuments: ${JSON.stringify(documents || [])}`,
    });

    // 4. Notifier les super admins / gestionnaires
    try {
      const { data: admins } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .in('role', ['super_admin', 'admin']);
      if (admins) {
        for (const a of admins) {
          await supabaseAdmin.from('notifications').insert({
            user_id: a.id,
            type: 'nouveau_formateur_en_validation',
            canal: 'Dashboard',
            message: `Nouvelle candidature formateur : ${cleanPrenom} ${cleanNom} (${specialite.trim()}) en attente de validation.`,
          });
        }
      }
    } catch (_) {}

    res.status(201).json({
      success: true,
      status: 'pending',
      message: 'Votre candidature formateur a été enregistrée. Elle restera en attente jusqu’à validation par un établissement ou l’équipe DeskyWork.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/public/partner-request — Demande B2B "Espaces partenaires" (CDC v3.0)
router.post('/public/partner-request', async (req, res) => {
  try {
    const {
      nom_etablissement, ville, adresse, nb_espaces,
      activite, pack_saas, nom_contact, email, telephone, notes,
    } = req.body;

    if (!nom_etablissement?.trim() || !ville?.trim() || !adresse?.trim() || !nom_contact?.trim() || !email?.trim() || !telephone?.trim()) {
      return res.status(400).json({ error: 'Tous les champs obligatoires doivent être renseignés.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const act = ['coworking', 'centre_formation', 'mixte'].includes(activite) ? activite : 'coworking';
    const actLabels = { coworking: 'Coworking uniquement', centre_formation: 'Centre de formation uniquement', mixte: 'Coworking & Centre de formation (Mixte)' };
    const packLabels = { essentiel: 'Essentiel (90,000 DT HT/mois)', standard: 'Standard (150,000 DT HT/mois)', premium: 'Premium (220,000 DT HT/mois)' };

    // 1. Créer une trace de qualification B2B dans contacts
    const details = [
      `Établissement : ${nom_etablissement.trim()}`,
      `Ville : ${ville.trim()} | Adresse : ${adresse.trim()}`,
      `Activités : ${actLabels[act]}`,
      `Nombre d'espaces estimé : ${nb_espaces || 'Non précisé'}`,
      `Pack souhaité : ${packLabels[pack_saas] || pack_saas || 'Standard'}`,
      `Contact : ${nom_contact.trim()} | Tél : ${telephone.trim()}`,
      notes ? `Notes : ${notes.trim()}` : '',
    ].filter(Boolean).join('\n');

    await supabaseAdmin.from('contacts').insert({
      nom: `${nom_contact.trim()} (${nom_etablissement.trim()})`,
      email: cleanEmail,
      sujet: `Demande Partenaire B2B — ${nom_etablissement.trim()} [${actLabels[act]}]`,
      message: details,
    });

    // 2. Créer une pré-fiche organization en attente de validation si possible
    try {
      const slug = `${nom_etablissement.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
      await supabaseAdmin.from('organizations').insert({
        type: act === 'centre_formation' ? 'centre_formation' : 'coworking',
        nom: nom_etablissement.trim(),
        slug,
        ville: ville.trim(),
        adresse: adresse.trim(),
        telephone: telephone.trim(),
        email: cleanEmail,
        statut: 'en_validation',
        settings: {
          activite: act,
          nb_espaces: Number(nb_espaces) || 1,
          saas_pack: pack_saas || 'standard',
          contact_nom: nom_contact.trim(),
          onboarding_completed: false,
        },
      });
    } catch (_) {}

    // 3. Notifier les super admins
    try {
      const { data: superAdmins } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .or('role.eq.super_admin,is_super_admin.eq.true');
      if (superAdmins) {
        for (const sa of superAdmins) {
          await supabaseAdmin.from('notifications').insert({
            user_id: sa.id,
            type: 'nouvelle_demande_partenaire',
            canal: 'Dashboard',
            message: `Nouvelle demande partenaire B2B : ${nom_etablissement.trim()} (${ville.trim()}) — ${actLabels[act]}.`,
          });
        }
      }
    } catch (_) {}

    res.status(201).json({
      success: true,
      message: 'Votre demande partenaire a bien été enregistrée ! Notre équipe vous contactera sous 24h pour activer votre espace de gestion.',
    });
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
