// routes/superAdmin.routes.js — Routes Super Admin VCLOW
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { requireSuperAdmin } = require('../middleware/guards');
const ctrl = require('../controllers/superAdminController');

// Rapport intelligent (IA embarquée) — Super Admin
router.get('/super-admin/report', authenticate, requireSuperAdmin, require('../controllers/reportController').getSuperAdminReport);

// Tenants
router.get('/super-admin/tenants', authenticate, requireSuperAdmin, ctrl.listTenants);
router.get('/super-admin/tenants/:id', authenticate, requireSuperAdmin, ctrl.getTenant);
router.post('/super-admin/tenants', authenticate, requireSuperAdmin, ctrl.createTenant);
router.patch('/super-admin/tenants/:id', authenticate, requireSuperAdmin, ctrl.updateTenant);
router.delete('/super-admin/tenants/:id', authenticate, requireSuperAdmin, ctrl.deleteTenant);
router.post('/super-admin/tenants/:id/onboard', authenticate, requireSuperAdmin, ctrl.onboardTenant);

// Statistiques & Audit
router.get('/super-admin/stats', authenticate, requireSuperAdmin, ctrl.getStats);
router.get('/super-admin/audit', authenticate, requireSuperAdmin, ctrl.getAuditLogs);

// Utilisateurs — IMPORTANT: roles-summary avant :id pour éviter le conflit
router.get('/super-admin/users/roles-summary', authenticate, requireSuperAdmin, ctrl.getRolesSummary);
router.get('/super-admin/users', authenticate, requireSuperAdmin, ctrl.listUsers);
router.patch('/super-admin/users/:id', authenticate, requireSuperAdmin, ctrl.updateUser);
router.delete('/super-admin/users/:id', authenticate, requireSuperAdmin, ctrl.deleteUser);

// Supervision cross-tenant
router.get('/super-admin/reservations', authenticate, requireSuperAdmin, ctrl.listAllReservations);
router.post('/super-admin/reservations/:id/cancel', authenticate, requireSuperAdmin, ctrl.cancelReservation);
router.get('/super-admin/payments', authenticate, requireSuperAdmin, ctrl.listAllPayments);
router.get('/super-admin/formations', authenticate, requireSuperAdmin, ctrl.listAllFormations);
router.post('/super-admin/formations/:id/cancel', authenticate, requireSuperAdmin, ctrl.cancelFormation);
router.get('/super-admin/espaces', authenticate, requireSuperAdmin, ctrl.listAllEspaces);
router.patch('/super-admin/espaces/:id', authenticate, requireSuperAdmin, ctrl.toggleEspace);

module.exports = router;
