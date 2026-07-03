const axios  = require('axios');
const crypto = require('crypto');

const API_KEY    = process.env.MONNIFY_API_KEY;
const SECRET_KEY = process.env.MONNIFY_SECRET;
const CONTRACT   = process.env.MONNIFY_CONTRACT_CODE;
const BASE_URL   = 'https://api.monnify.com';

// ── Get auth token (Monnify uses Basic Auth → JWT) ──
async function getToken() {
  const credentials = Buffer.from(`${API_KEY}:${SECRET_KEY}`).toString('base64');
  const res = await axios.post(
    `${BASE_URL}/api/v1/auth/login`,
    {},
    { headers: { Authorization: `Basic ${credentials}` } }
  );
  return res.data.responseBody.accessToken;
}

// ── Create a payment link ─────────────────────
async function createPaymentLink({ email, amount, reference, description }) {
  const token = await getToken();

  const res = await axios.post(
    `${BASE_URL}/api/v1/merchant/transactions/init-transaction`,
    {
      amount,
      customerName:      email,
      customerEmail:     email,
      paymentReference:  reference,
      paymentDescription: description,
      currencyCode:      'NGN',
      contractCode:      CONTRACT,
      redirectUrl:       process.env.MONNIFY_REDIRECT_URL || '',
      paymentMethods:    ['CARD', 'ACCOUNT_TRANSFER'],
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return res.data.responseBody; // { checkoutUrl, transactionReference }
}

// ── Validate webhook signature ────────────────
function validateWebhook(rawBody, signature) {
  const hash = crypto
    .createHmac('sha512', SECRET_KEY)
    .update(rawBody)
    .digest('hex');
  return hash === signature;
}

module.exports = { createPaymentLink, validateWebhook };
