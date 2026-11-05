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

  const { nom, type, capacite, tarif_horaire, photo_url, photos_urls } = req.body;
  if (!nom || !type || !capacite) {
    return res.status(400).json({ error: 'Nom, type et capacité sont requis.' });
  }

  const validTypes = ['open_space', 'private_office', 'meeting_room', 'training_room', 'event_space'];
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

  const insertData = {
    nom,
    type,
    capacite: parseInt(capacite, 10),
    tarif_horaire: parseFloat(tarif_horaire) || 0,
    tenant_id: req.tenantId,
  };
  if (photo_url !== undefined) insertData.photo_url = photo_url;
  if (photos_urls !== undefined) insertData.photos_urls = photos_urls;

  const { data, error } = await supabaseAdmin
    .from('espaces')
    .insert(insertData)
    .select()
    .single();

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

  const allowed = ['nom', 'type', 'capacite', 'tarif_horaire', 'photo_url', 'photos_urls'];
  const updates = {};
  for (const field of allowed) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Aucune mise à jour fournie.' });

  const { data, error } = await supabaseAdmin
    .from('espaces')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

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

    const buffer = Buffer.from(base64Data, 'base64');
    const ext = fileName.split('.').pop();
    const targetFolder = folder || 'espaces';
    const bucket = ['avatars', 'documents'].includes(targetFolder) ? targetFolder : 'coworking-images';
    const targetPath = targetFolder === bucket
      ? `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      : `${targetFolder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const { error } = await supabaseAdmin.storage
      .from(bucket)
      .upload(targetPath, buffer, {
        contentType: fileType || 'image/jpeg',
        upsert: true
      });

    if (error) {
      return res.status(400).json({ error: `Upload échoué: ${error.message}` });
    }

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from(bucket)
      .getPublicUrl(targetPath);

    res.json({ publicUrl });
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
};
