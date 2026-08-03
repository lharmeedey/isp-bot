'use strict';

const express = require('express');
const router  = express.Router();

const db     = require('../../services/db');
const logger = require('../../services/logger');
const { getProvider } = require('../../services/providers');
const authRequired = require('../middleware/authRequired');

router.use(authRequired);

async function loadTenant(tenantId) {
  const res = await db.query('SELECT * FROM tenants WHERE tenant_id = $1', [tenantId]);
  return res.rows[0] || null;
}

// ── GET /api/dashboard/sales ── mirrors /sales ───────────────
router.get('/sales', async (req, res, next) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [tx, rev] = await Promise.all([
      db.query('SELECT COUNT(*) FROM purchases WHERE tenant_id=$1 AND date>=$2', [req.tenantId, todayStart]),
      db.query('SELECT COALESCE(SUM(amount),0) as total FROM purchases WHERE tenant_id=$1 AND date>=$2', [req.tenantId, todayStart]),
    ]);

    res.json({
      transactions: Number(tx.rows[0].count),
      revenue:      Number(rev.rows[0].total),
    });
  } catch (err) { next(err); }
});

// ── GET /api/dashboard/revenue ── mirrors /revenue ───────────
router.get('/revenue', async (req, res, next) => {
  try {
    const r = await db.query(
      'SELECT COUNT(*) as count, COALESCE(SUM(amount),0) as total FROM purchases WHERE tenant_id=$1',
      [req.tenantId]
    );
    res.json({
      purchases: Number(r.rows[0].count),
      revenue:   Number(r.rows[0].total),
    });
  } catch (err) { next(err); }
});

// ── GET /api/dashboard/users ── mirrors /users ───────────────
router.get('/users', async (req, res, next) => {
  try {
    const r = await db.query(
      'SELECT telegram_id, name, email, plan, status, total_gb FROM users WHERE tenant_id=$1 ORDER BY telegram_id',
      [req.tenantId]
    );
    const active   = r.rows.filter(u => u.status === 'active').length;
    res.json({
      total:    r.rows.length,
      active,
      inactive: r.rows.length - active,
      users: r.rows.map(u => ({
        telegramId: u.telegram_id,
        name:       u.name,
        email:      u.email,
        plan:       u.plan,
        status:     u.status,
        totalGb:    u.total_gb == null ? null : Number(u.total_gb),
      })),
    });
  } catch (err) { next(err); }
});

