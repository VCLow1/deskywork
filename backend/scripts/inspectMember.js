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

async function run() {
  const { data: users } = await supabase.auth.admin.listUsers();
  const u = users.users.find(x => x.email === 'test.member@deskywork.tn');
  console.log('User test.member ID:', u?.id);
  if (!u) return;

  const { data: prof, error: pErr } = await supabase.from('profiles').select('*').eq('id', u.id).single();
  console.log('Profile:', prof, 'err:', pErr);

  const { data: subs, error: sErr } = await supabase.from('abonnements').select('*').eq('user_id', u.id);
  console.log('Abonnements:', subs, 'err:', sErr);
}

run().catch(console.error);
