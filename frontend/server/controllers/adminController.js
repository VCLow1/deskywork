// controllers/adminController.js — MODULE ADMIN : Tenant, Espaces, Membres, Conversations
const { supabaseAdmin } = require('../config/supabase');
const { applyTenantFilter } = require('../middleware/guards');

// ── GET /api/admin/tenant ─────────────────────────────────────────────────
async function getTenant(req, res) {
  if (!req.tenantId) return res.status(404).json({ error: 'Aucun coworking associé à votre compte.' });

  const { data: tenant, error } = await supabaseAdmin
    .from('tenants')
    .select('*')
    .eq('id', req.tenantId)
    .single();

  if (error || !tenant) return res.status(404).json({ error: 'Coworking introuvable.' });

  const { count: spaceCount } = await supabaseAdmin
    .from('espaces')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', req.tenantId);

  res.json({
    tenant,
    space_count: spaceCount || 0,
    onboarding_completed: tenant.settings?.onboarding_completed === true,
  });
}

// ── PATCH /api/admin/tenant ───────────────────────────────────────────────
async function updateTenant(req, res) {
  if (!req.tenantId) return res.status(404).json({ error: 'Aucun coworking associé à votre compte.' });

  const allowed = ['nom', 'description', 'adresse', 'ville', 'pays', 'email', 'telephone', 'site_web', 'logo_url', 'cover_url'];
  const updates = { updated_at: new Date().toISOString() };

  for (const field of allowed) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  // CDC v3.0 : fusion sécurisée de settings (activite, tarif_depassement_heure, auto_confirmation, gallery_photos, equipements, domiciliation)
  if (
    req.body.settings !== undefined ||
    req.body.activite !== undefined ||
    req.body.tarif_depassement_heure !== undefined ||
    req.body.auto_confirmation !== undefined ||
    req.body.gallery_photos !== undefined ||
    req.body.equipements !== undefined ||
    req.body.domiciliation !== undefined
  ) {
    const { data: curTenant } = await supabaseAdmin.from('tenants').select('settings').eq('id', req.tenantId).maybeSingle();
    const curSettings = (curTenant && curTenant.settings && typeof curTenant.settings === 'object') ? curTenant.settings : {};
    const nextSettings = { ...curSettings, ...(req.body.settings && typeof req.body.settings === 'object' ? req.body.settings : {}) };
    if (['coworking', 'centre_formation', 'mixte'].includes(req.body.activite)) nextSettings.activite = req.body.activite;
    if (req.body.tarif_depassement_heure !== undefined) nextSettings.tarif_depassement_heure = Number(req.body.tarif_depassement_heure) || 0;
    if (req.body.auto_confirmation !== undefined) nextSettings.auto_confirmation = Boolean(req.body.auto_confirmation);
    if (Array.isArray(req.body.gallery_photos)) nextSettings.gallery_photos = req.body.gallery_photos.filter(Boolean);
    if (Array.isArray(req.body.equipements)) nextSettings.equipements = req.body.equipements.filter(Boolean);
    if (req.body.domiciliation !== undefined) {
      nextSettings.domiciliation = {
        actif: Boolean(req.body.domiciliation?.actif),
        tarif_mensuel: Number(req.body.domiciliation?.tarif_mensuel) || 0,
        tarif_annuel: Number(req.body.domiciliation?.tarif_annuel) || 0,
        description: String(req.body.domiciliation?.description || '').trim(),
      };
    }
    updates.settings = nextSettings;
  }

  if (Object.keys(updates).length === 1) return res.status(400).json({ error: 'Aucune mise à jour fournie.' });

  const { data, error } = await supabaseAdmin
    .from('tenants')
    .update(updates)
    .eq('id', req.tenantId)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ tenant: data });
}

// ── POST /api/admin/espaces ───────────────────────────────────────────────
async function createEspace(req, res) {
  if (!req.tenantId) return res.status(404).json({ error: 'Aucun coworking associé à votre compte.' });

  const {
    nom, type, capacite, tarif_horaire, tarif_journalier, tarif_mensuel,
    description, equipements, horaires, statut, actif, photo_url, photos_urls
  } = req.body;
  if (!nom || !type || !capacite) {
    return res.status(400).json({ error: 'Nom, type et capacité sont requis.' });
  }

  const validTypes = ['open_space', 'private_office', 'meeting_room', 'training_room', 'event_space', 'hot_desk', 'dedicated_desk'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: "Type d'espace invalide." });
  }

  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('limite_espaces')
    .eq('id', req.tenantId)
    .single();

  const { count: currentCount } = await supabaseAdmin
    .from('espaces')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', req.tenantId);

  if (currentCount >= (tenant?.limite_espaces || 10)) {
    return res.status(400).json({ error: "Limite d'espaces atteinte pour votre plan." });
  }

  const isActif = statut !== undefined ? statut === 'actif' : (actif !== undefined ? Boolean(actif) : true);
  const insertData = {
    nom: String(nom).trim(),
    type,
    capacite: parseInt(capacite, 10),
    tarif_horaire: parseFloat(tarif_horaire) || 0,
    tarif_journalier: parseFloat(tarif_journalier) || 0,
    tarif_mensuel: parseFloat(tarif_mensuel) || 0,
    description: description || null,
    horaires: horaires || '08:00 - 20:00',
    statut: statut || (isActif ? 'actif' : 'inactif'),
    actif: isActif,
    equipements: Array.isArray(equipements) ? equipements : [],
    tenant_id: req.tenantId,
  };
  if (photo_url !== undefined) insertData.photo_url = photo_url;
  if (photos_urls !== undefined) insertData.photos_urls = photos_urls;

  let { data, error } = await supabaseAdmin
    .from('espaces')
    .insert(insertData)
    .select()
    .single();

  if (error && /column|does not exist/i.test(error.message || '')) {
    const fallbackData = {
      nom: String(nom).trim(),
      type,
      capacite: parseInt(capacite, 10),
      tarif_horaire: parseFloat(tarif_horaire) || 0,
      description: description || null,
      actif: isActif,
      tenant_id: req.tenantId,
    };
    if (photo_url) fallbackData.photo_url = photo_url;
    if (Array.isArray(equipements)) fallbackData.equipements = equipements;
    ({ data, error } = await supabaseAdmin.from('espaces').insert(fallbackData).select().single());
  }

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ espace: data });
}

