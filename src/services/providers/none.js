const db = require('../db');

class NoneProvider {
  constructor(tenant) {
    this.tenant = tenant;
  }

  async createVoucher({ plan, email, reference }) {
    // Atomically claim a voucher from stock so two concurrent payments
    // can never receive the same code.
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const res = await client.query(
        `SELECT id, code FROM voucher_stock
          WHERE tenant_id=$1 AND plan=$2 AND status='unused'
          ORDER BY id ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
        [this.tenant.tenant_id, plan]
      );

      if (res.rows.length) {
        const voucher = res.rows[0];
        await client.query(
          `UPDATE voucher_stock
              SET status='used', email=$1, reference=$2, assigned_at=NOW()
            WHERE id=$3`,
          [email, reference, voucher.id]
        );
        await client.query('COMMIT');
        return {
          code:           voucher.code,
          omadaVoucherId: null,
          provider:       'stock',
        };
      }

      await client.query('ROLLBACK');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
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