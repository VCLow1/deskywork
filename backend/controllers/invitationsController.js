// controllers/invitationsController.js — Gestion des invitations d'équipe (Staff, Formateurs, Admins)
'use strict';

const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const { sendEmailUniversal } = require('../utils/sendEmail');

// ── Créer et envoyer une invitation ──────────────────────────────────────────
async function createInvitation(req, res) {
  try {
    const { organization_id, email, role } = req.body;
    const orgId = organization_id || req.params.orgId;
    const callerId = req.user.id;

    if (!orgId || !email || !role) {
      return res.status(400).json({ error: 'Organisation, email et rôle requis.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const validRoles = ['admin', 'staff', 'formateur', 'lecture_seule'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Rôle invalide.' });
    }

    // 1. Vérifier que l'appelant a les droits (propriétaire, admin de l'org, ou super admin)
    const isSuperAdmin = req.profile?.is_super_admin || req.profile?.role === 'super_admin';
    if (!isSuperAdmin) {
      const { data: member } = await supabaseAdmin
        .from('memberships')
        .select('role, statut')
        .eq('organization_id', orgId)
        .eq('user_id', callerId)
        .eq('statut', 'actif')
        .single();

      if (!member || !['proprietaire', 'admin'].includes(member.role)) {
        return res.status(403).json({ error: 'Droits insuffisants pour inviter des membres dans cette organisation.' });
      }
    }

    // 2. Récupérer les informations de l'organisation
    const { data: org, error: orgErr } = await supabaseAdmin
      .from('organizations')
      .select('id, nom, logo_url, type')
      .eq('id', orgId)
      .single();

    if (orgErr || !org) {
      return res.status(404).json({ error: 'Organisation introuvable.' });
    }

    // 3. Générer un token unique cryptographique
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 jours

    // Invalider les invitations précédentes en attente pour le même email et la même org
    await supabaseAdmin
      .from('invitations')
      .update({ statut: 'expiree' })
      .eq('organization_id', orgId)
      .eq('email', cleanEmail)
      .eq('statut', 'en_attente');

    // 4. Insérer l'invitation
    const { data: invitation, error: invErr } = await supabaseAdmin
      .from('invitations')
      .insert({
        organization_id: orgId,
        email: cleanEmail,
        role,
        token,
        expires_at: expiresAt,
        statut: 'en_attente',
        invited_by: callerId,
      })
      .select()
      .single();

    if (invErr) return res.status(400).json({ error: invErr.message });

    // 5. Envoyer l'email d'invitation avec lien unique
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const inviteLink = `${frontendUrl}/invite/${token}`;
    const appName = process.env.COWORKING_NAME || 'DeskyWork';
    const roleLabels = {
      admin: 'Administrateur',
      staff: 'Staff / Réception',
      formateur: 'Formateur',
      lecture_seule: 'Lecture seule',
    };

    const emailHTML = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Invitation à rejoindre ${org.nom}</title></head>
<body style="font-family:Arial,sans-serif;background-color:#f8fafc;padding:30px 10px;margin:0;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:540px;margin:auto;background:#fff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
    <tr>
      <td style="background:#100f0d;padding:24px;text-align:center;">
        <h1 style="color:#ffffff;font-size:20px;margin:0;">${appName}</h1>
      </td>
    </tr>
    <tr>
      <td style="padding:32px 28px;">
        <h2 style="color:#1e293b;font-size:18px;margin-top:0;">Invitation à rejoindre une équipe</h2>
        <p style="color:#475569;font-size:14px;line-height:1.6;">
          Vous avez été invité(e) à rejoindre l'organisation <strong>${org.nom}</strong> avec le rôle de <strong>${roleLabels[role] || role}</strong>.
        </p>
        <div style="text-align:center;margin:32px 0;">
          <a href="${inviteLink}" style="display:inline-block;background:#f95d00;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:bold;font-size:14px;">
            Accepter l'invitation
          </a>
        </div>
        <p style="color:#64748b;font-size:12px;line-height:1.5;">
          Ce lien d'invitation est strictement personnel, à usage unique et expire dans 7 jours.<br />
          Si vous n'avez pas encore de compte, vous pourrez le créer directement en cliquant sur le bouton.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

    try {
      await sendEmailUniversal({
        to: cleanEmail,
        subject: `Invitation à rejoindre ${org.nom} sur ${appName}`,
        text: `Bonjour,\n\nVous êtes invité(e) à rejoindre ${org.nom} en tant que ${roleLabels[role] || role}.\n\nCliquez sur ce lien pour accepter : ${inviteLink}\n\nL'équipe ${appName}`,
        html: emailHTML,
      });
    } catch (eErr) {
      console.warn('⚠️ Erreur envoi email invitation:', eErr.message);
    }

    res.status(201).json({
      success: true,
      invitation,
      inviteLink,
      message: `Invitation envoyée avec succès à ${cleanEmail}.`,
    });
  } catch (err) {
    console.error('❌ Erreur createInvitation:', err);
    res.status(500).json({ error: err.message || 'Erreur lors de la création de l\'invitation.' });
  }
}

