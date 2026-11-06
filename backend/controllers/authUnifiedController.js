// controllers/authUnifiedController.js — Authentification Unifiée, Multi-tenant & Onboarding
'use strict';

const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const { sendEmailUniversal } = require('../utils/sendEmail');
const { sendWhatsApp, normalizePhoneNumber } = require('../services/whatsappService');

// ── Template email OTP Inbox Principale ──────────────────────────────────────
function buildOtpEmailHTML(code, prenom, title = 'Vérification de sécurité') {
  const digits = String(code).split('');
  const appName = process.env.COWORKING_NAME || 'DeskyWork';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code de confirmation - ${appName}</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f8fafc;padding:36px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:500px;background-color:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 10px 25px rgba(0,0,0,0.06);">
          <tr>
            <td style="background-color:#100f0d;padding:28px 24px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">${appName}</h1>
              <p style="margin:6px 0 0;color:#f95d00;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;">${title}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px 24px;">
              <p style="margin:0 0 10px;color:#1e293b;font-size:16px;font-weight:700;">Bonjour ${prenom || ''},</p>
              <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.6;">
                Voici votre code de sécurité à 6 chiffres pour valider votre adresse email :
              </p>
              <div style="background-color:#f8fafc;border:2px solid #e2e8f0;border-radius:14px;padding:18px;text-align:center;margin-bottom:24px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
                  <tr>
                    ${digits.map(d => `
                    <td style="padding:0 4px;">
                      <div style="width:44px;height:54px;line-height:54px;background-color:#ffffff;border:2px solid #f95d00;border-radius:8px;font-size:24px;font-weight:800;color:#100f0d;text-align:center;">${d}</div>
                    </td>`).join('')}
                  </tr>
                </table>
              </div>
              <p style="margin:0 0 20px;color:#64748b;font-size:12px;line-height:1.6;text-align:center;">
                ⏳ Ce code est strictement personnel et expire dans <strong>10 minutes</strong>.
              </p>
              <hr style="border:none;border-top:1px solid #edf2f7;margin:20px 0;" />
              <p style="margin:0;color:#94a3b8;font-size:11px;text-align:center;">
                Si vous n'êtes pas à l'origine de cette demande, ignorez cet email en toute sécurité.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f8fafc;border-top:1px solid #edf2f7;padding:14px 24px;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:10px;">© ${new Date().getFullYear()} ${appName} · Plateforme multi-tenant</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── 1. Inscription Étape 1 : Formulaire minimal (Personne) ─────────────────────
async function registerStep1(req, res) {
  try {
    const { email, password, nom, prenom, telephone } = req.body;

    if (!email || !password || !nom || !prenom) {
      return res.status(400).json({ error: 'Nom, prénom, email et mot de passe sont requis.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanNom = nom.trim();
    const cleanPrenom = prenom.trim();
    const cleanPhone = telephone ? telephone.trim() : '';

    if (password.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit comporter au moins 6 caractères.' });
    }

    // 1. Créer ou vérifier l'utilisateur dans Supabase Auth
    let userId = null;
    const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: false, // Email non confirmé au départ (OTP requis)
      user_metadata: {
        nom: cleanNom,
        prenom: cleanPrenom,
        telephone: cleanPhone,
        role: 'member',
      },
    });

    if (createError) {
      // Si l'utilisateur existe déjà
      const isAlreadyExists = createError.message?.toLowerCase().includes('already') ||
                              createError.message?.toLowerCase().includes('exists');
      if (isAlreadyExists) {
        // Récupérer l'utilisateur existant
        const { data: listData } = await supabaseAdmin.auth.admin.listUsers();
        const existingUser = listData?.users?.find(u => u.email?.toLowerCase() === cleanEmail);
        if (existingUser) {
          // Si son email est déjà confirmé, renvoyer une erreur explicite pour se connecter
          if (existingUser.email_confirmed_at) {
            return res.status(409).json({
              error: 'Un compte avec cette adresse email existe déjà. Veuillez vous connecter.',
              code: 'USER_EXISTS',
            });
          }
          // Sinon réutiliser son id pour renvoyer le code OTP
          userId = existingUser.id;
          await supabaseAdmin.auth.admin.updateUserById(userId, {
            password,
            user_metadata: { nom: cleanNom, prenom: cleanPrenom, telephone: cleanPhone },
          });
        } else {
          return res.status(400).json({ error: createError.message });
        }
      } else {
        return res.status(400).json({ error: createError.message });
      }
    } else {
      userId = createData.user.id;
    }

    // 2. Générer code OTP email 6 chiffres
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Invalider les anciens codes
    await supabaseAdmin
      .from('email_otp')
      .update({ used: true })
      .eq('email', cleanEmail)
      .eq('used', false);

    // Insérer le nouveau code
    await supabaseAdmin
      .from('email_otp')
      .insert({ email: cleanEmail, code, expires_at: expiresAt });

    // 3. Envoyer l'email OTP
    const appName = process.env.COWORKING_NAME || 'DeskyWork';
    try {
      await sendEmailUniversal({
        to: cleanEmail,
        subject: `${appName} - Code de confirmation : ${code}`,
        text: `Bonjour ${cleanPrenom},\n\nVotre code de confirmation pour votre compte ${appName} est : ${code}\n\nCe code expire dans 10 minutes.`,
        html: buildOtpEmailHTML(code, cleanPrenom, 'Confirmation de votre inscription'),
      });
      console.log(`✉️ OTP email envoyé à ${cleanEmail} : ${code}`);
    } catch (mailErr) {
      console.warn(`⚠️ Impossible d'envoyer l'email OTP (${mailErr.message}), code disponible en log : ${code}`);
    }

    res.status(201).json({
      success: true,
      userId,
      email: cleanEmail,
      telephone: cleanPhone,
      requiresEmailOtp: true,
      message: 'Compte créé avec succès. Un code de confirmation a été envoyé à votre adresse email.',
    });
  } catch (err) {
    console.error('❌ Erreur registerStep1:', err);
    res.status(500).json({ error: err.message || 'Erreur lors de la création du compte.' });
  }
}

// ── 2. Vérification OTP Email ────────────────────────────────────────────────
async function verifyEmailOtp(req, res) {
  try {
    const { email, code, userId } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: 'Email et code OTP requis.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = String(code).trim();

    // Rechercher le code valide
    const { data: otpData, error: otpErr } = await supabaseAdmin
      .from('email_otp')
      .select('*')
      .eq('email', cleanEmail)
      .eq('code', cleanCode)
      .eq('used', false)
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (otpErr) {
      console.error('❌ Erreur query email_otp:', otpErr);
      return res.status(500).json({ error: 'Erreur technique lors de la vérification. Veuillez réessayer.' });
    }

    if (!otpData) {
      return res.status(400).json({ error: 'Code de vérification invalide ou expiré.' });
    }

    // Marquer le code utilisé
    await supabaseAdmin
      .from('email_otp')
      .update({ used: true })
      .eq('id', otpData.id);

    // Trouver l'ID utilisateur
    let uid = userId;
    if (!uid) {
      const { data: uList } = await supabaseAdmin.auth.admin.listUsers();
      const matched = uList?.users?.find(u => u.email?.toLowerCase() === cleanEmail);
      if (matched) uid = matched.id;
    }

    // Marquer l'email confirmé dans Supabase Auth
    if (uid) {
      await supabaseAdmin.auth.admin.updateUserById(uid, { email_confirm: true });
      await supabaseAdmin
        .from('profiles')
        .update({ email_verifie: true, updated_at: new Date().toISOString() })
        .eq('id', uid);

      // Rattachement automatique historique Guest
      try {
        await supabaseAdmin
          .from('guests')
          .update({ converti_en_membre_id: uid, converti_at: new Date().toISOString() })
          .eq('email', cleanEmail)
          .is('converti_en_membre_id', null);

        const { data: guests } = await supabaseAdmin
          .from('guests')
          .select('id')
          .eq('email', cleanEmail);

        if (guests && guests.length > 0) {
          const guestIds = guests.map(g => g.id);
          await supabaseAdmin
            .from('reservations')
            .update({ user_id: uid })
            .in('guest_id', guestIds);

          await supabaseAdmin
            .from('inscriptions_formations')
            .update({ user_id: uid })
            .in('guest_id', guestIds);
          console.log(`🔗 Historique guest rattaché au compte ${uid}`);
        }
      } catch (guestErr) {
        console.warn('⚠️ Erreur rattachement historique guest:', guestErr.message);
      }
    }

    res.json({
      success: true,
      emailVerified: true,
      userId: uid,
      message: 'Adresse email vérifiée avec succès.',
    });
  } catch (err) {
    console.error('❌ Erreur verifyEmailOtp:', err);
    res.status(500).json({ error: err.message || 'Erreur lors de la vérification de l\'email.' });
  }
}

// ── 3. Envoi OTP Téléphone (WhatsApp ou SMS) ──────────────────────────────────
async function sendPhoneOtp(req, res) {
  try {
    const { phone, channel = 'whatsapp' } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Numéro de téléphone requis.' });
    }

    const cleanPhone = normalizePhoneNumber(phone);
    if (!cleanPhone || cleanPhone.length < 8) {
      return res.status(400).json({ error: 'Format de numéro de téléphone invalide.' });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Invalider les anciens codes pour ce numéro
    await supabaseAdmin
      .from('phone_otps')
      .update({ used: true })
      .eq('phone', cleanPhone)
      .eq('used', false);

    // Insérer le code
    await supabaseAdmin
      .from('phone_otps')
      .insert({
        phone: cleanPhone,
        code,
        channel,
        expires_at: expiresAt,
      });

    // Envoi WhatsApp ou SMS via le service unifié
    const appName = process.env.COWORKING_NAME || 'DeskyWork';
    const messageBody = `🔐 *${appName}* : Votre code de vérification est *${code}*.\n\nCe code expire dans 10 minutes. Ne le partagez jamais.`;

    const sendRes = await sendWhatsApp(cleanPhone, messageBody);
    console.log(`📱 OTP Téléphone envoyé à ${cleanPhone} [${channel}] : ${code} (Succès: ${sendRes.success})`);

    res.json({
      success: true,
      phone: cleanPhone,
      channel,
      simulated: sendRes.simulated || false,
      message: `Code de vérification envoyé par ${channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}.`,
    });
  } catch (err) {
    console.error('❌ Erreur sendPhoneOtp:', err);
    res.status(500).json({ error: err.message || 'Erreur lors de l\'envoi du code téléphone.' });
  }
}

// ── 4. Vérification OTP Téléphone ────────────────────────────────────────────
async function verifyPhoneOtp(req, res) {
  try {
    const { phone, code, userId } = req.body;
    if (!phone || !code) {
      return res.status(400).json({ error: 'Numéro de téléphone et code requis.' });
    }

    const cleanPhone = normalizePhoneNumber(phone);
    const cleanCode = String(code).trim();

    const { data, error } = await supabaseAdmin
      .from('phone_otps')
      .select('*')
      .eq('phone', cleanPhone)
      .eq('code', cleanCode)
      .eq('used', false)
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return res.status(400).json({ error: 'Code de vérification invalide ou expiré.' });
    }

    await supabaseAdmin
      .from('phone_otps')
      .update({ used: true })
      .eq('id', data.id);

    const uid = userId || req.user?.id;
    if (uid) {
      await supabaseAdmin
        .from('profiles')
        .update({
          telephone: cleanPhone,
          telephone_verifie: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', uid);
    }

    res.json({
      success: true,
      phoneVerified: true,
      message: 'Numéro de téléphone vérifié avec succès.',
    });
  } catch (err) {
    console.error('❌ Erreur verifyPhoneOtp:', err);
    res.status(500).json({ error: err.message || 'Erreur lors de la vérification du téléphone.' });
  }
}

// ── 5. Étape 2 : Choix du Profil ("Vous êtes… ?") ────────────────────────────
async function chooseProfileType(req, res) {
  try {
    const { profileType, userId, entrepriseData } = req.body;
    const uid = userId || req.user?.id;

    if (!uid) {
      return res.status(401).json({ error: 'Utilisateur non authentifié.' });
    }

    if (!['particulier', 'entreprise', 'formateur', 'coworking', 'centre_formation'].includes(profileType)) {
      return res.status(400).json({ error: 'Type de profil invalide.' });
    }

    // A. Particulier : activation directe de l'accès marketplace
    if (profileType === 'particulier') {
      await supabaseAdmin
        .from('profiles')
        .update({
          type_membre: 'individuel',
          statut_compte: 'actif',
          updated_at: new Date().toISOString(),
        })
        .eq('id', uid);

      return res.json({
        success: true,
        profileType: 'particulier',
        redirect: '/dashboard',
        message: 'Bienvenue sur la marketplace DeskyWork.',
      });
    }

    // B. Professionnel / Entreprise : création de l'organisation avec activation immédiate
    if (profileType === 'entreprise') {
      const nomSociete = entrepriseData?.nom || 'Mon Entreprise';
      const slug = `${nomSociete.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${uid.substring(0, 6)}`;

      const { data: org, error: orgErr } = await supabaseAdmin
        .from('organizations')
        .insert({
          type: 'entreprise',
          nom: nomSociete,
          slug,
          ville: entrepriseData?.ville || 'Tunis',
          adresse: entrepriseData?.adresse || 'Non renseignée',
          matricule_fiscal: entrepriseData?.matricule_fiscal || null,
          statut: 'valide', // Entreprise activée immédiatement
          owner_id: uid,
        })
        .select()
        .single();

      if (orgErr) return res.status(400).json({ error: orgErr.message });

      // Lier l'utilisateur en tant que propriétaire de son entreprise
      await supabaseAdmin
        .from('memberships')
        .insert({
          user_id: uid,
          organization_id: org.id,
          role: 'proprietaire',
          statut: 'actif',
        });

      await supabaseAdmin
        .from('profiles')
        .update({
          type_membre: 'entreprise',
          tenant_id: org.id,
          statut_compte: 'actif',
          updated_at: new Date().toISOString(),
        })
        .eq('id', uid);

      return res.json({
        success: true,
        profileType: 'entreprise',
        organization: org,
        redirect: '/dashboard',
        message: 'Entreprise enregistrée et activée.',
      });
    }

    // C. Formateur : redirection vers l'onboarding profil formateur
    if (profileType === 'formateur') {
      return res.json({
        success: true,
        profileType: 'formateur',
        redirect: '/onboarding/trainer',
      });
    }

    // D. Gestionnaire de Coworking ou Centre de Formation : redirection vers l'onboarding d'espace
    if (profileType === 'coworking' || profileType === 'centre_formation') {
      return res.json({
        success: true,
        profileType,
        redirect: `/onboarding/space?type=${profileType}`,
      });
    }
  } catch (err) {
    console.error('❌ Erreur chooseProfileType:', err);
    res.status(500).json({ error: err.message || 'Erreur lors de la sélection du profil.' });
  }
}

// ── 6. Onboarding Création d'Espace (Coworking / Centre de Formation) ─────────
async function createSpaceOnboarding(req, res) {
  try {
    const {
      type, // 'coworking' | 'centre_formation'
      nom,
      logo_url,
      cover_url,
      ville,
      adresse,
      horaires,
      description,
      telephone,
      email,
    } = req.body;

    const uid = req.user?.id || req.body.userId;
    if (!uid) return res.status(401).json({ error: 'Authentification requise.' });

    if (!nom || !ville || !adresse) {
      return res.status(400).json({ error: 'Le nom, la ville et l\'adresse sont obligatoires.' });
    }

    const orgType = type === 'centre_formation' ? 'centre_formation' : 'coworking';
    const slug = `${nom.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${uid.substring(0, 6)}`;

    // Statut initial : brouillon / en_validation (publié uniquement après validation Super Admin)
    const { data: org, error: orgErr } = await supabaseAdmin
      .from('organizations')
      .insert({
        type: orgType,
        nom,
        slug,
        logo_url: logo_url || null,
        cover_url: cover_url || null,
        ville,
        adresse,
        horaires: horaires || { lundi: '08:00 - 20:00' },
        description: description || null,
        telephone: telephone || null,
        email: email || null,
        statut: 'en_validation', // En attente de validation par le Super Admin VClow
        owner_id: uid,
        settings: { onboarding_completed: true },
      })
      .select()
      .single();

    if (orgErr) return res.status(400).json({ error: orgErr.message });

    // Créer le membership propriétaire
    await supabaseAdmin
      .from('memberships')
      .insert({
        user_id: uid,
        organization_id: org.id,
        role: 'proprietaire',
        statut: 'actif',
      });

    // Mettre à jour le profil
    await supabaseAdmin
      .from('profiles')
      .update({
        role: 'admin',
        tenant_id: org.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', uid);

    // Notifier le Super Admin VClow
    try {
      const { data: superAdmins } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .or('role.eq.super_admin,is_super_admin.eq.true');

      if (superAdmins) {
        for (const sa of superAdmins) {
          await supabaseAdmin.from('notifications').insert({
            user_id: sa.id,
            type: 'nouvelle_organisation_en_validation',
            canal: 'Dashboard',
            message: `🏢 Nouvelle organisation en attente de validation : "${nom}" (${orgType}).`,
          });
        }
      }
    } catch (nErr) {
      console.warn('⚠️ Erreur notification super admin:', nErr.message);
    }

    res.status(201).json({
      success: true,
      organization: org,
      status: 'en_validation',
      message: 'Votre espace a été créé en statut brouillon et soumis pour validation par le Super Admin.',
    });
  } catch (err) {
    console.error('❌ Erreur createSpaceOnboarding:', err);
    res.status(500).json({ error: err.message || 'Erreur lors de la création de l\'espace.' });
  }
}

// ── 7. Onboarding Profil Formateur ───────────────────────────────────────────
async function createTrainerProfile(req, res) {
  try {
    const { bio, domaines, certificats, telephone_pro } = req.body;
    const uid = req.user?.id || req.body.userId;

    if (!uid) return res.status(401).json({ error: 'Authentification requise.' });

    // Insérer ou mettre à jour dans trainer_profiles
    const domainesArray = Array.isArray(domaines) ? domaines : (domaines ? [domaines] : []);

    const { data: tp, error: tpErr } = await supabaseAdmin
      .from('trainer_profiles')
      .upsert({
        user_id: uid,
        bio: bio || null,
        domaines: domainesArray,
        certificats: certificats || [],
        telephone_pro: telephone_pro || null,
        statut_validation: 'en_validation', // En attente de validation Super Admin
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      .select()
      .single();

    if (tpErr) return res.status(400).json({ error: tpErr.message });

    // Notifier le Super Admin
    try {
      const { data: superAdmins } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .or('role.eq.super_admin,is_super_admin.eq.true');

      if (superAdmins) {
        for (const sa of superAdmins) {
          await supabaseAdmin.from('notifications').insert({
            user_id: sa.id,
            type: 'nouveau_formateur_en_validation',
            canal: 'Dashboard',
            message: `🎓 Nouveau profil formateur en attente de validation (User ID: ${uid}).`,
          });
        }
      }
    } catch (nErr) {
      console.warn('⚠️ Erreur notification super admin formateur:', nErr.message);
    }

    res.json({
      success: true,
      trainerProfile: tp,
      status: 'en_validation',
      message: 'Votre profil formateur a été enregistré et soumis pour validation. Vos formations pourront être publiées dès son approbation.',
    });
  } catch (err) {
    console.error('❌ Erreur createTrainerProfile:', err);
    res.status(500).json({ error: err.message || 'Erreur lors de la création du profil formateur.' });
  }
}

// ── 8. Contexte Utilisateur (Multi-Organisations & Redirection) ───────────────
async function getMyContext(req, res) {
  try {
    const uid = req.user.id;

    // 1. Profil utilisateur
    const { data: profile, error: pErr } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .single();

    if (pErr || !profile) {
      return res.status(404).json({ error: 'Profil introuvable.' });
    }

    // 2. Memberships et organisations liées
    const { data: memberships, error: mErr } = await supabaseAdmin
      .from('memberships')
      .select(`
        id, role, statut, organization_id,
        organizations (
          id, type, nom, slug, logo_url, cover_url, ville, adresse, statut
        )
      `)
      .eq('user_id', uid)
      .eq('statut', 'actif');

    // 3. Profil formateur
    const { data: trainerProfile } = await supabaseAdmin
      .from('trainer_profiles')
      .select('*')
      .eq('user_id', uid)
      .maybeSingle();

    const activeOrgs = (memberships || [])
      .filter(m => m.organizations)
      .map(m => ({
        membershipId: m.id,
        role: m.role,
        organization: m.organizations,
      }));

    // Déterminer la redirection optimale
    let redirectPath = '/dashboard';
    let userContextType = 'particulier';

    if (profile.is_super_admin || profile.role === 'super_admin') {
      redirectPath = '/super-admin/dashboard';
      userContextType = 'super_admin';
    } else if (activeOrgs.length > 1) {
      // Si l'utilisateur appartient à plusieurs organisations -> sélecteur requis
      redirectPath = '/select-space';
      userContextType = 'multi_org';
    } else if (activeOrgs.length === 1) {
      const single = activeOrgs[0];
      if (['proprietaire', 'admin', 'staff'].includes(single.role)) {
        redirectPath = '/admin/dashboard';
        userContextType = 'org_admin';
      } else if (single.role === 'formateur') {
        redirectPath = '/trainer-dashboard';
        userContextType = 'formateur';
      }
    } else if (trainerProfile && trainerProfile.statut_validation === 'valide') {
      redirectPath = '/trainer-dashboard';
      userContextType = 'formateur';
    }

    res.json({
      profile,
      memberships: activeOrgs,
      hasMultipleOrgs: activeOrgs.length > 1,
      trainerProfile,
      userContextType,
      recommendedRedirect: redirectPath,
    });
  } catch (err) {
    console.error('❌ Erreur getMyContext:', err);
    res.status(500).json({ error: err.message || 'Erreur lors de la récupération du contexte utilisateur.' });
  }
}

module.exports = {
  registerStep1,
  verifyEmailOtp,
  sendPhoneOtp,
  verifyPhoneOtp,
  chooseProfileType,
  createSpaceOnboarding,
  createTrainerProfile,
  getMyContext,
};

