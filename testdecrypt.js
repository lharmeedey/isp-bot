require('dotenv').config();
const { decrypt } = require('./src/services/encryption');

// Paste your actual encrypted omada_client_id from the DB here
const encryptedClientId = 'PASTE_ENCRYPTED_VALUE_HERE';

console.log('Decrypted:', decrypt(encryptedClientId));
console.log('ENCRYPTION_KEY set:', !!process.env.ENCRYPTION_KEY);
console.log('Key preview:', process.env.ENCRYPTION_KEY?.slice(0, 10));