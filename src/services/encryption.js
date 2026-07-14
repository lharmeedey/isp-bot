const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    // In development, use a fixed key — in production ENCRYPTION_KEY must be set
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY must be set in production');
    }
    return Buffer.alloc(32, 'dev-key-not-for-production-use!!');
  }
  return Buffer.from(key, 'hex');
}

function encrypt(text) {
  if (!text) return null;
  try {
    const key        = getKey();
    const iv         = crypto.randomBytes(16);
    const cipher     = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted  = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const authTag    = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  } catch (err) {
    // If encryption fails, return plain text with a marker
    // This handles migration from unencrypted to encrypted
    return text;
  }
}

function decrypt(text) {
  if (!text) return null;

  // Check if it looks encrypted (has the iv:tag:data format)
  const parts = text.split(':');
  if (parts.length !== 3) {
    // Not encrypted — plain text (legacy data)
    return text;
  }

  try {
    const key       = getKey();
    const iv        = Buffer.from(parts[0], 'hex');
    const authTag   = Buffer.from(parts[1], 'hex');
    const encrypted = Buffer.from(parts[2], 'hex');
    const decipher  = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
  } catch {
    // Decryption failed — return as-is (handles plain text stored before encryption)
    return text;
  }
}

module.exports = { encrypt, decrypt };