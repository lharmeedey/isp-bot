'use strict';

const crypto = require('crypto');
const axios  = require('axios');
const logger = require('../../services/logger');
const { decrypt } = require('../../services/encryption');

/**
 * Fire-and-forget signed webhook. NEVER throws — all errors swallowed/logged.
 * @param {object} tenant   fresh tenants row (has purchase_webhook_url, purchase_webhook_secret)
 * @param {object} payload  { event, tenantId, plan, amount, reference, code?, timestamp }
 * @returns {Promise<void>}
 */
async function sendPurchaseWebhook(tenant, payload) {
  try {
    const url = tenant.purchase_webhook_url;
    if (!url) return;                          // not configured → no-op
    const secret = decrypt(tenant.purchase_webhook_secret) || '';
    const body   = JSON.stringify(payload);    // sign the EXACT bytes we send
    const sig    = crypto.createHmac('sha256', secret).update(body).digest('hex');

    await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        'X-Signature':  `sha256=${sig}`,
        'X-Webhook-Event': payload.event,
      },
      timeout: 4000,                           // short — must not stall checkout
      maxRedirects: 0,
      validateStatus: () => true,              // any status = delivered, we don't retry
    });
    logger.info('Purchase webhook sent', { tenantId: payload.tenantId, reference: payload.reference });
  } catch (err) {
    logger.warn('Purchase webhook failed (ignored)', {
      tenantId: payload?.tenantId, reference: payload?.reference, error: err.message,
    });
  }
}

// Helper the settings route uses to mint a secret when none exists.
function generateWebhookSecret() {
  return crypto.randomBytes(32).toString('hex');   // 64-char hex
}

module.exports = { sendPurchaseWebhook, generateWebhookSecret };
