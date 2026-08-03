const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

// Parse a hex-encoded 32-byte key. Returns a Buffer or throws with a clear message.
function parseKey(hex, label) {
  if (!hex) return null;
  let buf;
  try {
    buf = Buffer.from(hex, 'hex');
  } catch {
    throw new Error(`${label} is not valid hex`);
  }
  if (buf.length !== 32) {
    throw new Error(
      `${label} must be 32 bytes (64 hex chars) for aes-256-gcm; got ${buf.length} bytes`
    );
  }
  return buf;
}

// Primary key used for encryption and first-choice decryption.
function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY must be set in production');
    }
    // Development only — deterministic throwaway key.
    return Buffer.alloc(32, 'dev-key-not-for-production-use!!');
  }
  return parseKey(key, 'ENCRYPTION_KEY');
}

// Optional previous key, used only to decrypt data written before a key rotation.
// Set OLD_ENCRYPTION_KEY during a rotation, then remove it once re-encryption is done.
function getOldKey() {
  const key = process.env.OLD_ENCRYPTION_KEY;
  return key ? parseKey(key, 'OLD_ENCRYPTION_KEY') : null;
}

function looksEncrypted(text) {
  if (typeof text !== 'string') return false;
  const parts = text.split(':');
  return parts.length === 3 && parts.every(p => /^[0-9a-fA-F]*$/.test(p) && p.length);
}

function encryptWith(key, text) {
  const iv        = crypto.randomBytes(16);
  const cipher    = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag   = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptWith(key, parts) {
  const iv        = Buffer.from(parts[0], 'hex');
  const authTag   = Buffer.from(parts[1], 'hex');
  const encrypted = Buffer.from(parts[2], 'hex');
  const decipher  = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}

// Encrypt a secret. Throws on failure — we never silently store plaintext.
function encrypt(text) {
  if (text === null || text === undefined || text === '') return null;
  return encryptWith(getKey(), String(text));
}

// Decrypt a secret.
// - Values that were never encrypted (no iv:tag:data shape) are returned as-is,
//   which supports legacy plaintext rows.
// - Encrypted values are decrypted with the current key, then the old key
//   (during rotation). If BOTH fail, we THROW rather than return ciphertext —
//   a wrong key must be loud, not a silent auth failure downstream.
function decrypt(text) {
  if (text === null || text === undefined || text === '') return null;

  if (!looksEncrypted(text)) {
    return text; // legacy plaintext
  }

  const parts = text.split(':');

  try {
    return decryptWith(getKey(), parts);
  } catch (primaryErr) {
    const oldKey = getOldKey();
    if (oldKey) {
      try {
        return decryptWith(oldKey, parts);
      } catch { /* fall through to throw below */ }
    }
    throw new Error(
      'Decryption failed — ENCRYPTION_KEY does not match the data. ' +
      'If you rotated keys, set OLD_ENCRYPTION_KEY and run the re-encryption script.'
    );
  }
}

// True only for values in the iv:tag:data encrypted shape.
function isEncrypted(text) {
  return looksEncrypted(text);
}

module.exports = { encrypt, decrypt, isEncrypted };
