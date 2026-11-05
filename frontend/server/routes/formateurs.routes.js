// routes/formateurs.routes.js — Routes Formateurs & Rémunérations
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { requireRoles } = require('../middleware/requireRoles');
const ctrl = require('../controllers/formateursController');

// Routes listes et profils formateurs
router.get('/formateurs', authenticate, ctrl.listFormateurs);
router.get('/formateurs/me/coworkings', authenticate, ctrl.trainerCoworkings);
router.get('/formateurs/:id', authenticate, ctrl.getFormateur);

// Création et édition de formateur par l'admin
router.post('/formateurs', authenticate, requireRoles('super_admin', 'admin'), ctrl.createFormateur);
router.patch('/formateurs/:id', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.updateFormateur);

// Gestion des rémunérations
router.post('/formateurs/:id/remuneration', authenticate, requireRoles('super_admin', 'admin'), ctrl.addRemuneration);

module.exports = router;
