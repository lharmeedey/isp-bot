'use strict';

/**
 * Minimal HS256 JWT — sign + verify, built on Node crypto. No external deps.
 * Used only for short-lived ACCESS tokens; refresh tokens are opaque random
 * strings stored (hashed) in the DB (see refresh.js).
 */
const crypto = require('crypto');

const ACCESS_TTL_SECONDS = 15 * 60; // 15 minutes

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be set in production');
    }
    return 'dev-jwt-secret-not-for-production';
  }
  return secret;
}

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function b64urlJson(obj) {
  return b64url(JSON.stringify(obj));
}

function sign(part, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(part)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Issue an access token.
 * payload should carry at least { operatorId, tenantId, role }.
 */
function signAccessToken(payload, ttlSeconds = ACCESS_TTL_SECONDS) {
  const now    = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body   = { ...payload, iat: now, exp: now + ttlSeconds };

  const head    = b64urlJson(header);
  const claims  = b64urlJson(body);
  const data    = `${head}.${claims}`;
  const sigPart = sign(data, getSecret());

  return `${data}.${sigPart}`;
}

/**
 * Verify + decode an access token.
 * Returns the payload object, or throws on bad signature / expiry / shape.
 */
function verifyAccessToken(token) {
  if (typeof token !== 'string') throw new Error('No token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');

  const [head, claims, sig] = parts;
  const expectedSig = sign(`${head}.${claims}`, getSecret());

  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('Invalid signature');
  }

  let payload;
  try {
    payload = JSON.parse(
      Buffer.from(claims.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    );
  } catch {
    throw new Error('Malformed claims');
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) {
    throw new Error('Token expired');
  }

  return payload;
}

module.exports = { signAccessToken, verifyAccessToken, ACCESS_TTL_SECONDS };
