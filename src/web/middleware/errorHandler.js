'use strict';

const logger = require('../../services/logger');

/**
 * JSON error envelope for the /api mount. Any error thrown/next-ed in an API
 * route lands here as { error: <message> } with an appropriate status.
 * Never leaks stack traces to the client.
 */
// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;

  if (status >= 500) {
    logger.error('API error', {
      path:   req.path,
      method: req.method,
      error:  err.message,
      stack:  err.stack,
    });
  } else {
    logger.warn('API client error', { path: req.path, error: err.message });
  }

  if (res.headersSent) return next(err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
};
