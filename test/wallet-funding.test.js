const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const { randomUUID } = require("node:crypto");
const { PGlite } = require("@electric-sql/pglite");
const Stripe = require("stripe");
const session = require("express-session");
const { createApp } = require("../app");
const { createDeposit, creditDeposit } = require("../lib/wallet-funding");
const poolFor = require("../scripts/pglite-pool");
let db,
  pool,
  server,
  base,
  stripe,
  sessions = new Map(),
  creates = 0;
const signingSecret = "whsec_local_fixture_only";
before(async () => {
  db = new PGlite();
  await db.exec(
    fs.readFileSync(path.join(__dirname, "../sql/schema.sql"), "utf8"),
  );
  for (const f of [
    "001_auctions.sql",
    "002_live_bidding.sql",
    "004_wallet_funding.sql",
  ])
    await db.exec(
      fs.readFileSync(path.join(__dirname, "../sql/migrations", f), "utf8"),
    );
  await db.exec(
    "INSERT INTO users(email,password_hash,verified) VALUES('owner@drexel.edu','fixture',true),('other@drexel.edu','fixture',true),('pending@drexel.edu','fixture',false)",
  );
  pool = poolFor(db);
  stripe = new Stripe("sk_test_fixture_only");
  stripe.checkout.sessions.create = async (data) => {
    creates++;
    const value = {
      id: "cs_test_" + data.metadata.depositId,
      livemode: false,
      mode: "payment",
      payment_status: "unpaid",
      metadata: data.metadata,
      client_reference_id: data.client_reference_id,
      currency: "usd",
      amount_total: data.line_items[0].price_data.unit_amount,
      url: "https://checkout.stripe.com/c/pay/fixture",
    };
    sessions.set(value.id, value);
    return value;
  };
  stripe.checkout.sessions.retrieve = async (id) => sessions.get(id);
  const auth = require("express").Router();
  auth.post("/test-session", (req, res) => {
    req.session.userId = req.body.userId;
    res.json({ ok: true });
  });
  const app = createApp({
    db: pool,
    authRouter: auth,
    configured: () => true,
    sessionSecret: "funding-test-session",
    sessionStore: new session.MemoryStore(),
    fundingOptions: {
      stripe,
      webhookSecret: signingSecret,
      origin: "http://localhost:3000",
    },
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = "http://127.0.0.1:" + server.address().port;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (db) await db.close();
});
async function cookie(userId) {
  const r = await fetch(base + "/auth/test-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  return r.headers.get("set-cookie").split(";")[0];
}
async function post(url, body, sessionCookie) {
  return fetch(base + url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "DragonExchange",
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
    },
    body: JSON.stringify(body),
  });
}
async function event(
  checkout,
  { badSignature = false, live = false, id = randomUUID() } = {},
) {
  const payload = JSON.stringify({
    id,
    type: "checkout.session.completed",
    livemode: live,
    data: { object: { id: checkout.id } },
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: badSignature ? "wrong" : signingSecret,
  });
  return fetch(base + "/api/wallet/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": signature,
    },
    body: payload,
  });
}
test("checkout requires login, verification, and a bounded amount", async () => {
  const data = { amount: "10.00", requestId: randomUUID() };
  assert.equal((await post("/api/wallet/checkout", data)).status, 401);
  assert.equal(
    (await post("/api/wallet/checkout", data, await cookie(3))).status,
    403,
  );
  assert.equal(
    (
      await post(
        "/api/wallet/checkout",
        { ...data, amount: "500.01" },
        await cookie(1),
      )
    ).status,
    400,
  );
});
test("checkout retry reuses Stripe session and cannot alter amount or owner", async () => {
  const data = { amount: "10.00", requestId: randomUUID() };
  const before = creates;
  const first = await createDeposit(
    pool,
    stripe,
    1,
    data,
    "http://localhost:3000",
  );
  const second = await createDeposit(
    pool,
    stripe,
    1,
    data,
    "http://localhost:3000",
  );
  assert.equal(first.depositId, second.depositId);
  assert.equal(creates, before + 1);
  await assert.rejects(
    createDeposit(pool, stripe, 2, data, "http://localhost:3000"),
    (e) => e.status === 409,
  );
  await assert.rejects(
    createDeposit(
      pool,
      stripe,
      1,
      { ...data, amount: "11.00" },
      "http://localhost:3000",
    ),
    (e) => e.status === 409,
  );
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM wallet_ledger")).rows[0]
      .n,
    0,
  );
});
test("only signed, paid test-mode events credit once, even across duplicate event IDs", async () => {
  const result = await createDeposit(
    pool,
    stripe,
    1,
    { amount: "20.00", requestId: randomUUID() },
    "http://localhost:3000",
  );
  const checkout = [...sessions.values()].find(
    (value) => value.metadata.depositId === result.depositId,
  );
  assert.equal((await event(checkout, { badSignature: true })).status, 400);
  assert.equal((await event(checkout, { live: true })).status, 400);
  assert.equal((await event(checkout)).status, 200);
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM wallet_ledger")).rows[0]
      .n,
    0,
  );
  checkout.payment_status = "paid";
  const responses = await Promise.all([event(checkout), event(checkout)]);
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(
    (await pool.query("SELECT balance_cents FROM wallets WHERE user_id=1"))
      .rows[0].balance_cents,
    2000,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM wallet_ledger WHERE deposit_id=$1",
        [result.depositId],
      )
    ).rows[0].n,
    1,
  );
});
test("wrong totals or identities cannot credit; ledger/history are private", async () => {
  const result = await createDeposit(
    pool,
    stripe,
    1,
    { amount: "30.00", requestId: randomUUID() },
    "http://localhost:3000",
  );
  const checkout = [...sessions.values()].find(
    (value) => value.metadata.depositId === result.depositId,
  );
  checkout.payment_status = "paid";
  await assert.rejects(
    creditDeposit(pool, { ...checkout, amount_total: 1 }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    creditDeposit(pool, { ...checkout, client_reference_id: "2" }),
    (e) => e.status === 400,
  );
  assert.equal(
    (await pool.query("SELECT balance_cents FROM wallets WHERE user_id=1"))
      .rows[0].balance_cents,
    2000,
  );
  const mine = await fetch(base + "/api/wallet/deposits", {
    headers: { Cookie: await cookie(1) },
  });
  const other = await fetch(base + "/api/wallet/deposits", {
    headers: { Cookie: await cookie(2) },
  });
  assert.ok((await mine.json()).deposits.length > 0);
  assert.equal((await other.json()).deposits.length, 0);
});
test("live Stripe keys do not enable checkout", async () => {
  const { router } = require("../routes/funding").createFunding({
    db: pool,
    secretKey: "sk_live_fixture_not_real",
    webhookSecret: signingSecret,
  });
  const app = require("express")();
  app.use(require("express").json());
  app.use((req, res, next) => {
    req.session = { userId: 1 };
    next();
  });
  app.use(router);
  const listener = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => listener.once("listening", resolve));
  try {
    const r = await fetch(
      "http://127.0.0.1:" + listener.address().port + "/checkout",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "DragonExchange",
        },
        body: JSON.stringify({ amount: "10.00", requestId: randomUUID() }),
      },
    );
    assert.equal(r.status, 503);
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
});
