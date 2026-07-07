const { Telegraf } = require('telegraf');
const db      = require('./db');
const express = require('express');
const crypto  = require('crypto');

const tenantBots = new Map();

// ── Load and launch all active tenants ────────
async function launchAllTenants() {
  try {
    const res = await db.query(
      'SELECT * FROM tenants WHERE active=true AND bot_token IS NOT NULL'
    );

    for (const tenant of res.rows) {
      try {
        await launchTenant(tenant);
      } catch (err) {
        console.error(`Skipping tenant ${tenant.tenant_id}:`, err.message);
      }
    }

    console.log(`✅ Launched ${res.rows.length} tenant bot(s)`);
  } catch (err) {
    console.error('launchAllTenants error:', err.message);
  }
}

// ── Launch a single tenant bot ─────────────────
async function launchTenant(tenant) {
  if (tenantBots.has(tenant.tenant_id)) {
    console.log(`Already running: ${tenant.tenant_id}`);
    return;
  }

  if (!tenant.bot_token) {
    throw new Error(`No bot token for tenant: ${tenant.tenant_id}`);
  }

  console.log(`[launch] Starting ${tenant.name} (${tenant.tenant_id})...`);

  const bot = new Telegraf(tenant.bot_token);

  // Attach tenant to every ctx
  bot.use((ctx, next) => {
    ctx.tenant = tenant;
    return next();
  });

  // Global error handler so one bad update doesn't kill the bot
  bot.catch((err, ctx) => {
    console.error(`[${tenant.tenant_id}] Bot error:`, err.message);
  });

  // Register customer + admin commands
  require('../commands/tenantCommands').register(bot, tenant);

  if (tenant.webhook_url) {
    await bot.telegram.setWebhook(`${tenant.webhook_url}/bot/${tenant.tenant_id}`);
    console.log(`[launch] Webhook set for ${tenant.name}`);
  } else {
    // polling — do NOT await, it blocks forever
    bot.launch().catch(err => {
      console.error(`[${tenant.tenant_id}] Polling error:`, err.message);
    });
    console.log(`[launch] Polling started for ${tenant.name}`);
  }

  tenantBots.set(tenant.tenant_id, { bot, tenant });
  console.log(`[launch] ✅ Live: ${tenant.name} (${tenant.tenant_id})`);
}

// ── Stop a tenant bot ──────────────────────────
async function stopTenant(tenantId) {
  const entry = tenantBots.get(tenantId);
  if (!entry) return;

  try {
    entry.bot.stop();
    tenantBots.delete(tenantId);
    console.log(`🛑 Stopped: ${tenantId}`);
  } catch (err) {
    console.error(`stopTenant error (${tenantId}):`, err.message);
  }
}

// ── Register commands ──────────────────────────
function registerCommands(bot, tenant) {
  require('../commands/tenantCommands').register(bot, tenant);
}

// ── Express webhook router ─────────────────────
function createWebhookRouter(masterApp) {
  // Tenant bot updates
  masterApp.post('/bot/:tenantId', express.json(), async (req, res) => {
    const entry = tenantBots.get(req.params.tenantId);
    if (!entry) return res.sendStatus(404);
    try {
      await entry.bot.handleUpdate(req.body);
      res.sendStatus(200);
    } catch (err) {
      console.error(`Webhook error (${req.params.tenantId}):`, err.message);
      res.sendStatus(500);
    }
  });

  // Paystack payment webhooks
  masterApp.post('/pay/:tenantId', express.raw({ type: 'application/json' }), async (req, res) => {
    const entry = tenantBots.get(req.params.tenantId);
    if (!entry) return res.sendStatus(404);

    const signature = req.headers['x-paystack-signature'];
    const hash = crypto
      .createHmac('sha512', entry.tenant.paystack_secret)
      .update(req.body)
      .digest('hex');

    if (hash !== signature) return res.sendStatus(401);

    // Acknowledge Paystack immediately
    res.sendStatus(200);

    try {
      const event = JSON.parse(req.body);
      if (event.event === 'charge.success') {
        await handlePayment(entry.bot, entry.tenant, event.data);
      }
    } catch (err) {
      console.error(`Payment error (${req.params.tenantId}):`, err.message);
    }
  });

  // Health check
  masterApp.get('/health', (_, res) => {
    res.json({
      status:        'ok',
      activeTenants: tenantBots.size,
      tenants:       Array.from(tenantBots.keys()),
      uptime:        Math.floor(process.uptime()),
    });
  });
}

// ── Handle confirmed Paystack payment ─────────
async function handlePayment(bot, tenant, data) {
  const { telegram_id, plan, email } = data.metadata || {};

  if (!telegram_id || !plan || !email) {
    console.error('handlePayment: missing metadata', data.metadata);
    return;
  }

  const tid = Number(telegram_id);

  // Prevent duplicate processing
  const dup = await db.query(
    'SELECT id FROM purchases WHERE reference=$1',
    [data.reference]
  );
  if (dup.rows.length) {
    console.log(`Duplicate payment ignored: ${data.reference}`);
    return;
  }

  const plans   = JSON.parse(process.env.PLANS || '[]');
  const planObj = plans.find(p => p.label === plan);
  const planGb  = planObj?.gb || 0;
  const days    = planObj?.validity?.includes('7') ? 7 : 30;

  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);

  await db.query(
    `UPDATE users
     SET plan=$1, remaining_gb=$2, total_gb=$3,
         expiry=$4, status='active', last_sync=NOW()
     WHERE telegram_id=$5 AND tenant_id=$6`,
    [plan, planGb, planGb, expiry.toISOString().slice(0, 10), tid, tenant.tenant_id]
  );

  await db.query(
    `INSERT INTO purchases (telegram_id, tenant_id, email, plan, amount, reference)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (reference) DO NOTHING`,
    [tid, tenant.tenant_id, email, plan, data.amount / 100, data.reference]
  );

  const code = generateCode();
  await db.query(
    `INSERT INTO vouchers (telegram_id, tenant_id, email, plan, code, reference)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [tid, tenant.tenant_id, email, plan, code, data.reference]
  );

  await bot.telegram.sendMessage(
    tid,
`✅ *Payment Confirmed!*

Username: \`${email}\`
Password: \`${code}\`
Plan:     *${plan}*
Expiry:   ${expiry.toDateString()}

_Your data is now active. Save your password to connect._`,
    { parse_mode: 'Markdown' }
  );

  console.log(`✅ Payment done: ${plan} for ${email} (${tenant.tenant_id})`);
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