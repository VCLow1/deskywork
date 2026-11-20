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
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const from = new Date(Date.now() - 30 * 86400000).toISOString();
  const to = new Date(Date.now() + 60 * 86400000).toISOString();
  
  const res1 = await supabase
    .from('formations')
    .select('id, titre, formateur_id, espace_id, date_debut, date_fin, capacite_max, prix_inscription, statut, tenant_id, reservation_id, profiles!fk_formations_formateur_profiles(id, nom, prenom, email), espaces(id, nom, type)')
    .lt('date_debut', to)
    .gt('date_fin', from);

  console.log('Query with fk_formations_formateur_profiles:', res1.error ? res1.error.message : `Success! Count: ${res1.data?.length}`);

  const res2 = await supabase
    .from('formations')
    .select('id, titre, formateur_id, date_debut, date_fin, statut, tenant_id')
    .limit(5);

  console.log('Simple formations query:', res2.error ? res2.error.message : res2.data);
}

main().catch(console.error);

