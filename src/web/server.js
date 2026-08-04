'use strict';

/**
 * Standalone API-only server for local development and testing.
 *
 * Runs ONLY the web REST API — it does NOT start the Telegram bot and does NOT
 * call launchAllTenants(). This is what makes it safe to run locally against
 * the live Render database: the real bot keeps running untouched on Render
 * (Telegram allows only one poller per token, so we never start a second one).
 *
 * Start with:  npm run api
 */
require('dotenv').config();

const express = require('express');
const logger  = require('../services/logger');
const cors    = require('./middleware/cors');
const { buildApiRouter } = require('./index');

const app  = express();
const PORT = process.env.API_PORT || 3000;

// Bare health check (outside /api) for quick liveness probing.
app.get('/health', (req, res) => res.json({ ok: true, service: 'api-only' }));

// Same mount contract as bot.js: CORS + JSON scoped to /api, router last.
app.use('/api', cors, express.json(), buildApiRouter());

app.listen(PORT, () => {
  logger.info('API-only server listening', { port: PORT });
  // eslint-disable-next-line no-console
  console.log(`API-only server ready on http://localhost:${PORT}  (no Telegram bot)`);
});
