const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

// Keep these HTTP tests independent of local database credentials.
process.env.DATABASE_URL = "";
process.env.SESSION_SECRET = "";

const app = require("../server");
const db = require("../db");
let server;
let baseUrl;
let databaseQueries = 0;

db.query = function () {
  databaseQueries++;
  throw new Error("Validation must not query the database.");
};

before(async function () {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = "http://127.0.0.1:" + server.address().port;
});

after(async function () {
  if (server) {
    await new Promise(function (resolve) {
      server.close(resolve);
    });
  }
  await db.end();
  assert.equal(databaseQueries, 0);
});

function validRegistration() {
  return { name: "Example Student", email: "student@drexel.edu", password: "Example123!" };
}

async function register(body) {
  const response = await fetch(baseUrl + "/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  assert.match(response.headers.get("content-type"), /application\/json/);
  return { status: response.status, body: await response.json() };
}

for (const body of [null, [], {}, true, 123, "text"]) {
  test("rejects invalid body: " + JSON.stringify(body), async function () {
    const result = await register(body);
    assert.equal(result.status, 400);
    assert.equal(typeof result.body.error, "string");
  });
}

for (const field of ["name", "email", "password"]) {
  test("requires " + field, async function () {
    const body = validRegistration();
    delete body[field];
    const result = await register(body);
    assert.equal(result.status, 400);
  });

  for (const value of [null, 123, true, [], {}]) {
    test("rejects non-text " + field + ": " + JSON.stringify(value), async function () {
      const body = validRegistration();
      body[field] = value;
      const result = await register(body);
      assert.equal(result.status, 400);
    });
  }
}

test("rejects a blank display name", async function () {
  const body = validRegistration();
  body.name = " \t ";
  const result = await register(body);
  assert.equal(result.status, 422);
  assert.match(result.body.error, /display name/);
});

const invalidEmails = [
  "", "@drexel.edu", "student", "student@example.com",
  "student@sub.drexel.edu", "student@drexel.edu.example.com",
  "student@@drexel.edu", "two words@drexel.edu",
  "student,@drexel.edu", "student<@drexel.edu", "student\nname@drexel.edu",
  "student.name@drexel.edu", "student_name@drexel.edu",
  "student-name@drexel.edu", "student+test@drexel.edu"
];

for (const email of invalidEmails) {
  test("rejects invalid email: " + JSON.stringify(email), async function () {
    const body = validRegistration();
    body.email = email;
    const result = await register(body);
    assert.equal(result.status, 422);
    assert.match(result.body.error, /Drexel/);
  });
}

const invalidPasswords = [
  ["empty", ""],
  ["short", "Abcd1!"],
  ["missing uppercase", "example123!"],
  ["missing number", "ExamplePass!"],
  ["missing special character", "Example123"],
  ["space instead of special character", "Example123 "]
];

for (const [description, password] of invalidPasswords) {
  test("rejects password: " + description, async function () {
    const body = validRegistration();
    body.password = password;
    const result = await register(body);
    assert.equal(result.status, 422);
    assert.match(result.body.error, /8 characters/);
    assert.equal(Object.hasOwn(result.body, "password"), false);
  });
}

for (const email of ["student@drexel.edu", "abc123@drexel.edu", " ABC123@DREXEL.EDU ", "12345@drexel.edu"]) {
  test("valid input reaches the unfinished account-creation step: " + email, async function () {
    const body = validRegistration();
    body.name = " Example Student ";
    body.email = email;
    const result = await register(body);
    assert.equal(result.status, 501);
    assert.deepEqual(result.body, {
      error: "Account creation is not implemented yet. Make sure to come back to this after hashing, saving the account, and triggering verification."
    });
  });
}

test("does not trim the password before validating its length", async function () {
  const body = validRegistration();
  body.password = " A1!abcd";
  const result = await register(body);
  assert.equal(result.status, 501);
});

test("rejects a missing request body", async function () {
  const response = await fetch(baseUrl + "/auth/register", { method: "POST" });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /required/);
});

test("rejects malformed JSON without echoing request contents", async function () {
  const response = await fetch(baseUrl + "/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"password":"fake-secret-that-must-not-be-returned",'
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Send a valid JSON request." });
});
