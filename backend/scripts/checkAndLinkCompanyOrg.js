const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (t && !t.startsWith('#') && t.includes('=')) {
      const idx = t.indexOf('=');
      let v = t.slice(idx + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[t.slice(0, idx).trim()] = v;
    }
  }
}

const { createClient } = require(path.resolve(__dirname, '../../frontend/node_modules/@supabase/supabase-js'));
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const userId = '591cc6e4-f02a-4e73-b5c9-34a2b7ef418e';

  // Check memberships
  const { data: mems } = await supabase
    .from('memberships')
    .select('*, organizations(*)')
    .eq('user_id', userId);

  console.log('Existing memberships for test.company:', mems);

  if (!mems || mems.length === 0) {
    console.log('No organization linked yet. Creating Société Test SARL...');
    // Create organization
    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .insert({
        nom: 'Société Test SARL',
        matricule_fiscal: '1234567/A/M/000',
        adresse: 'Rue du Lac Biwa, Les Berges du Lac 2',
        ville: 'Tunis',
        pays: 'Tunisie',
        telephone: '+216 71 123 456',
        email: 'test.company@deskywork.tn',
        settings: {
          secteur_activite: 'Technologies & Conseil',
        },
      })
      .select()
      .single();

    if (orgErr) {
      console.error('Error creating organization:', orgErr);
      return;
    }
    console.log('Created organization:', org);

    // Link user via memberships
    const { data: link, error: linkErr } = await supabase
      .from('memberships')
      .insert({
        user_id: userId,
        organization_id: org.id,
        role: 'admin',
      })
      .select();

    console.log('Created membership link:', link, 'error:', linkErr);
  } else {
    console.log('Organization already linked:', mems[0].organizations);
  }
}

main().catch(console.error);

