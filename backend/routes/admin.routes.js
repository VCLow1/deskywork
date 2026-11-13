// routes/admin.routes.js — Routes Admin : Tenant, Espaces, Membres, Conversations
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { requireRoles } = require('../middleware/requireRoles');
const {
  getTenant,
  updateTenant,
  createEspace,
  updateEspace,
  deleteEspace,
  completeOnboarding,
  listMembers,
  createAdminConversation,
  listAdminConversations,
  uploadPhoto,
  globalSearch,
  getClientsOverview,
  createMember,
  getMemberHistory,
  listStaff,
  createStaff,
  updateStaff,
  deleteStaff,
  getSubscriptionOverview,
  requestPackUpgrade,
  downloadDeskyInvoicePdf,
  getNotificationsSupportState,
  updateAlertSettings,
  createSupportTicket,
  getMarketplaceStats,
} = require('../controllers/adminController');

// Recherche globale header
router.get('/admin/global-search', authenticate, requireRoles('super_admin', 'admin', 'staff'), globalSearch);

// Tenant (coworking)
router.get('/admin/tenant', authenticate, requireRoles('super_admin', 'admin', 'staff'), getTenant);
router.patch('/admin/tenant', authenticate, requireRoles('super_admin', 'admin'), updateTenant);
router.get('/admin/marketplace-stats', authenticate, requireRoles('super_admin', 'admin'), getMarketplaceStats);

// Espaces
router.post('/admin/espaces', authenticate, requireRoles('super_admin', 'admin'), createEspace);
router.patch('/admin/espaces/:id', authenticate, requireRoles('super_admin', 'admin'), updateEspace);
router.delete('/admin/espaces/:id', authenticate, requireRoles('super_admin', 'admin'), deleteEspace);
router.post('/admin/upload', authenticate, uploadPhoto);
router.post('/upload', authenticate, uploadPhoto);

// Onboarding
router.post('/admin/onboarding/complete', authenticate, requireRoles('super_admin', 'admin'), completeOnboarding);

// Membres & Clients
router.get('/admin/members', authenticate, requireRoles('super_admin', 'admin', 'staff'), listMembers);
router.post('/admin/members', authenticate, requireRoles('super_admin', 'admin', 'staff'), createMember);
router.get('/admin/members/:id/history', authenticate, requireRoles('super_admin', 'admin', 'staff'), getMemberHistory);
router.get('/admin/clients/overview', authenticate, requireRoles('super_admin', 'admin', 'staff'), getClientsOverview);

// Équipe (Staff) — réservé Admin (bloqué pour Staff)
router.get('/admin/staff', authenticate, requireRoles('super_admin', 'admin'), listStaff);
router.post('/admin/staff', authenticate, requireRoles('super_admin', 'admin'), createStaff);
router.patch('/admin/staff/:id', authenticate, requireRoles('super_admin', 'admin'), updateStaff);
router.delete('/admin/staff/:id', authenticate, requireRoles('super_admin', 'admin'), deleteStaff);

// Mon Abonnement DeskyWork — réservé Admin (bloqué pour Staff)
router.get('/admin/subscription', authenticate, requireRoles('super_admin', 'admin'), getSubscriptionOverview);
router.post('/admin/subscription/upgrade-request', authenticate, requireRoles('super_admin', 'admin'), requestPackUpgrade);
router.get('/admin/subscription/invoices/:invoiceId/pdf', authenticate, requireRoles('super_admin', 'admin'), downloadDeskyInvoicePdf);

// Notifications & Support DeskyWork
router.get('/admin/notifications-support', authenticate, requireRoles('super_admin', 'admin', 'staff'), getNotificationsSupportState);
router.patch('/admin/alert-settings', authenticate, requireRoles('super_admin', 'admin'), updateAlertSettings);
router.post('/admin/support-tickets', authenticate, requireRoles('super_admin', 'admin', 'staff'), createSupportTicket);

// Conversations admin
router.post('/admin/conversations', authenticate, requireRoles('super_admin', 'admin', 'staff'), createAdminConversation);
router.get('/admin/conversations', authenticate, requireRoles('super_admin', 'admin', 'staff'), listAdminConversations);

module.exports = router;
