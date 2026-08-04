'use strict';

/**
 * buildApiRouter() — the entire web REST API as a single express.Router,
 * mounted at /api by bot.js. Kept fully separate from the frozen Telegram bot
 * wiring; nothing here is imported by the bot's command layer.
 *
 * Mount contract (see bot.js): the caller applies CORS + express.json() BEFORE
 * this router, and this router applies its own error handler LAST so every
 * thrown/next-ed error becomes a JSON envelope.
 */
const express = require('express');

const { apiLimiter } = require('./middleware/rateLimit');
const errorHandler   = require('./middleware/errorHandler');

const authRoutes       = require('./routes/auth.routes');
const onboardingRoutes = require('./routes/onboarding.routes');
const dashboardRoutes  = require('./routes/dashboard.routes');
const storefrontRoutes = require('./routes/storefront.routes');
const checkoutRoutes   = require('./routes/checkout.routes');

function buildApiRouter() {
  const router = express.Router();

  // Lightweight readiness probe for the API surface specifically.
  router.get('/health', (req, res) => res.json({ ok: true, service: 'web-api' }));

  // General throughput cap across the API (auth routes add a stricter limiter).
  router.use(apiLimiter);

  router.use('/auth', authRoutes);
  router.use('/onboarding', onboardingRoutes);
  router.use('/dashboard', dashboardRoutes);
  router.use('/store', storefrontRoutes);
  router.use('/checkout', checkoutRoutes);

  // JSON error envelope — must be registered last.
  router.use(errorHandler);

  return router;
}

module.exports = { buildApiRouter };
