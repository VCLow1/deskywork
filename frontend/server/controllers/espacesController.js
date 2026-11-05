// controllers/espacesController.js — MODULE B + ADMIN : Espaces & Tenant config
const { supabaseAdmin } = require('../config/supabase');
const { applyTenantFilter } = require('../middleware/guards');
const { getBookingAvailability, FORMATION_ROOM_UNAVAILABLE } = require('../models/helpers');

async function listEspaces(req, res) {
  try {
    let query = supabaseAdmin
      .from('espaces')
      .select('*')
      .order('tarif_horaire', { ascending: true });

    query = applyTenantFilter(query, req);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ espaces: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getAdminTenant(req, res) {
  try {
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateAdminTenant(req, res) {
  try {
    if (!req.tenantId) return res.status(404).json({ error: 'Aucun coworking associé à votre compte.' });

    const allowed = ['nom', 'description', 'adresse', 'ville', 'pays', 'email', 'telephone', 'site_web', 'logo_url', 'cover_url', 'latitude', 'longitude'];
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createAdminEspace(req, res) {
  try {
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateAdminEspace(req, res) {
  try {
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteAdminEspace(req, res) {
  try {
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function completeOnboarding(req, res) {
  try {
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function listTenants(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('tenants')
      .select('id, nom, adresse, ville, email, telephone, logo_url, statut')
      .eq('statut', 'actif')
      .order('nom', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ tenants: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function listEspacesFormation(req, res) {
  try {
    const { tenant_id, date_debut, date_fin, exclude_reservation_id } = req.query;
    if (!tenant_id) {
      return res.status(400).json({ error: 'tenant_id est requis.' });
    }

    const { data: espaces, error } = await supabaseAdmin
      .from('espaces')
      .select('*')
      .eq('tenant_id', tenant_id)
      .in('type', ['training_room', 'open_space', 'salle_formation'])
      .order('nom', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    if (!date_debut || !date_fin) {
      return res.json({ espaces: (espaces || []).map(e => ({ ...e, disponible: true })) });
    }

    const enriched = await Promise.all((espaces || []).map(async (espace) => {
      try {
        const avail = await getBookingAvailability(
          espace.id,
          date_debut,
          date_fin,
          exclude_reservation_id,
          { exclusive: true }
        );
        let raison = null;
        if (!avail.isAvailable) {
          if (espace.type === 'open_space') {
            raison = "Cet open space a déjà des réservations sur ce créneau. Une formation requiert l'espace complet libre.";
          } else {
            raison = avail.conflictMessage || "Cette salle est déjà réservée sur ce créneau.";
          }
        }
        return {
          ...espace,
          disponible: avail.isAvailable,
          raison_indisponibilite: raison,
        };
      } catch (err) {
        return {
          ...espace,
          disponible: false,
          raison_indisponibilite: err.message,
        };
      }
    }));

    res.json({ espaces: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  listEspaces,
  listTenants,
  listEspacesFormation,
  getAdminTenant,
  updateAdminTenant,
  createAdminEspace,
  updateAdminEspace,
  deleteAdminEspace,
  completeOnboarding,
};

