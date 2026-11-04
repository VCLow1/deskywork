// middleware/rateLimiter.js — Rate limiting léger en mémoire
'use strict';

const rateLimitBuckets = new Map();

/**
 * Middleware factory pour rate limiter en mémoire.
 * @param {Object} options
 * @param {number} options.windowMs - Durée de la fenêtre en ms
 * @param {number} options.max - Nombre maximal de requêtes autorisées
 * @param {string} options.message - Message d'erreur
 * @param {Function} options.keyGenerator - Fonction générant la clé (défaut : IP)
 */
function createRateLimiter({ windowMs, max, message, keyGenerator }) {
  // Nettoyage périodique toutes les 10 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitBuckets.entries()) {
      if (record.resetAt <= now) {
        rateLimitBuckets.delete(key);
      }
    }
  }, 10 * 60 * 1000).unref();

  return (req, res, next) => {
    const key = keyGenerator
      ? keyGenerator(req)
      : (req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown');

    const now = Date.now();
    let record = rateLimitBuckets.get(key);

    if (!record || record.resetAt <= now) {
      record = { count: 1, resetAt: now + windowMs };
      rateLimitBuckets.set(key, record);
      return next();
    }

    record.count += 1;

    if (record.count > max) {
      const retryAfterSec = Math.ceil((record.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfterSec);
      return res.status(429).json({
        error: message || `Trop de requêtes. Veuillez patienter ${retryAfterSec} secondes.`,
        retryAfter: retryAfterSec,
      });
    }

    next();
  };
}

// Limiteur pour les envois d'OTP (5 demandes / 10 min par email/téléphone/IP)
const otpRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 6,
  message: "Trop de tentatives d'envoi de code OTP. Veuillez patienter quelques minutes.",
  keyGenerator: (req) => {
    const ident = req.body?.email || req.body?.phone || req.ip;
    return `otp:${String(ident).toLowerCase().trim()}`;
  },
});

// Limiteur pour les invitations d'équipe (15 par heure par IP/organisation)
const inviteRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: "Limite d'invitations atteinte pour cette heure. Veuillez réessayer plus tard.",
  keyGenerator: (req) => {
    const orgId = req.params?.orgId || req.body?.organization_id || req.ip;
    return `invite:${orgId}`;
  },
});

// Limiteur pour les tentatives de login
const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 12,
  message: "Trop de tentatives de connexion. Veuillez patienter 15 minutes.",
  keyGenerator: (req) => {
    const email = req.body?.email || req.ip;
    return `login:${String(email).toLowerCase().trim()}`;
  },
});

module.exports = {
  createRateLimiter,
  otpRateLimiter,
  inviteRateLimiter,
  loginRateLimiter,
};

