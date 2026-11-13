// middleware/authenticate.js — Authentification JWT + chargement profil et organisation active
'use strict';

const { supabaseAdmin, getUserClient } = require('../config/supabase');

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Token JWT requis (Authorization: Bearer <token>).' });
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    return res.status(401).json({ error: 'Token JWT invalide ou expiré.' });
  }

  let { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .maybeSingle();

  // Auto-récupération si un utilisateur OAuth Google vient d'être créé avant que le trigger profiles ne soit visible
  const reqUrl = String(req.originalUrl || req.url || '');
  if ((!profile || profileError) && (reqUrl.includes('/auth/oauth-status') || reqUrl.includes('/auth/complete-oauth-registration'))) {
    const meta = data.user.user_metadata || {};
    const fullName = String(meta.full_name || meta.name || '').trim();
    const parts = fullName.split(/\s+/).filter(Boolean);
    const { data: createdProfile, error: upsertErr } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: data.user.id,
        email: String(data.user.email || '').trim().toLowerCase(),
        prenom: meta.prenom || meta.first_name || parts[0] || '',
        nom: meta.nom || meta.last_name || parts.slice(1).join(' ') || '',
        telephone: meta.telephone || meta.phone || null,
        role: meta.role || 'member',
        statut_compte: 'actif',
        email_verifie: Boolean(data.user.email_confirmed_at),
        photo_url: meta.avatar_url || meta.picture || null,
      }, { onConflict: 'id' })
      .select('*')
      .maybeSingle();
    if (!upsertErr && createdProfile) {
      profile = createdProfile;
      profileError = null;
    }
  }

  if (profileError || !profile) {
    return res.status(403).json({ error: 'Profil membre introuvable.' });
  }

  // Vérifier statut personne
  if (profile.statut_compte && profile.statut_compte === 'suspendu') {
    return res.status(403).json({ error: "Votre compte personnel est suspendu. Contactez l'administrateur." });
  }

  req.user = data.user;
  req.profile = profile;
  req.token = token;
  req.db = getUserClient(token);

  // Détermination de l'organisation active (header x-organization-id > query > profile.tenant_id)
  const requestedOrgId = req.headers['x-organization-id'] ||
                         req.query.organization_id ||
                         req.query.tenant_id ||
                         profile.tenant_id ||
                         null;

  req.tenantId = requestedOrgId;
  req.orgId = requestedOrgId;
  req.membership = null;

  // Si une organisation est demandée, vérifier l'appartenance via memberships
  if (requestedOrgId && profile.role !== 'super_admin' && !profile.is_super_admin) {
    try {
      const { data: membership } = await supabaseAdmin
        .from('memberships')
        .select('*')
        .eq('user_id', data.user.id)
        .eq('organization_id', requestedOrgId)
        .eq('statut', 'actif')
        .maybeSingle();

      if (membership) {
        req.membership = membership;
      }
    } catch (_) {
      // Ignorer silencieusement si la table n'a pas encore été migrée dans l'environnement local
    }
  }

  next();
}

module.exports = { authenticate };
