require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

async function setupPurchases() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query(fs.readFileSync(path.join(__dirname, '../sql/purchases.sql'), 'utf8'));
    console.log('Purchase schema and indexes are ready.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { await client.end(); }
}

setupPurchases().catch(error => {
  console.error('Purchase setup failed:', error.code || '', error.message);
  process.exitCode = 1;
});
