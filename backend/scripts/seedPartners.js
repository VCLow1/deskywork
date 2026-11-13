// backend/scripts/seedPartners.js
// Script d'injection directe des partenaires Nero & Thirty Three et de leurs comptes dans Supabase
'use strict';

const fs = require('fs');
const path = require('path');

// Lecture de backend/.env sans module tiers
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

// Utilisation du @supabase/supabase-js situé dans frontend/node_modules
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

console.log('🔗 Connexion à Supabase:', supabaseUrl);

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PARTNERS = [
  {
    id: 'a1111111-1111-4111-8111-111111111111',
    nom: 'Nero Coworking Space',
    slug: 'nero-coworking',
    description: 'Espace de travail moderne et calme situé à Ennasr 2, pensé pour les freelances, startups et équipes en quête de productivité.',
    adresse: 'Avenue Hédi Nouira, Ennasr 2',
    ville: 'Tunis',
    pays: 'Tunisie',
    email: 'contact@nerocoworking.tn',
    telephone: '+216 71 888 999',
    site_web: 'https://nerocoworking.tn',
    logo_url: 'https://deskywork-jet.vercel.app/partners/nero-logo.png',
    cover_url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1600&q=80',
    statut: 'actif',
    plan: 'enterprise',
    tier: 'A',
    montant_mensuel: 90,
    limite_membres: 999999,
    limite_espaces: 999999,
    settings: {
      saas_pack: 'premium',
      onboarding_completed: true,
      limite_staff: 10,
      partenaire_officiel: true,
      tarif_partenaire: 90,
      marketplace_stats: { vues: 142, clics: 38 },
    },
    users: [
      { email: 'admin@nerocoworking.tn', password: 'Nero@2026!Desky', prenom: 'Nero', nom: 'Admin', tel: '+216 71 888 999' },
      { email: 'contact@nerocoworking.tn', password: 'Nero@2026!Desky', prenom: 'Nero', nom: 'Contact', tel: '+216 71 888 999' },
    ],
    espaces: [
      {
        id: 'e1111111-1111-4111-8111-000000000001',
        nom: 'Open Space Nomade',
        type: 'open_space',
        capacite: 30,
        tarif_horaire: 5.0,
        tarif_journalier: 25.0,
        tarif_mensuel: 250.0,
        description: 'Poste de travail flexible en open space lumineux avec ambiance propice à la concentration.',
        photo_url: 'https://images.unsplash.com/photo-1527192491265-7e15c55b1ed2?auto=format&fit=crop&w=900&q=80',
        equipements: ['Wi-Fi Fibre', 'Café & Thé inclus', 'Prises dédiées', 'Climatisation'],
        actif: true,
      },
      {
        id: 'e1111111-1111-4111-8111-000000000002',
        nom: 'Bureau Privé 4 Personnes',
        type: 'private_office',
        capacite: 4,
        tarif_horaire: 20.0,
        tarif_journalier: 90.0,
        tarif_mensuel: 950.0,
        description: 'Bureau fermé haut standing, idéal pour une équipe projet ou une startup.',
        photo_url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=900&q=80',
        equipements: ['Wi-Fi Fibre', 'Clé sécurisée', 'Écran de présentation', 'Tableau blanc', 'Climatisation'],
        actif: true,
      },
      {
        id: 'e1111111-1111-4111-8111-000000000003',
        nom: 'Salle de Réunion Prestige',
        type: 'meeting_room',
        capacite: 12,
        tarif_horaire: 30.0,
        tarif_journalier: 150.0,
        tarif_mensuel: 0.0,
        description: 'Salle de réunion moderne équipée pour vos présentations clients et comités de direction.',
        photo_url: 'https://images.unsplash.com/photo-1517502884422-41eaead166d4?auto=format&fit=crop&w=900&q=80',
        equipements: ['Visioconférence 4K', 'Grand écran TV', 'Tableau blanc interactif', 'Machine à café Nespresso'],
        actif: true,
      },
    ],
  },
  {
    id: 'a3333333-3333-4333-8333-333333333333',
    nom: 'Thirty Three Space',
    slug: 'thirty-three-space',
    description: 'Lieu collaboratif d\'exception conçu pour le coworking quotidien, les ateliers et les sessions de formation professionnelles.',
    adresse: 'Les Berges du Lac 2',
    ville: 'Tunis',
    pays: 'Tunisie',
    email: 'contact@thirtythreespace.com',
    telephone: '+216 71 999 333',
    site_web: 'https://thirtythreespace.com',
    logo_url: 'https://deskywork-jet.vercel.app/partners/thirtythree-logo.png',
    cover_url: 'https://images.unsplash.com/photo-1527192491265-7e15c55b1ed2?auto=format&fit=crop&w=1600&q=80',
    statut: 'actif',
    plan: 'enterprise',
    tier: 'A',
    montant_mensuel: 90,
    limite_membres: 999999,
    limite_espaces: 999999,
    settings: {
      saas_pack: 'premium',
      onboarding_completed: true,
      limite_staff: 10,
      partenaire_officiel: true,
      tarif_partenaire: 90,
      marketplace_stats: { vues: 118, clics: 29 },
    },
    users: [
      { email: 'admin@thirtythreespace.com', password: 'ThirtyThree@2026!Desky', prenom: 'Thirty Three', nom: 'Admin', tel: '+216 71 999 333' },
      { email: 'contact@thirtythreespace.com', password: 'ThirtyThree@2026!Desky', prenom: 'Thirty Three', nom: 'Contact', tel: '+216 71 999 333' },
    ],
    espaces: [
      {
        id: 'e3333333-3333-4333-8333-000000000001',
        nom: 'Espace Collaboratif Lac',
        type: 'open_space',
        capacite: 25,
        tarif_horaire: 6.0,
        tarif_journalier: 28.0,
        tarif_mensuel: 280.0,
        description: 'Cadre d\'exception au Lac 2 alliant design contemporain et productivité partagée.',
        photo_url: 'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=900&q=80',
        equipements: ['Wi-Fi Haute Performance', 'Espace Lounge & Détente', 'Boissons chaustes à volonté', 'Accès terrasse'],
        actif: true,
      },
      {
        id: 'e3333333-3333-4333-8333-000000000002',
        nom: 'Salle de Formation & Workshop',
        type: 'training_room',
        capacite: 18,
        tarif_horaire: 35.0,
        tarif_journalier: 180.0,
        tarif_mensuel: 0.0,
        description: 'Espace pédagogique polyvalent conçu pour les formateurs professionnels et ateliers pratiques.',
        photo_url: 'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=900&q=80',
        equipements: ['Vidéoprojecteur HD', 'Disposition modulable en U ou classe', 'Système audio & micros', 'Paperboard'],
        actif: true,
      },
      {
        id: 'e3333333-3333-4333-8333-000000000003',
        nom: 'Espace Événementiel & Conférence',
        type: 'event_space',
        capacite: 50,
        tarif_horaire: 70.0,
        tarif_journalier: 350.0,
        tarif_mensuel: 0.0,
        description: 'Grand espace privatisable pour vos meetups tech, lancements de produit et conférences d\'entreprise.',
        photo_url: 'https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=900&q=80',
        equipements: ['Sonorisation complète', 'Micro sans fil', 'Scène & pupitre', 'Écran géant', 'Service traiteur possible'],
        actif: true,
      },
    ],
  },
];

