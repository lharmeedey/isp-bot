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

const masterBot = new Telegraf(process.env.BOT_TOKEN, { handlerTimeout: 90000 });

masterBot.catch((err, ctx) => {
  logger.error('Master bot error', {
    error:    err.message,
    updateId: ctx?.update?.update_id,
    from:     ctx?.from?.id,
  });
});

function superAdminOnly(handler) {
  return async (ctx) => {
    if (!SUPER_ADMIN_IDS.includes(ctx.from?.id)) {
      logger.warn('Unauthorized access attempt', { userId: ctx.from?.id });
      return ctx.reply('⛔ Unauthorized.');
    }
    return handler(ctx);
  };
}

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
/fixwebhooks  — Fix all tenant webhooks
/testprovider — Test network provider`
  );
}));

masterBot.command('addtenant',    superAdminOnly(superAdmin.startAddTenant));
masterBot.command('listtenants',  superAdminOnly(superAdmin.listTenants));
masterBot.command('totalrevenue', superAdminOnly(superAdmin.totalRevenue));
masterBot.command('deactivate',   superAdminOnly(superAdmin.deactivateTenant));
masterBot.command('reloadtenant', superAdminOnly(superAdmin.reloadTenant));
masterBot.command('fixwebhooks',  superAdminOnly(superAdmin.fixWebhooks));
masterBot.command('testprovider', superAdminOnly(superAdmin.testProvider));

masterBot.action(/^deactivate_.+$/,  superAdminOnly(superAdmin.handleDeactivateCallback));
masterBot.action(/^provider_.+$/,    superAdminOnly(superAdmin.handleProviderCallback));
masterBot.action(/^omadatype_.+$/,   superAdminOnly(superAdmin.handleOmadaTypeCallback));
masterBot.command('manageplans',     superAdminOnly(superAdmin.managePlans));
masterBot.command('setplan',         superAdminOnly(superAdmin.setPlan));
masterBot.command('resetplans',      superAdminOnly(superAdmin.resetPlans));
masterBot.command('tenantstatus',    superAdminOnly(superAdmin.tenantStatus));
masterBot.command('getheartbeatkey', superAdminOnly(superAdmin.getHeartbeatKey));

masterBot.on('text', (ctx, next) =>
  superAdmin.handleSuperAdminText(ctx, next)
);

const app  = express();
const PORT = process.env.PORT || 3000;

tenantManager.createWebhookRouter(app);

// Web REST API (self-service onboarding + operator dashboard). Mounted with its
// own CORS + JSON parser scoped to /api so the raw-body /pay/:tenantId webhook
// route (which sets express.raw() per-route) is completely unaffected. Works in
// both webhook and polling modes.
const cors = require('./web/middleware/cors');
const { buildApiRouter } = require('./web');
app.use('/api', cors, express.json(), buildApiRouter());

const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (WEBHOOK_URL) {
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
      logger.info('Master bot running in webhook mode', { port: PORT, url: WEBHOOK_URL });
    } catch (err) {
      logger.error('Startup error', { error: err.message });
      process.exit(1);
    }
  });

} else {
  app.listen(PORT, async () => {
    await tenantManager.launchAllTenants();
    logger.info('Server listening', { port: PORT });
  });

  masterBot.launch().catch(err => {
    logger.error('Failed to launch master bot', { error: err.message });
    process.exit(1);
  });

  logger.info('Master bot running in polling mode');
}

// ── Low-data alerts every 15 min ──────────────
cron.schedule('*/15 * * * *', async () => {
  logger.debug('Running low-data alert job');
  const bots = tenantManager.getActiveTenants();

  for (const [tenantId, { bot }] of bots) {
    try {
      const users = await db.query(
        `SELECT * FROM users
         WHERE tenant_id=$1 AND status='active'
         AND total_gb > 0
         AND remaining_gb / NULLIF(total_gb, 0) < 0.20`,
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

    } catch (err) {
      logger.error('Alert job error', { tenantId, error: err.message });
    }
  }
});

// ── Sync Omada vouchers every hour ────────────
cron.schedule('0 * * * *', async () => {
  logger.debug('Running hourly Omada voucher sync');
  const bots = tenantManager.getActiveTenants();
  const { getProvider } = require('./services/providers');

  for (const [tenantId, { tenant }] of bots) {
    try {
      const tenantRes = await db.query(
        'SELECT * FROM tenants WHERE tenant_id=$1',
        [tenantId]
      );
      const freshTenant = tenantRes.rows[0];

      if (!freshTenant || freshTenant.network_provider !== 'omada') continue;

      const provider = getProvider(freshTenant);
      const result = await provider.syncVouchersToDb(db);

      await db.query(
        'UPDATE tenants SET last_sync_at=NOW(), last_sync_ok=true, last_sync_error=NULL WHERE tenant_id=$1',
        [tenantId]
      ).catch(() => {});

      logger.info('Hourly Omada sync complete', {
        tenantId,
        inserted: result.totalInserted,
        updated: result.totalUpdated,
      });
    } catch (err) {
      await db.query(
        'UPDATE tenants SET last_sync_at=NOW(), last_sync_ok=false, last_sync_error=$2 WHERE tenant_id=$1',
        [tenantId, err.message]
      ).catch(() => {});
      logger.error('Omada sync error', { tenantId, error: err.message });
    }
  }
});

// ── Auto-renewal reminder emails, daily 08:07 ────
cron.schedule('7 8 * * *', async () => {
  logger.debug('Running daily renewal reminder job');
  const { computeExpiry } = require('./services/paymentLogic');
  const { sendMail } = require('./web/services/mailer');
  const bots = tenantManager.getActiveTenants();
  const REMIND_DAYS = 3;  // remind when 0–3 days remain

  for (const [tenantId, { tenant }] of bots) {
    try {
      // Latest success purchase per web customer, joined to plan for validity.
      const rows = await db.query(
        `SELECT DISTINCT ON (p.customer_id)
                p.reference, p.email, p.plan, p.date, p.customer_id,
                tp.validity
           FROM purchases p
           JOIN tenant_plans tp
             ON tp.tenant_id = p.tenant_id
            AND tp.label     = p.plan
          WHERE p.tenant_id = $1
            AND p.status    = 'success'
            AND p.customer_id IS NOT NULL
            AND p.email IS NOT NULL
          ORDER BY p.customer_id, p.date DESC`,
        [tenantId]
      );

      const now = new Date();
      for (const row of rows.rows) {
        const expiry = computeExpiry(row.validity, new Date(row.date));
        const daysLeft = Math.ceil((expiry - now) / 86400000);
        if (daysLeft < 0 || daysLeft > REMIND_DAYS) continue;

        // Dedupe: one reminder per purchase reference, ever.
        const ins = await db.query(
          `INSERT INTO renewal_reminders (tenant_id, reference, email)
           VALUES ($1,$2,$3) ON CONFLICT (tenant_id, reference) DO NOTHING RETURNING id`,
          [tenantId, row.reference, row.email]
        );
        if (!ins.rows.length) continue;  // already reminded

        await sendMail({
          to: row.email,
          subject: `Your ${row.plan} plan expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
          text: `Hi,\n\nYour ${row.plan} plan expires on ${expiry.toISOString().slice(0,10)}. `
              + `Re-purchase to stay connected.\n\n— ${tenant.name || 'Your ISP'}`,
          html: `<p>Your <b>${row.plan}</b> plan expires on <b>${expiry.toISOString().slice(0,10)}</b>.</p>`
              + `<p>Re-purchase to stay connected.</p>`,
        });
        logger.info('Renewal reminder sent', { tenantId, email: row.email, plan: row.plan, daysLeft });
      }
    } catch (err) {
      logger.error('Renewal reminder job error', { tenantId, error: err.message });
    }
  }
});

// ── Keep Render awake ──────────────────────────
if (process.env.NODE_ENV === 'production' && WEBHOOK_URL) {
  setInterval(() => {
    https.get(`${WEBHOOK_URL}/health`, (res) => {
      logger.debug('Keep-alive ping', { status: res.statusCode });
    }).on('error', (err) => {
      logger.warn('Keep-alive failed', { error: err.message });
    });
  }, 10 * 60 * 1000);
}

// ── Graceful shutdown ──────────────────────────
async function shutdown(signal) {
  logger.info(`Received ${signal} — shutting down`);
  masterBot.stop(signal);
  const bots = tenantManager.getActiveTenants();
  for (const [tenantId] of bots) {
    await tenantManager.stopTenant(tenantId);
  }
  logger.info('All bots stopped');
  process.exit(0);
}

process.once('SIGINT',  () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));