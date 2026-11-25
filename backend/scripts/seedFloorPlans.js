// backend/scripts/seedFloorPlans.js — Seed idempotent des plans 2D de démonstration (Nero Coworking Space)
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  const env = {};
  if (!fs.existsSync(envPath)) return env;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

function buildNeroDemoPlan(tenantId, spaceIds, planName) {
  const planId = crypto.randomUUID();
  const { openSpaceId, privateOfficeId, meetingRoomId } = spaceIds;
  const nowIso = new Date().toISOString();

  const elements_json = [
    { id: 'zone-accueil', type: 'zone', label: 'Accueil & Coin Café', x: 40, y: 40, width: 220, height: 680, rotation: 0 },
    { id: 'zone-openspace', type: 'zone', label: 'Open Space Nomade', x: 280, y: 40, width: 480, height: 420, rotation: 0 },
    { id: 'zone-quiet', type: 'zone', label: 'Zone Calme (Quiet Desks)', x: 280, y: 480, width: 480, height: 240, rotation: 0 },
    { id: 'zone-salles', type: 'zone', label: 'Bureaux & Salles Privatives', x: 780, y: 40, width: 380, height: 680, rotation: 0 },
    { id: 'wall-n', type: 'wall', label: '', x: 20, y: 20, width: 1160, height: 12, rotation: 0 },
    { id: 'wall-s-left', type: 'wall', label: '', x: 20, y: 728, width: 120, height: 12, rotation: 0 },
    { id: 'door-main', type: 'door', label: 'Entrée', x: 140, y: 700, width: 80, height: 40, rotation: 0 },
    { id: 'wall-s-right', type: 'wall', label: '', x: 220, y: 728, width: 960, height: 12, rotation: 0 },
    { id: 'wall-w', type: 'wall', label: '', x: 20, y: 20, width: 12, height: 720, rotation: 0 },
    { id: 'wall-e', type: 'wall', label: '', x: 1168, y: 20, width: 12, height: 720, rotation: 0 },
    { id: 'part-accueil', type: 'partition', label: '', x: 264, y: 40, width: 8, height: 540, rotation: 0 },
    { id: 'part-quiet', type: 'partition', label: '', x: 280, y: 468, width: 480, height: 8, rotation: 0 },
    { id: 'part-salles', type: 'partition', label: '', x: 768, y: 40, width: 8, height: 680, rotation: 0 },
    { id: 'part-between-rooms', type: 'partition', label: '', x: 780, y: 360, width: 380, height: 8, rotation: 0 },
  ];

  const mkItem = (label, item_type, space_id, x, y, width, height, status = 'active') => ({
    id: crypto.randomUUID(),
    floor_plan_id: planId,
    tenant_id: tenantId,
    space_id: space_id || null,
    label,
    item_type,
    x,
    y,
    width,
    height,
    rotation: 0,
    status,
    metadata: {},
  });

  const items = [
    mkItem('A1-01', 'desk', openSpaceId, 320, 110, 80, 56),
    mkItem('A1-02', 'desk', openSpaceId, 410, 110, 80, 56),
    mkItem('A1-03', 'desk', openSpaceId, 320, 180, 80, 56),
    mkItem('A1-04', 'desk', openSpaceId, 410, 180, 80, 56),
    mkItem('A2-01', 'desk', openSpaceId, 550, 110, 80, 56),
    mkItem('A2-02', 'desk', openSpaceId, 640, 110, 80, 56),
    mkItem('A2-03', 'desk', openSpaceId, 550, 180, 80, 56),
    mkItem('A2-04', 'desk', openSpaceId, 640, 180, 80, 56),
    mkItem('Q1-01', 'quiet_desk', openSpaceId, 310, 540, 84, 60),
    mkItem('Q1-02', 'quiet_desk', openSpaceId, 420, 540, 84, 60),
    mkItem('Q1-03', 'quiet_desk', openSpaceId, 530, 540, 84, 60),
    mkItem('Q1-04', 'quiet_desk', openSpaceId, 640, 540, 84, 60, 'maintenance'),
  ];

  if (privateOfficeId) {
    items.push(mkItem('Bureau B1', 'private_office', privateOfficeId, 810, 90, 320, 230));
  }
  if (meetingRoomId) {
    items.push(mkItem('Salle Prestige', 'meeting_room', meetingRoomId, 810, 400, 320, 290));
  }

  return {
    id: planId,
    tenant_id: tenantId,
    name: planName,
    width: 1200,
    height: 760,
    grid_size: 20,
    background_image_url: null,
    elements_json,
    is_active: true,
    ordre: 0,
    items,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

async function main() {
  const env = loadEnv();
  const baseUrl = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant dans backend/.env');
  }

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  const TARGET_TENANTS = [
    { id: 'a1111111-1111-4111-8111-111111111111', planName: 'Rez-de-chaussée — Open Space & Salles' },
    { id: '72a4aedb-3355-4ccd-b8bd-832a3472cdec', planName: 'Rez-de-chaussée — Espace Principal' },
  ];

  // Vérifier si la table floor_plans existe
  const tableCheck = await fetch(`${baseUrl}/rest/v1/floor_plans?select=id&limit=1`, { headers });
  const sqlAvailable = tableCheck.ok;
  console.log('SQL floor_plans table available:', sqlAvailable);

  for (const target of TARGET_TENANTS) {
    const tRes = await fetch(`${baseUrl}/rest/v1/tenants?id=eq.${target.id}&select=id,nom,settings`, { headers });
    const tRows = await tRes.json();
    const tenant = Array.isArray(tRows) ? tRows[0] : null;
    if (!tenant) {
      console.log(`⏭️ Tenant ${target.id} introuvable, ignoré.`);
      continue;
    }

    const eRes = await fetch(`${baseUrl}/rest/v1/espaces?tenant_id=eq.${target.id}&select=id,nom,type,actif`, { headers });
    const espaces = await eRes.json();
    if (!Array.isArray(espaces) || espaces.length === 0) {
      console.log(`⏭️ Aucun espace pour ${tenant.nom}, ignoré.`);
      continue;
    }

    const openSpace = espaces.find((e) => ['open_space', 'hot_desk'].includes(e.type)) || espaces[0];
    const privateOffice = espaces.find((e) => e.type === 'private_office') || null;
    const meetingRoom = espaces.find((e) => e.type === 'meeting_room') || null;

    const demoPlan = buildNeroDemoPlan(
      target.id,
      {
        openSpaceId: openSpace?.id || null,
        privateOfficeId: privateOffice?.id || null,
        meetingRoomId: meetingRoom?.id || null,
      },
      target.planName
    );

    if (sqlAvailable) {
      const existingRes = await fetch(`${baseUrl}/rest/v1/floor_plans?tenant_id=eq.${target.id}&select=id`, { headers });
      const existingPlans = await existingRes.json();
      if (Array.isArray(existingPlans) && existingPlans.length > 0) {
        console.log(`✅ ${tenant.nom} possède déjà ${existingPlans.length} plan(s) en SQL.`);
        continue;
      }

      const { items, created_at, updated_at, ...planRow } = demoPlan;
      const insPlan = await fetch(`${baseUrl}/rest/v1/floor_plans`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(planRow),
      });
      if (!insPlan.ok) throw new Error(await insPlan.text());

      const insItems = await fetch(`${baseUrl}/rest/v1/floor_plan_items`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(items),
      });
      if (!insItems.ok) throw new Error(await insItems.text());
      console.log(`✅ Plan 2D inséré en SQL pour ${tenant.nom} (${items.length} postes/salles).`);
    } else {
      const curSettings = tenant.settings && typeof tenant.settings === 'object' ? tenant.settings : {};
      const existingFallback = Array.isArray(curSettings.floor_plans) ? curSettings.floor_plans : [];
      if (existingFallback.length > 0) {
        console.log(`✅ ${tenant.nom} possède déjà ${existingFallback.length} plan(s) dans settings.floor_plans.`);
        continue;
      }

      const nextSettings = { ...curSettings, floor_plans: [demoPlan] };
      const updRes = await fetch(`${baseUrl}/rest/v1/tenants?id=eq.${target.id}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ settings: nextSettings, updated_at: new Date().toISOString() }),
      });
      if (!updRes.ok) throw new Error(await updRes.text());
      console.log(`✅ Plan 2D seedé dans settings.floor_plans pour ${tenant.nom} (${demoPlan.items.length} postes/salles).`);
    }
  }
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
