// frontend/server/app.js — Application Express pour Vercel Serverless
'use strict';

const express = require('express');
const cors = require('cors');
require('dotenv').config();

// ── Config ────────────────────────────────────────────────────────────────
const { supabaseAdmin } = require('./config/supabase');

// ── Routes ────────────────────────────────────────────────────────────────
const superAdminRoutes = require('./routes/superAdmin.routes');
const adminRoutes = require('./routes/admin.routes');
const membersRoutes = require('./routes/members.routes');
const subscriptionsRoutes = require('./routes/subscriptions.routes');
const bookingsRoutes = require('./routes/bookings.routes');
const sessionsRoutes = require('./routes/sessions.routes');
const paymentsRoutes = require('./routes/payments.routes');
const pricingRoutes = require('./routes/pricing.routes');
const espacesRoutes = require('./routes/espaces.routes');
const formationsRoutes = require('./routes/formations.routes');
const formateursRoutes = require('./routes/formateurs.routes');
const inscriptionsRoutes = require('./routes/inscriptions.routes');
const kpisRoutes = require('./routes/kpis.routes');
const conversationsRoutes = require('./routes/conversations.routes');
const memberPortalRoutes = require('./routes/memberPortal.routes');
const createModulesHJKLNRouter = require('./routes/modulesHJKLN');
const otpRoutes = require('./routes/otp.routes');
const contactRoutes = require('./routes/contact.routes');
const passwordRoutes = require('./routes/password.routes');
const authUnifiedRoutes = require('./routes/authUnified.routes');
const invitationsRoutes = require('./routes/invitations.routes');
const superAdminValidationRoutes = require('./routes/superAdminValidation.routes');

// ── Middlewares de sécurité ───────────────────────────────────────────────
const { authenticate } = require('./middleware/authenticate');
const { requireRoles } = require('./middleware/requireRoles');
const { applyTenantFilter } = require('./middleware/guards');

// ── App Express ───────────────────────────────────────────────────────────
const app = express();

app.use(cors({
  origin: true,
  credentials: true,
}));

app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  },
}));

// ── Healthcheck & Accueil API ─────────────────────────────────────────────
app.get(['/', '/health', '/api/health'], (req, res) => {
  res.json({
    status: 'ok',
    message: 'API DeskyWork opérationnelle sur Vercel Serverless',
    timestamp: new Date().toISOString(),
    service: 'deskywork-vercel-api',
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
app.use('/api', authUnifiedRoutes);
app.use('/api', invitationsRoutes);
app.use('/api', superAdminValidationRoutes);

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

module.exports = app;

