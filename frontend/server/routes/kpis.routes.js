// routes/kpis.routes.js — Routes Dashboard KPIs
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { requireRoles } = require('../middleware/requireRoles');
const ctrl = require('../controllers/kpisController');
const reportCtrl = require('../controllers/reportController');

// Middleware cache HTTP léger (30 secondes) — évite les refetch inutiles au refresh
function cacheControl(seconds) {
  return (req, res, next) => {
    res.set('Cache-Control', `private, max-age=${seconds}`);
    next();
  };
}

// Tous les KPIs du dashboard admin — cache 30s
router.get('/admin/kpis', authenticate, requireRoles('super_admin', 'admin', 'staff'), cacheControl(30), ctrl.getAdminKpis);
router.get('/admin/kpis/revenue-chart', authenticate, requireRoles('super_admin', 'admin', 'staff'), cacheControl(30), ctrl.getRevenueChart);

// Rapport intelligent (IA embarquée) — Admin Coworking
router.get('/admin/report', authenticate, requireRoles('super_admin', 'admin', 'staff'), reportCtrl.getAdminReport);

module.exports = router;
