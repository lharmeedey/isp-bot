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

Step 1 — Enter the tenant's *business name*:`
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
      const { Telegraf } = require('telegraf');
      const { decrypt }  = require('../services/encryption');
      const token        = decrypt(tenant.bot_token);
      const bot          = new Telegraf(token);
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
    return ctx.reply('Usage: /reloadtenant tenant_id\n\nExample:\n/reloadtenant tenant_123');
  }

  const res = await db.query('SELECT * FROM tenants WHERE tenant_id=$1', [tenantId]);
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

async function testProvider(ctx) {
  const parts    = ctx.message.text.split(' ');
  const tenantId = parts[1];

  if (!tenantId) return ctx.reply('Usage: /testprovider tenant_id');

  const res = await db.query('SELECT * FROM tenants WHERE tenant_id=$1', [tenantId]);
  if (!res.rows.length) return ctx.reply(`❌ Tenant not found: ${tenantId}`);

  const tenant = res.rows[0];
  if (tenant.network_provider === 'none' || !tenant.network_provider) {
    return ctx.reply('This tenant has no network provider configured.');
  }

  await ctx.reply(`⏳ Testing ${tenant.network_provider} connection for ${tenant.name}...`);

  try {
    const { getProvider, clearProviderCache } = require('../services/providers');
    clearProviderCache(tenantId);
    const provider = getProvider(tenant);
    const result   = await provider.testConnection();

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

// ── Provider selection callback ────────────────
async function handleProviderCallback(ctx) {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const choice = ctx.callbackQuery.data.replace('provider_', '');
  const state  = awaitingTenant.get(userId);

  if (!state || state.step !== 'network_provider') {
    return ctx.editMessageText('Session expired. Use /addtenant to start again.');
  }

  state.network_provider = choice;

  if (choice === 'none') {
    awaitingTenant.set(userId, state);
    await ctx.editMessageText('No network provider selected. Proceeding...');
    return finalizeTenant(ctx, state, userId);
  }

  if (choice === 'omada') {
    state.step = 'omada_controller_type';
    awaitingTenant.set(userId, state);
    return ctx.editMessageText(
      'Step 7b — Which type of Omada controller does this tenant use?',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🖥 Software Controller (VPS/PC)', callback_data: 'omadatype_software' }],
            [{ text: '📦 Hardware Controller (Device)',  callback_data: 'omadatype_hardware' }],
            [{ text: '☁️ Cloud Controller (TP-Link)',    callback_data: 'omadatype_cloud'    }],
          ],
        },
      }
    );
  }

  if (choice === 'mikrotik') {
    state.step = 'mikrotik_url';
    awaitingTenant.set(userId, state);
    return ctx.editMessageText(
`Step 8 — MikroTik Router URL

Enter the MikroTik REST API base URL:
Example: https://192.168.1.1/rest`
    );
  }
}

// ── Omada controller type callback ────────────
async function handleOmadaTypeCallback(ctx) {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const type   = ctx.callbackQuery.data.replace('omadatype_', '');
  const state  = awaitingTenant.get(userId);

  if (!state || state.step !== 'omada_controller_type') {
    return ctx.editMessageText('Session expired. Use /addtenant to start again.');
  }

  state.omada_controller_type = type;
  state.step                  = 'omada_url';
  awaitingTenant.set(userId, state);

  const examples = {
    software: 'https://your-vps-ip:8043',
    hardware: 'https://192.168.1.1:8043',
    cloud:    'https://cloudapi.tplinkomada.com',
  };

  const notes = {
    software: 'Your AWS VPS running Omada Software Controller',
    hardware: 'IP address of your physical Omada Hardware Controller',
    cloud:    'TP-Link hosted cloud — requires certificates from TP-Link',
  };

  return ctx.editMessageText(
`Step 8 — Omada Controller URL

Controller type: *${type}*

Enter the controller URL:
Example: \`${examples[type]}\`

Note: ${notes[type]}`,
    { parse_mode: 'Markdown' }
  );
}

