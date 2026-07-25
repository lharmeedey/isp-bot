const db = require('../services/db');
const logger = require('../services/logger');
const { naira } = require('../services/helpers');
const { encrypt } = require('../services/encryption');
const tenantManager = require('../services/tenantManager');

const awaitingTenant = new Map();

async function startAddTenant(ctx) {
  awaitingTenant.set(ctx.from.id, { step: 'name' });
  return ctx.replyWithMarkdown(
    `➕ *Add New Tenant*

Step 1/6 — Enter the tenant's *business name*:`
  );
}

async function listTenants(ctx) {
  const res = await db.query('SELECT * FROM tenants ORDER BY created_at DESC');
  if (!res.rows.length) return ctx.reply('No tenants yet.');

  const lines = res.rows.map(t =>
    `• *${t.name}* — \`${t.tenant_id}\` — ${t.active ? '🟢 active' : '🔴 inactive'} — Owner: \`${t.telegram_id || 'not set'}\``
  ).join('\n');

  return ctx.replyWithMarkdown(`🏢 *All Tenants*\n\n${lines}`);
}

async function totalRevenue(ctx) {
  const res = await db.query(`
    SELECT t.name, t.tenant_id, COALESCE(SUM(p.amount),0) as total
    FROM tenants t
    LEFT JOIN purchases p ON p.tenant_id = t.tenant_id
    GROUP BY t.tenant_id, t.name
    ORDER BY total DESC
  `);

  if (!res.rows.length) return ctx.reply('No revenue yet.');

  const lines = res.rows.map(r =>
    `• *${r.name}*: ${naira(r.total)}`
  ).join('\n');

  const grandTotal = res.rows.reduce((sum, r) => sum + parseFloat(r.total), 0);

  return ctx.replyWithMarkdown(
    `💰 *Revenue Across All Tenants*

${lines}

*Grand Total: ${naira(grandTotal)}*`
  );
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
  logger.info('Tenant deactivated', { tenantId, by: ctx.from.id });
  await ctx.editMessageText(`✅ Tenant \`${tenantId}\` deactivated and bot stopped.`);
}

async function fixWebhooks(ctx) {
  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) return ctx.reply('❌ WEBHOOK_URL not set in environment.');

  const res = await db.query('SELECT * FROM tenants WHERE active=true');
  if (!res.rows.length) return ctx.reply('No active tenants found.');

  await ctx.reply(`⏳ Setting webhooks for ${res.rows.length} tenant(s)...`);

  for (const tenant of res.rows) {
    try {
      const { Telegraf } = require('telegraf');
      const { decrypt } = require('../services/encryption');
      const token = decrypt(tenant.bot_token);
      const bot = new Telegraf(token);
      await bot.telegram.setWebhook(`${webhookUrl}/bot/${tenant.tenant_id}`);
      await ctx.reply(`✅ ${tenant.name}: webhook set`);
      logger.info('Webhook fixed', { tenantId: tenant.tenant_id });
    } catch (err) {
      await ctx.reply(`❌ ${tenant.name}: ${err.message}`);
      logger.error('Webhook fix failed', { tenantId: tenant.tenant_id, error: err.message });
    }
  }

  await ctx.reply('✅ Done.');
}

async function reloadTenant(ctx) {
  const parts = ctx.message.text.split(' ');
  const tenantId = parts[1];

  if (!tenantId) {
    return ctx.reply('Usage: /reloadtenant tenant_id\n\nExample:\n/reloadtenant tenant_1783594930708');
  }

  const res = await db.query(
    'SELECT * FROM tenants WHERE tenant_id=$1',
    [tenantId]
  );

  if (!res.rows.length) return ctx.reply(`❌ Tenant not found: ${tenantId}`);

  await tenantManager.stopTenant(tenantId);
  await tenantManager.launchTenant(res.rows[0]);

  logger.info('Tenant reloaded', { tenantId, by: ctx.from.id });

  return ctx.replyWithMarkdown(
    `✅ *Tenant Reloaded!*

Name:      ${res.rows[0].name}
Tenant ID: \`${tenantId}\`

Fresh data loaded from database.`
  );
}

