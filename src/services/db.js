const { Pool } = require('pg');
const { URL } = require('url');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});




const dbUrl = new URL(process.env.DATABASE_URL);

console.log('DB Host:', dbUrl.hostname);
console.log('DB Database:', dbUrl.pathname);


module.exports = {
  query: (text, params) => pool.query(text, params),
};