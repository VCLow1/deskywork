// routes/floorPlans.routes.js — Plans de salle interactifs 2D & occupation temps réel
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { requireRoles } = require('../middleware/requireRoles');
const ctrl = require('../controllers/floorPlansController');

// Vue publique / client (disponibilité par date & créneau horaire Africa/Tunis)
router.get('/public/coworkings/:tenantId/floor-plans', ctrl.getPublicFloorPlans);
router.get('/public/coworkings/:tenantId/spaces-live', ctrl.getPublicSpacesLive);

// Occupation temps réel (Admin / Staff)
router.get('/floor-plans/live', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.getLiveFloorPlanStatus);
router.get('/floor-plans/:id/live', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.getLiveFloorPlanStatus);

// CRUD Plans interactifs 2D (Gérant / Staff)
router.get('/floor-plans', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.listFloorPlans);
router.post('/floor-plans', authenticate, requireRoles('super_admin', 'admin'), ctrl.createFloorPlan);
router.put('/floor-plans/:id', authenticate, requireRoles('super_admin', 'admin'), ctrl.updateFloorPlan);
router.patch('/floor-plans/:id/items/:itemId/status', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.toggleItemMaintenance);
router.delete('/floor-plans/:id', authenticate, requireRoles('super_admin', 'admin'), ctrl.deleteFloorPlan);

module.exports = router;

