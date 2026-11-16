// utils/dashboardPeriod.js — Périodes globales de dashboard (PowerBI & Stripe style)
// Fenêtres alignées avec le backend : jour / semaine / mois / trimestre / année / tout / personnalisé

export const PERIOD_OPTIONS = [
  { key: 'jour', label: 'Jour', icon: 'today', desc: "Aujourd'hui" },
  { key: 'semaine', label: 'Semaine', icon: 'date_range', desc: '7 derniers jours' },
  { key: 'mois', label: 'Mois', icon: 'calendar_month', desc: 'Ce mois-ci' },
  { key: 'trimestre', label: 'Trimestre', icon: 'view_timeline', desc: 'Ce trimestre (T4)' },
  { key: 'annee', label: 'Année', icon: 'calendar_today', desc: 'Cette année' },
  { key: 'tout', label: 'Tout', icon: 'all_inclusive', desc: "Tout l'historique" },
];

export const PRESET_SHORTCUTS = [
  { key: 'jour', label: "Aujourd'hui", icon: 'bolt', badge: 'En direct' },
  { key: 'jour:-1', label: 'Hier', icon: 'history', badge: 'J-1' },
  { key: 'semaine', label: '7 derniers jours', icon: 'date_range', badge: 'Semaine' },
  { key: 'semaine:-1', label: 'Semaine précédente', icon: 'skip_previous', badge: 'S-1' },
  { key: 'mois', label: 'Ce mois-ci', icon: 'calendar_month', badge: 'En cours' },
  { key: 'mois:-1', label: 'Mois dernier', icon: 'arrow_back', badge: 'M-1' },
  { key: 'trimestre', label: 'Ce trimestre', icon: 'view_timeline', badge: 'Trimestre' },
  { key: 'annee', label: 'Cette année', icon: 'calendar_today', badge: 'Année' },
  { key: 'annee:-1', label: 'Année dernière', icon: 'history_edu', badge: 'A-1' },
  { key: 'tout', label: "Tout l'historique", icon: 'all_inclusive', badge: 'Global' },
];

export const DEFAULT_PERIOD = 'mois';

export function parsePeriodKey(period) {
  if (!period) return { baseKey: 'mois', offset: 0 };
  if (typeof period === 'object') {
    if (period.from && period.to) {
      return { baseKey: 'custom', from: period.from, to: period.to };
    }
    return { baseKey: period.key || 'mois', offset: period.offset || 0 };
  }
  if (typeof period === 'string') {
    if (period.startsWith('custom:')) {
      const parts = period.split(':');
      return { baseKey: 'custom', from: parts[1], to: parts[2] };
    }
    if (period.includes(':')) {
      const parts = period.split(':');
      return { baseKey: parts[0], offset: parseInt(parts[1], 10) || 0 };
    }
    return { baseKey: period, offset: 0 };
  }
  return { baseKey: 'mois', offset: 0 };
}

export function periodWindow(period, now = new Date()) {
  const { baseKey, offset = 0, from: cFrom, to: cTo } = parsePeriodKey(period);

  if (baseKey === 'custom' && cFrom && cTo) {
    const fromJ = new Date(cFrom + (cFrom.length === 10 ? 'T00:00:00.000' : ''));
    const toJ = new Date(cTo + (cTo.length === 10 ? 'T23:59:59.999' : ''));
    if (!isNaN(fromJ) && !isNaN(toJ)) {
      const ms = Math.max(1, toJ.getTime() - fromJ.getTime());
      const days = ms / (1000 * 60 * 60 * 24);
      let bucket = 'day';
      if (days <= 2) bucket = 'hour';
      else if (days <= 62) bucket = 'day';
      else if (days <= 730) bucket = 'month';
      else bucket = 'year';
      return { key: 'custom', period: 'custom', from: fromJ.toISOString(), to: toJ.toISOString(), fromJ, toJ, ms, bucket };
    }
  }

  const targetDate = new Date(now);
  if (baseKey === 'jour') {
    targetDate.setDate(targetDate.getDate() + offset);
  } else if (baseKey === 'semaine') {
    targetDate.setDate(targetDate.getDate() + (offset * 7));
  } else if (baseKey === 'mois') {
    targetDate.setMonth(targetDate.getMonth() + offset);
  } else if (baseKey === 'trimestre') {
    targetDate.setMonth(targetDate.getMonth() + (offset * 3));
  } else if (baseKey === 'annee') {
    targetDate.setFullYear(targetDate.getFullYear() + offset);
  }

  const y = targetDate.getFullYear();
  const m = targetDate.getMonth();
  const d = targetDate.getDate();

  let fromJ, toJ, bucket;
  switch (baseKey) {
    case 'jour':
      fromJ = new Date(y, m, d, 0, 0, 0, 0);
      toJ = new Date(y, m, d, 23, 59, 59, 999);
      bucket = 'hour';
      break;
    case 'semaine':
      fromJ = new Date(y, m, d - 6, 0, 0, 0, 0);
      toJ = new Date(y, m, d, 23, 59, 59, 999);
      bucket = 'day';
      break;
    case 'trimestre':
      const qStart = Math.floor(m / 3) * 3;
      fromJ = new Date(y, qStart, 1, 0, 0, 0, 0);
      toJ = new Date(y, qStart + 3, 0, 23, 59, 59, 999);
      bucket = 'month';
      break;
    case 'annee':
      fromJ = new Date(y, 0, 1, 0, 0, 0, 0);
      toJ = new Date(y, 11, 31, 23, 59, 59, 999);
      bucket = 'month';
      break;
    case 'tout':
      fromJ = new Date(2020, 0, 1, 0, 0, 0, 0);
      toJ = new Date(y, m, d, 23, 59, 59, 999);
      bucket = 'year';
      break;
    case 'mois':
    default:
      fromJ = new Date(y, m, 1, 0, 0, 0, 0);
      toJ = new Date(y, m + 1, 0, 23, 59, 59, 999);
      bucket = 'day';
      break;
  }
  return {
    key: period,
    period: baseKey,
    offset,
    from: fromJ.toISOString(),
    to: toJ.toISOString(),
    fromJ,
    toJ,
    ms: Math.max(1, toJ.getTime() - fromJ.getTime()),
    bucket,
  };
}

