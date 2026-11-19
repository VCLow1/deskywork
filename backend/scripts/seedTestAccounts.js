// backend/scripts/seedTestAccounts.js
// Script de création et configuration des 5 comptes de test multi-rôles pour DeskyWork
'use strict';

const fs = require('fs');
const path = require('path');

// 1. Lecture des variables d'environnement depuis backend/.env
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

let createClient;
try {
  createClient = require(path.resolve(__dirname, '../../frontend/node_modules/@supabase/supabase-js')).createClient;
} catch (e) {
  createClient = require('@supabase/supabase-js').createClient;
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquantes dans l\'environnement.');
  process.exit(1);
}

console.log('🔗 Connexion à Supabase Admin:', supabaseUrl);

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Mot de passe commun défini par la mission
const COMMON_PASSWORD = 'DeskyTest@2026!';

// Établissement de démo / test multi-activités (Coworking + Formation, Pack Premium)
const TEST_ESTABLISHMENT = {
  id: 'd0000000-0000-4000-8000-000000000001',
  nom: 'DeskyWork Test & Demo Space',
  slug: 'deskywork-test-demo',
  description: 'Établissement de démonstration et de test complet regroupant espaces de coworking et salles de formation.',
  adresse: '15 Avenue Habib Bourguiba',
  ville: 'Tunis',
  pays: 'Tunisie',
  email: 'test.admin@deskywork.tn',
  telephone: '+216 71 100 200',
  statut: 'actif',
  plan: 'enterprise',
  montant_mensuel: 90,
  settings: {
    saas_pack: 'premium',
    activite: 'mixte',
    propose_coworking: true,
    propose_formations: true,
    nom_gerant: 'Test Gérant Coworking',
    onboarding_completed: true,
    auto_confirmation: false,
    limite_staff: 10,
    limite_espaces: 999999,
    limite_membres: 999999,
  },
  espaces: [
    {
      id: 'd0000000-0000-4000-8000-000000000011',
      nom: 'Open Space Nomade Test',
      type: 'open_space',
      capacite: 25,
      tarif_horaire: 5.0,
      description: 'Espace partagé haute productivité avec Wi-Fi fibre optique.',
      equipements: ['Wi-Fi Fibre', 'Café / Thé', 'Prises électriques', 'Climatisation'],
      actif: true,
    },
    {
      id: 'd0000000-0000-4000-8000-000000000012',
      nom: 'Salle de Formation & Workshop Test',
      type: 'meeting_room',
      capacite: 18,
      tarif_horaire: 35.0,
      description: 'Salle modulable équipée d\'un vidéoprojecteur 4K et d\'un tableau blanc interactif.',
      equipements: ['Vidéoprojecteur 4K', 'Tableau blanc interactif', 'Micro & Sonorisation', 'Fibre 100 Mbps'],
      actif: true,
    },
  ],
};

// Société de test pour le compte Entreprise
const TEST_COMPANY_ORG = {
  id: 'd0000000-0000-4000-8000-000000000002',
  type: 'entreprise',
  nom: 'Société Test SARL',
  slug: 'societe-test-sarl',
  matricule_fiscal: '1234567/A/M/000',
  ville: 'Tunis',
  adresse: 'Rue du Lac Biwa, Les Berges du Lac 2',
  statut: 'valide',
  description: 'Société cliente de test DeskyWork.',
};

