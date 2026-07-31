const { Telegraf }           = require('telegraf');
const db                     = require('./db');
const express                = require('express');
const crypto                 = require('crypto');
const logger                 = require('./logger');
const { decrypt }            = require('./encryption');
const { webhookLimiter }     = require('./rateLimiter');
const { clearProviderCache } = require('./providers');

const tenantBots = new Map();

async function launchAllTenants() {
  try {
    await db.query('SELECT 1');
    const res = await db.query(
      'SELECT * FROM tenants WHERE active=true AND bot_token IS NOT NULL'
    );

    const results = await Promise.allSettled(
      res.rows.map(tenant => launchTenant(tenant))
    );

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed    = results.filter(r => r.status === 'rejected').length;

    logger.info('Tenant bots launched', { succeeded, failed, total: res.rows.length });
  } catch (err) {
    logger.error('launchAllTenants failed', { error: err.message });
  }
}

async function launchTenant(tenant) {
  if (tenantBots.has(tenant.tenant_id)) {
    logger.warn('Bot already running', { tenantId: tenant.tenant_id });
    return;
  }

  if (!tenant.bot_token) {
    throw new Error(`No bot token for tenant: ${tenant.tenant_id}`);
  }

  logger.info('Launching tenant bot', { name: tenant.name, tenantId: tenant.tenant_id });

  const botToken = decrypt(tenant.bot_token) || tenant.bot_token;
  if (!botToken) throw new Error(`Could not decrypt bot token for: ${tenant.tenant_id}`);

  const bot = new Telegraf(botToken, { handlerTimeout: 90000 });

  bot.use((ctx, next) => {
    ctx.tenant = {
      ...tenant,
      bot_token:       botToken,
      paystack_secret: decrypt(tenant.paystack_secret) || tenant.paystack_secret,
      paystack_public: decrypt(tenant.paystack_public) || tenant.paystack_public,
    };
    return next();
  });

  bot.catch((err, ctx) => {
    logger.error('Bot error', {
      tenantId: tenant.tenant_id,
      error:    err.message,
      updateId: ctx?.update?.update_id,
    });
  });

  require('../commands/tenantCommands').register(bot, tenant);

  if (tenant.webhook_url) {
    await bot.telegram.setWebhook(
      `${tenant.webhook_url}/bot/${tenant.tenant_id}`,
      { max_connections: 40 }
    );
    logger.info('Webhook set', { name: tenant.name, tenantId: tenant.tenant_id });
  } else {
    bot.launch().catch(err => {
      logger.error('Polling error', { tenantId: tenant.tenant_id, error: err.message });
    });
    logger.info('Polling started', { name: tenant.name, tenantId: tenant.tenant_id });
  }

  tenantBots.set(tenant.tenant_id, { bot, tenant });
  logger.info('Bot live', { name: tenant.name, tenantId: tenant.tenant_id });
}

async function stopTenant(tenantId) {
  const entry = tenantBots.get(tenantId);
  if (!entry) return;

  try {
    clearProviderCache(tenantId);
    if (entry.tenant.webhook_url) {
      await entry.bot.telegram.deleteWebhook().catch(() => {});
    }
    entry.bot.stop();
    tenantBots.delete(tenantId);
    logger.info('Bot stopped', { tenantId });
  } catch (err) {
    logger.error('stopTenant error', { tenantId, error: err.message });
  }
}

function createWebhookRouter(masterApp) {
  const rateLimitMiddleware = (req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    if (!webhookLimiter(ip)) {
      logger.warn('Rate limit exceeded', { ip, path: req.path });
      return res.sendStatus(429);
    }
    next();
  };

  masterApp.post('/bot/:tenantId', rateLimitMiddleware, express.json(), async (req, res) => {
    const { tenantId } = req.params;
    const entry = tenantBots.get(tenantId);

    if (!entry) {
      logger.warn('Webhook for unknown tenant', { tenantId });
      return res.sendStatus(404);
    }

    try {
      await entry.bot.handleUpdate(req.body, res);
    } catch (err) {
      logger.error('Webhook handling error', { tenantId, error: err.message });
      if (!res.headersSent) res.sendStatus(500);
    }
  });

  masterApp.post(
    '/pay/:tenantId',
    rateLimitMiddleware,
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      const { tenantId } = req.params;

      logger.info('Paystack webhook received', { tenantId });

      const entry = tenantBots.get(tenantId);
      if (!entry) {
        logger.warn('Payment webhook for unknown tenant', { tenantId });
        return res.sendStatus(404);
      }

      try {
        // Always fetch fresh Paystack secret from DB
        const tenantRow = await db.query(
          'SELECT paystack_secret FROM tenants WHERE tenant_id=$1',
          [tenantId]
        );

        if (!tenantRow.rows.length) {
          return res.sendStatus(404);
        }

        const rawSecret      = tenantRow.rows[0].paystack_secret;
        const paystackSecret = decrypt(rawSecret) || rawSecret;
        const signature      = req.headers['x-paystack-signature'];

        const hash = crypto
          .createHmac('sha512', paystackSecret)
          .update(req.body)
          .digest('hex');

        const signatureMatch = hash === signature;

        logger.info('Webhook signature check', {
          tenantId,
          match:         signatureMatch,
          secretPreview: paystackSecret?.slice(0, 15),
        });

        if (!signatureMatch) {
          logger.warn('Invalid Paystack signature', { tenantId });
          return res.sendStatus(401);
        }

        // Acknowledge immediately
        res.sendStatus(200);

        const event = JSON.parse(req.body);
        logger.info('Paystack event received', { tenantId, event: event.event });

        if (event.event === 'charge.success') {
          await handlePayment(entry.bot, entry.tenant, event.data);
        }

      } catch (err) {
        logger.error('Payment webhook error', { tenantId, error: err.message, stack: err.stack });
        if (!res.headersSent) res.sendStatus(500);
      }
    }
  );

  masterApp.get('/health', (_, res) => {
    const tenants = Array.from(tenantBots.entries()).map(([id, { tenant }]) => ({
      id,
      name:   tenant.name,
      active: true,
    }));

    res.json({
      status:        'ok',
      activeTenants: tenantBots.size,
      tenants,
      uptime:        Math.floor(process.uptime()),
      memory:        process.memoryUsage().heapUsed,
      timestamp:     new Date().toISOString(),
    });
  });
}

