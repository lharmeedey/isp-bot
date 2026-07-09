const db = require('../services/db');
const { naira, gb, date, syncAge, usageBar, planKeyboard } = require('../services/helpers');
const axios = require('axios');

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

  // Per-tenant registration state
  const awaitingEmail = new Set();
  const awaitingName  = new Map();

  // ── /start ────────────────────────────────────
  bot.command('start', async (ctx) => {
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
  bot.command('balance', async (ctx) => {
    const user = await getUser(ctx.from.id, tid);
    if (!user) return ctx.reply('Please send /start to register first.');
    if (!user.plan) return ctx.reply('No active plan yet. Use /buy to get started.');

    const remaining = parseFloat(user.remaining_gb);
    const total     = parseFloat(user.total_gb);
    const pct       = total > 0 ? Math.round((remaining / total) * 100) : 0;
    const bar       = usageBar(remaining, total);
    const warn      = pct < 20 ? '\n\n⚠️ *Low data!* Recharge with /buy.' : '';

    return ctx.replyWithMarkdown(
`📊 *Your Data Balance*

Plan:      *${user.plan}*
Remaining: *${gb(remaining)}*
Used:      ${gb(total - remaining)} of ${gb(total)}
Expiry:    ${date(user.expiry)}

${bar}  ${pct}%
_Last updated: ${syncAge(user)}_${warn}`
    );
  });

  // ── /buy ──────────────────────────────────────
  bot.command('buy', async (ctx) => {
    const user = await getUser(ctx.from.id, tid);
    if (!user) return ctx.reply('Please send /start to register first.');

    return ctx.replyWithMarkdown('📦 *Choose a data plan:*', {
      reply_markup: { inline_keyboard: planKeyboard(plans) },
    });
  });

  // ── Plan selection ────────────────────────────
  bot.action(/^plan_\d+$/, async (ctx) => {
    await ctx.answerCbQuery();
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
    const user = await getUser(ctx.from.id, tid);
    if (!user) return;

    const planId = parseInt(ctx.callbackQuery.data.replace('confirm_', ''));
    const plan   = plans.find(p => p.id === planId);
    if (!plan) return;

    const reference = `${tid}-${ctx.from.id}-${Date.now()}`;

    try {
      await ctx.editMessageText('⏳ Creating payment link...');

      console.log(`[buy] tenant=${tid} secret_starts_with=${tenant.paystack_secret?.slice(0,10)}`);
      
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
        { headers: { Authorization: `Bearer ${tenant.paystack_secret}` } }
      );

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
  const errorDetail = err.response?.data
    ? JSON.stringify(err.response.data)
    : err.message;
  console.error(`Paystack error (${tid}):`, errorDetail);
  await ctx.editMessageText(`❌ Payment error: ${errorDetail}`);
}
  });

  bot.action('cancel_buy', async (ctx) => {
    await ctx.answerCbQuery('Cancelled');
    await ctx.editMessageText('Purchase cancelled. Use /buy to start again.');
  });

  // ── /history ──────────────────────────────────
  bot.command('history', async (ctx) => {
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
    const res = await db.query(
      'SELECT status, COUNT(*) as count FROM users WHERE tenant_id=$1 GROUP BY status',
      [tid]
    );
    const map = {};
    res.rows.forEach(r => { map[r.status] = r.count; });
    return ctx.replyWithMarkdown(
`🟢 *User Status*

Active:   *${map['active'] || 0}*
Inactive: *${map['inactive'] || 0}*`
    );
  }));

  // ── Free text — registration flow ─────────────
  bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    const text   = ctx.message?.text?.trim();
    if (!text) return next();

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

// ── Helpers ────────────────────────────────────
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
    if (SUPER_ADMIN_IDS.includes(userId)) return handler(ctx);

    const res = await db.query(
      'SELECT id FROM admins WHERE telegram_id=$1 AND tenant_id=$2 AND active=true',
      [userId, tenantId]
    );
    if (!res.rows.length) return ctx.reply('⛔ Admin access only.');
    return handler(ctx);
  };
}

module.exports = { register };