// ── GET /api/dashboard/stock ── mirrors /stockreport ─────────
router.get('/stock', async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT plan,
              COUNT(*) FILTER (WHERE status='unused') as unused,
              COUNT(*) FILTER (WHERE status='used')   as used,
              COUNT(*) as total
       FROM voucher_stock
       WHERE tenant_id=$1
       GROUP BY plan ORDER BY plan`,
      [req.tenantId]
    );
    res.json({
      plans: r.rows.map(row => ({
        plan:   row.plan,
        unused: Number(row.unused),
        used:   Number(row.used),
        total:  Number(row.total),
      })),
    });
  } catch (err) { next(err); }
});

// ── GET /api/dashboard/online ── mirrors /online ─────────────
router.get('/online', async (req, res, next) => {
  try {
    const tenant = await loadTenant(req.tenantId);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const statusRes = await db.query(
      'SELECT status, COUNT(*) as count FROM users WHERE tenant_id=$1 GROUP BY status',
      [req.tenantId]
    );
    const users = { active: 0, inactive: 0 };
    statusRes.rows.forEach(row => { users[row.status] = Number(row.count); });

    let groups = [];
    if (tenant.network_provider !== 'none') {
      try {
        const live = await getProvider(tenant).getOnlineClients();
        groups = (live.clients || []).map(g => ({
          name:   g.name,
          online: g.online,
          unused: g.unused,
        }));
      } catch (err) {
        logger.warn('Dashboard online fetch failed', { tenantId: req.tenantId, error: err.message });
      }
    }

    res.json({ users, groups });
  } catch (err) { next(err); }
});

// ── POST /api/dashboard/sync ── mirrors /syncnow ─────────────
router.post('/sync', async (req, res, next) => {
  try {
    const tenant = await loadTenant(req.tenantId);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    if (tenant.network_provider !== 'omada') {
      return res.json({ totalInserted: 0, totalUpdated: 0, note: 'No sync for this provider' });
    }
    const result = await getProvider(tenant).syncVouchersToDb(db);
    res.json(result);
  } catch (err) { next(err); }
});

// ── Plans CRUD ── mirrors /manageplans, /setplan, /resetplans ─
// GET list
router.get('/plans', async (req, res, next) => {
  try {
    const r = await db.query(
      'SELECT plan_id, label, price, gb, validity, omada_profile_id, active FROM tenant_plans WHERE tenant_id=$1 AND active=true ORDER BY plan_id',
      [req.tenantId]
    );
    res.json({
      plans: r.rows.map(p => ({
        planId:         p.plan_id,
        label:          p.label,
        price:          Number(p.price),
        gb:             Number(p.gb),
        validity:       p.validity,
        omadaProfileId: p.omada_profile_id,
        active:         p.active,
      })),
    });
  } catch (err) { next(err); }
});

// POST create one plan
router.post('/plans', async (req, res, next) => {
  const { label, price, gb, validity, omadaProfileId } = req.body || {};
  if (!label || price == null || gb == null || !validity) {
    return res.status(400).json({ error: 'label, price, gb, validity are required' });
  }
  try {
    const maxRes = await db.query(
      'SELECT COALESCE(MAX(plan_id), 0) AS max FROM tenant_plans WHERE tenant_id=$1',
      [req.tenantId]
    );
    const existing = await db.query(
      'SELECT plan_id FROM tenant_plans WHERE tenant_id=$1 AND label=$2',
      [req.tenantId, label]
    );
    const planId = existing.rows.length ? existing.rows[0].plan_id : Number(maxRes.rows[0].max) + 1;

    await db.query(
      `INSERT INTO tenant_plans (tenant_id, plan_id, label, price, gb, validity, omada_profile_id, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true)
       ON CONFLICT (tenant_id, label) DO UPDATE SET
         price            = EXCLUDED.price,
         gb               = EXCLUDED.gb,
         validity         = EXCLUDED.validity,
         omada_profile_id = EXCLUDED.omada_profile_id,
         active           = true`,
      [req.tenantId, planId, label, price, gb, validity, omadaProfileId || null]
    );
    res.status(201).json({ ok: true, planId });
  } catch (err) { next(err); }
});

// PUT update a plan by planId
router.put('/plans/:planId', async (req, res, next) => {
  const planId = Number(req.params.planId);
  if (!Number.isInteger(planId)) return res.status(400).json({ error: 'Invalid planId' });

  const b = req.body || {};
  const fields = {
    label:            b.label,
    price:            b.price,
    gb:               b.gb,
    validity:         b.validity,
    omada_profile_id: b.omadaProfileId,
  };
  const cols = [];
  const vals = [];
  let i = 1;
  for (const [col, val] of Object.entries(fields)) {
    if (val === undefined) continue;
    cols.push(`${col} = $${i++}`);
    vals.push(val);
  }
  if (!cols.length) return res.status(400).json({ error: 'No fields to update' });
  vals.push(req.tenantId, planId);

  try {
    const r = await db.query(
      `UPDATE tenant_plans SET ${cols.join(', ')} WHERE tenant_id=$${i++} AND plan_id=$${i}`,
      vals
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Plan not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE — soft delete via active=false
router.delete('/plans/:planId', async (req, res, next) => {
  const planId = Number(req.params.planId);
  if (!Number.isInteger(planId)) return res.status(400).json({ error: 'Invalid planId' });
  try {
    const r = await db.query(
      'UPDATE tenant_plans SET active=false WHERE tenant_id=$1 AND plan_id=$2',
      [req.tenantId, planId]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Plan not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
