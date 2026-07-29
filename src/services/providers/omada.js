const axios  = require('axios');
const https  = require('https');
const logger = require('../logger');
const { decrypt } = require('../encryption');

class OmadaProvider {
  constructor(tenant) {
    this.tenant           = tenant;
    this.baseUrl          = tenant.omada_url?.replace(/\/$/, '');
    this.omadacId         = tenant.omada_controller_id || null;
    this.siteId           = tenant.omada_site_id;
    this.clientId         = decrypt(tenant.omada_client_id)     || tenant.omada_client_id;
    this.clientSecret     = decrypt(tenant.omada_client_secret) || tenant.omada_client_secret;
    this.adminUsername    = decrypt(tenant.omada_admin_username) || tenant.omada_admin_username;
    this.adminPassword    = decrypt(tenant.omada_admin_password) || tenant.omada_admin_password;
    this.controllerType   = tenant.omada_controller_type || 'software';

    // OpenAPI token cache
    this._accessToken  = null;
    this._tokenExpiry  = null;

    // Session token cache
    this._sessionToken   = null;
    this._sessionCookies = null;
    this._sessionExpiry  = null;

    this._httpsAgent = this._buildHttpsAgent(tenant);
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

  // ── Get omadacId ───────────────────────────────
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

  // ── OpenAPI token (for voucher groups listing) ─
  async _getOpenApiToken() {
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
      throw new Error(`Omada OpenAPI auth failed: ${res.data?.msg}`);
    }

    this._accessToken = res.data.result.accessToken;
    this._tokenExpiry = Date.now() + res.data.result.expiresIn * 1000;

    return this._accessToken;
  }

  // ── Session login (for voucher create/list) ────
  async _getSession() {
    // Return cached session if still valid (sessions last 2 hours)
    if (
      this._sessionToken &&
      this._sessionExpiry &&
      Date.now() < this._sessionExpiry - 60000
    ) {
      return {
        token:   this._sessionToken,
        cookies: this._sessionCookies,
      };
    }

    if (!this.adminUsername || !this.adminPassword) {
      throw new Error(
        'Omada admin credentials not configured. Add omada_admin_username and omada_admin_password to this tenant.'
      );
    }

    const omadacId = await this._getOmadacId();

    logger.debug('Getting Omada session', {
      tenantId: this.tenant.tenant_id,
      username: this.adminUsername,
    });

    const res = await axios.post(
      `${this.baseUrl}/${omadacId}/api/v2/login`,
      {
        username: this.adminUsername,
        password: this.adminPassword,
      },
      {
        httpsAgent: this._httpsAgent,
        timeout:    10000,
        headers:    { 'Content-Type': 'application/json' },
      }
    );

    if (res.data?.errorCode !== 0) {
      throw new Error(`Omada session login failed: ${res.data?.msg}`);
    }

    this._sessionToken   = res.data.result.token;
    this._sessionCookies = res.headers['set-cookie']?.join('; ') || '';
    this._sessionExpiry  = Date.now() + (2 * 60 * 60 * 1000); // 2 hours

    logger.info('Omada session obtained', { tenantId: this.tenant.tenant_id });

    return {
      token:   this._sessionToken,
      cookies: this._sessionCookies,
    };
  }

  // ── Session headers ────────────────────────────
  async _sessionHeaders() {
    const { token, cookies } = await this._getSession();
    return {
      'Content-Type': 'application/json',
      'Csrf-Token':   token,
      Cookie:         cookies,
    };
  }

