require('dotenv').config();
const db = require('./db');
const { encrypt } = require('./encryption');
const axios = require('axios');

// Usage (PowerShell):
//   $env:PS_TENANT="t_8fd7ca5ed4c1"; $env:PS_KEY="sk_test_xxxxxxxx"; node src/services/update-paystack.js
//
// Reads the key from an env var (not a CLI arg) so it stays out of shell history.
// Validates against Paystack BEFORE saving, so a bad key is never stored.

(async () => {
  const tenantId = (process.env.PS_TENANT || '').trim();
  const key = (process.env.PS_KEY || '').trim();

  if (!tenantId || !key) {
    console.error('Set PS_TENANT and PS_KEY env vars first. Aborting.');
    process.exit(1);
  }
  if (!/^sk_(test|live)_/.test(key)) {
    console.error('That does not look like a Paystack SECRET key (should start with sk_test_ or sk_live_). Aborting.');
    process.exit(1);
  }

  // 1) Validate the key with a live Paystack call before touching the DB.
  console.log('Validating key with Paystack...');
  try {
    await axios.post(
      'https://api.paystack.co/transaction/initialize',
      { email: 'validation@example.com', amount: 100000 },
      { headers: { Authorization: `Bearer ${key}` } }
    );
    console.log('✅ Paystack accepted the key.');
  } catch (e) {
    const msg = e.response ? JSON.stringify(e.response.data) : e.message;
    console.error('❌ Paystack rejected the key — NOT saving. Response:', msg);
    process.exit(1);
  }

  // 2) Save it (trimmed + encrypted).
  const res = await db.query(
    'UPDATE tenants SET paystack_secret = $1 WHERE tenant_id = $2',
    [encrypt(key), tenantId]
  );
  if (res.rowCount === 1) {
    console.log(`✅ Updated paystack_secret for ${tenantId}. Checkout will now work.`);
  } else {
    console.error(`⚠️  No tenant matched ${tenantId}. Nothing changed.`);
  }
  process.exit();
})();
