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
} = require('../controllers/adminController');

// Tenant (coworking)
router.get('/admin/tenant', authenticate, requireRoles('super_admin', 'admin', 'staff'), getTenant);
router.patch('/admin/tenant', authenticate, requireRoles('super_admin', 'admin'), updateTenant);

// Espaces
router.post('/admin/espaces', authenticate, requireRoles('super_admin', 'admin'), createEspace);
router.patch('/admin/espaces/:id', authenticate, requireRoles('super_admin', 'admin'), updateEspace);
router.delete('/admin/espaces/:id', authenticate, requireRoles('super_admin', 'admin'), deleteEspace);
router.post('/admin/upload', authenticate, uploadPhoto);
router.post('/upload', authenticate, uploadPhoto);

// Onboarding
router.post('/admin/onboarding/complete', authenticate, requireRoles('super_admin', 'admin'), completeOnboarding);

// Membres (list)
router.get('/admin/members', authenticate, requireRoles('super_admin', 'admin', 'staff'), listMembers);

// Conversations admin
router.post('/admin/conversations', authenticate, requireRoles('super_admin', 'admin', 'staff'), createAdminConversation);
router.get('/admin/conversations', authenticate, requireRoles('super_admin', 'admin', 'staff'), listAdminConversations);

module.exports = router;
