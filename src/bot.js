require('dotenv').config();
const { Telegraf } = require('telegraf');
const cron    = require('node-cron');
const express = require('express');

const { adminOnly } = require('./services/adminGuard');
const { handleText, startRegistration } = require('./commands/register');

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();

// ── Customer commands ────────────────────────
bot.command('start',    require('./commands/start'));
bot.command('register', (ctx) => startRegistration(ctx));
bot.command('balance',  require('./commands/balance'));
bot.command('buy',      require('./commands/buy').showPlans);
bot.command('history',  require('./commands/history'));
bot.command('support',  require('./commands/support'));

// ── Admin commands ───────────────────────────
const admin = require('./commands/admin');
bot.command('sales',   adminOnly(admin.sales));
bot.command('users',   adminOnly(admin.users));
bot.command('online',  adminOnly(admin.online));
bot.command('stock',   adminOnly(admin.stock));
bot.command('revenue', adminOnly(admin.revenue));

// ── Callbacks ────────────────────────────────
const buy = require('./commands/buy');
bot.action(/^plan_\d+$/,    buy.handlePlanCallback);
bot.action(/^confirm_\d+$/, buy.handleConfirmCallback);
bot.action('cancel_buy',    buy.handleCancelCallback);

// ── Free text (registration flow) ────────────
bot.on('text', (ctx, next) => handleText(ctx, next));

// ── Cron: low-data alerts every 15 min ───────
const alertJob = require('./jobs/alertJob')(bot);
cron.schedule('*/15 * * * *', alertJob);

// ── Payment webhook ───────────────────────────
const createWebhookServer = require('./services/webhook');
const webhookApp = createWebhookServer(bot);
app.use(webhookApp);

const PORT = process.env.PORT || 3000;

if (process.env.WEBHOOK_URL) {
  // ── Production: webhook mode ─────────────
  app.use(bot.webhookCallback('/bot-webhook'));

  app.listen(PORT, async () => {
    await bot.telegram.setWebhook(`${process.env.WEBHOOK_URL}/bot-webhook`);
    console.log(`✅ Bot running in webhook mode on port ${PORT}`);
    console.log(`💳 Paystack webhook: ${process.env.WEBHOOK_URL}/webhook/paystack`);
  });

} else {
  // ── Local: polling mode ───────────────────
  app.listen(PORT, () => {
    console.log(`💳 Webhook server listening on port ${PORT}`);
  });

  bot.launch()
    .then(() => console.log('✅ Bot running in polling mode'))
    .catch(err => { console.error('Failed to start bot:', err); process.exit(1); });

  process.once('SIGINT',  () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}