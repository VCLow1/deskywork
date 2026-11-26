// routes/memberPortal.routes.js — Routes MODULE E : Portail Membre
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const {
  bookingsHistory,
  memberStats,
  spacesNearby,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  updateSettings,
  myFormations,
  bookingRecommendations,
} = require('../controllers/memberPortalController');

// Historique réservations
router.get('/bookings/history', authenticate, bookingsHistory);

// Stats globales
router.get('/member/stats', authenticate, memberStats);

// Espaces disponibles à proximité & recommandations coworking
router.get('/member/spaces-nearby', authenticate, spacesNearby);
router.get('/member/booking-recommendations', authenticate, bookingRecommendations);

// Notifications
router.get('/member/notifications', authenticate, listNotifications);
router.patch('/member/notifications/:id/read', authenticate, markNotificationRead);
router.post('/member/notifications/read-all', authenticate, markAllNotificationsRead);

// Préférences
router.patch('/members/me/settings', authenticate, updateSettings);

// Formations inscrites
router.get('/members/me/formations', authenticate, myFormations);

module.exports = router;
