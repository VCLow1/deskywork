// controllers/authUnifiedController.js — Authentification Unifiée Multi-rôles, Vérification E-mail & Onboarding (CDC v3.0)
'use strict';

const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const { sendEmailUniversal } = require('../utils/sendEmail');

const VALID_REQUESTED_ROLES = [
  'MEMBER',
  'COMPANY',
  'TRAINER',
  'COWORKING_ADMIN',
  'TRAINING_CENTER_ADMIN',
];

const SAAS_PACK_CONFIG = {
  essentiel: {
    id: 'essentiel',
    label: 'Essentiel (90 DT HT/mois)',
    dbPlan: 'starter',
    tier: 'C',
    montant_mensuel: 90,
    limite_espaces: 10,
    limite_membres: 50,
    limite_staffs: 1,
  },
  standard: {
    id: 'standard',
    label: 'Standard (150 DT HT/mois)',
    dbPlan: 'pro',
    tier: 'B',
    montant_mensuel: 150,
    limite_espaces: 30,
    limite_membres: 300,
    limite_staffs: 3,
  },
  premium: {
    id: 'premium',
    label: 'Premium (220 DT HT/mois)',
    dbPlan: 'enterprise',
    tier: 'A',
    montant_mensuel: 220,
    limite_espaces: 999999,
    limite_membres: 999999,
    limite_staffs: 10,
  },
};

const ROLE_LABELS_FR = {
  member: 'Membre',
  formateur: 'Formateur',
  admin: 'Gestionnaire d\'établissement',
  staff: 'Staff',
  super_admin: 'Super Admin',
  MEMBER: 'Particulier (Membre)',
  COMPANY: 'Entreprise',
  TRAINER: 'Formateur',
  COWORKING_ADMIN: 'Coworking Space',
  TRAINING_CENTER_ADMIN: 'Centre de formation',
};

function normalizeRequestedRole(rawRole, accountTypeFallback) {
  const r = String(rawRole || '').trim();
  if (VALID_REQUESTED_ROLES.includes(r)) return r;
  const lower = r.toLowerCase();
  if (lower === 'entreprise' || accountTypeFallback === 'entreprise') return 'COMPANY';
  if (lower === 'formateur' || lower === 'trainer') return 'TRAINER';
  if (lower === 'coworking' || lower === 'coworking_admin') return 'COWORKING_ADMIN';
  if (lower === 'centre_formation' || lower === 'training_center_admin') return 'TRAINING_CENTER_ADMIN';
  return 'MEMBER';
}

function splitFullName(fullName, prenomInput, nomInput) {
  if (prenomInput && nomInput) {
    return { prenom: String(prenomInput).trim(), nom: String(nomInput).trim() };
  }
  const clean = String(fullName || '').trim().replace(/\s+/g, ' ');
  if (!clean) {
    return {
      prenom: String(prenomInput || '').trim(),
      nom: String(nomInput || '').trim(),
    };
  }
  const parts = clean.split(' ');
  if (parts.length === 1) {
    return { prenom: parts[0], nom: parts[0] };
  }
  return {
    prenom: parts[0],
    nom: parts.slice(1).join(' '),
  };
}

function slugifyEstablishment(name, uid) {
  const base = String(name || 'etablissement')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42) || 'etablissement';
  const suffix = String(uid || crypto.randomUUID()).replace(/-/g, '').slice(0, 6);
  return `${base}-${suffix}`;
}

function getTokenSecret() {
  return process.env.EMAIL_VERIFY_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'deskywork-email-verify-fallback';
}

function signEmailVerifyToken({ uid, email, code, requestedRole }) {
  const payload = {
    uid,
    email: String(email).trim().toLowerCase(),
    code: String(code),
    role: requestedRole || 'MEMBER',
    exp: Date.now() + 24 * 60 * 60 * 1000, // 24 heures
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getTokenSecret()).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

function verifySignedEmailToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', getTokenSecret()).update(payloadB64).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!parsed?.exp || Date.now() > parsed.exp) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function resolveFrontendOrigin(req) {
  const originHeader = req?.headers?.origin;
  if (originHeader && /^https?:\/\//i.test(originHeader)) {
    return originHeader.replace(/\/$/, '');
  }
  const envUrls = (process.env.FRONTEND_URL || '').split(',').map((s) => s.trim()).filter(Boolean);
  const nonLocal = envUrls.find((u) => !u.includes('localhost'));
  return (nonLocal || envUrls[0] || 'https://deskywork-jet.vercel.app').replace(/\/$/, '');
}

