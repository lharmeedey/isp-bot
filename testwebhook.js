const axios = require('axios');

axios.post(
  'https://isp-bots.onrender.com/pay/tenant_1785084653880',
  {
    event: 'charge.success',
    data: {
      reference: 'test123',
      amount:    100000,
      metadata: {
        telegram_id: '6643011403',
        plan:        '5GB',
        email:       'test@test.com',
        tenant_id:   'tenant_1785084653880',
      },
    },
  },
  {
    headers: {
      'Content-Type':          'application/json',
      'x-paystack-signature':  'test',
    },
  }
)
.then(r => console.log('✅ Response:', r.status))
.catch(e => console.log('❌ Error:', e.response?.status, e.message));