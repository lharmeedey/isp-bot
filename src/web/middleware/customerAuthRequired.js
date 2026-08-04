'use strict';

/**
 * customerAuthRequired — verifies the Bearer access token for a STOREFRONT
 * customer and attaches identity to req. On success sets:
 *   req.customer = { customerId, tenantId }
 *   req.tenantId = <tenantId from the token>   (the ONLY trusted tenant scope)
 *
 * Storefront routes must always scope DB access by req.tenantId from the token,
 * never the :tenantId in the URL. The customer token carries `kind: 'customer'`
 * so an operator access token can never satisfy a customer-only route.
 */
const { verifyAccessToken } = require('../auth/jwt');

module.exports = function customerAuthRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  if (payload.kind !== 'customer' || !payload.tenantId || !payload.customerId) {
    return res.status(401).json({ error: 'Malformed token' });
  }

  req.customer = {
    customerId: payload.customerId,
    tenantId:   payload.tenantId,
  };
  req.tenantId = payload.tenantId;
  next();
};
