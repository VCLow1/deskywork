// routes/otp.routes.js
// Génération et vérification du code OTP pour l'inscription
'use strict';

const express    = require('express');
const nodemailer = require('nodemailer');
const router     = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { sendEmailUniversal } = require('../utils/sendEmail');

// ── Transporter SMTP (réutilise la config existante) ─────────────────────────
function createTransporter() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const user = process.env.SMTP_USER;
  const pass = (process.env.SMTP_PASS || '').replace(/\s+/g, '');
  const isGmail = host.includes('gmail') || (user || '').endsWith('@gmail.com');
  const port = parseInt(process.env.SMTP_PORT) || (isGmail ? 465 : 587);
  const secure = port === 465 || isGmail;

  return nodemailer.createTransport({
    host: isGmail ? 'smtp.gmail.com' : host,
    port: isGmail ? 465 : port,
    secure: secure,
    family: 4, // Forcer l'IPv4 sur Render
    auth: { user: user, pass: pass },
    connectionTimeout: 8000,
    greetingTimeout: 4000,
    socketTimeout: 8000,
    tls: { rejectUnauthorized: false },
  });
}

// ── Template email OTP optimisé Inbox Principale ─────────────────────────────
function buildOtpEmailHTML(code, prenom) {
  const digits = code.split('');
  const coworkingName = process.env.COWORKING_NAME || 'DeskyWork';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code de confirmation - ${coworkingName}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f8fafc; padding: 40px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 520px; background-color: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
          
          <!-- En-tête de marque -->
          <tr>
            <td style="background-color: #100f0d; padding: 32px 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">
                ${coworkingName}
              </h1>
              <p style="margin: 6px 0 0; color: #f95d00; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px;">
                Vérification de sécurité
              </p>
            </td>
          </tr>

          <!-- Corps du message -->
          <tr>
            <td style="padding: 36px 32px 28px;">
              <p style="margin: 0 0 12px; color: #1e293b; font-size: 18px; font-weight: 700;">
                Bonjour ${prenom || ''},
              </p>
              <p style="margin: 0 0 28px; color: #475569; font-size: 14px; line-height: 1.6;">
                Merci de vous inscrire sur <strong>${coworkingName}</strong>. Veuillez utiliser le code de sécurité ci-dessous pour confirmer votre adresse email :
              </p>

              <!-- Bloc Code à 6 chiffres -->
              <div style="background-color: #f8fafc; border: 2px solid #e2e8f0; border-radius: 14px; padding: 20px; text-align: center; margin-bottom: 28px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
                  <tr>
                    ${digits.map(d => `
                    <td style="padding: 0 5px;">
                      <div style="width: 48px; height: 58px; line-height: 58px; background-color: #ffffff; border: 2px solid #f95d00; border-radius: 10px; font-size: 26px; font-weight: 800; color: #100f0d; text-align: center;">
                        ${d}
                      </div>
                    </td>`).join('')}
                  </tr>
                </table>
              </div>

              <!-- Information de validité -->
              <p style="margin: 0 0 24px; color: #64748b; font-size: 13px; line-height: 1.6; text-align: center;">
                ⏳ Ce code est strictement personnel et expire dans <strong>10 minutes</strong>.
              </p>

              <hr style="border: none; border-top: 1px solid #edf2f7; margin: 24px 0;" />

              <p style="margin: 0; color: #94a3b8; font-size: 12px; line-height: 1.5; text-align: center;">
                Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email en toute sécurité.
              </p>
            </td>
          </tr>

          <!-- Pied de page -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #edf2f7; padding: 18px 30px; text-align: center;">
              <p style="margin: 0; color: #94a3b8; font-size: 11px;">
                © ${new Date().getFullYear()} ${coworkingName} · Message automatique sécurisé
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── POST /api/otp/send ────────────────────────────────────────────────────────
// Génère un code OTP 6 chiffres, l'enregistre en DB, l'envoie par email
router.post('/otp/send', async (req, res) => {
  let { email, prenom } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email requis.' });
  }

  // Nettoyage et normalisation de l'email
  email = email.trim().toLowerCase();

  // Correction courante de faute de frappe (@gmial -> @gmail, @gmai -> @gmail, etc.)
  if (email.includes('@gmial.')) {
    email = email.replace('@gmial.', '@gmail.');
  }

  try {
    // Générer un code 6 chiffres aléatoire
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Invalider les anciens codes pour cet email
    await supabaseAdmin
      .from('email_otp')
      .update({ used: true })
      .eq('email', email)
      .eq('used', false);

    // Enregistrer le nouveau code
    const { error: insertError } = await supabaseAdmin
      .from('email_otp')
      .insert({ email, code, expires_at: expiresAt });

    if (insertError) throw insertError;

    // Envoyer l'email (Mailjet/Resend/Brevo HTTP API ou SMTP)
    if (process.env.MAILJET_API_KEY || process.env.RESEND_API_KEY || process.env.BREVO_API_KEY || (process.env.SMTP_USER && process.env.SMTP_PASS)) {
      try {
        const coworkingName = process.env.COWORKING_NAME || 'DeskyWork';
        const plainTextBody = `Bonjour ${prenom || ''},\n\nVotre code de confirmation pour votre compte ${coworkingName} est : ${code}\n\nCe code est valable pendant 10 minutes.\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet email.\n\nL'équipe ${coworkingName}`;

        await sendEmailUniversal({
          to: email,
          subject: `${coworkingName} - Code de confirmation : ${code}`,
          text: plainTextBody,
          html: buildOtpEmailHTML(code, prenom || ''),
        });

        console.log(`✉️  OTP ${code} envoyé à ${email}`);
      } catch (mailErr) {
        console.error(`❌ Erreur d'envoi d'email à ${email}:`, mailErr.message);
        return res.status(500).json({
          error: `Erreur d'envoi d'email : ${mailErr.message}`
        });
      }
    } else {
      console.warn(`⚠️ Aucun service email configuré sur Render. Code OTP généré en console : ${code}`);
      return res.status(500).json({
        error: "Le service d'envoi d'emails n'est pas configuré sur le serveur Render. (RESEND_API_KEY ou SMTP_USER/SMTP_PASS requis)."
      });
    }

    console.log(`\n========================================\n🔐 CODE OTP envoyé à ${email} : ${code}\n========================================\n`);

    res.json({
      success: true,
      message: 'Code envoyé par email.',
      email,
    });
  } catch (err) {
    console.error('❌ Erreur OTP send:', err.message);
    res.status(500).json({ error: 'Erreur lors de l\'envoi du code.' });
  }
});

