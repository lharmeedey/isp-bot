const axios   = require('axios');
const https   = require('https');
const logger  = require('../logger');
const { decrypt } = require('../encryption');

class OmadaProvider {
  constructor(tenant) {
    this.tenant         = tenant;
    this.baseUrl        = tenant.omada_url?.replace(/\/$/, '');
    this.omadacId       = tenant.omada_controller_id || null;
    this.siteId         = tenant.omada_site_id;
    this.clientId       = decrypt(tenant.omada_client_id)       || tenant.omada_client_id;
    this.clientSecret   = decrypt(tenant.omada_client_secret)   || tenant.omada_client_secret;
    this.adminUsername  = decrypt(tenant.omada_admin_username)  || tenant.omada_admin_username;
    this.adminPassword  = decrypt(tenant.omada_admin_password)  || tenant.omada_admin_password;
    this.controllerType = tenant.omada_controller_type || 'software';

    // OpenAPI token cache
    this._accessToken  = null;
    this._tokenExpiry  = null;

    // Session cache
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
    // Software, Hardware (OC200), and fallback — self-signed cert
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

    logger.info('Omada OpenAPI token refreshed', { tenantId: this.tenant.tenant_id });
    return this._accessToken;
  }

  // ── Session login (for voucher listing per group) ──
  async _getSession() {
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
        'Omada admin credentials not configured. ' +
        'Add omada_admin_username and omada_admin_password to this tenant.'
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
    this._sessionExpiry  = Date.now() + 2 * 60 * 60 * 1000; // 2 hours

    logger.info('Omada session obtained', { tenantId: this.tenant.tenant_id });

    return {
      token:   this._sessionToken,
      cookies: this._sessionCookies,
    };
  }

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

  // ── Get vouchers for a specific group (session API) ──
  // Uses: GET /{omadacId}/api/v2/hotspot/sites/{siteId}/voucherGroups/{groupId}
  async getVouchersForGroup(groupId, page = 1, pageSize = 500) {
    const omadacId = await this._getOmadacId();
    const headers  = await this._sessionHeaders();

    const res = await axios.get(
      `${this.baseUrl}/${omadacId}/api/v2/hotspot/sites/${this.siteId}/voucherGroups/${groupId}`,
      {
        httpsAgent: this._httpsAgent,
        timeout:    15000,
        headers,
        params: {
          currentPage:     page,
          currentPageSize: pageSize,
        },
      }
    );

    if (res.data?.errorCode !== 0) {
      throw new Error(`Failed to get vouchers for group ${groupId}: ${res.data?.msg}`);
    }

    return res.data.result?.data || [];
  }

