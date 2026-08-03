'use strict';

/**
 * Password hashing using Node's built-in scrypt — no native deps, no external
 * packages. scrypt is a memory-hard KDF recommended by the Node crypto docs.
 *
 * Stored format:  scrypt$N$r$p$<saltHex>$<hashHex>
 * The parameters are embedded so they can be tuned later without breaking
 * existing hashes.
 */
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

// cost params — N must be a power of 2. These are solid interactive-login defaults.
const N       = 16384; // CPU/memory cost
const r       = 8;     // block size
const p       = 1;     // parallelization
const KEYLEN  = 64;
const SALTLEN = 16;

async function hashPassword(plain) {
  if (typeof plain !== 'string' || plain.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const salt = crypto.randomBytes(SALTLEN);
  const key  = await scrypt(plain, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(plain, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const salt   = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');

  let derived;
  try {
    derived = await scrypt(plain, salt, expected.length, {
      N: Number(nStr),
      r: Number(rStr),
      p: Number(pStr),
    });
  } catch {
    return false;
  }

  // constant-time compare; timingSafeEqual throws if lengths differ
  return derived.length === expected.length &&
    crypto.timingSafeEqual(derived, expected);
}

module.exports = { hashPassword, verifyPassword };
