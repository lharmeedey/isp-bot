const { decrypt } = require('../encryption');
const logger      = require('../logger');

const OmadaProvider    = require('./omada');
const MikrotikProvider = require('./mikrotik');
const NoneProvider     = require('./none');

// Cache provider instances per tenant to reuse token cache
const providerCache = new Map();

function getProvider(tenant) {
  const cacheKey = `${tenant.tenant_id}:${tenant.network_provider}`;

  if (providerCache.has(cacheKey)) {
    return providerCache.get(cacheKey);
  }

  // Decrypt sensitive fields
  const decryptedTenant = {
    ...tenant,
    omada_client_id:     decrypt(tenant.omada_client_id),
    omada_client_secret: decrypt(tenant.omada_client_secret),
    mikrotik_username:   decrypt(tenant.mikrotik_username),
    mikrotik_password:   decrypt(tenant.mikrotik_password),
  };

  let provider;

  switch (tenant.network_provider) {
    case 'omada':
      provider = new OmadaProvider(decryptedTenant);
      break;
    case 'mikrotik':
      provider = new MikrotikProvider(decryptedTenant);
      break;
    default:
      provider = new NoneProvider(decryptedTenant);
  }

  providerCache.set(cacheKey, provider);
  logger.info('Provider initialized', {
    tenantId: tenant.tenant_id,
    provider: tenant.network_provider || 'none',
  });

  return provider;
}

// Clear provider cache when tenant is reloaded
function clearProviderCache(tenantId) {
  for (const key of providerCache.keys()) {
    if (key.startsWith(tenantId)) {
      providerCache.delete(key);
    }
  }
}

module.exports = { getProvider, clearProviderCache };