  // ── Get voucher groups (OpenAPI) ───────────────
  async getVoucherGroups() {
    const omadacId = await this._getOmadacId();
    const token    = await this._getOpenApiToken();

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

  // ── List vouchers (session API) ────────────────
  async listVouchers(groupId, page = 1, pageSize = 100) {
    const omadacId = await this._getOmadacId();
    const headers  = await this._sessionHeaders();

    const res = await axios.get(
      `${this.baseUrl}/${omadacId}/api/v2/hotspot/sites/${this.siteId}/vouchers`,
      {
        httpsAgent: this._httpsAgent,
        timeout:    15000,
        headers,
        params: {
          page,
          pageSize,
          currentPage:     page,
          currentPageSize: pageSize,
          voucherGroupId:  groupId,
        },
      }
    );

    if (res.data?.errorCode !== 0) {
      throw new Error(`Failed to list vouchers: ${res.data?.msg}`);
    }

    return res.data.result?.data || [];
  }

  // ── Create voucher (session API) ───────────────
  async createVoucherOnOmada(groupId) {
    const omadacId = await this._getOmadacId();
    const headers  = await this._sessionHeaders();

    const res = await axios.post(
      `${this.baseUrl}/${omadacId}/api/v2/hotspot/sites/${this.siteId}/vouchers`,
      { voucherGroupId: groupId, amount: 1 },
      {
        httpsAgent: this._httpsAgent,
        timeout:    15000,
        headers,
      }
    );

    if (res.data?.errorCode !== 0) {
      throw new Error(`Failed to create voucher: ${res.data?.msg}`);
    }

    const result   = res.data.result;
    const vouchers = result?.data || result;
    const voucher  = Array.isArray(vouchers) ? vouchers[0] : vouchers;

    if (!voucher?.code) {
      throw new Error('No voucher code in response: ' + JSON.stringify(result));
    }

    return voucher;
  }

  // ── Main createVoucher — live creation ─────────
async createVoucher({ plan, email, reference, planConfig }) {
    logger.info('Creating live Omada voucher', {
      tenantId: this.tenant.tenant_id,
      plan,
      email,
    });

    const groupId = planConfig?.omadaProfileId;

    if (!groupId) {
      throw new Error(
        `No Omada voucher group ID for plan: ${plan}. Check PLANS env variable.`
      );
    }

    const voucher = await this.createVoucherOnOmada(groupId);

    logger.info('Live Omada voucher created', {
      tenantId: this.tenant.tenant_id,
      code:     voucher.code,
      id:       voucher.id,
    });

    return {
      code:           voucher.code,
      omadaVoucherId: voucher.id || null,
      provider:       `omada_${this.controllerType}`,
    };
  }
  // ── Sync vouchers to DB stock (for backup) ─────
  async syncVouchersToDb(db) {
    const groups = await this.getVoucherGroups();
    const plans  = JSON.parse(process.env.PLANS || '[]');
    let totalInserted = 0;

    for (const group of groups) {
      const plan = plans.find(p => p.omadaProfileId === group.id);
      if (!plan) continue;

      try {
        const vouchers = await this.listVouchers(group.id, 1, 100);

        for (const v of vouchers) {
          if (!v.code || v.status !== 0) continue; // status 0 = unused
          try {
            await db.query(
              `INSERT INTO voucher_stock (tenant_id, plan, code)
               VALUES ($1, $2, $3)
               ON CONFLICT (code) DO NOTHING`,
              [this.tenant.tenant_id, plan.label, v.code]
            );
            totalInserted++;
          } catch (e) {
            // duplicate — skip
          }
        }

        logger.info('Vouchers synced', {
          tenantId: this.tenant.tenant_id,
          plan:     plan.label,
          count:    vouchers.length,
        });

      } catch (err) {
        logger.warn('Sync failed for group', { group: group.name, error: err.message });
      }
    }

    return { totalInserted };
  }

  async getUsage(omadaVoucherId) { return null; }

  async getOnlineClients() {
    try {
      const groups      = await this.getVoucherGroups();
      const totalUsed   = groups.reduce(
        (sum, g) => sum + ((g.totalCount || 0) - (g.unusedCount || 0)), 0
      );
      const totalUnused = groups.reduce(
        (sum, g) => sum + (g.unusedCount || 0), 0
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
      const omadacId = await this._getOmadacId();
      const headers  = await this._sessionHeaders();
      await axios.delete(
        `${this.baseUrl}/${omadacId}/api/v2/hotspot/sites/${this.siteId}/vouchers`,
        { httpsAgent: this._httpsAgent, headers, data: { ids: [omadaVoucherId] } }
      );
      return true;
    } catch (err) {
      logger.warn('Failed to deactivate voucher', { omadaVoucherId, error: err.message });
      return false;
    }
  }

  async testConnection() {
    try {
      await this._getOmadacId();
      await this._getOpenApiToken();
      const groups = await this.getVoucherGroups();

      // Also test session auth
      let sessionStatus = '';
      try {
        await this._getSession();
        sessionStatus = ' | Session auth ✅';
      } catch (e) {
        sessionStatus = ` | Session auth ❌ (${e.message})`;
      }

      return {
        success:        true,
        message:        `Connected. ${groups.length} group(s): ${groups.map(g => `${g.name} (${g.unusedCount} unused)`).join(', ')}${sessionStatus}`,
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