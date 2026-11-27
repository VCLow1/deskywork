// routes/bookings.routes.js — Routes Réservations
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { requireRoles } = require('../middleware/requireRoles');
const ctrl = require('../controllers/bookingsController');

// Routes calendrier & disponibilité
router.get('/bookings/calendar', authenticate, ctrl.getBookingsCalendar);
router.post('/bookings/check-availability', authenticate, ctrl.checkAvailability);
router.post('/bookings/check-slots', authenticate, ctrl.checkSlots);

// CRUD & actions LOT 3 réservations (membres & admin)
router.post('/bookings', authenticate, ctrl.createBooking);
router.delete('/bookings/:id', authenticate, ctrl.deleteBooking);
router.get('/bookings/:id/cancel-info', authenticate, ctrl.cancelInfoBooking);
router.get('/bookings', authenticate, ctrl.listBookings);
router.patch('/bookings/:id', authenticate, ctrl.updateBooking);
router.post('/bookings/:id/move', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.moveBooking);
router.post('/bookings/:id/extend', authenticate, ctrl.extendBooking);
router.post('/bookings/:id/archive', authenticate, requireRoles('super_admin', 'admin'), ctrl.archiveBooking);

// Taux d'occupation (administration)
router.get('/bookings/occupation', authenticate, requireRoles('super_admin', 'admin', 'staff'), ctrl.getBookingsOccupation);

module.exports = router;
