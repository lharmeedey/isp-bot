const db      = require('../services/db');
const logger  = require('../services/logger');
const { decrypt }        = require('../services/encryption');
const { commandLimiter, paymentLimiter } = require('../services/rateLimiter');
const { naira, gb, date, syncAge, usageBar, planKeyboard } = require('../services/helpers');
const axios   = require('axios');

const SUPER_ADMIN_IDS = (process.env.SUPER_ADMIN_IDS || '')
  .split(',').map(Number).filter(Boolean);

function register(bot, tenant) {
  const plans = JSON.parse(process.env.PLANS || JSON.stringify([
    { id: 1, label: '5GB',   price: 1000,  gb: 5,   validity: '7 days'  },
    { id: 2, label: '20GB',  price: 3500,  gb: 20,  validity: '30 days' },
    { id: 3, label: '100GB', price: 12000, gb: 100, validity: '30 days' },
    { id: 4, label: '500GB', price: 60000, gb: 500, validity: '30 days' },
  ]));

  const tid = tenant.tenant_id;

  // Per-tenant registration state — persists in memory per bot instance
  const awaitingEmail    = new Set();
  const awaitingName     = new Map();
  const awaitingSubAdmin = new Map();

  // ── Rate limit middleware ─────────────────────
  function rateLimit(ctx, next) {
    const userId = ctx.from?.id;
    if (!commandLimiter(String(userId))) {
      return ctx.reply('⚠️ Too many requests. Please slow down.');
    }
    return next();
  }

  // ── /start ────────────────────────────────────
  bot.command('start', rateLimit, async (ctx) => {
    const user = await getUser(ctx.from.id, tid);

    if (user?.email) {
      return ctx.replyWithMarkdown(
`👋 Welcome back, *${user.name || user.email}*!

/balance – Check your data balance
/buy – Purchase a data plan
/history – View past purchases
/support – Contact support`
      );
    }

    await ctx.replyWithMarkdown(
`👋 Welcome to *${tenant.name}*!

- Check your data balance
- Buy data plans instantly
- View purchase history
- Get low-data alerts

Let's get you set up.`
    );

    awaitingEmail.add(ctx.from.id);
    return ctx.reply('Please enter your email address (e.g. you@example.com):');
  });

 // ── /balance ──────────────────────────────────
  bot.command('balance', rateLimit, async (ctx) => {
    const user = await getUser(ctx.from.id, tid);
    if (!user) return ctx.reply('Please send /start to register first.');
    if (!user.plan) return ctx.reply('No active plan yet. Use /buy to get started.');

    // Try to get live usage from network provider
    const { getProvider } = require('../services/providers');
    const freshTenantRes  = await db.query(
      'SELECT * FROM tenants WHERE tenant_id=$1', [tid]
    );
    const freshTenant = freshTenantRes.rows[0];
    const provider    = getProvider(freshTenant);

    let remaining = parseFloat(user.remaining_gb);
    let total     = parseFloat(user.total_gb);
    let syncNote  = `_Last updated: ${syncAge(user)}_`;
    let expiry    = user.expiry;

    // Fetch live data if provider is configured
    if (freshTenant.network_provider !== 'none') {
      try {
        // Get user's active voucher
        const voucherRes = await db.query(
          `SELECT * FROM vouchers
           WHERE telegram_id=$1 AND tenant_id=$2
           ORDER BY created_at DESC LIMIT 1`,
          [ctx.from.id, tid]
        );

        if (voucherRes.rows[0]?.omada_voucher_id) {
          const liveUsage = await provider.getUsage(voucherRes.rows[0].omada_voucher_id);

          if (liveUsage) {
            remaining = liveUsage.remainingGb ?? remaining;
            total     = liveUsage.totalGb     ?? total;
            expiry    = liveUsage.expiry       ?? expiry;
            syncNote  = `_Live data from network ✓_`;

            // Update DB with fresh values
            await db.query(
              `UPDATE users SET remaining_gb=$1, total_gb=$2, last_sync=NOW()
               WHERE telegram_id=$3 AND tenant_id=$4`,
              [remaining, total, ctx.from.id, tid]
            );
          }
        }
      } catch (err) {
        logger.warn('Live balance fetch failed, using cached', { error: err.message });
        syncNote = `_Cached data — ${syncAge(user)}_`;
      }
    }

    const pct  = total > 0 ? Math.round((remaining / total) * 100) : 0;
    const bar  = usageBar(remaining, total);
    const warn = pct < 20 ? '\n\n⚠️ *Low data!* Recharge with /buy.' : '';

    return ctx.replyWithMarkdown(
`📊 *Your Data Balance*

Plan:      *${user.plan}*
Remaining: *${gb(remaining)}*
Used:      ${gb(total - remaining)} of ${gb(total)}
Expiry:    ${date(expiry)}

${bar}  ${pct}%
${syncNote}${warn}`
    );
  });

  // ── /buy ──────────────────────────────────────
  bot.command('buy', rateLimit, async (ctx) => {
    const user = await getUser(ctx.from.id, tid);
    if (!user) return ctx.reply('Please send /start to register first.');

    return ctx.replyWithMarkdown('📦 *Choose a data plan:*', {
      reply_markup: { inline_keyboard: planKeyboard(plans) },
    });
  });

  // ── Plan selection ────────────────────────────
  bot.action(/^plan_\d+$/, async (ctx) => {
    await ctx.answerCbQuery();

    if (!commandLimiter(String(ctx.from.id))) {
      return ctx.reply('⚠️ Too many requests. Please slow down.');
    }

    const user = await getUser(ctx.from.id, tid);
    if (!user) return ctx.reply('Please /start first.');

    const planId = parseInt(ctx.callbackQuery.data.replace('plan_', ''));
    const plan   = plans.find(p => p.id === planId);
    if (!plan) return ctx.reply('Invalid plan. Try /buy again.');

    await ctx.editMessageText(
      `🛒 *Order Summary*\n\nPlan:     ${plan.label}\nValidity: ${plan.validity}\nAmount:   ${naira(plan.price)}\n\nProceed to payment?`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '💳 Pay Now', callback_data: `confirm_${planId}` },
            { text: '❌ Cancel',  callback_data: 'cancel_buy'        },
          ]],
        },
      }
    );
  });

  // ── Payment confirmation ───────────────────────
  bot.action(/^confirm_\d+$/, async (ctx) => {
    await ctx.answerCbQuery('Generating payment link...');

    // Rate limit payment attempts
    if (!paymentLimiter(String(ctx.from.id))) {
      return ctx.editMessageText('⚠️ Too many payment attempts. Please wait a few minutes and try again.');
    }

    const user = await getUser(ctx.from.id, tid);
    if (!user) return;

    const planId = parseInt(ctx.callbackQuery.data.replace('confirm_', ''));
    const plan   = plans.find(p => p.id === planId);
    if (!plan) return;

    const reference = `${tid}-${ctx.from.id}-${Date.now()}`;

    try {
      await ctx.editMessageText('⏳ Creating payment link...');

      // Always fetch fresh from DB — never rely on closure
      const freshTenant = await db.query(
        'SELECT paystack_secret FROM tenants WHERE tenant_id=$1',
        [tid]
      );

      if (!freshTenant.rows.length) {
        return ctx.editMessageText('❌ Configuration error. Contact support.');
      }

      const paystackSecret = decrypt(freshTenant.rows[0].paystack_secret);

      if (!paystackSecret || !paystackSecret.startsWith('sk_')) {
        logger.error('Invalid Paystack secret', { tenantId: tid });
        return ctx.editMessageText('❌ Payment not configured. Contact support.');
      }

      const res = await axios.post(
        'https://api.paystack.co/transaction/initialize',
        {
          email:     user.email,
          amount:    plan.price * 100,
          reference,
          metadata: {
            telegram_id: String(ctx.from.id),
            plan:        plan.label,
            email:       user.email,
            tenant_id:   tid,
          },
        },
        {
          headers:         { Authorization: `Bearer ${paystackSecret}` },
          timeout:         10000,
        }
      );

      logger.info('Payment link created', {
        tenantId:  tid,
        plan:      plan.label,
        email:     user.email,
        reference,
      });

      await ctx.editMessageText(
        `💳 *Complete Your Payment*\n\nPlan:   ${plan.label}\nAmount: ${naira(plan.price)}\n\n_Tap Pay Now to complete. Data activates automatically after payment._`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '💳 Pay Now', url: res.data.data.authorization_url },
            ]],
          },
        }
      );

    } catch (err) {
      const detail = err.response?.data?.message || err.message;
      logger.error('Payment link error', { tenantId: tid, error: detail });
      await ctx.editMessageText(`❌ Could not create payment link. Please try again or contact /support.`);
    }
  });

  bot.action('cancel_buy', async (ctx) => {
    await ctx.answerCbQuery('Cancelled');
    await ctx.editMessageText('Purchase cancelled. Use /buy to start again.');
  });

  // ── /renewplan ────────────────────────────────
  bot.command('renewplan', rateLimit, async (ctx) => {
    const user = await getUser(ctx.from.id, tid);
    if (!user) return ctx.reply('Please send /start to register first.');

    if (!user.plan) {
      return ctx.replyWithMarkdown(
`You don't have an active plan to renew.

Use /buy to purchase a new plan.`
      );
    }

    const currentPlan = plans.find(p => p.label === user.plan);
    const expiry      = date(user.expiry);
    const remaining   = parseFloat(user.remaining_gb);
    const total       = parseFloat(user.total_gb);
    const pct         = total > 0 ? Math.round((remaining / total) * 100) : 0;

    // Show current plan info and renewal options
    await ctx.replyWithMarkdown(
`🔄 *Renew Your Plan*

Current Plan: *${user.plan}*
Remaining:    *${gb(remaining)}* (${pct}%)
Expiry:       ${expiry}

Choose how you want to renew:`
    );

    // Option 1 — renew same plan
    // Option 2 — choose a different plan
    return ctx.replyWithMarkdown('What would you like to do?', {
      reply_markup: {
        inline_keyboard: [
          [{
            text:          `🔁 Renew Same Plan (${user.plan} — ${naira(currentPlan?.price || 0)})`,
            callback_data: `renew_same`,
          }],
          [{
            text:          '📦 Choose Different Plan',
            callback_data: 'renew_new',
          }],
          [{
            text:          '❌ Cancel',
            callback_data: 'cancel_buy',
          }],
        ],
      },
    });
  });

  // ── Renew same plan ───────────────────────────
  bot.action('renew_same', async (ctx) => {
    await ctx.answerCbQuery();

    if (!paymentLimiter(String(ctx.from.id))) {
      return ctx.editMessageText('⚠️ Too many payment attempts. Please wait a few minutes.');
    }

    const user = await getUser(ctx.from.id, tid);
    if (!user?.plan) return ctx.editMessageText('No active plan found. Use /buy instead.');

    const plan = plans.find(p => p.label === user.plan);
    if (!plan) return ctx.editMessageText('Your current plan is no longer available. Use /buy to choose a new one.');

    const reference = `renew-${tid}-${ctx.from.id}-${Date.now()}`;

    try {
      await ctx.editMessageText('⏳ Creating renewal payment link...');

      const freshTenant = await db.query(
        'SELECT paystack_secret FROM tenants WHERE tenant_id=$1',
        [tid]
      );

      if (!freshTenant.rows.length) {
        return ctx.editMessageText('❌ Configuration error. Contact support.');
      }

      const paystackSecret = decrypt(freshTenant.rows[0].paystack_secret);

      if (!paystackSecret || !paystackSecret.startsWith('sk_')) {
        return ctx.editMessageText('❌ Payment not configured. Contact support.');
      }

      const res = await axios.post(
        'https://api.paystack.co/transaction/initialize',
        {
          email:     user.email,
          amount:    plan.price * 100,
          reference,
          metadata: {
            telegram_id: String(ctx.from.id),
            plan:        plan.label,
            email:       user.email,
            tenant_id:   tid,
            is_renewal:  'true',
          },
        },
        {
          headers: { Authorization: `Bearer ${paystackSecret}` },
          timeout: 10000,
        }
      );

      logger.info('Renewal payment link created', {
        tenantId:  tid,
        plan:      plan.label,
        email:     user.email,
        reference,
      });

      await ctx.editMessageText(
        `🔄 *Renew ${plan.label}*\n\nAmount: ${naira(plan.price)}\nValidity: ${plan.validity}\n\n_Your data will be topped up immediately after payment._`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '💳 Pay Now', url: res.data.data.authorization_url },
            ]],
          },
        }
      );

    } catch (err) {
      const detail = err.response?.data?.message || err.message;
      logger.error('Renewal payment error', { tenantId: tid, error: detail });
      await ctx.editMessageText('❌ Could not create payment link. Please try again or contact /support.');
    }
  });

  // ── Choose different plan for renewal ─────────
  bot.action('renew_new', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('📦 *Choose a new plan:*', {
      parse_mode:   'Markdown',
      reply_markup: { inline_keyboard: planKeyboard(plans) },
    });
  });

  // ── /history ──────────────────────────────────
  bot.command('history', rateLimit, async (ctx) => {
    const user = await getUser(ctx.from.id, tid);
    if (!user) return ctx.reply('Please /start first.');

    const res = await db.query(
      'SELECT * FROM purchases WHERE email=$1 AND tenant_id=$2 ORDER BY date DESC LIMIT 5',
      [user.email, tid]
    );

    if (!res.rows.length) return ctx.reply('No purchases yet. Use /buy to get started.');

    const lines = res.rows.map(r =>
      `${date(r.date)}  •  ${r.plan}  •  ${naira(r.amount)}`
    ).join('\n');

    return ctx.replyWithMarkdown(`🧾 *Purchase History*\n\n\`\`\`\n${lines}\n\`\`\``);
  });

  // ── /support ──────────────────────────────────
  bot.command('support', async (ctx) => {
    return ctx.replyWithMarkdown(
`🛟 *Support — ${tenant.name}*

Please describe your issue and an agent will respond shortly.

Email: ${tenant.email || 'support@yourcompany.com'}`
    );
  });

  // ── Admin commands ────────────────────────────
  bot.command('sales', adminOnly(tid, async (ctx) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [tx, rev] = await Promise.all([
      db.query(
        'SELECT COUNT(*) FROM purchases WHERE tenant_id=$1 AND date>=$2',
        [tid, todayStart]
      ),
      db.query(
        'SELECT COALESCE(SUM(amount),0) as total FROM purchases WHERE tenant_id=$1 AND date>=$2',
        [tid, todayStart]
      ),
    ]);

    return ctx.replyWithMarkdown(
`📈 *Today's Sales*

Transactions: *${tx.rows[0].count}*
Revenue:      *${naira(rev.rows[0].total)}*`
    );
  }));

  bot.command('users', adminOnly(tid, async (ctx) => {
    const res = await db.query(
      'SELECT * FROM users WHERE tenant_id=$1 ORDER BY telegram_id',
      [tid]
    );
    if (!res.rows.length) return ctx.reply('No users yet.');

    const active   = res.rows.filter(u => u.status === 'active').length;
    const inactive = res.rows.length - active;
    const lines    = res.rows.map(u =>
      `• ${u.name} (${u.email}) — ${u.plan || 'no plan'} — ${u.status}`
    ).join('\n');

    return ctx.replyWithMarkdown(
`👥 *Users*

Active: ${active}  |  Inactive: ${inactive}

${lines}`
    );
  }));

  bot.command('revenue', adminOnly(tid, async (ctx) => {
    const res = await db.query(
      'SELECT COUNT(*) as count, COALESCE(SUM(amount),0) as total FROM purchases WHERE tenant_id=$1',
      [tid]
    );
    return ctx.replyWithMarkdown(
`💰 *Total Revenue*

Purchases: *${res.rows[0].count}*
Revenue:   *${naira(res.rows[0].total)}*`
    );
  }));

  bot.command('stock', adminOnly(tid, async (ctx) => {
    const res = await db.query(
      'SELECT COALESCE(SUM(total_gb),0) as sold FROM users WHERE tenant_id=$1',
      [tid]
    );
    const sold  = parseFloat(res.rows[0].sold);
    const total = 2048;
    return ctx.replyWithMarkdown(
`📦 *Bandwidth Stock*

Total:     *${gb(total)}*
Sold:      *${gb(sold)}*
Remaining: *${gb(total - sold)}*`
    );
  }));

