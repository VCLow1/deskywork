// services/api/_core.js — Client HTTP partagé (fetch + auth JWT + Cache SWR ultra-rapide)
import { supabase } from '../../supabaseClient';

export const API_URL = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' && window.location.hostname !== 'localhost' ? window.location.origin : 'http://localhost:5000');

const SESSION_EXPIRED_MESSAGE = 'Session expirée. Veuillez vous reconnecter.';

// ── Cache mémoire pour les requêtes GET (SWR) ───────────────────────────────
const apiCache = new Map();
const inFlightRequests = new Map();
const DEFAULT_TTL_MS = 30_000; // 30 secondes de cache frais

// ── Cache token JWT en mémoire pour éviter le lock localStorage ─────────────
let cachedAccessToken = null;
let tokenExpiresAt = 0;

// Écouter les changements d'authentification pour réinitialiser le cache si besoin
supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.access_token) {
    cachedAccessToken = session.access_token;
    tokenExpiresAt = session.expires_at ? session.expires_at * 1000 : Date.now() + 3600_000;
  } else {
    cachedAccessToken = null;
    tokenExpiresAt = 0;
    apiCache.clear();
  }
});

export function invalidateApiCache(prefix = '') {
  if (!prefix) {
    apiCache.clear();
    return;
  }
  for (const key of apiCache.keys()) {
    if (key.includes(prefix)) {
      apiCache.delete(key);
    }
  }
}

function isAuthError(status, message = '') {
  return status === 401
    || message.includes('JWT')
    || message.includes('Token JWT')
    || message.includes('Session expirée');
}

export async function getAccessToken() {
  const now = Date.now();
  // Utiliser le token en mémoire s'il est valide encore au moins 60 secondes
  if (cachedAccessToken && tokenExpiresAt - now > 60_000) {
    return cachedAccessToken;
  }

  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token) throw new Error(SESSION_EXPIRED_MESSAGE);

  const expiresAtMs = (session.expires_at ?? 0) * 1000;

  if (expiresAtMs - now <= 60_000) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshed.session?.access_token) throw new Error(SESSION_EXPIRED_MESSAGE);
    cachedAccessToken = refreshed.session.access_token;
    tokenExpiresAt = (refreshed.session.expires_at ?? 0) * 1000;
    return cachedAccessToken;
  }

  cachedAccessToken = session.access_token;
  tokenExpiresAt = expiresAtMs;
  return cachedAccessToken;
}

export async function getAuthHeaders() {
  const token = await getAccessToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function apiFetch(path, options = {}, retried = false) {
  const method = (options.method || 'GET').toUpperCase();
  const isGet = method === 'GET';
  const cacheKey = `${method}:${path}`;
  const ttl = options.ttl ?? DEFAULT_TTL_MS;
  const bypassCache = options.noCache === true;

  // 1. Pour les requêtes GET : vérifier le cache mémoire
  if (isGet && !bypassCache && !retried) {
    const cached = apiCache.get(cacheKey);
    const now = Date.now();
    if (cached) {
      // Données fraîches dans le TTL -> retour immédiat (0 ms)
      if (now - cached.timestamp < ttl) {
        return cached.data;
      }
      // Données légèrement périmées -> rafraîchissement SWR en arrière-plan sans bloquer
      if (now - cached.timestamp < ttl * 4) {
        // Déclencher un refresh silencieux en arrière-plan
        refreshInBackground(path, options, cacheKey);
        return cached.data;
      }
    }

    // Déduplication : si une requête identique est déjà en cours, partager sa promesse
    if (inFlightRequests.has(cacheKey)) {
      return inFlightRequests.get(cacheKey);
    }
  }

  // 2. Pour les mutations (POST, PUT, PATCH, DELETE) : invalider le cache associé
  if (!isGet) {
    // Invalider les chemins racines liés (ex: /api/super-admin, /api/admin, /api/members)
    const baseSegment = path.split('?')[0].split('/').slice(0, 3).join('/');
    invalidateApiCache(baseSegment);
  }

  const fetchPromise = (async () => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers: { ...headers, ...options.headers },
      });

      const body = await response.json().catch(() => ({}));

      if (response.status === 401 && !retried) {
        const { data: refreshed, error } = await supabase.auth.refreshSession();
        if (!error && refreshed.session?.access_token) {
          cachedAccessToken = refreshed.session.access_token;
          tokenExpiresAt = (refreshed.session.expires_at ?? 0) * 1000;
          return apiFetch(path, options, true);
        }
        throw new Error(SESSION_EXPIRED_MESSAGE);
      }

      if (!response.ok) {
        const rawErr = body?.error;
        const parsedErr =
          typeof rawErr === 'string' && rawErr.trim() && rawErr.trim() !== '{}'
            ? rawErr.trim()
            : typeof rawErr === 'object' && rawErr !== null
              ? (rawErr.message || (Object.keys(rawErr).length > 0 ? JSON.stringify(rawErr) : ''))
              : '';
        const message = parsedErr || body?.message || `Erreur API (${response.status})`;
        if (isAuthError(response.status, message)) throw new Error(SESSION_EXPIRED_MESSAGE);
        const err = new Error(message);
        err.status = response.status;
        err.body = body;
        throw err;
      }

      // Mettre en cache si GET
      if (isGet) {
        apiCache.set(cacheKey, { data: body, timestamp: Date.now() });
      }

      return body;
    } finally {
      if (isGet) {
        inFlightRequests.delete(cacheKey);
      }
    }
  })();

  if (isGet && !bypassCache) {
    inFlightRequests.set(cacheKey, fetchPromise);
  }

  return fetchPromise;
}

// Rafraîchissement silencieux SWR en arrière-plan
async function refreshInBackground(path, options, cacheKey) {
  if (inFlightRequests.has(cacheKey)) return;
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: { ...headers, ...options.headers },
    });
    if (response.ok) {
      const body = await response.json().catch(() => null);
      if (body) {
        apiCache.set(cacheKey, { data: body, timestamp: Date.now() });
      }
    }
  } catch (_) {
    // Ignorer silencieusement les erreurs d'arrière-plan
  }
}
