const axios  = require('axios');
const crypto = require('crypto');

const SECRET = process.env.PAYSTACK_SECRET;

// ── Create a payment link ─────────────────────
async function createPaymentLink({ email, amount, metadata, reference }) {
  const res = await axios.post(
    'https://api.paystack.co/transaction/initialize',
    {
      email,
      amount: amount * 100,        // Paystack uses kobo
      reference,
      metadata,
      callback_url: process.env.PAYSTACK_CALLBACK_URL || '',
    },
    { headers: { Authorization: `Bearer ${SECRET}` } }
  );
  return res.data.data; // { authorization_url, reference }
}

// ── Verify a transaction ──────────────────────
async function verifyTransaction(reference) {
  const res = await axios.get(
    `https://api.paystack.co/transaction/verify/${reference}`,
    { headers: { Authorization: `Bearer ${SECRET}` } }
  );
  return res.data.data; // { status, amount, metadata }
}

// ── Validate webhook signature ────────────────
function validateWebhook(rawBody, signature) {
  const hash = crypto
    .createHmac('sha512', SECRET)
    .update(rawBody)
    .digest('hex');
  return hash === signature;
}

module.exports = { createPaymentLink, verifyTransaction, validateWebhook };
