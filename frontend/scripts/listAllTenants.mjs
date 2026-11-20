import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data: tenants } = await supabase.from('tenants').select('id, nom, slug, adresse, ville, logo_url, cover_url, statut');
  console.log('ALL TENANTS in DB:');
  console.log(tenants);
}

main().catch(console.error);
