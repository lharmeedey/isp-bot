'use strict';
// One-off: update a single tenant's paystack_secret. Stores PLAINTEXT
// (runtime reads via `decrypt(x) || x`, so plaintext is read as-is and
// avoids the ENCRYPTION_KEY-mismatch risk seen on this tenant).
// Secret is read from env PS_NEW — never hardcoded, never logged.
require('dotenv').config();
const db = require('../src/services/db');

const ident  = process.argv[2];            // slug or tenant_id
const secret = process.env.PS_NEW;

function mask(s) {
  if (!s) return '(none)';
  return `${s.slice(0, 8)}…${s.slice(-4)} (len ${s.length})`;
}

(async () => {
  if (!ident)  throw new Error('usage: node _ps_update.js <slug|tenant_id>  (PS_NEW env = secret)');
  if (!secret) throw new Error('PS_NEW env var not set');
  if (!secret.startsWith('sk_')) throw new Error('secret must start with sk_');

  // Confirm the target resolves to exactly one tenant first.
  const pre = await db.query(
    `SELECT tenant_id, name, active FROM tenants WHERE slug = $1 OR tenant_id = $1`,
    [ident]
  );
  if (pre.rows.length !== 1) {
    throw new Error(`expected exactly 1 tenant for "${ident}", got ${pre.rows.length}`);
  }
  const target = pre.rows[0];
  console.log(`target: ${target.tenant_id} (${target.name}) active=${target.active}`);
  console.log(`new secret: ${mask(secret)}`);

  const upd = await db.query(
    `UPDATE tenants SET paystack_secret = $2
      WHERE tenant_id = $1
      RETURNING tenant_id`,
    [target.tenant_id, secret]
  );
  console.log(`rows updated: ${upd.rowCount}`);

  await db.pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
