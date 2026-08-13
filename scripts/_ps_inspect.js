'use strict';
// READ-ONLY diagnostic. Prints masked state of tenants.paystack_secret and
// whether the local ENCRYPTION_KEY can decrypt existing encrypted secrets.
// Never prints a secret value.
require('dotenv').config();
const db = require('../src/services/db');
const { decrypt, isEncrypted } = require('../src/services/encryption');

function classify(raw) {
  if (raw === null || raw === undefined || raw === '') return { state: 'NULL' };
  if (!isEncrypted(raw)) {
    // legacy plaintext — report shape only, never the value
    const kind = /^sk_live/.test(raw) ? 'sk_live' : /^sk_test/.test(raw) ? 'sk_test'
               : /^sk_/.test(raw) ? 'sk_?' : 'non-sk';
    return { state: 'PLAINTEXT', kind };
  }
  // encrypted — try local key
  try {
    const v = decrypt(raw);
    const kind = /^sk_live/.test(v) ? 'sk_live' : /^sk_test/.test(v) ? 'sk_test'
               : /^sk_/.test(v) ? 'sk_?' : 'non-sk';
    return { state: 'ENCRYPTED', keyMatch: true, kind };
  } catch {
    return { state: 'ENCRYPTED', keyMatch: false };
  }
}

(async () => {
  const { rows } = await db.query(
    `SELECT tenant_id, name, slug, active, paystack_secret,
            paystack_public IS NOT NULL AS has_pub
       FROM tenants ORDER BY active DESC, name`
  );
  console.log(`ENCRYPTION_KEY present locally: ${!!process.env.ENCRYPTION_KEY}`);
  console.log(`tenants: ${rows.length}\n`);
  for (const t of rows) {
    const c = classify(t.paystack_secret);
    const bits = [c.state];
    if (c.kind) bits.push(c.kind);
    if (c.state === 'ENCRYPTED') bits.push(c.keyMatch ? 'KEYMATCH:ok' : 'KEYMATCH:FAIL');
    console.log(
      `${(t.active ? '●' : '○')} ${String(t.tenant_id).padEnd(14)} ` +
      `slug=${String(t.slug || '—').padEnd(20)} ` +
      `secret=[${bits.join(' ')}] pub=${t.has_pub ? 'y' : 'n'}  ${t.name || ''}`
    );
  }
  await db.pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
