'use strict';

/**
 * Express rate-limit middleware for the /api mount. Same in-memory
 * bucket+cleanup approach as services/rateLimiter, kept separate so the web
 * API's caps never interfere with the bot's command/payment limiters.
 */
const buckets = new Map();

function makeLimiter({ windowMs, max, keyPrefix }) {
  return (req, res, next) => {
    const ip  = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const id  = (req.body && req.body.email) ? String(req.body.email).toLowerCase() : '';
    const key = `${keyPrefix}:${ip}:${id}`;
    const now = Date.now();

    const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > bucket.resetAt) {
      bucket.count   = 0;
      bucket.resetAt = now + windowMs;
    }
    bucket.count++;
    buckets.set(key, bucket);

    if (bucket.count > max) {
      return res.status(429).json({ error: 'Too many requests, slow down' });
    }
    next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
}, 5 * 60 * 1000).unref?.();

// Strict limiter for auth endpoints: 10 attempts / 15 min per IP+email.
const authLimiter = makeLimiter({
  windowMs:  15 * 60 * 1000,
  max:       10,
  keyPrefix: 'auth',
});

// General API limiter: 120 requests / min per IP.
const apiLimiter = (() => {
  const base = makeLimiter({ windowMs: 60 * 1000, max: 120, keyPrefix: 'api' });
  return base;
})();

module.exports = { authLimiter, apiLimiter, makeLimiter };
