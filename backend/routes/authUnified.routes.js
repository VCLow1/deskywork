// routes/authUnified.routes.js — Routes d'authentification unifiée Multi-rôles, Vérification Email & Onboarding
'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { otpRateLimiter } = require('../middleware/rateLimiter');
const ctrl = require('../controllers/authUnifiedController');

// ── Inscription Multi-Rôles Unifiée & Vérification Email ──────────────────────
router.post('/auth/register', otpRateLimiter, ctrl.registerUnified);
router.post('/auth/register-step1', otpRateLimiter, ctrl.registerStep1);
router.post('/auth/verify-email-otp', ctrl.verifyEmailOtp);
router.post('/auth/verify-email-token', ctrl.verifyEmailToken);
router.post('/auth/resend-verification-email', otpRateLimiter, ctrl.resendVerificationEmail);

// ── Google OAuth Status & Complétion Profil Post-Google ───────────────────────
router.post('/auth/oauth-status', authenticate, ctrl.checkOAuthStatus);
router.post('/auth/complete-oauth-registration', authenticate, ctrl.completeOAuthRegistration);

// CDC v3.0 — D2 : OTP SMS / WhatsApp reportés en phase 2. Seuls l'e-mail et l'in-app sont actifs.
const phase2Disabled = (_req, res) => res.status(410).json({
  error: 'La vérification par SMS / WhatsApp sera disponible en phase 2.',
  code: 'CHANNEL_DISABLED_PHASE2',
});
router.post('/auth/send-phone-otp', phase2Disabled);
router.post('/auth/verify-phone-otp', phase2Disabled);

// ── Étape 2 legacy & Onboardings ──────────────────────────────────────────────
router.post('/auth/onboarding/profile-type', ctrl.chooseProfileType);
router.post('/auth/onboarding/create-space', authenticate, ctrl.createSpaceOnboarding);
router.post('/auth/onboarding/trainer-profile', authenticate, ctrl.createTrainerProfile);

// ── Contexte Utilisateur (Multi-Organisations & Switcher) ─────────────────────
router.get('/auth/my-context', authenticate, ctrl.getMyContext);

module.exports = router;
