require('dotenv').config();

const db = require('./src/services/db');

(async () => {
    try {
        const result = await db.query(`
            SELECT
                tenant_id,
                omada_url,
                omada_controller_id,
                omada_site_id,
                omada_client_id,
                omada_client_secret
            FROM tenants
        `);

        console.log(result.rows);
    } catch (err) {
        console.error(err);
    }

    process.exit();
})();