async function findAuthUserByEmail(cleanEmail) {
  const normalized = String(cleanEmail || '').trim().toLowerCase();
  if (!normalized) return { authUser: null, profile: null };

  // 1. Recherche insensible à la casse via profiles
  const { data: prof } = await supabaseAdmin
    .from('profiles')
    .select('id, email, role, statut_compte, email_verifie, telephone, type_membre')
    .ilike('email', normalized)
    .limit(1)
    .maybeSingle();

  if (prof?.id) {
    const { data: userRes } = await supabaseAdmin.auth.admin.getUserById(prof.id);
    if (userRes?.user) return { authUser: userRes.user, profile: prof };
  }

  // 2. Fallback paginé complet dans auth.users (évite la limite de 50/1000 par page)
  try {
    for (let page = 1; page <= 20; page++) {
      const { data: listData, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
      if (listErr || !listData?.users?.length) break;
      const matched = listData.users.find((u) => u.email?.trim().toLowerCase() === normalized);
      if (matched) {
        return { authUser: matched, profile: prof || null };
      }
      if (listData.users.length < 1000) break;
    }
  } catch (_) {}

  return { authUser: null, profile: prof || null };
}

// ── Template email vérification unifié (Lien 24h + Code OTP 6 chiffres) ───────
function buildVerificationEmailHTML({ code, verifyUrl, prenom, roleLabel }) {
  const digits = String(code).split('');
  const appName = process.env.COWORKING_NAME || 'DeskyWork';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirmez votre adresse e-mail - ${appName}</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f8fafc;padding:36px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:540px;background-color:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 10px 25px rgba(0,0,0,0.06);">
          <tr>
            <td style="background-color:#100f0d;padding:28px 24px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">${appName}</h1>
              <p style="margin:6px 0 0;color:#f95d00;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;">Activation de votre compte ${roleLabel || ''}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px 24px;">
              <p style="margin:0 0 12px;color:#1e293b;font-size:16px;font-weight:700;">Bonjour ${prenom || ''},</p>
              <p style="margin:0 0 22px;color:#475569;font-size:14px;line-height:1.6;">
                Bienvenue sur <strong>${appName}</strong> ! Pour activer votre compte <strong>${roleLabel || 'DeskyWork'}</strong>, cliquez sur le bouton ci-dessous ou saisissez le code de confirmation :
              </p>

              <div style="text-align:center;margin:24px 0 26px;">
                <a href="${verifyUrl}" target="_blank" style="display:inline-block;background-color:#f95d00;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:12px;">
                  Confirmer mon adresse e-mail
                </a>
              </div>

              <div style="background-color:#f8fafc;border:2px solid #e2e8f0;border-radius:14px;padding:18px;text-align:center;margin-bottom:20px;">
                <p style="margin:0 0 10px;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">Ou saisissez ce code à 6 chiffres</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
                  <tr>
                    ${digits.map((d) => `
                    <td style="padding:0 4px;">
                      <div style="width:42px;height:52px;line-height:52px;background-color:#ffffff;border:2px solid #f95d00;border-radius:8px;font-size:23px;font-weight:800;color:#100f0d;text-align:center;">${d}</div>
                    </td>`).join('')}
                  </tr>
                </table>
              </div>

              <p style="margin:0 0 18px;color:#64748b;font-size:12px;line-height:1.6;text-align:center;">
                ⏳ Ce lien et ce code expirent sous <strong>24 heures</strong>.
              </p>
              <p style="margin:0 0 18px;color:#94a3b8;font-size:11px;line-height:1.5;word-break:break-all;">
                Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br />
                <a href="${verifyUrl}" style="color:#f95d00;">${verifyUrl}</a>
              </p>
              <hr style="border:none;border-top:1px solid #edf2f7;margin:20px 0;" />
              <p style="margin:0;color:#94a3b8;font-size:11px;text-align:center;">
                Si vous n'êtes pas à l'origine de cette inscription, ignorez cet e-mail en toute sécurité.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f8fafc;border-top:1px solid #edf2f7;padding:14px 24px;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:10px;">© ${new Date().getFullYear()} ${appName} · Plateforme SaaS & Marketplace (Tunisie)</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Génère code + lien 24h et envoie l'e-mail réel ───────────────────────────
async function issueAndSendEmailVerification({ userId, email, prenom, requestedRole, frontendOrigin }) {
  const cleanEmail = String(email).trim().toLowerCase();
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await supabaseAdmin
    .from('email_otp')
    .update({ used: true })
    .eq('email', cleanEmail)
    .eq('used', false);

  const { error: otpInsertErr } = await supabaseAdmin
    .from('email_otp')
    .insert({ email: cleanEmail, code, expires_at: expiresAt });

  if (otpInsertErr) {
    throw new Error(`Erreur enregistrement token e-mail : ${otpInsertErr.message}`);
  }

  const token = signEmailVerifyToken({ uid: userId, email: cleanEmail, code, requestedRole });
  const verifyUrl = `${frontendOrigin}/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(cleanEmail)}`;
  const appName = process.env.COWORKING_NAME || 'DeskyWork';
  const roleLabel = ROLE_LABELS_FR[requestedRole] || 'DeskyWork';

  let emailSent = false;
  let emailError = null;

  try {
    await sendEmailUniversal({
      to: cleanEmail,
      subject: `${appName} - Activez votre compte (${code})`,
      text: `Bonjour ${prenom || ''},\n\nConfirmez votre adresse e-mail pour activer votre compte ${roleLabel} sur ${appName}.\n\nLien de confirmation (valable 24h) : ${verifyUrl}\nCode de vérification : ${code}\n`,
      html: buildVerificationEmailHTML({ code, verifyUrl, prenom, roleLabel }),
    });
    emailSent = true;
    console.log(`✉️ E-mail de vérification envoyé à ${cleanEmail} (code: ${code})`);
  } catch (mailErr) {
    emailError = mailErr.message;
    console.warn(`⚠️ Impossible d'envoyer l'e-mail de vérification à ${cleanEmail} : ${mailErr.message} (code: ${code})`);
  }

  return { code, emailSent, emailError };
}

// ── Upload justificatif formateur optionnel si fichier base64 fourni ─────────
async function uploadOptionalTrainerDocument(uid, filePayload) {
  if (!filePayload?.base64 || !filePayload?.filename) return null;
  const cleanName = String(filePayload.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `trainers/${uid}/${Date.now()}-${cleanName}`;
  const buffer = Buffer.from(filePayload.base64, 'base64');

  if (buffer.length > 3 * 1024 * 1024) {
    return null;
  }

  for (const bucket of ['coworking-images', 'documents', 'avatars']) {
    try {
      const { error: upErr } = await supabaseAdmin.storage
        .from(bucket)
        .upload(storagePath, buffer, {
          contentType: filePayload.contentType || 'application/octet-stream',
          upsert: true,
        });
      if (!upErr) {
        const { data: pub } = supabaseAdmin.storage.from(bucket).getPublicUrl(storagePath);
        if (pub?.publicUrl) return pub.publicUrl;
      }
    } catch (_) {}
  }

  return null;
}

// ── Notifications Super Admin helper ─────────────────────────────────────────
async function notifySuperAdmins(type, message) {
  try {
    const { data: superAdmins } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .or('role.eq.super_admin,is_super_admin.eq.true');

    if (superAdmins && superAdmins.length > 0) {
      const rows = superAdmins.map((sa) => ({
        user_id: sa.id,
        type,
        canal: 'Dashboard',
        message,
      }));
      await supabaseAdmin.from('notifications').insert(rows);
    }
  } catch (nErr) {
    console.warn('⚠️ Notification Super Admin non envoyée:', nErr.message);
  }
}

// ── Persistance unifiée selon l'un des 5 rôles ───────────────────────────────
async function persistRegistrationByRole({ userId, email, requestedRole, payload, existingMetadata = {} }) {
  const cleanEmail = String(email).trim().toLowerCase();
  const { prenom, nom } = splitFullName(
    payload.nom_complet || payload.full_name || payload.nom_gerant,
    payload.prenom,
    payload.nom
  );
  const cleanPhone = String(payload.telephone || '').trim();

  let dbRole = 'member';
  let typeMembre = 'individuel';
  let statutCompte = 'actif';
  let typeCompteMeta = 'particulier';

  if (requestedRole === 'COMPANY') {
    dbRole = 'member';
    typeMembre = 'entreprise';
    typeCompteMeta = 'entreprise';
  } else if (requestedRole === 'TRAINER') {
    dbRole = 'formateur';
    typeMembre = null;
    statutCompte = 'actif'; // Accès au dashboard formateur avec bannière Pending
    typeCompteMeta = 'formateur';
  } else if (requestedRole === 'COWORKING_ADMIN' || requestedRole === 'TRAINING_CENTER_ADMIN') {
    dbRole = 'admin';
    typeMembre = null;
    statutCompte = 'en_attente'; // En attente validation Super Admin DeskyWork
    typeCompteMeta = requestedRole === 'COWORKING_ADMIN' ? 'coworking' : 'centre_formation';
  }

  const nextMetadata = {
    ...existingMetadata,
    nom,
    prenom,
    full_name: `${prenom} ${nom}`.trim(),
    telephone: cleanPhone,
    role: dbRole,
    requested_role: requestedRole,
    type_compte: typeCompteMeta,
    email_verifie: false,
    requires_email_verification: true,
  };

  // Mettre à jour metadata Supabase Auth
  await supabaseAdmin.auth.admin.updateUserById(userId, {
    user_metadata: nextMetadata,
  });

  // Champs profil
  const profilePatch = {
    email: cleanEmail,
    nom,
    prenom,
    telephone: cleanPhone || null,
    role: dbRole,
    type_membre: typeMembre,
    statut_compte: statutCompte,
    email_verifie: false,
    updated_at: new Date().toISOString(),
  };

  let createdOrg = null;
  let createdTrainer = null;

  // ── Cas TRAINER (Formateur) ──
  if (requestedRole === 'TRAINER') {
    const cleanSpec = String(payload.specialite || '').trim();
    const cleanBio = String(payload.biographie || payload.bio || '').trim();
    const domainesArray = cleanSpec
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    let docUrl = payload.justificatif_url ? String(payload.justificatif_url).trim() : '';
    let photoUrl = payload.photo_url ? String(payload.photo_url).trim() : '';

    if (payload.justificatif_file) {
      const uploaded = await uploadOptionalTrainerDocument(userId, payload.justificatif_file);
      if (uploaded) docUrl = uploaded;
    }

    const certificats = [];
    if (docUrl) {
      certificats.push({ titre: payload.justificatif_file?.filename || 'Justificatif formateur', url: docUrl });
    } else if (payload.justificatif_file?.filename) {
      certificats.push({ titre: payload.justificatif_file.filename });
    }

    profilePatch.specialite = cleanSpec || null;
    profilePatch.biographie = cleanBio || null;
    if (photoUrl) profilePatch.photo_url = photoUrl;
    if (certificats.length > 0) profilePatch.documents = certificats;

    const tpPayload = {
      user_id: userId,
      bio: cleanBio || null,
      domaines: domainesArray,
      certificats,
      telephone_pro: cleanPhone || null,
      statut_validation: 'en_validation',
      updated_at: new Date().toISOString(),
    };

    let { data: tp, error: tpErr } = await supabaseAdmin
      .from('trainer_profiles')
      .upsert(tpPayload, { onConflict: 'user_id' })
      .select()
      .single();

    if (tpErr && String(tpErr.message || '').includes('telephone_pro')) {
      const { telephone_pro, ...fallbackTp } = tpPayload;
      const retry = await supabaseAdmin
        .from('trainer_profiles')
        .upsert(fallbackTp, { onConflict: 'user_id' })
        .select()
        .single();
      tp = retry.data;
      tpErr = retry.error;
    }
    if (tpErr) throw new Error(tpErr.message);
    createdTrainer = tp;

    await notifySuperAdmins(
      'nouveau_formateur_en_validation',
      `🎓 Nouveau formateur inscrit (${prenom} ${nom} — ${cleanSpec}) en attente de validation.`
    );
  }

  // ── Cas B2B (Coworking Space / Centre de formation) ──
  if (requestedRole === 'COWORKING_ADMIN' || requestedRole === 'TRAINING_CENTER_ADMIN') {
    const nomEtablissement = String(payload.nom_etablissement || '').trim();
    const ville = String(payload.ville || '').trim();
    const adresse = String(payload.adresse || '').trim();
    const nbEspaces = Math.max(1, parseInt(payload.nb_espaces, 10) || 1);
    const packKey = SAAS_PACK_CONFIG[payload.pack_saas] ? payload.pack_saas : 'standard';
    const packConfig = SAAS_PACK_CONFIG[packKey];

    const isMixte = Boolean(payload.mixte || payload.propose_formations || payload.propose_coworking);
    const orgType = requestedRole === 'TRAINING_CENTER_ADMIN' ? 'centre_formation' : 'coworking';
    const activite = isMixte ? 'mixte' : orgType;

    const settingsObj = {
      onboarding_completed: false,
      activite,
      saas_pack: packKey,
      nb_espaces_estime: nbEspaces,
      nom_gerant: `${prenom} ${nom}`.trim(),
      propose_formations: requestedRole === 'TRAINING_CENTER_ADMIN' || Boolean(payload.propose_formations || isMixte),
      propose_coworking: requestedRole === 'COWORKING_ADMIN' || Boolean(payload.propose_coworking || isMixte),
    };

    // Réutiliser une organisation déjà en_validation pour ce owner (si re-soumission avant vérif e-mail)
    const { data: existingPendingOrg } = await supabaseAdmin
      .from('organizations')
      .select('id, slug')
      .eq('owner_id', userId)
      .in('statut', ['en_validation', 'brouillon'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingPendingOrg?.id) {
      const { data: updatedOrg, error: upOrgErr } = await supabaseAdmin
        .from('organizations')
        .update({
          type: orgType,
          nom: nomEtablissement,
          ville,
          adresse,
          telephone: cleanPhone || null,
          email: cleanEmail,
          statut: 'en_validation',
          settings: settingsObj,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingPendingOrg.id)
        .select()
        .single();
      if (upOrgErr) throw new Error(upOrgErr.message);
      createdOrg = updatedOrg;
    } else {
      const slug = slugifyEstablishment(nomEtablissement, userId);
      const { data: insertedOrg, error: insOrgErr } = await supabaseAdmin
        .from('organizations')
        .insert({
          type: orgType,
          nom: nomEtablissement,
          slug,
          ville,
          adresse,
          telephone: cleanPhone || null,
          email: cleanEmail,
          statut: 'en_validation',
          owner_id: userId,
          settings: settingsObj,
        })
        .select()
        .single();
      if (insOrgErr) throw new Error(insOrgErr.message);
      createdOrg = insertedOrg;
    }

    // Synchroniser tenant associé avec le pack SaaS et les limites CDC v3.0
    const tenantPatch = {
      id: createdOrg.id,
      nom: nomEtablissement,
      slug: createdOrg.slug,
      ville,
      adresse,
      pays: 'Tunisie',
      email: cleanEmail,
      telephone: cleanPhone || null,
      statut: 'inactif',
      plan: packConfig.dbPlan,
      tier: packConfig.tier,
      montant_mensuel: packConfig.montant_mensuel,
      limite_membres: packConfig.limite_membres,
      limite_espaces: packConfig.limite_espaces,
      owner_id: userId,
      contact_admin_id: userId,
      settings: settingsObj,
      updated_at: new Date().toISOString(),
    };

    const { error: tUpsertErr } = await supabaseAdmin
      .from('tenants')
      .upsert(tenantPatch, { onConflict: 'id' });

    if (tUpsertErr) {
      console.warn('⚠️ Sync tenant warning:', tUpsertErr.message);
    }

    // Membership propriétaire
    await supabaseAdmin
      .from('memberships')
      .upsert(
        {
          user_id: userId,
          organization_id: createdOrg.id,
          role: 'proprietaire',
          statut: 'actif',
        },
        { onConflict: 'user_id,organization_id' }
      );

    profilePatch.tenant_id = createdOrg.id;

    await notifySuperAdmins(
      'nouvelle_organisation_en_validation',
      `🏢 Nouvel établissement à valider : "${nomEtablissement}" (${activite === 'mixte' ? 'Mixte' : orgType}, Pack ${packKey}) — Gérant : ${prenom} ${nom}.`
    );
  }

  // Mettre à jour ou créer la ligne profiles
  const { error: profErr } = await supabaseAdmin
    .from('profiles')
    .upsert({ id: userId, ...profilePatch }, { onConflict: 'id' });

  if (profErr) {
    throw new Error(`Erreur mise à jour profil : ${profErr.message}`);
  }

  return {
    requestedRole,
    dbRole,
    statutCompte,
    organization: createdOrg,
    trainerProfile: createdTrainer,
  };
}

// ── Validation des champs par rôle ───────────────────────────────────────────
function validateRolePayload(requestedRole, payload, requirePassword = true) {
  const email = String(payload.email || '').trim().toLowerCase();
  const telephone = String(payload.telephone || '').trim();
  const { prenom, nom } = splitFullName(
    payload.nom_complet || payload.full_name || payload.nom_gerant,
    payload.prenom,
    payload.nom
  );

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'Veuillez saisir une adresse e-mail valide.';
  }
  if (!prenom || !nom) {
    return isEstablishment(requestedRole)
      ? 'Le nom complet du gérant est requis.'
      : 'Le nom complet est requis.';
  }
  const phoneDigits = telephone.replace(/\D/g, '');
  if (phoneDigits.length < 8) {
    return 'Veuillez saisir un numéro de téléphone valide (au moins 8 chiffres).';
  }

  if (requirePassword) {
    const pwd = String(payload.password || '');
    if (pwd.length < 8) {
      return 'Le mot de passe doit comporter au moins 8 caractères.';
    }
  }

  if (requestedRole === 'TRAINER') {
    if (!String(payload.specialite || '').trim()) {
      return 'Veuillez indiquer votre ou vos spécialité(s).';
    }
    if (!String(payload.biographie || payload.bio || '').trim()) {
      return 'Veuillez rédiger une courte biographie professionnelle.';
    }
  }

  if (isEstablishment(requestedRole)) {
    if (!String(payload.nom_etablissement || '').trim()) {
      return 'Le nom de l\'établissement est obligatoire.';
    }
    if (!String(payload.ville || '').trim()) {
      return 'La ville est obligatoire.';
    }
    if (!String(payload.adresse || '').trim()) {
      return 'L\'adresse complète est obligatoire.';
    }
  }

  return null;
}

function isEstablishment(requestedRole) {
  return requestedRole === 'COWORKING_ADMIN' || requestedRole === 'TRAINING_CENTER_ADMIN';
}

// ── 1. Inscription Multi-Rôles Unifiée (POST /api/auth/register & /register-step1) ──
async function registerUnified(req, res) {
  try {
    const body = req.body || {};
    const requestedRole = normalizeRequestedRole(body.role, body.account_type);

    const validationError = validateRolePayload(requestedRole, body, true);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const cleanEmail = String(body.email).trim().toLowerCase();
    const { prenom, nom } = splitFullName(
      body.nom_complet || body.full_name || body.nom_gerant,
      body.prenom,
      body.nom
    );
    const cleanPhone = String(body.telephone || '').trim();

    const { authUser, profile } = await findAuthUserByEmail(cleanEmail);

    if (authUser || profile) {
      const alreadyVerified = Boolean(authUser?.email_confirmed_at) || Boolean(profile?.email_verifie);
      if (!alreadyVerified) {
        return res.status(409).json({
          error: 'Un compte existe déjà avec cette adresse e-mail (en attente de vérification). Une adresse e-mail ne peut créer qu\'un seul compte : veuillez vérifier votre e-mail ou demander un nouvel envoi.',
          code: 'USER_EXISTS_UNVERIFIED',
          email: cleanEmail,
        });
      }
      return res.status(409).json({
        error: 'Cette adresse e-mail est déjà associée à un compte existant. Veuillez vous connecter.',
        code: 'USER_EXISTS',
      });
    }

    const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: cleanEmail,
      password: body.password,
      email_confirm: false,
      user_metadata: {
        nom,
        prenom,
        full_name: `${prenom} ${nom}`.trim(),
        telephone: cleanPhone,
        role: 'member',
        requested_role: requestedRole,
        email_verifie: false,
        requires_email_verification: true,
      },
    });

    if (createError) {
      if (/already|registered|exists|duplicate/i.test(createError.message || '')) {
        return res.status(409).json({
          error: 'Cette adresse e-mail est déjà associée à un compte existant. Veuillez vous connecter.',
          code: 'USER_EXISTS',
        });
      }
      return res.status(400).json({ error: createError.message });
    }
    const userId = createData.user.id;
    const existingMetadata = createData.user.user_metadata || {};

    const persisted = await persistRegistrationByRole({
      userId,
      email: cleanEmail,
      requestedRole,
      payload: body,
      existingMetadata,
    });

    const frontendOrigin = resolveFrontendOrigin(req);
    const mailResult = await issueAndSendEmailVerification({
      userId,
      email: cleanEmail,
      prenom,
      requestedRole,
      frontendOrigin,
    });

    return res.status(201).json({
      success: true,
      userId,
      email: cleanEmail,
      requestedRole,
      requiresEmailVerification: true,
      emailSent: mailResult.emailSent,
      emailWarning: mailResult.emailError ? `L'envoi immédiat a rencontré un souci : ${mailResult.emailError}` : null,
      organizationId: persisted.organization?.id || null,
      redirectTo: `/verify-email?email=${encodeURIComponent(cleanEmail)}&role=${encodeURIComponent(requestedRole)}`,
      message: 'Compte créé. Veuillez vérifier votre adresse e-mail pour l\'activer.',
    });
  } catch (err) {
    console.error('❌ Erreur registerUnified:', err);
    return res.status(500).json({ error: err.message || 'Erreur lors de la création du compte.' });
  }
}

// ── Helper finalisation post-vérification e-mail ──────────────────────────────
async function finalizeEmailVerification({ uid, cleanEmail }) {
  const { data: authRes } = await supabaseAdmin.auth.admin.getUserById(uid);
  const authUser = authRes?.user;
  const existingMeta = authUser?.user_metadata || {};

  await supabaseAdmin.auth.admin.updateUserById(uid, {
    email_confirm: true,
    user_metadata: {
      ...existingMeta,
      email_verifie: true,
      requires_email_verification: false,
    },
  });

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, type_membre, statut_compte, tenant_id')
    .eq('id', uid)
    .maybeSingle();

  let typeMembre = profile?.type_membre || null;
  if (!typeMembre) {
    const typeCompte = existingMeta.type_compte;
    if (typeCompte === 'entreprise') typeMembre = 'entreprise';
    else if (typeCompte === 'particulier') typeMembre = 'individuel';
  }

  await supabaseAdmin
    .from('profiles')
    .update({
      email_verifie: true,
      ...(typeMembre ? { type_membre: typeMembre } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', uid);

  // Rattachement historique Guest
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
      const guestIds = guests.map((g) => g.id);
      await supabaseAdmin.from('reservations').update({ user_id: uid }).in('guest_id', guestIds);
      await supabaseAdmin.from('inscriptions_formations').update({ user_id: uid }).in('guest_id', guestIds);
    }
  } catch (guestErr) {
    console.warn('⚠️ Rattachement guest non bloquant:', guestErr.message);
  }

  // Calcul redirection post-vérification exacte (CDC §6)
  const requestedRole = existingMeta.requested_role || null;
  const role = profile?.role || existingMeta.role || 'member';
  const statutCompte = profile?.statut_compte || 'actif';

  let postVerifyRedirect = '/dashboard';
  let isB2BPending = false;

  if (
    requestedRole === 'COWORKING_ADMIN' ||
    requestedRole === 'TRAINING_CENTER_ADMIN' ||
    (role === 'admin' && statutCompte === 'en_attente')
  ) {
    postVerifyRedirect = '/register/pending-b2b';
    isB2BPending = true;
  } else if (role === 'formateur' || requestedRole === 'TRAINER') {
    postVerifyRedirect = '/trainer-dashboard';
  } else if (role === 'super_admin') {
    postVerifyRedirect = '/super-admin/dashboard';
  } else if (role === 'admin' && statutCompte === 'actif') {
    postVerifyRedirect = '/admin/dashboard';
  }

  // Générer un lien magiclink one-time pour connecter automatiquement l'utilisateur non-B2B depuis n'importe quel onglet
  let authTokenHash = null;
  if (!isB2BPending && statutCompte === 'actif') {
    try {
      const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email: cleanEmail,
      });
      authTokenHash = linkData?.properties?.hashed_token || null;
    } catch (linkErr) {
      console.warn('⚠️ generateLink non bloquant:', linkErr.message);
    }
  }

  return {
    userId: uid,
    email: cleanEmail,
    role,
    requestedRole: requestedRole || (role === 'formateur' ? 'TRAINER' : (typeMembre === 'entreprise' ? 'COMPANY' : 'MEMBER')),
    statutCompte,
    isB2BPending,
    postVerifyRedirect,
    authTokenHash,
  };
}

// ── 2. Vérification OTP Email (code 6 chiffres) ──────────────────────────────
async function verifyEmailOtp(req, res) {
  try {
    const { email, code, userId } = req.body || {};

    if (!email || !code) {
      return res.status(400).json({ error: 'Adresse e-mail et code à 6 chiffres requis.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanCode = String(code).trim();

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
      return res.status(500).json({ error: 'Erreur technique lors de la vérification. Veuillez réessayer.' });
    }

    if (!otpData) {
      return res.status(400).json({ error: 'Code de vérification invalide ou expiré.' });
    }

    await supabaseAdmin.from('email_otp').update({ used: true }).eq('id', otpData.id);

    let uid = userId;
    if (!uid) {
      const found = await findAuthUserByEmail(cleanEmail);
      uid = found.authUser?.id || found.profile?.id || null;
    }

    if (!uid) {
      return res.status(404).json({ error: 'Compte utilisateur introuvable pour cette adresse e-mail.' });
    }

    const result = await finalizeEmailVerification({ uid, cleanEmail });

    return res.json({
      success: true,
      emailVerified: true,
      ...result,
      message: 'Adresse e-mail vérifiée avec succès.',
    });
  } catch (err) {
    console.error('❌ Erreur verifyEmailOtp:', err);
    return res.status(500).json({ error: err.message || 'Erreur lors de la vérification de l\'e-mail.' });
  }
}

// ── 2b. Vérification par lien sécurisé (?token=...) expirant sous 24h ──────────
async function verifyEmailToken(req, res) {
  try {
    const token = req.body?.token || req.query?.token;
    const parsed = verifySignedEmailToken(token);

    if (!parsed || !parsed.email || !parsed.uid) {
      return res.status(400).json({ error: 'Ce lien de confirmation est invalide ou a expiré (validité 24h).' });
    }

    const cleanEmail = String(parsed.email).trim().toLowerCase();

    // Marquer le code lié comme utilisé s'il existe encore
    if (parsed.code) {
      await supabaseAdmin
        .from('email_otp')
        .update({ used: true })
        .eq('email', cleanEmail)
        .eq('code', String(parsed.code))
        .eq('used', false);
    }

    const result = await finalizeEmailVerification({ uid: parsed.uid, cleanEmail });

    return res.json({
      success: true,
      emailVerified: true,
      ...result,
      message: 'Adresse e-mail confirmée avec succès.',
    });
  } catch (err) {
    console.error('❌ Erreur verifyEmailToken:', err);
    return res.status(500).json({ error: err.message || 'Erreur lors de la validation du lien.' });
  }
}

// ── 2c. Renvoyer l'e-mail de vérification (Cooldown serveur 60s) ──────────────
async function resendVerificationEmail(req, res) {
  try {
    const rawEmail = req.body?.email || req.user?.email;
    if (!rawEmail) {
      return res.status(400).json({ error: 'Adresse e-mail requise.' });
    }
    const cleanEmail = String(rawEmail).trim().toLowerCase();

    const { authUser, profile } = await findAuthUserByEmail(cleanEmail);
    if (!authUser) {
      return res.status(404).json({ error: 'Aucun compte en attente trouvé pour cette adresse e-mail.' });
    }

    const needsVerify =
      !authUser.email_confirmed_at ||
      profile?.email_verifie === false ||
      authUser.user_metadata?.requires_email_verification === true;

    if (!needsVerify) {
      return res.status(400).json({ error: 'Cette adresse e-mail est déjà vérifiée. Vous pouvez vous connecter.' });
    }

    // Cooldown 60 secondes côté serveur
    const { data: latestOtp } = await supabaseAdmin
      .from('email_otp')
      .select('created_at')
      .eq('email', cleanEmail)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestOtp?.created_at) {
      const elapsedSec = Math.floor((Date.now() - new Date(latestOtp.created_at).getTime()) / 1000);
      if (elapsedSec < 58) {
        const waitSec = 60 - elapsedSec;
        return res.status(429).json({
          error: `Veuillez patienter ${waitSec} secondes avant de renvoyer un e-mail.`,
          retryAfter: waitSec,
        });
      }
    }

    const prenom = profile?.prenom || authUser.user_metadata?.prenom || '';
    const requestedRole = authUser.user_metadata?.requested_role || 'MEMBER';
    const frontendOrigin = resolveFrontendOrigin(req);

    const mailResult = await issueAndSendEmailVerification({
      userId: authUser.id,
      email: cleanEmail,
      prenom,
      requestedRole,
      frontendOrigin,
    });

    return res.json({
      success: true,
      emailSent: mailResult.emailSent,
      cooldownSeconds: 60,
      emailWarning: mailResult.emailError ? `Attention : ${mailResult.emailError}` : null,
      message: `Un nouvel e-mail de vérification a été envoyé à ${cleanEmail}.`,
    });
  } catch (err) {
    console.error('❌ Erreur resendVerificationEmail:', err);
    return res.status(500).json({ error: err.message || 'Impossible de renvoyer l\'e-mail.' });
  }
}

// ── 3. Google OAuth : Inspection du statut et détection nouveau vs existant ──
async function checkOAuthStatus(req, res) {
  try {
    const uid = req.user.id;
    const profile = req.profile;
    const rawRequestedRole = req.body?.requestedRole;
    const requestedRole = rawRequestedRole && VALID_REQUESTED_ROLES.includes(rawRequestedRole)
      ? rawRequestedRole
      : null;

    const [{ data: memberships }, { data: trainerProfile }] = await Promise.all([
      supabaseAdmin
        .from('memberships')
        .select('id, role, organization_id, organizations(id, nom, statut, type)')
        .eq('user_id', uid)
        .eq('statut', 'actif'),
      supabaseAdmin
        .from('trainer_profiles')
        .select('id, statut_validation')
        .eq('user_id', uid)
        .maybeSingle(),
    ]);

    const meta = req.user.user_metadata || {};
    const hasCompletedOnboardingFlag = meta.requires_email_verification === false || Boolean(meta.requested_role && profile?.telephone);
    const hasNonMemberRole = ['super_admin', 'admin', 'staff', 'formateur'].includes(profile?.role);
    const hasEstablishedFields = Boolean(profile?.telephone && String(profile.telephone).replace(/\D/g, '').length >= 8)
      || Boolean(profile?.type_membre)
      || (memberships && memberships.length > 0)
      || Boolean(trainerProfile);

    const isExistingUser = hasNonMemberRole || hasEstablishedFields || hasCompletedOnboardingFlag;

    // 1. Utilisateur OAuth ayant démarré la complétion et devant encore vérifier son e-mail
    if (profile?.email_verifie === false && meta.requires_email_verification === true) {
      return res.json({
        status: 'needs_email_verification',
        email: profile.email,
        requestedRole: meta.requested_role || requestedRole || 'MEMBER',
        redirectTo: `/verify-email?email=${encodeURIComponent(profile.email)}&role=${encodeURIComponent(meta.requested_role || requestedRole || 'MEMBER')}`,
      });
    }

    // 2. Compte existant déjà configuré -> ne jamais écraser son rôle !
    if (isExistingUser) {
      let redirectPath = '/dashboard';
      if (profile.is_super_admin || profile.role === 'super_admin') {
        redirectPath = '/super-admin/dashboard';
      } else if (profile.statut_compte === 'en_attente') {
        redirectPath = '/register/pending-b2b';
      } else if ((memberships || []).length > 1) {
        redirectPath = '/select-space';
      } else if (profile.role === 'admin' || profile.role === 'staff') {
        redirectPath = '/admin/dashboard';
      } else if (profile.role === 'formateur') {
        redirectPath = '/trainer-dashboard';
      }

      let notice = null;
      if (requestedRole) {
        const expectedDbRole = requestedRole === 'TRAINER' ? 'formateur'
          : (isEstablishment(requestedRole) ? 'admin' : 'member');
        if (expectedDbRole !== profile.role) {
          notice = `Un compte existe déjà avec cette adresse Google (${ROLE_LABELS_FR[profile.role] || profile.role}). Vous avez été connecté à votre compte existant.`;
        }
      }

      return res.json({
        status: 'existing_user',
        role: profile.role,
        statutCompte: profile.statut_compte,
        notice,
        redirectTo: redirectPath,
      });
    }

    // 3. Nouvel utilisateur Google -> rediriger vers /register/complete-profile avec le rôle choisi
    return res.json({
      status: 'needs_profile_completion',
      requestedRole,
      prefill: {
        email: profile.email || req.user.email || '',
        nom_complet: `${profile.prenom || ''} ${profile.nom || ''}`.trim()
          || meta.full_name
          || meta.name
          || '',
      },
      redirectTo: requestedRole
        ? `/register/complete-profile?role=${encodeURIComponent(requestedRole)}`
        : '/register/complete-profile',
    });
  } catch (err) {
    console.error('❌ Erreur checkOAuthStatus:', err);
    return res.status(500).json({ error: err.message || 'Erreur lors du contrôle OAuth.' });
  }
}

// ── 4. Complétion d'inscription post-Google OAuth (/register/complete-profile) ──
async function completeOAuthRegistration(req, res) {
  try {
    const uid = req.user.id;
    const profile = req.profile;
    const body = req.body || {};
    const requestedRole = normalizeRequestedRole(body.role);

    // Garde de sécurité : ne jamais écraser un compte déjà établi sur un autre rôle
    const hasNonMemberRole = ['super_admin', 'admin', 'staff', 'formateur'].includes(profile?.role);
    const alreadyConfigured = Boolean(profile?.type_membre) && Boolean(profile?.telephone);
    if ((hasNonMemberRole || alreadyConfigured) && profile?.email_verifie === true) {
      return res.status(409).json({
        error: `Ce compte est déjà configuré en tant que ${ROLE_LABELS_FR[profile.role] || profile.role}.`,
        code: 'ROLE_ALREADY_ESTABLISHED',
      });
    }

    const email = String(profile?.email || req.user.email || '').trim().toLowerCase();
    // Vérifier qu'aucun autre UID ne possède déjà cette adresse e-mail dans profiles
    if (email) {
      const { data: dupProf } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .ilike('email', email)
        .neq('id', uid)
        .limit(1)
        .maybeSingle();
      if (dupProf?.id) {
        return res.status(409).json({
          error: 'Un compte existe déjà avec cette adresse e-mail. Une seule adresse e-mail ne peut créer qu\'un seul compte.',
          code: 'USER_EXISTS',
        });
      }
    }
    const mergedPayload = {
      ...body,
      email,
    };

    const validationError = validateRolePayload(requestedRole, mergedPayload, false);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const persisted = await persistRegistrationByRole({
      userId: uid,
      email,
      requestedRole,
      payload: mergedPayload,
      existingMetadata: req.user.user_metadata || {},
    });

    const { prenom } = splitFullName(
      mergedPayload.nom_complet || mergedPayload.full_name || mergedPayload.nom_gerant,
      mergedPayload.prenom,
      mergedPayload.nom
    );

    const frontendOrigin = resolveFrontendOrigin(req);
    const mailResult = await issueAndSendEmailVerification({
      userId: uid,
      email,
      prenom,
      requestedRole,
      frontendOrigin,
    });

    return res.json({
      success: true,
      userId: uid,
      email,
      requestedRole,
      emailSent: mailResult.emailSent,
      emailWarning: mailResult.emailError ? `Attention : ${mailResult.emailError}` : null,
      organizationId: persisted.organization?.id || null,
      redirectTo: `/verify-email?email=${encodeURIComponent(email)}&role=${encodeURIComponent(requestedRole)}`,
      message: 'Profil enregistré. Un e-mail de confirmation vient de vous être envoyé.',
    });
  } catch (err) {
    console.error('❌ Erreur completeOAuthRegistration:', err);
    return res.status(500).json({ error: err.message || 'Erreur lors de la finalisation du profil Google.' });
  }
}

// ── 5. Endpoints historiques préservés pour rétrocompatibilité ──────────────
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

    if (profileType === 'entreprise') {
      const nomSociete = entrepriseData?.nom || 'Mon Entreprise';
      const slug = slugifyEstablishment(nomSociete, uid);

      const { data: org, error: orgErr } = await supabaseAdmin
        .from('organizations')
        .insert({
          type: 'entreprise',
          nom: nomSociete,
          slug,
          ville: entrepriseData?.ville || 'Tunis',
          adresse: entrepriseData?.adresse || 'Non renseignée',
          matricule_fiscal: entrepriseData?.matricule_fiscal || null,
          statut: 'valide',
          owner_id: uid,
        })
        .select()
        .single();

      if (orgErr) return res.status(400).json({ error: orgErr.message });

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

    if (profileType === 'formateur') {
      return res.json({
        success: true,
        profileType: 'formateur',
        redirect: '/onboarding/trainer',
      });
    }

    return res.json({
      success: true,
      profileType,
      redirect: `/onboarding/space?type=${profileType}`,
    });
  } catch (err) {
    console.error('❌ Erreur chooseProfileType:', err);
    return res.status(500).json({ error: err.message || 'Erreur lors de la sélection du profil.' });
  }
}

async function createSpaceOnboarding(req, res) {
  try {
    const {
      type, nom, logo_url, cover_url, ville, adresse, horaires, description, telephone, email,
    } = req.body;

    const uid = req.user?.id || req.body.userId;
    if (!uid) return res.status(401).json({ error: 'Authentification requise.' });

    if (!nom || !ville || !adresse) {
      return res.status(400).json({ error: 'Le nom, la ville et l\'adresse sont obligatoires.' });
    }

    const orgType = type === 'centre_formation' ? 'centre_formation' : 'coworking';
    const slug = slugifyEstablishment(nom, uid);

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
        statut: 'en_validation',
        owner_id: uid,
        settings: { onboarding_completed: true, activite: orgType },
      })
      .select()
      .single();

    if (orgErr) return res.status(400).json({ error: orgErr.message });

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
        role: 'admin',
        tenant_id: org.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', uid);

    await notifySuperAdmins(
      'nouvelle_organisation_en_validation',
      `🏢 Nouvelle organisation en attente de validation : "${nom}" (${orgType}).`
    );

    return res.status(201).json({
      success: true,
      organization: org,
      status: 'en_validation',
      message: 'Votre espace a été créé en statut brouillon et soumis pour validation par le Super Admin.',
    });
  } catch (err) {
    console.error('❌ Erreur createSpaceOnboarding:', err);
    return res.status(500).json({ error: err.message || 'Erreur lors de la création de l\'espace.' });
  }
}

