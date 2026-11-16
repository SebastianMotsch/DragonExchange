// Tests for issue #12: profile and dashboard history.
// Uses an in-memory Postgres (PGlite) with the real schema, migrations, and the
// real auction, bidding, and purchase code, so the dashboard is checked after each action.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const session = require("express-session");
const { PGlite } = require("@electric-sql/pglite");
const pglitePool = require("../scripts/pglite-pool");
const { createApp } = require("../app");
const { placeBid } = require("../lib/bidding");
const createAccountRouter = require("../routes/account");

const SELLER = 1;
const BUYER = 2;
const BIDDER = 3;
const UNVERIFIED = 4;

let pg, db, server, url;
const cookies = {};

before(async () => {
  const sql = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  pg = new PGlite();
  await pg.exec(sql("sql/schema.sql"));
  await pg.exec(sql("sql/migrations/001_auctions.sql"));
  await pg.exec(sql("sql/migrations/002_live_bidding.sql"));
  await pg.exec(sql("sql/purchases.sql"));
  await pg.exec(`
    INSERT INTO users (name, email, password_hash, verified) VALUES
      ('Sam Seller', 'seller@drexel.edu', 'test-only', true),
      ('Bea Buyer', 'buyer@drexel.edu', 'test-only', true),
      ('Cal Bidder', 'bidder@drexel.edu', 'test-only', true),
      ('Una Pending', 'pending@drexel.edu', 'test-only', false);
    INSERT INTO wallets (user_id, balance_cents) VALUES (2, 100000), (3, 100000);
  `);
  db = pglitePool(pg);

  // Test-only login: sets the session the same way the real login route will.
  const testAuth = express.Router();
  testAuth.post("/test-login", (req, res) => {
    req.session.userId = req.body.userId;
    res.json({ ok: true });
  });

  const app = createApp({
    db,
    sessionStore: new session.MemoryStore(),
    sessionSecret: "test-only-secret",
    configured: () => true,
    authRouter: testAuth,
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  url = "http://127.0.0.1:" + server.address().port;

  for (const userId of [SELLER, BUYER, BIDDER, UNVERIFIED]) {
    const response = await fetch(url + "/auth/test-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    cookies[userId] = response.headers.get("set-cookie").split(";")[0];
  }
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (pg) await pg.close();
});

async function request(userId, route, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (userId) headers.Cookie = cookies[userId];
  const response = await fetch(url + route, { ...options, headers });
  const isJson = (response.headers.get("content-type") || "").includes("application/json");
  return { status: response.status, body: isJson ? await response.json() : await response.text() };
}

function bid(userId, auctionId, amount) {
  return placeBid(db, userId, { auctionId, amount, requestId: crypto.randomUUID() });
}

test("logged-out visitors can't read any account history", async () => {
  for (const route of ["/api/account/profile", "/api/account/past-listings",
    "/api/account/auctions", "/api/account/bids", "/api/wallet", "/purchases/mine"]) {
    const response = await request(null, route);
    assert.equal(response.status, 401, route);
  }
});

test("profile shows the student's own name, email, and verification status", async () => {
  const seller = await request(SELLER, "/api/account/profile");
  assert.equal(seller.status, 200);
  assert.equal(seller.body.profile.name, "Sam Seller");
  assert.equal(seller.body.profile.email, "seller@drexel.edu");
  assert.equal(seller.body.profile.verified, true);
  assert.equal(seller.body.profile.password_hash, undefined);

  const pending = await request(UNVERIFIED, "/api/account/profile");
  assert.equal(pending.body.profile.verified, false);
});

test("profile editing changes only the display name and can't bypass verification", async () => {
  const edit = (userId, body, headers = { "X-Requested-With": "DragonExchange" }) =>
    request(userId, "/api/account/profile", { method: "PATCH", headers, body: JSON.stringify(body) });

  const renamed = await edit(UNVERIFIED, { name: "  Una P.  " });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.profile.name, "Una P.");
  assert.equal(renamed.body.profile.verified, false);

  assert.equal((await edit(UNVERIFIED, { name: "Una", verified: true })).status, 400);
  assert.equal((await edit(UNVERIFIED, { name: "Una", email: "other@drexel.edu" })).status, 400);
  assert.equal((await edit(UNVERIFIED, { name: "   " })).status, 422);
  assert.equal((await edit(UNVERIFIED, { name: "x".repeat(61) })).status, 422);
  assert.equal((await edit(UNVERIFIED, { name: "Una" }, {})).status, 403);

  const stored = await db.query("SELECT name, email, verified FROM users WHERE id = $1", [UNVERIFIED]);
  assert.deepEqual(stored.rows[0], { name: "Una P.", email: "pending@drexel.edu", verified: false });
});

test("dashboard shows a listing as sold, plus the purchase and sale, after a purchase", async () => {
  const listing = await db.query(
    `INSERT INTO listings (seller_id, type, title, description, category, price_cents)
     VALUES ($1, 'regular', 'Calculus textbook', 'Lightly used.', 'Books', 4500) RETURNING id`,
    [SELLER]
  );
  const listingId = listing.rows[0].id;

  let past = await request(SELLER, "/api/account/past-listings");
  assert.equal(past.body.listings.length, 0, "active listings are not past listings");

  const purchase = await request(BUYER, "/purchases", {
    method: "POST",
    body: JSON.stringify({ listingId, expectedAmountCents: 4500 }),
  });
  assert.equal(purchase.status, 201);

  past = await request(SELLER, "/api/account/past-listings");
  assert.equal(past.body.listings.length, 1);
  assert.equal(past.body.listings[0].id, listingId);
  assert.equal(past.body.listings[0].status, "sold");

  const buyerHistory = await request(BUYER, "/purchases/mine");
  assert.equal(buyerHistory.body.purchases[0].listing_id, listingId);
  const sellerHistory = await request(SELLER, "/purchases/mine");
  assert.equal(sellerHistory.body.sales[0].listing_id, listingId);

  const buyerPast = await request(BUYER, "/api/account/past-listings");
  assert.equal(buyerPast.body.listings.length, 0, "the buyer doesn't see the seller's listings");
});

let auctionId;

test("dashboard shows a new auction, then bids, outbids, and reserved funds", async () => {
  const created = await request(SELLER, "/api/auctions", {
    method: "POST",
    headers: { "X-Requested-With": "DragonExchange" },
    body: JSON.stringify({
      title: "Desk lamp", description: "Works great.", category: "Furniture",
      startingPrice: "10.00", endsAt: new Date(Date.now() + 3600000).toISOString(),
    }),
  });
  assert.equal(created.status, 201);
  auctionId = created.body.auction.id;

  let selling = await request(SELLER, "/api/account/auctions");
  assert.equal(selling.body.auctions[0].id, auctionId);
  assert.equal(selling.body.auctions[0].current_bid_cents, null);
  assert.equal(selling.body.auctions[0].ended, false);

  await bid(BIDDER, auctionId, "20.00");
  let bids = await request(BIDDER, "/api/account/bids");
  assert.equal(bids.body.bids.length, 1);
  assert.equal(bids.body.bids[0].outcome, "leading");
  assert.equal(bids.body.bids[0].my_top_bid_cents, 2000);
  let wallet = await request(BIDDER, "/api/wallet");
  assert.equal(wallet.body.wallet.reserved_cents, 2000);
  assert.equal(wallet.body.wallet.available_cents, 98000);

  await bid(BUYER, auctionId, "25.00");
  bids = await request(BIDDER, "/api/account/bids");
  assert.equal(bids.body.bids[0].outcome, "outbid");
  assert.equal(bids.body.bids[0].current_bid_cents, 2500);
  wallet = await request(BIDDER, "/api/wallet");
  assert.equal(wallet.body.wallet.reserved_cents, 0, "being outbid releases the hold");

  const buyerBids = await request(BUYER, "/api/account/bids");
  assert.equal(buyerBids.body.bids[0].outcome, "leading");

  selling = await request(SELLER, "/api/account/auctions");
  assert.equal(selling.body.auctions[0].current_bid_cents, 2500);
  assert.equal(selling.body.auctions[0].bid_count, 2);
  assert.equal(selling.body.auctions[0].leading_bidder_name, "Bea Buyer");

  const sellerBids = await request(SELLER, "/api/account/bids");
  assert.equal(sellerBids.body.bids.length, 0, "the seller placed no bids");
});

test("dashboard shows auction outcomes after the auction ends and settles", async () => {
  await db.query(
    "UPDATE auctions SET created_at = now() - interval '2 hours', ends_at = now() - interval '1 minute' WHERE id = $1",
    [auctionId]
  );
  let winner = await request(BUYER, "/api/account/bids");
  assert.equal(winner.body.bids[0].outcome, "won");
  const loser = await request(BIDDER, "/api/account/bids");
  assert.equal(loser.body.bids[0].outcome, "lost");
  const selling = await request(SELLER, "/api/account/auctions");
  assert.equal(selling.body.auctions[0].ended, true);

  // Settlement (#11) isn't built yet; this checks the dashboard reads a settled auction correctly.
  await db.query("UPDATE auctions SET status = 'settled' WHERE id = $1", [auctionId]);
  winner = await request(BUYER, "/api/account/bids");
  assert.equal(winner.body.bids[0].outcome, "won");
});

test("changing an ID in the request can't show another student's history", async () => {
  const tries = [
    "/api/account/bids?userId=" + BUYER,
    "/api/account/bids?bidder_id=" + BUYER,
    "/api/account/profile?id=" + BUYER,
    "/api/account/past-listings?seller_id=" + SELLER,
    "/api/account/auctions?userId=" + SELLER,
  ];
  for (const route of tries) {
    const response = await request(BIDDER, route);
    assert.equal(response.status, 200, route);
    const text = JSON.stringify(response.body);
    assert.ok(!text.includes("buyer@drexel.edu"), route);
    assert.ok(!text.includes("Calculus textbook"), route);
  }
  const bids = await request(BIDDER, "/api/account/bids?userId=" + BUYER);
  assert.equal(bids.body.bids[0].my_top_bid_cents, 2000, "still the bidder's own top bid");
  assert.equal((await request(BIDDER, "/api/account/bids/" + BUYER)).status, 404);
});

test("history queries are bounded", async () => {
  for (let i = 0; i < 25; i++) {
    await db.query(
      `INSERT INTO listings (seller_id, type, title, description, category, price_cents, status)
       VALUES ($1, 'regular', $2, 'Old item.', 'Other', 100, 'sold')`,
      [UNVERIFIED, "Old item " + i]
    );
  }
  const past = await request(UNVERIFIED, "/api/account/past-listings");
  assert.equal(past.body.listings.length, 20);
  assert.equal(past.body.limit, 20);
  assert.equal(past.body.listings[0].title, "Old item 24", "newest first");
});

test("database errors return a friendly JSON error without details", async () => {
  const brokenDb = { query: async () => { throw new Error("secret connection details"); } };
  const app = express();
  app.use((req, res, next) => { req.session = { userId: 1 }; next(); });
  app.use("/api/account", createAccountRouter(brokenDb));
  const broken = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => broken.once("listening", resolve));
  try {
    for (const route of ["profile", "past-listings", "auctions", "bids"]) {
      const response = await fetch("http://127.0.0.1:" + broken.address().port + "/api/account/" + route);
      const body = await response.json();
      assert.equal(response.status, 500, route);
      assert.ok(body.error, route);
      assert.ok(!JSON.stringify(body).includes("secret"), route);
    }
  } finally {
    await new Promise((resolve) => broken.close(resolve));
  }
});
