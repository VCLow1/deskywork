// utils/format.js — Formats transverses DeskyWork
//  • Devise : Dinar Tunisien (DT) à 3 décimales, virgule décimale, espace insécable pour les milliers
//  • Fuseau horaire : Africa/Tunis (jj/mm/aaaa, 24h)

export const TUNIS_TZ = 'Africa/Tunis';
export const NBSP = '\u00A0';

/**
 * Formate un montant en Dinar Tunisien au format tunisien strict :
 * Ex : 101 → « 101,000 DT », 101000 → « 101 000,000 DT ».
 * Jamais de point comme séparateur de milliers.
 * @param {number|string|null|undefined} amount
 * @param {{suffix?: boolean, showTaxType?: 'HT'|'TTC'|null}} [opts]
 */
export function formatDT(amount, { suffix = true, showTaxType = null } = {}) {
  const n = Number(amount);
  const safe = Number.isFinite(n) ? n : 0;
  const rounded = Math.round(safe * 1000) / 1000;
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded);
  const fixed = abs.toFixed(3);
  const [intPart, decPart] = fixed.split('.');
  const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const formatted = `${sign}${groupedInt},${decPart}`;
  if (!suffix) return formatted;
  const taxSuffix = showTaxType === 'HT' || showTaxType === 'TTC' ? ` ${showTaxType}` : '';
  return `${formatted} DT${taxSuffix}`;
}

/**
 * Formate un montant ou retourne `zeroLabel` ("Gratuit" / "Inclus") si le prix est <= 0.
 * Jamais de "0,000 DT / heure".
 */
export function formatPriceOrFree(amount, { zeroLabel = 'Gratuit', suffix = true, showTaxType = null, unit = '' } = {}) {
  const n = Number(amount);
  const safe = Number.isFinite(n) ? n : 0;
  if (Math.abs(safe) < 0.0005 && zeroLabel) {
    return zeroLabel;
  }
  const base = formatDT(safe, { suffix, showTaxType });
  return unit ? `${base} ${unit}` : base;
}

const AVATAR_PALETTE = [
  '#f95d00',
  '#c2410c',
  '#0f766e',
  '#b45309',
  '#7c2d12',
  '#4d7c0f',
  '#9a3412',
  '#374151',
];

