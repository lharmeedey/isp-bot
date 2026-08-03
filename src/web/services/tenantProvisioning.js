'use strict';

/**
 * Web self-service tenant provisioning — the no-Telegram counterpart to the
 * super-admin /addtenant wizard. Creates a tenants row (inactive, created_via
 * 'web', no bot_token so launchAllTenants never starts a bot for it) plus an
 * operators row, atomically in one transaction.
 */
const crypto = require('crypto');
const db     = require('../../services/db');
const { hashPassword } = require('../auth/password');

// tenant_id: url-safe, unique-ish, human-readable-ish. e.g. "t_9f3a1c8b2d4e"
function generateTenantId() {
  return 't_' + crypto.randomBytes(6).toString('hex');
}

/**
 * Register a new operator + tenant.
 * Throws { status: 409 } if the email is already registered.
 * Returns { tenantId, operatorId, role }.
 */
async function registerOperator({ businessName, email, password }) {
  const normEmail = String(email || '').trim().toLowerCase();
  if (!normEmail || !normEmail.includes('@')) {
    const e = new Error('A valid email is required');
    e.status = 400;
    throw e;
  }

  const passwordHash = await hashPassword(password); // throws if <8 chars

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Email uniqueness across all operators.
    const dup = await client.query(
      'SELECT 1 FROM operators WHERE email = $1',
      [normEmail]
    );
    if (dup.rows.length) {
      const e = new Error('An account with this email already exists');
      e.status = 409;
      throw e;
    }

    // Generate a tenant_id that isn't taken (retry on the tiny chance of clash).
    let tenantId;
    for (let i = 0; i < 5; i++) {
      const candidate = generateTenantId();
      const taken = await client.query(
        'SELECT 1 FROM tenants WHERE tenant_id = $1',
        [candidate]
      );
      if (!taken.rows.length) { tenantId = candidate; break; }
    }
    if (!tenantId) throw new Error('Could not allocate a tenant id');

    await client.query(
      `INSERT INTO tenants (tenant_id, name, email, active, created_via, onboarding_step, network_provider)
       VALUES ($1, $2, $3, false, 'web', 'provider', 'none')`,
      [tenantId, businessName || null, normEmail]
    );

    const opRes = await client.query(
      `INSERT INTO operators (tenant_id, email, password_hash, role)
       VALUES ($1, $2, $3, 'owner')
       RETURNING id, role`,
      [tenantId, normEmail, passwordHash]
    );

    await client.query('COMMIT');

    return {
      tenantId,
      operatorId: opRes.rows[0].id,
      role:       opRes.rows[0].role,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Look up an operator by email for login. Returns the row or null.
 */
async function findOperatorByEmail(email) {
  const normEmail = String(email || '').trim().toLowerCase();
  const res = await db.query(
    `SELECT id, tenant_id, email, password_hash, role, active
       FROM operators WHERE email = $1`,
    [normEmail]
  );
  return res.rows[0] || null;
}

async function findOperatorById(operatorId) {
  const res = await db.query(
    `SELECT id, tenant_id, email, role, active FROM operators WHERE id = $1`,
    [operatorId]
  );
  return res.rows[0] || null;
}

module.exports = {
  registerOperator,
  findOperatorByEmail,
  findOperatorById,
  generateTenantId,
};
