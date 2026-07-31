require('dotenv').config();
const db = require('./db');

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id                  SERIAL PRIMARY KEY,
      tenant_id           VARCHAR(50) UNIQUE NOT NULL,
      name                VARCHAR(100),
      email               VARCHAR(255),
      telegram_id         BIGINT,
      bot_token           VARCHAR(200) UNIQUE,
      paystack_secret     VARCHAR(200),
      paystack_public     VARCHAR(200),
      webhook_url         VARCHAR(200),
      network_provider    VARCHAR(20) DEFAULT 'none',
      omada_url           VARCHAR(200),
      omada_site_id       VARCHAR(100),
      omada_client_id     VARCHAR(200),
      omada_client_secret VARCHAR(200),
      mikrotik_url        VARCHAR(200),
      mikrotik_username   VARCHAR(200),
      mikrotik_password   VARCHAR(200),
      active              BOOLEAN DEFAULT true,
      created_at          TIMESTAMP DEFAULT NOW()
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
      id               SERIAL PRIMARY KEY,
      telegram_id      BIGINT,
      tenant_id        VARCHAR(50),
      email            VARCHAR(255),
      plan             VARCHAR(50),
      code             VARCHAR(50) UNIQUE,
      omada_voucher_id VARCHAR(100),
      reference        VARCHAR(100),
      status           VARCHAR(20) DEFAULT 'unused',
      created_at       TIMESTAMP DEFAULT NOW(),
      used_at          TIMESTAMP
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
        CREATE TABLE IF NOT EXISTS tenant_plans (
      id               SERIAL PRIMARY KEY,
      tenant_id        VARCHAR(50) NOT NULL,
      plan_id          INTEGER NOT NULL,
      label            VARCHAR(50) NOT NULL,
      price            NUMERIC(10,2) NOT NULL,
      gb               NUMERIC(8,3) NOT NULL,
      validity         VARCHAR(50) NOT NULL,
      omada_profile_id VARCHAR(100),
      active           BOOLEAN DEFAULT true,
      created_at       TIMESTAMP DEFAULT NOW(),
      UNIQUE (tenant_id, label)
    );
  `);

  console.log('✅ Tables created/verified');

  // ── Add new columns to existing tenants table if missing ──
  const columns = [
    { name: 'network_provider',    def: "VARCHAR(20) DEFAULT 'none'" },
    { name: 'omada_url',           def: 'VARCHAR(200)' },
    { name: 'omada_controller_id', def: 'VARCHAR(100)' },
    { name: 'omada_site_id',       def: 'VARCHAR(100)' },
    { name: 'omada_client_id',     def: 'VARCHAR(200)' },
    { name: 'omada_client_secret', def: 'VARCHAR(200)' },
    { name: 'omada_admin_username', def: 'VARCHAR(200)' },
    { name: 'omada_admin_password', def: 'VARCHAR(200)' },
    { name: 'mikrotik_url',        def: 'VARCHAR(200)' },
    { name: 'mikrotik_username',   def: 'VARCHAR(200)' },
    { name: 'mikrotik_password',   def: 'VARCHAR(200)' },
  
  ];

  

  for (const col of columns) {
    const exists = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='tenants' AND column_name=$1
    `, [col.name]);

    if (!exists.rows.length) {
      await db.query(`ALTER TABLE tenants ADD COLUMN ${col.name} ${col.def}`);
      console.log(`✅ Added column: ${col.name}`);
    }
  }

  // Add omada_voucher_id to vouchers if missing
  const voucherCol = await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='vouchers' AND column_name='omada_voucher_id'
  `);
  if (!voucherCol.rows.length) {
    await db.query(`ALTER TABLE vouchers ADD COLUMN omada_voucher_id VARCHAR(100)`);
    await db.query(`ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'unused'`);
    await db.query(`ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS used_at TIMESTAMP`);
    console.log('✅ Added omada columns to vouchers');
  }

  // Add omada_status and last_synced to voucher_stock if missing
const stockCols = [
  { name: 'omada_voucher_id', def: 'VARCHAR(100)' },
  { name: 'email', def: 'VARCHAR(255)' },
  { name: 'reference', def: 'VARCHAR(100)' },
  { name: 'assigned_at', def: 'TIMESTAMP' },
  { name: 'omada_status', def: 'INTEGER' },
  { name: 'last_synced', def: 'TIMESTAMP' },
];

  for (const col of stockCols) {
    const exists = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='voucher_stock' AND column_name=$1
    `, [col.name]);

    if (!exists.rows.length) {
      await db.query(`ALTER TABLE voucher_stock ADD COLUMN ${col.name} ${col.def}`);
      console.log(`✅ Added column voucher_stock.${col.name}`);
    }
  }

  // Add missing voucher_stock columns
const voucherStockCols = [
  { name: 'omada_voucher_id', def: 'VARCHAR(100)' },
  { name: 'email', def: 'VARCHAR(255)' },
  { name: 'reference', def: 'VARCHAR(100)' },
  { name: 'assigned_at', def: 'TIMESTAMP' }
];

for (const col of voucherStockCols) {
  const exists = await db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name='voucher_stock'
      AND column_name=$1
  `, [col.name]);

  if (!exists.rows.length) {
    await db.query(
      `ALTER TABLE voucher_stock ADD COLUMN ${col.name} ${col.def}`
    );
    console.log(`✅ Added voucher_stock.${col.name}`);
  }
}
  console.log('✅ Migration complete');
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});