async function handleProviderCallback(ctx) {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const choice = ctx.callbackQuery.data.replace('provider_', '');
  const state = awaitingTenant.get(userId);

  if (!state || state.step !== 'network_provider') {
    return ctx.editMessageText('Session expired. Use /addtenant to start again.');
  }

  state.network_provider = choice;

  if (choice === 'none') {
    state.step = 'ready';
    awaitingTenant.set(userId, state);
    await ctx.editMessageText('No network provider selected. Proceeding...');
    return finalizeTenant(ctx, state, userId);
  }

  if (choice === 'omada') {
    state.step = 'omada_url';
    awaitingTenant.set(userId, state);
    return ctx.editMessageText(
      `Step 8/9 — Omada Controller URL

Enter the URL of your Omada Software Controller:
Example: https://your-vps-ip:8043`
    );
  }

  if (choice === 'mikrotik') {
    state.step = 'mikrotik_url';
    awaitingTenant.set(userId, state);
    return ctx.editMessageText(
      `Step 8/9 — MikroTik Router URL

Enter the MikroTik REST API base URL:
Example: https://192.168.1.1/rest`
    );
  }
}

async function finalizeTenant(ctx, state, userId) {
  const tenantId = `tenant_${Date.now()}`;
  const webhookUrl = process.env.WEBHOOK_URL || null;

  // Check for duplicate bot token
  const existing = await db.query(
    'SELECT tenant_id FROM tenants WHERE bot_token=$1',
    [encrypt(state.bot_token)]
  );
  const existingPlain = await db.query(
    'SELECT tenant_id FROM tenants WHERE bot_token=$1',
    [state.bot_token]
  );

  if (existing.rows.length || existingPlain.rows.length) {
    const existingId = existing.rows[0]?.tenant_id || existingPlain.rows[0]?.tenant_id;
    awaitingTenant.delete(userId);
    return ctx.reply(
      `❌ That bot token is already registered under tenant \`${existingId}\`.`
    );
  }

  // Encrypt and save
await db.query(
    `INSERT INTO tenants
     (tenant_id, name, email, telegram_id, bot_token,
      paystack_secret, paystack_public, webhook_url,
      network_provider,
      omada_url, omada_controller_id, omada_site_id, omada_client_id, omada_client_secret,
      omada_controller_type, omada_cloud_cert, omada_cloud_key,
      mikrotik_url, mikrotik_username, mikrotik_password)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [
      tenantId,
      state.name,
      state.email,
      state.owner_telegram_id,
      encrypt(state.bot_token),
      encrypt(state.paystack_secret),
      encrypt(state.paystack_public),
      webhookUrl,
      state.network_provider            || 'none',
      state.omada_url                   || null,
      state.omada_controller_id         || null,
      state.omada_site_id               || null,
      state.omada_client_id             ? encrypt(state.omada_client_id)     : null,
      state.omada_client_secret         ? encrypt(state.omada_client_secret) : null,
      state.omada_controller_type       || 'software',
      state.omada_cloud_cert            || null,
      state.omada_cloud_key             || null,
      state.mikrotik_url                || null,
      state.mikrotik_username           ? encrypt(state.mikrotik_username)   : null,
      state.mikrotik_password           ? encrypt(state.mikrotik_password)   : null,
    ]
  );
  const tenantRes = await db.query(
    'SELECT * FROM tenants WHERE tenant_id=$1', [tenantId]
  );
  await tenantManager.launchTenant(tenantRes.rows[0]);

  const paystackWebhook = webhookUrl
    ? `${webhookUrl}/pay/${tenantId}`
    : 'Set WEBHOOK_URL on Render';

  // Test provider connection
  let providerStatus = '';
  if (state.network_provider && state.network_provider !== 'none') {
    try {
      const { getProvider } = require('../services/providers');
      const provider = getProvider(tenantRes.rows[0]);
      const test = await provider.testConnection();
      providerStatus = test.success
        ? `\n✅ ${state.network_provider} connection verified`
        : `\n⚠️ ${state.network_provider} connection failed: ${test.message}`;
    } catch (e) {
      providerStatus = `\n⚠️ Could not test provider: ${e.message}`;
    }
  }

  logger.info('Tenant created', {
    tenantId,
    name: state.name,
    provider: state.network_provider,
    ownerId: state.owner_telegram_id,
    by: userId,
  });

  // Notify tenant owner
  try {
    await ctx.telegram.sendMessage(
      state.owner_telegram_id,
      `🎉 *Your ISP Bot is Live — ${state.name}!*

You have full admin access to your bot.

👥 *Users*
/users — View all users
/online — Live connected clients

💰 *Finance*
/sales — Today's sales
/revenue — Total revenue

📦 *Stock*
/stock — Bandwidth usage

👮 *Admin Management*
/addadmin — Add a sub-admin
/listadmins — View all admins

*Action Required — Paystack Webhook:*
Go to dashboard.paystack.com → Settings → API Keys & Webhooks and paste:
\`${paystackWebhook}\``,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    logger.warn('Could not notify tenant owner', { error: e.message });
  }

  awaitingTenant.delete(userId);

  return ctx.replyWithMarkdown(
    `✅ *Tenant Created & Bot Launched!*

Name:      ${state.name}
Email:     ${state.email}
Tenant ID: \`${tenantId}\`
Provider:  ${state.network_provider || 'none'}${providerStatus}

*Paystack Webhook URL:*
\`${paystackWebhook}\`

_Tenant has been notified._`
  );
}