export function inWindow(dateStr, win) {
  if (!dateStr || !win?.fromJ || !win?.toJ) return false;
  const d = new Date(dateStr);
  return d >= win.fromJ && d <= win.toJ;
}

export function windowLabel(period, now = new Date()) {
  const { baseKey, offset = 0, from: cFrom, to: cTo } = parsePeriodKey(period);

  if (baseKey === 'custom' && cFrom && cTo) {
    const f = new Date(cFrom);
    const t = new Date(cTo);
    return `Du ${f.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} au ${t.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }

  const targetDate = new Date(now);
  if (baseKey === 'jour') {
    targetDate.setDate(targetDate.getDate() + offset);
    if (offset === 0) return `Aujourd'hui (${targetDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })})`;
    if (offset === -1) return `Hier (${targetDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })})`;
    return targetDate.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  if (baseKey === 'semaine') {
    targetDate.setDate(targetDate.getDate() + (offset * 7));
    const start = new Date(targetDate);
    start.setDate(start.getDate() - 6);
    if (offset === 0) {
      return `7 derniers jours (${start.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} → ${targetDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })})`;
    }
    return `Semaine du ${start.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} au ${targetDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
  }

  if (baseKey === 'mois') {
    targetDate.setMonth(targetDate.getMonth() + offset);
    return targetDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  }

  if (baseKey === 'trimestre') {
    targetDate.setMonth(targetDate.getMonth() + (offset * 3));
    const qNum = Math.floor(targetDate.getMonth() / 3) + 1;
    return `T${qNum} ${targetDate.getFullYear()}`;
  }

  if (baseKey === 'annee') {
    targetDate.setFullYear(targetDate.getFullYear() + offset);
    return String(targetDate.getFullYear());
  }

  return 'Tout l’historique';
}

export function navigatePeriod(period, step = -1) {
  const { baseKey, offset = 0 } = parsePeriodKey(period);
  if (baseKey === 'tout' || baseKey === 'custom') return period;
  const nextOffset = offset + step;
  if (nextOffset === 0) return baseKey;
  return `${baseKey}:${nextOffset}`;
}

// Badge de tendance : "▲ +12% vs période préc."
export function trendBadge(cur, prev, unit = '') {
  const diff = cur - prev;
  if (diff > 0) return { text: `▲ +${diff.toLocaleString('fr-FR')}${unit} vs période préc.`, dir: 'up', value: diff };
  if (diff < 0) return { text: `▼ ${diff.toLocaleString('fr-FR')}${unit} vs période préc.`, dir: 'down', value: Math.abs(diff) };
  return { text: '→ Stable vs période préc.', dir: 'flat', value: 0 };
}

// Colonnes couleur cohérentes PowerBI
export const CHART_COLORS = ['#f95d00', '#2fbe8f', '#8b5cf6', '#f59e0b', '#0ea5e9', '#ec4899', '#14b8a6', '#6366f1'];
