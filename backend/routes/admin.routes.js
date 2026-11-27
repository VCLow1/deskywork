// routes/admin.routes.js — Routes Admin : Tenant, Espaces, Membres, Ressources, Audit (LOT 2)
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
  archiveEspace,
  restoreEspace,
  updateEspaceTarifs,
  getTarifHistory,
  completeOnboarding,
  listMembers,
  createAdminConversation,
  listAdminConversations,
  uploadPhoto,
  globalSearch,
  getClientsOverview,
  createMember,
  createPersonne,
  archivePersonne,
  restorePersonne,
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
  getActivityLog,
  getPacks,
  ressourcesHandlers,
  servicesHandlers,
  incidentsHandlers,
  devisFacturesHandlers,
} = require('../controllers/adminController');

// Packs & Journal d'activité
router.get('/admin/packs', authenticate, requireRoles('super_admin', 'admin', 'staff'), getPacks);
router.get('/admin/activity-log', authenticate, requireRoles('super_admin', 'admin'), getActivityLog);

// Recherche globale header
router.get('/admin/global-search', authenticate, requireRoles('super_admin', 'admin', 'staff'), globalSearch);

// Tenant (coworking)
router.get('/admin/tenant', authenticate, requireRoles('super_admin', 'admin', 'staff'), getTenant);
router.patch('/admin/tenant', authenticate, requireRoles('super_admin', 'admin'), updateTenant);
router.get('/admin/marketplace-stats', authenticate, requireRoles('super_admin', 'admin'), getMarketplaceStats);

// Espaces + archivage + tarifs HT/TTC
router.post('/admin/espaces', authenticate, requireRoles('super_admin', 'admin'), createEspace);
router.patch('/admin/espaces/:id', authenticate, requireRoles('super_admin', 'admin'), updateEspace);
router.delete('/admin/espaces/:id', authenticate, requireRoles('super_admin', 'admin'), deleteEspace);
router.post('/admin/espaces/:id/archive', authenticate, requireRoles('super_admin', 'admin'), archiveEspace);
router.post('/admin/espaces/:id/restore', authenticate, requireRoles('super_admin', 'admin'), restoreEspace);
router.put('/admin/espaces/:id/tarifs', authenticate, requireRoles('super_admin', 'admin'), updateEspaceTarifs);
router.get('/admin/tarifs/historique', authenticate, requireRoles('super_admin', 'admin', 'staff'), getTarifHistory);
router.post('/admin/upload', authenticate, uploadPhoto);
router.post('/upload', authenticate, uploadPhoto);

// Onboarding
router.post('/admin/onboarding/complete', authenticate, requireRoles('super_admin', 'admin'), completeOnboarding);

// Membres, Personnes (Invités / Prospects) & Clients
router.get('/admin/members', authenticate, requireRoles('super_admin', 'admin', 'staff'), listMembers);
router.post('/admin/members', authenticate, requireRoles('super_admin', 'admin', 'staff'), createMember);
router.post('/admin/personnes', authenticate, requireRoles('super_admin', 'admin', 'staff'), createPersonne);
router.post('/admin/personnes/:id/archive', authenticate, requireRoles('super_admin', 'admin'), archivePersonne);
router.post('/admin/personnes/:id/restore', authenticate, requireRoles('super_admin', 'admin'), restorePersonne);
router.get('/admin/members/:id/history', authenticate, requireRoles('super_admin', 'admin', 'staff'), getMemberHistory);
router.get('/admin/clients/overview', authenticate, requireRoles('super_admin', 'admin', 'staff'), getClientsOverview);

// Hub Espaces et offres : Ressources, Services, Maintenance/Incidents, Devis & Factures
router.get('/admin/ressources', authenticate, requireRoles('super_admin', 'admin', 'staff'), ressourcesHandlers.list);
router.post('/admin/ressources', authenticate, requireRoles('super_admin', 'admin'), ressourcesHandlers.create);
router.patch('/admin/ressources/:id', authenticate, requireRoles('super_admin', 'admin'), ressourcesHandlers.update);
router.post('/admin/ressources/:id/archive', authenticate, requireRoles('super_admin', 'admin'), ressourcesHandlers.archive);
router.post('/admin/ressources/:id/restore', authenticate, requireRoles('super_admin', 'admin'), ressourcesHandlers.restore);

router.get('/admin/services', authenticate, requireRoles('super_admin', 'admin', 'staff'), servicesHandlers.list);
router.post('/admin/services', authenticate, requireRoles('super_admin', 'admin'), servicesHandlers.create);
router.patch('/admin/services/:id', authenticate, requireRoles('super_admin', 'admin'), servicesHandlers.update);
router.post('/admin/services/:id/archive', authenticate, requireRoles('super_admin', 'admin'), servicesHandlers.archive);
router.post('/admin/services/:id/restore', authenticate, requireRoles('super_admin', 'admin'), servicesHandlers.restore);

router.get('/admin/incidents', authenticate, requireRoles('super_admin', 'admin', 'staff'), incidentsHandlers.list);
router.post('/admin/incidents', authenticate, requireRoles('super_admin', 'admin', 'staff'), incidentsHandlers.create);
router.patch('/admin/incidents/:id', authenticate, requireRoles('super_admin', 'admin', 'staff'), incidentsHandlers.update);
router.post('/admin/incidents/:id/archive', authenticate, requireRoles('super_admin', 'admin'), incidentsHandlers.archive);
router.post('/admin/incidents/:id/restore', authenticate, requireRoles('super_admin', 'admin'), incidentsHandlers.restore);

router.get('/admin/devis-factures', authenticate, requireRoles('super_admin', 'admin', 'staff'), devisFacturesHandlers.list);
router.post('/admin/devis-factures', authenticate, requireRoles('super_admin', 'admin'), devisFacturesHandlers.create);
router.patch('/admin/devis-factures/:id', authenticate, requireRoles('super_admin', 'admin'), devisFacturesHandlers.update);
router.post('/admin/devis-factures/:id/archive', authenticate, requireRoles('super_admin', 'admin'), devisFacturesHandlers.archive);
router.post('/admin/devis-factures/:id/restore', authenticate, requireRoles('super_admin', 'admin'), devisFacturesHandlers.restore);

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
