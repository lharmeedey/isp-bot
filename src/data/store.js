const db   = require('../services/db');
const crypto = require('crypto');

// ── Available plans (static, no need for DB) ──
const plans = [
  { id: 1, label: '5GB',   price: 1000,  gb: 5,   validity: '7 days'  },
  { id: 2, label: '20GB',  price: 3500,  gb: 20,  validity: '30 days' },
  { id: 3, label: '100GB', price: 12000, gb: 100, validity: '30 days' },
  { id: 4, label: '500GB', price: 60000, gb: 500, validity: '30 days' },
];

// Pending payments (still in memory — short lived)
const pendingPayments = {};

// ── Admin stats (computed from DB) ────────────
async function getAdminStats() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [txResult, revenueResult, usersResult, bwResult] = await Promise.all([
    db.query(`SELECT COUNT(*) FROM purchases WHERE date >= $1`, [todayStart]),
    db.query(`SELECT COALESCE(SUM(amount),0) as total FROM purchases WHERE date >= $1`, [todayStart]),
    db.query(`SELECT status, COUNT(*) as count FROM users GROUP BY status`),
    db.query(`SELECT COALESCE(SUM(total_gb),0) as sold FROM users`),
  ]);

  const statusMap = {};
  usersResult.rows.forEach(r => { statusMap[r.status] = parseInt(r.count); });

  return {
    today_transactions: parseInt(txResult.rows[0].count),
    today_revenue:      parseFloat(revenueResult.rows[0].total),
    online_users:       statusMap['active'] || 0,
    offline_users:      statusMap['inactive'] || 0,
    total_bandwidth_gb: 2048,
    sold_bandwidth_gb:  parseFloat(bwResult.rows[0].sold),
  };
}

// ── User methods ───────────────────────────────
async function getUserByTelegramId(tid) {
  const res = await db.query('SELECT * FROM users WHERE telegram_id = $1', [tid]);
  return res.rows[0] || null;
}

async function getUserByEmail(email) {
  const res = await db.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  return res.rows[0] || null;
}

async function registerUser(tid, email, name) {
  const res = await db.query(
    `INSERT INTO users (telegram_id, email, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (telegram_id) DO UPDATE SET email=$2, name=$3
     RETURNING *`,
    [tid, email.toLowerCase(), name]
  );
  return res.rows[0];
}

async function getAllUsers() {
  const res = await db.query('SELECT * FROM users ORDER BY telegram_id');
  return res.rows;
}

// ── Usage / cache methods ──────────────────────
function isStale(user, thresholdMinutes = 15) {
  const age = (Date.now() - new Date(user.last_sync)) / 60000;
  return age > thresholdMinutes;
}

async function simulateLiveSync(user) {
  // Replace this with a real ISP API call when ready
  const used = Math.random() * 0.5;
  const newRemaining = Math.max(0, parseFloat(user.remaining_gb) - used);

  await db.query(
    `UPDATE users SET remaining_gb = $1, last_sync = NOW() WHERE telegram_id = $2`,
    [newRemaining, user.telegram_id]
  );
  user.remaining_gb = newRemaining;
  user.last_sync    = new Date();
  return user;
}

// ── Purchase methods ───────────────────────────
async function getHistory(email, limit = 5) {
  const res = await db.query(
    `SELECT * FROM purchases WHERE email = $1 ORDER BY date DESC LIMIT $2`,
    [email.toLowerCase(), limit]
  );
  return res.rows;
}

async function addPurchase(telegramId, email, plan, amount, reference) {
  await db.query(
    `INSERT INTO purchases (telegram_id, email, plan, amount, reference)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (reference) DO NOTHING`,
    [telegramId, email.toLowerCase(), plan, amount, reference]
  );
}

// ── Plan activation ────────────────────────────
async function activatePlan(telegramId, planLabel) {
  const plan = plans.find(p => p.label === planLabel);
  if (!plan) return null;

  const expiry = new Date();
  expiry.setDate(expiry.getDate() + (plan.validity.includes('7') ? 7 : 30));

  const res = await db.query(
    `UPDATE users
     SET plan=$1, remaining_gb=$2, total_gb=$3, expiry=$4, status='active', last_sync=NOW()
     WHERE telegram_id=$5
     RETURNING *`,
    [plan.label, plan.gb, plan.gb, expiry.toISOString().slice(0,10), telegramId]
  );
  return res.rows[0];
}

// ── Voucher methods ────────────────────────────
function generateVoucherCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
}

async function saveVoucher(telegramId, email, plan, reference) {
  const code = generateVoucherCode();
  await db.query(
    `INSERT INTO vouchers (telegram_id, email, plan, code, reference)
     VALUES ($1, $2, $3, $4, $5)`,
    [telegramId, email, plan, code, reference]
  );
  return code;
}

module.exports = {
  plans,
  pendingPayments,
  getAdminStats,
  getUserByTelegramId,
  getUserByEmail,
  registerUser,
  getAllUsers,
  isStale,
  simulateLiveSync,
  getHistory,
  addPurchase,
  activatePlan,
  saveVoucher,
  generateVoucherCode,
};