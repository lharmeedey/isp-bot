require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const cron    = require('node-cron');

const SUPER_ADMIN_IDS = (process.env.SUPER_ADMIN_IDS || '')
  .split(',').map(Number).filter(Boolean);

const tenantManager = require('./services/tenantManager');
const superAdmin    = require('./commands/superAdmin');
const db            = require('./services/db');
const { gb }        = require('./services/helpers');

// ── Master bot (your super admin bot) ─────────
const masterBot = new Telegraf(process.env.BOT_TOKEN);

// Super admin guard
function superAdminOnly(handler) {
  return async (ctx) => {
    if (!SUPER_ADMIN_IDS.includes(ctx.from?.id)) {
      return ctx.reply('⛔ Unauthorized.');
    }
    return handler(ctx);
  };
}

// ── Super admin commands ───────────────────────
masterBot.command('start', superAdminOnly(async (ctx) => {
  const res    = await db.query('SELECT COUNT(*) FROM tenants WHERE active=true');
  const res2   = await db.query('SELECT COUNT(*) FROM users');
  const tenants = res.rows[0].count;
  const users   = res2.rows[0].count;

  return ctx.replyWithMarkdown(
`👑 *Super Admin Dashboard*

Active Tenants: *${tenants}*
Total Users:    *${users}*

Commands:
/addtenant    — Add a new client
/listtenants  — View all tenants
/totalrevenue — Revenue across all tenants
/deactivate   — Deactivate a tenant`
  );
}));

masterBot.command('addtenant',    superAdminOnly(superAdmin.startAddTenant));
masterBot.command('listtenants',  superAdminOnly(superAdmin.listTenants));
masterBot.command('totalrevenue', superAdminOnly(superAdmin.totalRevenue));
masterBot.command('deactivate',   superAdminOnly(superAdmin.deactivateTenant));
masterBot.command('reloadtenant', superAdminOnly(superAdmin.reloadTenant));
masterBot.action(/^deactivate_.+$/, superAdminOnly(superAdmin.handleDeactivateCallback));

masterBot.on('text', (ctx, next) =>
  superAdmin.handleSuperAdminText(ctx, next)
);

// ── Express server ─────────────────────────────
const app = express();

// Tenant webhook routes
tenantManager.createWebhookRouter(app);

// Master bot webhook or polling
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT        = process.env.PORT || 3000;

if (WEBHOOK_URL) {
  app.use(express.json());
  app.post('/master', (req, res) => {
    masterBot.handleUpdate(req.body);
    res.sendStatus(200);
  });

  app.listen(PORT, async () => {
    await masterBot.telegram.setWebhook(`${WEBHOOK_URL}/master`);
    await tenantManager.launchAllTenants();
    console.log(`✅ Master bot running in webhook mode on port ${PORT}`);
  });

} else {
  app.listen(PORT, async () => {
    await tenantManager.launchAllTenants();
    console.log(`💳 Server listening on port ${PORT}`);
  });

  masterBot.launch();
  console.log('✅ Master bot running in polling mode');
}

// ── Cron: low-data alerts every 15 min ────────
cron.schedule('*/15 * * * *', async () => {
  const bots = tenantManager.getActiveTenants();

  for (const [tenantId, { bot }] of bots) {
    const users = await db.query(
      `SELECT * FROM users
       WHERE tenant_id=$1 AND status='active'
       AND remaining_gb / NULLIF(total_gb,0) < 0.20`,
      [tenantId]
    );

    for (const user of users.rows) {
      try {
        await bot.telegram.sendMessage(
          user.telegram_id,
          `⚠️ *Low Data Alert*\n\nRemaining: *${gb(user.remaining_gb)}*\nPlan: ${user.plan}\n\nRecharge with /buy`,
          { parse_mode: 'Markdown' }
        );
      } catch (e) {
        if (!e.message.includes('chat not found')) {
          console.error(`Alert failed:`, e.message);
        }
      }
    }
  }
});

process.once('SIGINT',  () => masterBot.stop('SIGINT'));
process.once('SIGTERM', () => masterBot.stop('SIGTERM'));