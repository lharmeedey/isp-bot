/**
 * Pure, side-effect-free helpers for the payment path.
 * No DB, no network, no Telegram — so they're trivially unit-testable.
 */

// Days of validity implied by a plan's validity string.
// "7 days" / "7_days" → 7, everything else → 30.
function validityDays(validity) {
  return typeof validity === 'string' && validity.includes('7') ? 7 : 30;
}

// GB granted by a plan (0 if the plan is missing/malformed).
function planGb(planObj) {
  const gb = Number(planObj?.gb);
  return Number.isFinite(gb) && gb > 0 ? gb : 0;
}

// Expiry date given a start date and a validity string.
function computeExpiry(validity, from = new Date()) {
  const days   = validityDays(validity);
  const expiry = new Date(from.getTime());
  expiry.setDate(expiry.getDate() + days);
  return expiry;
}

/**
 * Decide whether a Paystack charge should provision the plan.
 * Paystack `amount` is in kobo; plan `price` is in naira.
 *
 * Returns one of:
 *   { ok: true }
 *   { ok: false, reason: 'unknown_plan' }
 *   { ok: false, reason: 'amount_mismatch', expectedKobo, paidKobo }
 */
function verifyPayment(planObj, amountKobo) {
  if (!planObj) return { ok: false, reason: 'unknown_plan' };

  const expectedKobo = Math.round((Number(planObj.price) || 0) * 100);
  const paidKobo     = Number(amountKobo) || 0;

  if (expectedKobo > 0 && paidKobo < expectedKobo) {
    return { ok: false, reason: 'amount_mismatch', expectedKobo, paidKobo };
  }
  return { ok: true };
}

// Extract + validate the metadata Paystack echoes back.
// Returns { valid: false } when required fields are missing.
function parseMetadata(metadata) {
  const { telegram_id, plan, email } = metadata || {};
  if (!telegram_id || !plan || !email) return { valid: false };
  return { valid: true, telegramId: Number(telegram_id), plan, email };
}

module.exports = {
  validityDays,
  planGb,
  computeExpiry,
  verifyPayment,
  parseMetadata,
};
