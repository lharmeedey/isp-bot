const express  = require('express');
const { validateWebhook } = require('./paystack');
const store    = require('../data/store');

function createWebhookServer(bot) {
  const app = express();

  app.use('/webhook', express.raw({ type: 'application/json' }));
  app.use(express.json());

  app.post('/webhook/paystack', async (req, res) => {
    const signature = req.headers['x-paystack-signature'];

    if (!validateWebhook(req.body, signature)) {
      return res.sendStatus(401);
    }

    const event = JSON.parse(req.body);

    if (event.event === 'charge.success') {
      await handleSuccessfulPayment(bot, event.data);
    }

    res.sendStatus(200);
  });

  app.get('/', (_, res) => res.send('ISP Bot webhook server running.'));

  return app;
}

async function handleSuccessfulPayment(bot, data) {
  try {
    const { telegram_id, plan, email } = data.metadata;

    if (!telegram_id || !plan || !email) {
      console.error('Webhook missing metadata:', data.metadata);
      return;
    }

    const tid = Number(telegram_id);

    // 1. Activate plan
    await store.activatePlan(tid, plan);

    // 2. Record purchase
    await store.addPurchase(tid, email, plan, data.amount / 100, data.reference);

    // 3. Generate and save voucher
    const code = await store.saveVoucher(tid, email, plan, data.reference);

    // 4. Notify user on Telegram
    await bot.telegram.sendMessage(
      tid,
`✅ *Payment Confirmed!*

Username: \`${email}\`
Password: \`${code}\`
Plan:     *${plan}*

_Your data is now active. Save your password to connect._`,
      { parse_mode: 'Markdown' }
    );

    console.log(`✅ Activated ${plan} for ${email} (ref: ${data.reference})`);

  } catch (err) {
    console.error('handleSuccessfulPayment error:', err.message);
  }
}

module.exports = createWebhookServer;