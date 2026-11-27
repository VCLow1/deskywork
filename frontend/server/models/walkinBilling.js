// models/walkinBilling.js — Calcul pur de facturation Client sur place (Walk-in) & Dépassement 15 min (LOT 3)
// Partagé côté backend (CommonJS). Version ESM miroir dans frontend/src/utils/walkinBilling.js.

function roundMillimes(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 1000) / 1000;
}

/**
 * Facturation sans réservation (Client sur place / Walk-in) :
 * - Par tranches de 15 minutes entamées
 * - Minimum 1 heure facturée (4 tranches)
 * - Plafond automatique au tarif journalier de l'espace (si > 0)
 */
function computeWalkinBilling({
  startedAt,
  stoppedAt = new Date().toISOString(),
  tarifHoraireHT = 0,
  tarifJournalierHT = 0,
  tvaPct = 19,
}) {
  const startMs = new Date(startedAt).getTime();
  const stopMs = new Date(stoppedAt).getTime();
  const elapsedSeconds = Number.isFinite(startMs) && Number.isFinite(stopMs)
    ? Math.max(0, Math.floor((stopMs - startMs) / 1000))
    : 0;

  const elapsedMinutes = Math.ceil(elapsedSeconds / 60);
  const rawSlices = Math.max(1, Math.ceil(Math.max(1, elapsedMinutes) / 15));
  const billedSlices = Math.max(4, rawSlices); // minimum 1h = 4 tranches de 15 min
  const billedMinutes = billedSlices * 15;

  const hourlyHT = Math.max(0, Number(tarifHoraireHT) || 0);
  const dailyHT = Math.max(0, Number(tarifJournalierHT) || 0);
  const tva = Math.max(0, Number(tvaPct ?? 19));

  const rawAmountHT = roundMillimes((billedSlices / 4) * hourlyHT);
  const capped = dailyHT > 0 && rawAmountHT > dailyHT;
  const montantHT = capped ? roundMillimes(dailyHT) : rawAmountHT;
  const montantTVA = roundMillimes(montantHT * (tva / 100));
  const montantTTC = roundMillimes(montantHT + montantTVA);

  return {
    elapsedSeconds,
    elapsedMinutes,
    rawSlices,
    billedSlices,
    billedMinutes,
    tarifHoraireHT: roundMillimes(hourlyHT),
    tarifJournalierHT: roundMillimes(dailyHT),
    tvaPct: tva,
    rawAmountHT,
    capped,
    montantHT,
    montantTVA,
    montantTTC,
  };
}

/**
 * Dépassement sur réservation classique :
 * - Facturation par tranches de 15 minutes entamées
 */
function computeOvertime15Min({
  dateFin,
  nowOrStop = new Date().toISOString(),
  tarifHoraireHT = 0,
  tvaPct = 19,
  tarifHoraireTTC = null,
}) {
  const finMs = new Date(dateFin).getTime();
  const stopMs = new Date(nowOrStop).getTime();
  if (!Number.isFinite(finMs) || !Number.isFinite(stopMs) || stopMs <= finMs) {
    return {
      overtimeSeconds: 0,
      overtimeMinutes: 0,
      slices15Min: 0,
      montantHT: 0,
      montantTVA: 0,
      montantTTC: 0,
    };
  }

  const overtimeSeconds = Math.floor((stopMs - finMs) / 1000);
  const overtimeMinutes = Math.max(1, Math.ceil(overtimeSeconds / 60));
  const slices15Min = Math.ceil(overtimeMinutes / 15);
  const tva = Math.max(0, Number(tvaPct ?? 19));

  let effectiveHT = Math.max(0, Number(tarifHoraireHT) || 0);
  if (effectiveHT === 0 && tarifHoraireTTC != null && Number(tarifHoraireTTC) > 0) {
    effectiveHT = roundMillimes(Number(tarifHoraireTTC) / (1 + tva / 100));
  }

  const montantHT = roundMillimes((slices15Min / 4) * effectiveHT);
  const montantTVA = roundMillimes(montantHT * (tva / 100));
  const montantTTC = tarifHoraireTTC != null && Number(tarifHoraireTTC) > 0 && Number(tarifHoraireHT || 0) === 0
    ? roundMillimes((slices15Min / 4) * Number(tarifHoraireTTC))
    : roundMillimes(montantHT + montantTVA);

  return {
    overtimeSeconds,
    overtimeMinutes,
    slices15Min,
    montantHT,
    montantTVA,
    montantTTC,
  };
}

function parseOpeningHoursRange(horairesStr) {
  const fallback = { openHour: 8, openMin: 0, closeHour: 20, closeMin: 0 };
  if (!horairesStr || typeof horairesStr !== 'string') return fallback;
  const m = horairesStr.match(/(\d{1,2})\s*[:hH]\s*(\d{2})?\s*[-–àa]\s*(\d{1,2})\s*[:hH]\s*(\d{2})?/);
  if (!m) return fallback;
  const openHour = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const openMin = Math.min(59, Math.max(0, parseInt(m[2] || '0', 10)));
  const closeHour = Math.min(23, Math.max(0, parseInt(m[3], 10)));
  const closeMin = Math.min(59, Math.max(0, parseInt(m[4] || '0', 10)));
  if (closeHour < openHour || (closeHour === openHour && closeMin <= openMin)) {
    return fallback;
  }
  return { openHour, openMin, closeHour, closeMin };
}

/**
 * Calcule le timestamp UTC correspondant à l'heure de fermeture en Africa/Tunis (UTC+1 fixe)
 * pour le jour où a démarré la session.
 */
function getClosingTimestampTunis(horairesStr, refDateIso) {
  const refMs = refDateIso ? new Date(refDateIso).getTime() : Date.now();
  const baseDate = Number.isFinite(refMs) ? new Date(refMs) : new Date();
  // Africa/Tunis est UTC+1 toute l'année
  const tunisOffsetMs = 60 * 60 * 1000;
  const tunisLocal = new Date(baseDate.getTime() + tunisOffsetMs);
  const y = tunisLocal.getUTCFullYear();
  const m = tunisLocal.getUTCMonth();
  const d = tunisLocal.getUTCDate();
  const { closeHour, closeMin } = parseOpeningHoursRange(horairesStr);
  const utcCloseMs = Date.UTC(y, m, d, closeHour, closeMin, 0, 0) - tunisOffsetMs;
  return new Date(utcCloseMs).toISOString();
}

module.exports = {
  roundMillimes,
  computeWalkinBilling,
  computeOvertime15Min,
  parseOpeningHoursRange,
  getClosingTimestampTunis,
};
