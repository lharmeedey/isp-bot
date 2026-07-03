 require('dotenv').config();
const https = require('https');

const url = (process.env.PAYSTACK_CALLBACK_URL || '').replace('/webhook/paystack', '');

if (!url) {
  console.error('❌ PAYSTACK_CALLBACK_URL not set in .env');
  process.exit(1);
}

console.log('Testing tunnel URL:', url);

https.get(url, (res) => {
  console.log('✅ Tunnel reachable, status:', res.statusCode);
}).on('error', (err) => {
  console.error('❌ Tunnel not reachable:', err.message);
});
