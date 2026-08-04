'use strict';

/**
 * Storefront routes — the end-customer (buyer) surface. Mounted at /api/store.
 *
 * Public (no auth), tenant taken from the URL — read-only:
 *   GET  /api/store/:tenantId/info          tenant display name + open/closed
 *   GET  /api/store/:tenantId/plans         active plans to browse
 *   POST /api/store/:tenantId/auth/register create a customer, issue tokens
 *   POST /api/store/:tenantId/auth/login    verify, issue tokens
 *
 * Token-scoped (customer JWT), tenant taken from the TOKEN — never the URL:
 *   POST /api/store/auth/refresh            rotate refresh token
 *   POST /api/store/auth/logout             revoke refresh token
 *   GET  /api/store/me                      customer + purchases + vouchers
 *
 * All money/provisioning lives in checkout.routes.js.
 */
const express = require('express');
const router  = express.Router();

const db     = require('../../services/db');
const logger = require('../../services/logger');
const { signAccessToken, ACCESS_TTL_SECONDS } = require('../auth/jwt');
const customerRefresh = require('../auth/customerRefresh');
const { verifyPassword } = require('../auth/password');
const {
  findTenant,
  registerCustomer,
  findCustomerByEmail,
} = require('../services/customerProvisioning');
const customerAuthRequired = require('../middleware/customerAuthRequired');
const { authLimiter } = require('../middleware/rateLimit');

const REFRESH_COOKIE = 'crt'; // customer refresh token — distinct from operator 'rt'

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path:     '/api/store/auth',
    maxAge:   customerRefresh.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
}

// Minimal cookie reader (avoids a cookie-parser dependency).
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function issueTokens(res, { customerId, tenantId, email, name }, refreshToken) {
  const accessToken = signAccessToken({ customerId, tenantId, kind: 'customer' });
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  return {
    accessToken,
    // Also return the refresh token in the body for non-browser API clients.
    refreshToken,
    expiresIn: ACCESS_TTL_SECONDS,
    tenantId,
    customer: { id: customerId, email, name: name || null },
  };
}

// Serialize a tenant_plans row into the public plan shape.
function publicPlan(row) {
  return {
    id:       row.plan_id,
    label:    row.label,
    price:    parseFloat(row.price),
    gb:       parseFloat(row.gb),
    validity: row.validity,
  };
}

// ── GET /api/store/:tenantId/info ────────────────────────────
router.get('/:tenantId/info', async (req, res, next) => {
  try {
    const tenant = await findTenant(req.params.tenantId);
    if (!tenant) return res.status(404).json({ error: 'Store not found' });
    res.json({
      tenantId: tenant.tenant_id,
      name:     tenant.name || 'Wi-Fi Store',
      active:   tenant.active,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/store/:tenantId/plans ───────────────────────────
router.get('/:tenantId/plans', async (req, res, next) => {
  try {
    const tenant = await findTenant(req.params.tenantId);
    if (!tenant) return res.status(404).json({ error: 'Store not found' });

    const plansRes = await db.query(
      `SELECT plan_id, label, price, gb, validity
         FROM tenant_plans
        WHERE tenant_id = $1 AND active = true
        ORDER BY price ASC`,
      [tenant.tenant_id]
    );
    res.json({ plans: plansRes.rows.map(publicPlan) });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/store/:tenantId/auth/register ──────────────────
router.post('/:tenantId/auth/register', authLimiter, async (req, res, next) => {
  try {
    const { email, password, name } = req.body || {};
    const result = await registerCustomer({
      tenantId: req.params.tenantId,
      email, password, name,
    });

    const refreshToken = await customerRefresh.issue(result.customerId);
    logger.info('Storefront customer registered', {
      tenantId: result.tenantId, customerId: result.customerId,
    });

    res.status(201).json(issueTokens(res, result, refreshToken));
  } catch (err) {
    next(err);
  }
});

// ── POST /api/store/:tenantId/auth/login ─────────────────────
router.post('/:tenantId/auth/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const cust = await findCustomerByEmail(req.params.tenantId, email);

    // Uniform failure to avoid leaking which emails exist.
    if (!cust || !cust.active ||
        !(await verifyPassword(password || '', cust.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    await db.query('UPDATE customers SET last_login = NOW() WHERE id = $1', [cust.id]);

    const refreshToken = await customerRefresh.issue(cust.id);
    res.json(issueTokens(res, {
      customerId: cust.id,
      tenantId:   cust.tenant_id,
      email:      cust.email,
      name:       cust.name,
    }, refreshToken));
  } catch (err) {
    next(err);
  }
});

// ── POST /api/store/auth/refresh ─────────────────────────────
router.post('/auth/refresh', async (req, res, next) => {
  try {
    const presented = (req.body && req.body.refreshToken) || readCookie(req, REFRESH_COOKIE);
    if (!presented) return res.status(401).json({ error: 'No refresh token' });

    const { customerId, refreshToken } = await customerRefresh.rotate(presented);

    // Reload customer to get current tenant + status.
    const custRes = await db.query(
      'SELECT id, tenant_id, email, name, active FROM customers WHERE id = $1',
      [customerId]
    );
    const cust = custRes.rows[0];
    if (!cust || !cust.active) return res.status(401).json({ error: 'Account disabled' });

    res.json(issueTokens(res, {
      customerId: cust.id,
      tenantId:   cust.tenant_id,
      email:      cust.email,
      name:       cust.name,
    }, refreshToken));
  } catch (err) {
    // Rotation failures (expired/reuse/invalid) are auth failures, not 500s.
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// ── POST /api/store/auth/logout ──────────────────────────────
router.post('/auth/logout', async (req, res, next) => {
  try {
    const presented = (req.body && req.body.refreshToken) || readCookie(req, REFRESH_COOKIE);
    if (presented) await customerRefresh.revoke(presented);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/store/auth' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/store/me ────────────────────────────────────────
// Customer profile + their purchase history + active vouchers. Tenant + id come
// from the JWT (customerAuthRequired), never the URL.
router.get('/me', customerAuthRequired, async (req, res, next) => {
  try {
    const { customerId, tenantId } = req.customer;

    const [custRes, purchasesRes, vouchersRes] = await Promise.all([
      db.query(
        'SELECT id, email, name, created_at FROM customers WHERE id = $1 AND tenant_id = $2',
        [customerId, tenantId]
      ),
      db.query(
        `SELECT plan, amount, reference, date, status
           FROM purchases
          WHERE customer_id = $1 AND tenant_id = $2
          ORDER BY date DESC
          LIMIT 50`,
        [customerId, tenantId]
      ),
      db.query(
        `SELECT plan, code, status, created_at
           FROM vouchers
          WHERE customer_id = $1 AND tenant_id = $2
          ORDER BY created_at DESC
          LIMIT 50`,
        [customerId, tenantId]
      ),
    ]);

    const cust = custRes.rows[0];
    if (!cust) return res.status(404).json({ error: 'Not found' });

    res.json({
      customer: {
        id:        cust.id,
        email:     cust.email,
        name:      cust.name,
        createdAt: cust.created_at,
      },
      purchases: purchasesRes.rows.map(p => ({
        plan:      p.plan,
        amount:    parseFloat(p.amount),
        reference: p.reference,
        date:      p.date,
        status:    p.status,
      })),
      vouchers: vouchersRes.rows.map(v => ({
        plan:      v.plan,
        code:      v.code,
        status:    v.status,
        createdAt: v.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