// ── PATCH /api/admin/espaces/:id ──────────────────────────────────────────
async function updateEspace(req, res) {
  if (!req.tenantId) return res.status(404).json({ error: 'Aucun coworking associé à votre compte.' });

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('espaces')
    .select('id')
    .eq('id', req.params.id)
    .eq('tenant_id', req.tenantId)
    .single();

  if (fetchErr || !existing) return res.status(404).json({ error: 'Espace introuvable.' });

  const allowed = [
    'nom', 'type', 'capacite', 'tarif_horaire', 'tarif_journalier', 'tarif_mensuel',
    'description', 'equipements', 'horaires', 'statut', 'actif', 'photo_url', 'photos_urls'
  ];
  const updates = {};
  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      if (['tarif_horaire', 'tarif_journalier', 'tarif_mensuel'].includes(field)) {
        updates[field] = parseFloat(req.body[field]) || 0;
      } else if (field === 'capacite') {
        updates[field] = parseInt(req.body[field], 10);
      } else if (field === 'statut') {
        updates[field] = req.body[field];
        updates.actif = req.body[field] === 'actif';
      } else {
        updates[field] = req.body[field];
      }
    }
  }

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Aucune mise à jour fournie.' });

  let { data, error } = await supabaseAdmin
    .from('espaces')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error && /column|does not exist/i.test(error.message || '')) {
    const safeUpdates = { ...updates };
    delete safeUpdates.tarif_journalier;
    delete safeUpdates.tarif_mensuel;
    delete safeUpdates.horaires;
    delete safeUpdates.statut;
    ({ data, error } = await supabaseAdmin.from('espaces').update(safeUpdates).eq('id', req.params.id).select().single());
  }

  if (error) return res.status(400).json({ error: error.message });
  res.json({ espace: data });
}

// ── DELETE /api/admin/espaces/:id ─────────────────────────────────────────
async function deleteEspace(req, res) {
  if (!req.tenantId) return res.status(404).json({ error: 'Aucun coworking associé à votre compte.' });

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('espaces')
    .select('id, nom')
    .eq('id', req.params.id)
    .eq('tenant_id', req.tenantId)
    .single();

  if (fetchErr || !existing) return res.status(404).json({ error: 'Espace introuvable.' });

  const { error } = await supabaseAdmin.from('espaces').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: `Espace "${existing.nom}" supprimé.` });
}

// ── POST /api/admin/onboarding/complete ───────────────────────────────────
async function completeOnboarding(req, res) {
  if (!req.tenantId) return res.status(404).json({ error: 'Aucun coworking associé à votre compte.' });

  const { count: spaceCount } = await supabaseAdmin
    .from('espaces')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', req.tenantId);

  if (!spaceCount || spaceCount < 1) {
    return res.status(400).json({ error: 'Ajoutez au moins un espace avant de terminer la configuration.' });
  }

  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('settings')
    .eq('id', req.tenantId)
    .single();

  const settings = { ...(tenant?.settings || {}), onboarding_completed: true };

  const { data, error } = await supabaseAdmin
    .from('tenants')
    .update({ settings, updated_at: new Date().toISOString() })
    .eq('id', req.tenantId)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ tenant: data, message: 'Configuration terminée avec succès.' });
}

// ── GET /api/admin/members ─────────────────────────────────────────────────
async function listMembers(req, res) {
  const { search = '' } = req.query;

  let query = supabaseAdmin
    .from('profiles')
    .select('id, nom, prenom, email, telephone, type_membre, role, created_at')
    .in('role', ['member', 'guest', 'formateur'])
    .order('nom', { ascending: true });

  query = applyTenantFilter(query, req);

  if (search.trim()) {
    query = query.or(`nom.ilike.%${search}%,prenom.ilike.%${search}%,email.ilike.%${search}%`);
  }

  const { data, error } = await query.limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ members: data || [] });
}

// ── POST /api/admin/conversations ─────────────────────────────────────────
async function createAdminConversation(req, res) {
  const { member_id, title } = req.body;
  if (!member_id) return res.status(400).json({ error: 'member_id requis.' });

  const { data: member } = await supabaseAdmin
    .from('profiles')
    .select('id, nom, prenom')
    .eq('id', member_id)
    .single();

  if (!member) return res.status(404).json({ error: 'Membre introuvable.' });

  // Vérifier si une conversation support existe déjà entre cet admin et ce membre
  const { data: existingMemberships } = await supabaseAdmin
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', req.user.id);

  if (existingMemberships && existingMemberships.length > 0) {
    const adminConvIds = existingMemberships.map(m => m.conversation_id);
    const { data: memberInConvs } = await supabaseAdmin
      .from('conversation_members')
      .select('conversation_id')
      .in('conversation_id', adminConvIds)
      .eq('user_id', member_id);

    if (memberInConvs && memberInConvs.length > 0) {
      const convId = memberInConvs[0].conversation_id;
      const { data: conv } = await supabaseAdmin.from('conversations').select('*').eq('id', convId).single();
      return res.json({ conversation: conv, existing: true });
    }
  }

  const convTitle = title || `${member.prenom} ${member.nom}`;
  const { data: conv, error } = await supabaseAdmin
    .from('conversations')
    .insert({ title: convTitle, type: 'support', created_by: req.user.id, tenant_id: req.tenantId })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await supabaseAdmin.from('conversation_members').insert([
    { conversation_id: conv.id, user_id: req.user.id },
    { conversation_id: conv.id, user_id: member_id },
  ]);

  const { emitToUser } = require('../services/socketService');
  emitToUser(member_id, 'conversation:update', {
    conversation_id: conv.id,
    last_message: null,
    title: convTitle,
  });

  res.status(201).json({ conversation: conv, existing: false });
}