/** Couleur d'avatar déterministe sans bleu hors-charte. */
export function getStableAvatarColor(seed) {
  const str = String(seed || 'deskywork');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

/** Parse une chaîne d'horaires ("08:00 - 20:00") -> { openHour, openMin, closeHour, closeMin }. */
export function parseOpeningHours(horairesStr) {
  const fallback = { openHour: 8, openMin: 0, closeHour: 20, closeMin: 0 };
  if (!horairesStr || typeof horairesStr !== 'string') return fallback;
  const m = horairesStr.match(/(\d{1,2})\s*[:hH]\s*(\d{2})?\s*[-–àa]\s*(\d{1,2})\s*[:hH]\s*(\d{2})?/);
  if (!m) return fallback;
  const openHour = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const openMin = Math.min(59, Math.max(0, parseInt(m[2] || '0', 10)));
  const closeHour = Math.min(23, Math.max(0, parseInt(m[3], 10)));
  const closeMin = Math.min(59, Math.max(0, parseInt(m[4] || '0', 10)));
  if (closeHour < openHour || (closeHour === openHour && closeMin <= openMin)) return fallback;
  return { openHour, openMin, closeHour, closeMin };
}

/**
 * Calcule le créneau « Maintenant » en Africa/Tunis arrondi au prochain quart d'heure (:00/:15/:30/:45),
 * borné aux horaires d'ouverture et avec une durée minimale.
 */
export function getNextQuarterHourTunis({
  nowMs = Date.now(),
  horaires = '08:00 - 20:00',
  durationMinutes = 60,
} = {}) {
  const { openHour, openMin, closeHour, closeMin } = parseOpeningHours(horaires);
  const { hour, minute } = getTunisHourMinute(nowMs);
  const totalMinNow = hour * 60 + minute;
  const roundedStartMin = Math.ceil((totalMinNow + 1) / 15) * 15;
  const openTotal = openHour * 60 + openMin;
  const closeTotal = closeHour * 60 + closeMin;
  const minDur = Math.max(15, Number(durationMinutes) || 60);

  let date = getTunisDateKey(nowMs);
  let startMin = Math.max(openTotal, roundedStartMin);
  if (startMin + minDur > closeTotal) {
    // Trop tard aujourd'hui : proposer dès l'ouverture demain
    date = getTunisDateKey(nowMs + 24 * 3600 * 1000);
    startMin = openTotal;
  }
  const endMin = Math.min(closeTotal, startMin + minDur);
  const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return {
    date,
    start: toHHMM(startMin),
    end: toHHMM(endMin),
  };
}

/** Génère le contenu d'un fichier calendrier RFC 5545 (.ics) pour une réservation confirmée/enregistrée. */
export function generateBookingIcs({
  id,
  title,
  spaceName = 'Espace DeskyWork',
  unitLabel = '',
  coworkingName = 'DeskyWork',
  address = '',
  dateDebut,
  dateFin,
  statusLabel = 'Confirmée',
} = {}) {
  const toIcsUtc = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  };
  const escapeIcs = (str) => String(str || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const summary = title || `${spaceName}${unitLabel ? ` (${unitLabel})` : ''} — ${coworkingName}`;
  const location = [coworkingName, address].filter(Boolean).join(', ');
  const description = `Réservation DeskyWork\\nEspace : ${spaceName}${unitLabel ? ` (${unitLabel})` : ''}\\nStatut : ${statusLabel}\\nRèglement sur place à l'accueil.`;

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DeskyWork//Reservation//FR',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${id || `dw-${Date.now()}`}@deskywork.tn`,
    `DTSTAMP:${toIcsUtc(new Date().toISOString())}`,
    `DTSTART:${toIcsUtc(dateDebut)}`,
    `DTEND:${toIcsUtc(dateFin)}`,
    `SUMMARY:${escapeIcs(summary)}`,
    `LOCATION:${escapeIcs(location)}`,
    `DESCRIPTION:${description}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

export function downloadBookingIcs(bookingInfo) {
  const content = generateBookingIcs(bookingInfo);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `deskywork-reservation-${(bookingInfo?.id || 'creneau').slice(0, 8)}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Date stricte jj/mm/aaaa au fuseau Africa/Tunis. */
export function formatDateDMY(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: TUNIS_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

/** Heure stricte 24h (HH:mm) au fuseau Africa/Tunis. */
export function formatTime24h(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: TUNIS_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** Heure stricte 24h avec secondes (HH:mm:ss) au fuseau Africa/Tunis. */
export function formatTimeHMS(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: TUNIS_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
}

/** Date + heure strictes jj/mm/aaaa HH:mm au fuseau Africa/Tunis. */
export function formatDateTimeDMY(value) {
  if (!value) return '—';
  return `${formatDateDMY(value)} ${formatTime24h(value)}`;
}

/** Clé jour YYYY-MM-DD au fuseau Africa/Tunis (pour comparaisons calendrier fiables). */
export function getTunisDateKey(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TUNIS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Heures & minutes numériques au fuseau Africa/Tunis. */
export function getTunisHourMinute(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return { hour: 0, minute: 0 };
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TUNIS_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return { hour: hour === 24 ? 0 : hour, minute };
}

/** Date + heure au fuseau Africa/Tunis (jj/mm/aaaa HH:mm, 24h). */
export function formatDateTimeTunis(value) {
  return formatDateTimeDMY(value);
}

/** Heure seule 24h au fuseau Africa/Tunis. */
export function formatTimeTunis(value) {
  return formatTime24h(value);
}

/** Date seule jj/mm/aaaa au fuseau Africa/Tunis. */
export function formatDateTunis(value) {
  return formatDateDMY(value);
}

/**
 * Calcule le delta KPI sans jamais produire de division par zéro ou "+100%".
 * Si previous <= 0 : retourne "Nouveau" si current > 0, sinon "-".
 */
export function formatKpiDelta(current, previous) {
  const cur = Number(current || 0);
  const prev = Number(previous || 0);
  if (!Number.isFinite(prev) || prev <= 0) {
    if (Number.isFinite(cur) && cur > 0) {
      return { text: 'Nouveau', dir: 'new', pct: null };
    }
    return { text: '-', dir: 'flat', pct: null };
  }
  const pct = Math.round(((cur - prev) / prev) * 100);
  return {
    text: `${pct > 0 ? '+' : ''}${pct}%`,
    dir: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat',
    pct,
  };
}

/**
 * Génère dynamiquement le message de politique d'annulation à partir du paramètre de l'établissement.
 */
export function buildCancellationPolicyMessage({
  delai_annulation_gratuite,
  delai_heures,
  penalite_pct = 0,
  annulation_membre_autorisee = true,
} = {}) {
  if (annulation_membre_autorisee === false) {
    return "Les annulations en ligne sont désactivées. Contactez l'accueil de l'établissement.";
  }
  const h = Math.max(0, Number(delai_annulation_gratuite ?? delai_heures ?? 24));
  const pen = Number(penalite_pct || 0);
  const base = `Annulation gratuite jusqu'à ${h} heure${h > 1 ? 's' : ''} avant le début de la réservation.`;
  if (pen > 0) {
    return `${base} Passé ce délai, une pénalité de ${pen}% s'applique.`;
  }
  return base;
}

/**
 * Convertit une valeur <input type="datetime-local"> (« YYYY-MM-DDTHH:mm ») exprimée à l'heure de Tunis
 * en ISO UTC. La Tunisie est en UTC+01:00 toute l'année (pas d'heure d'été).
 */
export function tunisLocalToISO(value) {
  if (!value) return null;
  const v = value.length === 16 ? `${value}:00` : value;
  return new Date(`${v}+01:00`).toISOString();
}
