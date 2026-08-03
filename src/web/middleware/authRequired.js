'use strict';

/**
 * authRequired — verifies the Bearer access token and attaches identity to req.
 * On success sets:
 *   req.operator = { operatorId, tenantId, role }
 *   req.tenantId = <tenantId from the token>   (the ONLY trusted tenant scope)
 *
 * Routes must always scope DB access by req.tenantId, never a client-supplied
 * tenant_id.
 */
const { verifyAccessToken } = require('../auth/jwt');

module.exports = function authRequired(req, res, next) {
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

  if (!payload.tenantId || !payload.operatorId) {
    return res.status(401).json({ error: 'Malformed token' });
  }

  req.operator = {
    operatorId: payload.operatorId,
    tenantId:   payload.tenantId,
    role:       payload.role || 'owner',
  };
  req.tenantId = payload.tenantId;
  next();
};
