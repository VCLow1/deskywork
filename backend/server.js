// server.js — Point d'entrée principal (refactorisé MVC)
// Structure : config/ | middleware/ | models/ | controllers/ | routes/
'use strict';

const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const express = require('express');
const cors = require('cors');
const http = require('http');
require('dotenv').config();

// ── Config & Services ─────────────────────────────────────────────────────
const { supabaseAdmin } = require('./config/supabase');
const { initSocket } = require('./services/socketService');

// ── Cron Jobs ─────────────────────────────────────────────────────────────
const { startPaymentRemindersCron } = require('./cron/paymentReminders');
const { startReservationRemindersCron } = require('./cron/reservationReminders');
const { startSubscriptionRemindersCron } = require('./cron/subscriptionReminders');
const { startFormationRemindersCron } = require('./cron/formationReminders');

// ── Routes ────────────────────────────────────────────────────────────────
const superAdminRoutes    = require('./routes/superAdmin.routes');
const adminRoutes         = require('./routes/admin.routes');
const membersRoutes       = require('./routes/members.routes');
const subscriptionsRoutes = require('./routes/subscriptions.routes');
const bookingsRoutes      = require('./routes/bookings.routes');
const sessionsRoutes      = require('./routes/sessions.routes');
const paymentsRoutes      = require('./routes/payments.routes');
const pricingRoutes       = require('./routes/pricing.routes');
const espacesRoutes       = require('./routes/espaces.routes');
const formationsRoutes    = require('./routes/formations.routes');
const formateursRoutes    = require('./routes/formateurs.routes');
const inscriptionsRoutes  = require('./routes/inscriptions.routes');
const kpisRoutes          = require('./routes/kpis.routes');
const conversationsRoutes = require('./routes/conversations.routes');
const memberPortalRoutes  = require('./routes/memberPortal.routes');
const createModulesHJKLNRouter = require('./routes/modulesHJKLN');
const otpRoutes               = require('./routes/otp.routes');
const contactRoutes           = require('./routes/contact.routes');
const passwordRoutes          = require('./routes/password.routes');

// ── Middleware de supabase (partagé pour les middlewares legacy) ───────────
const { authenticate } = require('./middleware/authenticate');
const { requireRoles } = require('./middleware/requireRoles');
const { applyTenantFilter } = require('./middleware/guards');

// ── App ───────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 5000;

// CORS — accepte les origines définies dans FRONTEND_URL (séparées par virgule)
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS bloqué pour l'origine : ${origin}`));
    }
  },
  credentials: true,
}));

app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  },
}));

// ── Healthcheck ───────────────────────────────────────────────────────────
app.get(['/health', '/api/health'], (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'deskywork-backend',
    version: '1.0.0',
  });
});

// ── Montage des routes ────────────────────────────────────────────────────
app.use('/api', superAdminRoutes);
app.use('/api', adminRoutes);
app.use('/api', membersRoutes);
app.use('/api', subscriptionsRoutes);
app.use('/api', bookingsRoutes);
app.use('/api', sessionsRoutes);
app.use('/api', paymentsRoutes);
app.use('/api', pricingRoutes);
app.use('/api', espacesRoutes);
app.use('/api', formationsRoutes);
app.use('/api', formateursRoutes);
app.use('/api', inscriptionsRoutes);
app.use('/api', kpisRoutes);
app.use('/api', conversationsRoutes);
app.use('/api', memberPortalRoutes);
app.use('/api', otpRoutes);
app.use('/api', contactRoutes);
app.use('/api', passwordRoutes);

// ── Modules H, J, K, L, N (router factory) ───────────────────────────────
const modulesHJKLNRouter = createModulesHJKLNRouter({ supabaseAdmin, authenticate, requireRoles, applyTenantFilter });
app.use('/api', modulesHJKLNRouter);

// ── 404 & Error Handlers ───────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route non trouvée : ${req.method} ${req.originalUrl}` });
});

app.use((err, req, res, next) => {
  console.error('❌ Erreur serveur:', err);
  res.status(err.status || 500).json({ error: err.message || 'Erreur interne du serveur' });
});

// ── Cron Jobs ─────────────────────────────────────────────────────────────
startPaymentRemindersCron(supabaseAdmin);
startReservationRemindersCron(supabaseAdmin);
startSubscriptionRemindersCron(supabaseAdmin);
startFormationRemindersCron(supabaseAdmin);

// ── Socket.io (Module B+ — Sessions temps réel) ───────────────────────────
const server = http.createServer(app);
initSocket(server, process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ── Start ─────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`🚀 API VCLOW démarrée sur http://localhost:${PORT}`);
  console.log('✅ Architecture MVC activée (controllers / routes / models)');
  console.log('✅ Module F - Notifications automatiques activées.');
  console.log('✅ Module B+ - Socket.io temps réel activé.');
});