  // ── Sync all voucher groups into DB ────────────
  // Flow:
  // 1. Get all groups via OpenAPI
  // 2. For each group, fetch all vouchers via session API
  // 3. Insert unused ones into voucher_stock
  async syncVouchersToDb(db) {
  
    const groups = await this.getVoucherGroups();

    // Load tenant-specific plans first, fall back to global
    const tenantPlansRes = await db.query(
      `SELECT * FROM tenant_plans
       WHERE tenant_id=$1 AND active=true`,
      [this.tenant.tenant_id]
    );

    let plans;
    if (tenantPlansRes.rows.length) {
      plans = tenantPlansRes.rows.map(p => ({
        id:             p.plan_id,
        label:          p.label,
        price:          parseFloat(p.price),
        gb:             parseFloat(p.gb),
        validity:       p.validity,
        omadaProfileId: p.omada_profile_id,
      }));
    } else {
      plans = JSON.parse(process.env.PLANS || '[]');
    }

    let totalInserted = 0;
    let totalUpdated  = 0;

    for (const group of groups) {
      // Match group to plan by omadaProfileId
      const plan = plans.find(p => p.omadaProfileId === group.id);
      if (!plan) {
        logger.debug('No plan matched for voucher group', {
          groupName: group.name,
          groupId:   group.id,
        });
        continue;
      }

      logger.info('Syncing voucher group', {
        tenantId:    this.tenant.tenant_id,
        groupName:   group.name,
        unusedCount: group.unusedCount,
        totalCount:  group.totalCount,
      });

      // Check current DB stock — only sync if below 50
      const stockCheck = await db.query(
        `SELECT COUNT(*) as count FROM voucher_stock
         WHERE tenant_id=$1 AND plan=$2 AND status='unused'`,
        [this.tenant.tenant_id, plan.label]
      );
      const currentStock = parseInt(stockCheck.rows[0].count);

      if (currentStock >= 50) {
        logger.debug('Stock sufficient, skipping sync', {
          tenantId:     this.tenant.tenant_id,
          plan:         plan.label,
          currentStock,
        });
        continue;
      }

      logger.info('Stock low, pulling from Omada', {
        tenantId:     this.tenant.tenant_id,
        plan:         plan.label,
        currentStock,
        target:       100,
      });

      try {
        let page     = 1;
        let hasMore  = true;

        while (hasMore) {
          const vouchers = await this.getVouchersForGroup(group.id, page, 100);

          if (!vouchers.length) {
            hasMore = false;
            break;
          }

          for (const v of vouchers) {
            if (!v.code) continue;

            try {
              // status 0 = unused, 1 = in use, 2 = expired, 3 = used up
              const dbStatus = v.status === 0 ? 'unused' : 'used';

              const result = await db.query(
  `INSERT INTO voucher_stock
   (tenant_id, plan, code, omada_voucher_id, status)
   VALUES ($1,$2,$3,$4,$5)
   ON CONFLICT (code)
   DO UPDATE SET
       status = EXCLUDED.status,
       omada_voucher_id = EXCLUDED.omada_voucher_id
   RETURNING xmax = 0 AS inserted`,
  [
      this.tenant.tenant_id,
      plan.label,
      String(v.code),
      v.id || null,
      dbStatus
  ]
);

if (result.rows[0].inserted)
    totalInserted++;
else
    totalUpdated++;

            } catch (e) {
              logger.warn('Voucher insert/update failed', {
                code:  v.code,
                error: e.message,
              });
            }
          }

          // If we got less than pageSize, no more pages
          hasMore = vouchers.length === 500;
          page++;
        }

        logger.info('Group sync complete', {
          tenantId:  this.tenant.tenant_id,
          plan:      plan.label,
          inserted:  totalInserted,
          updated:   totalUpdated,
        });

      } catch (err) {
        logger.warn('Failed to sync group', {
          groupName: group.name,
          error:     err.message,
        });
      }
    }

    return { totalInserted, totalUpdated };
  }

  // ── Main createVoucher — picks from synced stock ──
  // Flow:
  // 1. Query voucher_stock for unused voucher matching plan
  // 2. Mark it as used
  // 3. Return the code to the customer
  // 4. If stock is empty, trigger immediate sync and retry once
  async createVoucher({ plan, email, reference, planConfig }) {
    const db = require('../db');

    logger.info('Getting voucher from stock', {
      tenantId: this.tenant.tenant_id,
      plan,
      email,
    });

    const pickVoucher = async () => {
      const res = await db.query(
        `SELECT id, code, omada_voucher_id
         FROM voucher_stock
         WHERE tenant_id=$1 AND plan=$2 AND status='unused'
         ORDER BY id ASC
         LIMIT 1`,
        [this.tenant.tenant_id, plan]
      );
      return res.rows[0] || null;
    };

    let voucher = await pickVoucher();

    // Stock empty — sync immediately and retry
    if (!voucher) {
      logger.warn('Stock empty, syncing from Omada now', {
        tenantId: this.tenant.tenant_id,
        plan,
      });

      await this.syncVouchersToDb(db);
      voucher = await pickVoucher();

      if (!voucher) {
        throw new Error(
          `No vouchers available for plan: ${plan}. ` +
          `Please generate more vouchers in Omada for the ${plan} group.`
        );
      }
    }

    // Mark as used
    await db.query(
      `UPDATE voucher_stock
       SET status='used', email=$1, reference=$2, assigned_at=NOW()
       WHERE id=$3`,
      [email, reference, voucher.id]
    );

    logger.info('Voucher assigned from stock', {
      tenantId:        this.tenant.tenant_id,
      code:            voucher.code,
      omadaVoucherId:  voucher.omada_voucher_id,
      plan,
    });

    return {
      code:           String(voucher.code),
      omadaVoucherId: voucher.omada_voucher_id || null,
      provider:       `omada_${this.controllerType}`,
    };
  }

  async getUsage(omadaVoucherId) {
    return null;
  }

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
      await this._getOpenApiToken();
      const groups = await this.getVoucherGroups();

      let sessionStatus = '';
      try {
        await this._getSession();
        // Test fetching vouchers for first group
        if (groups.length > 0) {
          const vouchers = await this.getVouchersForGroup(groups[0].id, 1, 5);
          sessionStatus = ` | Session auth ✅ | Sample vouchers: ${vouchers.slice(0, 3).map(v => v.code).join(', ')}`;
        } else {
          sessionStatus = ' | Session auth ✅';
        }
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