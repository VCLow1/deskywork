// config/deskyworkPacks.js — Source unique front-end des packs DESKYWORK
import packsConfig from './deskyworkPacks.json';

export const DEFAULT_TVA_PCT = Number(packsConfig.default_tva_pct ?? 19);
export const DESKYWORK_PACKS = packsConfig.packs;
export const PACK_LIST = Object.values(DESKYWORK_PACKS).sort((a, b) => a.rank - b.rank);
export const PACK_RANK = Object.fromEntries(PACK_LIST.map((p) => [p.key, p.rank]));

export function computePackTTC(prixHt, tvaPct = DEFAULT_TVA_PCT) {
  const ht = Number(prixHt || 0);
  const tva = Number(tvaPct || 0);
  return Math.round(ht * (1 + tva / 100) * 1000) / 1000;
}

export function isOfficialPartnerTenant(tenant) {
  return Boolean(
    tenant?.settings?.partenaire_officiel ||
    tenant?.settings?.tarif_partenaire ||
    tenant?.slug === 'nero-coworking' ||
    tenant?.slug === 'thirty-three-space' ||
    tenant?.id === 'a1111111-1111-4111-8111-111111111111' ||
    tenant?.id === 'a3333333-3333-4333-8333-333333333333'
  );
}

export function resolveTenantPack(tenant) {
  const raw = String(tenant?.settings?.saas_pack || tenant?.plan || 'essentiel').toLowerCase().trim();
  const isPartner = isOfficialPartnerTenant(tenant);
  const key = (isPartner || raw.includes('prem') || raw.includes('enterp'))
    ? 'premium'
    : (raw.includes('stand') || raw.includes('pro'))
      ? 'standard'
      : 'essentiel';
  const base = DESKYWORK_PACKS[key] || DESKYWORK_PACKS.essentiel;
  return {
    ...base,
    prix: base.prix_ht,
    prix_ht: base.prix_ht,
    prix_ttc: computePackTTC(base.prix_ht, base.tva_pct),
    is_partner: isPartner,
    max_espaces: isPartner ? null : (tenant?.limite_espaces ?? base.max_espaces),
    max_membres: isPartner ? null : (tenant?.limite_membres ?? base.max_membres),
    max_staff: isPartner ? 10 : (tenant?.settings?.limite_staff ?? base.max_staff),
  };
}

export function hasPackFeature(tenant, featureKey) {
  const pack = resolveTenantPack(tenant);
  return Boolean(pack.features_flags?.[featureKey]);
}
