// config/deskyworkPacks.js — Source unique back-end des packs DESKYWORK (lue depuis frontend/src/config/deskyworkPacks.json)
const fs = require('fs');
const path = require('path');

const CANDIDATE_JSON_PATHS = [
  path.join(__dirname, '../../src/config/deskyworkPacks.json'),
  path.join(__dirname, '../../frontend/src/config/deskyworkPacks.json'),
];

const FALLBACK_CONFIG = {
  default_tva_pct: 19,
  currency: 'DT',
  packs: {
    essentiel: {
      key: 'essentiel',
      rank: 1,
      name: 'Essentiel',
      prix_ht: 90,
      tva_pct: 19,
      max_espaces: 10,
      max_membres: 100,
      max_staff: 1,
      features_flags: {
        marketplace_analytics: false,
        multi_sites: false,
        api_integrations: false,
        advanced_reports: false,
      },
      features: [
        "Jusqu'à 10 espaces / ressources",
        "Jusqu'à 100 membres actifs",
        '1 compte Staff / Réceptionniste',
      ],
    },
    standard: {
      key: 'standard',
      rank: 2,
      name: 'Standard',
      prix_ht: 150,
      tva_pct: 19,
      max_espaces: 30,
      max_membres: 500,
      max_staff: 3,
      features_flags: {
        marketplace_analytics: false,
        multi_sites: false,
        api_integrations: false,
        advanced_reports: true,
      },
      features: [
        'Tout Essentiel inclus',
        "Jusqu'à 30 espaces / ressources",
        "Jusqu'à 500 membres actifs",
        "Jusqu'à 3 comptes Staff / Réceptionniste",
      ],
    },
    premium: {
      key: 'premium',
      rank: 3,
      name: 'Premium',
      prix_ht: 220,
      tva_pct: 19,
      max_espaces: null,
      max_membres: null,
      max_staff: 10,
      features_flags: {
        marketplace_analytics: true,
        multi_sites: true,
        api_integrations: true,
        advanced_reports: true,
      },
      features: [
        'Tout Standard inclus',
        'Espaces & membres illimités',
        "Jusqu'à 10 comptes Staff / Réceptionniste",
      ],
    },
  },
};

function loadConfig() {
  for (const p of CANDIDATE_JSON_PATHS) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      }
    } catch (_) {}
  }
  return FALLBACK_CONFIG;
}

const CONFIG = loadConfig();
const DEFAULT_TVA_PCT = Number(CONFIG.default_tva_pct ?? 19);
const SAAS_PACKS = {};

for (const [k, p] of Object.entries(CONFIG.packs || {})) {
  const prixHt = Number(p.prix_ht || 0);
  const tva = Number(p.tva_pct ?? DEFAULT_TVA_PCT);
  SAAS_PACKS[k] = {
    ...p,
    prix: prixHt,
    prix_ht: prixHt,
    prix_ttc: Math.round(prixHt * (1 + tva / 100) * 1000) / 1000,
  };
}

function isOfficialPartnerTenant(tenant) {
  return Boolean(
    tenant?.settings?.partenaire_officiel ||
    tenant?.settings?.tarif_partenaire ||
    tenant?.slug === 'nero-coworking' ||
    tenant?.slug === 'thirty-three-space' ||
    tenant?.id === 'a1111111-1111-4111-8111-111111111111' ||
    tenant?.id === 'a3333333-3333-4333-8333-333333333333'
  );
}

function resolveTenantPack(tenant) {
  const raw = String(tenant?.settings?.saas_pack || tenant?.plan || 'essentiel').toLowerCase().trim();
  const isPartner = isOfficialPartnerTenant(tenant);
  const key = (isPartner || raw.includes('prem') || raw.includes('enterp'))
    ? 'premium'
    : (raw.includes('stand') || raw.includes('pro'))
      ? 'standard'
      : 'essentiel';
  const base = SAAS_PACKS[key] || SAAS_PACKS.essentiel;
  return {
    ...base,
    name: base.name,
    is_partner: isPartner,
    max_espaces: isPartner ? null : (tenant?.limite_espaces ?? base.max_espaces),
    max_membres: isPartner ? null : (tenant?.limite_membres ?? base.max_membres),
    max_staff: isPartner ? 10 : (tenant?.settings?.limite_staff ?? base.max_staff),
    prix: base.prix_ht,
  };
}

function hasPackFeature(tenant, featureKey) {
  const pack = resolveTenantPack(tenant);
  return Boolean(pack.features_flags?.[featureKey]);
}

module.exports = {
  DEFAULT_TVA_PCT,
  SAAS_PACKS,
  resolveTenantPack,
  hasPackFeature,
  isOfficialPartnerTenant,
};
