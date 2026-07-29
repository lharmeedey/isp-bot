const axios = require('axios');
const https = require('https');

const BASE_URL      = 'https://16.171.67.192:8043';
const OMADAC_ID     = 'ae3846afd47b384710ca7c9cf4ef8011';
const SITE_ID       = '6a6393445c7bdd073c22a2ac';
const CLIENT_ID     = '303276c0206c48348435d0b978f1e528';
const CLIENT_SECRET = '11eac7ad5de24e74a74c1039db851e04';

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

async function tryGet(token, path) {
  process.stdout.write(`GET ${path}\n`);
  try {
    const res = await axios.get(`${BASE_URL}${path}`, {
      httpsAgent: agent,
      timeout:    8000,
      headers:    { Authorization: `AccessToken=${token}` },
    });
    console.log('Response:', JSON.stringify(res.data, null, 2));
    return res.data;
  } catch (e) {
    console.log(`❌ ${e.response?.status}: ${JSON.stringify(e.response?.data)}`);
  }
}

async function tryPost(token, path, body) {
  process.stdout.write(`POST ${path}\n`);
  try {
    const res = await axios.post(`${BASE_URL}${path}`, body, {
      httpsAgent: agent,
      timeout:    8000,
      headers: {
        Authorization:  `AccessToken=${token}`,
        'Content-Type': 'application/json',
      },
    });
    console.log('Response:', JSON.stringify(res.data, null, 2));
    return res.data;
  } catch (e) {
    console.log(`❌ ${e.response?.status}: ${JSON.stringify(e.response?.data)}`);
  }
}

async function main() {
  const token = await getToken();
  console.log('✅ Token OK\n');

  // 1. Get all voucher groups with full details
  await tryGet(token,
    `/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/hotspot/voucher-groups?page=1&pageSize=10`
  );

  // 2. Try printing vouchers (some Omada versions expose this)
  await tryPost(token,
    `/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/hotspot/vouchers/print`,
    { voucherGroupId: '6a64e9565c7bdd073c22b90e', amount: 1 }
  );

  // 3. Try batch endpoint
  await tryPost(token,
    `/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/hotspot/vouchers/batch`,
    { voucherGroupId: '6a64e9565c7bdd073c22b90e', amount: 1 }
  );

  // 4. Try generate endpoint
  await tryPost(token,
    `/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/hotspot/vouchers/generate`,
    { voucherGroupId: '6a64e9565c7bdd073c22b90e', amount: 1 }
  );

  // 5. Try with GET on voucher-groups including vouchers
  await tryGet(token,
    `/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/hotspot/voucher-groups?page=1&pageSize=10&withVouchers=true`
  );

  // 6. Try different voucher listing with groupId as query param
  await tryGet(token,
    `/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/hotspot/voucher-groups/6a64e9565c7bdd073c22b90e/vouchers?page=1&pageSize=10&status=unused`
  );
}

main().catch(e => console.error('Fatal:', e.message));