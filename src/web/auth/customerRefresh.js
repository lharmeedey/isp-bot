'use strict';

/**
 * Customer refresh tokens — the storefront counterpart to auth/refresh.js.
 * Identical rotation/reuse-detection logic, but keyed on customer_id and stored
 * in customer_refresh_tokens. Kept separate from the operator refresh path so
 * neither can ever revoke or rotate the other's tokens.
 *
 * Opaque random strings handed to the client; only their SHA-256 hash is stored.
 *  - issue         create a new token for a customer
 *  - rotate        verify + revoke the presented token, issue a fresh one
 *  - revoke        explicit logout
 *  - reuse-detect  if a revoked token is presented again, revoke the customer's
 *                  whole active chain (a stolen token was replayed)
 */
const crypto = require('crypto');
const db     = require('../../services/db');

const REFRESH_TTL_DAYS = 30;

function newRawToken() {
  return crypto.randomBytes(48).toString('hex');
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function issue(customerId) {
  const raw       = newRawToken();
  const tokenHash = hashToken(raw);
  const expires   = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO customer_refresh_tokens (customer_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [customerId, tokenHash, expires.toISOString()]
  );

  return raw;
}

async function revokeAllForCustomer(customerId) {
  await db.query(
    `UPDATE customer_refresh_tokens SET revoked_at = NOW()
     WHERE customer_id = $1 AND revoked_at IS NULL`,
    [customerId]
  );
}

async function revoke(raw) {
  const tokenHash = hashToken(raw);
  await db.query(
    `UPDATE customer_refresh_tokens SET revoked_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash]
  );
}

/**
 * Rotate a presented refresh token.
 * Returns { customerId, refreshToken } on success, or throws.
 * On reuse of an already-revoked token, revokes the whole chain and throws.
 */
async function rotate(raw) {
  const tokenHash = hashToken(raw);

  const res = await db.query(
    `SELECT id, customer_id, expires_at, revoked_at
       FROM customer_refresh_tokens
      WHERE token_hash = $1`,
    [tokenHash]
  );

  if (!res.rows.length) {
    throw new Error('Invalid refresh token');
  }

  const row = res.rows[0];

  // Reuse detection: a token that was already revoked is being presented again.
  if (row.revoked_at) {
    await revokeAllForCustomer(row.customer_id);
    throw new Error('Refresh token reuse detected');
  }

  if (new Date(row.expires_at) < new Date()) {
    throw new Error('Refresh token expired');
  }

  // Revoke the presented token and issue a fresh one (rotation).
  await db.query(
    `UPDATE customer_refresh_tokens SET revoked_at = NOW() WHERE id = $1`,
    [row.id]
  );

  const refreshToken = await issue(row.customer_id);
  return { customerId: row.customer_id, refreshToken };
}

module.exports = {
  issue,
  rotate,
  revoke,
  revokeAllForCustomer,
  REFRESH_TTL_DAYS,
};
