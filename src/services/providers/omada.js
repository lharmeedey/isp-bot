const axios  = require('axios');
const https  = require('https');
const logger = require('../logger');

class OmadaProvider {
  constructor(tenant) {
    this.tenant         = tenant;
    this.baseUrl        = tenant.omada_url?.replace(/\/$/, '');
    this.omadacId       = tenant.omada_controller_id || tenant.omada_site_id?.slice(0, 32);
    this.siteId         = tenant.omada_site_id;
    this.clientId       = tenant.omada_client_id;
    this.clientSecret   = tenant.omada_client_secret;
    this.controllerType = tenant.omada_controller_type || 'software';

    this._accessToken = null;
    this._tokenExpiry = null;
    this._httpsAgent  = this._buildHttpsAgent(tenant);
  }

  _buildHttpsAgent(tenant) {
    if (this.controllerType === 'cloud' && tenant.omada_cloud_cert && tenant.omada_cloud_key) {
      try {
        return new https.Agent({
          cert:               tenant.omada_cloud_cert,
          key:                tenant.omada_cloud_key,
          rejectUnauthorized: true,
        });
      } catch (err) {
        logger.error('Failed to build mTLS agent', { error: err.message });
      }
    }
    return new https.Agent({ rejectUnauthorized: false });
  }

  // ── Get omadacId from controller ───────────────
  async _getOmadacId() {
    if (this.omadacId) return this.omadacId;

    const res = await axios.get(`${this.baseUrl}/api/info`, {
      httpsAgent: this._httpsAgent,
      timeout:    10000,
    });

    if (res.data?.errorCode !== 0) {
      throw new Error(`Failed to get controller info: ${res.data?.msg}`);
    }

    this.omadacId = res.data.result.omadacId;
    return this.omadacId;
  }

  // ── Get access token ───────────────────────────
  async _getToken() {
    if (this._accessToken && this._tokenExpiry && Date.now() < this._tokenExpiry - 60000) {
      return this._accessToken;
    }

    const omadacId = await this._getOmadacId();

    const res = await axios.post(
      `${this.baseUrl}/openapi/authorize/token?grant_type=client_credentials`,
      {
        omadacId,
        client_id:     this.clientId,
        client_secret: this.clientSecret,
      },
      {
        httpsAgent: this._httpsAgent,
        timeout:    10000,
        headers:    { 'Content-Type': 'application/json' },
      }
    );

    if (res.data?.errorCode !== 0) {
      throw new Error(`Omada auth failed: ${res.data?.msg}`);
    }

    this._accessToken = res.data.result.accessToken;
    this._tokenExpiry = Date.now() + (res.data.result.expiresIn * 1000);

    logger.info('Omada token refreshed', {
      tenantId:       this.tenant.tenant_id,
      controllerType: this.controllerType,
    });

    return this._accessToken;
  }

  // ── Make authenticated request ─────────────────
  async _request(method, path, data = null) {
    const token    = await this._getToken();
    const omadacId = await this._getOmadacId();
    const url      = `${this.baseUrl}/openapi/v1/${omadacId}/sites/${this.siteId}${path}`;

    const config = {
      method,
      url,
      httpsAgent: this._httpsAgent,
      timeout:    15000,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `AccessToken=${token}`,
      },
    };

    if (data) config.data = data;

