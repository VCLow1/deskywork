// utils/currency.js — Devise et formatage DT (Tunisian Dinar)
import { formatDT } from './format';

export function formatDTCompact(amount) {
  const n = Number(amount);
  const safe = Number.isFinite(n) ? n : 0;
  return `${safe.toLocaleString('fr-TN', { maximumFractionDigits: 3 })} DT`;
}

export { formatDT };
export const CURRENCY = 'DT';
export const CURRENCY_FULL = 'Dinar Tunisien';
export default formatDT;
