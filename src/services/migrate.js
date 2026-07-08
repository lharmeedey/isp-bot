require('dotenv').config();
const db = require('./db');

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id               SERIAL PRIMARY KEY,
      tenant_id        VARCHAR(50) UNIQUE NOT NULL,
      name             VARCHAR(100),
      email            VARCHAR(255),
      telegram_id      BIGINT,
      bot_token        VARCHAR(200) UNIQUE,
      paystack_secret  VARCHAR(200),
      paystack_public  VARCHAR(200),
      webhook_url      VARCHAR(200),
      active           BOOLEAN DEFAULT true,
      created_at       TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      telegram_id  BIGINT NOT NULL,
      tenant_id    VARCHAR(50) NOT NULL,
      email        VARCHAR(255),
      name         VARCHAR(100),
      plan         VARCHAR(50),
      remaining_gb NUMERIC(8,3) DEFAULT 0,
      total_gb     NUMERIC(8,3) DEFAULT 0,
      expiry       DATE,
      status       VARCHAR(20) DEFAULT 'inactive',
      last_sync    TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (telegram_id, tenant_id)
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id          SERIAL PRIMARY KEY,
      telegram_id BIGINT,
      tenant_id   VARCHAR(50),
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
      tenant_id   VARCHAR(50),
      email       VARCHAR(255),
      plan        VARCHAR(50),
      code        VARCHAR(20) UNIQUE,
      reference   VARCHAR(100),
      created_at  TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS admins (
      id          SERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL,
      tenant_id   VARCHAR(50) NOT NULL,
      name        VARCHAR(100),
      email       VARCHAR(255),
      role        VARCHAR(20) DEFAULT 'admin',
      added_by    BIGINT,
      active      BOOLEAN DEFAULT true,
      created_at  TIMESTAMP DEFAULT NOW(),
      UNIQUE (telegram_id, tenant_id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      telegram_id BIGINT NOT NULL,
      tenant_id   VARCHAR(50) NOT NULL,
      data        TEXT,
      updated_at  TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (telegram_id, tenant_id)
    );
  `);

  console.log('✅ Tables created/verified successfully');

  // ── Drop old incompatible tables and recreate ──
  // Only runs if old single-tenant schema exists
  const oldUsers = await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='users' AND column_name='tenant_id'
  `);

  if (!oldUsers.rows.length) {
    console.log('⚠️  Old schema detected — rebuilding tables with tenant_id...');

    await db.query(`
      DROP TABLE IF EXISTS vouchers CASCADE;
      DROP TABLE IF EXISTS purchases CASCADE;
      DROP TABLE IF EXISTS admins CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
      DROP TABLE IF EXISTS sessions CASCADE;

      CREATE TABLE users (
        telegram_id  BIGINT NOT NULL,
        tenant_id    VARCHAR(50) NOT NULL,
        email        VARCHAR(255),
        name         VARCHAR(100),
        plan         VARCHAR(50),
        remaining_gb NUMERIC(8,3) DEFAULT 0,
        total_gb     NUMERIC(8,3) DEFAULT 0,
        expiry       DATE,
        status       VARCHAR(20) DEFAULT 'inactive',
        last_sync    TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (telegram_id, tenant_id)
      );

      CREATE TABLE purchases (
        id          SERIAL PRIMARY KEY,
        telegram_id BIGINT,
        tenant_id   VARCHAR(50),
        email       VARCHAR(255),
        plan        VARCHAR(50),
        amount      NUMERIC(10,2),
        reference   VARCHAR(100) UNIQUE,
        date        TIMESTAMP DEFAULT NOW(),
        status      VARCHAR(20) DEFAULT 'success'
      );

      CREATE TABLE vouchers (
        id          SERIAL PRIMARY KEY,
        telegram_id BIGINT,
        tenant_id   VARCHAR(50),
        email       VARCHAR(255),
        plan        VARCHAR(50),
        code        VARCHAR(20) UNIQUE,
        reference   VARCHAR(100),
        created_at  TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE admins (
        id          SERIAL PRIMARY KEY,
        telegram_id BIGINT NOT NULL,
        tenant_id   VARCHAR(50) NOT NULL,
        name        VARCHAR(100),
        email       VARCHAR(255),
        role        VARCHAR(20) DEFAULT 'admin',
        added_by    BIGINT,
        active      BOOLEAN DEFAULT true,
        created_at  TIMESTAMP DEFAULT NOW(),
        UNIQUE (telegram_id, tenant_id)
      );

      CREATE TABLE sessions (
        telegram_id BIGINT NOT NULL,
        tenant_id   VARCHAR(50) NOT NULL,
        data        TEXT,
        updated_at  TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (telegram_id, tenant_id)
      );
    `);

    console.log('✅ Tables rebuilt with multi-tenant schema');
  } else {
    console.log('✅ Schema already up to date');
  }

  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});