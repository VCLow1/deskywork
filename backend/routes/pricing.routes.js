// routes/pricing.routes.js — Routes Tarification & Codes Promo
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { requireRoles } = require('../middleware/requireRoles');
const { requirePermission } = require('../middleware/requirePermission');
const ctrl = require('../controllers/pricingController');

// Routes tarification membres
router.get('/pricing', authenticate, ctrl.getPricing);
router.get('/pricing/history/me', authenticate, ctrl.getMyPricingHistory);
router.post('/promo-codes/validate', authenticate, ctrl.validatePromoCode);

// Routes tarification administration (Super Admin, Admin, Staff)
router.get('/pricing/all', authenticate, requirePermission('tarifs_acces'), ctrl.getPricingAll);
router.post('/pricing', authenticate, requirePermission('tarifs_acces'), ctrl.createPricing);
router.patch('/pricing/:id', authenticate, requirePermission('tarifs_acces'), ctrl.updatePricing);
router.post('/pricing/:id/archive', authenticate, requirePermission('tarifs_acces'), ctrl.archivePricing);
router.post('/pricing/:id/restore', authenticate, requirePermission('tarifs_acces'), ctrl.restorePricing);

// Routes codes promo administration
router.get('/promo-codes', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.listPromoCodes);
router.post('/promo-codes', authenticate, requirePermission('tarifs_acces'), ctrl.createPromoCode);
router.patch('/promo-codes/:id', authenticate, requirePermission('tarifs_acces'), ctrl.updatePromoCode);
router.post('/promo-codes/:id/archive', authenticate, requirePermission('tarifs_acces'), ctrl.archivePromoCode);
router.post('/promo-codes/:id/restore', authenticate, requirePermission('tarifs_acces'), ctrl.restorePromoCode);

module.exports = router;
