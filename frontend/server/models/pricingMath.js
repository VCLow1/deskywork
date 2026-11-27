// models/pricingMath.js — Calculs HT / TVA / TTC au millime & alertes cohérence
const DEFAULT_TVA_PCT = 19;

function roundMillime(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

function computeTTC(ht, tvaPct = DEFAULT_TVA_PCT) {
  const h = Number(ht);
  const t = Number(tvaPct);
  if (!Number.isFinite(h) || h < 0) return 0;
  const safeTva = Number.isFinite(t) && t >= 0 ? t : DEFAULT_TVA_PCT;
  return roundMillime(h * (1 + safeTva / 100));
}

function computeHTFromTTC(ttc, tvaPct = DEFAULT_TVA_PCT) {
  const m = Number(ttc);
  const t = Number(tvaPct);
  if (!Number.isFinite(m) || m < 0) return 0;
  const safeTva = Number.isFinite(t) && t >= 0 ? t : DEFAULT_TVA_PCT;
  return roundMillime(m / (1 + safeTva / 100));
}

function checkRateCoherence({
  horaire = 0,
  journalier = 0,
  mensuel = 0,
  actifs = { horaire: true, journalier: false, mensuel: false },
} = {}) {
  const warnings = [];
  const h = Number(horaire || 0);
  const j = Number(journalier || 0);
  const m = Number(mensuel || 0);

  if (actifs.horaire && actifs.journalier && h > 0 && j > 0) {
    if (j < h) {
      warnings.push('Le tarif journalier HT est inférieur au tarif horaire HT.');
    } else if (j >= h * 8) {
      warnings.push(`Le tarif journalier HT (${j.toFixed(3)} DT) n'offre pas d'avantage vs 8h au tarif horaire (${(h * 8).toFixed(3)} DT).`);
    }
  }
  if (actifs.journalier && actifs.mensuel && j > 0 && m > 0) {
    if (m < j) {
      warnings.push('Le tarif mensuel HT est inférieur au tarif journalier HT.');
    } else if (m >= j * 20) {
      warnings.push(`Le tarif mensuel HT (${m.toFixed(3)} DT) est supérieur ou égal à 20 journées (${(j * 20).toFixed(3)} DT).`);
    }
  }
  return warnings;
}

module.exports = {
  DEFAULT_TVA_PCT,
  roundMillime,
  computeTTC,
  computeHTFromTTC,
  checkRateCoherence,
};
