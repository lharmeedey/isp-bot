const store = require('../data/store');
const { startRegistration } = require('./register');

module.exports = async (ctx) => {
  const user = await store.getUserByTelegramId(ctx.from.id);

  if (user && user.email) {
    const displayName = user.name || user.email;
    return ctx.replyWithMarkdown(
`👋 Welcome back, *${displayName}*!

Here's what you can do:

/balance – Check your data balance  
/buy – Purchase a data plan  
/renewplan – Renew your current plan
/history – View past purchases  
/support – Contact support`
    );
  }




  

  await ctx.replyWithMarkdown(
`👋 Welcome to *SpeedNet ISP Bot*!

I can help you:
- Check your data balance
- Buy data plans instantly
- View your purchase history
- Get low-data alerts

Let's get you set up.`
  );

  return startRegistration(ctx);
};