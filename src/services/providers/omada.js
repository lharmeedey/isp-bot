const axios  = require('axios');
const https  = require('https');
const logger = require('../logger');

class OmadaProvider {
  constructor(tenant) {
    this.tenant         = tenant;
    this.baseUrl        = tenant.omada_url?.replace(/\/$/, '');
    this.omadacId       = tenant.omada_controller_id || null;
    this.siteId         = tenant.omada_site_id;
    this.clientId       = tenant.omada_client_id;
    this.clientSecret   = tenant.omada_client_secret;
    this.controllerType = tenant.omada_controller_type || 'software';
    this._accessToken   = null;
    this._tokenExpiry   = null;
    this._httpsAgent    = this._buildHttpsAgent(tenant);
  }

  _buildHttpsAgent(tenant) {
    if (
      this.controllerType === 'cloud' &&
      tenant.omada_cloud_cert &&
      tenant.omada_cloud_key
    ) {
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

  async _getToken() {
    if (
      this._accessToken &&
      this._tokenExpiry &&
      Date.now() < this._tokenExpiry - 60000
    ) {
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
    this._tokenExpiry = Date.now() + res.data.result.expiresIn * 1000;

    logger.info('Omada token refreshed', {
      tenantId:       this.tenant.tenant_id,
      controllerType: this.controllerType,
    });

    return this._accessToken;
  }

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
        Authorization:   `AccessToken=${token}`,
      },
    };

    if (data) config.data = data;

    try {
      const res = await axios(config);

      if (res.data?.errorCode !== 0) {
        throw new Error(
          `Omada API error: ${res.data?.msg} (code: ${res.data?.errorCode})`
        );
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

  async getVoucherGroups() {
    const omadacId = await this._getOmadacId();
    const token    = await this._getToken();

    const res = await axios.get(
      `${this.baseUrl}/openapi/v1/${omadacId}/sites/${this.siteId}/hotspot/voucher-groups?page=1&pageSize=100`,
      {
        httpsAgent: this._httpsAgent,
        timeout:    10000,
        headers:    { Authorization: `AccessToken=${token}` },
      }
    );

    if (res.data?.errorCode !== 0) {
      throw new Error(`Failed to get voucher groups: ${res.data?.msg}`);
    }

    return res.data.result?.data || [];
  }

  async createVoucher({ plan, email, reference, planConfig }) {
    logger.info('Creating Omada voucher', {
      tenantId: this.tenant.tenant_id,
      plan,
      email,
    });

    const voucherGroupId = planConfig?.omadaProfileId;

    if (!voucherGroupId) {
      throw new Error(
        `No Omada voucher group ID configured for plan: ${plan}. Check your PLANS env variable.`
      );
    }

    const omadacId = await this._getOmadacId();
    const token    = await this._getToken();

    const res = await axios.post(
      `${this.baseUrl}/openapi/v1/${omadacId}/sites/${this.siteId}/hotspot/vouchers`,
      { voucherGroupId, amount: 1 },
      {
        httpsAgent: this._httpsAgent,
        timeout:    15000,
        headers: {
          Authorization:  `AccessToken=${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (res.data?.errorCode !== 0) {
      throw new Error(
        `Omada voucher creation failed: ${res.data?.msg} (code: ${res.data?.errorCode})`
      );
    }

    const result   = res.data.result;
    const vouchers = result?.data || result;
    const voucher  = Array.isArray(vouchers) ? vouchers[0] : vouchers;

    if (!voucher?.code) {
      logger.error('Unexpected Omada voucher response', {
        result: JSON.stringify(result),
      });
      throw new Error('Omada did not return a voucher code');
    }

    logger.info('Omada voucher created', {
      tenantId:  this.tenant.tenant_id,
      code:      voucher.code,
      voucherId: voucher.id,
    });

    return {
      code:           voucher.code,
      omadaVoucherId: voucher.id || null,
      provider:       `omada_${this.controllerType}`,
    };
  }

  async getUsage(omadaVoucherId) {
    // Omada OpenAPI v3 does not expose a voucher usage endpoint
    // Balance is tracked via the local database instead
    return null;
  }

  async getOnlineClients() {
    try {
      const groups     = await this.getVoucherGroups();
      const totalUsed  = groups.reduce(
        (sum, g) => sum + ((g.totalCount || 0) - (g.unusedCount || 0)),
        0
      );
      const totalUnused = groups.reduce(
        (sum, g) => sum + (g.unusedCount || 0),
        0
      );

      return {
        online:  totalUsed,
        offline: totalUnused,
        clients: groups.map(g => ({
          name:   g.name,
          online: (g.totalCount || 0) - (g.unusedCount || 0),
          unused: g.unusedCount || 0,
          total:  g.totalCount  || 0,
        })),
      };
    } catch (err) {
      logger.warn('Failed to get Omada client stats', { error: err.message });
      return { online: 0, offline: 0, clients: [] };
    }
  }

  async deactivateVoucher(omadaVoucherId) {
    if (!omadaVoucherId) return true;

    try {
      await this._request('DELETE', '/hotspot/vouchers', {
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

  async testConnection() {
    try {
      await this._getOmadacId();
      await this._getToken();

      const groups = await this.getVoucherGroups();

      return {
        success:        true,
        message:        `Connected. Found ${groups.length} voucher group(s): ${groups.map(g => `${g.name} (${g.unusedCount} unused)`).join(', ')}`,
        controllerType: this.controllerType,
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