// Définition des 5 comptes de test
const TEST_ACCOUNTS = [
  {
    key: 'SUPER_ADMIN',
    email: 'test.superadmin@deskywork.tn',
    prenom: 'Test',
    nom: 'Super Admin',
    role: 'super_admin',
    is_super_admin: true,
    type_membre: 'individuel',
    user_metadata: { prenom: 'Test', nom: 'Super Admin', role: 'super_admin' },
    profile_extra: {},
    expectedRedirect: '/super-admin/dashboard',
  },
  {
    key: 'COWORKING_ADMIN',
    email: 'test.admin@deskywork.tn',
    prenom: 'Test Gérant',
    nom: 'Coworking',
    role: 'admin',
    is_super_admin: false,
    type_membre: 'individuel',
    tenant_id: TEST_ESTABLISHMENT.id,
    user_metadata: { prenom: 'Test Gérant', nom: 'Coworking', role: 'admin' },
    profile_extra: {},
    expectedRedirect: '/admin/dashboard',
  },
  {
    key: 'MEMBER',
    email: 'test.member@deskywork.tn',
    prenom: 'Test',
    nom: 'Membre Particulier',
    role: 'member',
    is_super_admin: false,
    type_membre: 'individuel',
    user_metadata: { prenom: 'Test', nom: 'Membre Particulier', role: 'member', type_membre: 'individuel' },
    profile_extra: {},
    expectedRedirect: '/dashboard',
  },
  {
    key: 'COMPANY',
    email: 'test.company@deskywork.tn',
    prenom: 'Test',
    nom: 'Entreprise',
    role: 'member',
    is_super_admin: false,
    type_membre: 'entreprise',
    tenant_id: TEST_COMPANY_ORG.id,
    user_metadata: {
      prenom: 'Test',
      nom: 'Entreprise',
      role: 'member',
      type_membre: 'entreprise',
      raison_sociale: 'Société Test SARL',
      matricule_fiscal: '1234567/A/M/000',
    },
    profile_extra: {},
    expectedRedirect: '/dashboard',
  },
  {
    key: 'TRAINER',
    email: 'test.trainer@deskywork.tn',
    prenom: 'Test',
    nom: 'Formateur',
    role: 'formateur',
    is_super_admin: false,
    type_membre: 'individuel',
    specialite: 'Développement Web & IA',
    biographie: 'Formateur expert en Développement Web & IA (Fullstack JS, Python, IA générative).',
    tenant_id: TEST_ESTABLISHMENT.id,
    user_metadata: {
      prenom: 'Test',
      nom: 'Formateur',
      role: 'formateur',
      specialite: 'Développement Web & IA',
    },
    profile_extra: {},
    expectedRedirect: '/trainer-dashboard',
  },
];

