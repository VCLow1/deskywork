// controllers/membersController.js — MODULE A : Profils membres
const { supabaseAdmin } = require('../config/supabase');
const { ensureQrToken, sanitizeProfileForClient } = require('../models/helpers');
const { applyTenantFilter } = require('../middleware/guards');
const { notifyNouveauMembre, sendNotification } = require('../services/notificationService');

async function getMe(req, res) {
  try {
    const isStaff = ['super_admin', 'admin', 'staff'].includes(req.profile.role);
    await ensureQrToken(req.user.id);
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', req.user.id)
      .single();

    if (error || !profile) {
      return res.status(404).json({ error: 'Profil introuvable.' });
    }

    res.json({ profile: sanitizeProfileForClient(profile, isStaff) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateMe(req, res) {
  try {
    const allowed = ['nom', 'prenom', 'telephone', 'cin', 'type_membre', 'photo_url', 'canal_notification', 'notifications'];
    const updates = {};

    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Aucun champ modifiable fourni.' });
    }

    const validTypes = ['individuel', 'entreprise', 'etudiant'];
    if (updates.type_membre && !validTypes.includes(updates.type_membre)) {
      return res.status(400).json({ error: 'type_membre invalide.' });
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', req.user.id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ profile: sanitizeProfileForClient(data, false) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function addDocument(req, res) {
  try {
    const { name, url, type } = req.body;
    if (!name || !url) {
      return res.status(400).json({ error: 'name et url sont requis.' });
    }

    const doc = {
      name,
      url,
      type: type || 'justificatif',
      uploaded_at: new Date().toISOString(),
    };

    const currentDocs = Array.isArray(req.profile.documents) ? req.profile.documents : [];
    const documents = [...currentDocs, doc];

    const { data, error } = await req.db
      .from('profiles')
      .update({ documents, updated_at: new Date().toISOString() })
      .eq('id', req.user.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ profile: sanitizeProfileForClient(data, false), document: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteDocument(req, res) {
  try {
    const index = Number(req.params.index);
    const currentDocs = Array.isArray(req.profile.documents) ? [...req.profile.documents] : [];

    if (Number.isNaN(index) || index < 0 || index >= currentDocs.length) {
      return res.status(404).json({ error: 'Document introuvable.' });
    }

    currentDocs.splice(index, 1);

    const { data, error } = await req.db
      .from('profiles')
      .update({ documents: currentDocs, updated_at: new Date().toISOString() })
      .eq('id', req.user.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ profile: sanitizeProfileForClient(data, false) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getMyQr(req, res) {
  try {
    const qr_token = await ensureQrToken(req.user.id);
    res.json({
      qr_token,
      payload: JSON.stringify({ user_id: req.user.id, qr_token }),
      member: {
        id: req.user.id,
        nom: req.profile.nom,
        prenom: req.profile.prenom,
        statut_compte: req.profile.statut_compte,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateMember(req, res) {
  try {
    const { notes_admin, statut_compte } = req.body;
    const updates = { updated_at: new Date().toISOString() };

    if (notes_admin !== undefined) updates.notes_admin = notes_admin;
    if (statut_compte !== undefined) {
      if (!['actif', 'suspendu', 'expire', 'en_attente'].includes(statut_compte)) {
        return res.status(400).json({ error: 'statut_compte invalide.' });
      }
      updates.statut_compte = statut_compte;
    }

    if (Object.keys(updates).length === 1) {
      return res.status(400).json({ error: 'Aucune mise à jour fournie.' });
    }

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    if (updates.statut_compte === 'actif') {
      try {
        await supabaseAdmin.auth.admin.updateUserById(req.params.id, { email_confirm: true });
      } catch (e) {
        console.warn('⚠️ Erreur confirmation email Supabase Auth:', e.message);
      }
    }

    res.json({ profile: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getPendingAccounts(req, res) {
  try {
    let query = supabaseAdmin
      .from('profiles')
      .select('id, nom, prenom, email, role, telephone, specialite, biographie, type_membre, statut_compte, created_at')
      .eq('statut_compte', 'en_attente')
      .order('created_at', { ascending: true });

    query = applyTenantFilter(query, req);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ pending: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function approveAccount(req, res) {
  try {
    const { action } = req.body;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'action doit être "approve" ou "reject".' });
    }

    const newStatut = action === 'approve' ? 'actif' : 'suspendu';

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update({ statut_compte: newStatut, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select('id, nom, prenom, email, role, statut_compte')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Si le statut passe à actif, auto-confirmer l'email dans Supabase Auth
    if (newStatut === 'actif') {
      try {
        await supabaseAdmin.auth.admin.updateUserById(req.params.id, { email_confirm: true });
      } catch (e) {
        console.warn('⚠️ Erreur confirmation email Supabase Auth:', e.message);
      }
    }
    res.json({
      profile: data,
      message: action === 'approve'
        ? `Compte de ${data.prenom} ${data.nom} approuvé avec succès.`
        : `Compte de ${data.prenom} ${data.nom} rejeté.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function listMembers(req, res) {
  try {
    let query = supabaseAdmin
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    query = applyTenantFilter(query, req);

    const { data, error } = await query;
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    res.json({ members: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getMember(req, res) {
  try {
    const isSelf = req.params.id === req.user.id;
    const isStaff = ['super_admin', 'admin', 'staff'].includes(req.profile.role);

    if (!isSelf && !isStaff) {
      return res.status(403).json({ error: 'Accès refusé.' });
    }

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) {
      return res.status(404).json({ error: 'Membre introuvable.' });
    }

    res.json({ profile: sanitizeProfileForClient(data, isStaff) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function sendWelcomeEmail(req, res) {
  const { userId } = req.body;
  const targetUserId = userId || req.user.id;

  try {
    const { data: membre, error } = await supabaseAdmin
      .from('profiles')
      .select('id, nom, prenom, email')
      .eq('id', targetUserId)
      .single();

    if (error || !membre) {
      return res.status(404).json({ error: 'Membre introuvable.' });
    }

    await notifyNouveauMembre(supabaseAdmin, {
      id: membre.id,
      nom: membre.nom,
      prenom: membre.prenom,
      email: membre.email
    });

    res.json({ message: 'Email de bienvenue envoyé avec succès.', membre });
  } catch (err) {
    console.error('Erreur envoi email bienvenue:', err);
    res.status(500).json({ error: err.message });
  }
}

async function testNotification(req, res) {
  try {
    const { canal, telephone } = req.body;
    const { data: prof, error } = await supabaseAdmin
      .from('profiles')
      .select('id, nom, prenom, email, telephone, canal_notification, notifications')
      .eq('id', req.user.id)
      .single();

    if (error || !prof) return res.status(404).json({ error: 'Profil introuvable.' });

    const chosenChannel = canal || prof.canal_notification || prof.notifications?.canal || 'email';
    const chosenPhone = telephone || prof.telephone;

    const sendRes = await sendNotification(supabaseAdmin, {
      type: 'test_notification',
      email: prof.email,
      userId: prof.id,
      phone: chosenPhone,
      channel: chosenChannel,
      data: { nom: `${prof.prenom || ''} ${prof.nom || ''}`.trim() || 'Membre' },
      subject: '✨ Test de notification DeskyWork',
    });

    res.json({
      message: `Notification de test envoyée avec succès sur le canal ${sendRes.canal}.`,
      details: sendRes,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getMe,
  updateMe,
  addDocument,
  deleteDocument,
  getMyQr,
  updateMember,
  getPendingAccounts,
  approveAccount,
  listMembers,
  getMember,
  sendWelcomeEmail,
  testNotification,
};