// ── Multi-step text handler ────────────────────
async function handleSuperAdminText(ctx, next) {
  const userId = ctx.from.id;
  const text   = ctx.message?.text?.trim();

  if (!text || text.startsWith('/')) return next();

  const state = awaitingTenant.get(userId);
  if (!state) return next();

  try {

    // ── Step 1: Business name ──────────────────
    if (state.step === 'name') {
      if (text.length < 2) return ctx.reply('Name too short. Try again:');
      state.name = text;
      state.step = 'email';
      awaitingTenant.set(userId, state);
      return ctx.reply('Step 2 — Enter their email address:');
    }

    // ── Step 2: Email ──────────────────────────
    if (state.step === 'email') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(text)) return ctx.reply('Invalid email. Try again:');
      state.email = text;
      state.step  = 'bot_token';
      awaitingTenant.set(userId, state);
      return ctx.reply('Step 3 — Enter their Telegram Bot Token (from @BotFather):');
    }

    // ── Step 3: Bot token ──────────────────────
    if (state.step === 'bot_token') {
      if (!text.includes(':')) return ctx.reply('That doesn\'t look like a valid bot token. Try again:');
      state.bot_token = text;
      state.step      = 'owner_telegram_id';
      awaitingTenant.set(userId, state);
      return ctx.reply('Step 4 — Enter the tenant\'s Telegram ID (they can get it from @userinfobot):');
    }

    // ── Step 4: Owner Telegram ID ──────────────
    if (state.step === 'owner_telegram_id') {
      const ownerId = parseInt(text);
      if (isNaN(ownerId)) return ctx.reply('Invalid Telegram ID. Send a number (e.g. 5926845553):');
      state.owner_telegram_id = ownerId;
      state.step              = 'paystack_secret';
      awaitingTenant.set(userId, state);
      return ctx.reply('Step 5 — Enter their Paystack Secret Key (sk_test_... or sk_live_...):');
    }

    // ── Step 5: Paystack secret ────────────────
    if (state.step === 'paystack_secret') {
      if (!text.startsWith('sk_')) return ctx.reply('Invalid Paystack secret key. Must start with sk_test_ or sk_live_. Try again:');
      state.paystack_secret = text;
      state.step            = 'paystack_public';
      awaitingTenant.set(userId, state);
      return ctx.reply('Step 6 — Enter their Paystack Public Key (pk_test_... or pk_live_...):');
    }

    // ── Step 6: Paystack public ────────────────
    if (state.step === 'paystack_public') {
      if (!text.startsWith('pk_')) return ctx.reply('Invalid Paystack public key. Must start with pk_test_ or pk_live_. Try again:');
      state.paystack_public = text;
      state.step            = 'network_provider';
      awaitingTenant.set(userId, state);
      return ctx.replyWithMarkdown(
        'Step 7 — *Which network provider does this tenant use?*',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📡 Omada Controller',  callback_data: 'provider_omada'    }],
              [{ text: '🔧 MikroTik Router',   callback_data: 'provider_mikrotik' }],
              [{ text: '⏭ None (Skip)',         callback_data: 'provider_none'     }],
            ],
          },
        }
      );
    }

    // ── Omada steps ────────────────────────────

    if (state.step === 'omada_url') {
      if (!text.startsWith('http')) return ctx.reply('Must be a valid URL starting with http:// or https://. Try again:');
      state.omada_url = text.replace(/\/$/, '');
      state.step      = 'omada_controller_id';
      awaitingTenant.set(userId, state);
      return ctx.reply(
`Step 8b — Enter the Omada Controller ID

Open this URL in your browser:
${state.omada_url}/api/info

Copy the value of "omadacId" from the response.
Example: ae3846afd47b384710ca7c9cf4ef8011`
      );
    }

    if (state.step === 'omada_controller_id') {
      if (text.length < 10) return ctx.reply('That doesn\'t look like a valid controller ID. Try again:');
      state.omada_controller_id = text;
      state.step                = 'omada_site_id';
      awaitingTenant.set(userId, state);
      return ctx.reply(
`Step 8c — Enter the Omada Site ID

Go to your Omada controller → click your site → copy the Site ID from the browser URL.
Example: 6a6393445c7bdd073c22a2ac`
      );
    }

    if (state.step === 'omada_site_id') {
      if (text.length < 10) return ctx.reply('That doesn\'t look like a valid Site ID. Try again:');
      state.omada_site_id = text;
      state.step          = 'omada_client_id';
      awaitingTenant.set(userId, state);
      return ctx.reply('Step 8d — Enter the Omada API Client ID:');
    }

    if (state.step === 'omada_client_id') {
      state.omada_client_id = text;
      state.step            = 'omada_client_secret';
      awaitingTenant.set(userId, state);
      return ctx.reply('Step 9 — Enter the Omada API Client Secret:');
    }

  if (state.step === 'omada_client_secret') {
      state.omada_client_secret = text;
      state.step                = 'omada_admin_username';
      awaitingTenant.set(userId, state);
      return ctx.reply(
`Step 9a — Omada Admin Username

Enter the email/username you use to log into the Omada controller dashboard:`
      );
    }

    if (state.step === 'omada_admin_username') {
      state.omada_admin_username = text;
      state.step                 = 'omada_admin_password';
      awaitingTenant.set(userId, state);
      return ctx.reply('Step 9b — Enter the Omada admin password:');
    }

    if (state.step === 'omada_admin_password') {
      state.omada_admin_password = text;

      // Cloud needs certificates
      if (state.omada_controller_type === 'cloud') {
        state.step = 'omada_cloud_cert';
        awaitingTenant.set(userId, state);
        return ctx.reply(
`Cloud controller requires certificates from TP-Link.

Paste the full contents of your client.crt file
(including -----BEGIN CERTIFICATE----- and -----END CERTIFICATE-----)`
        );
      }

      awaitingTenant.delete(userId);
      await ctx.reply('⏳ Creating tenant and launching bot...');
      return finalizeTenant(ctx, state, userId);
    }

    if (state.step === 'omada_cloud_cert') {
      if (!text.includes('BEGIN CERTIFICATE')) {
        return ctx.reply('Invalid certificate. Must include -----BEGIN CERTIFICATE-----. Try again:');
      }
      state.omada_cloud_cert = text;
      state.step             = 'omada_cloud_key';
      awaitingTenant.set(userId, state);
      return ctx.reply(
`Good. Now paste the full contents of your client.key file
(including -----BEGIN RSA PRIVATE KEY----- and -----END RSA PRIVATE KEY-----)`
      );
    }

    if (state.step === 'omada_cloud_key') {
      if (!text.includes('BEGIN') || !text.includes('KEY')) {
        return ctx.reply('Invalid private key. Try again:');
      }
      state.omada_cloud_key = text;
      awaitingTenant.delete(userId);
      await ctx.reply('⏳ Creating tenant and launching bot...');
      return finalizeTenant(ctx, state, userId);
    }

    // ── MikroTik steps ─────────────────────────

    if (state.step === 'mikrotik_url') {
      if (!text.startsWith('http')) return ctx.reply('Must be a valid URL. Try again:');
      state.mikrotik_url = text.replace(/\/$/, '');
      state.step         = 'mikrotik_username';
      awaitingTenant.set(userId, state);
      return ctx.reply('Step 8b — Enter the MikroTik admin username:');
    }

    if (state.step === 'mikrotik_username') {
      state.mikrotik_username = text;
      state.step              = 'mikrotik_password';
      awaitingTenant.set(userId, state);
      return ctx.reply('Step 9 — Enter the MikroTik admin password:');
    }

    if (state.step === 'mikrotik_password') {
      state.mikrotik_password = text;
      awaitingTenant.delete(userId);
      await ctx.reply('⏳ Creating tenant and launching bot...');
      return finalizeTenant(ctx, state, userId);
    }

} catch (err) {
    awaitingTenant.delete(userId);
    logger.error('Tenant creation error', { error: err.message, stack: err.stack, userId });
    console.error('FULL ERROR:', err);
    return ctx.reply(`❌ Something went wrong: ${err.message}\n\nUse /addtenant to try again.`);
  }

  return next();
}

