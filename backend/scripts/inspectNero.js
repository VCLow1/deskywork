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
  const emails = ['admin@nerocoworking.tn', 'test.admin@deskywork.tn'];
  for (const email of emails) {
    const { data: users } = await supabase.auth.admin.listUsers();
    const user = users.users.find(u => u.email === email);
    if (!user) {
      console.log(`User ${email} NOT found in auth.`);
      continue;
    }
    console.log(`\nUser ${email} (ID: ${user.id}):`);
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
    console.log('Profile:', profile);
    const { data: memberships } = await supabase.from('memberships').select('*, organizations(*)').eq('user_id', user.id);
    console.log('Memberships:', JSON.stringify(memberships, null, 2));
  }
}

main().catch(console.error);