// ── Consulter les informations d'une invitation via son token ────────────────
async function getInvitationInfo(req, res) {
  try {
    const { token } = req.params;
    if (!token) return res.status(400).json({ error: 'Token requis.' });

    const { data: inv, error } = await supabaseAdmin
      .from('invitations')
      .select(`
        id, email, role, token, expires_at, statut,
        organizations (
          id, nom, logo_url, cover_url, type, ville, adresse, description
        )
      `)
      .eq('token', token)
      .maybeSingle();

    if (error || !inv) {
      return res.status(404).json({ error: 'Invitation introuvable ou lien invalide.' });
    }

    // Vérifier l'expiration
    const isExpired = new Date(inv.expires_at) < new Date();
    if (isExpired && inv.statut === 'en_attente') {
      await supabaseAdmin.from('invitations').update({ statut: 'expiree' }).eq('id', inv.id);
      inv.statut = 'expiree';
    }

    res.json({
      valid: inv.statut === 'en_attente' && !isExpired,
      invitation: inv,
    });
  } catch (err) {
    console.error('❌ Erreur getInvitationInfo:', err);
    res.status(500).json({ error: err.message || 'Erreur lors de la lecture de l\'invitation.' });
  }
}

// ── Accepter une invitation ──────────────────────────────────────────────────
async function acceptInvitation(req, res) {
  try {
    const { token } = req.params;
    const userId = req.user.id;

    if (!token) return res.status(400).json({ error: 'Token requis.' });

    // 1. Chercher l'invitation
    const { data: inv, error: invErr } = await supabaseAdmin
      .from('invitations')
      .select('*, organizations(id, nom)')
      .eq('token', token)
      .single();

    if (invErr || !inv) {
      return res.status(404).json({ error: 'Invitation introuvable.' });
    }

    if (inv.statut === 'acceptee') {
      return res.status(400).json({ error: 'Cette invitation a déjà été acceptée.' });
    }

    if (inv.statut === 'expiree' || new Date(inv.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Cette invitation a expiré.' });
    }

    // 2. Créer ou mettre à jour le membership de l'utilisateur
    const { data: membership, error: memErr } = await supabaseAdmin
      .from('memberships')
      .upsert({
        user_id: userId,
        organization_id: inv.organization_id,
        role: inv.role,
        statut: 'actif',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id, organization_id' })
      .select()
      .single();

    if (memErr) return res.status(400).json({ error: memErr.message });

    // 3. Marquer l'invitation comme acceptée (usage unique)
    await supabaseAdmin
      .from('invitations')
      .update({ statut: 'acceptee', updated_at: new Date().toISOString() })
      .eq('id', inv.id);

    // 4. Mettre à jour le profil pour lier le tenant par défaut si non défini
    await supabaseAdmin
      .from('profiles')
      .update({ tenant_id: inv.organization_id, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .is('tenant_id', null);

    res.json({
      success: true,
      membership,
      organizationName: inv.organizations?.nom,
      message: `Félicitations ! Vous avez rejoint "${inv.organizations?.nom}" en tant que ${inv.role}.`,
    });
  } catch (err) {
    console.error('❌ Erreur acceptInvitation:', err);
    res.status(500).json({ error: err.message || 'Erreur lors de l\'acceptation de l\'invitation.' });
  }
}

// ── Liste des invitations d'une organisation ─────────────────────────────────
async function listInvitations(req, res) {
  try {
    const orgId = req.params.orgId;
    let query = supabaseAdmin
      .from('invitations')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ invitations: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── Révoquer une invitation ──────────────────────────────────────────────────
async function revokeInvitation(req, res) {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('invitations')
      .update({ statut: 'refusee', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, invitation: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  createInvitation,
  getInvitationInfo,
  acceptInvitation,
  listInvitations,
  revokeInvitation,
};

