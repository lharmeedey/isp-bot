const { Telegraf } = require('telegraf');
const db = require('./db');
const express = require('express');
const crypto  = require('crypto');

// Map of tenant_id → { bot, app, store }
const tenantBots = new Map();

// ── Load and launch all active tenants ────────
async function launchAllTenants() {
  const res = await db.query(
    'SELECT * FROM tenants WHERE active=true AND bot_token IS NOT NULL'
  );

  for (const tenant of res.rows) {
    await launchTenant(tenant);
  }

  console.log(`✅ Launched ${res.rows.length} tenant bots`);
}

// ── Launch a single tenant bot ─────────────────
async function launchTenant(tenant) {
  if (tenantBots.has(tenant.tenant_id)) {
    console.log(`Bot already running for tenant: ${tenant.tenant_id}`);
    return;
  }

  try {
    const bot = new Telegraf(tenant.bot_token);

    // Attach tenant context to every update
    bot.use((ctx, next) => {
      ctx.tenant = tenant;
      return next();
    });

    // Register all commands
    registerCommands(bot, tenant);

    // Start bot
    if (tenant.webhook_url) {
      await bot.telegram.setWebhook(`${tenant.webhook_url}/bot/${tenant.tenant_id}`);
      console.log(`✅ Webhook set for ${tenant.name}`);
    } else {
      bot.launch();
      console.log(`✅ Polling started for ${tenant.name}`);
    }

    tenantBots.set(tenant.tenant_id, { bot, tenant });
    console.log(`🤖 Bot launched for tenant: ${tenant.name} (${tenant.tenant_id})`);

  } catch (err) {
    console.error(`Failed to launch bot for ${tenant.tenant_id}:`, err.message);
  }
}

// ── Stop a tenant bot ─────────────────────────
async function stopTenant(tenantId) {
  const entry = tenantBots.get(tenantId);
  if (!entry) return;

  try {
    entry.bot.stop();
    tenantBots.delete(tenantId);
    console.log(`🛑 Bot stopped for tenant: ${tenantId}`);
  } catch (err) {
    console.error(`Failed to stop bot for ${tenantId}:`, err.message);
  }
}

// ── Register all commands on a bot instance ───
function registerCommands(bot, tenant) {
  const commands = require('../commands/tenantCommands');
  commands.register(bot, tenant);
}

// ── Express router for all tenant webhooks ────
function createWebhookRouter(masterApp) {
  // Tenant bot webhooks — /bot/:tenantId
  masterApp.post('/bot/:tenantId', express.json(), async (req, res) => {
    const { tenantId } = req.params;
    const entry = tenantBots.get(tenantId);

    if (!entry) {
      return res.sendStatus(404);
    }

    await entry.bot.handleUpdate(req.body);
    res.sendStatus(200);
  });

  // Paystack webhooks — /pay/:tenantId
  masterApp.post('/pay/:tenantId', express.raw({ type: 'application/json' }), async (req, res) => {
    const { tenantId } = req.params;
    const entry = tenantBots.get(tenantId);

    if (!entry) return res.sendStatus(404);

    const signature = req.headers['x-paystack-signature'];
    const hash = crypto
      .createHmac('sha512', entry.tenant.paystack_secret)
      .update(req.body)
      .digest('hex');

    if (hash !== signature) return res.sendStatus(401);

    const event = JSON.parse(req.body);
    if (event.event === 'charge.success') {
      await handlePayment(entry.bot, entry.tenant, event.data);
    }

    res.sendStatus(200);
  });
}

// ── Handle successful payment ─────────────────
async function handlePayment(bot, tenant, data) {
  try {
    const { telegram_id, plan, email } = data.metadata;
    const tid = Number(telegram_id);

    // Activate plan
    await db.query(
      `UPDATE users
       SET plan=$1, remaining_gb=$2, total_gb=$3,
           expiry=NOW() + INTERVAL '30 days',
           status='active', last_sync=NOW()
       WHERE telegram_id=$4 AND tenant_id=$5`,
      [plan,
       getPlanGb(plan, tenant),
       getPlanGb(plan, tenant),
       tid,
       tenant.tenant_id]
    );

    // Record purchase
    await db.query(
      `INSERT INTO purchases (telegram_id, tenant_id, email, plan, amount, reference)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (reference) DO NOTHING`,
      [tid, tenant.tenant_id, email, plan, data.amount / 100, data.reference]
    );

    // Generate voucher
    const code = generateCode();
    await db.query(
      `INSERT INTO vouchers (telegram_id, tenant_id, email, plan, code, reference)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, tenant.tenant_id, email, plan, code, data.reference]
    );

    // Notify user
    await bot.telegram.sendMessage(
      tid,
`✅ *Payment Confirmed!*

Username: \`${email}\`
Password: \`${code}\`
Plan:     *${plan}*

_Your data is now active. Save your password to connect._`,
      { parse_mode: 'Markdown' }
    );

    console.log(`✅ Payment processed: ${plan} for ${email} (${tenant.tenant_id})`);

  } catch (err) {
    console.error('Payment handler error:', err.message);
  }
}

function getPlanGb(planLabel, tenant) {
  const plans = JSON.parse(process.env.PLANS || '[]');
  const plan  = plans.find(p => p.label === planLabel);
  return plan?.gb || 0;
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