async function run() {
  console.log('\n🚀 ═════════════════════════════════════════════════════════════════');
  console.log('   CRÉATION DES 5 COMPTES DE TEST MULTI-RÔLES — DESKYWORK');
  console.log('═════════════════════════════════════════════════════════════════\n');

  // ── ÉTAPE 1 : Créer ou mettre à jour l'établissement de test multi-activités ──
  console.log('🏢 [1/5] Configuration de l\'établissement de test Coworking & Formation...');

  // 1.1 Table tenants
  const { error: tErr } = await supabase.from('tenants').upsert({
    id: TEST_ESTABLISHMENT.id,
    nom: TEST_ESTABLISHMENT.nom,
    slug: TEST_ESTABLISHMENT.slug,
    description: TEST_ESTABLISHMENT.description,
    adresse: TEST_ESTABLISHMENT.adresse,
    ville: TEST_ESTABLISHMENT.ville,
    pays: TEST_ESTABLISHMENT.pays,
    email: TEST_ESTABLISHMENT.email,
    telephone: TEST_ESTABLISHMENT.telephone,
    statut: TEST_ESTABLISHMENT.statut,
    plan: TEST_ESTABLISHMENT.plan,
    montant_mensuel: TEST_ESTABLISHMENT.montant_mensuel,
    settings: TEST_ESTABLISHMENT.settings,
  });
  if (tErr) console.warn('  ⚠️ Upsert tenants:', tErr.message);
  else console.log(`  ✅ Tenant "${TEST_ESTABLISHMENT.nom}" configuré (Pack Premium, Coworking + Formations).`);

  // 1.2 Table organizations (synchronisation)
  const { error: oErr } = await supabase.from('organizations').upsert({
    id: TEST_ESTABLISHMENT.id,
    type: 'coworking',
    nom: TEST_ESTABLISHMENT.nom,
    slug: TEST_ESTABLISHMENT.slug,
    description: TEST_ESTABLISHMENT.description,
    adresse: TEST_ESTABLISHMENT.adresse,
    ville: TEST_ESTABLISHMENT.ville,
    pays: TEST_ESTABLISHMENT.pays,
    email: TEST_ESTABLISHMENT.email,
    telephone: TEST_ESTABLISHMENT.telephone,
    statut: 'valide',
    settings: TEST_ESTABLISHMENT.settings,
  });
  if (oErr) console.warn('  ⚠️ Upsert organizations:', oErr.message);
  else console.log(`  ✅ Organization "${TEST_ESTABLISHMENT.nom}" synchronisée.`);

  // 1.3 Entreprise test dans tenants & organizations
  await supabase.from('tenants').upsert({
    id: TEST_COMPANY_ORG.id,
    type: 'entreprise',
    nom: TEST_COMPANY_ORG.nom,
    slug: TEST_COMPANY_ORG.slug,
    matricule_fiscal: TEST_COMPANY_ORG.matricule_fiscal,
    ville: TEST_COMPANY_ORG.ville,
    adresse: TEST_COMPANY_ORG.adresse,
    statut: 'actif',
    description: TEST_COMPANY_ORG.description,
  });
  await supabase.from('organizations').upsert({
    id: TEST_COMPANY_ORG.id,
    type: 'entreprise',
    nom: TEST_COMPANY_ORG.nom,
    slug: TEST_COMPANY_ORG.slug,
    matricule_fiscal: TEST_COMPANY_ORG.matricule_fiscal,
    ville: TEST_COMPANY_ORG.ville,
    adresse: TEST_COMPANY_ORG.adresse,
    statut: 'valide',
    description: TEST_COMPANY_ORG.description,
  });
  console.log(`  ✅ Organisation et tenant Entreprise "${TEST_COMPANY_ORG.nom}" pré-initialisés.`);

  // 1.3 Espaces de test
  for (const esp of TEST_ESTABLISHMENT.espaces) {
    const { error: eErr } = await supabase.from('espaces').upsert({
      id: esp.id,
      tenant_id: TEST_ESTABLISHMENT.id,
      nom: esp.nom,
      type: esp.type,
      capacite: esp.capacite,
      tarif_horaire: esp.tarif_horaire,
      description: esp.description,
      equipements: esp.equipements,
      actif: esp.actif,
    });
    if (eErr) console.warn(`  ⚠️ Upsert espace ${esp.nom}:`, eErr.message);
    else console.log(`  ✅ Espace "${esp.nom}" injecté (${esp.tarif_horaire} DT/h).`);
  }

  // ── ÉTAPE 2 : Création des 5 comptes dans Supabase Auth et Profiles ─────────
  console.log('\n👥 [2/5] Création et synchronisation des 5 comptes de test...');

  // Lister les utilisateurs existants dans Supabase Auth
  const { data: usersList, error: lErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (lErr) console.warn('  ⚠️ Erreur listUsers:', lErr.message);
  const existingUsers = usersList?.users || [];

  const createdUsers = {};

  for (const acc of TEST_ACCOUNTS) {
    console.log(`\n  👉 Configuration compte [${acc.key}] : ${acc.email}...`);

    let userId = null;
    const existing = existingUsers.find((u) => u.email.toLowerCase() === acc.email.toLowerCase());

    if (existing) {
      userId = existing.id;
      console.log(`     Compte Auth existant (ID: ${userId}). Mise à jour du mot de passe et confirmation email...`);
      const { error: uErr } = await supabase.auth.admin.updateUserById(userId, {
        password: COMMON_PASSWORD,
        email_confirm: true,
        user_metadata: acc.user_metadata,
      });
      if (uErr) console.error(`     ❌ Erreur updateUserById:`, uErr.message);
      else console.log(`     ✅ Mot de passe mis à jour sur "${COMMON_PASSWORD}" et e-mail confirmé.`);
    } else {
      console.log(`     Création dans Supabase Auth...`);
      const { data: newU, error: cErr } = await supabase.auth.admin.createUser({
        email: acc.email,
        password: COMMON_PASSWORD,
        email_confirm: true,
        user_metadata: acc.user_metadata,
      });
      if (cErr) {
        console.error(`     ❌ Erreur createUser:`, cErr.message || JSON.stringify(cErr));
        continue;
      }
      userId = newU.user.id;
      console.log(`     ✅ Compte Auth créé (ID: ${userId}) avec mot de passe et e-mail confirmé.`);
    }

    createdUsers[acc.key] = { id: userId, ...acc };

    // 2.1 Upsert Profil dans la table profiles
    const profilePayload = {
      id: userId,
      email: acc.email,
      nom: acc.nom,
      prenom: acc.prenom,
      role: acc.role,
      type_membre: acc.type_membre,
      statut_compte: 'actif',
      email_verifie: true,
      telephone_verifie: true,
      is_super_admin: acc.is_super_admin,
      langue: 'fr',
      updated_at: new Date().toISOString(),
    };

    if (acc.specialite) profilePayload.specialite = acc.specialite;
    if (acc.biographie) profilePayload.biographie = acc.biographie;
    if (acc.tenant_id) profilePayload.tenant_id = acc.tenant_id;

    const { error: pErr } = await supabase.from('profiles').upsert(profilePayload);
    if (pErr) console.error(`     ❌ Erreur upsert profile:`, pErr.message);
    else console.log(`     ✅ Profil mis à jour dans 'profiles' (role: ${acc.role}, statut: actif, email_verifie: true).`);
  }

  // ── ÉTAPE 3 : Configurations spécifiques (Admin, Entreprise, Formateur) ────
  console.log('\n🏢 [3/5] Configuration des affiliations et profils spécialisés...');

  // 3.1 Gérant Coworking (test.admin@deskywork.tn)
  const adminAcc = createdUsers['COWORKING_ADMIN'];
  if (adminAcc) {
    // Lier en tant que propriétaire/admin dans memberships
    const { error: mErr } = await supabase.from('memberships').upsert({
      user_id: adminAcc.id,
      organization_id: TEST_ESTABLISHMENT.id,
      role: 'proprietaire',
      statut: 'actif',
    }, { onConflict: 'user_id,organization_id' });
    if (mErr) console.warn('  ⚠️ Membership admin coworking:', mErr.message);
    else console.log('  ✅ Gérant Coworking rattaché à l\'établissement (role: proprietaire, statut: actif).');

    // Mettre à jour l'owner de l'établissement
    await supabase.from('organizations').update({ owner_id: adminAcc.id }).eq('id', TEST_ESTABLISHMENT.id);
    await supabase.from('tenants').update({ contact_admin_id: adminAcc.id }).eq('id', TEST_ESTABLISHMENT.id);
  }

  // 3.2 Entreprise (test.company@deskywork.tn)
  const companyAcc = createdUsers['COMPANY'];
  if (companyAcc) {
    // 1. Synchroniser dans tenants (pour satisfaire la contrainte fk_profiles_tenant_id)
    const { error: cTenErr } = await supabase.from('tenants').upsert({
      id: TEST_COMPANY_ORG.id,
      type: 'entreprise',
      nom: TEST_COMPANY_ORG.nom,
      slug: TEST_COMPANY_ORG.slug,
      matricule_fiscal: TEST_COMPANY_ORG.matricule_fiscal,
      ville: TEST_COMPANY_ORG.ville,
      adresse: TEST_COMPANY_ORG.adresse,
      statut: 'actif',
      description: TEST_COMPANY_ORG.description,
    });
    if (cTenErr) console.warn('  ⚠️ Tenant entreprise:', cTenErr.message);

    // 2. Créer / mettre à jour l'organisation de type entreprise
    const { error: cOrgErr } = await supabase.from('organizations').upsert({
      id: TEST_COMPANY_ORG.id,
      type: 'entreprise',
      nom: TEST_COMPANY_ORG.nom,
      slug: TEST_COMPANY_ORG.slug,
      matricule_fiscal: TEST_COMPANY_ORG.matricule_fiscal,
      ville: TEST_COMPANY_ORG.ville,
      adresse: TEST_COMPANY_ORG.adresse,
      statut: TEST_COMPANY_ORG.statut,
      owner_id: companyAcc.id,
      description: TEST_COMPANY_ORG.description,
    });
    if (cOrgErr) console.warn('  ⚠️ Organization entreprise:', cOrgErr.message);
    else console.log(`  ✅ Organisation Entreprise "${TEST_COMPANY_ORG.nom}" (Matricule: ${TEST_COMPANY_ORG.matricule_fiscal}) créée.`);

    // 3. Membership entreprise
    const { error: cMemErr } = await supabase.from('memberships').upsert({
      user_id: companyAcc.id,
      organization_id: TEST_COMPANY_ORG.id,
      role: 'proprietaire',
      statut: 'actif',
    }, { onConflict: 'user_id,organization_id' });
    if (cMemErr) console.warn('  ⚠️ Membership entreprise:', cMemErr.message);
    else console.log('  ✅ Compte Entreprise rattaché comme propriétaire de la société.');

    // 4. Mettre à jour le profil
    const { error: pUpErr } = await supabase.from('profiles').upsert({
      id: companyAcc.id,
      email: companyAcc.email,
      nom: companyAcc.nom,
      prenom: companyAcc.prenom,
      role: 'member',
      type_membre: 'entreprise',
      tenant_id: TEST_COMPANY_ORG.id,
      statut_compte: 'actif',
      email_verifie: true,
      telephone_verifie: true,
      langue: 'fr',
    });
    if (pUpErr) console.warn('  ⚠️ Profil entreprise:', pUpErr.message);
    else console.log('  ✅ Profil Entreprise rattaché (type_membre: entreprise, statut: actif).');
  }

  // 3.3 Formateur (test.trainer@deskywork.tn)
  const trainerAcc = createdUsers['TRAINER'];
  if (trainerAcc) {
    // Table trainer_profiles
    const { error: tpErr } = await supabase.from('trainer_profiles').upsert({
      user_id: trainerAcc.id,
      bio: trainerAcc.biographie,
      domaines: ['Développement Web & IA', 'Fullstack JavaScript', 'Python & Data'],
      statut_validation: 'valide',
    }, { onConflict: 'user_id' });
    if (tpErr) console.warn('  ⚠️ trainer_profiles:', tpErr.message);
    else console.log('  ✅ Profil formateur validé dans trainer_profiles (statut_validation: valide).');

    // Membership sur l'établissement de test
    const { error: tMemErr } = await supabase.from('memberships').upsert({
      user_id: trainerAcc.id,
      organization_id: TEST_ESTABLISHMENT.id,
      role: 'formateur',
      statut: 'actif',
    }, { onConflict: 'user_id,organization_id' });
    if (tMemErr) console.warn('  ⚠️ Membership formateur:', tMemErr.message);
    else console.log('  ✅ Formateur affilié et actif sur l\'établissement de test.');
  }

  // ── ÉTAPE 4 : Validation des connexions (Test d'authentification direct) ───
  console.log('\n🔐 [4/5] Validation automatique de la connexion pour les 5 comptes...');

  const authResults = [];

  for (const acc of TEST_ACCOUNTS) {
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
      email: acc.email,
      password: COMMON_PASSWORD,
    });

    if (authErr) {
      console.error(`  ❌ Connexion ÉCHOUÉE pour [${acc.key}] (${acc.email}) :`, authErr.message);
      authResults.push({ key: acc.key, email: acc.email, ok: false, error: authErr.message });
    } else {
      const user = authData.user;
      console.log(`  ✅ Connexion RÉUSSIE pour [${acc.key}] (${acc.email}) !`);
      console.log(`     → User ID : ${user.id}`);
      console.log(`     → Email vérifié : ${Boolean(user.email_confirmed_at)}`);
      console.log(`     → Redirection attendue : ${acc.expectedRedirect}`);
      authResults.push({
        key: acc.key,
        email: acc.email,
        ok: true,
        userId: user.id,
        emailConfirmed: Boolean(user.email_confirmed_at),
        redirect: acc.expectedRedirect,
      });
    }
  }

  console.log('\n📊 ═════════════════════════════════════════════════════════════════');
  console.log('   RÉSUMÉ DES 5 COMPTES DE TEST CRÉÉS');
  console.log('═════════════════════════════════════════════════════════════════');
  console.table(authResults);
  console.log('\n🎉 Terminé avec succès !');
}

run().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
