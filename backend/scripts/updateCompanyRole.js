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
  const { data: users } = await supabase.auth.admin.listUsers();
  const user = users.users.find(u => u.email === 'test.company@deskywork.tn');
  if (!user) {
    console.error('User test.company@deskywork.tn not found');
    return;
  }

  // Update user_metadata in Auth
  const { data: updatedUser, error: authErr } = await supabase.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...user.user_metadata,
      role: 'company',
      type_membre: 'entreprise',
    },
  });
  console.log('Auth user_metadata updated:', updatedUser?.user?.user_metadata, 'error:', authErr);

  // Try updating profile role to 'company'
  const { data: prof1, error: err1 } = await supabase.from('profiles').update({
    role: 'company',
    type_membre: 'entreprise',
  }).eq('id', user.id).select();

  if (err1) {
    console.log('Note: profiles.role may have check constraint (e.g. member/admin/formateur/super_admin). Error:', err1.message);
    const { data: prof2, error: err2 } = await supabase.from('profiles').update({
      type_membre: 'entreprise',
    }).eq('id', user.id).select();
    console.log('Updated profile type_membre:', prof2, 'err:', err2);
  } else {
    console.log('Updated profile role to company successfully:', prof1);
  }
}

main().catch(console.error);

