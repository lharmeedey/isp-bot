const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map(id => Number(id.trim()))
  .filter(Boolean);

console.log('Admin IDs loaded:', ADMIN_IDS);

function isAdmin(ctx) {
  const userId = ctx.from?.id;
  const result = ADMIN_IDS.includes(userId);
  console.log(`[admin check] user=${userId} isAdmin=${result}`);
  return result;
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