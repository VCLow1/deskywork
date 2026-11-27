// routes/pricing.routes.js — Routes Tarification & Codes Promo
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { requireRoles } = require('../middleware/requireRoles');
const ctrl = require('../controllers/pricingController');

// Routes tarification membres
router.get('/pricing', authenticate, ctrl.getPricing);
router.get('/pricing/history/me', authenticate, ctrl.getMyPricingHistory);
router.post('/promo-codes/validate', authenticate, ctrl.validatePromoCode);

// Routes tarification administration (Super Admin, Admin, Staff)
router.get('/pricing/all', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.getPricingAll);
router.post('/pricing', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.createPricing);
router.patch('/pricing/:id', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.updatePricing);
router.post('/pricing/:id/archive', authenticate, requireRoles('super_admin', 'admin'), ctrl.archivePricing);
router.post('/pricing/:id/restore', authenticate, requireRoles('super_admin', 'admin'), ctrl.restorePricing);

// Routes codes promo administration
router.get('/promo-codes', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.listPromoCodes);
router.post('/promo-codes', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.createPromoCode);
router.patch('/promo-codes/:id', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.updatePromoCode);
router.post('/promo-codes/:id/archive', authenticate, requireRoles('super_admin', 'admin'), ctrl.archivePromoCode);
router.post('/promo-codes/:id/restore', authenticate, requireRoles('super_admin', 'admin'), ctrl.restorePromoCode);

module.exports = router;
