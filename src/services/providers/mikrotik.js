const axios  = require('axios');
const https  = require('https');
const logger = require('../logger');

// MikroTik RouterOS v7.1+ REST API
// Docs: https://help.mikrotik.com/docs/display/ROS/REST+API

class MikrotikProvider {
  constructor(tenant) {
    this.tenant   = tenant;
    this.baseUrl  = tenant.mikrotik_url?.replace(/\/$/, ''); // e.g. https://router-ip/rest
    this.username = tenant.mikrotik_username;
    this.password = tenant.mikrotik_password;

    this._httpsAgent = new https.Agent({ rejectUnauthorized: false });
  }

  // ── Internal: make authenticated request ───────
  async _request(method, path, data = null) {
    const url = `${this.baseUrl}${path}`;

    const config = {
      method,
      url,
      httpsAgent:  this._httpsAgent,
      timeout:     15000,
      auth: {
        username: this.username,
        password: this.password,
      },
      headers: { 'Content-Type': 'application/json' },
    };

    if (data) config.data = data;

    const res = await axios(config);
    return res.data;
  }

  // ── Create a hotspot user (voucher) ───────────
  async createVoucher({ plan, email, reference, planConfig }) {
    const code     = this._generateCode();
    const profile  = planConfig?.mikrotikProfile || 'default';
    const limitAt  = planConfig?.mikrotikLimitAt  || '';
    const timeLimit = planConfig?.mikrotikTimeLimit || '30d';

    logger.info('Creating MikroTik hotspot user', {
      tenantId: this.tenant.tenant_id,
      plan,
      email,
    });

    await this._request('PUT', '/ip/hotspot/user', {
      name:        code,
      password:    code,
      profile,
      comment:     `${email} | ${plan} | ${reference}`,
      'limit-uptime': timeLimit,
    });

    logger.info('MikroTik hotspot user created', {
      tenantId: this.tenant.tenant_id,
      code,
    });

    return {
      code,
      omadaVoucherId: null, // Not applicable for MikroTik
      provider:       'mikrotik',
    };
  }

  // ── Get usage for a hotspot user ──────────────
  async getUsage(voucherCode) {
    try {
      const users = await this._request('GET', `/ip/hotspot/user?name=${voucherCode}`);
      const user  = Array.isArray(users) ? users[0] : users;

      if (!user) return null;

      return {
        remainingGb: null, // MikroTik doesn't expose remaining directly
        totalGb:     null,
        usedGb:      user['bytes-in'] ? parseInt(user['bytes-in']) / (1024 ** 3) : 0,
        expiry:      null,
        status:      user.disabled === 'true' ? 'disabled' : 'active',
        online:      false,
      };
    } catch (err) {
      logger.warn('Failed to get MikroTik usage', { error: err.message });
      return null;
    }
  }

  // ── Get online clients ─────────────────────────
  async getOnlineClients() {
    try {
      const active = await this._request('GET', '/ip/hotspot/active');
      const clients = Array.isArray(active) ? active : [];

      return {
        online:  clients.length,
        offline: 0,
        clients: clients.map(c => ({
          name:   c.user || c.address,
          mac:    c['mac-address'],
          ip:     c.address,
          online: true,
        })),
      };
    } catch (err) {
      logger.warn('Failed to get MikroTik online clients', { error: err.message });
      return { online: 0, offline: 0, clients: [] };
    }
  }

  // ── Deactivate a hotspot user ──────────────────
  async deactivateVoucher(voucherCode) {
    try {
      await this._request('PATCH', `/ip/hotspot/user?name=${voucherCode}`, {
        disabled: 'true',
      });
      return true;
    } catch (err) {
      logger.warn('Failed to deactivate MikroTik user', { error: err.message });
      return false;
    }
  }

  async syncAllVouchers(activeVouchers) {
    return []; // MikroTik sync handled differently
  }

  async testConnection() {
    try {
      await this._request('GET', '/system/identity');
      return { success: true, message: 'MikroTik connection successful' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  _generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 8 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
  }
}

module.exports = MikrotikProvider;