'use strict';

const express = require('express');
const router  = express.Router();

const db = require('../../services/db');
const authRequired = require('../middleware/authRequired');

router.use(authRequired);

// ── GET /api/analytics/overview?days=30 ──────────────────────
// Revenue analytics for the operator dashboard. Tenant-scoped, success only.
router.get('/overview', async (req, res, next) => {
  try {
    let days = parseInt(req.query.days, 10);
    if (!Number.isInteger(days)) days = 30;
    days = Math.min(365, Math.max(1, days));

    const [daily, byPlan, totals] = await Promise.all([
      // Gap-filled daily series: one row per day even when no sales that day.
      db.query(
        `SELECT d::date AS day,
                COALESCE(SUM(p.amount), 0) AS revenue,
                COUNT(p.id)                AS count
           FROM generate_series(
                  (CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day'),
                  CURRENT_DATE,
                  INTERVAL '1 day'
                ) AS d
           LEFT JOIN purchases p
                  ON p.tenant_id = $1
                 AND p.status    = 'success'
                 AND p.date >= d
                 AND p.date <  d + INTERVAL '1 day'
          GROUP BY d
          ORDER BY d`,
        [req.tenantId, days]
      ),
      db.query(
        `SELECT plan,
                COUNT(*)                AS count,
                COALESCE(SUM(amount),0) AS revenue
           FROM purchases
          WHERE tenant_id = $1
            AND status    = 'success'
            AND date >= CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day'
          GROUP BY plan
          ORDER BY revenue DESC`,
        [req.tenantId, days]
      ),
      db.query(
        `SELECT
           COUNT(*) FILTER (WHERE date >= CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day') AS window_count,
           COALESCE(SUM(amount) FILTER (WHERE date >= CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day'),0) AS window_revenue,
           COUNT(*)                AS all_count,
           COALESCE(SUM(amount),0) AS all_revenue
           FROM purchases
          WHERE tenant_id = $1 AND status = 'success'`,
        [req.tenantId, days]
      ),
    ]);

    const t = totals.rows[0] || {};
    res.json({
      days,
      daily: daily.rows.map(r => ({
        day:     r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
        revenue: Number(r.revenue),
        count:   Number(r.count),
      })),
      byPlan: byPlan.rows.map(r => ({
        plan:    r.plan,
        count:   Number(r.count),
        revenue: Number(r.revenue),
      })),
      totals: {
        windowRevenue:  Number(t.window_revenue || 0),
        windowCount:    Number(t.window_count   || 0),
        allTimeRevenue: Number(t.all_revenue    || 0),
        allTimeCount:   Number(t.all_count      || 0),
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
