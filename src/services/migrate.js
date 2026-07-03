require('dotenv').config();
const db = require('./db');

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id BIGINT PRIMARY KEY,
      email       VARCHAR(255) UNIQUE NOT NULL,
      name        VARCHAR(100),
      plan        VARCHAR(50),
      remaining_gb NUMERIC(8,3) DEFAULT 0,
      total_gb     NUMERIC(8,3) DEFAULT 0,
      expiry       DATE,
      status       VARCHAR(20) DEFAULT 'inactive',
      last_sync    TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id          SERIAL PRIMARY KEY,
      telegram_id BIGINT REFERENCES users(telegram_id),
      email       VARCHAR(255),
      plan        VARCHAR(50),
      amount      NUMERIC(10,2),
      reference   VARCHAR(100) UNIQUE,
      date        TIMESTAMP DEFAULT NOW(),
      status      VARCHAR(20) DEFAULT 'success'
    );

    CREATE TABLE IF NOT EXISTS vouchers (
      id          SERIAL PRIMARY KEY,
      telegram_id BIGINT,
      email       VARCHAR(255),
      plan        VARCHAR(50),
      code        VARCHAR(20) UNIQUE,
      reference   VARCHAR(100),
      created_at  TIMESTAMP DEFAULT NOW()
    );
  `);

  console.log('✅ Database tables created successfully');
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});