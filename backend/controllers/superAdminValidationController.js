// controllers/superAdminValidationController.js — Validation Super Admin des Organisations et Formateurs
'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { auditLog } = require('../middleware/guards');
const { sendEmailUniversal } = require('../utils/sendEmail');

// ── Liste des validations en attente ─────────────────────────────────────────
async function getPendingValidations(req, res) {
  try {
    // 1. Organisations en attente de validation (coworking ou centre de formation)
    const { data: orgs, error: orgsErr } = await supabaseAdmin
      .from('organizations')
      .select(`
        id, type, nom, slug, ville, adresse, description, logo_url, cover_url,
        statut, created_at, telephone, email, owner_id,
        profiles!owner_id ( id, nom, prenom, email, telephone )
      `)
      .in('statut', ['en_validation', 'brouillon'])
      .order('created_at', { ascending: false });

    if (orgsErr) return res.status(500).json({ error: orgsErr.message });

    // 2. Profils formateurs en attente de validation
    const { data: trainers, error: trainersErr } = await supabaseAdmin
      .from('trainer_profiles')
      .select(`
        id, user_id, bio, domaines, certificats, telephone_pro,
        statut_validation, created_at,
        profiles!user_id ( id, nom, prenom, email, telephone )
      `)
      .eq('statut_validation', 'en_validation')
      .order('created_at', { ascending: false });

    if (trainersErr) return res.status(500).json({ error: trainersErr.message });

    res.json({
      pendingOrganizations: orgs || [],
      pendingTrainers: trainers || [],
      totalPending: (orgs?.length || 0) + (trainers?.length || 0),
    });
  } catch (err) {
    console.error('❌ Erreur getPendingValidations:', err);
    res.status(500).json({ error: err.message || 'Erreur lors du chargement des demandes.' });
  }
}

// ── Valider ou refuser une organisation ──────────────────────────────────────
async function validateOrganization(req, res) {
  try {
    const { id } = req.params;
    const { action, notes } = req.body; // action: 'approve' | 'reject'
    const adminId = req.user.id;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action invalide ("approve" ou "reject").' });
    }

    const nextStatut = action === 'approve' ? 'valide' : 'suspendu';

    // 1. Mettre à jour l'organisation
    const { data: org, error: orgErr } = await supabaseAdmin
      .from('organizations')
      .update({
        statut: nextStatut,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*, profiles!owner_id(id, email, nom, prenom)')
      .single();

    if (orgErr || !org) {
      return res.status(404).json({ error: 'Organisation introuvable.' });
    }

    // 2. Mettre à jour la table tenants synchronisée
    await supabaseAdmin
      .from('tenants')
      .update({
        statut: action === 'approve' ? 'actif' : 'suspendu',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    // 3. Notifier le propriétaire par notification et email
    const owner = org.profiles;
    if (owner?.id) {
      const message = action === 'approve'
        ? `🎉 Félicitations ! Votre espace "${org.nom}" a été validé par le Super Admin et est maintenant visible sur la marketplace.`
        : `⚠️ Votre demande pour l'espace "${org.nom}" a été refusée. Motif : ${notes || 'Non renseigné'}.`;

      await supabaseAdmin.from('notifications').insert({
        user_id: owner.id,
        type: action === 'approve' ? 'organisation_approuvee' : 'organisation_refusee',
        canal: 'Dashboard',
        message,
      });

      if (owner.email) {
        try {
          await sendEmailUniversal({
            to: owner.email,
            subject: action === 'approve' ? `Validation de votre espace "${org.nom}"` : `Information concernant "${org.nom}"`,
            text: message,
          });
        } catch (_) {}
      }
    }

    // 4. Audit Log
    await auditLog(
      adminId,
      action === 'approve' ? 'organization_approved' : 'organization_rejected',
      'organization',
      org.id,
      org.nom,
      { notes, action },
      req.ip
    );

    res.json({
      success: true,
      organization: org,
      message: action === 'approve'
        ? `L'espace "${org.nom}" a été approuvé avec succès.`
        : `L'espace "${org.nom}" a été rejeté.`,
    });
  } catch (err) {
    console.error('❌ Erreur validateOrganization:', err);
    res.status(500).json({ error: err.message || 'Erreur lors de la validation de l\'organisation.' });
  }
}

// ── Valider ou refuser un profil formateur ────────────────────────────────────
async function validateTrainer(req, res) {
  try {
    const { id } = req.params; // trainer_profile id ou user_id
    const { action, notes } = req.body;
    const adminId = req.user.id;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action invalide ("approve" ou "reject").' });
    }

    const nextStatut = action === 'approve' ? 'valide' : 'refuse';

    // 1. Mettre à jour trainer_profiles
    const { data: tp, error: tpErr } = await supabaseAdmin
      .from('trainer_profiles')
      .update({
        statut_validation: nextStatut,
        commentaires_admin: notes || null,
        updated_at: new Date().toISOString(),
      })
      .or(`id.eq.${id},user_id.eq.${id}`)
      .select('*, profiles!user_id(id, email, nom, prenom)')
      .single();

    if (tpErr || !tp) {
      return res.status(404).json({ error: 'Profil formateur introuvable.' });
    }

    // 2. Mettre à jour le rôle formateur dans profiles si approuvé
    if (action === 'approve') {
      await supabaseAdmin
        .from('profiles')
        .update({ role: 'formateur', updated_at: new Date().toISOString() })
        .eq('id', tp.user_id);
    }

    // 3. Notifier le formateur
    const trainerUser = tp.profiles;
    if (trainerUser?.id) {
      const message = action === 'approve'
        ? '🎓 Votre profil formateur a été validé avec succès ! Vous pouvez dès à présent créer et publier des formations sur la marketplace.'
        : `⚠️ Votre profil formateur n'a pas été validé. Motif : ${notes || 'Non renseigné'}.`;

      await supabaseAdmin.from('notifications').insert({
        user_id: trainerUser.id,
        type: action === 'approve' ? 'formateur_approuve' : 'formateur_refuse',
        canal: 'Dashboard',
        message,
      });

      if (trainerUser.email) {
        try {
          await sendEmailUniversal({
            to: trainerUser.email,
            subject: action === 'approve' ? 'Félicitations, votre profil formateur est validé !' : 'Mise à jour concernant votre profil formateur',
            text: message,
          });
        } catch (_) {}
      }
    }

    // 4. Audit Log
    await auditLog(
      adminId,
      action === 'approve' ? 'trainer_approved' : 'trainer_rejected',
      'trainer_profile',
      tp.id,
      trainerUser ? `${trainerUser.prenom} ${trainerUser.nom}` : tp.user_id,
      { notes, action },
      req.ip
    );

    res.json({
      success: true,
      trainerProfile: tp,
      message: action === 'approve'
        ? 'Profil formateur validé avec succès.'
        : 'Profil formateur refusé.',
    });
  } catch (err) {
    console.error('❌ Erreur validateTrainer:', err);
    res.status(500).json({ error: err.message || 'Erreur lors de la validation du formateur.' });
  }
}

module.exports = {
  getPendingValidations,
  validateOrganization,
  validateTrainer,
};

