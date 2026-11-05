// routes/sessions.routes.js — Routes Sessions Check-In/Out & Politique d'Annulation
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { requireRoles } = require('../middleware/requireRoles');
const ctrl = require('../controllers/sessionsController');

// Politique d'annulation
router.get('/settings/cancellation-policy', authenticate, ctrl.getCancellationPolicyRoute);
router.patch('/settings/cancellation-policy', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.updateCancellationPolicyRoute);

// Sessions membres
router.get('/sessions/me', authenticate, ctrl.getMySessions);
router.get('/sessions/me/active', authenticate, ctrl.getMyActiveSessions);

// Check-in / Check-out
router.post('/sessions/check-in', authenticate, ctrl.checkIn);
router.post('/sessions/check-out', authenticate, ctrl.checkOut);

// Administration des sessions (Staff)
router.get('/sessions', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.listSessions);

module.exports = router;
