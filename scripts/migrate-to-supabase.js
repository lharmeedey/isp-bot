#!/usr/bin/env node
/**
 * migrate-to-supabase.js — copy all data from the current (Render) Postgres to
 * a new Supabase Postgres, using the app's existing `pg` driver. No psql /
 * pg_dump required.
 *
 * SAFETY MODEL
 *   • READS only from SOURCE (Render). WRITES only to TARGET (Supabase).
 *     The source is never modified, so Render stays the authoritative live DB
 *     until you flip DATABASE_URL yourself.
 *   • Idempotent: every table is copied with INSERT ... ON CONFLICT DO UPDATE
 *     on its primary key. Run it as many times as you like — the last run wins.
 *     This is what makes the "copy live, cut over later" flow safe: do a bulk
 *     run now, verify, then a final catch-up run immediately before cutover.
 *   • Copies id values verbatim (so operator_id / customer_id references stay
 *     valid), then resets each SERIAL sequence past MAX(id) so future inserts
 *     on Supabase don't collide.
 *
 * CONNECTION STRINGS  (put these in .env — they are gitignored, never printed)
 *   SOURCE_DATABASE_URL   Render EXTERNAL connection string (not the Internal
 *                         one — Internal only resolves inside Render).
 *   TARGET_DATABASE_URL   Supabase **Session pooler** URI (host
 *                         aws-*.pooler.supabase.com, port 5432, user
 *                         postgres.<ref>). Use the pooler, NOT "Direct
 *                         connection": Render/most hosts are IPv4 and the
 *                         direct endpoint is IPv6-only.
 *
 * USAGE
 *   node scripts/migrate-to-supabase.js               # schema + data + verify
 *   node scripts/migrate-to-supabase.js --skip-schema # data + verify only
 *   node scripts/migrate-to-supabase.js --schema-only # build schema, no data
 *   node scripts/migrate-to-supabase.js --verify-only # just compare row counts
 *   node scripts/migrate-to-supabase.js --skip=sessions,otp_codes
 */
require('dotenv').config();
const { Pool } = require('pg');
const { spawnSync } = require('child_process');
const path = require('path');

const SOURCE = process.env.SOURCE_DATABASE_URL;
const TARGET = process.env.TARGET_DATABASE_URL;

const args        = process.argv.slice(2);
const SKIP_SCHEMA = args.includes('--skip-schema') || args.includes('--verify-only') || args.includes('--data-only');
const SCHEMA_ONLY = args.includes('--schema-only');
const VERIFY_ONLY = args.includes('--verify-only');
const SKIP_TABLES = (args.find((a) => a.startsWith('--skip=')) || '').replace('--skip=', '')
  .split(',').map((s) => s.trim()).filter(Boolean);

// Parent-first ordering (cosmetic — the schema has no FK constraints, but this
// keeps output readable and is correct if any FKs are ever added).
const ORDER = [
  'tenants', 'operators', 'customers', 'admins', 'tenant_plans',
  'users', 'purchases', 'vouchers', 'voucher_stock', 'sessions',
  'refresh_tokens', 'customer_refresh_tokens', 'otp_codes', 'renewal_reminders',
];

const BATCH = 500;               // rows per multi-row INSERT (well under pg's 65535 param cap)
const SSL   = { rejectUnauthorized: false };

function die(msg) { console.error(`\n❌ ${msg}\n`); process.exit(1); }
function hostOf(url) { try { const u = new URL(url); return `${u.hostname}${u.pathname}`; } catch { return '(unparseable url)'; } }

if (!SOURCE || !TARGET) {
  die('Set SOURCE_DATABASE_URL and TARGET_DATABASE_URL in .env first.\n' +
      '   SOURCE_DATABASE_URL = Render External connection string\n' +
      '   TARGET_DATABASE_URL = Supabase Session pooler URI (port 5432)');
}
if (SOURCE === TARGET) die('SOURCE and TARGET are identical — refusing to run.');

const source = new Pool({ connectionString: SOURCE, ssl: SSL, max: 5 });
const target = new Pool({ connectionString: TARGET, ssl: SSL, max: 5 });

async function columnsOf(pool, table) {
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1
      ORDER BY ordinal_position`, [table]);
  return rows.map((r) => r.column_name);
}

async function pkOf(pool, table) {
  const { rows } = await pool.query(
    `SELECT a.attname
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = to_regclass('public.' || quote_ident($1)) AND i.indisprimary`, [table]);
  return rows.map((r) => r.attname);
}

async function tablesOf(pool) {
  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE'`);
  const names = rows.map((r) => r.table_name);
  return names.sort((a, b) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b);
  });
}

