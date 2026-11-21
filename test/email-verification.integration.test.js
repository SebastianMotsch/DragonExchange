// Run with npm run test:db. Regular npm test skips this database integration test.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const path = require("node:path");
const { Client } = require("pg");

test("email verification works with PostgreSQL temporary tables", {
  skip: !process.argv.includes("--database")
}, async function () {
  // Load credentials and application code only when explicitly running this test.
  require("dotenv").config({ quiet: true });
  const db = require("../db");
  const { createVerificationToken, verifyEmailToken } = require("../services/verification");

  const options = {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
    query_timeout: 5000
  };
  const client = new Client(options);
  const freshDatabase = new Client(options);
  const originalQuery = db.query;

  try {
    assert.ok(process.env.DATABASE_URL, "Configure DATABASE_URL before running this check.");
    await client.connect();
    // Match the existing users table; the upgrade must leave its columns alone.
    await client.query(`CREATE TEMP TABLE users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL CHECK (email LIKE '%@drexel.edu'),
      password_hash TEXT NOT NULL,
      name TEXT,
      verified BOOLEAN NOT NULL DEFAULT false,
      verify_code TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await client.query("SET search_path = pg_temp, public");
    const temporary = await client.query("SELECT relnamespace = pg_my_temp_schema() AS temporary FROM pg_class WHERE oid = 'users'::regclass");
    assert.equal(temporary.rows[0].temporary, true);

    const usersColumnsSql = "SELECT attname FROM pg_attribute WHERE attrelid = 'users'::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum";
    const originalColumns = await client.query(usersColumnsSql);
    // Both tables must be temporary, including the foreign key's target.
    const upgrade = readFileSync(path.join(__dirname, "../sql/upgrade-email-verification.sql"), "utf8")
      .replaceAll("CREATE TABLE IF NOT EXISTS", "CREATE TEMP TABLE IF NOT EXISTS");
    await client.query(upgrade);
    await client.query(upgrade); // The upgrade must also be safe to repeat.
    assert.deepEqual((await client.query(usersColumnsSql)).rows, originalColumns.rows);
    const verificationSecurity = await client.query("SELECT relnamespace = pg_my_temp_schema() AS temporary, relrowsecurity AS rls_enabled FROM pg_class WHERE oid = 'email_verifications'::regclass");
    assert.equal(verificationSecurity.rows[0].temporary, true);
    assert.equal(verificationSecurity.rows[0].rls_enabled, true);
    const browserAccess = await client.query("SELECT has_table_privilege('anon', 'email_verifications', 'SELECT') AS anon_read, has_table_privilege('authenticated', 'email_verifications', 'SELECT') AS authenticated_read");
    assert.deepEqual(browserAccess.rows[0], { anon_read: false, authenticated_read: false });
    db.query = client.query.bind(client);

    // These fixture accounts exist only in the temporary table.
    const accounts = await client.query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $3), ($2, $3)
       RETURNING id`,
      ["first@drexel.edu", "second@drexel.edu", "test-placeholder-hash"]
    );
    const firstId = accounts.rows[0].id;
    const secondId = accounts.rows[1].id;

    const firstToken = await createVerificationToken(firstId);
    const stored = (await client.query("SELECT token_hash, expires_at > now() AS unexpired, last_sent_at FROM email_verifications WHERE user_id = $1", [firstId])).rows[0];
    const expectedHash = createHash("sha256").update(firstToken).digest("hex");
    assert.equal(stored.token_hash, expectedHash);
    assert.notEqual(stored.token_hash, firstToken);
    assert.equal(stored.unexpired, true);
    assert.equal(stored.last_sent_at, null);
    await assert.rejects(
      client.query("INSERT INTO email_verifications (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '30 minutes')", [secondId, expectedHash]),
      { code: "23505" }
    );
    assert.equal(await verifyEmailToken(firstToken), true);
    assert.equal(await verifyEmailToken(firstToken), false);
    const otherAccount = await client.query("SELECT verified FROM users WHERE id = $1", [secondId]);
    assert.equal(otherAccount.rows[0].verified, false);
    assert.equal(await createVerificationToken(firstId), null);

    const wrongToken = "0".repeat(64);
    assert.equal(await verifyEmailToken(wrongToken), false);
    const expiredToken = await createVerificationToken(secondId);
    await client.query("UPDATE email_verifications SET expires_at = now() - interval '1 second' WHERE user_id = $1", [secondId]);
    assert.equal(await verifyEmailToken(expiredToken), false);
    const stillPending = await client.query("SELECT verified FROM users WHERE id = $1", [secondId]);
    assert.equal(stillPending.rows[0].verified, false);

    const replacedToken = await createVerificationToken(secondId);
    const replacementToken = await createVerificationToken(secondId);
    assert.notEqual(replacedToken, replacementToken);
    assert.equal(await verifyEmailToken(replacedToken), false);

    // If updating users fails, deleting the token must roll back as well.
    await client.query("ALTER TABLE pg_temp.users ADD CONSTRAINT test_block_verification CHECK (verified = false) NOT VALID");
    await assert.rejects(verifyEmailToken(replacementToken), { code: "23514" });
    const retained = await client.query("SELECT token_hash FROM email_verifications WHERE user_id = $1", [secondId]);
    assert.equal(retained.rowCount, 1);
    assert.equal(retained.rows[0].token_hash, createHash("sha256").update(replacementToken).digest("hex"));
    await client.query("ALTER TABLE pg_temp.users DROP CONSTRAINT test_block_verification");

    assert.equal(await verifyEmailToken(replacementToken), true);
    const final = await client.query("SELECT verified FROM users ORDER BY id");
    assert.equal(final.rowCount, 2);
    for (const account of final.rows) {
      assert.equal(account.verified, true);
    }
    assert.equal((await client.query("SELECT user_id FROM email_verifications")).rowCount, 0);

    // Deleting an account should also remove its pending verification record.
    const third = await client.query("INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id", ["third@drexel.edu", "test-placeholder-hash"]);
    const thirdId = third.rows[0].id;
    await createVerificationToken(thirdId);
    await client.query("DELETE FROM users WHERE id = $1", [thirdId]);
    assert.equal((await client.query("SELECT user_id FROM email_verifications WHERE user_id = $1", [thirdId])).rowCount, 0);

    // Check the fresh-install schema on a separate temporary table as well.
    await freshDatabase.connect();
    await freshDatabase.query("SET search_path = pg_temp, public");
    const schema = readFileSync(path.join(__dirname, "../sql/schema.sql"), "utf8")
      .replaceAll("CREATE TABLE IF NOT EXISTS", "CREATE TEMP TABLE IF NOT EXISTS");
    await freshDatabase.query(schema);
  } catch (error) {
    // Avoid printing connection credentials, account data, or tokens on failure.
    throw new Error("Verification database test failed: " + (error.code || error.name));
  } finally {
    db.query = originalQuery;
    await client.end().catch(() => {});
    await freshDatabase.end().catch(() => {});
    await db.end();
  }
});
