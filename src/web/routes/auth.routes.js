'use strict';

const express = require('express');
const router  = express.Router();

const db   = require('../../services/db');
const logger = require('../../services/logger');
const { signAccessToken, ACCESS_TTL_SECONDS } = require('../auth/jwt');
const refresh = require('../auth/refresh');
const { verifyPassword, hashPassword } = require('../auth/password');
const {
  registerOperator,
  findOperatorByEmail,
} = require('../services/tenantProvisioning');
const { createOtp, verifyOtp } = require('../services/otp');
const { sendOtpEmail } = require('../services/mailer');
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
        `SELECT tenant_id, slug, name, email, active, onboarding_step, network_provider
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
        slug:            tenant.slug,
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

// ── POST /api/auth/forgot ────────────────────────────────────
// Start a password reset. Always 200 so we never reveal which emails exist.
router.post('/forgot', authLimiter, async (req, res, next) => {
  try {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const op = email ? await findOperatorByEmail(email) : null;

    if (op && op.active) {
      const code = await createOtp({
        subjectType: 'operator',
        subjectId:   op.id,
        email:       op.email,
        purpose:     'reset',
      });
      await sendOtpEmail(op.email, code, 'reset');
      logger.info('Operator password reset requested', { operatorId: op.id });
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/reset ─────────────────────────────────────
router.post('/reset', authLimiter, async (req, res, next) => {
  try {
    const { email, code, newPassword } = req.body || {};
    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'email, code and newPassword are required' });
    }

    await verifyOtp({ subjectType: 'operator', email, purpose: 'reset', code });

    const op = await findOperatorByEmail(email);
    if (!op) return res.status(400).json({ error: 'Invalid or expired code' });

    const passwordHash = await hashPassword(newPassword); // throws if <8 chars
    await db.query('UPDATE operators SET password_hash = $1 WHERE id = $2', [passwordHash, op.id]);
    await refresh.revokeAllForOperator(op.id); // kill every existing session

    logger.info('Operator password reset completed', { operatorId: op.id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/auth/profile ────────────────────────────────────
// Update the tenant's business/display name and/or contact email.
router.put('/profile', authRequired, async (req, res, next) => {
  try {
    const { tenantId } = req.operator;
    const b = req.body || {};

    const sets = [];
    const vals = [];
    let i = 1;
    if (b.name !== undefined) {
      sets.push(`name = $${i++}`);
      vals.push(String(b.name).trim() || null);
    }
    if (b.contactEmail !== undefined) {
      const ce = String(b.contactEmail).trim().toLowerCase();
      if (ce && !ce.includes('@')) return res.status(400).json({ error: 'Invalid contact email' });
      sets.push(`email = $${i++}`);
      vals.push(ce || null);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    vals.push(tenantId);
    await db.query(`UPDATE tenants SET ${sets.join(', ')} WHERE tenant_id = $${i}`, vals);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/auth/password ───────────────────────────────────
// Change password while logged in (requires the current password).
router.put('/password', authRequired, async (req, res, next) => {
  try {
    const { operatorId } = req.operator;
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'currentPassword and newPassword are required' });
    }

    const opRes = await db.query('SELECT password_hash FROM operators WHERE id = $1', [operatorId]);
    const op = opRes.rows[0];
    if (!op || !(await verifyPassword(currentPassword, op.password_hash))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const passwordHash = await hashPassword(newPassword); // throws if <8 chars
    await db.query('UPDATE operators SET password_hash = $1 WHERE id = $2', [passwordHash, operatorId]);
    // Revoke all other sessions, then hand this one a fresh refresh token.
    await refresh.revokeAllForOperator(operatorId);
    const refreshToken = await refresh.issue(operatorId);

    res.json(issueTokens(res, {
      operatorId, tenantId: req.operator.tenantId, role: req.operator.role,
    }, refreshToken));
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/email/change ──────────────────────────────
// Request a login-email change: verify the current password, ensure the new
// address is free, and send an OTP to the NEW address to confirm ownership.
router.post('/email/change', authRequired, async (req, res, next) => {
  try {
    const { operatorId } = req.operator;
    const { newEmail, currentPassword } = req.body || {};
    const normEmail = String(newEmail || '').trim().toLowerCase();

    if (!normEmail || !normEmail.includes('@')) {
      return res.status(400).json({ error: 'A valid new email is required' });
    }
    if (!currentPassword) {
      return res.status(400).json({ error: 'currentPassword is required' });
    }

    const opRes = await db.query('SELECT email, password_hash FROM operators WHERE id = $1', [operatorId]);
    const op = opRes.rows[0];
    if (!op || !(await verifyPassword(currentPassword, op.password_hash))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    if (normEmail === op.email) {
      return res.status(400).json({ error: 'That is already your email' });
    }

    // Global uniqueness across operators.
    const dup = await db.query('SELECT 1 FROM operators WHERE email = $1', [normEmail]);
    if (dup.rows.length) return res.status(409).json({ error: 'That email is already in use' });

    const code = await createOtp({
      subjectType: 'operator',
      subjectId:   operatorId,
      email:       normEmail,      // the destination + lookup key for verify
      purpose:     'email_change',
      newEmail:    normEmail,
    });
    await sendOtpEmail(normEmail, code, 'email_change');

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/email/verify ──────────────────────────────
router.post('/email/verify', authRequired, async (req, res, next) => {
  try {
    const { operatorId } = req.operator;
    const { newEmail, code } = req.body || {};
    const normEmail = String(newEmail || '').trim().toLowerCase();
    if (!normEmail || !code) {
      return res.status(400).json({ error: 'newEmail and code are required' });
    }

    const row = await verifyOtp({
      subjectType: 'operator', email: normEmail, purpose: 'email_change', code,
    });
    if (row.subject_id !== operatorId) {
      return res.status(400).json({ error: 'Invalid code' });
    }

    // Re-check uniqueness at apply time (another account may have taken it).
    const dup = await db.query('SELECT 1 FROM operators WHERE email = $1 AND id <> $2', [normEmail, operatorId]);
    if (dup.rows.length) return res.status(409).json({ error: 'That email is already in use' });

    await db.query('UPDATE operators SET email = $1 WHERE id = $2', [normEmail, operatorId]);
    logger.info('Operator email changed', { operatorId });
    res.json({ ok: true, email: normEmail });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
