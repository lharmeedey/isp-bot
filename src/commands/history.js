const store = require('../data/store');
const { naira, date } = require('../services/helpers');

module.exports = async (ctx) => {
  const user = await store.getUserByTelegramId(ctx.from.id);
  if (!user) return ctx.reply('Please /start and register first.');

  const records = await store.getHistory(user.email);
  if (!records.length) return ctx.reply('No purchase history yet. Use /buy to get started.');

  const lines = records.map(r =>
    `${date(r.date)}  •  ${r.plan}  •  ${naira(r.amount)}`
  ).join('\n');

  return ctx.replyWithMarkdown(`🧾 *Purchase History*\n\n\`\`\`\n${lines}\n\`\`\``);
};