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
  // 1. Get all groups via OpenAPI (each group == one Omada profile)
  // 2. For each group, fetch all vouchers via session API
  // 3. Upsert into voucher_stock keyed by omada_profile_id
  //
  // Stock is keyed by omada_profile_id, NOT plan label — multiple plans
  // (e.g. 3GB and 5GB) may share one Omada voucher group, so a voucher
  // belongs to a profile and any plan mapped to that profile can draw from it.
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
      // Every plan that maps to this group's profile id
      const matchedPlans = plans.filter(p => p.omadaProfileId === group.id);
      if (!matchedPlans.length) {
        logger.debug('No plan matched for voucher group', {
          groupName: group.name,
          groupId:   group.id,
        });
        continue;
      }

      // Representative label for reporting (first mapped plan)
      const planLabel = matchedPlans.map(p => p.label).join('/');

      logger.info('Syncing voucher group', {
        tenantId:    this.tenant.tenant_id,
        groupName:   group.name,
        profileId:   group.id,
        plans:       planLabel,
        unusedCount: group.unusedCount,
        totalCount:  group.totalCount,
      });

      // Check current DB stock for this PROFILE — only sync if below 50
      const stockCheck = await db.query(
        `SELECT COUNT(*) as count FROM voucher_stock
         WHERE tenant_id=$1 AND omada_profile_id=$2 AND status='unused'`,
        [this.tenant.tenant_id, group.id]
      );
      const currentStock = parseInt(stockCheck.rows[0].count);

      if (currentStock >= 50) {
        logger.debug('Stock sufficient, skipping sync', {
          tenantId:    this.tenant.tenant_id,
          profileId:   group.id,
          plans:       planLabel,
          currentStock,
        });
        continue;
      }

      logger.info('Stock low, pulling from Omada', {
        tenantId:    this.tenant.tenant_id,
        profileId:   group.id,
        plans:       planLabel,
        currentStock,
        target:      100,
      });

      try {
        const pageSize = 100;
        let page       = 1;
        let hasMore    = true;

        while (hasMore) {
          const vouchers = await this.getVouchersForGroup(group.id, page, pageSize);

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
                   (tenant_id, plan, omada_profile_id, code, omada_voucher_id,
                    status, omada_status, last_synced)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
                 ON CONFLICT (tenant_id, code)
                 DO UPDATE SET
                     plan             = EXCLUDED.plan,
                     omada_profile_id = EXCLUDED.omada_profile_id,
                     omada_voucher_id = EXCLUDED.omada_voucher_id,
                     omada_status     = EXCLUDED.omada_status,
                     last_synced      = NOW(),
                     -- never revive a voucher we've already handed out
                     status = CASE
                       WHEN voucher_stock.status = 'used'
                            AND voucher_stock.reference IS NOT NULL
                       THEN 'used'
                       ELSE EXCLUDED.status
                     END
                 RETURNING xmax = 0 AS inserted`,
                [
                  this.tenant.tenant_id,
                  planLabel,
                  group.id,
                  String(v.code),
                  v.id || null,
                  dbStatus,
                  v.status ?? null,
                ]
              );

              if (result.rows[0].inserted) totalInserted++;
              else                          totalUpdated++;

            } catch (e) {
              logger.warn('Voucher insert/update failed', {
                code:  v.code,
                error: e.message,
              });
            }
          }

          // A short page means we've reached the end
          hasMore = vouchers.length === pageSize;
          page++;
        }

        logger.info('Group sync complete', {
          tenantId:  this.tenant.tenant_id,
          profileId: group.id,
          plans:     planLabel,
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

  // ── Resolve the omada_profile_id for a plan label ──
  async _profileIdForPlan(db, planLabel, planConfig) {
    if (planConfig?.omadaProfileId) return planConfig.omadaProfileId;

    const res = await db.query(
      `SELECT omada_profile_id FROM tenant_plans
       WHERE tenant_id=$1 AND label=$2 AND active=true
       LIMIT 1`,
      [this.tenant.tenant_id, planLabel]
    );
    if (res.rows[0]?.omada_profile_id) return res.rows[0].omada_profile_id;

    // Global plans fallback
    try {
      const globalPlans = JSON.parse(process.env.PLANS || '[]');
      const match = globalPlans.find(p => p.label === planLabel);
      if (match?.omadaProfileId) return match.omadaProfileId;
    } catch (_) { /* ignore */ }

    return null;
  }

  // ── Main createVoucher — picks from synced stock ──
  // Flow:
  // 1. Resolve the plan's omada_profile_id
  // 2. Atomically claim an unused voucher for that profile (row lock)
  // 3. Return the code to the customer
  // 4. If stock is empty, trigger immediate sync and retry once
  async createVoucher({ plan, email, reference, planConfig }) {
    const db = require('../db');

    const profileId = await this._profileIdForPlan(db, plan, planConfig);

    logger.info('Getting voucher from stock', {
      tenantId: this.tenant.tenant_id,
      plan,
      profileId,
      email,
    });

    // Atomically select + mark a voucher used inside one transaction so two
    // concurrent payments can never be handed the same code.
    const claimVoucher = async () => {
      const client = await db.getClient();
      try {
        await client.query('BEGIN');

        const sel = await client.query(
          `SELECT id, code, omada_voucher_id
             FROM voucher_stock
            WHERE tenant_id=$1
              AND status='unused'
              AND ($2::text IS NULL OR omada_profile_id=$2 OR plan=$3)
            ORDER BY id ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED`,
          [this.tenant.tenant_id, profileId, plan]
        );

        if (!sel.rows.length) {
          await client.query('ROLLBACK');
          return null;
        }

        const row = sel.rows[0];
        await client.query(
          `UPDATE voucher_stock
              SET status='used', email=$1, reference=$2, assigned_at=NOW()
            WHERE id=$3`,
          [email, reference, row.id]
        );

        await client.query('COMMIT');
        return row;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    };

    let voucher = await claimVoucher();

    // Stock empty — sync immediately and retry once
    if (!voucher) {
      logger.warn('Stock empty, syncing from Omada now', {
        tenantId: this.tenant.tenant_id,
        plan,
        profileId,
      });

      await this.syncVouchersToDb(db);
      voucher = await claimVoucher();

      if (!voucher) {
        throw new Error(
          `No vouchers available for plan: ${plan}. ` +
          `Please generate more vouchers in Omada for the ${plan} group.`
        );
      }
    }

    logger.info('Voucher assigned from stock', {
      tenantId:        this.tenant.tenant_id,
      code:            voucher.code,
      omadaVoucherId:  voucher.omada_voucher_id,
      plan,
      profileId,
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