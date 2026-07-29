const axios = require('axios');
const https = require('https');

const BASE_URL      = 'https://16.171.67.192:8043';
const OMADAC_ID     = 'ae3846afd47b384710ca7c9cf4ef8011';
const SITE_ID       = '6a6393445c7bdd073c22a2ac';
const CLIENT_ID     = '303276c0206c48348435d0b978f1e528';
const CLIENT_SECRET = '11eac7ad5de24e74a74c1039db851e04';
const GROUP_ID      = '6a64e9565c7bdd073c22b90e';

const agent = new https.Agent({ rejectUnauthorized: false });

async function getToken() {
  const res = await axios.post(
    `${BASE_URL}/openapi/authorize/token?grant_type=client_credentials`,
    { omadacId: OMADAC_ID, client_id: CLIENT_ID, client_secret: CLIENT_SECRET },
    { httpsAgent: agent, headers: { 'Content-Type': 'application/json' } }
  );
  if (res.data.errorCode !== 0) throw new Error('Token failed');
  return res.data.result.accessToken;
}

async function tryPost(token, path, body, label) {
  console.log(`\nPOST ${label || path}`);
  try {
    const res = await axios.post(`${BASE_URL}${path}`, body, {
      httpsAgent: agent,
      timeout:    10000,
      headers: {
        Authorization:  `AccessToken=${token}`,
        'Content-Type': 'application/json',
      },
    });
    console.log('Response:', JSON.stringify(res.data, null, 2));
    return res.data;
  } catch (e) {
    console.log(`❌ ${e.response?.status}: ${JSON.stringify(e.response?.data || e.message)}`);
  }
}

async function tryGet(token, path, label) {
  console.log(`\nGET ${label || path}`);
  try {
    const res = await axios.get(`${BASE_URL}${path}`, {
      httpsAgent: agent,
      timeout:    10000,
      headers:    { Authorization: `AccessToken=${token}` },
    });
    console.log('Response:', JSON.stringify(res.data, null, 2).slice(0, 1000));
    return res.data;
  } catch (e) {
    console.log(`❌ ${e.response?.status}: ${JSON.stringify(e.response?.data || e.message)}`);
  }
}

async function main() {
  const token = await getToken();
  console.log('✅ Token OK');

  // ── Internal API — list vouchers ──────────────
  await tryGet(token,
    `/${OMADAC_ID}/api/v2/hotspot/sites/${SITE_ID}/vouchers?page=1&pageSize=10&currentPage=1&currentPageSize=10`,
    'internal v2 list vouchers'
  );

  // ── Internal API — create voucher variations ──
  await tryPost(token,
    `/${OMADAC_ID}/api/v2/hotspot/sites/${SITE_ID}/vouchers`,
    { voucherGroupId: GROUP_ID, amount: 1 },
    'internal v2 create (amount)'
  );

  await tryPost(token,
    `/${OMADAC_ID}/api/v2/hotspot/sites/${SITE_ID}/vouchers`,
    { voucherGroupId: GROUP_ID, count: 1 },
    'internal v2 create (count)'
  );

  await tryPost(token,
    `/${OMADAC_ID}/api/v2/hotspot/sites/${SITE_ID}/vouchers`,
    { groupId: GROUP_ID, amount: 1 },
    'internal v2 create (groupId)'
  );

  await tryPost(token,
    `/${OMADAC_ID}/api/v2/hotspot/sites/${SITE_ID}/vouchers`,
    { id: GROUP_ID, amount: 1 },
    'internal v2 create (id)'
  );

  await tryPost(token,
    `/${OMADAC_ID}/api/v2/hotspot/sites/${SITE_ID}/vouchers`,
    { voucherGroupId: GROUP_ID, number: 1 },
    'internal v2 create (number)'
  );

  // ── Internal API — try print endpoint ─────────
  await tryPost(token,
    `/${OMADAC_ID}/api/v2/hotspot/sites/${SITE_ID}/vouchers/print`,
    { voucherGroupId: GROUP_ID, amount: 1 },
    'internal v2 print vouchers'
  );

  // ── Internal API — try generate endpoint ──────
  await tryPost(token,
    `/${OMADAC_ID}/api/v2/hotspot/sites/${SITE_ID}/vouchers/generate`,
    { voucherGroupId: GROUP_ID, amount: 1 },
    'internal v2 generate vouchers'
  );

  // ── Check what the list returns (full data) ───
  console.log('\n\n=== FULL LIST RESPONSE ===');
  const listRes = await axios.get(
    `${BASE_URL}/${OMADAC_ID}/api/v2/hotspot/sites/${SITE_ID}/vouchers?page=1&pageSize=5&currentPage=1&currentPageSize=5`,
    {
      httpsAgent: agent,
      headers:    { Authorization: `AccessToken=${token}` },
    }
  );
  console.log(JSON.stringify(listRes.data, null, 2));
}

main().catch(e => console.error('Fatal:', e.message));