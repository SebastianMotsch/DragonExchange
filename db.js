require("dotenv").config();
const { Pool } = require("pg");

// Supabase requires SSL
module.exports = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});