async function count(pool, table) {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM "${table}"`);
  return rows[0].n;
}

// Build one batched upsert statement for `rows` (array of row objects) into `table`.
function buildUpsert(table, cols, pk, rows) {
  const quoted = cols.map((c) => `"${c}"`).join(', ');
  const tuples = [];
  const values = [];
  let p = 1;
  for (const row of rows) {
    const ph = cols.map(() => `$${p++}`);
    tuples.push(`(${ph.join(', ')})`);
    for (const c of cols) values.push(row[c]);
  }
  let conflict;
  if (pk.length) {
    const nonPk = cols.filter((c) => !pk.includes(c));
    conflict = nonPk.length
      ? `ON CONFLICT (${pk.map((c) => `"${c}"`).join(', ')}) DO UPDATE SET ` +
        nonPk.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')
      : `ON CONFLICT (${pk.map((c) => `"${c}"`).join(', ')}) DO NOTHING`;
  } else {
    conflict = 'ON CONFLICT DO NOTHING';
  }
  return { text: `INSERT INTO "${table}" (${quoted}) VALUES ${tuples.join(', ')} ${conflict}`, values };
}

async function copyTable(table) {
  const srcCols = await columnsOf(source, table);
  const tgtCols = await columnsOf(target, table);
  if (!tgtCols.length) { console.log(`   ⚠ ${table}: not present on target — skipping`); return; }
  // Only copy columns that exist on BOTH sides (guards against schema drift).
  const cols = srcCols.filter((c) => tgtCols.includes(c));
  const dropped = srcCols.filter((c) => !tgtCols.includes(c));
  if (dropped.length) console.log(`   ⚠ ${table}: target missing columns [${dropped.join(', ')}] — not copied`);

  const pk = await pkOf(target, table);
  const { rows } = await source.query(`SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM "${table}"`);
  if (!rows.length) { console.log(`   • ${table}: 0 rows`); return; }

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { text, values } = buildUpsert(table, cols, pk, batch);
    await target.query(text, values);
  }
  console.log(`   ✔ ${table}: ${rows.length} rows upserted (pk: ${pk.join(',') || 'none'})`);
}

async function resetSequences(table) {
  const cols = await columnsOf(target, table);
  for (const col of cols) {
    const { rows } = await target.query(
      `SELECT pg_get_serial_sequence('public."${table}"', $1) AS seq`, [col]);
    const seq = rows[0].seq;
    if (!seq) continue;
    await target.query(
      `SELECT setval('${seq}',
                     (SELECT COALESCE(MAX("${col}"), 0) FROM "${table}"),
                     (SELECT COUNT(*) FROM "${table}") > 0)`);
    console.log(`   ↻ ${table}.${col} sequence reset`);
  }
}

async function main() {
  console.log('\n🔎 Connectivity check');
  const [sv, tv] = await Promise.all([
    source.query('SELECT version()'),
    target.query('SELECT version()'),
  ]);
  console.log(`   SOURCE ${hostOf(SOURCE)}  →  ${sv.rows[0].version.split(',')[0]}`);
  console.log(`   TARGET ${hostOf(TARGET)}  →  ${tv.rows[0].version.split(',')[0]}`);

  // 1. Schema — reuse the app's own migrate.js against the target, untouched.
  if (!SKIP_SCHEMA && !VERIFY_ONLY) {
    console.log('\n🏗  Building schema on target (running src/services/migrate.js against TARGET)');
    const res = spawnSync(process.execPath, [path.join('src', 'services', 'migrate.js')], {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: TARGET },   // dotenv won't override an already-set env var
    });
    if (res.status !== 0) die('Schema build failed on target — see output above.');
  }
  if (SCHEMA_ONLY) { console.log('\n✅ Schema-only run complete.'); return; }

  const tables = (await tablesOf(source)).filter((t) => !SKIP_TABLES.includes(t));
  if (SKIP_TABLES.length) console.log(`\n(skipping: ${SKIP_TABLES.join(', ')})`);

  // 2. Data
  if (!VERIFY_ONLY) {
    console.log('\n📦 Copying data (idempotent upsert)');
    for (const t of tables) await copyTable(t);

    console.log('\n🔧 Resetting SERIAL sequences');
    for (const t of tables) await resetSequences(t);
  }

  // 3. Verify row counts match
  console.log('\n📊 Verification (source vs target row counts)');
  let mismatch = 0;
  console.log('   ' + 'table'.padEnd(26) + 'source'.padStart(9) + 'target'.padStart(9) + '   status');
  for (const t of tables) {
    const [s, d] = await Promise.all([count(source, t), count(target, t)]);
    const ok = d >= s;   // target >= source (target may hold extra: prior runs, deleted-on-source rows)
    if (!ok) mismatch++;
    const status = d === s ? 'OK' : d > s ? `OK (+${d - s} extra on target)` : `⚠ MISSING ${s - d}`;
    console.log('   ' + t.padEnd(26) + String(s).padStart(9) + String(d).padStart(9) + '   ' + status);
  }

  console.log(mismatch
    ? `\n⚠ ${mismatch} table(s) have FEWER rows on target than source — investigate before cutover.`
    : '\n✅ All tables present on target with >= source row counts.');
  console.log('\nNote: this copies inserts + updates. Hard DELETEs on the source between runs are');
  console.log('not propagated (target keeps the row). For this schema that only affects transient');
  console.log('token/session rows, never payments or vouchers.\n');
}

main()
  .catch((err) => { console.error('\n❌ Migration error:', err.message); process.exitCode = 1; })
  .finally(async () => { await source.end().catch(() => {}); await target.end().catch(() => {}); });
