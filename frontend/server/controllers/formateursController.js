// controllers/formateursController.js — MODULE G : Formateurs (Profils & Rémunérations)
const { supabaseAdmin } = require('../config/supabase');
const { applyTenantFilter } = require('../middleware/guards');
const crypto = require('crypto');

async function listFormateurs(req, res) {
  try {
    const isStaff = ['super_admin', 'admin', 'staff'].includes(req.profile.role);
    let query = supabaseAdmin
      .from('profiles')
      .select('id, nom, prenom, email, telephone, specialite, biographie, statut_compte, created_at, tenant_id')
      .eq('role', 'formateur')
      .order('nom', { ascending: true });

    if (!isStaff) query = query.eq('statut_compte', 'actif');
    query = applyTenantFilter(query, req);

    const { data: formateurs, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    let trainerIdsFromReservations = [];
    if (req.tenantId) {
      const { data: reservationOwners, error: bookingError } = await supabaseAdmin
        .from('reservations')
        .select('user_id')
        .eq('tenant_id', req.tenantId)
        .not('user_id', 'is', null);

      if (!bookingError && reservationOwners) {
        trainerIdsFromReservations = [...new Set(reservationOwners.map((r) => r.user_id).filter(Boolean))];
      }
    }

    let fallbackFormateurs = [];
    if (trainerIdsFromReservations.length > 0) {
      const { data: fallbackProfiles, error: fallbackError } = await supabaseAdmin
        .from('profiles')
        .select('id, nom, prenom, email, telephone, specialite, biographie, statut_compte, created_at, tenant_id')
        .in('id', trainerIdsFromReservations)
        .eq('role', 'formateur');

      if (!fallbackError) fallbackFormateurs = fallbackProfiles || [];
    }

    const merged = [...(formateurs || []), ...fallbackFormateurs].reduce((acc, current) => {
      const key = current.id;
      if (!acc[key]) acc[key] = current;
      return acc;
    }, {});

    const finalList = Object.values(merged).sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));
    res.json({ formateurs: finalList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getFormateur(req, res) {
  try {
    const { data: profile, error: profErr } = await supabaseAdmin
      .from('profiles')
      .select('id, nom, prenom, email, telephone, specialite, biographie, statut_compte, created_at')
      .eq('id', req.params.id)
      .eq('role', 'formateur')
      .single();

    if (profErr || !profile) return res.status(404).json({ error: 'Formateur introuvable.' });

    const { data: formations } = await supabaseAdmin
      .from('formations')
      .select('id, titre, date_debut, date_fin, statut, capacite_max, prix_inscription')
      .eq('formateur_id', req.params.id)
      .order('date_debut', { ascending: false });

    const { data: remuneration } = await supabaseAdmin
      .from('remuneration_formateurs')
      .select('id, montant, statut, date_versement, formations(titre)')
      .eq('formateur_id', req.params.id);

    res.json({ formateur: profile, formations: formations || [], remuneration: remuneration || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createFormateur(req, res) {
  try {
    const { nom, prenom, email, telephone, specialite, biographie } = req.body;
    if (!nom || !prenom || !email) {
      return res.status(400).json({ error: 'nom, prenom et email sont requis.' });
    }

    const temporaryPassword = crypto.randomUUID().slice(0, 12) + 'Aa1!';

    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { nom, prenom, role: 'formateur', telephone: telephone || '' },
    });
    if (authErr) return res.status(400).json({ error: authErr.message });

    const { data: profile, error: profErr } = await supabaseAdmin
      .from('profiles')
      .update({
        nom, prenom,
        telephone: telephone || '',
        specialite: specialite || '',
        biographie: biographie || '',
        tenant_id: req.tenantId,
        updated_at: new Date().toISOString()
      })
      .eq('id', authData.user.id)
      .select()
      .single();

    if (profErr) return res.status(400).json({ error: profErr.message });

    res.status(201).json({ formateur: profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateFormateur(req, res) {
  try {
    const allowed = ['nom', 'prenom', 'telephone', 'specialite', 'biographie', 'statut_compte'];
    const updates = { updated_at: new Date().toISOString() };
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 1) return res.status(400).json({ error: 'Aucune mise à jour fournie.' });

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', req.params.id)
      .eq('role', 'formateur')
      .select('id, nom, prenom, email, telephone, specialite, biographie, statut_compte')
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ formateur: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function addRemuneration(req, res) {
  try {
    const { formation_id, montant, statut, date_versement, note } = req.body;
    if (!formation_id || montant == null) return res.status(400).json({ error: 'formation_id et montant requis.' });

    const { data, error } = await supabaseAdmin
      .from('remuneration_formateurs')
      .upsert(
        {
          formateur_id: req.params.id,
          formation_id,
          montant: parseFloat(montant),
          statut: statut || 'en_attente',
          date_versement: date_versement || null,
          note: note || null
        },
        { onConflict: 'formateur_id,formation_id' }
      )
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ remuneration: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/formateurs/me/coworkings ────────────────────────────────────
async function trainerCoworkings(req, res) {
  try {
    const userId = req.user.id;
    const tenantIds = new Set();

    // Tenant du profil
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('tenant_id')
      .eq('id', userId)
      .single();
    if (profile?.tenant_id) tenantIds.add(profile.tenant_id);

    // Tenants de ses formations (via les espaces)
    const { data: formationSpaces } = await supabaseAdmin
      .from('formations')
      .select('espaces(tenant_id)')
      .eq('formateur_id', userId);
    (formationSpaces || []).forEach(fs => {
      if (fs.espaces?.tenant_id) tenantIds.add(fs.espaces.tenant_id);
    });

    // Tenants de ses réservations
    const { data: reservationTenants } = await supabaseAdmin
      .from('reservations')
      .select('tenant_id')
      .eq('user_id', userId);
    (reservationTenants || []).forEach(r => {
      if (r.tenant_id) tenantIds.add(r.tenant_id);
    });

    if (tenantIds.size === 0) return res.json({ coworkings: [] });

    const { data: tenants, error: tenantErr } = await supabaseAdmin
      .from('tenants')
      .select('id, nom, ville, adresse, statut, logo_url')
      .in('id', [...tenantIds]);

    if (tenantErr) return res.status(500).json({ error: tenantErr.message });

    // Nombre de formations et réservations par coworking
    const [formationCounts, reservationCounts] = await Promise.all([
      supabaseAdmin
        .from('formations')
        .select('espaces!inner(tenant_id)')
        .eq('formateur_id', userId),
      supabaseAdmin
        .from('reservations')
        .select('tenant_id')
        .eq('user_id', userId)
        .neq('statut', 'cancelled'),
    ]);

    const formPerTenant = {};
    (formationCounts.data || []).forEach(x => {
      const tid = x.espaces?.tenant_id;
      if (tid) formPerTenant[tid] = (formPerTenant[tid] || 0) + 1;
    });
    const resPerTenant = {};
    (reservationCounts.data || []).forEach(x => {
      if (x.tenant_id) resPerTenant[x.tenant_id] = (resPerTenant[x.tenant_id] || 0) + 1;
    });

    const coworkings = (tenants || []).map(t => ({
      id: t.id,
      nom: t.nom,
      ville: t.ville,
      adresse: t.adresse,
      statut: t.statut,
      logo_url: t.logo_url,
      nb_formations: formPerTenant[t.id] || 0,
      nb_reservations: resPerTenant[t.id] || 0,
    }));

    res.json({ coworkings, total: coworkings.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  listFormateurs,
  getFormateur,
  createFormateur,
  updateFormateur,
  addRemuneration,
  trainerCoworkings,
};
