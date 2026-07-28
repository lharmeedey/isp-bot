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
  if (res.data.errorCode !== 0) throw new Error('Token failed: ' + JSON.stringify(res.data));
  return res.data.result.accessToken;
}

async function tryEndpoint(token, method, path, body = null) {
  const url = `${BASE_URL}${path}`;
  process.stdout.write(`${method} ${path} ... `);
  try {
    const config = {
      method,
      url,
      httpsAgent: agent,
      timeout:    8000,
      headers: {
        Authorization:  `AccessToken=${token}`,
        'Content-Type': 'application/json',
      },
    };
    if (body) config.data = body;
    const res = await axios(config);
    if (res.data?.errorCode === 0) {
      console.log('✅ SUCCESS');
      console.log(JSON.stringify(res.data, null, 2));
      return true;
    }
    console.log(`❌ errorCode ${res.data?.errorCode}: ${res.data?.msg}`);
  } catch (e) {
    console.log(`❌ ${e.response?.status || e.message}`);
  }
  return false;
}

async function main() {
  console.log('Getting token...');
  const token = await getToken();
  console.log('✅ Token OK\n');

  const body1 = { voucherGroupId: GROUP_ID, amount: 1 };
  const body2 = { groupId: GROUP_ID, count: 1 };
  const body3 = { voucherGroupId: GROUP_ID, count: 1 };
  const body4 = { id: GROUP_ID, amount: 1 };

  const paths = [
    // v1 paths
    [`/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/hotspot/vouchers`,              body1],
    [`/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/hotspot/vouchers`,              body2],
    [`/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/hotspot/vouchers`,              body3],
    [`/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/hotspot/voucher-groups/vouchers`, body1],
    [`/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/hotspot/voucher-groups/${GROUP_ID}/vouchers`, body1],
    [`/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/hotspot/voucher-groups/${GROUP_ID}/vouchers`, { amount: 1 }],
    // v2 paths
    [`/openapi/v2/${OMADAC_ID}/sites/${SITE_ID}/hotspot/vouchers`,              body1],
    [`/openapi/v2/${OMADAC_ID}/sites/${SITE_ID}/hotspot/voucher-groups/${GROUP_ID}/vouchers`, { amount: 1 }],
  ];

  for (const [path, body] of paths) {
    const success = await tryEndpoint(token, 'POST', path, body);
    if (success) {
      console.log(`\n✅ WORKING PATH: POST ${path}`);
      console.log('WORKING BODY:', JSON.stringify(body));
      return;
    }
  }

  console.log('\n❌ No working endpoint found. Trying GET on voucher-groups to confirm auth works...');
  await tryEndpoint(token, 'GET', `/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/hotspot/voucher-groups?page=1&pageSize=10`);
}

main().catch(e => console.error('Fatal:', e.message));