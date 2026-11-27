// routes/payments.routes.js — Routes Paiements (encaissement sur place, reçus PDF)
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { requireRoles } = require('../middleware/requireRoles');
const { requirePermission } = require('../middleware/requirePermission');
const ctrl = require('../controllers/paymentsController');

// CDC v3.0 — D1 : paiement 100 % sur place en v1. Toutes les passerelles en ligne
// (Stripe, Flouci, CB) sont désactivées ; l'API répond 410 Gone.
router.all('/stripe/{*path}', (_req, res) => res.status(410).json({
  error: "Le paiement en ligne n'est pas disponible. Le règlement s'effectue sur place (espèces, chèque ou virement).",
  code: 'ONLINE_PAYMENT_DISABLED',
}));

// Téléchargement du reçu PDF
router.get('/payments/:id/receipt', authenticate, ctrl.getPaymentReceipt);

// Routes paiement membre
router.post('/payments/self', authenticate, ctrl.createPaymentSelf);
router.get('/payments/member/:memberId', authenticate, ctrl.getMemberPayments);

// Entité « Montant dû » & Encaissement sur place (CDC v3.0 Chantier 4.2)
router.get('/montant-du/me', authenticate, ctrl.getMontantDu);
router.get('/montant-du', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.getMontantDu);
router.post('/montant-du', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.createMontantDu);
router.get('/payments/unpaid/summary', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.getUnpaidSummary);
router.post('/payments/:id/collect', authenticate, requirePermission('paiements_encaissement'), ctrl.collectPayment);
router.post('/payments/:id/refund', authenticate, requirePermission('remboursements'), ctrl.refundPayment);
router.post('/payments/:id/relance', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.sendPaymentReminder);
router.post('/payments/:id/promesse', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.recordPaymentPromise);

// Routes paiement administration (Super Admin, Admin, Staff)
router.post('/payments', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.createPayment);
router.get('/payments', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.listPayments);
router.get('/payments/pending', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.getPendingPayments);
router.patch('/payments/:id', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.updatePayment);

module.exports = router;
