const store = require('../data/store');
const { gb } = require('../services/helpers');

module.exports = function createAlertJob(bot) {
  return async () => {
    const users = await store.getAllUsers();

    for (const user of users) {
      if (!user.plan || user.status !== 'active') continue;

      const pct = parseFloat(user.remaining_gb) / parseFloat(user.total_gb);

      if (pct < 0.20) {
        try {
          await bot.telegram.sendMessage(
            user.telegram_id,
            `⚠️ *Low Data Alert*\n\nRemaining: *${gb(user.remaining_gb)}*\nPlan: ${user.plan}\n\nRecharge with /buy`,
            { parse_mode: 'Markdown' }
          );
        } catch (e) {
          if (!e.message.includes('chat not found')) {
            console.error(`Alert failed for ${user.email}:`, e.message);
          }
        }
      }
    }
  };
};