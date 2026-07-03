// List of Telegram user IDs that have admin access.
// Add your own Telegram ID here.
const ADMIN_IDS = (process.env.ADMIN_IDS || '999999999')
  .split(',')
  .map(id => Number(id.trim()));

function isAdmin(ctx) {
  return ADMIN_IDS.includes(ctx.from?.id);
}

function adminOnly(handler) {
  return async (ctx) => {
    if (!isAdmin(ctx)) {
      return ctx.reply('⛔ Admin access only.');
    }
    return handler(ctx);
  };
}

module.exports = { isAdmin, adminOnly, ADMIN_IDS };
