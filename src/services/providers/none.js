const db = require('../db');

class NoneProvider {
  constructor(tenant) {
    this.tenant = tenant;
  }

  async createVoucher({ plan, email, reference }) {
    // Try to get a voucher from stock
    const res = await db.query(
      `SELECT id, code FROM voucher_stock
       WHERE tenant_id=$1 AND plan=$2 AND status='unused'
       ORDER BY created_at ASC
       LIMIT 1`,
      [this.tenant.tenant_id, plan]
    );

    if (res.rows.length) {
      const voucher = res.rows[0];
      await db.query(
        `UPDATE voucher_stock
         SET status='used', email=$1, reference=$2, assigned_at=NOW()
         WHERE id=$3`,
        [email, reference, voucher.id]
      );
      return {
        code:           voucher.code,
        omadaVoucherId: null,
        provider:       'stock',
      };
    }

    // True fallback — random code if no stock
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code  = Array.from({ length: 8 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');

    return {
      code,
      omadaVoucherId: null,
      provider:       'none',
    };
  }

  async getUsage(voucherCode) { return null; }
  async getOnlineClients() { return { online: 0, offline: 0, clients: [] }; }
  async deactivateVoucher(voucherCode) { return true; }
  async testConnection() {
    return { success: true, message: 'Using voucher stock mode' };
  }
}

module.exports = NoneProvider;