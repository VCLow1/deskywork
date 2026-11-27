// routes/admin.routes.js — Routes Admin : Tenant, Espaces, Membres, Ressources, Audit (LOT 2)
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { requireRoles } = require('../middleware/requireRoles');
const { requirePermission } = require('../middleware/requirePermission');
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
  mergePersonnes,
  checkPersonnePhone,
  getPersonne360,
  updatePersonneNotes,
  getMemberHistory,
  listStaff,
  createStaff,
  updateStaff,
  deleteStaff,
  getMyPermissions,
  getRolesPermissions,
  updateRolesPermissions,
  getSubscriptionOverview,
  requestPackUpgrade,
  downloadDeskyInvoicePdf,
  getNotificationsSupportState,
  updateAlertSettings,
  createSupportTicket,
  getMarketplaceStats,
  getActivityLog,
  getPacks,
  triggerLot4Automations,
  ressourcesHandlers,
  servicesHandlers,
  incidentsHandlers,
  devisFacturesHandlers,
  createAvoirFromFacture,
  downloadDevisFacturePdf,
} = require('../controllers/adminController');
const {
  listAdminUnites,
  listPublicUnites,
  createUnite,
  updateUnite,
  changeUniteStatus,
  archiveUnite,
  restoreUnite,
} = require('../controllers/unitesController');

// Packs & Journal d'activité
router.get('/admin/packs', authenticate, requireRoles('super_admin', 'admin', 'staff'), getPacks);
router.get('/admin/activity-log', authenticate, requirePermission('journal_activite'), getActivityLog);
router.post('/admin/automations/run', authenticate, requireRoles('super_admin', 'admin', 'staff'), triggerLot4Automations);

// Recherche globale header
router.get('/admin/global-search', authenticate, requireRoles('super_admin', 'admin', 'staff'), globalSearch);

// Tenant (coworking)
router.get('/admin/tenant', authenticate, requireRoles('super_admin', 'admin', 'staff'), getTenant);
router.patch('/admin/tenant', authenticate, requirePermission('parametres'), updateTenant);
router.get('/admin/marketplace-stats', authenticate, requirePermission('rapports_financiers'), getMarketplaceStats);

// Espaces + archivage + tarifs HT/TTC
router.post('/admin/espaces', authenticate, requirePermission('parametres'), createEspace);
router.patch('/admin/espaces/:id', authenticate, requirePermission('parametres'), updateEspace);
router.delete('/admin/espaces/:id', authenticate, requirePermission('parametres'), deleteEspace);
router.post('/admin/espaces/:id/archive', authenticate, requirePermission('parametres'), archiveEspace);
router.post('/admin/espaces/:id/restore', authenticate, requirePermission('parametres'), restoreEspace);
router.put('/admin/espaces/:id/tarifs', authenticate, requirePermission('tarifs_acces'), updateEspaceTarifs);
router.get('/admin/tarifs/historique', authenticate, requirePermission('tarifs_acces'), getTarifHistory);
router.post('/admin/upload', authenticate, uploadPhoto);
router.post('/upload', authenticate, uploadPhoto);

// Onboarding
router.post('/admin/onboarding/complete', authenticate, requirePermission('parametres'), completeOnboarding);

// Membres, Personnes (Invités / Prospects) & Clients
router.get('/admin/members', authenticate, requireRoles('super_admin', 'admin', 'staff'), listMembers);
router.post('/admin/members', authenticate, requirePermission('clients_lecture_creation'), createMember);
router.post('/admin/personnes', authenticate, requirePermission('clients_lecture_creation'), createPersonne);
router.post('/admin/personnes/merge', authenticate, requirePermission('archivage_fusion_membres'), mergePersonnes);
router.post('/admin/personnes/:id/archive', authenticate, requirePermission('archivage_fusion_membres'), archivePersonne);
router.post('/admin/personnes/:id/restore', authenticate, requirePermission('archivage_fusion_membres'), restorePersonne);
router.get('/admin/personnes/check-phone', authenticate, requireRoles('super_admin', 'admin', 'staff'), checkPersonnePhone);
router.get('/admin/personnes/:id/360', authenticate, requireRoles('super_admin', 'admin', 'staff'), getPersonne360);
router.patch('/admin/personnes/:id/notes', authenticate, requireRoles('super_admin', 'admin', 'staff'), updatePersonneNotes);
router.get('/admin/members/:id/history', authenticate, requireRoles('super_admin', 'admin', 'staff'), getMemberHistory);
router.get('/admin/clients/overview', authenticate, requireRoles('super_admin', 'admin', 'staff'), getClientsOverview);

