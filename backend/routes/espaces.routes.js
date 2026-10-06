// routes/espaces.routes.js — Routes Espaces & Configuration Coworking
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { requireRoles } = require('../middleware/requireRoles');
const ctrl = require('../controllers/espacesController');

// Routes publiques/membres (lister les espaces et les coworkings)
router.get('/tenants', authenticate, ctrl.listTenants);
router.get('/espaces/formation', authenticate, ctrl.listEspacesFormation);
router.get('/espaces', authenticate, ctrl.listEspaces);

// Routes administration du tenant (Admin / Staff)
router.get('/admin/tenant', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.getAdminTenant);
router.patch('/admin/tenant', authenticate, requireRoles('super_admin', 'admin'), ctrl.updateAdminTenant);

// Gestion des espaces par l'admin
router.post('/admin/espaces', authenticate, requireRoles('super_admin', 'admin'), ctrl.createAdminEspace);
router.patch('/admin/espaces/:id', authenticate, requireRoles('super_admin', 'admin'), ctrl.updateAdminEspace);
router.delete('/admin/espaces/:id', authenticate, requireRoles('super_admin', 'admin'), ctrl.deleteAdminEspace);

// Onboarding admin
router.post('/admin/onboarding/complete', authenticate, requireRoles('super_admin', 'admin'), ctrl.completeOnboarding);

module.exports = router;
