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
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function check() {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'test.company@deskywork.tn',
    password: 'DeskyTest@2026!',
  });
  if (error) {
    console.error('Sign in error:', error);
    return;
  }
  console.log('Sign in SUCCESS:');
  console.log('User ID:', data.user.id);
  console.log('User metadata:', data.user.user_metadata);
  const { data: prof, error: profErr } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
  console.log('Profile:', prof, 'profErr:', profErr);
}

check().catch(console.error);

