'use strict';

/**
 * Checkout routes — the money path for storefront customers. Mounted at
 * /api/checkout. Every route requires a customer JWT; tenant is ALWAYS taken
 * from the token (req.tenantId), never from the client.
 *
 * Paystack allows only one webhook per account and the bot owns it, so the web
 * path does NOT rely on a webhook. Instead:
 *   POST /api/checkout          → initialize a transaction with a callback_url
 *                                 back to the storefront success page; returns
 *                                 the Paystack authorization_url to redirect to.
 *   GET  /api/checkout/verify   → after the customer returns, verify the charge
 *                                 server-side and provision the voucher
 *                                 synchronously (idempotent on reference).
 *
 * The tenant's Paystack secret is decrypted per request (same as the frozen
 * /pay handler); the global paystack.js uses a single env secret and is NOT
 * suitable here.
 */
const express = require('express');
const axios   = require('axios');
const crypto  = require('crypto');
const router  = express.Router();

const db      = require('../../services/db');
const logger  = require('../../services/logger');
const { decrypt } = require('../../services/encryption');
const customerAuthRequired = require('../middleware/customerAuthRequired');
const { makeLimiter } = require('../middleware/rateLimit');
const { provisionForCustomer } = require('../services/webProvisioning');

// Stricter cap on the money path: 20 attempts / 15 min per IP+email.
const checkoutLimiter = makeLimiter({
  windowMs:  15 * 60 * 1000,
  max:       20,
  keyPrefix: 'checkout',
});

// Load a tenant's decrypted Paystack secret. Returns null if absent.
async function loadPaystackSecret(tenantId) {
  const row = await db.query(
    'SELECT paystack_secret FROM tenants WHERE tenant_id = $1',
    [tenantId]
  );
  if (!row.rows.length) return null;
  const raw = row.rows[0].paystack_secret;
  if (!raw) return null;
  return decrypt(raw) || raw;
}

// Where Paystack sends the customer back after payment.
function callbackUrl(tenantId, reference) {
  const base = (process.env.FRONTEND_ORIGIN || 'http://localhost:3001').replace(/\/$/, '');
  return `${base}/store/${encodeURIComponent(tenantId)}/success?reference=${encodeURIComponent(reference)}`;
}

// Opaque, collision-resistant Paystack reference.
function newReference(tenantId) {
  return `web_${tenantId}_${crypto.randomBytes(9).toString('hex')}`;
}

// ── POST /api/checkout ───────────────────────────────────────
// Body: { plan }  (plan label). Initializes a Paystack transaction and returns
// { authorizationUrl, reference }.
router.post('/', customerAuthRequired, checkoutLimiter, async (req, res, next) => {
  try {
    const { customerId, tenantId } = req.customer;
    const plan = req.body && req.body.plan;
    if (!plan) return res.status(400).json({ error: 'A plan is required' });

    // Validate the plan belongs to this tenant and is active; price it server-side.
    const planRes = await db.query(
      `SELECT label, price FROM tenant_plans
        WHERE tenant_id = $1 AND label = $2 AND active = true
        LIMIT 1`,
      [tenantId, plan]
    );
    if (!planRes.rows.length) {
      return res.status(404).json({ error: 'Plan not available' });
    }
    const priceNaira = parseFloat(planRes.rows[0].price);

    // Customer email is the voucher username; pull it from the trusted record.
    const custRes = await db.query(
      'SELECT email FROM customers WHERE id = $1 AND tenant_id = $2',
      [customerId, tenantId]
    );
    if (!custRes.rows.length) return res.status(404).json({ error: 'Customer not found' });
    const email = custRes.rows[0].email;

    const secret = await loadPaystackSecret(tenantId);
    if (!secret) {
      return res.status(503).json({ error: 'This store is not accepting payments yet' });
    }

    const reference = newReference(tenantId);

    const initRes = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        amount:       Math.round(priceNaira * 100), // kobo
        reference,
        callback_url: callbackUrl(tenantId, reference),
        metadata:     { customerId, tenantId, plan, email, channel: 'web' },
      },
      { headers: { Authorization: `Bearer ${secret}` } }
    );

    const data = initRes.data && initRes.data.data;
    if (!data || !data.authorization_url) {
      logger.error('Paystack init returned no authorization_url', { tenantId, reference });
      return res.status(502).json({ error: 'Could not start payment' });
    }

    logger.info('Storefront checkout initialized', { tenantId, customerId, plan, reference });
    res.json({ authorizationUrl: data.authorization_url, reference });
  } catch (err) {
    if (err.response) {
      logger.error('Paystack init failed', {
        status: err.response.status, data: JSON.stringify(err.response.data).slice(0, 300),
      });
      return res.status(502).json({ error: 'Payment initialization failed' });
    }
    next(err);
  }
});

// ── GET /api/checkout/verify?reference= ──────────────────────
// Verify a returned transaction and provision the voucher. Idempotent.
router.get('/verify', customerAuthRequired, async (req, res, next) => {
  try {
    const { customerId, tenantId } = req.customer;
    const reference = req.query.reference;
    if (!reference) return res.status(400).json({ error: 'A reference is required' });

    const secret = await loadPaystackSecret(tenantId);
    if (!secret) return res.status(503).json({ error: 'Payments unavailable' });

    const verifyRes = await axios.get(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${secret}` } }
    );
    const tx = verifyRes.data && verifyRes.data.data;

    if (!tx || tx.status !== 'success') {
      return res.status(402).json({ error: 'Payment not completed', status: tx && tx.status });
    }

    // Bind the charge to THIS customer/tenant via the metadata we set at init.
    const meta = tx.metadata || {};
    if (String(meta.tenantId) !== String(tenantId) ||
        Number(meta.customerId) !== Number(customerId)) {
      logger.warn('Checkout verify: metadata/customer mismatch', { tenantId, reference });
      return res.status(403).json({ error: 'This payment does not belong to your account' });
    }

    const result = await provisionForCustomer({
      tenantId,
      customerId,
      plan:       meta.plan,
      email:      meta.email,
      reference,
      amountKobo: tx.amount,
    });

    res.json({
      code:          result.code,
      plan:          result.plan,
      expiry:        result.expiry,
      alreadyIssued: result.alreadyIssued,
    });
  } catch (err) {
    if (err.status === 409) {
      return res.status(409).json({ error: err.message, reason: err.reason });
    }
    if (err.response) {
      logger.error('Paystack verify failed', {
        status: err.response.status, data: JSON.stringify(err.response.data).slice(0, 300),
      });
      return res.status(502).json({ error: 'Payment verification failed' });
    }
    next(err);
  }
});

module.exports = router;
