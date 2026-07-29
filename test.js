const OmadaProvider = require('./providers/OmadaProvider'); // adjust path if needed

const tenant = {
    tenant_id: 1,
    omada_url: 'https://16.171.67.192:8043',
    omada_controller_id: 'ae3846afd47b384710ca7c9cf4ef8011',
    omada_site_id: '6a6393445c7bdd073c22a2ac',

    // Your real values
    omada_client_id: '303276c0206c48348435d0b978f1e528',
    omada_client_secret: '11eac7ad5de24e74a74c1039db851e04',

    omada_controller_type: 'software'
};

(async () => {
    try {
        const omada = new OmadaProvider(tenant);

        const result = await omada.testConnection();

        console.log(result);

    } catch (err) {
        console.error(err);
    }
})();