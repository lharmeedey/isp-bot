const { Telegraf }         = require('telegraf');
const db                   = require('./db');
const express              = require('express');
const crypto               = require('crypto');
const logger               = require('./logger');
const { decrypt }          = require('./encryption');
const { webhookLimiter }   = require('./rateLimiter');
const { clearProviderCache } = require('./providers');

const tenantBots = new Map();

// ── Load and launch all active tenants ────────
async function launchAllTenants() {
  try {
    const res = await db.query(
      'SELECT * FROM tenants WHERE active=true AND bot_token IS NOT NULL'
    );

    const results = await Promise.allSettled(
      res.rows.map(tenant => launchTenant(tenant))
    );

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed    = results.filter(r => r.status === 'rejected').length;

    logger.info(`Tenant bots launched`, { succeeded, failed, total: res.rows.length });

  } catch (err) {
    logger.error('launchAllTenants failed', { error: err.message });
  }
}

// ── Launch a single tenant bot ─────────────────
async function launchTenant(tenant) {
  if (tenantBots.has(tenant.tenant_id)) {
    logger.warn(`Bot already running`, { tenantId: tenant.tenant_id });
    return;
  }

  if (!tenant.bot_token) {
    throw new Error(`No bot token for tenant: ${tenant.tenant_id}`);
  }

  logger.info(`Launching tenant bot`, { name: tenant.name, tenantId: tenant.tenant_id });

  // Decrypt bot token — handles both encrypted and plain text
  const botToken = decrypt(tenant.bot_token);
  if (!botToken) throw new Error(`Could not decrypt bot token for: ${tenant.tenant_id}`);

  const bot = new Telegraf(botToken, { handlerTimeout: 90000 });

  // Attach decrypted tenant data to every ctx
  bot.use((ctx, next) => {
    ctx.tenant = {
      ...tenant,
      bot_token:        botToken,
      paystack_secret:  decrypt(tenant.paystack_secret),
      paystack_public:  decrypt(tenant.paystack_public),
    };
    return next();
  });

  // Global error handler — prevents one bad update from crashing the bot
  bot.catch((err, ctx) => {
    logger.error(`Bot error`, {
      tenantId: tenant.tenant_id,
      error:    err.message,
      updateId: ctx?.update?.update_id,
    });
  });

  // Register all commands
  require('../commands/tenantCommands').register(bot, tenant);

  if (tenant.webhook_url) {
    await bot.telegram.setWebhook(
      `${tenant.webhook_url}/bot/${tenant.tenant_id}`,
      { max_connections: 40 }
    );
    logger.info(`Webhook set`, { name: tenant.name, tenantId: tenant.tenant_id });
  } else {
    bot.launch().catch(err => {
      logger.error(`Polling error`, { tenantId: tenant.tenant_id, error: err.message });
    });
    logger.info(`Polling started`, { name: tenant.name, tenantId: tenant.tenant_id });
  }

  tenantBots.set(tenant.tenant_id, { bot, tenant });
  logger.info(`Bot live`, { name: tenant.name, tenantId: tenant.tenant_id });
}

// ── Stop a tenant bot ──────────────────────────
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
    logger.info(`Bot stopped`, { tenantId });
  } catch (err) {
    logger.error(`stopTenant error`, { tenantId, error: err.message });
  }
}

