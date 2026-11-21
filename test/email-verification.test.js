const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createHash } = require("node:crypto");

process.env.DATABASE_URL = "";
process.env.SESSION_SECRET = "";

const app = require("../server");
const db = require("../db");
const { createVerificationToken } = require("../services/verification");
const originalQuery = db.query;
let server;
let baseUrl;

before(async function () {
  db.query = function () {
    throw new Error("Unexpected database query.");
  };
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = "http://127.0.0.1:" + server.address().port;
});

after(async function () {
  if (server) {
    await new Promise(function (resolve) { server.close(resolve); });
  }
  db.query = originalQuery;
});

async function verify(body) {
  const response = await fetch(baseUrl + "/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.equal(response.headers.get("set-cookie"), null);
  return { status: response.status, body: await response.json() };
}

test("creates different tokens and stores only their hashes for the selected account", async function (t) {
  const saveToken = t.mock.method(db, "query", async function () {
    return { rowCount: 1, rows: [{ id: 7 }] };
  });

  const first = await createVerificationToken(7);
  const second = await createVerificationToken(7);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.match(second, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);

  for (const [index, token] of [first, second].entries()) {
    const [sql, values] = saveToken.mock.calls[index].arguments;
    assert.equal(values[0], createHash("sha256").update(token).digest("hex"));
    assert.notEqual(values[0], token);
    assert.equal(values[1], 7);
    assert.equal(sql.includes(token), false);
  }
});

test("does not issue a token when the account is missing or already verified", async function (t) {
  t.mock.method(db, "query", async function () {
    return { rowCount: 0, rows: [] };
  });
  assert.equal(await createVerificationToken(7), null);
});

for (const body of [null, {}, { token: null }, { token: 123 }, { token: "" }, { token: "a".repeat(63) }, { token: "g".repeat(64) }]) {
  test("rejects malformed verification input: " + JSON.stringify(body), async function (t) {
    const query = t.mock.method(db, "query", async function () {
      throw new Error("Malformed input must not query the database.");
    });
    const result = await verify(body);
    assert.equal(result.status, 400);
    assert.equal(query.mock.callCount(), 0);
  });
}

test("verifies a matching token without returning the token, hash, or account details", async function (t) {
  const token = "a".repeat(64);
  const updateAccount = t.mock.method(db, "query", async function () {
    return { rowCount: 1, rows: [{ id: 7 }] };
  });

  const result = await verify({ token });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { message: "Your Drexel email has been verified." });
  const expectedHash = createHash("sha256").update(token).digest("hex");
  assert.deepEqual(updateAccount.mock.calls[0].arguments[1], [expectedHash]);
});

test("rejects an invalid, expired, or previously used token with the same feedback", async function (t) {
  t.mock.method(db, "query", async function () {
    return { rowCount: 0, rows: [] };
  });
  const result = await verify({ token: "a".repeat(64) });
  assert.equal(result.status, 400);
  assert.deepEqual(result.body, {
    error: "The verification token is invalid or expired. Request a new verification email."
  });
});

test("handles simultaneous attempts when only one database update succeeds", async function (t) {
  let used = false;
  t.mock.method(db, "query", async function () {
    if (used) return { rowCount: 0, rows: [] };
    used = true;
    return { rowCount: 1, rows: [{ id: 7 }] };
  });
  const results = await Promise.all([
    verify({ token: "a".repeat(64) }),
    verify({ token: "a".repeat(64) })
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 400]);
});

test("does not expose database errors or tokens", async function (t) {
  t.mock.method(db, "query", async function () {
    throw new Error("Private database error for " + "a".repeat(64));
  });
  const result = await verify({ token: "a".repeat(64) });
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, {
    error: "Email verification is temporarily unavailable. Please try again."
  });
});
