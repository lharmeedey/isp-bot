'use strict';

/**
 * webProvisioning — provision a voucher for a STOREFRONT customer after a
 * verified Paystack payment. This is the deliberately-thin, Telegram-free mirror
 * of tenantManager.handlePayment: it performs the same orchestration
 * (dedupe → resolve plan → verify amount → getProvider → createVoucher →
 * persist) but writes rows keyed by customer_id (telegram_id left NULL) and
 * sends no bot message — the code is returned to the HTTP caller.
 *
 * It NEVER touches the frozen bot path. It reuses the shared provider layer and
 * the pure paymentLogic helpers exactly as the bot does.
 *
 * Idempotent on purchases.reference: a second call for the same reference
 * returns the already-issued voucher instead of provisioning again.
 */
const db     = require('../../services/db');
const logger = require('../../services/logger');
const { getProvider, clearProviderCache } = require('../../services/providers');
const { verifyPayment, planGb, computeExpiry } = require('../../services/paymentLogic');

/**
 * @param {object} args
 * @param {string} args.tenantId
 * @param {number} args.customerId
 * @param {string} args.plan        plan label
 * @param {string} args.email       customer email (voucher username)
 * @param {string} args.reference   Paystack reference (idempotency key)
 * @param {number} args.amountKobo  amount paid, in kobo (from verified charge)
 * @returns {Promise<{code, plan, expiry, alreadyIssued}>}
 * @throws  {status} 409 unknown_plan / amount_mismatch, 404 tenant missing
 */
async function provisionForCustomer({ tenantId, customerId, plan, email, reference, amountKobo }) {
  // ── Idempotency: if this reference already provisioned, return that voucher ──
  const existing = await db.query(
    `SELECT v.code, v.plan
       FROM vouchers v
      WHERE v.reference = $1 AND v.tenant_id = $2 AND v.customer_id = $3
      LIMIT 1`,
    [reference, tenantId, customerId]
  );
  if (existing.rows.length) {
    logger.info('Web provisioning: reference already fulfilled', { tenantId, reference });
    return {
      code:          existing.rows[0].code,
      plan:          existing.rows[0].plan,
      expiry:        null,
      alreadyIssued: true,
    };
  }

  // ── Resolve the plan: tenant-specific first, then global env fallback ──
  let planObj;
  const tenantPlansRes = await db.query(
    `SELECT * FROM tenant_plans
      WHERE tenant_id = $1 AND label = $2 AND active = true
      LIMIT 1`,
    [tenantId, plan]
  );

  if (tenantPlansRes.rows.length) {
    const tp = tenantPlansRes.rows[0];
    planObj = {
      id:             tp.plan_id,
      label:          tp.label,
      price:          parseFloat(tp.price),
      gb:             parseFloat(tp.gb),
      validity:       tp.validity,
      omadaProfileId: tp.omada_profile_id,
    };
  } else {
    const globalPlans = JSON.parse(process.env.PLANS || '[]');
    planObj = globalPlans.find(p => p.label === plan);
  }

  // ── Re-verify the amount server-side before issuing anything ──
  const check = verifyPayment(planObj, amountKobo);
  if (!check.ok) {
    const e = new Error(
      check.reason === 'amount_mismatch'
        ? 'Amount paid does not match the plan price'
        : 'Unknown plan'
    );
    e.status = 409;
    e.reason = check.reason;
    logger.error('Web provisioning refused', { tenantId, plan, reference, reason: check.reason });
    throw e;
  }

  const gbForPlan = planGb(planObj);
  const expiry    = computeExpiry(planObj.validity);

  // ── Fetch fresh tenant + provider (mirrors handlePayment) ──
  const freshTenantRes = await db.query(
    'SELECT * FROM tenants WHERE tenant_id = $1', [tenantId]
  );
  const freshTenant = freshTenantRes.rows[0];
  if (!freshTenant) {
    const e = new Error('Tenant not found');
    e.status = 404;
    throw e;
  }

  // Safety net (Omada): refuse to issue if this plan isn't linked to a voucher
  // group. Without an omada_profile_id the provider's stock claim falls back to
  // ANY unused voucher and would hand out the WRONG plan's code. Better to fail
  // loudly (money already captured, flagged for support) than deliver a
  // mismatched voucher. Map the plan's profile in onboarding to resolve.
  if (freshTenant.network_provider === 'omada' && !planObj.omadaProfileId) {
    const e = new Error('This plan is not linked to a voucher group yet. Please contact support.');
    e.status = 409;
    e.reason = 'plan_unmapped';
    logger.error('Web provisioning refused: plan has no omada_profile_id', { tenantId, plan, reference });
    throw e;
  }

  clearProviderCache(tenantId);
  const provider = getProvider(freshTenant);

  let voucherCode    = null;
  let omadaVoucherId = null;
  let providerError  = null;

  logger.info('Web provisioning: calling provider createVoucher', {
    tenantId, plan, provider: freshTenant.network_provider, reference,
  });

  try {
    const result = await provider.createVoucher({
      plan,
      email,
      reference,
      planConfig: planObj,
    });
    voucherCode    = result.code;
    omadaVoucherId = result.omadaVoucherId;
  } catch (err) {
    providerError = err.message;
    logger.error('Web provisioning: provider voucher creation failed', {
      tenantId, provider: freshTenant.network_provider, error: err.message,
    });
    // Fallback random code (same policy as the bot path) so a paid customer is
    // never left empty-handed; flagged for support if it doesn't work.
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    voucherCode = Array.from({ length: 8 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
  }

  // ── Persist purchase + voucher in one transaction, keyed by customer_id ──
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO purchases (customer_id, tenant_id, email, plan, amount, reference)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (reference) DO NOTHING`,
      [customerId, tenantId, email, plan, amountKobo / 100, reference]
    );

    const voucherInsert = await client.query(
      `INSERT INTO vouchers (customer_id, tenant_id, email, plan, code, omada_voucher_id, reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (code) DO UPDATE SET
         customer_id      = EXCLUDED.customer_id,
         tenant_id        = EXCLUDED.tenant_id,
         email            = EXCLUDED.email,
         plan             = EXCLUDED.plan,
         omada_voucher_id = EXCLUDED.omada_voucher_id,
         reference        = EXCLUDED.reference
       RETURNING xmax = 0 AS inserted`,
      [customerId, tenantId, email, plan, voucherCode, omadaVoucherId, reference]
    );

    if (!voucherInsert.rows[0]?.inserted) {
      logger.warn('Web provisioning: voucher code collision', {
        tenantId, voucherCode, reference,
      });
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  logger.info('Web provisioning complete', { tenantId, customerId, reference, plan });

  return {
    code:          voucherCode,
    plan,
    expiry:        expiry.toISOString().slice(0, 10),
    providerError: providerError || undefined,
    alreadyIssued: false,
  };
}

module.exports = { provisionForCustomer };