// ── Express webhook router ─────────────────────
function createWebhookRouter(masterApp) {

  // Rate limit middleware using IP
  const rateLimitMiddleware = (req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    if (!webhookLimiter(ip)) {
      logger.warn('Rate limit exceeded', { ip, path: req.path });
      return res.sendStatus(429);
    }
    next();
  };

  // Tenant bot updates
  masterApp.post('/bot/:tenantId', rateLimitMiddleware, express.json(), async (req, res) => {
    const { tenantId } = req.params;
    const entry = tenantBots.get(tenantId);

    if (!entry) {
      logger.warn(`Webhook for unknown tenant`, { tenantId });
      return res.sendStatus(404);
    }

    try {
      await entry.bot.handleUpdate(req.body, res);
    } catch (err) {
      logger.error(`Webhook handling error`, { tenantId, error: err.message });
      if (!res.headersSent) res.sendStatus(500);
    }
  });

  // Paystack payment webhooks
  masterApp.post(
    '/pay/:tenantId',
    rateLimitMiddleware,
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      const { tenantId } = req.params;
      const entry = tenantBots.get(tenantId);

      if (!entry) {
        logger.warn(`Payment webhook for unknown tenant`, { tenantId });
        return res.sendStatus(404);
      }

      // Validate Paystack signature
      const signature    = req.headers['x-paystack-signature'];
      const paystackSecret = decrypt(entry.tenant.paystack_secret);

      const hash = crypto
        .createHmac('sha512', paystackSecret)
        .update(req.body)
        .digest('hex');

      if (hash !== signature) {
        logger.warn(`Invalid Paystack signature`, { tenantId });
        return res.sendStatus(401);
      }

      // Acknowledge immediately — Paystack needs fast response
      res.sendStatus(200);

      try {
        const event = JSON.parse(req.body);
        if (event.event === 'charge.success') {
          await handlePayment(entry.bot, entry.tenant, event.data);
        }
      } catch (err) {
        logger.error(`Payment processing error`, { tenantId, error: err.message });
      }
    }
  );

  // Health check
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

  // Prevent duplicate processing
  const dup = await db.query(
    'SELECT id FROM purchases WHERE reference=$1',
    [data.reference]
  );
  if (dup.rows.length) {
    logger.warn(`Duplicate payment ignored`, { reference: data.reference });
    return;
  }

  const plans   = JSON.parse(process.env.PLANS || '[]');
  const planObj = plans.find(p => p.label === plan);
  const planGb  = planObj?.gb || 0;
  const days    = planObj?.validity?.includes('7') ? 7 : 30;

  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);

  // ── Create voucher via network provider ────────
  const { getProvider } = require('./providers');

  // Fetch fresh tenant from DB to get latest provider config
  const freshTenantRes = await db.query(
    'SELECT * FROM tenants WHERE tenant_id=$1',
    [tenantId]
  );
  const freshTenant = freshTenantRes.rows[0] || tenant;
  const provider    = getProvider(freshTenant);

  let voucherCode      = null;
  let omadaVoucherId   = null;
  let providerError    = null;

try {
    logger.info('Calling provider.createVoucher', {
      tenantId,
      plan,
      planConfig: planObj,
      provider: freshTenant.network_provider,
    });

    const result = await provider.createVoucher({
      plan,
      email,
      reference: data.reference,
      planConfig: planObj,
    });

    logger.info('Provider createVoucher result', { result: JSON.stringify(result) });

    voucherCode    = result.code;
    omadaVoucherId = result.omadaVoucherId;

  } catch (err) {
    providerError = err.message;
    logger.error('Provider voucher creation failed', {
      tenantId,
      provider: freshTenant.network_provider,
      error:    err.message,
      stack:    err.stack,
    });
    // Fall back to generating a random code so customer still gets something
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    voucherCode = Array.from({ length: 8 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
  }

  // ── DB transaction — all writes succeed or all fail ──
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

    // ── Notify user ────────────────────────────────
    let message =
`✅ *Payment Confirmed!*

Username: \`${email}\`
Password: \`${voucherCode}\`
Plan:     *${plan}*
Expiry:   ${expiry.toDateString()}

_Connect to the WiFi network and enter your password on the login page._`;

    if (providerError) {
      message += `\n\n_Note: If this code doesn't work, please contact /support._`;
    }

    await bot.telegram.sendMessage(tid, message, { parse_mode: 'Markdown' });

    logger.info(`Payment processed`, {
      plan,
      email,
      tenantId,
      reference:  data.reference,
      amount:     data.amount / 100,
      provider:   freshTenant.network_provider,
      voucherCode,
    });

  } catch (err) {
    await client.query('ROLLBACK');

    // If DB failed but voucher was created on Omada, try to delete it
    if (omadaVoucherId) {
      try {
        await provider.deactivateVoucher(omadaVoucherId);
      } catch (e) {
        logger.error('Failed to rollback Omada voucher', { omadaVoucherId });
      }
    }

    logger.error(`Payment transaction failed`, {
      reference: data.reference,
      error:     err.message,
    });
  } finally {
    client.release();
  }
}
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
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