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
    {
      httpsAgent: agent,
      headers:    { 'Content-Type': 'application/json' },
    }
  );
  if (res.data.errorCode !== 0) throw new Error('Login failed');
  const token   = res.data.result.token;
  const cookies = res.headers['set-cookie']?.join('; ') || '';
  return { token, cookies };
}

async function main() {
  console.log('1. Logging in...');
  const { token, cookies } = await login();
  console.log('✅ Token:', token);

  const headers = {
    'Content-Type': 'application/json',
    'Csrf-Token':   token,
    Cookie:         cookies,
  };

  // List vouchers
  console.log('\n2. Listing vouchers...');
  const listRes = await axios.get(
    `${BASE_URL}/${OMADAC_ID}/api/v2/hotspot/sites/${SITE_ID}/vouchers`,
    {
      httpsAgent: agent,
      headers,
      params: { page: 1, pageSize: 5, currentPage: 1, currentPageSize: 5 },
    }
  );
  console.log('LIST:', JSON.stringify(listRes.data, null, 2));

  // Create voucher with amount
  console.log('\n3. Creating voucher (amount)...');
  const c1 = await axios.post(
    `${BASE_URL}/${OMADAC_ID}/api/v2/hotspot/sites/${SITE_ID}/vouchers`,
    { voucherGroupId: GROUP_ID, amount: 1 },
    { httpsAgent: agent, headers }
  );
  console.log('CREATE 1:', JSON.stringify(c1.data, null, 2));

  // Create voucher with count
  console.log('\n4. Creating voucher (count)...');
  const c2 = await axios.post(
    `${BASE_URL}/${OMADAC_ID}/api/v2/hotspot/sites/${SITE_ID}/vouchers`,
    { voucherGroupId: GROUP_ID, count: 1 },
    { httpsAgent: agent, headers }
  );
  console.log('CREATE 2:', JSON.stringify(c2.data, null, 2));

  // Create voucher with num
  console.log('\n5. Creating voucher (num)...');
  const c3 = await axios.post(
    `${BASE_URL}/${OMADAC_ID}/api/v2/hotspot/sites/${SITE_ID}/vouchers`,
    { voucherGroupId: GROUP_ID, num: 1 },
    { httpsAgent: agent, headers }
  );
  console.log('CREATE 3:', JSON.stringify(c3.data, null, 2));
}

main().catch(e => {
  console.error('Error:', e.response?.status);
  console.error('Data:', JSON.stringify(e.response?.data || e.message).slice(0, 1000));
});