    try {
      const res = await axios(config);

      if (res.data?.errorCode !== 0) {
        throw new Error(`Omada API error: ${res.data?.msg} (code: ${res.data?.errorCode})`);
      }

      return res.data.result;

    } catch (err) {
      if (err.response?.status === 401) {
        this._accessToken = null;
        this._tokenExpiry = null;
        throw new Error('Omada token expired — will retry on next call');
      }
      throw err;
    }
  }

  // ── Get voucher groups ─────────────────────────
  async getVoucherGroups() {
    const result = await this._request('GET', '/hotspot/voucher-groups?page=1&pageSize=100');
    return result?.data || [];
  }

  // ── Create voucher ─────────────────────────────
  async createVoucher({ plan, email, reference, planConfig }) {
    logger.info('Creating Omada voucher', {
      tenantId: this.tenant.tenant_id,
      plan,
      email,
    });

    // Get voucher group ID from plan config
    const voucherGroupId = planConfig?.omadaProfileId;

    if (!voucherGroupId) {
      throw new Error(`No Omada voucher group ID configured for plan: ${plan}. Check your PLANS env variable.`);
    }

    const result = await this._request('POST', '/hotspot/vouchers', {
      voucherGroupId,
      amount: 1,
    });

    // Omada returns array of created vouchers
    const vouchers = result?.data || result;
    const voucher  = Array.isArray(vouchers) ? vouchers[0] : vouchers;

    if (!voucher?.code) {
      logger.error('Omada voucher response', { result: JSON.stringify(result) });
      throw new Error('Omada did not return a voucher code');
    }

    logger.info('Omada voucher created', {
      tenantId:  this.tenant.tenant_id,
      code:      voucher.code,
      voucherId: voucher.id,
    });

    return {
      code:           voucher.code,
      omadaVoucherId: voucher.id,
      provider:       `omada_${this.controllerType}`,
    };
  }

  // ── Get voucher usage ──────────────────────────
  async getUsage(omadaVoucherId) {
    if (!omadaVoucherId) return null;

    try {
      const result = await this._request(
        'GET',
        `/hotspot/vouchers?page=1&pageSize=1&filters.id=${omadaVoucherId}`
      );

      const vouchers = result?.data || [];
      const voucher  = vouchers[0];
      if (!voucher) return null;

      return {
        remainingGb: voucher.remainTraffic != null ? voucher.remainTraffic / 1024 : null,
        totalGb:     voucher.limitedTraffic != null ? voucher.limitedTraffic / 1024 : null,
        usedGb:      voucher.usedTraffic   != null ? voucher.usedTraffic   / 1024 : null,
        expiry:      voucher.expireTime    != null ? new Date(voucher.expireTime).toISOString().slice(0, 10) : null,
        status:      voucher.status,
        online:      (voucher.onlineCount || 0) > 0,
      };
    } catch (err) {
      logger.warn('Failed to get Omada voucher usage', {
        omadaVoucherId,
        error: err.message,
      });
      return null;
    }
  }

  // ── Get online clients ─────────────────────────
  async getOnlineClients() {
    try {
      const result  = await this._request('GET', '/hotspot/clients?page=1&pageSize=200');
      const clients = result?.data || [];

      return {
        online:  clients.length,
        offline: 0,
        clients: clients.map(c => ({
          name:   c.name || c.mac,
          mac:    c.mac,
          ip:     c.ip,
          online: true,
        })),
      };
    } catch (err) {
      logger.warn('Failed to get Omada online clients', { error: err.message });
      return { online: 0, offline: 0, clients: [] };
    }
  }

  // ── Deactivate voucher ─────────────────────────
  async deactivateVoucher(omadaVoucherId) {
    if (!omadaVoucherId) return true;

    try {
      await this._request('DELETE', `/hotspot/vouchers`, {
        ids: [omadaVoucherId],
      });
      logger.info('Omada voucher deactivated', { omadaVoucherId });
      return true;
    } catch (err) {
      logger.warn('Failed to deactivate Omada voucher', {
        omadaVoucherId,
        error: err.message,
      });
      return false;
    }
  }

  // ── Test connection ────────────────────────────
  async testConnection() {
    try {
      await this._getOmadacId();
      await this._getToken();

      // Try fetching voucher groups as final verification
      const groups = await this.getVoucherGroups();

      return {
        success:        true,
        message:        `Omada ${this.controllerType} controller connected. Found ${groups.length} voucher group(s).`,
        controllerType: this.controllerType,
        voucherGroups:  groups.map(g => ({ name: g.name, id: g.id, unused: g.unusedCount })),
      };
    } catch (err) {
      return {
        success:        false,
        message:        err.message,
        controllerType: this.controllerType,
      };
    }
  }
}

module.exports = OmadaProvider;