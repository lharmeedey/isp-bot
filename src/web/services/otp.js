'use strict';

/**
 * otp — one-time 6-digit codes for password reset and email-change verification,
 * for both operators and customers.
 *
 * Security model (mirrors auth/refresh.js): only a SHA-256 hash of the code is
 * stored, codes are single-use, short-lived (10 min), and attempt-capped (5).
 * Requesting a new code for the same (subjectType, email, purpose) invalidates
 * any earlier unconsumed codes so only the newest is ever valid.
 *
 * A 6-digit code is low entropy, so these three limits together — short TTL,
 * attempt cap, and the authLimiter fronting the routes — are what make it safe.
 */
const crypto = require('crypto');
const db     = require('../../services/db');

const TTL_MS       = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

function generateCode() {
  // 000000–999999, always 6 digits.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

/**
 * Create and persist an OTP; returns the RAW code for the mailer to send.
 * Invalidates prior unconsumed codes for the same subject/email/purpose.
 */
async function createOtp({ subjectType, subjectId = null, tenantId = null, email, purpose, newEmail = null }) {
  const normEmail = String(email).trim().toLowerCase();

  // Invalidate older unconsumed codes for this target.
  await db.query(
    `UPDATE otp_codes SET consumed_at = NOW()
      WHERE subject_type = $1 AND email = $2 AND purpose = $3 AND consumed_at IS NULL`,
    [subjectType, normEmail, purpose]
  );

  const code    = generateCode();
  const expires = new Date(Date.now() + TTL_MS);

  await db.query(
    `INSERT INTO otp_codes
       (subject_type, subject_id, tenant_id, purpose, email, new_email, code_hash, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [subjectType, subjectId, tenantId, purpose, normEmail,
     newEmail ? String(newEmail).trim().toLowerCase() : null,
     hashCode(code), expires.toISOString()]
  );

  return code;
}

/**
 * Verify a presented code. On success marks it consumed and returns the row
 * ({ subject_id, tenant_id, new_email, ... }). Throws an Error with .status=400
 * on any failure (invalid / expired / too many attempts).
 */
async function verifyOtp({ subjectType, email, purpose, code }) {
  const normEmail = String(email).trim().toLowerCase();

  const res = await db.query(
    `SELECT * FROM otp_codes
      WHERE subject_type = $1 AND email = $2 AND purpose = $3 AND consumed_at IS NULL
      ORDER BY id DESC
      LIMIT 1`,
    [subjectType, normEmail, purpose]
  );

  const fail = (msg) => {
    const e = new Error(msg);
    e.status = 400;
    return e;
  };

  const row = res.rows[0];
  if (!row) throw fail('Invalid or expired code');

  if (new Date(row.expires_at) < new Date()) {
    await db.query('UPDATE otp_codes SET consumed_at = NOW() WHERE id = $1', [row.id]);
    throw fail('Code has expired, request a new one');
  }

  if (row.attempts >= MAX_ATTEMPTS) {
    await db.query('UPDATE otp_codes SET consumed_at = NOW() WHERE id = $1', [row.id]);
    throw fail('Too many attempts, request a new code');
  }

  const presented = hashCode(code || '');
  const a = Buffer.from(presented);
  const b = Buffer.from(row.code_hash);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!ok) {
    await db.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
    throw fail('Invalid code');
  }

  await db.query('UPDATE otp_codes SET consumed_at = NOW() WHERE id = $1', [row.id]);
  return row;
}

module.exports = { createOtp, verifyOtp, MAX_ATTEMPTS };
