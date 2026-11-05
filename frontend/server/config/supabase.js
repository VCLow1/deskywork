// config/supabase.js — Clients Supabase partagés
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
  console.error('Variables SUPABASE_URL, SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY requises.');
}

// Client admin (service role) — contourne le RLS
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Assurer l'existence des buckets de stockage publics (images, avatars, documents)
async function ensureStorageBucket() {
  const buckets = ['coworking-images', 'avatars', 'documents'];
  for (const bucketName of buckets) {
    try {
      const { error } = await supabaseAdmin.storage.createBucket(bucketName, { public: true });
      if (error) {
        if (error.message && (error.message.includes('already exists') || error.message.includes('Duplicate'))) {
          // Déjà présent
        } else {
          console.warn(`⚠️ Bucket "${bucketName}" non créé:`, error.message);
        }
      } else {
        console.log(`🚀 Bucket "${bucketName}" créé avec succès.`);
      }
    } catch (e) {
      // Ignorer
    }
  }
}

// Client anonyme (respecte le RLS)
const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey);

module.exports = {
  supabaseAdmin,
  supabaseAnon,
  ensureStorageBucket,
};
