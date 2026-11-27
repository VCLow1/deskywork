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
