const axios = require("axios");
const https = require("https");

const CONTROLLER_URL = "https://16.171.67.192:8043";
const OMADAC_ID      = "ae3846afd47b384710ca7c9cf4ef8011";
const SITE_ID        = "6a6393445c7bdd073c22a2ac";
const CLIENT_ID      = "303276c0206c48348435d0b978f1e528";
const CLIENT_SECRET  = "11eac7ad5de24e74a74c1039db851e04";

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function getToken() {
  console.log("1️⃣  Getting access token...");
  const res = await axios.post(
    `${CONTROLLER_URL}/openapi/authorize/token?grant_type=client_credentials`,
    { omadacId: OMADAC_ID, client_id: CLIENT_ID, client_secret: CLIENT_SECRET },
    { httpsAgent, headers: { "Content-Type": "application/json" } }
  );
  if (res.data.errorCode !== 0) throw new Error(JSON.stringify(res.data));
  console.log("✅ Token acquired\n");
  return res.data.result.accessToken;
}

async function getVoucherGroups(token) {
  console.log("2️⃣  Fetching voucher groups...");
  const res = await axios.get(
    `${CONTROLLER_URL}/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/hotspot/voucher-groups?page=1&pageSize=100`,
    { httpsAgent, headers: { Authorization: `AccessToken=${token}` } }
  );
  if (res.data.errorCode !== 0) throw new Error(JSON.stringify(res.data));
  console.log("✅ Voucher groups:\n");
  for (const g of res.data.result.data) {
    console.log(`  ${g.name} → ${g.id} (unused: ${g.unusedCount})`);
  }
  return res.data.result.data;
}

async function listVouchers(token) {
  console.log("\n3️⃣  Listing existing vouchers...");
  const res = await axios.get(
    `${CONTROLLER_URL}/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/hotspot/vouchers?page=1&pageSize=10`,
    { httpsAgent, headers: { Authorization: `AccessToken=${token}` } }
  );
  console.log("Vouchers response:", JSON.stringify(res.data, null, 2));
  return res.data;
}

async function createVoucher(token, groupId) {
  console.log("\n4️⃣  Attempting to create a voucher...");
  const res = await axios.post(
    `${CONTROLLER_URL}/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/hotspot/vouchers`,
    { voucherGroupId: groupId, amount: 1 },
    { httpsAgent, headers: { Authorization: `AccessToken=${token}`, "Content-Type": "application/json" } }
  );
  console.log("Create voucher response:", JSON.stringify(res.data, null, 2));
}

async function main() {
  try {
    const token  = await getToken();
    const groups = await getVoucherGroups(token);

    await listVouchers(token);

    const group = groups.find(g => g.name === "5GB Plan");
    if (group) {
      await createVoucher(token, group.id);
    } else {
      console.log("\n⚠️  5GB Plan group not found — skipping voucher creation test");
      }

  } catch (err) {
    console.error("\n❌ ERROR:", err.response?.data || err.message);
  }
}

main();