'use strict';

const express = require('express');
const router  = express.Router();

const db   = require('../../services/db');
const logger = require('../../services/logger');
const { signAccessToken, ACCESS_TTL_SECONDS } = require('../auth/jwt');
const refresh = require('../auth/refresh');
const { verifyPassword } = require('../auth/password');
const {
  registerOperator,
  findOperatorByEmail,
} = require('../services/tenantProvisioning');
const authRequired = require('../middleware/authRequired');
const { authLimiter } = require('../middleware/rateLimit');

const REFRESH_COOKIE = 'rt';

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path:     '/api/auth',
    maxAge:   refresh.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
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

function issueTokens(res, { operatorId, tenantId, role }, refreshToken) {
  const accessToken = signAccessToken({ operatorId, tenantId, role });
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  return {
    accessToken,
    // Also return the refresh token in the body for non-browser API clients.
    refreshToken,
    expiresIn: ACCESS_TTL_SECONDS,
    tenantId,
    role,
  };
}

// ── POST /api/auth/register ──────────────────────────────────
router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const { businessName, email, password } = req.body || {};
    const { tenantId, operatorId, role } = await registerOperator({
      businessName, email, password,
    });

    const refreshToken = await refresh.issue(operatorId);
    logger.info('Web operator registered', { tenantId, operatorId });

    res.status(201).json(issueTokens(res, { operatorId, tenantId, role }, refreshToken));
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/login ─────────────────────────────────────
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const op = await findOperatorByEmail(email);

    // Uniform failure to avoid leaking which emails exist.
    if (!op || !op.active || !(await verifyPassword(password || '', op.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    await db.query('UPDATE operators SET last_login = NOW() WHERE id = $1', [op.id]);

    const refreshToken = await refresh.issue(op.id);
    res.json(issueTokens(res, {
      operatorId: op.id, tenantId: op.tenant_id, role: op.role,
    }, refreshToken));
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/refresh ───────────────────────────────────
router.post('/refresh', async (req, res, next) => {
  try {
    const presented = (req.body && req.body.refreshToken) || readCookie(req, REFRESH_COOKIE);
    if (!presented) return res.status(401).json({ error: 'No refresh token' });

    const { operatorId, refreshToken } = await refresh.rotate(presented);

    // Reload operator to get current tenant/role.
    const opRes = await db.query(
      'SELECT id, tenant_id, role, active FROM operators WHERE id = $1',
      [operatorId]
    );
    const op = opRes.rows[0];
    if (!op || !op.active) return res.status(401).json({ error: 'Account disabled' });

    res.json(issueTokens(res, {
      operatorId: op.id, tenantId: op.tenant_id, role: op.role,
    }, refreshToken));
  } catch (err) {
    // Rotation failures (expired/reuse/invalid) are auth failures, not 500s.
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// ── POST /api/auth/logout ────────────────────────────────────
router.post('/logout', async (req, res, next) => {
  try {
    const presented = (req.body && req.body.refreshToken) || readCookie(req, REFRESH_COOKIE);
    if (presented) await refresh.revoke(presented);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────
router.get('/me', authRequired, async (req, res, next) => {
  try {
    const { operatorId, tenantId } = req.operator;
    const [opRes, tenantRes] = await Promise.all([
      db.query('SELECT id, email, role FROM operators WHERE id = $1', [operatorId]),
      db.query(
        `SELECT tenant_id, name, email, active, onboarding_step, network_provider
           FROM tenants WHERE tenant_id = $1`,
        [tenantId]
      ),
    ]);

    const op     = opRes.rows[0];
    const tenant = tenantRes.rows[0];
    if (!op || !tenant) return res.status(404).json({ error: 'Not found' });

    res.json({
      operator: { id: op.id, email: op.email, role: op.role },
      tenant: {
        tenantId:        tenant.tenant_id,
        name:            tenant.name,
        email:           tenant.email,
        active:          tenant.active,
        onboardingStep:  tenant.onboarding_step,
        networkProvider: tenant.network_provider,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
