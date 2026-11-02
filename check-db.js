// Checks the Supabase setup. Run from the project folder: node check-db.js
const db = require("./db"); // also loads .env

const ok = (pass, msg) => console.log(`${pass ? "PASS" : "FAIL"}  ${msg}`);

(async () => {
  ok(!!process.env.DATABASE_URL, "DATABASE_URL is set in .env");
  ok(!!process.env.SESSION_SECRET, "SESSION_SECRET is set in .env");
  if (!process.env.DATABASE_URL) return;

  try {
    const { rows: [t] } = await db.query("SELECT now()");
    ok(true, `Connected to Supabase (database time ${t.now.toISOString()})`);

    const { rows } = await db.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    );
    const tables = rows.map((r) => r.table_name);
    console.log(`      Tables found: ${tables.join(", ") || "(none)"}`);

    if (!tables.includes("users")) {
      ok(false, "users table exists (run sql/schema.sql in the Supabase SQL Editor)");
      return;
    }
    ok(true, "users table exists");

    // Write a test row, read it back, then delete it
    const email = `conncheck${Date.now()}@drexel.edu`;
    const { rows: [inserted] } = await db.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, 'test') RETURNING id",
      [email]
    );
    const { rows: found } = await db.query("SELECT email FROM users WHERE id = $1", [inserted.id]);
    await db.query("DELETE FROM users WHERE id = $1", [inserted.id]);
    ok(found[0]?.email === email, "Wrote, read and deleted a test user");
  } catch (err) {
    ok(false, `Database error: ${err.message}`);
  } finally {
    await db.end();
  }
})();