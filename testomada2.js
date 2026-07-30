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
  if (res.data.errorCode !== 0) throw new Error('Login failed');
  return {
    token:   res.data.result.token,
    cookies: res.headers['set-cookie']?.join('; ') || '',
  };
}

async function main() {
  const { token, cookies } = await login();
  console.log('✅ Logged in\n');

  const headers = {
    'Content-Type': 'application/json',
    'Csrf-Token':   token,
    Cookie:         cookies,
  };

  console.log('Fetching vouchers for group...');
  const res = await axios.get(
    `${BASE_URL}/${OMADAC_ID}/api/v2/hotspot/sites/${SITE_ID}/voucherGroups/${GROUP_ID}`,
    {
      httpsAgent: agent,
      timeout:    15000,
      headers,
      params: {
        currentPage:     1,
        currentPageSize: 10,
      },
    }
  );

  console.log('errorCode:', res.data.errorCode);
  console.log('Full response:', JSON.stringify(res.data, null, 2));
}

main().catch(e => {
  console.error('Error:', e.response?.status);
  console.error('Data:', JSON.stringify(e.response?.data || e.message).slice(0, 500));
});