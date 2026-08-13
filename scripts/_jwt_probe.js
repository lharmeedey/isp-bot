'use strict';
// READ-ONLY end-to-end check: sign an access token locally with the local
// JWT_SECRET for a REAL operator, then call the LIVE /api/auth/me.
// 200 => Render JWT_SECRET matches local (fix confirmed). 401 => mismatch.
require('dotenv').config();
const db = require('../src/services/db');
const { signAccessToken } = require('../src/web/auth/jwt');

const BASE = 'https://isp-bots.onrender.com';

(async () => {
  const { rows } = await db.query(
    `SELECT o.id, o.tenant_id, o.role
       FROM operators o
       JOIN tenants t ON t.tenant_id = o.tenant_id
      WHERE o.active = true
      ORDER BY o.id ASC
      LIMIT 1`
  );
  if (!rows.length) throw new Error('no active operator found');
  const op = rows[0];
  console.log(`probe operator id=${op.id} tenant=${op.tenant_id} role=${op.role}`);

  const token = signAccessToken({ operatorId: op.id, tenantId: op.tenant_id, role: op.role });
  console.log(`token signed locally (len ${token.length})`);

  const r = await fetch(`${BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log(`LIVE /api/auth/me -> HTTP ${r.status}`);
  const body = await r.text();
  // Print only structural info, not secrets.
  if (r.status === 200) {
    const j = JSON.parse(body);
    console.log(`  ok: operator.email present=${!!j.operator?.email} tenant.name=${j.tenant?.name} onboardingStep=${j.tenant?.onboardingStep}`);
    console.log('  => JWT_SECRET MATCHES. Fix confirmed.');
  } else {
    console.log(`  body: ${body.slice(0, 120)}`);
    console.log('  => JWT_SECRET still mismatched (or not yet redeployed).');
  }

  await db.pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