async function run() {
  console.log('🚀 Démarrage du seed des partenaires officiels...');

  for (const p of PARTNERS) {
    console.log(`\n🏢 --- ${p.nom} (${p.slug}) ---`);

    // 1. Upsert Tenant
    const { error: tErr } = await supabase.from('tenants').upsert({
      id: p.id,
      nom: p.nom,
      slug: p.slug,
      description: p.description,
      adresse: p.adresse,
      ville: p.ville,
      pays: p.pays,
      email: p.email,
      telephone: p.telephone,
      site_web: p.site_web,
      logo_url: p.logo_url,
      cover_url: p.cover_url,
      statut: p.statut,
      plan: p.plan,
      tier: p.tier,
      montant_mensuel: p.montant_mensuel,
      limite_membres: p.limite_membres,
      limite_espaces: p.limite_espaces,
      settings: p.settings,
    });
    if (tErr) {
      console.error(`❌ Erreur upsert tenant ${p.nom}:`, tErr.message);
    } else {
      console.log(`✅ Tenant ${p.nom} upserté avec succès.`);
    }

    // 2. Upsert Organization
    const { error: oErr } = await supabase.from('organizations').upsert({
      id: p.id,
      type: 'coworking',
      nom: p.nom,
      slug: p.slug,
      email: p.email,
      telephone: p.telephone,
      adresse: p.adresse,
      ville: p.ville,
      pays: p.pays,
      description: p.description,
      statut: 'valide',
      logo_url: p.logo_url,
      cover_url: p.cover_url,
      settings: { onboarding_completed: true },
    });
    if (oErr) {
      console.error(`❌ Erreur upsert organization ${p.nom}:`, oErr.message);
    } else {
      console.log(`✅ Organization ${p.nom} upsertée avec succès.`);
    }

    // 3. Upsert Espaces
    for (const esp of p.espaces) {
      const { error: eErr } = await supabase.from('espaces').upsert({
        id: esp.id,
        tenant_id: p.id,
        nom: esp.nom,
        type: esp.type,
        capacite: esp.capacite,
        tarif_horaire: esp.tarif_horaire,
        description: esp.description,
        photo_url: esp.photo_url,
        images: [esp.photo_url],
        equipements: esp.equipements,
        actif: esp.actif,
      });
      if (eErr) {
        console.error(`  ❌ Erreur upsert espace ${esp.nom}:`, eErr.message);
      } else {
        console.log(`  ✅ Espace "${esp.nom}" injecté (${esp.tarif_horaire} DT/h).`);
      }
    }

    // 4. Comptes Auth & Profils
    for (const u of p.users) {
      console.log(`\n  👤 Configuration du compte: ${u.email}...`);

      // Chercher si l'utilisateur existe dans auth.users
      const { data: listData, error: lErr } = await supabase.auth.admin.listUsers();
      if (lErr) {
        console.error(`  ❌ Erreur listUsers:`, lErr.message);
      }
      const existingUser = listData?.users?.find(
        (usr) => String(usr.email).toLowerCase() === u.email.toLowerCase()
      );

      let userId = null;

      if (existingUser) {
        userId = existingUser.id;
        console.log(`  ℹ️ Utilisateur existant (ID: ${userId}). Mise à jour du mot de passe...`);
        const { error: uErr } = await supabase.auth.admin.updateUserById(userId, {
          password: u.password,
          email_confirm: true,
          user_metadata: { prenom: u.prenom, nom: u.nom, role: 'admin', telephone: u.tel },
        });
        if (uErr) console.error(`  ❌ Erreur updateUserById:`, uErr.message);
        else console.log(`  ✅ Mot de passe mis à jour.`);
      } else {
        console.log(`  ℹ️ Création de l'utilisateur dans Supabase Auth...`);
        const { data: newUsr, error: cErr } = await supabase.auth.admin.createUser({
          email: u.email,
          password: u.password,
          email_confirm: true,
          user_metadata: { prenom: u.prenom, nom: u.nom, role: 'admin', telephone: u.tel },
        });
        if (cErr) {
          console.error(`  ❌ Erreur createUser:`, cErr.message);
          continue;
        }
        userId = newUsr.user.id;
        console.log(`  ✅ Utilisateur créé (ID: ${userId}).`);
      }

      // 5. Upsert Profil
      const { error: pErr } = await supabase.from('profiles').upsert({
        id: userId,
        email: u.email,
        nom: u.nom,
        prenom: u.prenom,
        telephone: u.tel,
        role: 'admin',
        statut_compte: 'actif',
        email_verifie: true,
        is_super_admin: false,
        tenant_id: p.id,
        langue: 'fr',
      });
      if (pErr) console.error(`  ❌ Erreur upsert profil:`, pErr.message);
      else console.log(`  ✅ Profil rattaché au tenant ${p.nom} (statut: actif).`);

      // 6. Upsert Membership
      const { error: mErr } = await supabase.from('memberships').upsert(
        {
          user_id: userId,
          organization_id: p.id,
          role: 'admin',
          statut: 'actif',
        },
        { onConflict: 'user_id,organization_id' }
      );
      if (mErr) console.error(`  ❌ Erreur upsert membership:`, mErr.message);
      else console.log(`  ✅ Membership actif rattaché.`);
    }
  }

  console.log('\n🎉 Tout est prêt ! Les comptes et espaces ont été injectés dans Supabase.');
}

run().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