// ── GET /api/admin/conversations ──────────────────────────────────────────
async function listAdminConversations(req, res) {
  const { page = 1, limit = 50, search = '' } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = supabaseAdmin
    .from('conversations')
    .select('*', { count: 'exact' })
    .order('updated_at', { ascending: false });

  query = applyTenantFilter(query, req);

  const { data: conversations, error, count } = await query.range(offset, offset + parseInt(limit) - 1);
  if (error) return res.status(500).json({ error: error.message });

  const enriched = await Promise.all((conversations || []).map(async (conv) => {
    const { data: members } = await supabaseAdmin
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conv.id);

    const memberIds = (members || []).map(m => m.user_id);

    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, nom, prenom, email, role, type_membre')
      .in('id', memberIds);

    const memberProfile = (profiles || []).find(p => !['super_admin', 'admin', 'staff'].includes(p.role));
    const staffProfiles = (profiles || []).filter(p => ['super_admin', 'admin', 'staff'].includes(p.role));

    const { data: lastMsg } = await supabaseAdmin
      .from('messages')
      .select('id, content, sender_id, created_at')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: adminMembership } = await supabaseAdmin
      .from('conversation_members')
      .select('last_read_at')
      .eq('conversation_id', conv.id)
      .eq('user_id', req.user.id)
      .maybeSingle();

    const lastRead = adminMembership?.last_read_at || '1970-01-01T00:00:00Z';
    const { count: unreadCount } = await supabaseAdmin
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conv.id)
      .neq('sender_id', req.user.id)
      .gt('created_at', lastRead);

    return {
      ...conv,
      member: memberProfile || null,
      staff: staffProfiles || [],
      last_message: lastMsg,
      unread_count: unreadCount || 0,
    };
  }));

  let result = enriched;
  if (search.trim()) {
    const s = search.toLowerCase();
    result = enriched.filter(c =>
      c.member && (
        (c.member.nom || '').toLowerCase().includes(s) ||
        (c.member.prenom || '').toLowerCase().includes(s) ||
        (c.member.email || '').toLowerCase().includes(s)
      )
    );
  }

  res.json({ conversations: result, pagination: { page: parseInt(page), limit: parseInt(limit), total: count || 0 } });
}

