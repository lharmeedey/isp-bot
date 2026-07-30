const axios  = require('axios');
const https  = require('https');

const BASE_URL  = 'https://16.171.67.192:8043';
const OMADAC_ID = 'ae3846afd47b384710ca7c9cf4ef8011';
const SITE_ID   = '6a6393445c7bdd073c22a2ac';
const GROUP_ID  = '6a64e9565c7bdd073c22b90e';

const USERNAME = 'saint.xv18@gmail.com';
const PASSWORD = 'Callerwoley@18';

const agent = new https.Agent({ rejectUnauthorized: false });

async function login() {
  const res = await axios.post(
    `${BASE_URL}/${OMADAC_ID}/api/v2/login`,
    { username: USERNAME, password: PASSWORD },
    { httpsAgent: agent, headers: { 'Content-Type': 'application/json' } }
  );
  if (res.data.errorCode !== 0) throw new Error('Login failed: ' + res.data.msg);
  return {
    token:   res.data.result.token,
    cookies: res.headers['set-cookie']?.join('; ') || '',
  };
}

async function tryCreate(headers, body, label) {
  console.log(`\nTrying: ${label}`);
  console.log('Body:', JSON.stringify(body));
  try {
    const res = await axios.post(
      `${BASE_URL}/${OMADAC_ID}/api/v2/hotspot/sites/${SITE_ID}/vouchers`,
      body,
      { httpsAgent: agent, timeout: 10000, headers }
    );
    console.log('errorCode:', res.data.errorCode);
    console.log('Response:', JSON.stringify(res.data, null, 2));
    if (res.data.errorCode === 0) {
      console.log('\n✅ WORKING BODY FOUND:', JSON.stringify(body));
      return true;
    }
  } catch (e) {
    console.log('❌', e.response?.status, JSON.stringify(e.response?.data));
  }
  return false;
}

async function main() {
  const { token, cookies } = await login();
  console.log('✅ Logged in\n');

  const headers = {
    'Content-Type': 'application/json',
    'Csrf-Token':   token,
    Cookie:         cookies,
  };

  const bodies = [
    { voucherGroupId: GROUP_ID, amount: 1 },
    { voucherGroupId: GROUP_ID, count: 1 },
    { voucherGroupId: GROUP_ID, num: 1 },
    { voucherGroupId: GROUP_ID, number: 1 },
    { voucherGroupId: GROUP_ID, quantity: 1 },
    { groupId: GROUP_ID, amount: 1 },
    { groupId: GROUP_ID, count: 1 },
    { id: GROUP_ID, amount: 1 },
    { voucherGroupId: GROUP_ID, amount: 1, siteId: SITE_ID },
    { voucherGroupId: GROUP_ID, amount: 1, omadacId: OMADAC_ID },
    { voucherGroupId: GROUP_ID },
  ];

  for (const [i, body] of bodies.entries()) {
    const success = await tryCreate(headers, body, `attempt ${i + 1}`);
    if (success) return;
  }

  console.log('\n❌ No working body format found');
}

main().catch(e => console.error('Fatal:', e.message));