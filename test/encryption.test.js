'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

// Two distinct valid 32-byte keys (64 hex chars) for round-trip + rotation tests.
const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

// getKey()/getOldKey() read process.env at call time, so setting these before
// each call is enough — no need to re-require the module.
function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const { encrypt, decrypt, isEncrypted } = require('../src/services/encryption');

test('encrypt -> decrypt round-trips with the current key', () => {
  withEnv({ ENCRYPTION_KEY: KEY_A, OLD_ENCRYPTION_KEY: undefined }, () => {
    const secret = 'sk_live_super_secret_token';
    const enc    = encrypt(secret);

    assert.notStrictEqual(enc, secret, 'ciphertext must differ from plaintext');
    assert.ok(isEncrypted(enc), 'output should be in iv:tag:data shape');
    assert.strictEqual(decrypt(enc), secret);
  });
});

test('encrypt is non-deterministic (random IV per call)', () => {
  withEnv({ ENCRYPTION_KEY: KEY_A, OLD_ENCRYPTION_KEY: undefined }, () => {
    const a = encrypt('same-input');
    const b = encrypt('same-input');
    assert.notStrictEqual(a, b, 'two encryptions of the same value must differ');
    assert.strictEqual(decrypt(a), 'same-input');
    assert.strictEqual(decrypt(b), 'same-input');
  });
});

test('empty/null/undefined encrypt and decrypt to null', () => {
  withEnv({ ENCRYPTION_KEY: KEY_A }, () => {
    assert.strictEqual(encrypt(''), null);
    assert.strictEqual(encrypt(null), null);
    assert.strictEqual(encrypt(undefined), null);
    assert.strictEqual(decrypt(''), null);
    assert.strictEqual(decrypt(null), null);
    assert.strictEqual(decrypt(undefined), null);
  });
});

test('legacy plaintext (no iv:tag:data shape) is returned unchanged', () => {
  withEnv({ ENCRYPTION_KEY: KEY_A }, () => {
    assert.strictEqual(decrypt('plain-legacy-token'), 'plain-legacy-token');
    assert.strictEqual(isEncrypted('plain-legacy-token'), false);
  });
});

test('a wrong key THROWS instead of silently returning ciphertext', () => {
  const enc = withEnv({ ENCRYPTION_KEY: KEY_A, OLD_ENCRYPTION_KEY: undefined },
    () => encrypt('confidential'));

  withEnv({ ENCRYPTION_KEY: KEY_B, OLD_ENCRYPTION_KEY: undefined }, () => {
    assert.throws(() => decrypt(enc), /Decryption failed/);
  });
});

test('rotation: data encrypted with the old key decrypts via OLD_ENCRYPTION_KEY', () => {
  const enc = withEnv({ ENCRYPTION_KEY: KEY_A, OLD_ENCRYPTION_KEY: undefined },
    () => encrypt('rotate-me'));

  // Now the primary key is B, but A is provided as the old key.
  withEnv({ ENCRYPTION_KEY: KEY_B, OLD_ENCRYPTION_KEY: KEY_A }, () => {
    assert.strictEqual(decrypt(enc), 'rotate-me');
  });
});

test('parseKey rejects a key of the wrong length', () => {
  withEnv({ ENCRYPTION_KEY: 'deadbeef', NODE_ENV: 'test' }, () => {
    assert.throws(() => encrypt('x'), /32 bytes/);
  });
});

test('isEncrypted only accepts the iv:tag:data hex shape', () => {
  withEnv({ ENCRYPTION_KEY: KEY_A }, () => {
    assert.strictEqual(isEncrypted(encrypt('hello')), true);
  });
  assert.strictEqual(isEncrypted('a:b'), false);
  assert.strictEqual(isEncrypted('nothex:nothex:nothex'), false);
  assert.strictEqual(isEncrypted(''), false);
  assert.strictEqual(isEncrypted(null), false);
  assert.strictEqual(isEncrypted(12345), false);
});