// ── POST /api/upload ──────────────────────────────────────────────────────
async function uploadPhoto(req, res) {
  try {
    const { base64Data, fileName, fileType, folder } = req.body;

    if (!base64Data || !fileName) {
      return res.status(400).json({ error: 'base64Data et fileName sont requis.' });
    }

    const cleanType = String(fileType || '').toLowerCase();
    const validMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
    if (cleanType && !validMimes.includes(cleanType)) {
      return res.status(400).json({ error: 'Format d\'image non supporté. Formats acceptés : JPEG, PNG, WEBP, GIF, SVG.' });
    }

    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'La taille de l\'image ne doit pas dépasser 5 Mo.' });
    }

    const ext = fileName.split('.').pop()?.toLowerCase() || 'jpg';
    const targetFolder = folder || 'espaces';
    const primaryBucket = ['avatars', 'documents'].includes(targetFolder) ? targetFolder : 'coworking-images';
    const candidateBuckets = [primaryBucket, 'coworking-images', 'documents', 'avatars'].filter((v, i, a) => a.indexOf(v) === i);

    let publicUrl = null;
    let lastError = null;

    for (const b of candidateBuckets) {
      try {
        const targetPath = `${targetFolder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabaseAdmin.storage
          .from(b)
          .upload(targetPath, buffer, {
            contentType: fileType || 'image/jpeg',
            upsert: true,
          });

        if (!upErr) {
          const { data: pubData } = supabaseAdmin.storage.from(b).getPublicUrl(targetPath);
          if (pubData?.publicUrl) {
            publicUrl = pubData.publicUrl;
            break;
          }
        } else {
          lastError = upErr;
        }
      } catch (e) {
        lastError = e;
      }
    }

    if (!publicUrl) {
      return res.status(400).json({ error: `Upload échoué : ${lastError?.message || 'Impossible d\'enregistrer l\'image.'}` });
    }

    // Si c'est l'avatar de l'utilisateur connecté, persister aussi dans profiles et metadata
    if (folder === 'avatars' && req.user?.id) {
      try {
        await supabaseAdmin
          .from('profiles')
          .update({ photo_url: publicUrl, updated_at: new Date().toISOString() })
          .eq('id', req.user.id);

        await supabaseAdmin.auth.admin.updateUserById(req.user.id, {
          user_metadata: { photo_url: publicUrl, avatar_url: publicUrl },
        });
      } catch (_) {}
    }

    res.json({ publicUrl });
  } catch (err) {
    console.error('❌ Erreur uploadPhoto:', err);
    res.status(500).json({ error: err.message || 'Erreur lors de l\'upload de la photo.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CDC v3.0 — CONSTANTES PACKS SAAS & HELPERS
// ══════════════════════════════════════════════════════════════════════════════
const SAAS_PACKS = {
  essentiel: {
    key: 'essentiel',
    name: 'Essentiel',
    prix: 90,
    max_espaces: 10,
    max_membres: 100,
    max_staff: 1,
    features: [
      'Jusqu\'à 10 espaces / ressources',
      'Jusqu\'à 100 membres actifs',
      '1 compte Staff / Réceptionniste',
      'Paiements sur place & Reçus PDF numérotés',
      'Alertes In-App & E-mail automatiques',
    ],
  },
  standard: {
    key: 'standard',
    name: 'Standard',
    prix: 150,
    max_espaces: 30,
    max_membres: 500,
    max_staff: 3,
    features: [
      'Tout Essentiel inclus',
      'Jusqu\'à 30 espaces / ressources',
      'Jusqu\'à 500 membres actifs',
      'Jusqu\'à 3 comptes Staff / Réceptionniste',
      'Rapports avancés & exports Excel / PDF',
      'Codes promo, abonnements membres & crédits',
    ],
  },
  premium: {
    key: 'premium',
    name: 'Premium',
    prix: 220,
    max_espaces: null,
    max_membres: null,
    max_staff: 10,
    features: [
      'Tout Standard inclus',
      'Espaces & membres illimités',
      'Jusqu\'à 10 comptes Staff / Réceptionniste',
      'Statistiques fiche Marketplace (vues, clics, conversions)',
      'Mise en avant prioritaire sur la Marketplace',
    ],
  },
};

function resolveTenantPack(tenant) {
  const raw = String(tenant?.settings?.saas_pack || tenant?.plan || 'essentiel').toLowerCase().trim();
  const isPartner = Boolean(
    tenant?.settings?.partenaire_officiel ||
    tenant?.settings?.tarif_partenaire ||
    tenant?.slug === 'nero-coworking' ||
    tenant?.slug === 'thirty-three-space' ||
    tenant?.id === 'a1111111-1111-4111-8111-111111111111' ||
    tenant?.id === 'a3333333-3333-4333-8333-333333333333'
  );
  const key = (isPartner || raw.includes('prem') || raw.includes('enterp'))
    ? 'premium'
    : (raw.includes('stand') || raw.includes('pro'))
      ? 'standard'
      : 'essentiel';
  const base = SAAS_PACKS[key];
  const customPrix = isPartner
    ? 90
    : Number(tenant?.montant_mensuel !== null && tenant?.montant_mensuel !== undefined ? tenant.montant_mensuel : base.prix);
  return {
    ...base,
    name: isPartner ? 'Premium (Partenaire Officiel)' : base.name,
    is_partner: isPartner,
    max_espaces: isPartner ? null : (tenant?.limite_espaces ?? base.max_espaces),
    max_membres: isPartner ? null : (tenant?.limite_membres ?? base.max_membres),
    max_staff: isPartner ? 10 : (tenant?.settings?.limite_staff ?? base.max_staff),
    prix: customPrix,
    remise_partenaire: isPartner ? 'Tarif préférentiel partenaire : 90 DT / mois (au lieu de 220 DT)' : null,
  };
}

function buildDeskyWorkInvoices(tenant, pack) {
  const saved = Array.isArray(tenant?.settings?.factures_deskywork) ? tenant.settings.factures_deskywork : [];
  if (saved.length > 0) return saved;

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dueDate = tenant?.prochaine_echeance ? new Date(tenant.prochaine_echeance) : null;
  const lastPaid = tenant?.derniere_facture ? new Date(tenant.derniere_facture) : null;

  let statut = 'Émise';
  if (lastPaid && lastPaid.getFullYear() === yyyy && lastPaid.getMonth() === now.getMonth()) {
    statut = 'Payée';
  } else if (dueDate && dueDate < now) {
    statut = 'En retard';
  }

  const currentInvoice = {
    id: `DW-${yyyy}-${mm}`,
    numero: `DW-${yyyy}-${mm}`,
    periode: now.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
    pack: pack.name,
    montant: pack.prix,
    statut,
    date_emission: new Date(yyyy, now.getMonth(), 1).toISOString(),
    date_echeance: dueDate ? dueDate.toISOString() : new Date(yyyy, now.getMonth(), 15).toISOString(),
    date_paiement: lastPaid ? lastPaid.toISOString() : null,
  };
  return [currentInvoice];
}

const DEFAULT_ALERT_SETTINGS = {
  alerte_fin_session_inapp: true,
  alerte_depassement_inapp: true,
  confirmation_reservation_email: true,
  recu_paiement_email: true,
  rappel_echeance_abonnement_email: true,
  relance_impaye_email: false,
  nouvelle_inscription_email: true,
};

// ── GET /api/admin/global-search?q=... ───────────────────────────────────────
async function globalSearch(req, res) {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ membres: [], reservations: [], espaces: [] });

    const like = `%${q}%`;
    const tid = req.tenantId;

    let memQ = supabaseAdmin
      .from('profiles')
      .select('id, nom, prenom, email, telephone, role, type_membre, statut_compte')
      .in('role', ['member', 'guest', 'formateur', 'staff'])
      .or(`nom.ilike.${like},prenom.ilike.${like},email.ilike.${like},telephone.ilike.${like}`)
      .limit(6);
    if (tid) memQ = memQ.eq('tenant_id', tid);

    let espQ = supabaseAdmin
      .from('espaces')
      .select('id, nom, type, capacite, tarif_horaire, actif')
      .or(`nom.ilike.${like},type.ilike.${like}`)
      .limit(6);
    if (tid) espQ = espQ.eq('tenant_id', tid);

    let resQ = supabaseAdmin
      .from('reservations')
      .select('id, date_debut, date_fin, statut, guest_nom, guest_email, notes, spaces:espaces(id, nom), profiles!user_id(id, nom, prenom, email)')
      .order('date_debut', { ascending: false })
      .limit(60);
    if (tid) resQ = resQ.eq('tenant_id', tid);

    const [{ data: membres }, { data: espaces }, { data: recentRes }] = await Promise.all([memQ, espQ, resQ]);

    const lower = q.toLowerCase();
    const reservations = (recentRes || [])
      .filter((r) => {
        const hay = [
          r.id,
          r.guest_nom,
          r.guest_email,
          r.spaces?.nom,
          r.profiles?.nom,
          r.profiles?.prenom,
          r.profiles?.email,
          r.notes,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(lower);
      })
      .slice(0, 6);

    res.json({
      membres: membres || [],
      reservations,
      espaces: espaces || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/admin/clients/overview ──────────────────────────────────────────
async function getClientsOverview(req, res) {
  try {
    const tid = req.tenantId;

    let profQ = supabaseAdmin
      .from('profiles')
      .select('id, nom, prenom, email, telephone, role, type_membre, statut_compte, created_at')
      .in('role', ['member', 'guest'])
      .order('created_at', { ascending: false });
    let guestQ = supabaseAdmin.from('guests').select('*').order('created_at', { ascending: false });
    let resQ = supabaseAdmin
      .from('reservations')
      .select('id, user_id, espace_id, date_debut, date_fin, statut, montant_total, mode_reservation, guest_nom, guest_email, guest_telephone, notes, created_at, espaces(id, nom, type)')
      .order('created_at', { ascending: false });
    let payQ = supabaseAdmin.from('paiements').select('id, user_id, reservation_id, montant, statut, mode, created_at');
    let aboQ = supabaseAdmin.from('abonnements').select('id, user_id, type, statut, date_debut, date_fin');
    let contQ = supabaseAdmin.from('contenu_documents').select('*');
    let docMemQ = supabaseAdmin
      .from('documents_membres')
      .select('*, profiles:user_id(id, nom, prenom, email)')
      .order('created_at', { ascending: false });

    if (tid) {
      profQ = profQ.eq('tenant_id', tid);
      guestQ = guestQ.eq('tenant_id', tid);
      resQ = resQ.eq('tenant_id', tid);
      payQ = payQ.eq('tenant_id', tid);
      aboQ = aboQ.eq('tenant_id', tid);
      contQ = contQ.eq('tenant_id', tid);
      docMemQ = docMemQ.eq('tenant_id', tid);
    }

    const [
      { data: profiles },
      { data: guests },
      { data: reservations },
      { data: paiements },
      { data: abonnements },
      { data: contenus },
      { data: signatures },
    ] = await Promise.all([profQ, guestQ, resQ, payQ, aboQ, contQ, docMemQ]);

    const resByUser = {};
    (reservations || []).forEach((r) => {
      if (!r.user_id) return;
      if (!resByUser[r.user_id]) resByUser[r.user_id] = [];
      resByUser[r.user_id].push(r);
    });

    const payByUser = {};
    (paiements || []).forEach((p) => {
      if (!p.user_id) return;
      if (!payByUser[p.user_id]) payByUser[p.user_id] = { paye: 0, du: 0 };
      const m = parseFloat(p.montant || 0);
      if (p.statut === 'paid') payByUser[p.user_id].paye += m;
      else if (p.statut === 'pending') payByUser[p.user_id].du += m;
    });

    const aboByUser = {};
    (abonnements || []).forEach((a) => {
      if (a.user_id && a.statut === 'active') aboByUser[a.user_id] = a;
    });

    const members = (profiles || []).map((m) => ({
      ...m,
      reservations_count: (resByUser[m.id] || []).length,
      total_paye: Number((payByUser[m.id]?.paye || 0).toFixed(3)),
      total_du: Number((payByUser[m.id]?.du || 0).toFixed(3)),
      abonnement_actif: aboByUser[m.id] || null,
    }));

    const entrepriseMap = new Map();
    members
      .filter((m) => m.type_membre === 'entreprise')
      .forEach((m) => {
        entrepriseMap.set(m.id, {
          id: m.id,
          raison_sociale: `${m.prenom || ''} ${m.nom || ''}`.trim() || m.email,
          contact_nom: `${m.prenom || ''} ${m.nom || ''}`.trim(),
          email: m.email,
          telephone: m.telephone || '—',
          matricule_fiscale: null,
          adresse: null,
          reservations_count: m.reservations_count,
          total_ca: m.total_paye,
          total_du: m.total_du,
          source: 'compte_entreprise',
        });
      });

    (reservations || []).forEach((r) => {
      let parsed = null;
      if (r.notes && String(r.notes).trim().startsWith('{')) {
        try { parsed = JSON.parse(r.notes); } catch (_) {}
      }
      const isEnt = r.mode_reservation === 'entreprise' || Boolean(parsed?.raison_sociale || parsed?.entreprise || parsed?.matricule_fiscale);
      if (!isEnt) return;

      const key = parsed?.raison_sociale || parsed?.entreprise || r.user_id || r.guest_email || r.id;
      const prev = entrepriseMap.get(key) || {
        id: r.user_id || r.id,
        raison_sociale: parsed?.raison_sociale || parsed?.entreprise || r.guest_nom || 'Client Entreprise',
        contact_nom: r.guest_nom || parsed?.contact_nom || '—',
        email: r.guest_email || parsed?.email || '—',
        telephone: r.guest_telephone || parsed?.telephone || '—',
        matricule_fiscale: parsed?.matricule_fiscale || null,
        adresse: parsed?.adresse || null,
        reservations_count: 0,
        total_ca: 0,
        total_du: 0,
        source: 'reservation',
      };
      prev.reservations_count += 1;
      prev.total_ca = Number((prev.total_ca + parseFloat(r.montant_total || 0)).toFixed(3));
      entrepriseMap.set(key, prev);
    });

    res.json({
      members,
      guests: guests || [],
      entreprises: Array.from(entrepriseMap.values()),
      documents: {
        contenus: contenus || [],
        signatures: signatures || [],
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── POST /api/admin/members — Créer rapidement un membre ────────────────────
async function createMember(req, res) {
  try {
    const { nom, prenom, email, telephone = '', type_membre = 'particulier', password } = req.body;
    if (!nom || !email) {
      return res.status(400).json({ error: 'Le nom et l\'e-mail sont obligatoires.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('id, email')
      .ilike('email', cleanEmail)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'Un compte existe déjà avec cette adresse e-mail.' });
    }

    if (req.tenantId) {
      const { data: tenant } = await supabaseAdmin.from('tenants').select('*').eq('id', req.tenantId).single();
      const pack = resolveTenantPack(tenant);
      if (pack.max_membres) {
        const { count } = await supabaseAdmin
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', req.tenantId)
          .in('role', ['member', 'guest']);
        if ((count || 0) >= pack.max_membres) {
          return res.status(403).json({
            error: `Limite du pack ${pack.name} atteinte (${pack.max_membres} membres max). Passez au pack supérieur.`,
            code: 'PACK_MEMBER_LIMIT_REACHED',
          });
        }
      }
    }

    const tempPassword = password && String(password).length >= 8
      ? String(password)
      : `Dw!${Math.random().toString(36).slice(2, 8)}${Math.floor(100 + Math.random() * 899)}A`;

    const { data: createdAuth, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: cleanEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { nom, prenom: prenom || '', role: 'member', tenant_id: req.tenantId },
    });

    if (authErr || !createdAuth?.user) {
      return res.status(400).json({ error: authErr?.message || 'Impossible de créer le compte auth.' });
    }

    const uid = createdAuth.user.id;
    const { data: profile, error: profErr } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: uid,
        nom: String(nom).trim(),
        prenom: String(prenom || '').trim(),
        email: cleanEmail,
        telephone: String(telephone || '').trim() || null,
        role: 'member',
        type_membre: type_membre === 'entreprise' ? 'entreprise' : 'particulier',
        statut_compte: 'actif',
        tenant_id: req.tenantId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (profErr) {
      try { await supabaseAdmin.auth.admin.deleteUser(uid); } catch (_) {}
      return res.status(400).json({ error: profErr.message });
    }

    try {
      await supabaseAdmin.from('memberships').upsert({
        user_id: uid,
        tenant_id: req.tenantId,
        role: 'member',
        statut: 'actif',
      }, { onConflict: 'user_id,tenant_id' });
    } catch (_) {}

    res.status(201).json({
      member: profile,
      temporary_password: password ? undefined : tempPassword,
      message: `Membre ${prenom || ''} ${nom} créé avec succès.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/admin/members/:id/history ──────────────────────────────────────
async function getMemberHistory(req, res) {
  try {
    const memberId = req.params.id;
    const tid = req.tenantId;

    const { data: member, error: memErr } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', memberId)
      .single();
    if (memErr || !member) return res.status(404).json({ error: 'Membre introuvable.' });
    if (tid && member.tenant_id && member.tenant_id !== tid) {
      return res.status(403).json({ error: 'Accès non autorisé.' });
    }

    let rQ = supabaseAdmin
      .from('reservations')
      .select('id, date_debut, date_fin, statut, montant_total, espaces(nom, type)')
      .eq('user_id', memberId)
      .order('date_debut', { ascending: false })
      .limit(30);
    let pQ = supabaseAdmin
      .from('paiements')
      .select('id, montant, statut, mode, numero_recu, date_paiement, created_at, reference_externe')
      .eq('user_id', memberId)
      .order('created_at', { ascending: false })
      .limit(30);
    let cQ = supabaseAdmin
      .from('credits_membres')
      .select('*')
      .eq('user_id', memberId)
      .order('created_at', { ascending: false })
      .limit(20);
    let dQ = supabaseAdmin
      .from('documents_membres')
      .select('*')
      .eq('user_id', memberId)
      .order('created_at', { ascending: false });

    if (tid) {
      rQ = rQ.eq('tenant_id', tid);
      pQ = pQ.eq('tenant_id', tid);
      cQ = cQ.eq('tenant_id', tid);
      dQ = dQ.eq('tenant_id', tid);
    }

    const [{ data: reservations }, { data: paiements }, { data: credits }, { data: documents }] = await Promise.all([
      rQ, pQ, cQ, dQ,
    ]);

    res.json({
      member,
      reservations: reservations || [],
      paiements: paiements || [],
      credits: credits || [],
      documents: documents || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GESTION ÉQUIPE (STAFF) ──────────────────────────────────────────────────
async function listStaff(req, res) {
  try {
    const tid = req.tenantId;
    const { data: tenant } = tid
      ? await supabaseAdmin.from('tenants').select('*').eq('id', tid).single()
      : { data: null };

    const pack = resolveTenantPack(tenant);
    const { data: staff, error } = await supabaseAdmin
      .from('profiles')
      .select('id, nom, prenom, email, telephone, role, statut_compte, created_at')
      .eq('tenant_id', tid)
      .eq('role', 'staff')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    const permMap = tenant?.settings?.staff_permissions || {};
    const enriched = (staff || []).map((s) => ({
      ...s,
      permissions: {
        agenda_checkin: true,
        reservations: true,
        encaissement_place: true,
        membres_lecture: true,
        tarifs_acces: false,
        rapports_financiers: false,
        equipe_gestion: false,
        ...(permMap[s.id] || {}),
        tarifs_acces: false,
        rapports_financiers: false,
        equipe_gestion: false,
      },
    }));

    res.json({
      staff: enriched,
      quota: {
        used: enriched.length,
        max: pack.max_staff,
        pack: pack.name,
        remaining: Math.max(0, pack.max_staff - enriched.length),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createStaff(req, res) {
  try {
    const { nom, prenom = '', email, telephone = '', password } = req.body;
    if (!nom || !email) return res.status(400).json({ error: 'Nom et e-mail requis.' });

    const cleanEmail = String(email).trim().toLowerCase();
    const { data: tenant } = await supabaseAdmin.from('tenants').select('*').eq('id', req.tenantId).single();
    const pack = resolveTenantPack(tenant);

    const { count: currentStaffCount } = await supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', req.tenantId)
      .eq('role', 'staff');

    if ((currentStaffCount || 0) >= pack.max_staff) {
      return res.status(403).json({
        error: `Quota Staff du pack ${pack.name} atteint (${currentStaffCount}/${pack.max_staff}). Passez au pack supérieur pour ajouter un autre réceptionniste.`,
        code: 'STAFF_QUOTA_REACHED',
      });
    }

    const { data: existing } = await supabaseAdmin.from('profiles').select('id').ilike('email', cleanEmail).maybeSingle();
    if (existing) return res.status(409).json({ error: 'Cette adresse e-mail est déjà utilisée.' });

    const tempPassword = password && String(password).length >= 8
      ? String(password)
      : `Stf!${Math.random().toString(36).slice(2, 8)}${Math.floor(100 + Math.random() * 899)}`;

    const { data: createdAuth, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: cleanEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { nom, prenom, role: 'staff', tenant_id: req.tenantId },
    });
    if (authErr || !createdAuth?.user) {
      return res.status(400).json({ error: authErr?.message || 'Échec création compte Staff.' });
    }

    const uid = createdAuth.user.id;
    const { data: profile, error: profErr } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: uid,
        nom: String(nom).trim(),
        prenom: String(prenom || '').trim(),
        email: cleanEmail,
        telephone: String(telephone || '').trim() || null,
        role: 'staff',
        statut_compte: 'actif',
        tenant_id: req.tenantId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (profErr) {
      try { await supabaseAdmin.auth.admin.deleteUser(uid); } catch (_) {}
      return res.status(400).json({ error: profErr.message });
    }

    res.status(201).json({
      staff: profile,
      temporary_password: password ? undefined : tempPassword,
      message: `Compte Staff créé pour ${prenom ? prenom + ' ' : ''}${nom}.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateStaff(req, res) {
  try {
    const { id } = req.params;
    const { data: target } = await supabaseAdmin
      .from('profiles')
      .select('id, role, tenant_id')
      .eq('id', id)
      .single();

    if (!target || target.role !== 'staff' || target.tenant_id !== req.tenantId) {
      return res.status(404).json({ error: 'Compte Staff introuvable.' });
    }

    const updates = { updated_at: new Date().toISOString() };
    if (req.body.nom !== undefined) updates.nom = String(req.body.nom).trim();
    if (req.body.prenom !== undefined) updates.prenom = String(req.body.prenom).trim();
    if (req.body.telephone !== undefined) updates.telephone = String(req.body.telephone || '').trim() || null;
    if (['actif', 'suspendu'].includes(req.body.statut_compte)) updates.statut_compte = req.body.statut_compte;

    const { data, error } = await supabaseAdmin.from('profiles').update(updates).eq('id', id).select().single();
    if (error) return res.status(400).json({ error: error.message });

    if (req.body.permissions && typeof req.body.permissions === 'object') {
      const { data: t } = await supabaseAdmin.from('tenants').select('settings').eq('id', req.tenantId).maybeSingle();
      const s = t?.settings || {};
      const permMap = { ...(s.staff_permissions || {}) };
      permMap[id] = {
        agenda_checkin: req.body.permissions.agenda_checkin !== false,
        reservations: req.body.permissions.reservations !== false,
        encaissement_place: req.body.permissions.encaissement_place !== false,
        membres_lecture: req.body.permissions.membres_lecture !== false,
        tarifs_acces: false,
        rapports_financiers: false,
        equipe_gestion: false,
      };
      await supabaseAdmin.from('tenants').update({ settings: { ...s, staff_permissions: permMap } }).eq('id', req.tenantId);
    }

    res.json({ staff: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteStaff(req, res) {
  try {
    const { id } = req.params;
    const { data: target } = await supabaseAdmin
      .from('profiles')
      .select('id, role, tenant_id, nom, prenom')
      .eq('id', id)
      .single();

    if (!target || target.role !== 'staff' || target.tenant_id !== req.tenantId) {
      return res.status(404).json({ error: 'Compte Staff introuvable.' });
    }

    try { await supabaseAdmin.auth.admin.deleteUser(id); } catch (_) {}
    await supabaseAdmin.from('profiles').delete().eq('id', id);
    res.json({ message: `Compte Staff "${target.prenom || ''} ${target.nom}" supprimé.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── MON ABONNEMENT DESKYWORK ──────────────────────────────────────────────────
async function getSubscriptionOverview(req, res) {
  try {
    const tid = req.tenantId;
    const { data: tenant, error } = await supabaseAdmin.from('tenants').select('*').eq('id', tid).single();
    if (error || !tenant) return res.status(404).json({ error: 'Établissement introuvable.' });

    const pack = resolveTenantPack(tenant);
    const [{ count: espacesCount }, { count: membresCount }, { count: staffCount }] = await Promise.all([
      supabaseAdmin.from('espaces').select('*', { count: 'exact', head: true }).eq('tenant_id', tid),
      supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).eq('tenant_id', tid).in('role', ['member', 'guest']),
      supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).eq('tenant_id', tid).eq('role', 'staff'),
    ]);

    const invoices = buildDeskyWorkInvoices(tenant, pack);

    res.json({
      pack,
      all_packs: Object.values(SAAS_PACKS),
      tenant: {
        id: tenant.id,
        nom: tenant.nom,
        statut: tenant.statut,
        derniere_facture: tenant.derniere_facture,
        prochaine_echeance: tenant.prochaine_echeance,
        upgrade_requests: tenant.settings?.upgrade_requests || [],
      },
      usage: {
        espaces: { used: espacesCount || 0, max: pack.max_espaces },
        membres: { used: membresCount || 0, max: pack.max_membres },
        staff: { used: staffCount || 0, max: pack.max_staff },
      },
      invoices,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function requestPackUpgrade(req, res) {
  try {
    const { target_pack, note = '' } = req.body;
    const normalized = String(target_pack || '').toLowerCase();
    if (!SAAS_PACKS[normalized]) {
      return res.status(400).json({ error: 'Pack cible invalide (essentiel, standard ou premium).' });
    }

    const { data: tenant } = await supabaseAdmin.from('tenants').select('*').eq('id', req.tenantId).single();
    const curSettings = tenant?.settings || {};
    const reqEntry = {
      id: `UPG-${Date.now()}`,
      target_pack: normalized,
      target_label: SAAS_PACKS[normalized].name,
      note: String(note || '').trim(),
      statut: 'en_attente',
      created_at: new Date().toISOString(),
      requested_by: req.profile.email,
    };

    const nextSettings = {
      ...curSettings,
      upgrade_requests: [reqEntry, ...(curSettings.upgrade_requests || [])].slice(0, 10),
    };
    await supabaseAdmin.from('tenants').update({ settings: nextSettings, updated_at: new Date().toISOString() }).eq('id', req.tenantId);

    try {
      const { data: supers } = await supabaseAdmin.from('profiles').select('id').eq('role', 'super_admin');
      for (const sa of supers || []) {
        await supabaseAdmin.from('notifications').insert({
          user_id: sa.id,
          titre: `Demande changement de pack — ${tenant.nom}`,
          message: `L'établissement "${tenant.nom}" souhaite passer au pack ${SAAS_PACKS[normalized].name} (${SAAS_PACKS[normalized].prix} DT/mois).`,
          type: 'info',
          lu: false,
        });
      }
    } catch (_) {}

    res.json({ request: reqEntry, message: `Demande de passage au pack ${SAAS_PACKS[normalized].name} envoyée à l'équipe DeskyWork.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function downloadDeskyInvoicePdf(req, res) {
  try {
    const PDFDocument = require('pdfkit');
    const { invoiceId } = req.params;
    const { data: tenant } = await supabaseAdmin.from('tenants').select('*').eq('id', req.tenantId).single();
    if (!tenant) return res.status(404).json({ error: 'Établissement introuvable.' });

    const pack = resolveTenantPack(tenant);
    const invoices = buildDeskyWorkInvoices(tenant, pack);
    const inv = invoices.find((i) => i.id === invoiceId || i.numero === invoiceId) || invoices[0];

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => {
      const buf = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Facture-${inv.numero}.pdf"`);
      res.send(buf);
    });

    doc.rect(0, 0, doc.page.width, 95).fill('#282522');
    doc.fillColor('#f95d00').font('Helvetica-Bold').fontSize(22).text('DESKYWORK SaaS', 50, 28);
    doc.fillColor('#ffffff').font('Helvetica').fontSize(9.5).text('Facturation Plateforme B2B · Tunisie', 50, 56);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text(`FACTURE ${inv.numero}`, 320, 34, { width: 220, align: 'right' });
    doc.fillColor('#cbd5e1').font('Helvetica').fontSize(9).text(`Statut : ${inv.statut}`, 320, 52, { width: 220, align: 'right' });

    doc.fillColor('#18181b').font('Helvetica-Bold').fontSize(11).text('ÉTABLISSEMENT CLIENT', 50, 125);
    doc.font('Helvetica').fontSize(10).text(tenant.nom || '—', 50, 144);
    doc.text(tenant.adresse ? `${tenant.adresse}, ${tenant.ville || ''}` : (tenant.ville || 'Tunisie'), 50, 160);
    doc.text(tenant.email || '—', 50, 176);

    doc.font('Helvetica-Bold').fontSize(11).text('DÉTAILS DE FACTURATION', 50, 220);
    doc.rect(50, 240, 495, 26).fill('#282522');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9.5);
    doc.text('DESCRIPTION', 60, 249);
    doc.text('PÉRIODE', 280, 249);
    doc.text('MONTANT HT', 440, 249, { width: 95, align: 'right' });

    doc.rect(50, 266, 495, 34).fill('#f7f4f0');
    doc.fillColor('#18181b').font('Helvetica').fontSize(9.5);
    doc.text(`Abonnement DeskyWork — Pack ${inv.pack || pack.name}`, 60, 278);
    doc.text(inv.periode || 'Mensuel', 280, 278);
    doc.font('Helvetica-Bold').text(`${Number(inv.montant || pack.prix).toFixed(3)} DT`, 440, 278, { width: 95, align: 'right' });

    doc.rect(345, 320, 200, 36).fill('#f95d00');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text('TOTAL À RÉGLER', 355, 332);
    doc.text(`${Number(inv.montant || pack.prix).toFixed(3)} DT`, 430, 332, { width: 105, align: 'right' });

    doc.fillColor('#64748b').font('Helvetica').fontSize(8.5).text(
      'Document émis par DeskyWork (CDC v3.0). Règlement par virement, chèque ou espèces auprès de votre gestionnaire DeskyWork.',
      50, 400, { width: 495, align: 'center' }
    );
    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── NOTIFICATIONS & SUPPORT DESKYWORK ─────────────────────────────────────────
async function getNotificationsSupportState(req, res) {
  try {
    const tid = req.tenantId;
    const [{ data: tenant }, { data: notifications }] = await Promise.all([
      tid ? supabaseAdmin.from('tenants').select('id, nom, settings').eq('id', tid).single() : Promise.resolve({ data: null }),
      supabaseAdmin
        .from('notifications')
        .select('*')
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false })
        .limit(40),
    ]);

    const rawAlertes = tenant?.settings?.alertes || {};
    const alert_settings = { ...DEFAULT_ALERT_SETTINGS };
    Object.keys(DEFAULT_ALERT_SETTINGS).forEach((k) => {
      if (rawAlertes[k] !== undefined) alert_settings[k] = Boolean(rawAlertes[k]);
    });

    const tickets = Array.isArray(tenant?.settings?.support_tickets) ? tenant.settings.support_tickets : [];
    res.json({
      alert_settings,
      tickets,
      notifications: notifications || [],
      channels: ['in_app', 'email'],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateAlertSettings(req, res) {
  try {
    const tid = req.tenantId;
    const { data: tenant } = await supabaseAdmin.from('tenants').select('settings').eq('id', tid).single();
    const curSettings = tenant?.settings || {};
    const curAlertes = { ...DEFAULT_ALERT_SETTINGS, ...(curSettings.alertes || {}) };

    Object.keys(DEFAULT_ALERT_SETTINGS).forEach((k) => {
      if (req.body[k] !== undefined) curAlertes[k] = Boolean(req.body[k]);
    });

    const nextSettings = { ...curSettings, alertes: curAlertes };
    await supabaseAdmin.from('tenants').update({ settings: nextSettings, updated_at: new Date().toISOString() }).eq('id', tid);

    res.json({ alert_settings: curAlertes, message: 'Préférences d\'alertes (In-App & E-mail) enregistrées.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createSupportTicket(req, res) {
  try {
    const { sujet, categorie = 'Technique', priorite = 'normale', message } = req.body;
    if (!sujet || !message) {
      return res.status(400).json({ error: 'Sujet et message sont obligatoires.' });
    }

    const tid = req.tenantId;
    const { data: tenant } = await supabaseAdmin.from('tenants').select('id, nom, email, settings').eq('id', tid).single();

    const ticket = {
      id: `TKT-${Date.now().toString().slice(-6)}`,
      sujet: String(sujet).trim(),
      categorie: String(categorie).trim(),
      priorite: ['basse', 'normale', 'haute', 'urgente'].includes(priorite) ? priorite : 'normale',
      message: String(message).trim(),
      statut: 'ouvert',
      created_at: new Date().toISOString(),
      created_by: req.profile.email,
    };

    const curSettings = tenant?.settings || {};
    const nextTickets = [ticket, ...(Array.isArray(curSettings.support_tickets) ? curSettings.support_tickets : [])].slice(0, 50);
    await supabaseAdmin.from('tenants').update({
      settings: { ...curSettings, support_tickets: nextTickets },
      updated_at: new Date().toISOString(),
    }).eq('id', tid);

    try {
      await supabaseAdmin.from('contacts').insert({
        nom: `${tenant?.nom || 'Établissement'} (${req.profile.nom || req.profile.email})`,
        email: req.profile.email || tenant?.email || 'contact@deskywork.tn',
        sujet: `[Support ${ticket.id} · ${ticket.categorie}] ${ticket.sujet}`,
        message: ticket.message,
        statut: 'nouveau',
      });
    } catch (_) {}

    try {
      const { data: supers } = await supabaseAdmin.from('profiles').select('id').eq('role', 'super_admin');
      for (const sa of supers || []) {
        await supabaseAdmin.from('notifications').insert({
          user_id: sa.id,
          titre: `Nouveau ticket support ${ticket.id}`,
          message: `${tenant?.nom || 'Admin'} : ${ticket.sujet}`,
          type: 'warning',
          lu: false,
        });
      }
    } catch (_) {}

    res.status(201).json({ ticket, tickets: nextTickets, message: `Ticket ${ticket.id} transmis au support DeskyWork.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/admin/marketplace-stats (Premium uniquement) ───────────────────
async function getMarketplaceStats(req, res) {
  try {
    const tid = req.tenantId;
    const { data: tenant } = await supabaseAdmin.from('tenants').select('*').eq('id', tid).single();
    if (!tenant) return res.status(404).json({ error: 'Établissement introuvable.' });

    const pack = resolveTenantPack(tenant);
    const locked = !pack.is_partner && pack.key !== 'premium';
    const mp = tenant.settings?.marketplace_stats || {};
    const defaultVues = tenant.slug === 'nero-coworking' || tenant.id === 'a1111111-1111-4111-8111-111111111111' ? 142 : 118;
    const defaultClics = tenant.slug === 'nero-coworking' || tenant.id === 'a1111111-1111-4111-8111-111111111111' ? 38 : 29;
    const vues = Number(mp.vues ?? (pack.is_partner ? defaultVues : 0));
    const clics = Number(mp.clics ?? (pack.is_partner ? defaultClics : 0));

    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const { count: reservations30j } = await supabaseAdmin
      .from('reservations')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tid)
      .gte('created_at', since)
      .neq('statut', 'cancelled');

    const tauxConversion = vues > 0 ? Math.min(100, Math.round(((reservations30j || 0) / vues) * 1000) / 10) : 0;

    res.json({
      locked,
      required_pack: 'premium',
      current_pack: pack.key,
      is_partner: pack.is_partner,
      pack_name: pack.name,
      prix_mensuel: pack.prix,
      stats: locked
        ? { vues: null, clics: null, reservations: null, taux_conversion: null }
        : {
            vues,
            clics,
            reservations: reservations30j || 0,
            taux_conversion: tauxConversion,
            last_updated: mp.last_updated || null,
          },
      marketplace_url: tenant.slug ? `/coworking/${tenant.slug}` : `/coworking/${tenant.id}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getTenant,
  updateTenant,
  createEspace,
  updateEspace,
  deleteEspace,
  completeOnboarding,
  listMembers,
  createAdminConversation,
  listAdminConversations,
  uploadPhoto,
  globalSearch,
  getClientsOverview,
  createMember,
  getMemberHistory,
  listStaff,
  createStaff,
  updateStaff,
  deleteStaff,
  getSubscriptionOverview,
  requestPackUpgrade,
  downloadDeskyInvoicePdf,
  getNotificationsSupportState,
  updateAlertSettings,
  createSupportTicket,
  getMarketplaceStats,
};
