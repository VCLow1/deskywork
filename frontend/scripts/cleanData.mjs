import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log('1. Setting test tenants to inactif...');
  const testIds = [
    '4108662f-6ade-455f-94a5-0ea9df253137', // amira
    'd0000000-0000-4000-8000-000000000002', // Société Test SARL
    'd0000000-0000-4000-8000-000000000001', // DeskyWork Test & Demo Space
  ];
  for (const tid of testIds) {
    const { error } = await supabase.from('tenants').update({ statut: 'inactif' }).eq('id', tid);
    if (error) console.error('Error deactivating tenant', tid, error);
    else console.log('Deactivated tenant:', tid);
  }

  console.log('2. Unifying Nero Coworking Space address & logo...');
  const neroUpdates = {
    adresse: 'Avenue Hédi Nouira, Ennasr 2, Tunis',
    ville: 'Tunis',
    logo_url: 'https://deskywork-jet.vercel.app/partners/nero-coworking.png',
  };
  const neroIds = [
    'a1111111-1111-4111-8111-111111111111',
    '72a4aedb-3355-4ccd-b8bd-832a3472cdec',
  ];
  for (const nid of neroIds) {
    const { error } = await supabase.from('tenants').update(neroUpdates).eq('id', nid);
    if (error) console.error('Error updating Nero tenant', nid, error);
    else console.log('Updated Nero tenant:', nid);
  }

  console.log('3. Updating POWER BI formation with rich programme & description...');
  const powerBiId = 'd3790650-1793-41a7-a439-380278a1cf7a';
  const programmeContent = `• Module 1 : Connexion & Transformation de données avec Power Query (ETL)
• Module 2 : Modélisation des données en étoile & Relations
• Module 3 : Calculs avancés et formules DAX (CALCULATE, Time Intelligence, KPI)
• Module 4 : Design et conception de tableaux de bord interactifs & ergonomiques
• Module 5 : Publication sur le service Power BI, automatisation & gouvernance`;

  const { error: formErr } = await supabase.from('formations').update({
    description: 'Formation complète et intensive pour maîtriser Power BI Desktop et concevoir des tableaux de bord d\'aide à la décision professionnels.',
    programme: programmeContent,
    prix_inscription: 350,
  }).eq('id', powerBiId);

  if (formErr) console.error('Error updating Power BI formation:', formErr);
  else console.log('Power BI formation updated successfully with rich programme!');

  console.log('Done!');
}

main().catch(console.error);
