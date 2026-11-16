// controllers/superAdminController.js — MODULE S6 : Super Admin (Tenants + Users)
const { supabaseAdmin } = require('../config/supabase');
const { auditLog } = require('../middleware/guards');
const { getPeriodWindow, buildBuckets } = require('./kpisController');

// GET /api/super-admin/tenants
async function listTenants(req, res) {
  const { page = 1, limit = 20, statut, search } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = supabaseAdmin
    .from('tenants')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (statut) query = query.eq('statut', statut);
  if (search) query = query.or(`nom.ilike.%${search}%,ville.ilike.%${search}%,email.ilike.%${search}%`);

  const { data, error, count } = await query.range(offset, offset + parseInt(limit) - 1);
  if (error) return res.status(500).json({ error: error.message });

  const tenantIds = (data || []).map(t => t.id);
  let memberCounts = {};
  let spaceCounts = {};

  if (tenantIds.length > 0) {
    const [{ data: profRows }, { data: espRows }] = await Promise.all([
      supabaseAdmin.from('profiles').select('tenant_id').in('tenant_id', tenantIds).in('role', ['member', 'guest']),
      supabaseAdmin.from('espaces').select('tenant_id').in('tenant_id', tenantIds),
    ]);

    (profRows || []).forEach(p => {
      if (p.tenant_id) memberCounts[p.tenant_id] = (memberCounts[p.tenant_id] || 0) + 1;
    });

    (espRows || []).forEach(e => {
      if (e.tenant_id) spaceCounts[e.tenant_id] = (spaceCounts[e.tenant_id] || 0) + 1;
    });
  }

  const enriched = (data || []).map(t => ({
    ...t,
    member_count: memberCounts[t.id] || 0,
    space_count: spaceCounts[t.id] || 0,
  }));

  res.json({ tenants: enriched, pagination: { page: parseInt(page), limit: parseInt(limit), total: count || 0 } });
}


// GET /api/super-admin/tenants/:id
async function getTenant(req, res) {
  const { data: tenant, error } = await supabaseAdmin
    .from('tenants').select('*').eq('id', req.params.id).single();
  if (error || !tenant) return res.status(404).json({ error: 'Coworking introuvable.' });

  const [{ count: memberCount }, { count: spaceCount }, { count: bookingCount }, { count: subCount }] = await Promise.all([
    supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id).in('role', ['member', 'guest']),
    supabaseAdmin.from('espaces').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id),
    supabaseAdmin.from('reservations').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id),
    supabaseAdmin.from('abonnements').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('statut', 'active'),
  ]);

  res.json({
    tenant: {
      ...tenant,
      stats: { members: memberCount || 0, spaces: spaceCount || 0, bookings: bookingCount || 0, activeSubscriptions: subCount || 0 },
    },
  });
}

// POST /api/super-admin/tenants
async function createTenant(req, res) {
  const { nom, slug, description, adresse, ville, pays, email, telephone, site_web, plan, tier, montant_mensuel, limite_membres, limite_espaces } = req.body;
  if (!nom) return res.status(400).json({ error: 'Le nom du coworking est requis.' });

  const tenantSlug = slug || nom.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const { data, error } = await supabaseAdmin.from('tenants').insert({
    nom, slug: tenantSlug, description: description || null,
    adresse: adresse || null, ville: ville || null, pays: pays || 'Tunisie',
    email: email || null, telephone: telephone || null, site_web: site_web || null,
    plan: plan || 'starter', tier: tier || 'C', montant_mensuel: montant_mensuel || 0,
    limite_membres: limite_membres || 100, limite_espaces: limite_espaces || 10,
  }).select().single();

  if (error) return res.status(400).json({ error: error.message });
  await auditLog(req.user.id, 'tenant_created', 'tenant', data.id, data.nom, { plan: data.plan, tier: data.tier }, req.ip);
  res.status(201).json({ tenant: data });
}

// PATCH /api/super-admin/tenants/:id
async function updateTenant(req, res) {
  const allowed = ['nom', 'description', 'adresse', 'ville', 'pays', 'email', 'telephone', 'site_web', 'logo_url', 'cover_url', 'latitude', 'longitude', 'statut', 'plan', 'tier', 'montant_mensuel', 'derniere_facture', 'prochaine_echeance', 'limite_membres', 'limite_espaces', 'settings'];
  const updates = { updated_at: new Date().toISOString() };
  for (const field of allowed) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }
  if (Object.keys(updates).length === 1) return res.status(400).json({ error: 'Aucune mise à jour fournie.' });

  const { data, error } = await supabaseAdmin.from('tenants').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });

  if (updates.statut !== undefined) {
    const nextProfileStatut = updates.statut === 'actif' ? 'actif' : 'suspendu';
    await supabaseAdmin.from('profiles')
      .update({ statut_compte: nextProfileStatut, updated_at: new Date().toISOString() })
      .eq('tenant_id', req.params.id).eq('role', 'admin');
  }

  await auditLog(req.user.id, 'tenant_updated', 'tenant', data.id, data.nom, { fields: Object.keys(updates) }, req.ip);
  res.json({ tenant: data });
}

