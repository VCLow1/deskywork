// utils/tunisianPhone.js — Validateur et masque strict pour téléphone tunisien (+216 + 8 chiffres)

const INVALID_PHONE_MSG =
  'Numéro invalide : saisissez +216 suivi de 8 chiffres (ex. +216 20 123 456).';

/** Extrait les 8 chiffres locaux après suppression de +216 / 00216 / 216 si présent. */
export function extractTunisianLocalDigits(raw) {
  const digitsOnly = String(raw || '').replace(/\D/g, '');
  if (!digitsOnly) return '';
  if (digitsOnly.startsWith('00216') && digitsOnly.length > 5) {
    return digitsOnly.slice(5, 13);
  }
  if (digitsOnly.startsWith('216') && digitsOnly.length > 3) {
    return digitsOnly.slice(3, 11);
  }
  return digitsOnly.slice(0, 8);
}

/**
 * Normalise un numéro tunisien vers « +216XXXXXXXX » (strictement +216 + 8 chiffres).
 * Retourne null si la valeur est vide ou invalide.
 */
export function normalizeTunisianPhone(raw) {
  const local = extractTunisianLocalDigits(raw);
  if (!/^\d{8}$/.test(local)) return null;
  return `+216${local}`;
}

/**
 * Formate pour affichage/masque : « +216 XX XXX XXX »
 */
export function formatTunisianPhone(raw) {
  const str = String(raw || '').trim();
  if (!str) return '';
  const local = extractTunisianLocalDigits(str);
  if (!local) return str.startsWith('+216') ? '+216 ' : '';
  const p1 = local.slice(0, 2);
  const p2 = local.slice(2, 5);
  const p3 = local.slice(5, 8);
  return ['+216', p1, p2, p3].filter(Boolean).join(' ');
}

/**
 * Valide un numéro de téléphone tunisien.
 * Retourne { valid, normalized, error }.
 */
export function validateTunisianPhone(raw, { required = false } = {}) {
  const trimmed = String(raw || '').trim();
  if (!trimmed || trimmed === '+216') {
    if (required) {
      return { valid: false, normalized: null, error: 'Le numéro de téléphone (+216 + 8 chiffres) est obligatoire.' };
    }
    return { valid: true, normalized: '', error: '' };
  }
  const normalized = normalizeTunisianPhone(trimmed);
  if (!normalized) {
    return { valid: false, normalized: null, error: INVALID_PHONE_MSG };
  }
  return { valid: true, normalized, error: '' };
}
