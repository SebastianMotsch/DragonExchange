const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const bcrypt = require("bcrypt");

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

function mockAccountInsert(t) {
  return t.mock.method(db, "query", async function () {
    return { rowCount: 1, rows: [{ id: 1 }] };
  });
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
  test("creates an unverified account with normalized input: " + email, async function (t) {
    const insertAccount = mockAccountInsert(t);
    const body = validRegistration();
    body.name = " Example Student ";
    body.email = email;
    const result = await register(body);
    assert.equal(result.status, 201);
    assert.deepEqual(result.body, {
      message: "Your account was created and requires email verification before using marketplace features."
    });
    assert.equal(insertAccount.mock.callCount(), 1);
    const [sql, values] = insertAccount.mock.calls[0].arguments;
    assert.match(sql, /INSERT INTO users \(name, email, password_hash, verified\)/);
    assert.match(sql, /VALUES \(\$1, \$2, \$3, false\)/);
    assert.match(sql, /ON CONFLICT \(email\) DO NOTHING/);
    assert.match(sql, /RETURNING id/);
    assert.equal(values[0], "Example Student");
    assert.equal(values[1], email.trim().toLowerCase());
    assert.equal(await bcrypt.compare(body.password, values[2]), true);
  });
}

test("does not trim the password before validating or hashing it", async function (t) {
  mockAccountInsert(t);
  const hashPassword = t.mock.method(bcrypt, "hash");
  const body = validRegistration();
  body.password = " A1!abcd";
  const result = await register(body);
  assert.equal(result.status, 201);
  assert.equal(hashPassword.mock.callCount(), 1);
  assert.equal(hashPassword.mock.calls[0].arguments[0], body.password);
});

test("hashes passwords with cost 12 and a fresh salt without returning credentials", async function (t) {
  const insertAccount = mockAccountInsert(t);
  const hashPassword = t.mock.method(bcrypt, "hash");
  const body = validRegistration();
  const first = await register(body);
  body.email = "secondstudent@drexel.edu";
  const second = await register(body);

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(hashPassword.mock.callCount(), 2);

  const firstHash = await hashPassword.mock.calls[0].result;
  const secondHash = await hashPassword.mock.calls[1].result;
  assert.equal(insertAccount.mock.calls[0].arguments[1][2], firstHash);
  assert.equal(insertAccount.mock.calls[1].arguments[1][2], secondHash);
  assert.notEqual(firstHash, body.password);
  assert.notEqual(firstHash, secondHash);
  assert.equal(bcrypt.getRounds(firstHash), 12);
  assert.equal(bcrypt.getRounds(secondHash), 12);
  assert.equal(await bcrypt.compare(body.password, firstHash), true);
  assert.equal(await bcrypt.compare(body.password, secondHash), true);
  assert.equal(await bcrypt.compare("WrongPassword123!", firstHash), false);

  const responses = JSON.stringify([first.body, second.body]);
  assert.equal(responses.includes(body.password), false);
  assert.equal(responses.includes(firstHash), false);
  assert.equal(responses.includes(secondHash), false);
});

test("rejects invalid fields before hashing", async function (t) {
  const hashPassword = t.mock.method(bcrypt, "hash");
  for (const field of ["name", "email", "password"]) {
    const body = validRegistration();
    body[field] = "";
    const result = await register(body);
    assert.equal(result.status, 422);
  }
  assert.equal(hashPassword.mock.callCount(), 0);
});

for (const password of ["A1!" + "a".repeat(69), "A1!" + "é".repeat(34) + "a"]) {
  test("hashes a 72-byte password of " + password.length + " characters", async function (t) {
    mockAccountInsert(t);
    const hashPassword = t.mock.method(bcrypt, "hash");
    const body = validRegistration();
    body.password = password;
    assert.equal(Buffer.byteLength(password, "utf8"), 72);

    const result = await register(body);
    assert.equal(result.status, 201);
    assert.equal(hashPassword.mock.callCount(), 1);
    const passwordHash = await hashPassword.mock.calls[0].result;
    assert.equal(await bcrypt.compare(password, passwordHash), true);
  });
}

for (const password of ["A1!" + "a".repeat(70), "A1!" + "é".repeat(35)]) {
  test("rejects a 73-byte password of " + password.length + " characters before hashing", async function (t) {
    const hashPassword = t.mock.method(bcrypt, "hash");
    const body = validRegistration();
    body.password = password;
    assert.equal(Buffer.byteLength(password, "utf8"), 73);

    const result = await register(body);
    assert.equal(result.status, 422);
    assert.match(result.body.error, /72 bytes/);
    assert.equal(hashPassword.mock.callCount(), 0);
  });
}

test("returns a generic error if password hashing fails", async function (t) {
  t.mock.method(bcrypt, "hash", async function () {
    throw new Error("Internal hashing failure for Example123!");
  });

  const result = await register(validRegistration());
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, {
    error: "Registration is temporarily unavailable. Please try again."
  });
});

test("rejects a duplicate email without exposing account details", async function (t) {
  t.mock.method(db, "query", async function () {
    return { rowCount: 0, rows: [] };
  });

  const result = await register(validRegistration());
  assert.equal(result.status, 409);
  assert.deepEqual(result.body, {
    error: "We couldn't create an account with this email. If you are already registered, try logging in."
  });
});

test("repeat submissions do not replace an existing account", async function (t) {
  const accounts = new Map();
  t.mock.method(db, "query", async function (sql, values) {
    const email = values[1];
    if (accounts.has(email)) {
      return { rowCount: 0, rows: [] };
    }
    accounts.set(email, values);
    return { rowCount: 1, rows: [{ id: 1 }] };
  });

  const body = validRegistration();
  const first = await register(body);
  const savedAccount = accounts.get(body.email);
  body.name = "Replacement Name";
  body.email = " STUDENT@DREXEL.EDU ";
  body.password = "Different123!";
  const second = await register(body);

  assert.equal(first.status, 201);
  assert.equal(second.status, 409);
  assert.equal(accounts.size, 1);
  assert.equal(accounts.get("student@drexel.edu"), savedAccount);
  assert.equal(savedAccount[0], "Example Student");
  assert.equal(await bcrypt.compare("Example123!", savedAccount[2]), true);
});

test("returns a generic error if account insertion fails", async function (t) {
  t.mock.method(db, "query", async function () {
    throw new Error("Database failure involving student@drexel.edu and Example123!");
  });

  const result = await register(validRegistration());
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, {
    error: "Registration is temporarily unavailable. Please try again."
  });
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
