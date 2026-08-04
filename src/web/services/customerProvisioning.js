'use strict';

/**
 * Storefront customer provisioning — register/find an end-customer (buyer)
 * WITHIN an existing tenant. Unlike tenantProvisioning (which creates a tenant),
 * this never creates a tenant; it only adds `customers` rows scoped to a
 * tenant_id that already exists and is active.
 *
 * Email is unique per tenant (UNIQUE(tenant_id, email)), so the same person can
 * hold separate accounts at different ISPs from one browser.
 */
const db = require('../../services/db');
const { hashPassword } = require('../auth/password');

/**
 * Confirm a tenant exists and is open for business (active). Returns the row
 * { tenant_id, name, active } or null. Used by public store routes too.
 */
async function findTenant(tenantId) {
  const res = await db.query(
    `SELECT tenant_id, name, active FROM tenants WHERE tenant_id = $1`,
    [String(tenantId || '')]
  );
  return res.rows[0] || null;
}

/**
 * Register a new customer under an existing tenant.
 * Throws { status } on bad email (400), unknown/inactive tenant (404),
 * or duplicate email within the tenant (409).
 * Returns { customerId, tenantId, email, name }.
 */
async function registerCustomer({ tenantId, email, password, name }) {
  const normEmail = String(email || '').trim().toLowerCase();
  if (!normEmail || !normEmail.includes('@')) {
    const e = new Error('A valid email is required');
    e.status = 400;
    throw e;
  }

  const tenant = await findTenant(tenantId);
  if (!tenant || !tenant.active) {
    const e = new Error('This store is not available');
    e.status = 404;
    throw e;
  }

  const passwordHash = await hashPassword(password); // throws if <8 chars

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const dup = await client.query(
      'SELECT 1 FROM customers WHERE tenant_id = $1 AND email = $2',
      [tenant.tenant_id, normEmail]
    );
    if (dup.rows.length) {
      const e = new Error('An account with this email already exists');
      e.status = 409;
      throw e;
    }

    const custRes = await client.query(
      `INSERT INTO customers (tenant_id, email, password_hash, name)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [tenant.tenant_id, normEmail, passwordHash, name ? String(name).trim() : null]
    );

    await client.query('COMMIT');

    return {
      customerId: custRes.rows[0].id,
      tenantId:   tenant.tenant_id,
      email:      normEmail,
      name:       name ? String(name).trim() : null,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Look up a customer by tenant + email for login. Returns the row or null.
 */
async function findCustomerByEmail(tenantId, email) {
  const normEmail = String(email || '').trim().toLowerCase();
  const res = await db.query(
    `SELECT id, tenant_id, email, password_hash, name, active
       FROM customers WHERE tenant_id = $1 AND email = $2`,
    [String(tenantId || ''), normEmail]
  );
  return res.rows[0] || null;
}

async function findCustomerById(customerId) {
  const res = await db.query(
    `SELECT id, tenant_id, email, name, active
       FROM customers WHERE id = $1`,
    [customerId]
  );
  return res.rows[0] || null;
}

module.exports = {
  findTenant,
  registerCustomer,
  findCustomerByEmail,
  findCustomerById,
};
