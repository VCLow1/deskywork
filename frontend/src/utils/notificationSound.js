// utils/notificationSound.js — Moteur audio Web Audio API & notifications bureau (DeskyWork)

const SOUND_STORAGE_KEY = 'deskywork_notif_sound';
let sharedAudioCtx = null;
let unlockBound = false;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioCtx();
  }
  return sharedAudioCtx;
}

export function isNotificationSoundEnabled() {
  try {
    return localStorage.getItem(SOUND_STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setNotificationSoundEnabled(enabled) {
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // ignore storage errors
  }
  return enabled;
}

export function toggleNotificationSound() {
  const next = !isNotificationSoundEnabled();
  setNotificationSoundEnabled(next);
  return next;
}

export function initAudioUnlock() {
  if (typeof window === 'undefined' || unlockBound) return;
  unlockBound = true;

  const unlock = () => {
    try {
      const ctx = getAudioContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    } catch {
      // ignore
    }
  };

  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
  window.addEventListener('touchstart', unlock, { passive: true });
}

function playTone(ctx, freq, startOffset, duration, volume = 0.14, wave = 'sine') {
  const now = ctx.currentTime + startOffset;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(freq, now);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

/**
 * Joue un carillon synthétisé adapté au type de notification.
 * @param {string} [type]
 * @param {{force?: boolean}} [opts]
 */
export async function playNotificationSound(type = '', { force = false } = {}) {
  if (!force && !isNotificationSoundEnabled()) return false;
  try {
    const ctx = getAudioContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    const norm = String(type || '').toLowerCase();

    if (norm.includes('paiement') || norm.includes('payment') || norm.includes('facture')) {
      // Accord positif E5 -> G#5 -> B5
      playTone(ctx, 659.25, 0.0, 0.16, 0.13, 'triangle');
      playTone(ctx, 830.61, 0.09, 0.18, 0.14, 'triangle');
      playTone(ctx, 987.77, 0.18, 0.28, 0.15, 'sine');
    } else if (
      norm.includes('warning') ||
      norm.includes('overtime') ||
      norm.includes('depassement') ||
      norm.includes('refus') ||
      norm.includes('annul')
    ) {
      // Alerte douce A5 -> F#5
      playTone(ctx, 880.0, 0.0, 0.15, 0.14, 'triangle');
      playTone(ctx, 739.99, 0.16, 0.24, 0.13, 'triangle');
    } else {
      // Carillon cristallin C6 -> E6
      playTone(ctx, 1046.5, 0.0, 0.16, 0.14, 'sine');
      playTone(ctx, 1318.51, 0.11, 0.28, 0.15, 'sine');
    }
    return true;
  } catch {
    return false;
  }
}

export async function requestBrowserNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  try {
    if (window.Notification.permission === 'default') {
      return await window.Notification.requestPermission();
    }
    return window.Notification.permission;
  } catch {
    return 'denied';
  }
}

export function showBrowserNotification(notification, onClick) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (window.Notification.permission !== 'granted') return;
  if (typeof document !== 'undefined' && !document.hidden) return;
  try {
    const title = notification?.title || 'DeskyWork — Nouvelle notification';
    const body = notification?.message || 'Vous avez reçu une nouvelle alerte.';
    const instance = new window.Notification(title, {
      body,
      tag: notification?.id ? `dw-notif-${notification.id}` : undefined,
      silent: true, // Le son est géré par Web Audio API
    });
    instance.onclick = () => {
      try {
        window.focus();
      } catch {
        // ignore
      }
      instance.close();
      onClick?.(notification);
    };
    setTimeout(() => instance.close(), 7000);
  } catch {
    // ignore browser notification failures
  }
}