// ── Finalize tenant creation ───────────────────
async function finalizeTenant(ctx, state, userId) {
  const tenantId   = `tenant_${Date.now()}`;
  const webhookUrl = process.env.WEBHOOK_URL || null;

  try {
    logger.info('finalizeTenant started', {
      userId,
      provider:  state.network_provider,
      name:      state.name,
      has_token: !!state.bot_token,
    });

    // Step 1 — Check duplicate token
    let existingId = null;
    try {
      const existing = await db.query(
        'SELECT tenant_id FROM tenants WHERE bot_token=$1',
        [encrypt(state.bot_token)]
      );
      const existingPlain = await db.query(
        'SELECT tenant_id FROM tenants WHERE bot_token=$1',
        [state.bot_token]
      );
      if (existing.rows.length || existingPlain.rows.length) {
        existingId = existing.rows[0]?.tenant_id || existingPlain.rows[0]?.tenant_id;
      }
    } catch (e) {
      logger.error('Duplicate check failed', { error: e.message });
      throw new Error(`Duplicate check failed: ${e.message}`);
    }

    if (existingId) {
      awaitingTenant.delete(userId);
      return ctx.reply(`❌ That bot token is already registered under tenant \`${existingId}\`.`);
    }

    logger.info('Duplicate check passed, inserting tenant...');

    // Step 2 — Insert tenant
    try {
      await db.query(
        `INSERT INTO tenants
         (tenant_id, name, email, telegram_id, bot_token,
          paystack_secret, paystack_public, webhook_url,
          network_provider,
      omada_url, omada_controller_id, omada_site_id, omada_client_id, omada_client_secret,
      omada_controller_type, omada_cloud_cert, omada_cloud_key,
      omada_admin_username, omada_admin_password,
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
          state.network_provider      || 'none',
          state.omada_url             || null,
          state.omada_controller_id   || null,
          state.omada_site_id         || null,
          state.omada_client_id       ? encrypt(state.omada_client_id)     : null,
          state.omada_client_secret   ? encrypt(state.omada_client_secret) : null,
          state.omada_controller_type || 'software',
          state.omada_cloud_cert      || null,
          state.omada_cloud_key       || null,
          state.omada_admin_username ? encrypt(state.omada_admin_username) : null,
          state.omada_admin_password ? encrypt(state.omada_admin_password) : null,
          state.mikrotik_url          || null,
          state.mikrotik_username     ? encrypt(state.mikrotik_username)   : null,
          state.mikrotik_password     ? encrypt(state.mikrotik_password)   : null,
        ]
      );
    } catch (e) {
      logger.error('DB insert failed', { error: e.message });
      throw new Error(`DB insert failed: ${e.message}`);
    }

    logger.info('Tenant inserted, launching bot...');

    // Step 3 — Launch bot
    const tenantRes = await db.query(
      'SELECT * FROM tenants WHERE tenant_id=$1', [tenantId]
    );

    try {
      await tenantManager.launchTenant(tenantRes.rows[0]);
    } catch (e) {
      logger.error('Bot launch failed', { error: e.message });
      throw new Error(`Bot launch failed: ${e.message}`);
    }

    logger.info('Bot launched, testing provider...');

    // Step 4 — Test provider
    const paystackWebhook = webhookUrl
      ? `${webhookUrl}/pay/${tenantId}`
      : 'Set WEBHOOK_URL on Render';

    let providerStatus = '';
    if (state.network_provider && state.network_provider !== 'none') {
      try {
        const { getProvider } = require('../services/providers');
        const provider        = getProvider(tenantRes.rows[0]);
        const test            = await provider.testConnection();
        providerStatus = test.success
          ? `\n✅ ${state.network_provider} connection verified`
          : `\n⚠️ ${state.network_provider} failed: ${test.message}`;
        logger.info('Provider test result', { success: test.success, message: test.message });
      } catch (e) {
        logger.error('Provider test error', { error: e.message });
        providerStatus = `\n⚠️ Could not test provider: ${e.message}`;
      }
    }

    // Step 5 — Notify owner
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

    logger.info('Tenant created successfully', { tenantId, name: state.name });

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

  } catch (err) {
    awaitingTenant.delete(userId);
    logger.error('finalizeTenant failed', { error: err.message, stack: err.stack });
    return ctx.reply(`❌ Failed to create tenant: ${err.message}`);
  }
}


async function managePlans(ctx) {
  const parts    = ctx.message.text.split(' ');
  const tenantId = parts[1];

  if (!tenantId) {
    return ctx.reply('Usage: /manageplans tenant_id');
  }

  const res = await db.query(
    'SELECT * FROM tenants WHERE tenant_id=$1', [tenantId]
  );
  if (!res.rows.length) return ctx.reply('Tenant not found.');

  const tenant = res.rows[0];

  // Check if tenant has custom plans
  const plansRes = await db.query(
    'SELECT * FROM tenant_plans WHERE tenant_id=$1 AND active=true ORDER BY plan_id',
    [tenantId]
  );

  const currentPlans = plansRes.rows.length
    ? plansRes.rows
    : JSON.parse(process.env.PLANS || '[]').map(p => ({ ...p, omada_profile_id: p.omadaProfileId }));

  const lines = currentPlans.map(p =>
    `• *${p.label}*: ₦${Number(p.price).toLocaleString('en-NG')} | ${p.gb}GB | ${p.validity}`
  ).join('\n');

return ctx.reply(
`📦 Plans for ${tenant.name}

${lines.replace(/\*/g, '')}

To update a plan use:
/setplan ${tenantId} LABEL PRICE GB VALIDITY OMADA_PROFILE_ID

Example:
/setplan ${tenantId} 5GB 1500 5 7days 6a64e90e5c7bdd073c22b522

To reset to global plans:
/resetplans ${tenantId}`
  );
}

async function setPlan(ctx) {
  const parts = ctx.message.text.split(' ');

  if (parts.length < 7) {
   return ctx.reply(
      'Usage: /setplan tenant_id LABEL PRICE GB VALIDITY OMADA_PROFILE_ID\n\n' +
      'Note: Use underscore for spaces in validity e.g. 7_days or 30_days\n\n' +
      'Example:\n/setplan tenant_123 5GB 1500 5 7_days 6a64e90e5c7bdd073c22b522'
    );
  }

  const tenantId       = parts[1];
  const label          = parts[2];
  const price          = parseFloat(parts[3]);
  const gb             = parseFloat(parts[4]);
  const validity = parts[5].replace(/"/g, '').replace(/_/g, ' ');
  const omadaProfileId = parts[6];

  if (isNaN(price) || isNaN(gb)) {
    return ctx.reply('Invalid price or GB value.');
  }

  const tenantRes = await db.query(
    'SELECT * FROM tenants WHERE tenant_id=$1', [tenantId]
  );
  if (!tenantRes.rows.length) return ctx.reply('Tenant not found.');

  // Get plan_id from global plans
  const globalPlans = JSON.parse(process.env.PLANS || '[]');
  const globalPlan  = globalPlans.find(p => p.label === label);
  const planId      = globalPlan?.id || 99;

  await db.query(
    `INSERT INTO tenant_plans
     (tenant_id, plan_id, label, price, gb, validity, omada_profile_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (tenant_id, label)
     DO UPDATE SET price=$4, gb=$5, validity=$6, omada_profile_id=$7, active=true`,
    [tenantId, planId, label, price, gb, validity, omadaProfileId]
  );

  logger.info('Tenant plan updated', { tenantId, label, price, gb });

  return ctx.replyWithMarkdown(
`✅ *Plan Updated*

Tenant:  ${tenantRes.rows[0].name}
Plan:    ${label}
Price:   ₦${price.toLocaleString('en-NG')}
Data:    ${gb}GB
Period:  ${validity}

Run /reloadtenant ${tenantId} to apply changes.`
  );
}

async function resetPlans(ctx) {
  const parts    = ctx.message.text.split(' ');
  const tenantId = parts[1];

  if (!tenantId) return ctx.reply('Usage: /resetplans tenant_id');

  await db.query(
    'UPDATE tenant_plans SET active=false WHERE tenant_id=$1',
    [tenantId]
  );

  return ctx.replyWithMarkdown(
`✅ Plans reset to global defaults for \`${tenantId}\`

Run /reloadtenant ${tenantId} to apply.`
  );
}


module.exports = {
  startAddTenant,
  listTenants,
  totalRevenue,
  deactivateTenant,
  handleDeactivateCallback,
  handleSuperAdminText,
  handleProviderCallback,
  handleOmadaTypeCallback,
  fixWebhooks,
  reloadTenant,
  testProvider,
  managePlans,
  setPlan,
  resetPlans,
};