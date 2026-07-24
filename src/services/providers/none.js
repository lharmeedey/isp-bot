// Fallback provider — no network integration
// Uses dormant/simulated data (current behavior)

class NoneProvider {
  constructor(tenant) {
    this.tenant = tenant;
  }

  async createVoucher({ plan, email, reference }) {
    // Generate a random code — no real network call
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

  async getUsage(voucherCode) {
    // Return null — caller falls back to DB values
    return null;
  }

  async getOnlineClients() {
    return { online: 0, offline: 0, clients: [] };
  }

  async deactivateVoucher(voucherCode) {
    return true;
  }

  async testConnection() {
    return { success: true, message: 'No provider configured — using dormant mode' };
  }
}

module.exports = NoneProvider;