async function handlePayment(bot, tenant, data) {
  const { telegram_id, plan, email } = data.metadata || {};

  if (!telegram_id || !plan || !email) {
    logger.error('Payment missing metadata', { metadata: data.metadata });
    return;
  }

  const tid      = Number(telegram_id);
  const tenantId = tenant.tenant_id;

  logger.info('Processing payment', { tid, plan, email, tenantId, reference: data.reference });

  // Prevent duplicate processing
  const dup = await db.query(
    'SELECT id FROM purchases WHERE reference=$1',
    [data.reference]
  );
  if (dup.rows.length) {
    logger.warn('Duplicate payment ignored', { reference: data.reference });
    return;
  }

 // Check tenant-specific plans first, fall back to global
  let planObj;
  const tenantPlansRes = await db.query(
    `SELECT * FROM tenant_plans
     WHERE tenant_id=$1 AND label=$2 AND active=true
     LIMIT 1`,
    [tenantId, plan]
  );

  if (tenantPlansRes.rows.length) {
    const tp = tenantPlansRes.rows[0];
    planObj = {
      id:             tp.plan_id,
      label:          tp.label,
      price:          parseFloat(tp.price),
      gb:             parseFloat(tp.gb),
      validity:       tp.validity,
      omadaProfileId: tp.omada_profile_id,
    };
  } else {
    const globalPlans = JSON.parse(process.env.PLANS || '[]');
    planObj = globalPlans.find(p => p.label === plan);
  }

  
  const planGb  = planObj?.gb || 0;
  const days    = planObj?.validity?.includes('7') ? 7 : 30;

  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);

  // Always fetch fresh tenant from DB for provider
  const freshTenantRes = await db.query(
    'SELECT * FROM tenants WHERE tenant_id=$1', [tenantId]
  );
  const freshTenant = freshTenantRes.rows[0];

  if (!freshTenant) {
    logger.error('Tenant not found in DB during payment', { tenantId });
    return;
  }

  // Clear provider cache to force fresh credentials
  clearProviderCache(tenantId);

  const { getProvider } = require('./providers');
  const provider        = getProvider(freshTenant);

  let voucherCode    = null;
  let omadaVoucherId = null;
  let providerError  = null;

  logger.info('Calling provider createVoucher', {
    tenantId,
    plan,
    provider:   freshTenant.network_provider,
    planConfig: JSON.stringify(planObj),
  });

  try {
    const result = await provider.createVoucher({
      plan,
      email,
      reference:  data.reference,
      planConfig: planObj,
    });

    voucherCode    = result.code;
    omadaVoucherId = result.omadaVoucherId;

    logger.info('Voucher created by provider', {
      tenantId,
      voucherCode,
      omadaVoucherId,
      provider: freshTenant.network_provider,
    });

  } catch (err) {
    providerError = err.message;
    logger.error('Provider voucher creation failed', {
      tenantId,
      provider: freshTenant.network_provider,
      error:    err.message,
      stack:    err.stack,
    });

    // Fallback random code
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    voucherCode = Array.from({ length: 8 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');

    logger.warn('Using fallback voucher code', { voucherCode });
  }

  // DB transaction
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE users
       SET plan=$1, remaining_gb=$2, total_gb=$3,
           expiry=$4, status='active', last_sync=NOW()
       WHERE telegram_id=$5 AND tenant_id=$6`,
      [plan, planGb, planGb, expiry.toISOString().slice(0, 10), tid, tenantId]
    );

    await client.query(
      `INSERT INTO purchases (telegram_id, tenant_id, email, plan, amount, reference)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (reference) DO NOTHING`,
      [tid, tenantId, email, plan, data.amount / 100, data.reference]
    );

    await client.query(
      `INSERT INTO vouchers (telegram_id, tenant_id, email, plan, code, omada_voucher_id, reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tid, tenantId, email, plan, voucherCode, omadaVoucherId, data.reference]
    );

    await client.query('COMMIT');

    let message =
`✅ *Payment Confirmed!*

Username: \`${email}\`
Password: \`${voucherCode}\`
Plan:     *${plan}*
Expiry:   ${expiry.toDateString()}

_Connect to the WiFi network and enter your password on the login page._`;

    if (providerError) {
      message += `\n\n_⚠️ If this code doesn't work, contact /support._`;
    }

    await bot.telegram.sendMessage(tid, message, { parse_mode: 'Markdown' });

    logger.info('Payment fully processed', {
      tenantId,
      plan,
      email,
      voucherCode,
      fromOmada:  !providerError,
      reference:  data.reference,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Payment DB transaction failed', {
      reference: data.reference,
      error:     err.message,
    });

    try {
      await bot.telegram.sendMessage(
        tid,
        `⚠️ Payment received but technical error occurred. Contact /support with reference: ${data.reference}`
      );
    } catch (e) {
      logger.error('Could not notify user of failure', { tid });
    }

  } finally {
    client.release();
  }
}

function getActiveTenants() {
  return tenantBots;
}

module.exports = {
  launchAllTenants,
  launchTenant,
  stopTenant,
  createWebhookRouter,
  getActiveTenants,
};