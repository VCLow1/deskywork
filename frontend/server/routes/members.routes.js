// routes/members.routes.js — Routes Profils Membres
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { requireRoles } = require('../middleware/requireRoles');
const ctrl = require('../controllers/membersController');

// Routes profil connecté
router.get('/members/me', authenticate, ctrl.getMe);
router.put('/members/me', authenticate, ctrl.updateMe);
router.post('/members/me/test-notification', authenticate, ctrl.testNotification);
router.post('/members/me/documents', authenticate, ctrl.addDocument);
router.delete('/members/me/documents/:index', authenticate, ctrl.deleteDocument);
router.get('/members/me/qr', authenticate, ctrl.getMyQr);

// Accueil/Invitations (Module F welcome email)
router.post('/members/welcome', authenticate, ctrl.sendWelcomeEmail);

// Routes administration des membres (Super Admin, Admin, Staff)
router.get('/admin/pending-accounts', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.getPendingAccounts);
router.patch('/admin/approve-account/:id', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.approveAccount);
router.get('/members', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.listMembers);
router.patch('/members/:id', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.updateMember);

// Détail membre
router.get('/members/:id', authenticate, ctrl.getMember);

module.exports = router;