// Unités & Postes (LOT 3)
router.get('/admin/unites', authenticate, requireRoles('super_admin', 'admin', 'staff'), listAdminUnites);
router.post('/admin/unites', authenticate, requireRoles('super_admin', 'admin'), createUnite);
router.patch('/admin/unites/:id', authenticate, requireRoles('super_admin', 'admin'), updateUnite);
router.post('/admin/unites/:id/status', authenticate, requireRoles('super_admin', 'admin'), changeUniteStatus);
router.post('/admin/unites/:id/archive', authenticate, requireRoles('super_admin', 'admin'), archiveUnite);
router.post('/admin/unites/:id/restore', authenticate, requireRoles('super_admin', 'admin'), restoreUnite);
router.get('/unites/public', listPublicUnites);

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
router.post('/admin/devis-factures', authenticate, requirePermission('factures_avoirs'), devisFacturesHandlers.create);
router.patch('/admin/devis-factures/:id', authenticate, requirePermission('factures_avoirs'), devisFacturesHandlers.update);
router.post('/admin/devis-factures/:id/avoir', authenticate, requirePermission('factures_avoirs'), createAvoirFromFacture);
router.get('/admin/devis-factures/:id/pdf', authenticate, requireRoles('super_admin', 'admin', 'staff'), downloadDevisFacturePdf);
router.post('/admin/devis-factures/:id/archive', authenticate, requirePermission('factures_avoirs'), devisFacturesHandlers.archive);
router.post('/admin/devis-factures/:id/restore', authenticate, requirePermission('factures_avoirs'), devisFacturesHandlers.restore);

// Équipe (Staff) & Matrice des permissions (verrouillé 403 pour Réceptionniste)
router.get('/admin/my-permissions', authenticate, requireRoles('super_admin', 'admin', 'staff'), getMyPermissions);
router.get('/admin/roles-permissions', authenticate, requirePermission('equipe_gestion'), getRolesPermissions);
router.put('/admin/roles-permissions', authenticate, requirePermission('equipe_gestion'), updateRolesPermissions);
router.get('/admin/staff', authenticate, requirePermission('equipe_gestion'), listStaff);
router.post('/admin/staff', authenticate, requirePermission('equipe_gestion'), createStaff);
router.patch('/admin/staff/:id', authenticate, requirePermission('equipe_gestion'), updateStaff);
router.delete('/admin/staff/:id', authenticate, requirePermission('equipe_gestion'), deleteStaff);

// Mon Abonnement DeskyWork — réservé Responsable (403 pour Staff)
router.get('/admin/subscription', authenticate, requirePermission('parametres'), getSubscriptionOverview);
router.post('/admin/subscription/upgrade-request', authenticate, requirePermission('parametres'), requestPackUpgrade);
router.get('/admin/subscription/invoices/:invoiceId/pdf', authenticate, requirePermission('parametres'), downloadDeskyInvoicePdf);

// Notifications & Support DeskyWork
router.get('/admin/notifications-support', authenticate, requireRoles('super_admin', 'admin', 'staff'), getNotificationsSupportState);
router.patch('/admin/alert-settings', authenticate, requirePermission('parametres'), updateAlertSettings);
router.post('/admin/support-tickets', authenticate, requireRoles('super_admin', 'admin', 'staff'), createSupportTicket);

// Conversations admin
router.post('/admin/conversations', authenticate, requireRoles('super_admin', 'admin', 'staff'), createAdminConversation);
router.get('/admin/conversations', authenticate, requireRoles('super_admin', 'admin', 'staff'), listAdminConversations);

module.exports = router;
