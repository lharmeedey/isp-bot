const db     = require('../services/db');
const logger = require('../services/logger');

// Tracks voucher upload state per tenant
const awaitingVouchers = new Map();

function registerSyncCommands(bot, tenant) {
  const tid = tenant.tenant_id;

  // /syncvouchers — start upload flow
  bot.command('syncvouchers', async (ctx) => {
    const plans = JSON.parse(process.env.PLANS || '[]');

    const keyboard = plans.map(p => ([{
      text:          `${p.label}`,
      callback_data: `sync_plan_${p.id}`,
    }]));

    return ctx.replyWithMarkdown(
`📥 *Upload Voucher Codes*

Select the plan these vouchers belong to:`,
      { reply_markup: { inline_keyboard: keyboard } }
    );
  });

  // Plan selection for sync
  bot.action(/^sync_plan_\d+$/, async (ctx) => {
    await ctx.answerCbQuery();
    const plans  = JSON.parse(process.env.PLANS || '[]');
    const planId = parseInt(ctx.callbackQuery.data.replace('sync_plan_', ''));
    const plan   = plans.find(p => p.id === planId);
    if (!plan) return ctx.reply('Invalid plan.');

    awaitingVouchers.set(ctx.from.id, { plan: plan.label, tenantId: tid });

    return ctx.editMessageText(
`📥 *Upload ${plan.label} Vouchers*

Paste your voucher codes below.
One code per line. Example:

691991
488779
667932
416568

_You can paste up to 500 codes at once._`
    );
  });

  // /stockreport — show current voucher stock
  bot.command('stockreport', async (ctx) => {
    const res = await db.query(
      `SELECT plan,
              COUNT(*) FILTER (WHERE status='unused')   as unused,
              COUNT(*) FILTER (WHERE status='used')     as used,
              COUNT(*) as total
       FROM voucher_stock
       WHERE tenant_id=$1
       GROUP BY plan
       ORDER BY plan`,
      [tid]
    );

    if (!res.rows.length) {
      return ctx.reply('No vouchers in stock. Use /syncvouchers to upload codes from Omada.');
    }

    const lines = res.rows.map(r =>
      `• *${r.plan}*: ${r.unused} unused / ${r.used} used / ${r.total} total`
    ).join('\n');

    return ctx.replyWithMarkdown(
`📦 *Voucher Stock Report*

${lines}

Use /syncvouchers to add more codes.`
    );
  });

  return { awaitingVouchers };
}

// Handle pasted voucher codes in text handler
async function handleVoucherText(ctx, next, awaitingVouchers) {
  const userId = ctx.from.id;
  const text   = ctx.message?.text?.trim();

  if (!text || !awaitingVouchers.has(userId)) return next();

  const { plan, tenantId } = awaitingVouchers.get(userId);
  awaitingVouchers.delete(userId);

  // Parse codes — one per line, strip whitespace
  const codes = text
    .split('\n')
    .map(c => c.trim())
    .filter(c => c.length > 0);

  if (!codes.length) {
    return ctx.reply('No codes found. Try again with /syncvouchers.');
  }

  await ctx.reply(`⏳ Uploading ${codes.length} voucher code(s) for ${plan}...`);

  let inserted = 0;
  let skipped  = 0;

  for (const code of codes) {
    try {
      await db.query(
        `INSERT INTO voucher_stock (tenant_id, plan, code)
         VALUES ($1, $2, $3)
         ON CONFLICT (code) DO NOTHING`,
        [tenantId, plan, code]
      );
      inserted++;
    } catch (e) {
      skipped++;
      logger.warn('Voucher insert failed', { code, error: e.message });
    }
  }

  // Check total stock for this plan
  const stockRes = await db.query(
    `SELECT COUNT(*) as unused FROM voucher_stock
     WHERE tenant_id=$1 AND plan=$2 AND status='unused'`,
    [tenantId, plan]
  );

  logger.info('Vouchers uploaded', { tenantId, plan, inserted, skipped });

  return ctx.replyWithMarkdown(
`✅ *Vouchers Uploaded!*

Plan:     ${plan}
Added:    ${inserted}
Skipped:  ${skipped} (duplicates)
In Stock: ${stockRes.rows[0].unused} unused codes ready`
  );
}

module.exports = { registerSyncCommands, handleVoucherText };