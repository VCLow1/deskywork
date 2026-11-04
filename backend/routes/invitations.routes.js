// routes/invitations.routes.js — Routes des invitations d'équipe
'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { inviteRateLimiter } = require('../middleware/rateLimiter');
const ctrl = require('../controllers/invitationsController');

// ── Gestion des invitations par l'organisation ──────────────────────────────
router.post('/organizations/:orgId/invitations', authenticate, inviteRateLimiter, ctrl.createInvitation);
router.get('/organizations/:orgId/invitations', authenticate, ctrl.listInvitations);
router.delete('/invitations/:id', authenticate, ctrl.revokeInvitation);

// ── Parcours de l'invité ─────────────────────────────────────────────────────
router.get('/invitations/info/:token', ctrl.getInvitationInfo);
router.post('/invitations/accept/:token', authenticate, ctrl.acceptInvitation);

module.exports = router;

