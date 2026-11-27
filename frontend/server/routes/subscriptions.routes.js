// routes/subscriptions.routes.js — Routes Abonnements Membres
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { requireRoles } = require('../middleware/requireRoles');
const { requirePermission } = require('../middleware/requirePermission');
const ctrl = require('../controllers/subscriptionsController');

// Routes membre
router.get('/subscriptions/me', authenticate, ctrl.getMySubscriptions);
router.get('/subscriptions/me/active', authenticate, ctrl.getMyActiveSubscription);
router.post('/subscriptions/self', authenticate, ctrl.subscribeSelf);

// Routes administration
router.post('/subscriptions', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.createSubscription);
router.patch('/subscriptions/:id', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.updateSubscription);
router.post('/subscriptions/:id/archive', authenticate, requirePermission('archivage_fusion_membres'), ctrl.archiveSubscription);
router.post('/subscriptions/:id/restore', authenticate, requirePermission('archivage_fusion_membres'), ctrl.restoreSubscription);
router.get('/subscriptions/:id/consumptions', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.getSubscriptionConsumptions);
router.get('/subscriptions', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.listSubscriptions);

module.exports = router;
