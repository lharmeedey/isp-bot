require('dotenv').config();
const db = require('./db');

(async () => {
  try {
    const res = await db.query(
      `SELECT tenant_id, name, active, onboarding_step, created_via
         FROM tenants
        ORDER BY created_at DESC`
    );
    if (!res.rows.length) {
      console.log('No tenants found.');
    } else {
      console.table(res.rows);
    }
  } catch (err) {
    console.error('Query failed:', err.message);
    process.exitCode = 1;
  } finally {
    process.exit();
  }
})();
