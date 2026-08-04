'use strict';

const express = require('express');
const router  = express.Router();

const db     = require('../../services/db');
const logger = require('../../services/logger');
const { encrypt } = require('../../services/encryption');
const { getProvider, clearProviderCache } = require('../../services/providers');
const authRequired = require('../middleware/authRequired');

router.use(authRequired);

// Fetch the current (fresh) tenant row for the JWT's tenant.
async function loadTenant(tenantId) {
  const res = await db.query('SELECT * FROM tenants WHERE tenant_id = $1', [tenantId]);
  return res.rows[0] || null;
}

// ── PUT /api/onboarding/provider ─────────────────────────────
// Save + encrypt provider config and Paystack keys. Advances onboarding_step.
router.put('/provider', async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    const b = req.body || {};
    const provider = b.networkProvider;

    if (!['omada', 'mikrotik', 'none'].includes(provider)) {
      return res.status(400).json({ error: 'networkProvider must be omada, mikrotik, or none' });
    }

    // Build the column set. Secrets are encrypted; plain fields stored as-is.
    // Only columns present in the body are updated.
    const fields = {
      network_provider: provider,
      // Paystack (both required to actually take payments, but allow partial save)
      paystack_secret:  b.paystackSecret  !== undefined ? encrypt(String(b.paystackSecret).trim())  : undefined,
      paystack_public:  b.paystackPublic  !== undefined ? String(b.paystackPublic).trim()           : undefined,
    };

    if (provider === 'omada') {
      Object.assign(fields, {
        omada_url:             b.omadaUrl,
        omada_controller_id:   b.omadaControllerId,
        omada_site_id:         b.omadaSiteId,
        omada_controller_type: b.omadaControllerType || 'software',
        omada_client_id:       b.omadaClientId      !== undefined ? encrypt(b.omadaClientId)      : undefined,
        omada_client_secret:   b.omadaClientSecret  !== undefined ? encrypt(b.omadaClientSecret)  : undefined,
        omada_admin_username:  b.omadaAdminUsername !== undefined ? encrypt(b.omadaAdminUsername) : undefined,
        omada_admin_password:  b.omadaAdminPassword !== undefined ? encrypt(b.omadaAdminPassword) : undefined,
        omada_cloud_cert:      b.omadaCloudCert,
        omada_cloud_key:       b.omadaCloudKey,
      });
    } else if (provider === 'mikrotik') {
      Object.assign(fields, {
        mikrotik_url:      b.mikrotikUrl,
        mikrotik_username: b.mikrotikUsername !== undefined ? encrypt(b.mikrotikUsername) : undefined,
        mikrotik_password: b.mikrotikPassword !== undefined ? encrypt(b.mikrotikPassword) : undefined,
      });
    }

    // Build parameterized UPDATE from defined fields only.
    const cols = [];
    const vals = [];
    let i = 1;
    for (const [col, val] of Object.entries(fields)) {
      if (val === undefined) continue;
      cols.push(`${col} = $${i++}`);
      vals.push(val);
    }
    // Advance the wizard.
    cols.push(`onboarding_step = $${i++}`);
    vals.push('plans');
    vals.push(tenantId);

    await db.query(
      `UPDATE tenants SET ${cols.join(', ')} WHERE tenant_id = $${i}`,
      vals
    );

    clearProviderCache(tenantId);
    logger.info('Onboarding provider saved', { tenantId, provider });

    res.json({ ok: true, onboardingStep: 'plans' });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/onboarding/test ────────────────────────────────
router.post('/test', async (req, res, next) => {
  try {
    const tenant = await loadTenant(req.tenantId);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    clearProviderCache(req.tenantId);
    const provider = getProvider(tenant);
    const result   = await provider.testConnection();
    res.json(result); // { success, message, controllerType? }
  } catch (err) {
    // A failed controller test is a normal outcome, not a server error.
    res.json({ success: false, message: err.message });
  }
});

// ── GET /api/onboarding/voucher-groups ───────────────────────
router.get('/voucher-groups', async (req, res, next) => {
  try {
    const tenant = await loadTenant(req.tenantId);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    if (tenant.network_provider !== 'omada') {
      return res.json({ groups: [] }); // only Omada has voucher groups
    }

    const provider = getProvider(tenant);
    const groups   = await provider.getVoucherGroups();
    res.json({
      groups: groups.map(g => ({
        id:          g.id,
        name:        g.name,
        unusedCount: g.unusedCount,
        totalCount:  g.totalCount,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/onboarding/plans ───────────────────────────────
// Upsert plans; each plan maps to a voucher group via omadaProfileId.
router.post('/plans', async (req, res, next) => {
  const tenantId = req.tenantId;
  const plans = Array.isArray(req.body?.plans) ? req.body.plans : null;
  if (!plans || !plans.length) {
    return res.status(400).json({ error: 'plans[] is required' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Next plan_id continues from the current max for this tenant.
    const maxRes = await client.query(
      'SELECT COALESCE(MAX(plan_id), 0) AS max FROM tenant_plans WHERE tenant_id = $1',
      [tenantId]
    );
    let nextPlanId = Number(maxRes.rows[0].max);

    for (const p of plans) {
      if (!p.label || p.price == null || p.gb == null || !p.validity) {
        throw Object.assign(new Error('Each plan needs label, price, gb, validity'), { status: 400 });
      }
      // Reuse plan_id if the label already exists; else allocate a new one.
      const existing = await client.query(
        'SELECT plan_id FROM tenant_plans WHERE tenant_id = $1 AND label = $2',
        [tenantId, p.label]
      );
      const planId = existing.rows.length ? existing.rows[0].plan_id : ++nextPlanId;

      await client.query(
        `INSERT INTO tenant_plans (tenant_id, plan_id, label, price, gb, validity, omada_profile_id, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true)
         ON CONFLICT (tenant_id, label) DO UPDATE SET
           plan_id          = EXCLUDED.plan_id,
           price            = EXCLUDED.price,
           gb               = EXCLUDED.gb,
           validity         = EXCLUDED.validity,
           omada_profile_id = EXCLUDED.omada_profile_id,
           active           = true`,
        [tenantId, planId, p.label, p.price, p.gb, p.validity, p.omadaProfileId || null]
      );
    }

    await client.query(
      `UPDATE tenants SET onboarding_step = 'sync' WHERE tenant_id = $1`,
      [tenantId]
    );

    await client.query('COMMIT');
    res.json({ ok: true, onboardingStep: 'sync', count: plans.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ── POST /api/onboarding/sync ────────────────────────────────
router.post('/sync', async (req, res, next) => {
  try {
    const tenant = await loadTenant(req.tenantId);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    if (tenant.network_provider !== 'omada') {
      return res.json({ totalInserted: 0, totalUpdated: 0, note: 'No sync for this provider' });
    }

    const provider = getProvider(tenant);
    const result   = await provider.syncVouchersToDb(db);
    res.json(result); // { totalInserted, totalUpdated }
  } catch (err) {
    next(err);
  }
});

// ── POST /api/onboarding/activate ────────────────────────────
router.post('/activate', async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    await db.query(
      `UPDATE tenants SET active = true, onboarding_step = 'done' WHERE tenant_id = $1`,
      [tenantId]
    );

    const base = (process.env.WEBHOOK_URL || '').replace(/\/$/, '');
    const paystackWebhookUrl = base ? `${base}/pay/${tenantId}` : `/pay/${tenantId}`;

    logger.info('Tenant activated via web', { tenantId });
    res.json({ ok: true, onboardingStep: 'done', paystackWebhookUrl });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
