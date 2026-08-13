const { Pool } = require('pg');
const logger   = require('./logger');

const pool = new Pool({
  connectionString:        process.env.DATABASE_URL,
  ssl:                     { rejectUnauthorized: false },
  max:                     20,
  idleTimeoutMillis:       30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  logger.error('Unexpected DB pool error', { error: err.message });
});

pool.on('connect', () => {
  logger.debug('New DB connection established');
});

// Wrap query with logging
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      logger.warn('Slow query detected', { duration, text: text.slice(0, 100) });
    }
    return result;
  } catch (err) {
    logger.error('Query error', { error: err.message, text: text.slice(0, 100) });
    throw err;
  }
}

// Get a client for transactions
async function getClient() {
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  const start = Date.now();

  // Monkey-patch to add timeout warning
  client.query = (...args) => {
    if (Date.now() - start > 5000) {
      logger.warn('Transaction client checked out for too long');
    }
    return originalQuery(...args);
  };

  return client;
}

module.exports = { query, getClient };