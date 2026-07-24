const axios  = require('axios');
const crypto = require('crypto');
const https  = require('https');
const logger = require('../logger');

// Omada Software Controller v5.13+ API
// Docs: https://your-controller:8043/doc/index

class OmadaProvider {
  constructor(tenant) {
    this.tenant      = tenant;
    this.baseUrl     = tenant.omada_url?.replace(/\/$/, ''); // e.g. https://your-vps-ip:8043
    this.siteId      = tenant.omada_site_id;
    this.clientId    = tenant.omada_client_id;
    this.clientSecret = tenant.omada_client_secret;

    // Token cache per instance
    this._accessToken  = null;
    this._tokenExpiry  = null;
    this._omadacId     = null; // Controller ID — fetched once on first call

    // Allow self-signed certificates on private controllers
    this._httpsAgent = new https.Agent({ rejectUnauthorized: false });
  }

  // ── Internal: get controller ID ───────────────
  async _getOmadacId() {
    if (this._omadacId) return this._omadacId;

    const res = await axios.get(`${this.baseUrl}/api/info`, {
      httpsAgent: this._httpsAgent,
      timeout:    10000,
    });

    if (res.data?.errorCode !== 0) {
      throw new Error(`Failed to get controller info: ${res.data?.msg}`);
    }

    this._omadacId = res.data.result.omadacId;
    logger.debug('Omada controller ID fetched', {
      omadacId: this._omadacId,
      tenantId: this.tenant.tenant_id,
    });

    return this._omadacId;
  }

  // ── Internal: get access token ─────────────────
  async _getToken() {
    // Return cached token if still valid (with 60s buffer)
    if (this._accessToken && this._tokenExpiry && Date.now() < this._tokenExpiry - 60000) {
      return this._accessToken;
    }

    const omadacId = await this._getOmadacId();

    const res = await axios.post(
      `${this.baseUrl}/${omadacId}/api/v2/hotspot/token`,
      {
        client_id:     this.clientId,
        client_secret: this.clientSecret,
        grant_type:    'client_credentials',
      },
      {
        httpsAgent:   this._httpsAgent,
        timeout:      10000,
        headers:      { 'Content-Type': 'application/json' },
      }
    );

    if (res.data?.errorCode !== 0) {
      throw new Error(`Omada auth failed: ${res.data?.msg}`);
    }

    this._accessToken = res.data.result.accessToken;
    this._tokenExpiry = Date.now() + (res.data.result.expiresIn * 1000);

    logger.info('Omada token refreshed', { tenantId: this.tenant.tenant_id });
    return this._accessToken;
  }

  // ── Internal: make authenticated API request ───
  async _request(method, path, data = null) {
    const token    = await this._getToken();
    const omadacId = await this._getOmadacId();
    const url      = `${this.baseUrl}/${omadacId}/api/v2/hotspot/sites/${this.siteId}${path}`;

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
      // If token expired, clear cache and retry once
      if (err.response?.status === 401) {
        this._accessToken = null;
        this._tokenExpiry = null;
        throw new Error('Omada token expired — will retry on next call');
      }
      throw err;
    }
  }

  // ── Create a voucher ───────────────────────────
  async createVoucher({ plan, email, reference, planConfig }) {
    // planConfig comes from the PLANS env var matched to this plan label
    // It should contain: omadaProfileId or the raw voucher settings

    logger.info('Creating Omada voucher', {
      tenantId: this.tenant.tenant_id,
      plan,
      email,
    });

    const payload = {
      // Number of vouchers to generate
      count: 1,

      // Voucher type: 0 = time-limited, 1 = traffic-limited, 2 = both
      // We use the profile configured on Omada controller
      // The profile handles quota and validity
      code: reference.slice(-8).toUpperCase(), // Use last 8 chars of reference as code hint

      // Note: In Omada v5.13, you create vouchers using a profile ID
      // The profile defines: data quota, validity, speed limit
      // Clients redeem the code on the captive portal
      note: `${email} - ${plan} - ${reference}`,
    };

    // If tenant has configured Omada profile IDs per plan, use them
    if (planConfig?.omadaProfileId) {
      payload.profileId = planConfig.omadaProfileId;
    }

    const result = await this._request('POST', '/hotspot/vouchers', payload);

    // Omada returns array of created vouchers
    const voucher = Array.isArray(result) ? result[0] : result;

    if (!voucher?.code) {
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
      provider:       'omada',
    };
  }

  // ── Get voucher usage ──────────────────────────
  async getUsage(omadaVoucherId) {
    if (!omadaVoucherId) return null;

    try {
      const result = await this._request('GET', `/hotspot/vouchers/${omadaVoucherId}`);

      if (!result) return null;

      return {
        remainingGb:  result.remainTraffic ? result.remainTraffic / 1024 : null,
        totalGb:      result.totalTraffic  ? result.totalTraffic  / 1024 : null,
        usedGb:       result.usedTraffic   ? result.usedTraffic   / 1024 : null,
        expiry:       result.expireTime    ? new Date(result.expireTime).toISOString().slice(0, 10) : null,
        status:       result.status,       // 0=unused, 1=in use, 2=expired, 3=used up
        online:       result.onlineNum > 0,
      };
    } catch (err) {
      logger.warn('Failed to get Omada voucher usage', {
        omadaVoucherId,
        error: err.message,
      });
      return null;
    }
  }

  // ── Get all online clients ─────────────────────
  async getOnlineClients() {
    try {
      const result = await this._request('GET', '/hotspot/clients?status=online&pageSize=200&page=1');

      const clients = result?.data || [];
      const online  = clients.filter(c => c.status === 'online').length;

      return {
        online,
        offline: 0, // Omada only returns online clients in this endpoint
        clients: clients.map(c => ({
          name:    c.name || c.mac,
          mac:     c.mac,
          ip:      c.ip,
          online:  true,
          traffic: c.trafficDown + c.trafficUp,
        })),
      };
    } catch (err) {
      logger.warn('Failed to get Omada online clients', { error: err.message });
      return { online: 0, offline: 0, clients: [] };
    }
  }

  // ── Deactivate a voucher ───────────────────────
  async deactivateVoucher(omadaVoucherId) {
    if (!omadaVoucherId) return true;

    try {
      await this._request('DELETE', `/hotspot/vouchers/${omadaVoucherId}`);
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

  // ── Sync all active voucher usage ─────────────
  async syncAllVouchers(activeVouchers) {
    const results = [];

    for (const voucher of activeVouchers) {
      if (!voucher.omada_voucher_id) continue;

      const usage = await this.getUsage(voucher.omada_voucher_id);
      if (usage) {
        results.push({ ...voucher, usage });
      }
    }

    return results;
  }

  // ── Test connection ────────────────────────────
  async testConnection() {
    try {
      await this._getOmadacId();
      await this._getToken();
      return { success: true, message: 'Omada connection successful' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }
}

module.exports = OmadaProvider;