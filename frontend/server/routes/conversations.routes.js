// routes/conversations.routes.js — Routes Messagerie & Support
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { requireRoles } = require('../middleware/requireRoles');
const ctrl = require('../controllers/conversationsController');

// Routes conversations membres
router.get('/conversations', authenticate, ctrl.listConversations);
router.post('/conversations', authenticate, ctrl.createConversation);
router.get('/conversations/team', authenticate, ctrl.listTeam);
router.get('/conversations/:id', authenticate, ctrl.getConversation);
router.get('/conversations/:id/messages', authenticate, ctrl.listMessages);
router.post('/conversations/:id/messages', authenticate, ctrl.createMessage);
router.patch('/conversations/:id/read', authenticate, ctrl.markRead);

// Compteur messages non-lus
router.get('/messages/unread-count', authenticate, ctrl.getUnreadCount);

// Routes messagerie administration
router.get('/admin/members', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.listAdminMembers);
router.post('/admin/conversations', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.createAdminConversation);
router.get('/admin/conversations', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.listAdminConversations);

module.exports = router;
