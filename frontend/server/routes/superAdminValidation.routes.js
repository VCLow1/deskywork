// routes/superAdminValidation.routes.js — Validation Super Admin des espaces et formateurs
'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { requireSuperAdmin } = require('../middleware/guards');
const ctrl = require('../controllers/superAdminValidationController');

router.get('/super-admin/pending-validations', authenticate, requireSuperAdmin, ctrl.getPendingValidations);
router.patch('/super-admin/organizations/:id/validation', authenticate, requireSuperAdmin, ctrl.validateOrganization);
router.patch('/super-admin/trainers/:id/validation', authenticate, requireSuperAdmin, ctrl.validateTrainer);

module.exports = router;