// DELETE /api/super-admin/tenants/:id
async function deleteTenant(req, res) {
  try {
    const tenantId = req.params.id;
    const { data: tenant, error: fetchErr } = await supabaseAdmin
      .from('tenants')
      .select('id, nom, statut, owner_id, contact_admin_id')
      .eq('id', tenantId)
      .maybeSingle();

    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('id, nom, owner_id, statut')
      .eq('id', tenantId)
      .maybeSingle();

    if ((fetchErr && !org) || (!tenant && !org)) {
      return res.status(404).json({ error: 'Coworking introuvable.' });
    }

    const displayName = tenant?.nom || org?.nom || 'Coworking';

    // Repérer les administrateurs exclusifs de ce coworking (rôle admin, aucun autre établissement possédé)
    const { data: tenantProfiles } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('tenant_id', tenantId)
      .eq('role', 'admin');

    const candidateAdminIds = new Set(
      [
        tenant?.owner_id,
        tenant?.contact_admin_id,
        org?.owner_id,
        ...(tenantProfiles || []).map((p) => p.id),
      ].filter((id) => id && id !== req.user.id)
    );

    await deleteOrganizationAndTenantCascade(tenantId);

    // Supprimer les comptes admin exclusivement liés à ce coworking afin de libérer leur e-mail
    for (const adminId of candidateAdminIds) {
      const { data: adminProf } = await supabaseAdmin
        .from('profiles')
        .select('id, role')
        .eq('id', adminId)
        .maybeSingle();
      if (!adminProf || adminProf.role !== 'admin') continue;

      const [{ data: otherOrgs }, { data: otherTenants }] = await Promise.all([
        supabaseAdmin.from('organizations').select('id').eq('owner_id', adminId).limit(1),
        supabaseAdmin
          .from('tenants')
          .select('id')
          .or(`owner_id.eq.${adminId},contact_admin_id.eq.${adminId}`)
          .limit(1),
      ]);

      if (!(otherOrgs && otherOrgs.length > 0) && !(otherTenants && otherTenants.length > 0)) {
        await deleteUserCore(adminId, req.user.id, req.ip, { skipAudit: true });
      }
    }

    await auditLog(req.user.id, 'tenant_deleted', 'tenant', tenantId, displayName, {}, req.ip);
    res.json({ message: `Coworking "${displayName}" supprimé.` });
  } catch (err) {
    console.error('❌ Erreur deleteTenant:', err);
    res.status(500).json({ error: formatSupabaseErr(err, 'Erreur lors de la suppression du coworking.') });
  }
}

