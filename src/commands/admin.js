const store = require('../data/store');
const { naira, gb } = require('../services/helpers');

async function sales(ctx) {
  const s = await store.getAdminStats();
  return ctx.replyWithMarkdown(
`📈 *Today's Sales*

Transactions: *${s.today_transactions}*
Revenue:      *${naira(s.today_revenue)}*`
  );
}

async function users(ctx) {
  const all = await store.getAllUsers();
  if (!all.length) return ctx.reply('No registered users yet.');

  const lines = all.map(u =>
    `• ${u.name} (${u.email}) — ${u.plan || 'no plan'} — ${u.status}`
  ).join('\n');

  const active   = all.filter(u => u.status === 'active').length;
  const inactive = all.length - active;

  return ctx.replyWithMarkdown(
`👥 *Users*

Active: ${active}  |  Inactive: ${inactive}

${lines}`
  );
}

async function online(ctx) {
  const s = await store.getAdminStats();
  return ctx.replyWithMarkdown(
`🟢 *User Status*

Active:  *${s.online_users}*
Inactive: *${s.offline_users}*
Total:   *${s.online_users + s.offline_users}*`
  );
}

async function stock(ctx) {
  const s = await store.getAdminStats();
  const remaining = s.total_bandwidth_gb - s.sold_bandwidth_gb;
  const pct = Math.round((remaining / s.total_bandwidth_gb) * 100);
  return ctx.replyWithMarkdown(
`📦 *Bandwidth Stock*

Total:     *${gb(s.total_bandwidth_gb)}*
Sold:      *${gb(s.sold_bandwidth_gb)}*
Remaining: *${gb(remaining)}* (${pct}%)`
  );
}

async function revenue(ctx) {
  const s   = await store.getAdminStats();
  const res = await require('../services/db').query('SELECT COUNT(*) as count, COALESCE(SUM(amount),0) as total FROM purchases');
  return ctx.replyWithMarkdown(
`💰 *Revenue Summary*

Total Purchases: *${res.rows[0].count}*
Total Revenue:   *${naira(res.rows[0].total)}*
Today:           *${naira(s.today_revenue)}*`
  );
}

module.exports = { sales, users, online, stock, revenue };