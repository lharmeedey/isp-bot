const axios  = require('axios');
const https  = require('https');
const logger = require('../logger');
const { decrypt } = require('../encryption');

class OmadaProvider {
  constructor(tenant) {
    this.tenant         = tenant;
    this.baseUrl        = tenant.omada_url?.replace(/\/$/, '');
    this.omadacId       = tenant.omada_controller_id || null;
    this.siteId         = tenant.omada_site_id;
    this.clientId       = decrypt(tenant.omada_client_id)     || tenant.omada_client_id;
    this.clientSecret   = decrypt(tenant.omada_client_secret) || tenant.omada_client_secret;
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

  // ── Internal API request (uses /{omadacId}/api/v2/) ──
  async _internalRequest(method, path, data = null) {
    const token    = await this._getToken();
    const omadacId = await this._getOmadacId();
    const url      = `${this.baseUrl}/${omadacId}/api/v2${path}`;

    const config = {
      method,
      url,
      httpsAgent: this._httpsAgent,
      timeout:    15000,
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `AccessToken=${token}`,
      },
    };

    if (data) config.data = data;

    const res = await axios(config);

    if (res.data?.errorCode !== 0) {
      throw new Error(
        `Omada internal API error: ${res.data?.msg} (code: ${res.data?.errorCode})`
      );
    }

    return res.data.result;
  }

  // ── OpenAPI request (uses /openapi/v1/) ────────
  async _openApiRequest(method, path, data = null) {
    const token    = await this._getToken();
    const omadacId = await this._getOmadacId();
    const url      = `${this.baseUrl}/openapi/v1/${omadacId}/sites/${this.siteId}${path}`;

    const config = {
      method,
      url,
      httpsAgent: this._httpsAgent,
      timeout:    15000,
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `AccessToken=${token}`,
      },
    };

    if (data) config.data = data;

    const res = await axios(config);

    if (res.data?.errorCode !== 0) {
      throw new Error(
        `Omada API error: ${res.data?.msg} (code: ${res.data?.errorCode})`
      );
    }

    return res.data.result;
  }

  // ── Get voucher groups ─────────────────────────
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

  // ── Fetch unused vouchers from Omada ──────────
  // Uses internal API which returns actual codes
  async fetchUnusedVouchers(groupId, page = 1, pageSize = 100) {
    const omadacId = await this._getOmadacId();
    const token    = await this._getToken();

    const res = await axios.get(
      `${this.baseUrl}/${omadacId}/api/v2/hotspot/sites/${this.siteId}/vouchers`,
      {
        httpsAgent: this._httpsAgent,
        timeout:    15000,
        headers:    { Authorization: `AccessToken=${token}` },
        params: {
          page,
          pageSize,
          currentPage:     page,
          currentPageSize: pageSize,
          voucherGroupId:  groupId,
          status:          0, // 0 = unused
        },
      }
    );

    if (res.data?.errorCode !== 0) {
      throw new Error(`Failed to fetch vouchers: ${res.data?.msg}`);
    }

    return res.data.result?.data || [];
  }

  // ── Sync all voucher groups into DB ────────────
  async syncVouchersToDb(db) {
    const groups = await this.getVoucherGroups();
    const plans  = JSON.parse(process.env.PLANS || '[]');

    let totalInserted = 0;
    let totalSkipped  = 0;

    for (const group of groups) {
      // Match group to plan by omadaProfileId
      const plan = plans.find(p => p.omadaProfileId === group.id);
      if (!plan) {
        logger.debug('No plan matched for voucher group', { groupName: group.name, groupId: group.id });
        continue;
      }

      logger.info('Syncing voucher group', {
        tenantId:  this.tenant.tenant_id,
        groupName: group.name,
        unusedCount: group.unusedCount,
      });

      // Check how many we already have in stock
      const existingRes = await db.query(
        `SELECT COUNT(*) as count FROM voucher_stock
         WHERE tenant_id=$1 AND plan=$2 AND status='unused'`,
        [this.tenant.tenant_id, plan.label]
      );
      const existingCount = parseInt(existingRes.rows[0].count);

      // Only sync if we have less than 50 unused in DB
      if (existingCount >= 50) {
        logger.debug('Stock sufficient, skipping sync', {
          plan:     plan.label,
          existing: existingCount,
        });
        continue;
      }

      // Fetch from Omada
      try {
        const vouchers = await this.fetchUnusedVouchers(group.id, 1, 100);

        for (const v of vouchers) {
          if (!v.code) continue;
          try {
            await db.query(
              `INSERT INTO voucher_stock (tenant_id, plan, code)
               VALUES ($1, $2, $3)
               ON CONFLICT (code) DO NOTHING`,
              [this.tenant.tenant_id, plan.label, v.code]
            );
            totalInserted++;
          } catch (e) {
            totalSkipped++;
          }
        }

        logger.info('Vouchers synced from Omada', {
          tenantId:  this.tenant.tenant_id,
          plan:      plan.label,
          fetched:   vouchers.length,
          inserted:  totalInserted,
        });

      } catch (err) {
        logger.warn('Failed to fetch vouchers for group', {
          groupName: group.name,
          error:     err.message,
        });
      }
    }

    return { totalInserted, totalSkipped };
  }

  // ── Create voucher — picks from synced stock ───
  async createVoucher({ plan, email, reference, planConfig }) {
    const db = require('../db');

    logger.info('Getting voucher from stock', {
      tenantId: this.tenant.tenant_id,
      plan,
      email,
    });

    // Check stock
    const res = await db.query(
      `SELECT id, code FROM voucher_stock
       WHERE tenant_id=$1 AND plan=$2 AND status='unused'
       ORDER BY created_at ASC
       LIMIT 1`,
      [this.tenant.tenant_id, plan]
    );

    if (!res.rows.length) {
      // Try to sync from Omada immediately
      logger.warn('No stock available, attempting immediate sync', {
        tenantId: this.tenant.tenant_id,
        plan,
      });

      await this.syncVouchersToDb(db);

      // Try again after sync
      const retryRes = await db.query(
        `SELECT id, code FROM voucher_stock
         WHERE tenant_id=$1 AND plan=$2 AND status='unused'
         ORDER BY created_at ASC
         LIMIT 1`,
        [this.tenant.tenant_id, plan]
      );

      if (!retryRes.rows.length) {
        throw new Error(
          `No vouchers available for plan: ${plan}. Please check your Omada controller.`
        );
      }

      const voucher = retryRes.rows[0];
      await db.query(
        `UPDATE voucher_stock
         SET status='used', email=$1, reference=$2, assigned_at=NOW()
         WHERE id=$3`,
        [email, reference, voucher.id]
      );

      return {
        code:           voucher.code,
        omadaVoucherId: null,
        provider:       'omada_stock',
      };
    }

    const voucher = res.rows[0];
    await db.query(
      `UPDATE voucher_stock
       SET status='used', email=$1, reference=$2, assigned_at=NOW()
       WHERE id=$3`,
      [email, reference, voucher.id]
    );

    logger.info('Voucher assigned from stock', {
      tenantId: this.tenant.tenant_id,
      code:     voucher.code,
      plan,
    });

    return {
      code:           voucher.code,
      omadaVoucherId: null,
      provider:       'omada_stock',
    };
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
    return true;
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