bot.command('online', adminOnly(tid, async (ctx) => {
    const { getProvider } = require('../services/providers');
    const freshTenantRes  = await db.query(
      'SELECT * FROM tenants WHERE tenant_id=$1', [tid]
    );
    const freshTenant = freshTenantRes.rows[0];

    // DB counts
    const res = await db.query(
      'SELECT status, COUNT(*) as count FROM users WHERE tenant_id=$1 GROUP BY status',
      [tid]
    );
    const map = {};
    res.rows.forEach(r => { map[r.status] = r.count; });

    if (freshTenant.network_provider !== 'none') {
      try {
        const provider = getProvider(freshTenant);
        const live     = await provider.getOnlineClients();

        const groupLines = live.clients.map(g =>
          `• ${g.name}: ${g.online} used / ${g.unused} unused`
        ).join('\n');

        return ctx.replyWithMarkdown(
`🟢 *Network Status*

*Voucher Stock by Plan:*
${groupLines || '_No groups found_'}

*Bot Users:*
Active:   *${map['active']   || 0}*
Inactive: *${map['inactive'] || 0}*`
        );
      } catch (err) {
        logger.warn('Live online fetch failed', { error: err.message });
      }
    }

    return ctx.replyWithMarkdown(
`🟢 *User Status*

Active:   *${map['active']   || 0}*
Inactive: *${map['inactive'] || 0}*`
    );
  }));

  // ── Sub-admin management ──────────────────────
  bot.command('addadmin', adminOnly(tid, async (ctx) => {
    awaitingSubAdmin.set(ctx.from.id, { step: 'telegram_id' });
    return ctx.replyWithMarkdown(
`➕ *Add Sub-Admin*

Send me the new admin's *Telegram ID*.
They can get it by messaging @userinfobot.`
    );
  }));

  bot.command('removeadmin', adminOnly(tid, async (ctx) => {
    const admins = await db.query(
      'SELECT * FROM admins WHERE tenant_id=$1 AND active=true',
      [tid]
    );
    if (!admins.rows.length) return ctx.reply('No sub-admins found.');

    const keyboard = admins.rows.map(a => ([{
      text:          `${a.name} (${a.telegram_id})`,
      callback_data: `removesub_${a.telegram_id}`,
    }]));

    return ctx.replyWithMarkdown('🗑 *Select admin to remove:*', {
      reply_markup: { inline_keyboard: keyboard },
    });
  }));

  bot.command('listadmins', adminOnly(tid, async (ctx) => {
    const admins = await db.query(
      'SELECT * FROM admins WHERE tenant_id=$1 AND active=true ORDER BY created_at DESC',
      [tid]
    );
    if (!admins.rows.length) return ctx.reply('No sub-admins yet. Use /addadmin to add one.');

    const lines = admins.rows.map(a =>
      `• *${a.name}* — ID: \`${a.telegram_id}\` — ${a.email || 'no email'}`
    ).join('\n');

    return ctx.replyWithMarkdown(`👮 *Sub-Admins for ${tenant.name}*\n\n${lines}`);
  }));

  bot.action(/^removesub_\d+$/, async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = parseInt(ctx.callbackQuery.data.replace('removesub_', ''));

    await db.query(
      'UPDATE admins SET active=false WHERE telegram_id=$1 AND tenant_id=$2',
      [telegramId, tid]
    );

    logger.info('Sub-admin removed', { telegramId, tenantId: tid });
    return ctx.editMessageText(`✅ Admin ${telegramId} removed successfully.`);
  });

  // ── Free text handler ──────────────────────────
  bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    const text   = ctx.message?.text?.trim();
    if (!text) return next();

    // Skip commands
    if (text.startsWith('/')) return next();

    // ── Sub-admin registration flow ──────────────
    if (awaitingSubAdmin.has(userId)) {
      const state = awaitingSubAdmin.get(userId);

      if (state.step === 'telegram_id') {
        const newId = parseInt(text);
        if (isNaN(newId)) return ctx.reply('Invalid Telegram ID. Send a number (e.g. 5926845553):');
        state.newTelegramId = newId;
        state.step = 'name';
        awaitingSubAdmin.set(userId, state);
        return ctx.reply('Now send their full name:');
      }

      if (state.step === 'name') {
        if (text.length < 2) return ctx.reply('Name too short. Try again:');
        state.name = text;
        state.step = 'email';
        awaitingSubAdmin.set(userId, state);
        return ctx.reply('Now send their email address:');
      }

      if (state.step === 'email') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(text)) return ctx.reply('Invalid email. Try again:');
        state.email = text;
        awaitingSubAdmin.delete(userId);

        await db.query(
          `INSERT INTO admins (telegram_id, tenant_id, name, email, added_by)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (telegram_id, tenant_id)
           DO UPDATE SET active=true, name=$3, email=$4`,
          [state.newTelegramId, tid, state.name, state.email, userId]
        );

        // Notify new admin
        try {
          await ctx.telegram.sendMessage(
            state.newTelegramId,
`👮 *You've been added as an admin for ${tenant.name}!*

You now have access to:
/sales — Today's sales
/users — All users
/revenue — Total revenue
/stock — Bandwidth stock
/online — Active users
/addadmin — Add sub-admins
/listadmins — View all admins`,
            { parse_mode: 'Markdown' }
          );
        } catch (e) {
          logger.warn('Could not notify new sub-admin', { telegramId: state.newTelegramId });
        }

        logger.info('Sub-admin added', {
          tenantId:    tid,
          newAdminId:  state.newTelegramId,
          addedBy:     userId,
        });

        return ctx.replyWithMarkdown(
`✅ *Sub-Admin Added!*

Name:        ${state.name}
Email:       ${state.email}
Telegram ID: \`${state.newTelegramId}\`

They have been notified on Telegram.`
        );
      }
    }

    // ── Customer registration flow ────────────────

    // Step 1 — email
    if (awaitingEmail.has(userId)) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(text)) {
        return ctx.reply('Invalid email. Try again (e.g. you@example.com):');
      }
      const email  = text.toLowerCase();
      const exists = await db.query(
        'SELECT telegram_id FROM users WHERE email=$1 AND tenant_id=$2',
        [email, tid]
      );
      if (exists.rows.length) {
        awaitingEmail.delete(userId);
        return ctx.reply('That email is already registered. Contact /support if this is yours.');
      }
      awaitingEmail.delete(userId);
      awaitingName.set(userId, email);
      return ctx.reply(`Got it — ${email}.\n\nNow enter your full name:`);
    }

    // Step 2 — name
    if (awaitingName.has(userId)) {
      const email = awaitingName.get(userId);
      const name  = text;
      if (name.length < 2) return ctx.reply('Please enter a valid name:');

      await db.query(
        `INSERT INTO users (telegram_id, tenant_id, email, name)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (telegram_id, tenant_id) DO UPDATE SET email=$3, name=$4`,
        [userId, tid, email, name]
      );
      awaitingName.delete(userId);

      logger.info('User registered', { tenantId: tid, email, telegramId: userId });

      return ctx.replyWithMarkdown(
`✅ *Registration Complete!*

Name:  ${name}
Email: ${email}

Use /buy to purchase a data plan.`
      );
    }

    return next();
  });
}

// ── Helpers ───────────────────────────────────
async function getUser(telegramId, tenantId) {
  const res = await db.query(
    'SELECT * FROM users WHERE telegram_id=$1 AND tenant_id=$2',
    [telegramId, tenantId]
  );
  return res.rows[0] || null;
}

function adminOnly(tenantId, handler) {
  return async (ctx) => {
    const userId = ctx.from?.id;

    // Super admin always has access
    if (SUPER_ADMIN_IDS.includes(userId)) return handler(ctx);

    // Always fetch fresh from DB
    const tenantRes = await db.query(
      'SELECT telegram_id FROM tenants WHERE tenant_id=$1',
      [tenantId]
    );

    const ownerTelegramId = tenantRes.rows[0]?.telegram_id;

    // Use == not === — DB may return string, ctx returns number
    if (ownerTelegramId == userId) return handler(ctx);

    // Check sub-admins
    const adminRes = await db.query(
      'SELECT id FROM admins WHERE telegram_id=$1 AND tenant_id=$2 AND active=true',
      [userId, tenantId]
    );

    if (!adminRes.rows.length) return ctx.reply('⛔ Admin access only.');
    return handler(ctx);
  };
}

module.exports = { register };