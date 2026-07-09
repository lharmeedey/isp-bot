const db = require('../services/db');
const { naira } = require('../services/helpers');
const tenantManager = require('../services/tenantManager');

const awaitingTenant = new Map();

async function startAddTenant(ctx) {
  awaitingTenant.set(ctx.from.id, { step: 'name' });
  return ctx.replyWithMarkdown(
`➕ *Add New Tenant*

Step 1/5 — Enter the tenant's *business name*:`
  );
}

async function listTenants(ctx) {
  const res = await db.query('SELECT * FROM tenants ORDER BY created_at DESC');
  if (!res.rows.length) return ctx.reply('No tenants yet.');

  const lines = res.rows.map(t =>
    `• *${t.name}* — \`${t.tenant_id}\` — ${t.active ? '🟢 active' : '🔴 inactive'}`
  ).join('\n');

  return ctx.replyWithMarkdown(`🏢 *All Tenants*\n\n${lines}`);
}

async function totalRevenue(ctx) {
  const res = await db.query(
    'SELECT tenant_id, COALESCE(SUM(amount),0) as total FROM purchases GROUP BY tenant_id'
  );
  if (!res.rows.length) return ctx.reply('No revenue yet.');

  const lines = res.rows.map(r =>
    `• \`${r.tenant_id}\`: ${naira(r.total)}`
  ).join('\n');

  return ctx.replyWithMarkdown(`💰 *Revenue Across All Tenants*\n\n${lines}`);
}

async function deactivateTenant(ctx) {
  const res = await db.query('SELECT * FROM tenants WHERE active=true');
  if (!res.rows.length) return ctx.reply('No active tenants.');

  const keyboard = res.rows.map(t => ([{
    text: `${t.name} (${t.tenant_id})`,
    callback_data: `deactivate_${t.tenant_id}`,
  }]));

  return ctx.replyWithMarkdown('Select tenant to deactivate:', {
    reply_markup: { inline_keyboard: keyboard },
  });
}

async function handleDeactivateCallback(ctx) {
  await ctx.answerCbQuery();
  const tenantId = ctx.callbackQuery.data.replace('deactivate_', '');
  await db.query('UPDATE tenants SET active=false WHERE tenant_id=$1', [tenantId]);
  await tenantManager.stopTenant(tenantId);
  await ctx.editMessageText(`✅ Tenant \`${tenantId}\` deactivated and bot stopped.`);
}

async function handleSuperAdminText(ctx, next) {
  const userId = ctx.from.id;
  const text   = ctx.message?.text?.trim();

  if (!text) return next();

  const state = awaitingTenant.get(userId);
  if (!state) return next();

  try {
    if (state.step === 'name') {
      if (text.length < 2) return ctx.reply('Name too short. Try again:');
      state.name = text;
      state.step = 'email';
      awaitingTenant.set(userId, state);
      return ctx.reply('Step 2/5 — Enter their email address:');
    }

    if (state.step === 'email') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(text)) return ctx.reply('Invalid email. Try again:');
      state.email = text;
      state.step  = 'bot_token';
      awaitingTenant.set(userId, state);
      return ctx.reply('Step 3/5 — Enter their Telegram Bot Token (from @BotFather):');
    }

    if (state.step === 'bot_token') {
      if (!text.includes(':')) return ctx.reply('That doesn\'t look like a valid bot token. Try again:');
      state.bot_token = text;
      state.step      = 'paystack_secret';
      awaitingTenant.set(userId, state);
      return ctx.reply('Step 4/5 — Enter their Paystack Secret Key (sk_test_... or sk_live_...):');
    }

    if (state.step === 'paystack_secret') {
      if (!text.startsWith('sk_')) return ctx.reply('Invalid Paystack secret key. Must start with sk_test_ or sk_live_. Try again:');
      state.paystack_secret = text;
      state.step            = 'paystack_public';
      awaitingTenant.set(userId, state);
      return ctx.reply('Step 5/5 — Enter their Paystack Public Key (pk_test_... or pk_live_...):');
    }

    if (state.step === 'paystack_public') {
      if (!text.startsWith('pk_')) return ctx.reply('Invalid Paystack public key. Must start with pk_test_ or pk_live_. Try again:');
      state.paystack_public = text;
      awaitingTenant.delete(userId);

      // Notify user we are processing
      await ctx.reply('⏳ Creating tenant and launching bot...');

      const tenantId   = `tenant_${Date.now()}`;
      const webhookUrl = process.env.WEBHOOK_URL || null;

// Check if bot token already exists
const existing = await db.query(
  'SELECT tenant_id FROM tenants WHERE bot_token=$1',
  [state.bot_token]
);
if (existing.rows.length) {
  return ctx.reply(
    `❌ That bot token is already registered under tenant \`${existing.rows[0].tenant_id}\`.\n\nAsk the client to create a new bot via @BotFather, or use /addtenant with a different token.`
  );
}

await db.query(
  `INSERT INTO tenants
   (tenant_id, name, email, bot_token, paystack_secret, paystack_public, webhook_url)
   VALUES ($1,$2,$3,$4,$5,$6,$7)`,
  [
    tenantId,
    state.name,
    state.email,
    state.bot_token,
    state.paystack_secret,
    state.paystack_public,
    webhookUrl,
  ]
);

      // Fetch full tenant record
      const tenantRes = await db.query(
        'SELECT * FROM tenants WHERE tenant_id=$1',
        [tenantId]
      );
      const tenant = tenantRes.rows[0];

      // Launch the bot
      await tenantManager.launchTenant(tenant);

      const paystackWebhook = webhookUrl
        ? `${webhookUrl}/pay/${tenantId}`
        : 'Not available locally — set WEBHOOK_URL on Railway';

      return ctx.replyWithMarkdown(
`✅ *Tenant Created & Bot Launched!*

Name:      ${state.name}
Email:     ${state.email}
Tenant ID: \`${tenantId}\`

*Paystack Webhook URL:*
\`${paystackWebhook}\`

_Send this webhook URL to the tenant to paste in their Paystack dashboard._
_Their bot is live right now._`
      );
    }

  } catch (err) {
    // Clear stuck state
    awaitingTenant.delete(userId);
    console.error('Tenant creation error:', err);
    return ctx.reply(`❌ Something went wrong: ${err.message}\n\nUse /addtenant to try again.`);
  }

  return next();
}
async function reloadTenant(ctx) {
  const parts    = ctx.message.text.split(' ');
  const tenantId = parts[1];

  if (!tenantId) {
    return ctx.reply('Usage: /reloadtenant tenant_id\n\nExample:\n/reloadtenant tenant_1783594930708');
  }

  const res = await db.query(
    'SELECT * FROM tenants WHERE tenant_id=$1',
    [tenantId]
  );

  if (!res.rows.length) {
    return ctx.reply(`❌ Tenant not found: ${tenantId}`);
  }

  const tenant = res.rows[0];

  await tenantManager.stopTenant(tenantId);
  await tenantManager.launchTenant(tenant);

  return ctx.replyWithMarkdown(
`✅ *Tenant Reloaded!*

Name:      ${tenant.name}
Tenant ID: \`${tenantId}\`

Fresh keys loaded from database.`
  );
}
module.exports = {
  startAddTenant,
  listTenants,
  totalRevenue,
  deactivateTenant,
  handleDeactivateCallback,
  handleSuperAdminText,
  reloadTenant,
};