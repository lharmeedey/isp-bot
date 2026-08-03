/**
 * Re-encrypt all tenant secrets from OLD_ENCRYPTION_KEY to ENCRYPTION_KEY.
 *
 * Rotating ENCRYPTION_KEY without this step BRICKS every tenant bot: their
 * stored secrets were encrypted with the old key and can no longer be
 * decrypted. This script decrypts each secret with the old key and
 * re-encrypts it with the new key, inside one transaction.
 *
 * Usage (run once, BEFORE removing OLD_ENCRYPTION_KEY):
 *   OLD_ENCRYPTION_KEY=<current key>  ENCRYPTION_KEY=<new key>  \
 *     node src/services/rotateKey.js
 *
 * To generate a new key:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * After it prints success, update ENCRYPTION_KEY in your env to the new key
 * and remove OLD_ENCRYPTION_KEY, then redeploy.
 */
require('dotenv').config();
const db = require('./db');
const { encrypt, decrypt } = require('./encryption');

// Columns in `tenants` that hold encrypted secrets.
const ENCRYPTED_COLUMNS = [
  'bot_token',
  'paystack_secret',
  'paystack_public',
  'omada_client_id',
  'omada_client_secret',
  'omada_admin_username',
  'omada_admin_password',
  'mikrotik_username',
  'mikrotik_password',
];

async function rotate() {
  if (!process.env.OLD_ENCRYPTION_KEY) {
    console.error('❌ OLD_ENCRYPTION_KEY is not set. Set it to the CURRENT key before rotating.');
    process.exit(1);
  }
  if (!process.env.ENCRYPTION_KEY) {
    console.error('❌ ENCRYPTION_KEY (the new key) is not set.');
    process.exit(1);
  }
  if (process.env.OLD_ENCRYPTION_KEY === process.env.ENCRYPTION_KEY) {
    console.error('❌ OLD_ENCRYPTION_KEY and ENCRYPTION_KEY are identical — nothing to rotate.');
    process.exit(1);
  }

  const client = await db.getClient();
  let changed = 0;
  try {
    await client.query('BEGIN');

    const { rows } = await client.query('SELECT * FROM tenants');
    console.log(`Found ${rows.length} tenant(s) to process.`);

    for (const tenant of rows) {
      const updates = [];
      const values  = [];
      let idx = 1;

      for (const col of ENCRYPTED_COLUMNS) {
        const current = tenant[col];
        if (!current) continue;

        // decrypt() tries the new key first, then OLD_ENCRYPTION_KEY.
        // If both fail it throws — we abort the whole rotation rather than
        // corrupt data.
        let plain;
        try {
          plain = decrypt(current);
        } catch (err) {
          throw new Error(
            `Could not decrypt ${col} for tenant ${tenant.tenant_id}: ${err.message}`
          );
        }

        const reEncrypted = encrypt(plain);
        if (reEncrypted !== current) {
          updates.push(`${col}=$${idx++}`);
          values.push(reEncrypted);
        }
      }

      if (updates.length) {
        values.push(tenant.tenant_id);
        await client.query(
          `UPDATE tenants SET ${updates.join(', ')} WHERE tenant_id=$${idx}`,
          values
        );
        changed += updates.length;
        console.log(`  ✅ ${tenant.name} (${tenant.tenant_id}) — ${updates.length} secret(s) re-encrypted`);
      } else {
        console.log(`  – ${tenant.name} (${tenant.tenant_id}) — nothing to change`);
      }
    }

    await client.query('COMMIT');
    console.log(`\n✅ Rotation complete. ${changed} secret(s) re-encrypted across ${rows.length} tenant(s).`);
    console.log('Now set ENCRYPTION_KEY to the new key in your env, remove OLD_ENCRYPTION_KEY, and redeploy.');
    process.exit(0);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`\n❌ Rotation failed and was rolled back: ${err.message}`);
    console.error('No data was changed. Fix the issue and re-run.');
    process.exit(1);
  } finally {
    client.release();
  }
}

rotate();
