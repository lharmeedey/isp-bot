const store    = require('../data/store');
const paystack = require('../services/paystack');
const { naira, planKeyboard } = require('../services/helpers');

const USE_LIVE_PAYMENTS = !!process.env.PAYSTACK_SECRET;

async function showPlans(ctx) {
  const user = await store.getUserByTelegramId(ctx.from.id);
  if (!user) return ctx.reply('Please /start and register first.');

  return ctx.replyWithMarkdown('📦 *Choose a data plan:*', {
    reply_markup: { inline_keyboard: planKeyboard(store.plans) },
  });
}

async function handlePlanCallback(ctx) {
  await ctx.answerCbQuery();

  const user = await store.getUserByTelegramId(ctx.from.id);
  if (!user) return ctx.reply('Please /start first.');

  const planId = parseInt(ctx.callbackQuery.data.replace('plan_', ''));
  const plan   = store.plans.find(p => p.id === planId);
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
}

async function handleConfirmCallback(ctx) {
  await ctx.answerCbQuery('Generating payment link...');

  const user = await store.getUserByTelegramId(ctx.from.id);
  if (!user) return;

  const planId = parseInt(ctx.callbackQuery.data.replace('confirm_', ''));
  const plan   = store.plans.find(p => p.id === planId);
  if (!plan) return;

  const reference = `ISP-${ctx.from.id}-${Date.now()}`;

  if (USE_LIVE_PAYMENTS) {
    try {
      await ctx.editMessageText('⏳ Creating payment link...');

      const payment = await paystack.createPaymentLink({
        email:     user.email,
        amount:    plan.price,
        reference,
        metadata: {
          telegram_id: String(ctx.from.id),
          plan:        plan.label,
          email:       user.email,
        },
      });

      store.pendingPayments[reference] = {
        telegram_id: ctx.from.id,
        plan:        plan.label,
        email:       user.email,
      };

      await ctx.editMessageText(
        `💳 *Complete Your Payment*\n\nPlan:   ${plan.label}\nAmount: ${naira(plan.price)}\n\n_Tap Pay Now to complete securely.\nYour data activates automatically after payment._`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '💳 Pay Now', url: payment.authorization_url },
            ]],
          },
        }
      );

    } catch (err) {
      console.error('Paystack error:', err.message);
      await ctx.editMessageText('❌ Could not create payment link. Please try again or contact /support.');
    }

  } else {
    // Simulated payment for local testing
    const code = await store.saveVoucher(ctx.from.id, user.email, plan.label, reference);
    await store.activatePlan(ctx.from.id, plan.label);
    await store.addPurchase(ctx.from.id, user.email, plan.label, plan.price, reference);

    await ctx.editMessageText(
      `✅ *Activation Successful!* _(simulated)_\n\nUsername: \`${user.email}\`\nPassword: \`${code}\`\nQuota:    ${plan.label}\nValidity: ${plan.validity}\n\n_Save this password to connect._`,
      { parse_mode: 'Markdown' }
    );
  }
}

async function handleCancelCallback(ctx) {
  await ctx.answerCbQuery('Cancelled');
  await ctx.editMessageText('Purchase cancelled. Use /buy to start again.');
}

module.exports = { showPlans, handlePlanCallback, handleConfirmCallback, handleCancelCallback };