// ── POST /api/otp/verify ─────────────────────────────────────────────────────
// Vérifie que le code saisi correspond au code en DB
router.post('/otp/verify', async (req, res) => {
  let { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ error: 'Email et code requis.' });
  }

  email = email.trim().toLowerCase();
  if (email.includes('@gmial.')) {
    email = email.replace('@gmial.', '@gmail.');
  }

  code = String(code).trim();

  try {
    // Chercher le code valide le plus récent
    const { data, error } = await supabaseAdmin
      .from('email_otp')
      .select('*')
      .eq('email', email)
      .eq('code', code)
      .eq('used', false)
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return res.status(400).json({ error: 'Code invalide ou expiré.' });
    }

    // Marquer le code comme utilisé
    await supabaseAdmin
      .from('email_otp')
      .update({ used: true })
      .eq('id', data.id);

    res.json({ success: true, message: 'Code vérifié avec succès.' });
  } catch (err) {
    console.error('❌ Erreur OTP verify:', err.message);
    res.status(500).json({ error: 'Erreur lors de la vérification.' });
  }
});

// ── POST /api/otp/auto-confirm ────────────────────────────────────────────────
// Auto-confirme l'email dans Supabase Auth et place le compte en attente
// Règle d'approbation :
// - TOUS les comptes créés (admin, member, formateur) -> statut_compte = 'en_attente'
// - Nécessite l'approbation du Super Admin pour être activé
router.post('/otp/auto-confirm', async (req, res) => {
  const { userId, email, role } = req.body;
  if (!userId && !email) {
    return res.status(400).json({ error: 'userId ou email requis.' });
  }

  try {
    let idToConfirm = userId;
    if (!idToConfirm && email) {
      const { data } = await supabaseAdmin.auth.admin.listUsers();
      const u = data?.users?.find(x => x.email === email);
      if (u) idToConfirm = u.id;
    }

    if (idToConfirm) {
      await supabaseAdmin.auth.admin.updateUserById(idToConfirm, { email_confirm: true });
      console.log(`✅ Email ${email || idToConfirm} auto-confirmé dans Supabase Auth.`);

      // Récupérer le profil actuel pour connaître le rôle réel
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, role, statut_compte, nom, prenom')
        .eq('id', idToConfirm)
        .single();

      const userRole = role || profile?.role || 'member';
      // Règle d'approbation :
      // Seule la création d'un espace de coworking (rôle 'admin') requiert l'approbation du Super Admin ('en_attente').
      // Les autres comptes (membres, formateurs, etc.) sont activés immédiatement ('actif').
      const targetStatus = userRole === 'admin' ? 'en_attente' : 'actif';

      // Mettre à jour le statut du compte
      await supabaseAdmin
        .from('profiles')
        .update({
          statut_compte: targetStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', idToConfirm);

      console.log(`✅ Compte ${idToConfirm} (${userRole}) configuré avec statut_compte = "${targetStatus}"`);

      // Notifier les super admins UNIQUEMENT pour la création d'un espace de coworking (admin)
      if (userRole === 'admin') {
        try {
          const { data: superAdmins } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('role', 'super_admin');

          if (superAdmins && superAdmins.length > 0) {
            const userName = profile ? `${profile.prenom} ${profile.nom}`.trim() : (email || 'Nouvel administrateur');
            for (const sa of superAdmins) {
              await supabaseAdmin.from('notifications').insert({
                user_id: sa.id,
                type: 'nouveau_coworking_en_attente',
                canal: 'Dashboard',
                message: `🏢 Nouvelle demande de coworking : ${userName} (${email || ''}) — En attente d'approbation Super Admin.`,
              });
            }
          }
        } catch (notifErr) {
          console.warn('⚠️ Erreur notification super admin nouveau coworking:', notifErr.message);
        }
      }
    }

    const effectiveStatus = (role === 'admin') ? 'en_attente' : 'actif';
    res.json({ success: true, statut_compte: effectiveStatus });
  } catch (err) {
    console.error('❌ Erreur auto-confirm:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