// POST /api/super-admin/tenants/:id/onboard
async function onboardTenant(req, res) {
  const { email, nom, prenom, telephone } = req.body;
  if (!email) return res.status(400).json({ error: "Email de l'admin requis." });

  const { data: tenant, error: tErr } = await supabaseAdmin.from('tenants').select('*').eq('id', req.params.id).single();
  if (tErr || !tenant) return res.status(404).json({ error: 'Coworking introuvable.' });

  const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    data: { role: 'admin', tenant_id: tenant.id, nom: nom || tenant.nom, prenom: prenom || 'Admin', telephone: telephone || '' },
    redirectTo: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login`,
  });

  if (authErr) return res.status(400).json({ error: authErr.message });

  await supabaseAdmin.from('tenants').update({ contact_admin_id: authUser.user.id }).eq('id', tenant.id);
  await auditLog(req.user.id, 'tenant_onboarded', 'tenant', tenant.id, tenant.nom, { admin_email: email }, req.ip);
  res.json({ message: `Invitation envoyée à ${email} pour gérer "${tenant.nom}".`, user: { id: authUser.user.id, email } });
}

function pctChange(cur, prev) {
  if (prev > 0) return Math.round(((cur - prev) / prev) * 100);
  return cur > 0 ? 100 : 0;
}

async function getStats(req, res) {
  try {
    const period = String(req.query.period || 'mois');
    const win = getPeriodWindow(period, new Date(), req.query);
    const prevEnd = new Date(win.fromJ.getTime() - 1);
    const prevFrom = new Date(prevEnd.getTime() - (win.toJ.getTime() - win.fromJ.getTime()));
    const prevWin = { from: prevFrom.toISOString(), to: prevEnd.toISOString() };

    const [allTenantsRes, newTenantsRes, prevTenantsRes, activeTenantsRes, suspendedTenantsRes,
      allMembersRes, newMembersRes, prevMembersRes] = await Promise.all([
      supabaseAdmin.from('tenants').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('tenants').select('*', { count: 'exact', head: true }).gte('created_at', win.from).lte('created_at', win.to),
      supabaseAdmin.from('tenants').select('*', { count: 'exact', head: true }).gte('created_at', prevWin.from).lte('created_at', prevWin.to),
      supabaseAdmin.from('tenants').select('*', { count: 'exact', head: true }).eq('statut', 'actif').lte('created_at', win.to),
      supabaseAdmin.from('tenants').select('*', { count: 'exact', head: true }).eq('statut', 'suspendu').gte('created_at', win.from).lte('created_at', win.to),
      supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).in('role', ['member', 'guest']),
      supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).in('role', ['member', 'guest']).gte('created_at', win.from).lte('created_at', win.to),
      supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).in('role', ['member', 'guest']).gte('created_at', prevWin.from).lte('created_at', prevWin.to),
    ]);

    const { data: tenants } = await supabaseAdmin
      .from('tenants')
      .select('id, nom, montant_mensuel, statut, plan, prochaine_echeance, created_at');

    const todayStr = new Date().toISOString().split('T')[0];

    // ── Abonnements VC LOW des coworkings ────────────────────────────────
    const actifs = (tenants || []).filter((t) => t.statut === 'actif');
    const planBreakdown = {};
    actifs.forEach((t) => {
      planBreakdown[t.plan] = (planBreakdown[t.plan] || 0) + 1;
    });

    const impayes = (tenants || []).filter((t) =>
      t.statut !== 'actif' || (t.prochaine_echeance && t.prochaine_echeance < todayStr));
    const overdueAmount = impayes.reduce((acc, t) => acc + (parseFloat(t.montant_mensuel) || 0), 0);

    const mrr = actifs.reduce((acc, t) => acc + (parseFloat(t.montant_mensuel) || 0), 0);

    // Evolution coworkings / MRR découpée selon la période sélectionnée
    const buckets = buildBuckets(win);
    const monthlyGrowth = buckets.map((b) => {
      const activeInBucket = (tenants || []).filter(t =>
        t.statut === 'actif' && new Date(t.created_at || '2020-01-01') <= b.end);
      const bucketMrr = activeInBucket.reduce((acc, t) => acc + (parseFloat(t.montant_mensuel) || 0), 0);
      return {
        mois: b.label,
        coworkings: activeInBucket.length,
        mrr: Math.round(bucketMrr * 100) / 100,
      };
    });

    // ── Coworkings les plus performants — en parallèle ───────────────────
    const tenantNames = {};
    (tenants || []).forEach((t) => { tenantNames[t.id] = t.nom; });
    const perfMap = {};

    const [{ data: topPaiements }, { data: topReservations }] = await Promise.all([
      supabaseAdmin.from('paiements').select('tenant_id, montant').eq('statut', 'paid')
        .gte('date_paiement', win.from).lte('date_paiement', win.to),
      supabaseAdmin.from('reservations').select('tenant_id').in('statut', ['confirmed', 'pending'])
        .gte('date_debut', win.from).lte('date_debut', win.to),
    ]);

    (topPaiements || []).forEach((p) => {
      if (!p.tenant_id) return;
      if (!perfMap[p.tenant_id]) perfMap[p.tenant_id] = { nom: tenantNames[p.tenant_id] || 'Inconnu', ca: 0, bookings: 0 };
      perfMap[p.tenant_id].ca += parseFloat(p.montant || 0);
    });
    (topReservations || []).forEach((r) => {
      if (!r.tenant_id) return;
      if (!perfMap[r.tenant_id]) perfMap[r.tenant_id] = { nom: tenantNames[r.tenant_id] || 'Inconnu', ca: 0, bookings: 0 };
      perfMap[r.tenant_id].bookings += 1;
    });

    const topCoworkings = Object.values(perfMap)
      .sort((a, b) => b.ca - a.ca || b.bookings - a.bookings)
      .slice(0, 5)
      .map((t) => ({ ...t, ca: Math.round(t.ca * 100) / 100 }));

    res.json({
      totalTenants: allTenantsRes.count ?? 0,
      nouveauxTenants: newTenantsRes.count ?? 0,
      tenantEvolution: pctChange(newTenantsRes.count ?? 0, prevTenantsRes.count ?? 0),
      activeTenants: activeTenantsRes.count ?? 0,
      suspendedTenants: suspendedTenantsRes.count ?? 0,
      totalMembers: allMembersRes.count ?? 0,
      nouveauxMembres: newMembersRes.count ?? 0,
      memberEvolution: pctChange(newMembersRes.count ?? 0, prevMembersRes.count ?? 0),
      activeSubscriptions: actifs.length,
      planBreakdown,
      expiredSubscriptions: impayes.length,
      overdueAmount: Math.round(overdueAmount * 100) / 100,
      mrr: Math.round(mrr * 100) / 100,
      monthlyGrowth,
      topCoworkings,
      periode: { key: win.period, from: win.from, to: win.to, bucket: win.bucket },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/super-admin/audit
async function getAuditLogs(req, res) {
  const { page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const { data, error, count } = await supabaseAdmin
    .from('super_admin_audit_log')
    .select('*, profiles!user_id(nom, prenom)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + parseInt(limit) - 1);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ logs: data || [], pagination: { page: parseInt(page), limit: parseInt(limit), total: count || 0 } });
}

// GET /api/super-admin/users
async function listUsers(req, res) {
  const { page = 1, limit = 30, role, tenant_id, statut, search } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = supabaseAdmin
    .from('profiles')
    .select('id, nom, prenom, email, role, statut_compte, tenant_id, created_at, updated_at, tenants!tenant_id(nom, slug)', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (role) query = query.eq('role', role);
  if (tenant_id) query = query.eq('tenant_id', tenant_id);
  if (statut) query = query.eq('statut_compte', statut);
  if (search) query = query.or(`nom.ilike.%${search}%,prenom.ilike.%${search}%,email.ilike.%${search}%`);

  const { data, error, count } = await query.range(offset, offset + parseInt(limit) - 1);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ users: data || [], pagination: { page: parseInt(page), limit: parseInt(limit), total: count || 0 } });
}

// PATCH /api/super-admin/users/:id
async function updateUser(req, res) {
  const allowed = ['role', 'statut_compte', 'nom', 'prenom', 'telephone', 'tenant_id'];
  const updates = { updated_at: new Date().toISOString() };
  for (const field of allowed) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }
  if (Object.keys(updates).length === 1) return res.status(400).json({ error: 'Aucune mise à jour fournie.' });
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Vous ne pouvez pas modifier votre propre compte via cette interface.' });

  const { data: target } = await supabaseAdmin.from('profiles').select('nom, prenom, role').eq('id', req.params.id).single();
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable.' });

  const { data, error } = await supabaseAdmin.from('profiles').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });

  // Si le statut passe à actif, confirmer automatiquement l'email dans Supabase Auth
  if (updates.statut_compte === 'actif') {
    try {
      await supabaseAdmin.auth.admin.updateUserById(req.params.id, { email_confirm: true });
    } catch (e) {
      console.warn('⚠️ Erreur confirmation email Supabase Auth:', e.message);
    }
  }

  await auditLog(req.user.id, 'user_updated', 'user', req.params.id, `${target.prenom} ${target.nom}`, { fields: Object.keys(updates) }, req.ip);
  res.json({ user: data });
}

function formatSupabaseErr(err, fallback = 'Erreur lors de l\'opération.') {
  if (!err) return fallback;
  const raw = typeof err === 'string' ? err : (err.message || err.error_description || err.msg || err.code || '');
  const trimmed = String(raw || '').trim();
  if (trimmed && trimmed !== '{}') return trimmed;
  try {
    const serialized = JSON.stringify(err);
    if (serialized && serialized !== '{}') return serialized;
  } catch (_) {}
  return fallback;
}

async function safeDbStep(fn) {
  try {
    await fn();
  } catch (_) {}
}

async function deleteOrganizationAndTenantCascade(orgId) {
  if (!orgId) return;
  await safeDbStep(() => supabaseAdmin.from('profiles').update({ tenant_id: null }).eq('tenant_id', orgId));
  await safeDbStep(() => supabaseAdmin.from('membres_sites').delete().eq('tenant_id', orgId));
  await safeDbStep(() => supabaseAdmin.from('documents_membres').delete().eq('tenant_id', orgId));
  await safeDbStep(() => supabaseAdmin.from('contenu_documents').delete().eq('tenant_id', orgId));
  await safeDbStep(() => supabaseAdmin.from('credits_membres').delete().eq('tenant_id', orgId));
  await safeDbStep(() => supabaseAdmin.from('politique_annulation_espaces').delete().eq('tenant_id', orgId));
  await safeDbStep(() => supabaseAdmin.from('politique_annulation').delete().eq('tenant_id', orgId));
  await safeDbStep(() => supabaseAdmin.from('remuneration_formateurs').delete().eq('tenant_id', orgId));

  const { data: orgFormations } = await supabaseAdmin.from('formations').select('id').eq('tenant_id', orgId);
  const fIds = (orgFormations || []).map((f) => f.id);
  if (fIds.length > 0) {
    await safeDbStep(() => supabaseAdmin.from('inscriptions_formations').delete().in('formation_id', fIds));
  }
  await safeDbStep(() => supabaseAdmin.from('formations').delete().eq('tenant_id', orgId));

  await safeDbStep(() => supabaseAdmin.from('paiements').delete().eq('tenant_id', orgId));

  const { data: orgReservations } = await supabaseAdmin.from('reservations').select('id').eq('tenant_id', orgId);
  const rIds = (orgReservations || []).map((r) => r.id);
  if (rIds.length > 0) {
    await safeDbStep(() => supabaseAdmin.from('sessions').delete().in('reservation_id', rIds));
    await safeDbStep(() => supabaseAdmin.from('paiements').delete().in('reservation_id', rIds));
  }
  await safeDbStep(() => supabaseAdmin.from('reservations').delete().eq('tenant_id', orgId));

  await safeDbStep(() => supabaseAdmin.from('abonnements').delete().eq('tenant_id', orgId));
  await safeDbStep(() => supabaseAdmin.from('tarifs_abonnements').delete().eq('tenant_id', orgId));
  await safeDbStep(() => supabaseAdmin.from('codes_promo').delete().eq('tenant_id', orgId));
  await safeDbStep(() => supabaseAdmin.from('guests').delete().eq('tenant_id', orgId));
  await safeDbStep(() => supabaseAdmin.from('espaces').delete().eq('tenant_id', orgId));
  await safeDbStep(() => supabaseAdmin.from('sites').delete().eq('tenant_id', orgId));
  await safeDbStep(() => supabaseAdmin.from('notifications').delete().eq('tenant_id', orgId));
  await safeDbStep(() => supabaseAdmin.from('rgpd_demandes').delete().eq('tenant_id', orgId));

  const { data: orgConvs } = await supabaseAdmin.from('conversations').select('id').eq('tenant_id', orgId);
  const cIds = (orgConvs || []).map((c) => c.id);
  if (cIds.length > 0) {
    await safeDbStep(() => supabaseAdmin.from('messages').delete().in('conversation_id', cIds));
    await safeDbStep(() => supabaseAdmin.from('conversation_members').delete().in('conversation_id', cIds));
    await safeDbStep(() => supabaseAdmin.from('conversations').delete().in('id', cIds));
  }

  await safeDbStep(() => supabaseAdmin.from('memberships').delete().eq('organization_id', orgId));
  await safeDbStep(() => supabaseAdmin.from('invitations').delete().eq('organization_id', orgId));
  await safeDbStep(() => supabaseAdmin.from('tenants').delete().eq('id', orgId));
  await safeDbStep(() => supabaseAdmin.from('organizations').delete().eq('id', orgId));
}

async function purgeOrphanAuthUsersByEmail(email, excludeUserId = null) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return;
  try {
    for (let page = 1; page <= 20; page++) {
      const { data: listData, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (listErr || !listData?.users?.length) break;
      const matches = listData.users.filter(
        (u) => u.id !== excludeUserId && u.email?.trim().toLowerCase() === normalized
      );
      for (const u of matches) {
        const { data: prof } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('id', u.id)
          .maybeSingle();
        if (!prof?.id) {
          await safeDbStep(() => supabaseAdmin.auth.admin.deleteUser(u.id, false));
        }
      }
      if (listData.users.length < 1000) break;
    }
  } catch (_) {}
}

async function deleteUserCore(userId, actorUserId, actorIp, { skipAudit = false } = {}) {
  const { data: target, error: targetErr } = await supabaseAdmin
    .from('profiles')
    .select('id, nom, prenom, email, role, tenant_id')
    .eq('id', userId)
    .maybeSingle();

  if (targetErr) {
    return { status: 400, error: formatSupabaseErr(targetErr) };
  }
  if (!target) {
    // Tenter quand même de supprimer un éventuel compte orphelin dans auth.users
    const { data: authLookup } = await supabaseAdmin.auth.admin.getUserById(userId).catch(() => ({ data: null }));
    if (authLookup?.user) {
      await safeDbStep(() => supabaseAdmin.auth.admin.deleteUser(userId, false));
      return { status: 200, deletedOrphan: true, message: 'Compte orphelin supprimé.' };
    }
    return { status: 404, error: 'Utilisateur introuvable.' };
  }

  const targetEmailLower = target.email ? target.email.trim().toLowerCase() : '';

  // 1. Gérer les organisations / tenants dont l'utilisateur est propriétaire ou contact
  const { data: ownedOrgs } = await supabaseAdmin
    .from('organizations')
    .select('id, statut, email')
    .eq('owner_id', userId);

  for (const org of ownedOrgs || []) {
    const [{ data: otherMembers }, { data: otherTenantUsers }] = await Promise.all([
      supabaseAdmin.from('memberships').select('id').eq('organization_id', org.id).neq('user_id', userId).limit(1),
      supabaseAdmin.from('profiles').select('id').eq('tenant_id', org.id).neq('id', userId).limit(1),
    ]);
    const hasOtherUsers = Boolean((otherMembers && otherMembers.length > 0) || (otherTenantUsers && otherTenantUsers.length > 0));

    if (['brouillon', 'en_validation', 'suspendu'].includes(org.statut) || !hasOtherUsers) {
      await deleteOrganizationAndTenantCascade(org.id);
    } else {
      const orgPatch = { owner_id: null };
      if (targetEmailLower && org.email?.trim().toLowerCase() === targetEmailLower) {
        orgPatch.email = null;
      }
      const { error: nullErr } = await supabaseAdmin.from('organizations').update(orgPatch).eq('id', org.id);
      if (nullErr) {
        await safeDbStep(() =>
          supabaseAdmin
            .from('organizations')
            .update({ owner_id: actorUserId, ...(orgPatch.email === null ? { email: null } : {}) })
            .eq('id', org.id)
        );
      }
    }
  }

  await safeDbStep(() => supabaseAdmin.from('tenants').update({ owner_id: null }).eq('owner_id', userId));
  await safeDbStep(() => supabaseAdmin.from('tenants').update({ contact_admin_id: null }).eq('contact_admin_id', userId));
  if (targetEmailLower) {
    await safeDbStep(() => supabaseAdmin.from('tenants').update({ email: null }).ilike('email', targetEmailLower).is('owner_id', null));
  }

  // 2. Nettoyage complet des tables liées (FK / données utilisateur) avant suppression
  await safeDbStep(() => supabaseAdmin.from('messages').delete().eq('sender_id', userId));
  await safeDbStep(() => supabaseAdmin.from('conversation_members').delete().eq('user_id', userId));

  const { data: convs } = await supabaseAdmin.from('conversations').select('id').eq('created_by', userId);
  const convIds = (convs || []).map((c) => c.id);
  if (convIds.length > 0) {
    await safeDbStep(() => supabaseAdmin.from('messages').delete().in('conversation_id', convIds));
    await safeDbStep(() => supabaseAdmin.from('conversation_members').delete().in('conversation_id', convIds));
    await safeDbStep(() => supabaseAdmin.from('conversations').delete().in('id', convIds));
  }

  const [{ data: resByUser }, { data: resByMember }] = await Promise.all([
    supabaseAdmin.from('reservations').select('id').eq('user_id', userId),
    supabaseAdmin.from('reservations').select('id').eq('membre_id', userId),
  ]);
  const userResIds = Array.from(new Set([...(resByUser || []), ...(resByMember || [])].map((r) => r.id)));
  if (userResIds.length > 0) {
    await safeDbStep(() => supabaseAdmin.from('sessions').delete().in('reservation_id', userResIds));
    await safeDbStep(() => supabaseAdmin.from('paiements').delete().in('reservation_id', userResIds));
  }

  await safeDbStep(() => supabaseAdmin.from('notifications').delete().eq('user_id', userId));
  await safeDbStep(() => supabaseAdmin.from('memberships').delete().eq('user_id', userId));
  await safeDbStep(() => supabaseAdmin.from('invitations').update({ invited_by: null }).eq('invited_by', userId));
  await safeDbStep(() => supabaseAdmin.from('invitations').update({ accepted_by: null }).eq('accepted_by', userId));
  await safeDbStep(() => supabaseAdmin.from('guests').update({ converti_en_membre_id: null }).eq('converti_en_membre_id', userId));
  await safeDbStep(() => supabaseAdmin.from('trainer_profiles').delete().eq('user_id', userId));
  await safeDbStep(() => supabaseAdmin.from('inscriptions_formations').delete().eq('user_id', userId));
  await safeDbStep(() => supabaseAdmin.from('inscriptions_formations').delete().eq('membre_id', userId));
  await safeDbStep(() => supabaseAdmin.from('remuneration_formateurs').delete().eq('formateur_id', userId));
  await safeDbStep(() => supabaseAdmin.from('formations').delete().eq('formateur_id', userId));
  await safeDbStep(() => supabaseAdmin.from('sessions').delete().eq('user_id', userId));
  await safeDbStep(() => supabaseAdmin.from('paiements').update({ traite_par: null }).eq('traite_par', userId));
  await safeDbStep(() => supabaseAdmin.from('paiements').delete().eq('user_id', userId));
  await safeDbStep(() => supabaseAdmin.from('reservations').delete().eq('user_id', userId));
  await safeDbStep(() => supabaseAdmin.from('reservations').delete().eq('membre_id', userId));
  await safeDbStep(() => supabaseAdmin.from('historique_tarifs').delete().eq('user_id', userId));
  await safeDbStep(() => supabaseAdmin.from('abonnements').delete().eq('user_id', userId));
  await safeDbStep(() => supabaseAdmin.from('credits_membres').delete().eq('user_id', userId));
  await safeDbStep(() => supabaseAdmin.from('membres_sites').delete().eq('user_id', userId));
  await safeDbStep(() => supabaseAdmin.from('documents_membres').delete().eq('user_id', userId));
  await safeDbStep(() => supabaseAdmin.from('rgpd_demandes').update({ traite_par: null }).eq('traite_par', userId));
  await safeDbStep(() => supabaseAdmin.from('rgpd_demandes').delete().eq('user_id', userId));
  await safeDbStep(() => supabaseAdmin.from('super_admin_audit_log').delete().eq('user_id', userId));
  if (targetEmailLower) {
    await safeDbStep(() => supabaseAdmin.from('email_otp').delete().ilike('email', targetEmailLower));
    await safeDbStep(() => supabaseAdmin.from('invitations').delete().ilike('email', targetEmailLower));
  }

  // 3. Supprimer d'abord le compte Supabase Auth (déclenche ON DELETE CASCADE vers profiles)
  // afin de ne JAMAIS laisser un compte orphelin dans auth.users si Auth échoue
  const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(userId, false);
  if (authErr) {
    const authMsg = formatSupabaseErr(authErr, '');
    if (!/not\s*found/i.test(authMsg)) {
      return {
        status: 400,
        error: `Impossible de supprimer le compte dans Supabase Auth : ${authMsg || 'contrainte en base.'}`,
      };
    }
  }

  // 4. Nettoyage défensif du profil s'il existe encore (ex: sans ON DELETE CASCADE)
  const { data: leftoverProf } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();
  if (leftoverProf?.id) {
    const { error: profDelErr } = await supabaseAdmin.from('profiles').delete().eq('id', userId);
    if (profDelErr) {
      return { status: 400, error: formatSupabaseErr(profDelErr, 'Impossible de supprimer le profil utilisateur.') };
    }
  }

  // 5. Purger tout compte auth.users orphelin (sans profil) portant la même adresse e-mail
  if (targetEmailLower) {
    await purgeOrphanAuthUsersByEmail(targetEmailLower, userId);
  }

  if (!skipAudit) {
    await auditLog(
      actorUserId,
      'user_deleted',
      'user',
      userId,
      `${target.prenom || ''} ${target.nom || ''}`.trim() || target.email,
      { role: target.role, email: target.email },
      actorIp
    );
  }

  return { status: 200, message: `Utilisateur "${target.prenom} ${target.nom}" supprimé.` };
}

// DELETE /api/super-admin/users/:id
async function deleteUser(req, res) {
  try {
    const userId = req.params.id;
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte.' });
    }

    const result = await deleteUserCore(userId, req.user.id, req.ip);
    if (result.status !== 200) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.json({ message: result.message });
  } catch (err) {
    console.error('❌ Erreur deleteUser:', err);
    res.status(500).json({ error: formatSupabaseErr(err, 'Erreur interne lors de la suppression du compte.') });
  }
}

// GET /api/super-admin/users/roles-summary
async function getRolesSummary(_req, res) {
  const roles = ['member', 'admin', 'staff', 'formateur', 'super_admin', 'guest'];
  const counts = await Promise.all(
    roles.map(async (r) => {
      const { count } = await supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).eq('role', r);
      return { role: r, count: count || 0 };
    })
  );
  res.json({ summary: counts });
}

// ── Supervision cross-tenant ──────────────────────────────────────────────────

// GET /api/super-admin/reservations
async function listAllReservations(req, res) {
  try {
    const { page = 1, limit = 20, statut, tenant_id, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = supabaseAdmin
      .from('reservations')
      .select(`
        *,
        profiles:user_id(id, nom, prenom, email, telephone),
        espaces:espace_id(id, nom, type, tarif_horaire, tenant_id, tenants:tenant_id(id, nom, slug))
      `, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (statut) query = query.eq('statut', statut);
    if (tenant_id) query = query.eq('tenant_id', tenant_id);

    const { data, error, count } = await query.range(offset, offset + parseInt(limit) - 1);
    if (error) return res.status(500).json({ error: error.message });

    let rows = (data || []).map(r => {
      let montant = r.montant || r.montant_total;
      if (!montant && r.date_debut && r.date_fin && r.espaces?.tarif_horaire) {
        const hours = Math.max(1, (new Date(r.date_fin) - new Date(r.date_debut)) / (1000 * 60 * 60));
        montant = Math.round(hours * Number(r.espaces.tarif_horaire) * 100) / 100;
      }
      return {
        ...r,
        montant: montant || 0,
      };
    });

    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(r =>
        (r.profiles?.nom || '').toLowerCase().includes(s) ||
        (r.profiles?.prenom || '').toLowerCase().includes(s) ||
        (r.profiles?.email || '').toLowerCase().includes(s) ||
        (r.espaces?.nom || '').toLowerCase().includes(s) ||
        (r.espaces?.tenants?.nom || '').toLowerCase().includes(s)
      );
    }

    res.json({ reservations: rows, pagination: { page: parseInt(page), limit: parseInt(limit), total: count || 0 } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/super-admin/reservations/:id/cancel
async function cancelReservation(req, res) {
  try {
    const { motif } = req.body;
    const { data: target, error: fetchErr } = await supabaseAdmin
      .from('reservations')
      .select('id, user_id, espace_id, statut')
      .eq('id', req.params.id)
      .single();

    if (fetchErr || !target) return res.status(404).json({ error: 'Réservation introuvable.' });

    const { data, error } = await supabaseAdmin
      .from('reservations')
      .update({ statut: 'cancelled' })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await auditLog(req.user.id, 'reservation_cancelled_superadmin', 'reservation', target.id, `Réservation #${target.id}`, { motif }, req.ip);
    res.json({ message: 'Réservation annulée avec succès.', reservation: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/super-admin/payments
async function listAllPayments(req, res) {
  try {
    const { page = 1, limit = 20, statut, tenant_id, mode, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = supabaseAdmin
      .from('paiements')
      .select(`
        *,
        profiles:user_id(id, nom, prenom, email, telephone, tenant_id, tenants:tenant_id(id, nom, slug)),
        reservations:reservation_id(id, date_debut, date_fin, espace_id, espaces:espace_id(nom, type, tenant_id, tenants:tenant_id(id, nom, slug))),
        tenants:tenant_id(id, nom, slug)
      `, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (statut) query = query.eq('statut', statut);
    if (mode) query = query.eq('mode', mode);
    if (tenant_id) query = query.eq('tenant_id', tenant_id);

    const { data, error, count } = await query.range(offset, offset + parseInt(limit) - 1);
    if (error) return res.status(500).json({ error: error.message });

    let rows = (data || []).map(p => {
      const resolvedTenant = p.tenants || p.reservations?.espaces?.tenants || p.profiles?.tenants || null;
      return {
        ...p,
        tenants: resolvedTenant,
      };
    });

    if (tenant_id) {
      rows = rows.filter(p => p.tenants?.id === tenant_id || p.tenant_id === tenant_id);
    }

    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(p =>
        (p.profiles?.nom || '').toLowerCase().includes(s) ||
        (p.profiles?.prenom || '').toLowerCase().includes(s) ||
        (p.profiles?.email || '').toLowerCase().includes(s) ||
        (p.numero_recu || '').toLowerCase().includes(s) ||
        (p.reference_externe || '').toLowerCase().includes(s) ||
        (p.tenants?.nom || '').toLowerCase().includes(s)
      );
    }

    res.json({ payments: rows, pagination: { page: parseInt(page), limit: parseInt(limit), total: count || 0 } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/super-admin/formations
async function listAllFormations(req, res) {
  try {
    const { page = 1, limit = 20, statut, tenant_id, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = supabaseAdmin
      .from('formations')
      .select(`
        *,
        profiles:formateur_id(id, nom, prenom, email, telephone),
        espaces:espace_id(id, nom, type, tenant_id, tenants:tenant_id(id, nom, slug)),
        tenants:tenant_id(id, nom, slug)
      `, { count: 'exact' })
      .order('date_debut', { ascending: false });

    if (statut) query = query.eq('statut', statut);

    const { data, error, count } = await query.range(offset, offset + parseInt(limit) - 1);
    if (error) return res.status(500).json({ error: error.message });

    let rows = await Promise.all((data || []).map(async f => {
      const { count: nbInscrits } = await supabaseAdmin
        .from('inscriptions_formations')
        .select('*', { count: 'exact', head: true })
        .eq('formation_id', f.id)
        .neq('statut', 'annulee');

      const resolvedTenant = f.tenants || f.espaces?.tenants || null;
      return {
        ...f,
        nb_inscrits: nbInscrits || 0,
        tenants: resolvedTenant,
      };
    }));

    if (tenant_id) {
      rows = rows.filter(f => f.tenants?.id === tenant_id || f.tenant_id === tenant_id);
    }

    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(f =>
        (f.titre || '').toLowerCase().includes(s) ||
        (f.description || '').toLowerCase().includes(s) ||
        (f.profiles?.nom || '').toLowerCase().includes(s) ||
        (f.profiles?.prenom || '').toLowerCase().includes(s) ||
        (f.tenants?.nom || '').toLowerCase().includes(s)
      );
    }

    res.json({ formations: rows, pagination: { page: parseInt(page), limit: parseInt(limit), total: count || 0 } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/super-admin/formations/:id/cancel
async function cancelFormation(req, res) {
  try {
    const { data: target, error: fetchErr } = await supabaseAdmin
      .from('formations')
      .select('id, titre')
      .eq('id', req.params.id)
      .single();

    if (fetchErr || !target) return res.status(404).json({ error: 'Formation introuvable.' });

    const { data, error } = await supabaseAdmin
      .from('formations')
      .update({ statut: 'annulee', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await auditLog(req.user.id, 'formation_cancelled_superadmin', 'formation', target.id, target.titre, {}, req.ip);
    res.json({ message: 'Formation annulée avec succès.', formation: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/super-admin/espaces
async function listAllEspaces(req, res) {
  try {
    const { page = 1, limit = 30, tenant_id, type, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = supabaseAdmin
      .from('espaces')
      .select(`
        *,
        tenants:tenant_id(id, nom, slug)
      `, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (tenant_id) query = query.eq('tenant_id', tenant_id);
    if (type) query = query.eq('type', type);

    const { data, error, count } = await query.range(offset, offset + parseInt(limit) - 1);
    if (error) return res.status(500).json({ error: error.message });

    let rows = (data || []).map(e => ({
      ...e,
      actif: e.actif !== undefined ? e.actif : true,
    }));

    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(e =>
        (e.nom || '').toLowerCase().includes(s) ||
        (e.tenants?.nom || '').toLowerCase().includes(s)
      );
    }

    res.json({ espaces: rows, pagination: { page: parseInt(page), limit: parseInt(limit), total: count || 0 } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// PATCH /api/super-admin/espaces/:id
async function toggleEspace(req, res) {
  try {
    const { actif, tarif_horaire, nom } = req.body;
    const updates = {};
    if (tarif_horaire !== undefined) updates.tarif_horaire = tarif_horaire;
    if (nom !== undefined) updates.nom = nom;

    const { data, error } = await supabaseAdmin
      .from('espaces')
      .update(updates)
      .eq('id', req.params.id)
      .select('*, tenants:tenant_id(id, nom, slug)')
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ espace: { ...data, actif: actif !== undefined ? actif : true } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  listTenants, getTenant, createTenant, updateTenant, deleteTenant, onboardTenant,
  getStats, getAuditLogs,
  listUsers, updateUser, deleteUser, getRolesSummary,
  listAllReservations, cancelReservation,
  listAllPayments,
  listAllFormations, cancelFormation,
  listAllEspaces, toggleEspace,
};
