const store = require('../data/store');
const { gb, date, syncAge, usageBar } = require('../services/helpers');

module.exports = async (ctx) => {
  const user = await store.getUserByTelegramId(ctx.from.id);

  if (!user) return ctx.reply('You\'re not registered yet. Send /start to begin.');
  if (!user.plan) return ctx.reply('You don\'t have an active plan yet.\n\nUse /buy to get started.');

  let syncNote = `_Last updated: ${syncAge(user)}_`;

  if (store.isStale(user)) {
    await store.simulateLiveSync(user);
    syncNote = `_Just synced with network ✓_`;
  }

  const remaining = parseFloat(user.remaining_gb);
  const total     = parseFloat(user.total_gb);
  const pct       = Math.round((remaining / total) * 100);
  const bar       = usageBar(remaining, total);
  const warn      = pct < 20 ? '\n\n⚠️ *Low data!* Recharge with /buy.' : '';

  return ctx.replyWithMarkdown(
`📊 *Your Data Balance*

Plan:      *${user.plan}*
Remaining: *${gb(remaining)}*
Used:      ${gb(total - remaining)} of ${gb(total)}
Expiry:    ${date(user.expiry)}

${bar}  ${pct}%
${syncNote}${warn}`
  );
};