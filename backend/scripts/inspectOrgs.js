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
  const { data: orgs, error } = await supabase.from('organizations').select('*').limit(5);
  if (error) {
    console.error('Error fetching orgs:', error);
  } else {
    console.log('Sample org columns:', Object.keys(orgs[0] || {}));
    console.log('Sample orgs:', orgs.map(o => ({ id: o.id, nom: o.nom, slug: o.slug, settings: o.settings })));
  }

  const { data: subs, error: subErr } = await supabase.from('subscriptions').select('*').limit(5);
  console.log('Subscriptions table:', subErr ? subErr.message : subs);

  const { data: subPacks, error: packErr } = await supabase.from('subscription_packs').select('*').limit(5);
  console.log('Subscription_packs table:', packErr ? packErr.message : subPacks);
}

main().catch(console.error);
