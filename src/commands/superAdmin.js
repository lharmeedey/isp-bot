const db            = require('../services/db');
const logger        = require('../services/logger');
const { naira }     = require('../services/helpers');
const { encrypt }   = require('../services/encryption');
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
    text:          `${t.name} (${t.tenant_id})`,
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
      const { Telegraf }  = require('telegraf');
      const { decrypt }   = require('../services/encryption');
      const token         = decrypt(tenant.bot_token);
      const bot           = new Telegraf(token);
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
  const parts    = ctx.message.text.split(' ');
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

async function handleSuperAdminText(ctx, next) {
  const userId = ctx.from.id;
  const text   = ctx.message?.text?.trim();

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
      state.step  = 'bot_token';
      awaitingTenant.set(userId, state);
      return ctx.reply('Step 3/6 — Enter their Telegram Bot Token (from @BotFather):');
    }

    if (state.step === 'bot_token') {
      if (!text.includes(':')) return ctx.reply('That doesn\'t look like a valid bot token. Try again:');
      state.bot_token = text;
      state.step      = 'owner_telegram_id';
      awaitingTenant.set(userId, state);
      return ctx.reply('Step 4/6 — Enter the tenant\'s Telegram ID (they can get it from @userinfobot):');
    }

    if (state.step === 'owner_telegram_id') {
      const ownerId = parseInt(text);
      if (isNaN(ownerId)) return ctx.reply('Invalid Telegram ID. Send a number (e.g. 5926845553):');
      state.owner_telegram_id = ownerId;
      state.step              = 'paystack_secret';
      awaitingTenant.set(userId, state);
      return ctx.reply('Step 5/6 — Enter their Paystack Secret Key (sk_test_... or sk_live_...):');
    }

    if (state.step === 'paystack_secret') {
      if (!text.startsWith('sk_')) return ctx.reply('Invalid Paystack secret key. Must start with sk_test_ or sk_live_. Try again:');
      state.paystack_secret = text;
      state.step            = 'paystack_public';
      awaitingTenant.set(userId, state);
      return ctx.reply('Step 6/6 — Enter their Paystack Public Key (pk_test_... or pk_live_...):');
    }

    if (state.step === 'paystack_public') {
      if (!text.startsWith('pk_')) return ctx.reply('Invalid Paystack public key. Must start with pk_test_ or pk_live_. Try again:');
      state.paystack_public = text;
      awaitingTenant.delete(userId);

      await ctx.reply('⏳ Creating tenant and launching bot...');

      const tenantId   = `tenant_${Date.now()}`;
      const webhookUrl = process.env.WEBHOOK_URL || null;

      // Check for duplicate bot token
      const existing = await db.query(
        'SELECT tenant_id FROM tenants WHERE bot_token=$1',
        [encrypt(state.bot_token)]
      );

      // Also check plain text in case of legacy unencrypted tokens
      const existingPlain = await db.query(
        'SELECT tenant_id FROM tenants WHERE bot_token=$1',
        [state.bot_token]
      );

      if (existing.rows.length || existingPlain.rows.length) {
        const existingId = existing.rows[0]?.tenant_id || existingPlain.rows[0]?.tenant_id;
        return ctx.reply(
          `❌ That bot token is already registered under tenant \`${existingId}\`.\n\nAsk the client to create a new bot via @BotFather.`
        );
      }

      // Encrypt sensitive fields before storing
      await db.query(
        `INSERT INTO tenants
         (tenant_id, name, email, telegram_id, bot_token, paystack_secret, paystack_public, webhook_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          tenantId,
          state.name,
          state.email,
          state.owner_telegram_id,
          encrypt(state.bot_token),
          encrypt(state.paystack_secret),
          encrypt(state.paystack_public),
          webhookUrl,
        ]
      );

      // Fetch full record and launch
      const tenantRes = await db.query(
        'SELECT * FROM tenants WHERE tenant_id=$1',
        [tenantId]
      );
      await tenantManager.launchTenant(tenantRes.rows[0]);

      const paystackWebhook = webhookUrl
        ? `${webhookUrl}/pay/${tenantId}`
        : 'Not available locally — set WEBHOOK_URL on Render';

      logger.info('Tenant created', {
        tenantId,
        name:    state.name,
        ownerId: state.owner_telegram_id,
        by:      userId,
      });

      // Notify tenant owner
      try {
        await ctx.telegram.sendMessage(
          state.owner_telegram_id,
`🎉 *Your ISP Bot is Live — ${state.name}!*

You have full admin access to your bot.

👥 *Users*
/users — View all users
/online — Active vs inactive

💰 *Finance*
/sales — Today's sales
/revenue — Total revenue

📦 *Stock*
/stock — Bandwidth usage

👮 *Admin Management*
/addadmin — Add a sub-admin
/removeadmin — Remove a sub-admin
/listadmins — View all admins

*Action Required — Paystack Webhook:*
Go to dashboard.paystack.com → Settings → API Keys & Webhooks and paste:
\`${paystackWebhook}\``,
          { parse_mode: 'Markdown' }
        );
      } catch (e) {
        logger.warn('Could not notify tenant owner', {
          ownerId: state.owner_telegram_id,
          error:   e.message,
        });
      }

      return ctx.replyWithMarkdown(
`✅ *Tenant Created & Bot Launched!*

Name:      ${state.name}
Email:     ${state.email}
Tenant ID: \`${tenantId}\`
Owner ID:  \`${state.owner_telegram_id}\`

*Paystack Webhook URL:*
\`${paystackWebhook}\`

_Keys encrypted and stored. Tenant has been notified._`
      );
    }

  } catch (err) {
    awaitingTenant.delete(userId);
    logger.error('Tenant creation error', { error: err.message, userId });
    return ctx.reply(`❌ Something went wrong: ${err.message}\n\nUse /addtenant to try again.`);
  }

  return next();
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
};