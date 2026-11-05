// routes/formations.routes.js — Routes Formations & Catalogue
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { requireRoles } = require('../middleware/requireRoles');
const ctrl = require('../controllers/formationsController');

// Routes catalogue et détails formations
router.get('/formations', authenticate, ctrl.listFormations);
router.get('/formations/:id', authenticate, ctrl.getFormation);

// Actions d'écriture (Formateur / Admin)
router.post('/formations', authenticate, requireRoles('formateur'), ctrl.createFormation);
router.patch('/formations/:id', authenticate, ctrl.updateFormation);
router.delete('/formations/:id', authenticate, ctrl.deleteFormation);

module.exports = router;
