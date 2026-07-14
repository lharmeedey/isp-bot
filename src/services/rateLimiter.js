// Simple in-memory rate limiter — no external dependency needed
const buckets = new Map();

function createLimiter({ windowMs, max, keyPrefix = '' }) {
  return function limit(key) {
    const fullKey  = `${keyPrefix}:${key}`;
    const now      = Date.now();
    const bucket   = buckets.get(fullKey) || { count: 0, resetAt: now + windowMs };

    // Reset if window expired
    if (now > bucket.resetAt) {
      bucket.count   = 0;
      bucket.resetAt = now + windowMs;
    }

    bucket.count++;
    buckets.set(fullKey, bucket);

    return bucket.count <= max;
  };
}

// Clean up old buckets every 5 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
}, 5 * 60 * 1000);

// Pre-built limiters
const commandLimiter = createLimiter({
  windowMs:  60 * 1000,  // 1 minute
  max:       20,          // 20 commands per minute per user
  keyPrefix: 'cmd',
});

const paymentLimiter = createLimiter({
  windowMs:  5 * 60 * 1000, // 5 minutes
  max:       5,              // 5 payment attempts per 5 minutes
  keyPrefix: 'pay',
});

const webhookLimiter = createLimiter({
  windowMs:  60 * 1000, // 1 minute
  max:       60,         // 60 webhook calls per minute per IP
  keyPrefix: 'wh',
});

module.exports = { commandLimiter, paymentLimiter, webhookLimiter };