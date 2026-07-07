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

// Handle multi-step tenant creation
async function handleSuperAdminText(ctx, next) {
  const userId = ctx.from.id;
  const text   = ctx.message.text.trim();
  const state  = awaitingTenant.get(userId);

  if (!state) return next();

  if (state.step === 'name') {
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
    state.bot_token = text;
    state.step      = 'paystack_secret';
    awaitingTenant.set(userId, state);
    return ctx.reply('Step 4/5 — Enter their Paystack Secret Key (sk_live_...):');
  }

  if (state.step === 'paystack_secret') {
    state.paystack_secret = text;
    state.step            = 'paystack_public';
    awaitingTenant.set(userId, state);
    return ctx.reply('Step 5/5 — Enter their Paystack Public Key (pk_live_...):');
  }

  if (state.step === 'paystack_public') {
    state.paystack_public = text;
    awaitingTenant.delete(userId);

    // Generate unique tenant ID
    const tenantId = `tenant_${Date.now()}`;
    const webhookUrl = process.env.WEBHOOK_URL;

    // Save to database
    await db.query(
      `INSERT INTO tenants
       (tenant_id, name, email, bot_token, paystack_secret, paystack_public, webhook_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tenantId, state.name, state.email,
       state.bot_token, state.paystack_secret,
       state.paystack_public, webhookUrl]
    );

    // Launch the bot immediately — no redeployment needed
    const tenant = await db.query(
      'SELECT * FROM tenants WHERE tenant_id=$1',
      [tenantId]
    );
    await tenantManager.launchTenant(tenant.rows[0]);

    return ctx.replyWithMarkdown(
`✅ *Tenant Created & Bot Launched!*

Name:      ${state.name}
Email:     ${state.email}
Tenant ID: \`${tenantId}\`

*Paystack Webhook URL for this tenant:*
\`${webhookUrl}/pay/${tenantId}\`

Share this webhook URL with the tenant to set in their Paystack dashboard.
Their bot is live right now — no redeployment needed.`
    );
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
};