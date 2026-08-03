'use strict';

/**
 * CORS for the /api mount only. Allowlist the known frontend origin(s) from
 * FRONTEND_ORIGIN (comma-separated). Credentials enabled so the browser can
 * send the refresh cookie. Never applied to the Telegram/Paystack webhook routes.
 */
const ALLOWED = (process.env.FRONTEND_ORIGIN || 'http://localhost:3001')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

module.exports = function cors(req, res, next) {
  const origin = req.headers.origin;

  if (origin && ALLOWED.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization'
    );
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
};
