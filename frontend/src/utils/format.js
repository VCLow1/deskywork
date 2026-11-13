// utils/format.js — Formats transverses (CDC v3.0 D7)
//  • Devise : Dinar Tunisien (DT) avec 3 décimales (millimes)
//  • Fuseau horaire : Africa/Tunis

export const TUNIS_TZ = 'Africa/Tunis';

/**
 * Formate un montant en Dinar Tunisien avec 3 décimales. Ex : 90 → « 90,000 DT ».
 * @param {number|string|null|undefined} amount
 * @param {{suffix?: boolean}} [opts]
 */
export function formatDT(amount, { suffix = true } = {}) {
  const n = Number(amount);
  const safe = Number.isFinite(n) ? n : 0;
  const txt = new Intl.NumberFormat('fr-TN', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(safe);
  return suffix ? `${txt} DT` : txt;
}

/** Date + heure au fuseau Africa/Tunis. */
export function formatDateTimeTunis(value, opts = {}) {
  if (!value) return '—';
  return new Date(value).toLocaleString('fr-FR', {
    timeZone: TUNIS_TZ,
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    ...opts,
  });
}

/** Heure seule au fuseau Africa/Tunis. */
export function formatTimeTunis(value) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('fr-FR', { timeZone: TUNIS_TZ, hour: '2-digit', minute: '2-digit' });
}

/** Date seule (ex. « 12 novembre 2026 ») au fuseau Africa/Tunis. */
export function formatDateTunis(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('fr-FR', { timeZone: TUNIS_TZ, day: '2-digit', month: 'long', year: 'numeric' });
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
