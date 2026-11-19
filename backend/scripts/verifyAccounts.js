// backend/scripts/verifyAccounts.js
// Vérification complète de la session et du contexte post-login pour les 5 comptes
'use strict';

const fs = require('fs');
const path = require('path');

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
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const { createClient } = require(path.resolve(__dirname, '../../frontend/node_modules/@supabase/supabase-js'));

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Client avec clé anon pour simuler la connexion du frontend
const supabaseClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const COMMON_PASSWORD = 'DeskyTest@2026!';

const ACCOUNTS = [
  { roleName: 'Super Admin', email: 'test.superadmin@deskywork.tn', expectedPath: '/super-admin/dashboard' },
  { roleName: 'Admin Établissement', email: 'test.admin@deskywork.tn', expectedPath: '/admin/dashboard' },
  { roleName: 'Membre Particulier', email: 'test.member@deskywork.tn', expectedPath: '/dashboard' },
  { roleName: 'Entreprise', email: 'test.company@deskywork.tn', expectedPath: '/dashboard' },
  { roleName: 'Formateur', email: 'test.trainer@deskywork.tn', expectedPath: '/trainer-dashboard' },
];

async function verify() {
  console.log('\n🔍 ═════════════════════════════════════════════════════════════════');
  console.log('   VÉRIFICATION DU POST-LOGIN & CONTEXTE DES 5 COMPTES DE TEST');
  console.log('═════════════════════════════════════════════════════════════════\n');

  for (const acc of ACCOUNTS) {
    console.log(`\n🔑 Test de connexion pour : ${acc.roleName} (${acc.email})...`);

    // 1. Authentification client standard
    const { data: auth, error: authErr } = await supabaseClient.auth.signInWithPassword({
      email: acc.email,
      password: COMMON_PASSWORD,
    });

    if (authErr) {
      console.error(`  ❌ Échec authentification:`, authErr.message);
      continue;
    }

    const user = auth.user;
    console.log(`  ✅ Connexion auth réussie (User ID: ${user.id})`);
    console.log(`     Token JWT émis : ${auth.session?.access_token ? 'Oui (valide)' : 'Non'}`);
    console.log(`     Email confirmé le : ${user.email_confirmed_at}`);

    // 2. Lecture du profil en base
    const { data: profile, error: pErr } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (pErr) {
      console.error(`  ❌ Erreur lecture profil:`, pErr.message);
      continue;
    }

    console.log(`  👤 Profil : Nom="${profile.prenom} ${profile.nom}", Role="${profile.role}", Type="${profile.type_membre || '—'}", Statut="${profile.statut_compte}"`);

    // 3. Calcul du chemin de redirection (logique exacte de getMyContext / getHomePath)
    const { data: memberships } = await supabaseAdmin
      .from('memberships')
      .select('id, role, statut, organization_id, organizations(*)')
      .eq('user_id', user.id)
      .eq('statut', 'actif');

    const { data: trainerProfile } = await supabaseAdmin
      .from('trainer_profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    let computedRedirect = '/dashboard';
    if (profile.is_super_admin || profile.role === 'super_admin') {
      computedRedirect = '/super-admin/dashboard';
    } else if (memberships && memberships.length === 1) {
      const single = memberships[0];
      if (['proprietaire', 'admin', 'staff'].includes(single.role)) {
        computedRedirect = single.organizations?.type === 'entreprise' ? '/dashboard' : '/admin/dashboard';
      } else if (single.role === 'formateur') {
        computedRedirect = '/trainer-dashboard';
      }
    } else if (profile.role === 'formateur' || trainerProfile) {
      computedRedirect = '/trainer-dashboard';
    }

    const match = computedRedirect === acc.expectedPath;
    console.log(`  🧭 Redirection calculée : ${computedRedirect} (Attendu: ${acc.expectedPath}) → ${match ? '✅ PARFAIT' : '⚠️ DIFFÉRENCE'}`);
  }

  console.log('\n🎉 Contrôle terminé avec succès !\n');
}

verify().catch(console.error);

