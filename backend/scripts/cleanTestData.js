const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      let val = trimmed.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[trimmed.slice(0, idx).trim()] = val;
    }
  }
}

const { createClient } = require(path.resolve(__dirname, '../../frontend/node_modules/@supabase/supabase-js'));
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log('--- Checking organizations ---');
  const { data: orgs } = await supabase.from('organizations').select('id, nom, slug');
  console.log('Organizations:', orgs);

  console.log('--- Checking formations ---');
  const { data: formations } = await supabase.from('formations').select('id, titre, statut, tenant_id');
  console.log('Formations:', formations);

  // Find dummy formations (e.g. 'aaaaaaaa...', 'test')
  const dummyFormations = (formations || []).filter(f => /a{5,}/i.test(f.titre) || f.titre.toLowerCase().includes('aaaa') || f.titre.toLowerCase() === 'test');
  for (const f of dummyFormations) {
    console.log(`Deleting dummy formation: "${f.titre}" (ID: ${f.id})...`);
    // Delete inscriptions first
    await supabase.from('formation_inscriptions').delete().eq('formation_id', f.id);
    const { error } = await supabase.from('formations').delete().eq('id', f.id);
    if (error) console.error('Error deleting formation:', error);
    else console.log('Deleted successfully.');
  }

  // Find dummy orgs like 'amira'
  const dummyOrgs = (orgs || []).filter(o => o.nom?.toLowerCase() === 'amira' || o.slug?.toLowerCase().includes('amira'));
  for (const o of dummyOrgs) {
    console.log(`Deleting dummy org: "${o.nom}" (ID: ${o.id})...`);
    // Delete dependent records
    await supabase.from('espaces').delete().eq('organization_id', o.id);
    await supabase.from('memberships').delete().eq('organization_id', o.id);
    await supabase.from('reservations').delete().eq('tenant_id', o.id);
    await supabase.from('formations').delete().eq('tenant_id', o.id);
    const { error } = await supabase.from('organizations').delete().eq('id', o.id);
    if (error) console.error('Error deleting org:', error);
    else console.log('Deleted successfully.');
  }

  console.log('Cleanup finished.');
}

main().catch(console.error);
