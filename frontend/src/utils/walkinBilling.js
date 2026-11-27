// utils/walkinBilling.js — Calcul pur Facturation Walk-in & Dépassement 15 min (LOT 3)

export function roundMillimes(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 1000) / 1000;
}

export function computeWalkinBilling({
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
  const billedSlices = Math.max(4, rawSlices);
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

export function computeOvertime15Min({
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
