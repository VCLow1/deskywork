// routes/inscriptions.routes.js — Routes Inscriptions Formations & Présences
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const ctrl = require('../controllers/inscriptionsController');

// Routes inscriptions membres
router.post('/formations/:id/inscriptions', authenticate, ctrl.createInscription);
router.delete('/formations/:id/inscriptions', authenticate, ctrl.cancelInscription);
router.post('/formations/:id/inscriptions/payment', authenticate, ctrl.createInscriptionPayment);

// Routes listes et présences (Formateur / Admin / Staff)
router.get('/formations/:id/inscriptions', authenticate, ctrl.listInscriptions);
router.patch('/formations/:id/inscriptions/:userId/presence', authenticate, ctrl.updatePresence);
router.get('/formations/:id/emargement', authenticate, ctrl.getEmargement);

module.exports = router;
