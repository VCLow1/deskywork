// routes/kpis.routes.js — Routes Dashboard KPIs
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { requireRoles } = require('../middleware/requireRoles');
const { requirePermission } = require('../middleware/requirePermission');
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

// Rapport intelligent (IA embarquée) & Rapports détaillés + Export PDF (CDC v3.0 — Admin uniquement pour rapports financiers)
router.get('/admin/report', authenticate, requirePermission('rapports_financiers'), reportCtrl.getAdminReport);
router.get('/admin/reports/detailed', authenticate, requirePermission('rapports_financiers'), reportCtrl.getDetailedReport);
router.get('/admin/reports/pdf', authenticate, requirePermission('rapports_financiers'), reportCtrl.downloadAdminReportPdf);

module.exports = router;