async function createTrainerProfile(req, res) {
  try {
    const { bio, domaines, certificats, telephone_pro } = req.body;
    const uid = req.user?.id || req.body.userId;

    if (!uid) return res.status(401).json({ error: 'Authentification requise.' });

    const domainesArray = Array.isArray(domaines) ? domaines : (domaines ? [domaines] : []);

    const { data: tp, error: tpErr } = await supabaseAdmin
      .from('trainer_profiles')
      .upsert({
        user_id: uid,
        bio: bio || null,
        domaines: domainesArray,
        certificats: certificats || [],
        telephone_pro: telephone_pro || null,
        statut_validation: 'en_validation',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      .select()
      .single();

    if (tpErr) return res.status(400).json({ error: tpErr.message });

    await notifySuperAdmins(
      'nouveau_formateur_en_validation',
      `🎓 Nouveau profil formateur en attente de validation (User ID: ${uid}).`
    );

    return res.json({
      success: true,
      trainerProfile: tp,
      status: 'en_validation',
      message: 'Votre profil formateur a été enregistré et soumis pour validation.',
    });
  } catch (err) {
    console.error('❌ Erreur createTrainerProfile:', err);
    return res.status(500).json({ error: err.message || 'Erreur lors de la création du profil formateur.' });
  }
}

// ── 6. Contexte Utilisateur (Multi-Organisations & Redirection) ───────────────
async function getMyContext(req, res) {
  try {
    const uid = req.user.id;

    const { data: profile, error: pErr } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .single();

    if (pErr || !profile) {
      return res.status(404).json({ error: 'Profil introuvable.' });
    }

    const { data: memberships } = await supabaseAdmin
      .from('memberships')
      .select(`
        id, role, statut, organization_id,
        organizations (
          id, type, nom, slug, logo_url, cover_url, ville, adresse, statut, settings
        )
      `)
      .eq('user_id', uid)
      .eq('statut', 'actif');

    const { data: trainerProfile } = await supabaseAdmin
      .from('trainer_profiles')
      .select('*')
      .eq('user_id', uid)
      .maybeSingle();

    const activeOrgs = (memberships || [])
      .filter((m) => m.organizations)
      .map((m) => ({
        membershipId: m.id,
        role: m.role,
        organization: m.organizations,
      }));

    let redirectPath = '/dashboard';
    let userContextType = profile.type_membre === 'entreprise' ? 'entreprise' : 'particulier';

    const requiresVerification = profile.email_verifie === false
      && !profile.is_super_admin
      && profile.role !== 'super_admin'
      && (req.user?.user_metadata?.requires_email_verification === true || !req.user?.email_confirmed_at);

    if (requiresVerification) {
      redirectPath = `/verify-email?email=${encodeURIComponent(profile.email || '')}`;
    } else if (profile.is_super_admin || profile.role === 'super_admin') {
      redirectPath = '/super-admin/dashboard';
      userContextType = 'super_admin';
    } else if (profile.statut_compte === 'en_attente' && profile.role === 'admin') {
      redirectPath = '/register/pending-b2b';
      userContextType = 'b2b_pending';
    } else if (profile.type_membre === 'entreprise' || profile.role === 'company' || profile.role === 'entreprise' || activeOrgs.some((o) => o.organizations?.type === 'entreprise')) {
      redirectPath = '/company/dashboard';
      userContextType = 'company';
    } else if (activeOrgs.length > 1) {
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
    } else if (profile.role === 'formateur' || trainerProfile) {
      redirectPath = '/trainer-dashboard';
      userContextType = 'formateur';
    }

    return res.json({
      profile,
      emailVerified: Boolean(profile.email_verifie),
      requiresEmailVerification: requiresVerification,
      memberships: activeOrgs,
      hasMultipleOrgs: activeOrgs.length > 1,
      trainerProfile,
      userContextType,
      recommendedRedirect: redirectPath,
    });
  } catch (err) {
    console.error('❌ Erreur getMyContext:', err);
    return res.status(500).json({ error: err.message || 'Erreur lors de la récupération du contexte utilisateur.' });
  }
}

module.exports = {
  registerUnified,
  registerStep1: registerUnified,
  verifyEmailOtp,
  verifyEmailToken,
  resendVerificationEmail,
  checkOAuthStatus,
  completeOAuthRegistration,
  chooseProfileType,
  createSpaceOnboarding,
  createTrainerProfile,
  getMyContext,
};