async function handleSuperAdminText(ctx, next) {
  const userId = ctx.from.id;
  const text = ctx.message?.text?.trim();

  if (!text || text.startsWith('/')) return next();

  const state = awaitingTenant.get(userId);
  if (!state) return next();

  try {
    if (state.step === 'name') {
      if (text.length < 2) return ctx.reply('Name too short. Try again:');
      state.name = text;
      state.step = 'email';
      awaitingTenant.set(userId, state);
      return ctx.reply('Step 2/6 — Enter their email address:');
    }

    if (state.step === 'email') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(text)) return ctx.reply('Invalid email. Try again:');
      state.email = text;
      state.step = 'bot_token';
      awaitingTenant.set(userId, state);
      return ctx.reply('Step 3/6 — Enter their Telegram Bot Token (from @BotFather):');
    }

    if (state.step === 'bot_token') {
      if (!text.includes(':')) return ctx.reply('That doesn\'t look like a valid bot token. Try again:');
      state.bot_token = text;
      state.step = 'owner_telegram_id';
      awaitingTenant.set(userId, state);
      return ctx.reply('Step 4/6 — Enter the tenant\'s Telegram ID (they can get it from @userinfobot):');
    }

    if (state.step === 'owner_telegram_id') {
      const ownerId = parseInt(text);
      if (isNaN(ownerId)) return ctx.reply('Invalid Telegram ID. Send a number (e.g. 5926845553):');
      state.owner_telegram_id = ownerId;
      state.step = 'paystack_secret';
      awaitingTenant.set(userId, state);
      return ctx.reply('Step 5/6 — Enter their Paystack Secret Key (sk_test_... or sk_live_...):');
    }

    if (state.step === 'paystack_secret') {
      if (!text.startsWith('sk_')) return ctx.reply('Invalid Paystack secret key. Must start with sk_test_ or sk_live_. Try again:');
      state.paystack_secret = text;
      state.step = 'paystack_public';
      awaitingTenant.set(userId, state);
      return ctx.reply('Step 6/6 — Enter their Paystack Public Key (pk_test_... or pk_live_...):');
    }

    if (state.step === 'paystack_public') {
      if (!text.startsWith('pk_')) return ctx.reply('Invalid Paystack public key. Must start with pk_test_ or pk_live_. Try again:');
      state.paystack_public = text;
      state.step = 'network_provider';
      awaitingTenant.set(userId, state);
      return ctx.replyWithMarkdown(
        `Step 7/9 — *Network Provider*

Which network provider does this tenant use?`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📡 Omada Controller', callback_data: 'provider_omada' }],
              [{ text: '🔧 MikroTik Router', callback_data: 'provider_mikrotik' }],
              [{ text: '⏭ None (Skip)', callback_data: 'provider_none' }],
            ],
          },
        }
      );
    }

  } catch (err) {
    awaitingTenant.delete(userId);
    logger.error('Tenant creation error', { error: err.message, userId });
    return ctx.reply(`❌ Something went wrong: ${err.message}\n\nUse /addtenant to try again.`);
  }

  // ── Omada steps ──────────────────────────────
  if (state.step === 'omada_url') {
    if (!text.startsWith('http')) return ctx.reply('Must be a valid URL starting with http:// or https://. Try again:');
    state.omada_url = text.replace(/\/$/, '');
    state.step = 'omada_controller_id';
    awaitingTenant.set(userId, state);
    return ctx.reply(
      `Step 8b — Enter the Omada Controller ID (omadacId)

This is found by opening:
${state.omada_url}/api/info

Look for the "omadacId" field in the response.
Example: ae3846afd47b384710ca7c9cf4ef8011`
    );
  }

  if (state.step === 'omada_controller_id') {
    if (text.length < 10) return ctx.reply('That doesn\'t look like a valid controller ID. Try again:');
    state.omada_controller_id = text;
    state.step = 'omada_site_id';
    awaitingTenant.set(userId, state);
    return ctx.reply(
      `Step 8c — Enter the Omada Site ID

Open your Omada controller, go to your site, and copy the Site ID from the browser URL.
Example: 6a6393445c7bdd073c22a2ac`
    );
  }

  if (state.step === 'omada_site_id') {
    state.omada_site_id = text;
    state.step = 'omada_client_id';
    awaitingTenant.set(userId, state);
    return ctx.reply('Step 8c — Enter the Omada API Client ID:');
  }

  if (state.step === 'omada_client_id') {
    state.omada_client_id = text;
    state.step = 'omada_client_secret';
    awaitingTenant.set(userId, state);
    return ctx.reply('Step 9/9 — Enter the Omada API Client Secret:');
  }

  if (state.step === 'omada_client_secret') {
    state.omada_client_secret = text;
    awaitingTenant.delete(userId);
    await ctx.reply('⏳ Creating tenant and launching bot...');
    return finalizeTenant(ctx, state, userId);
  }

  // ── MikroTik steps ────────────────────────────
  if (state.step === 'mikrotik_url') {
    if (!text.startsWith('http')) return ctx.reply('Must be a valid URL. Try again:');
    state.mikrotik_url = text.replace(/\/$/, '');
    state.step = 'mikrotik_username';
    awaitingTenant.set(userId, state);
    return ctx.reply('Step 8b — Enter the MikroTik admin username:');
  }

  if (state.step === 'mikrotik_username') {
    state.mikrotik_username = text;
    state.step = 'mikrotik_password';
    awaitingTenant.set(userId, state);
    return ctx.reply('Step 9/9 — Enter the MikroTik admin password:');
  }

  if (state.step === 'mikrotik_password') {
    state.mikrotik_password = text;
    awaitingTenant.delete(userId);
    await ctx.reply('⏳ Creating tenant and launching bot...');
    return finalizeTenant(ctx, state, userId);
  }

  return next();
}
async function testProvider(ctx) {
  const parts = ctx.message.text.split(' ');
  const tenantId = parts[1];

  if (!tenantId) {
    return ctx.reply('Usage: /testprovider tenant_id');
  }

  const res = await db.query(
    'SELECT * FROM tenants WHERE tenant_id=$1', [tenantId]
  );

  if (!res.rows.length) return ctx.reply(`❌ Tenant not found: ${tenantId}`);

  const tenant = res.rows[0];
  if (tenant.network_provider === 'none') {
    return ctx.reply('This tenant has no network provider configured.');
  }

  await ctx.reply(`⏳ Testing ${tenant.network_provider} connection for ${tenant.name}...`);

  try {
    const { getProvider, clearProviderCache } = require('../services/providers');
    clearProviderCache(tenantId);
    const provider = getProvider(tenant);
    const result = await provider.testConnection();

    if (result.success) {
      return ctx.replyWithMarkdown(
        `✅ *Connection Successful*

Tenant:   ${tenant.name}
Provider: ${tenant.network_provider}
Message:  ${result.message}`
      );
    } else {
      return ctx.replyWithMarkdown(
        `❌ *Connection Failed*

Tenant:   ${tenant.name}
Provider: ${tenant.network_provider}
Error:    ${result.message}`
      );
    }
  } catch (err) {
    return ctx.reply(`❌ Test failed: ${err.message}`);
  }
}

module.exports = {
  startAddTenant,
  listTenants,
  totalRevenue,
  deactivateTenant,
  handleDeactivateCallback,
  handleSuperAdminText,
  fixWebhooks,
  reloadTenant,
  handleProviderCallback,
  testProvider,

};