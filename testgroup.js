const axios = require("axios");

const token = "PASTE_YOUR_ACCESS_TOKEN";
const omadacId = "ae3846afd47b384710ca7c9cf4ef8011";
const siteId = "6a6393445c7bdd073c22a2ac";

axios.get(
`https://16.171.67.192:8043/openapi/v1/${omadacId}/sites/${siteId}/hotspot/voucher-groups?page=1&pageSize=10`,
{
    httpsAgent: new (require("https").Agent)({
        rejectUnauthorized:false
    }),
    headers:{
        Authorization:`AccessToken=${token}`
    }
})
.then(r=>{
    console.log(r.data);
})
.catch(e=>{
    console.log(e.response?.status);
    console.log(e.response?.data);
});