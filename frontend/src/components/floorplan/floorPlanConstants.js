// components/floorplan/floorPlanConstants.js — Constantes, palettes Dark/Light & helpers temps réel (Africa/Tunis)
import { TUNIS_TZ } from '../../utils/format';

export const ITEM_TYPES = [
  {
    value: 'desk',
    label: 'Poste nomade (Desk)',
    shortLabel: 'Poste',
    icon: 'desk',
    defaultW: 80,
    defaultH: 56,
    prefix: 'A',
    suggestedSpaceTypes: ['open_space', 'hot_desk', 'dedicated_desk'],
  },
  {
    value: 'quiet_desk',
    label: 'Quiet Desk (Zone calme)',
    shortLabel: 'Quiet Desk',
    icon: 'headphones',
    defaultW: 84,
    defaultH: 60,
    prefix: 'Q',
    suggestedSpaceTypes: ['open_space', 'hot_desk', 'dedicated_desk'],
  },
  {
    value: 'private_office',
    label: 'Bureau privé',
    shortLabel: 'Bureau privé',
    icon: 'meeting_room',
    defaultW: 260,
    defaultH: 200,
    prefix: 'B',
    suggestedSpaceTypes: ['private_office'],
  },
  {
    value: 'meeting_room',
    label: 'Salle de réunion',
    shortLabel: 'Salle réunion',
    icon: 'groups',
    defaultW: 280,
    defaultH: 220,
    prefix: 'SR',
    suggestedSpaceTypes: ['meeting_room'],
  },
  {
    value: 'training_room',
    label: 'Salle de formation',
    shortLabel: 'Salle formation',
    icon: 'school',
    defaultW: 300,
    defaultH: 240,
    prefix: 'SF',
    suggestedSpaceTypes: ['training_room'],
  },
  {
    value: 'event_space',
    label: 'Espace événementiel',
    shortLabel: 'Événementiel',
    icon: 'celebration',
    defaultW: 340,
    defaultH: 240,
    prefix: 'EV',
    suggestedSpaceTypes: ['event_space'],
  },
];

export const STRUCTURE_TYPES = [
  { value: 'wall', label: 'Mur', icon: 'horizontal_rule', defaultW: 220, defaultH: 12 },
  { value: 'partition', label: 'Cloison vitrée', icon: 'border_vertical', defaultW: 180, defaultH: 8 },
  { value: 'door', label: 'Porte', icon: 'door_open', defaultW: 80, defaultH: 40 },
  { value: 'zone', label: 'Zone décorative', icon: 'crop_free', defaultW: 280, defaultH: 200 },
];

export function getItemTypeMeta(type) {
  return ITEM_TYPES.find((t) => t.value === type) || ITEM_TYPES[0];
}

export function getFloorPlanPalette(dark = false) {
  return {
    canvasBg: dark ? '#161513' : '#f8fafc',
    boardBg: dark ? '#1e1c1a' : '#ffffff',
    gridStroke: dark ? 'rgba(255,255,255,0.055)' : 'rgba(15,23,42,0.055)',
    wallFill: dark ? '#94a3b8' : '#1e293b',
    partitionFill: dark ? '#64748b' : '#94a3b8',
    doorStroke: dark ? '#fb923c' : '#f95d00',
    zoneFill: dark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.025)',
    zoneStroke: dark ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.12)',
    zoneText: dark ? 'rgba(255,255,255,0.45)' : 'rgba(51,65,85,0.65)',
    textPrimary: dark ? '#f8fafc' : '#0f172a',
    textMuted: dark ? '#94a3b8' : '#64748b',
    unlinked: {
      fill: dark ? '#2a2724' : '#f1f5f9',
      stroke: dark ? '#57534e' : '#94a3b8',
      text: dark ? '#d6d3d1' : '#475569',
      dot: '#94a3b8',
    },
    statuses: {
      free: {
        label: 'Libre',
        fill: dark ? 'rgba(16, 185, 129, 0.16)' : '#ecfdf5',
        stroke: dark ? '#34d399' : '#0d9488',
        text: dark ? '#d1fae5' : '#065f46',
        dot: '#10b981',
        furniture: dark ? 'rgba(52, 211, 153, 0.35)' : 'rgba(13, 148, 136, 0.25)',
      },
      occupied: {
        label: 'Occupé',
        fill: dark ? 'rgba(239, 68, 68, 0.16)' : '#f1f5f9',
        stroke: dark ? '#f87171' : '#dc2626',
        text: dark ? '#fecaca' : '#991b1b',
        dot: '#ef4444',
        furniture: dark ? 'rgba(248, 113, 113, 0.32)' : 'rgba(220, 38, 38, 0.22)',
      },
      ending_soon: {
        label: 'Bientôt terminée (-15 min)',
        fill: dark ? 'rgba(249, 115, 22, 0.22)' : '#fff7ed',
        stroke: '#f97316',
        text: dark ? '#fed7aa' : '#9a3412',
        dot: '#f97316',
        furniture: dark ? 'rgba(251, 146, 60, 0.38)' : 'rgba(249, 115, 22, 0.28)',
      },
      overtime: {
        label: 'En dépassement',
        fill: dark ? 'rgba(234, 88, 12, 0.30)' : '#ffedd5',
        stroke: '#ea580c',
        text: dark ? '#ffedd5' : '#7c2d12',
        dot: '#ea580c',
        furniture: dark ? 'rgba(249, 115, 22, 0.45)' : 'rgba(234, 88, 12, 0.32)',
      },
      maintenance: {
        label: 'En maintenance',
        fill: dark ? 'url(#fp-hatch-dark)' : 'url(#fp-hatch-light)',
        stroke: dark ? '#78716c' : '#64748b',
        text: dark ? '#d6d3d1' : '#334155',
        dot: '#64748b',
        furniture: dark ? 'rgba(148, 163, 184, 0.25)' : 'rgba(100, 116, 139, 0.22)',
      },
    },
  };
}

export function formatCountdown(totalSeconds, isOvertime = false) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  const core = h > 0 ? `${pad(h)}h ${pad(m)}m ${pad(sec)}s` : `${pad(m)}m ${pad(sec)}s`;
  return isOvertime ? `+${core}` : core;
}

export function getTodayTunisDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TUNIS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function getCurrentTunisHourMinute() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TUNIS_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

export function getDefaultTunisSlot() {
  const date = getTodayTunisDate();
  const hhmm = getCurrentTunisHourMinute();
  const [hStr] = hhmm.split(':');
  const h = parseInt(hStr, 10) || 9;
  if (h >= 18) {
    const tmr = new Date(`${date}T12:00:00+01:00`);
    tmr.setDate(tmr.getDate() + 1);
    return {
      date: tmr.toISOString().slice(0, 10),
      start: '09:00',
      end: '13:00',
    };
  }
  const startH = Math.max(8, h + 1);
  const endH = Math.min(20, startH + 3);
  return {
    date,
    start: `${String(startH).padStart(2, '0')}:00`,
    end: `${String(endH).padStart(2, '0')}:00`,
  };
}
