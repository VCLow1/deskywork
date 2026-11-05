const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { requireSuperAdmin } = require('../middleware/guards');
const ctrl = require('../controllers/contactController');

router.post('/contact', ctrl.createContact);
router.get('/super-admin/contacts', authenticate, requireSuperAdmin, ctrl.listContacts);
router.patch('/super-admin/contacts/:id', authenticate, requireSuperAdmin, ctrl.updateContact);

module.exports = router;
