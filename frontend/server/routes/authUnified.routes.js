// routes/authUnified.routes.js — Routes d'authentification unifiée, OTP et Onboarding
'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { otpRateLimiter, loginRateLimiter } = require('../middleware/rateLimiter');
const ctrl = require('../controllers/authUnifiedController');

// ── Inscription Étape 1 & Vérification Email ─────────────────────────────────
router.post('/auth/register-step1', otpRateLimiter, ctrl.registerStep1);
router.post('/auth/verify-email-otp', ctrl.verifyEmailOtp);

// ── Vérification Téléphone (SMS / WhatsApp) ──────────────────────────────────
router.post('/auth/send-phone-otp', otpRateLimiter, ctrl.sendPhoneOtp);
router.post('/auth/verify-phone-otp', ctrl.verifyPhoneOtp);

// ── Étape 2 : "Vous êtes… ?" & Onboardings ───────────────────────────────────
router.post('/auth/onboarding/profile-type', ctrl.chooseProfileType);
router.post('/auth/onboarding/create-space', authenticate, ctrl.createSpaceOnboarding);
router.post('/auth/onboarding/trainer-profile', authenticate, ctrl.createTrainerProfile);

// ── Contexte Utilisateur (Multi-Organisations & Switcher) ─────────────────────
router.get('/auth/my-context', authenticate, ctrl.getMyContext);

module.exports = router;

