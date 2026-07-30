const axios  = require('axios');
const https  = require('https');

const BASE_URL      = 'https://16.171.67.192:8043';
const OMADAC_ID     = 'ae3846afd47b384710ca7c9cf4ef8011';
const SITE_ID       = '6a6393445c7bdd073c22a2ac';
const GROUP_ID      = '6a64e9565c7bdd073c22b90e';
const CLIENT_ID     = '303276c0206c48348435d0b978f1e528';
const CLIENT_SECRET = '11eac7ad5de24e74a74c1039db851e04';
const USERNAME      = 'saint.xv18@gmail.com';
const PASSWORD      = 'Callerwoley@18';

const agent = new https.Agent({ rejectUnauthorized: false });

async function getOpenApiToken() {
  const res = await axios.post(
    `${BASE_URL}/openapi/authorize/token?grant_type=client_credentials`,
    { omadacId: OMADAC_ID, client_id: CLIENT_ID, client_secret: CLIENT_SECRET },
    { httpsAgent: agent, headers: { 'Content-Type': 'application/json' } }
  );
  if (res.data.errorCode !== 0) throw new Error('OpenAPI token failed');
  return res.data.result.accessToken;
}

async function login() {
  const res = await axios.post(
    `${BASE_URL}/${OMADAC_ID}/api/v2/login`,
    { username: USERNAME, password: PASSWORD },
    { httpsAgent: agent, headers: { 'Content-Type': 'application/json' } }
  );
  if (res.data.errorCode !== 0) throw new Error('Login failed');
  return {
    token:   res.data.result.token,
    cookies: res.headers['set-cookie']?.join('; ') || '',
  };
}

async function tryCreate(headers, body, url, label) {
  console.log(`\n${label}`);
  console.log('URL:', url);
  console.log('Body:', JSON.stringify(body));
  try {
    const res = await axios.post(url, body, {
      httpsAgent: agent,
      timeout:    10000,
      headers,
    });
    console.log('errorCode:', res.data.errorCode);
    console.log('Response:', JSON.stringify(res.data, null, 2));
    if (res.data.errorCode === 0) {
      console.log('\n✅ SUCCESS:', JSON.stringify(body));
      return true;
    }
  } catch (e) {
    console.log('❌', e.response?.status, JSON.stringify(e.response?.data));
  }
  return false;
}

async function main() {
  const openApiToken          = await getOpenApiToken();
  const { token, cookies }    = await login();
  console.log('✅ Both tokens obtained\n');

  const openApiHeaders = {
    'Content-Type': 'application/json',
    Authorization:  `AccessToken=${openApiToken}`,
  };

  const sessionHeaders = {
    'Content-Type': 'application/json',
    'Csrf-Token':   token,
    Cookie:         cookies,
  };

  const body = { voucherGroupId: GROUP_ID, amount: 1 };

  // Test 1 — OpenAPI token on internal URL
  await tryCreate(
    openApiHeaders,
    body,
    `${BASE_URL}/${OMADAC_ID}/api/v2/hotspot/sites/${SITE_ID}/vouchers`,
    'OpenAPI token on internal URL'
  );

  // Test 2 — Session token on OpenAPI URL
  await tryCreate(
    sessionHeaders,
    body,
    `${BASE_URL}/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/hotspot/vouchers`,
    'Session token on OpenAPI URL'
  );

  // Test 3 — OpenAPI token on OpenAPI URL (original working test)
  await tryCreate(
    openApiHeaders,
    body,
    `${BASE_URL}/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/hotspot/vouchers`,
    'OpenAPI token on OpenAPI URL'
  );

  // Test 4 — Both tokens combined
  await tryCreate(
    { ...openApiHeaders, 'Csrf-Token': token, Cookie: cookies },
    body,
    `${BASE_URL}/${OMADAC_ID}/api/v2/hotspot/sites/${SITE_ID}/vouchers`,
    'Combined tokens on internal URL'
  );

  // Test 5 — Session on internal with different body
  await tryCreate(
    sessionHeaders,
    { voucherGroupId: GROUP_ID, amount: 1, currentPage: 1, currentPageSize: 10 },
    `${BASE_URL}/${OMADAC_ID}/api/v2/hotspot/sites/${SITE_ID}/vouchers`,
    'Session on internal with pagination'
  );
}

main().catch(e => console.error('Fatal:', e.message));