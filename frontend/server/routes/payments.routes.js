// routes/payments.routes.js — Routes Paiements & Stripe Checkout
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { requireRoles } = require('../middleware/requireRoles');
const ctrl = require('../controllers/paymentsController');

// Routes Stripe membres (Stripe checkout session)
router.post('/stripe/pay', authenticate, ctrl.stripePay);
router.post('/stripe/verify', authenticate, ctrl.stripeVerify);
router.post('/stripe/webhook', express.raw({ type: 'application/json' }), ctrl.stripeWebhookHandler);

// Téléchargement du reçu PDF
router.get('/payments/:id/receipt', authenticate, ctrl.getPaymentReceipt);

// Routes paiement membre
router.post('/payments/self', authenticate, ctrl.createPaymentSelf);
router.get('/payments/member/:memberId', authenticate, ctrl.getMemberPayments);

// Routes paiement administration (Super Admin, Admin, Staff)
router.post('/payments', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.createPayment);
router.get('/payments', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.listPayments);
router.get('/payments/pending', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.getPendingPayments);
router.patch('/payments/:id', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.updatePayment);

module.exports = router;
