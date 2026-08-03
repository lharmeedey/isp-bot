'use strict';

const test   = require('node:test');
const assert = require('node:assert');

const {
  validityDays,
  planGb,
  computeExpiry,
  verifyPayment,
  parseMetadata,
} = require('../src/services/paymentLogic');

test('validityDays: a "7" validity means 7 days, everything else 30', () => {
  assert.strictEqual(validityDays('7 days'), 7);
  assert.strictEqual(validityDays('7_days'), 7);
  assert.strictEqual(validityDays('30 days'), 30);
  assert.strictEqual(validityDays('monthly'), 30);
  assert.strictEqual(validityDays(undefined), 30);
  assert.strictEqual(validityDays(null), 30);
});

test('planGb: reads gb, coerces strings, floors bad values to 0', () => {
  assert.strictEqual(planGb({ gb: 3 }), 3);
  assert.strictEqual(planGb({ gb: '5' }), 5);
  assert.strictEqual(planGb({ gb: 0 }), 0);
  assert.strictEqual(planGb({ gb: -2 }), 0);
  assert.strictEqual(planGb({ gb: 'abc' }), 0);
  assert.strictEqual(planGb({}), 0);
  assert.strictEqual(planGb(null), 0);
  assert.strictEqual(planGb(undefined), 0);
});

test('computeExpiry: adds the right number of days to a fixed start', () => {
  const from = new Date('2026-01-01T00:00:00.000Z');

  const weekly = computeExpiry('7 days', from);
  assert.strictEqual(weekly.toISOString().slice(0, 10), '2026-01-08');

  const monthly = computeExpiry('30 days', from);
  assert.strictEqual(monthly.toISOString().slice(0, 10), '2026-01-31');

  // Does not mutate the input date
  assert.strictEqual(from.toISOString().slice(0, 10), '2026-01-01');
});

test('verifyPayment: missing plan is rejected as unknown_plan', () => {
  assert.deepStrictEqual(verifyPayment(null, 100000), {
    ok: false,
    reason: 'unknown_plan',
  });
  assert.deepStrictEqual(verifyPayment(undefined, 100000), {
    ok: false,
    reason: 'unknown_plan',
  });
});

test('verifyPayment: exact and overpayment are accepted', () => {
  const plan = { price: 1000 }; // 1000 naira == 100000 kobo
  assert.deepStrictEqual(verifyPayment(plan, 100000), { ok: true });
  // Overpayment is allowed (customer paid more than required)
  assert.deepStrictEqual(verifyPayment(plan, 150000), { ok: true });
});

test('verifyPayment: underpayment is rejected with kobo detail', () => {
  const plan = { price: 1000 };
  const res  = verifyPayment(plan, 99999);
  assert.deepStrictEqual(res, {
    ok: false,
    reason: 'amount_mismatch',
    expectedKobo: 100000,
    paidKobo: 99999,
  });
});

test('verifyPayment: a zero/undefined-price plan never blocks on amount', () => {
  assert.deepStrictEqual(verifyPayment({ price: 0 }, 0), { ok: true });
  assert.deepStrictEqual(verifyPayment({}, 500), { ok: true });
});

test('parseMetadata: all required fields present -> valid, telegramId numeric', () => {
  const res = parseMetadata({ telegram_id: '12345', plan: '3GB', email: 'a@b.co' });
  assert.deepStrictEqual(res, {
    valid: true,
    telegramId: 12345,
    plan: '3GB',
    email: 'a@b.co',
  });
});

test('parseMetadata: any missing field -> invalid', () => {
  assert.deepStrictEqual(parseMetadata({ plan: '3GB', email: 'a@b.co' }), { valid: false });
  assert.deepStrictEqual(parseMetadata({ telegram_id: '1', email: 'a@b.co' }), { valid: false });
  assert.deepStrictEqual(parseMetadata({ telegram_id: '1', plan: '3GB' }), { valid: false });
  assert.deepStrictEqual(parseMetadata({}), { valid: false });
  assert.deepStrictEqual(parseMetadata(null), { valid: false });
  assert.deepStrictEqual(parseMetadata(undefined), { valid: false });
});
