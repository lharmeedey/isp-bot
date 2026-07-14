require('dotenv').config();
const { Telegraf } = require('telegraf');
const express      = require('express');
const cron         = require('node-cron');
const https        = require('https');

const logger        = require('./services/logger');
const tenantManager = require('./services/tenantManager');
const superAdmin    = require('./commands/superAdmin');
const db            = require('./services/db');
const { gb }        = require('./services/helpers');

const SUPER_ADMIN_IDS = (process.env.SUPER_ADMIN_IDS || '')
  .split(',').map(Number).filter(Boolean);

if (!process.env.BOT_TOKEN) {
  logger.error('BOT_TOKEN is required');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  logger.error('DATABASE_URL is required');
  process.exit(1);
}

// ── Master bot ─────────────────────────────────
const masterBot = new Telegraf(process.env.BOT_TOKEN, { handlerTimeout: 90000 });

// Global error handler
masterBot.catch((err, ctx) => {
  logger.error('Master bot error', {
    error:    err.message,
    updateId: ctx?.update?.update_id,
    from:     ctx?.from?.id,
  });
});

// Super admin guard
function superAdminOnly(handler) {
  return async (ctx) => {
    if (!SUPER_ADMIN_IDS.includes(ctx.from?.id)) {
      logger.warn('Unauthorized access attempt', { userId: ctx.from?.id });
      return ctx.reply('⛔ Unauthorized.');
    }
    return handler(ctx);
  };
}

// ── Super admin commands ───────────────────────
masterBot.command('start', superAdminOnly(async (ctx) => {
  const [tenantRes, userRes, revenueRes] = await Promise.all([
    db.query('SELECT COUNT(*) FROM tenants WHERE active=true'),
    db.query('SELECT COUNT(*) FROM users'),
    db.query('SELECT COALESCE(SUM(amount),0) as total FROM purchases'),
  ]);

  return ctx.replyWithMarkdown(
`👑 *Super Admin Dashboard*

Active Tenants: *${tenantRes.rows[0].count}*
Total Users:    *${userRes.rows[0].count}*
Total Revenue:  *₦${Number(revenueRes.rows[0].total).toLocaleString('en-NG')}*

*Commands:*
/addtenant    — Add a new client
/listtenants  — View all tenants
/totalrevenue — Revenue per tenant
/deactivate   — Deactivate a tenant
/reloadtenant — Reload a tenant bot
/fixwebhooks  — Fix all tenant webhooks`
  );
}));

masterBot.command('addtenant',    superAdminOnly(superAdmin.startAddTenant));
masterBot.command('listtenants',  superAdminOnly(superAdmin.listTenants));
masterBot.command('totalrevenue', superAdminOnly(superAdmin.totalRevenue));
masterBot.command('deactivate',   superAdminOnly(superAdmin.deactivateTenant));
masterBot.command('reloadtenant', superAdminOnly(superAdmin.reloadTenant));
masterBot.command('fixwebhooks',  superAdminOnly(superAdmin.fixWebhooks));

masterBot.action(/^deactivate_.+$/, superAdminOnly(superAdmin.handleDeactivateCallback));

masterBot.on('text', (ctx, next) =>
  superAdmin.handleSuperAdminText(ctx, next)
);

// ── Express server ─────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

// Tenant webhook routes
tenantManager.createWebhookRouter(app);

const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (WEBHOOK_URL) {
  // ── Production: webhook mode ─────────────────
  app.use(express.json());

  app.post('/master', (req, res) => {
    masterBot.handleUpdate(req.body).catch(err => {
      logger.error('Master update error', { error: err.message });
    });
    res.sendStatus(200);
  });

  app.listen(PORT, async () => {
    try {
      await masterBot.telegram.setWebhook(`${WEBHOOK_URL}/master`);
      await tenantManager.launchAllTenants();
      logger.info(`Master bot running in webhook mode`, { port: PORT, url: WEBHOOK_URL });
    } catch (err) {
      logger.error('Startup error', { error: err.message });
      process.exit(1);
    }
  });

} else {
  // ── Local: polling mode ───────────────────────
  app.listen(PORT, async () => {
    await tenantManager.launchAllTenants();
    logger.info(`Server listening`, { port: PORT });
  });

  masterBot.launch().catch(err => {
    logger.error('Failed to launch master bot', { error: err.message });
    process.exit(1);
  });

  logger.info('Master bot running in polling mode');
}

// ── Cron: low-data alerts every 15 min ────────
cron.schedule('*/15 * * * *', async () => {
  logger.debug('Running low-data alert job');
  const bots = tenantManager.getActiveTenants();

  for (const [tenantId, { bot }] of bots) {
    try {
      const users = await db.query(
        `SELECT * FROM users
         WHERE tenant_id=$1 AND status='active'
         AND total_gb > 0
         AND remaining_gb / NULLIF(total_gb,0) < 0.20`,
        [tenantId]
      );

      for (const user of users.rows) {
        try {
          await bot.telegram.sendMessage(
            user.telegram_id,
            `⚠️ *Low Data Alert*\n\nRemaining: *${gb(user.remaining_gb)}*\nPlan: ${user.plan}\n\nRecharge now with /buy`,
            { parse_mode: 'Markdown' }
          );
        } catch (e) {
          if (!e.message.includes('chat not found') && !e.message.includes('blocked')) {
            logger.error('Alert send failed', { userId: user.telegram_id, error: e.message });
          }
        }
      }

      if (users.rows.length > 0) {
        logger.info('Low-data alerts sent', { tenantId, count: users.rows.length });
      }

    } catch (err) {
      logger.error('Alert job error', { tenantId, error: err.message });
    }
  }
});

// ── Keep Render awake ──────────────────────────
if (process.env.NODE_ENV === 'production' && WEBHOOK_URL) {
  setInterval(() => {
    https.get(`${WEBHOOK_URL}/health`, (res) => {
      logger.debug(`Keep-alive ping`, { status: res.statusCode });
    }).on('error', (err) => {
      logger.warn('Keep-alive failed', { error: err.message });
    });
  }, 10 * 60 * 1000);
}

// ── Graceful shutdown ──────────────────────────
async function shutdown(signal) {
  logger.info(`Received ${signal} — shutting down gracefully`);

  masterBot.stop(signal);

  const bots = tenantManager.getActiveTenants();
  for (const [tenantId] of bots) {
    await tenantManager.stopTenant(tenantId);
  }

  logger.info('All bots stopped. Goodbye.');
  process.exit(0);
}

process.once('SIGINT',  () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));