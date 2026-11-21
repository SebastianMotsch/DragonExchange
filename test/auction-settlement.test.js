const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const { randomUUID } = require("node:crypto");
const { PGlite } = require("@electric-sql/pglite");
const {
  settleAuction,
  settleDueAuctions,
} = require("../lib/auction-settlement");
const poolFor = require("../scripts/pglite-pool");
let db, pool;
before(async () => {
  db = new PGlite();
  await db.exec(
    fs.readFileSync(path.join(__dirname, "../sql/schema.sql"), "utf8"),
  );
  for (const f of [
    "001_auctions.sql",
    "002_live_bidding.sql",
    "003_auction_deadlines.sql",
    "004_wallet_funding.sql",
    "005_auction_settlement.sql",
  ])
    await db.exec(
      fs.readFileSync(path.join(__dirname, "../sql/migrations", f), "utf8"),
    );
  pool = poolFor(db);
});
beforeEach(async () => {
  await db.exec("TRUNCATE users RESTART IDENTITY CASCADE");
  await db.exec(
    "INSERT INTO users(email,password_hash,verified) VALUES('seller@drexel.edu','fixture',true),('buyer@drexel.edu','fixture',true),('other@drexel.edu','fixture',true)",
  );
  await db.exec(
    "INSERT INTO wallets(user_id,balance_cents) VALUES(1,500),(2,10000),(3,10000)",
  );
});
after(async () => {
  await db.close();
});
async function fixture({ price = 1000, noBids = false, active = false } = {}) {
  const auction = (
    await pool.query(
      "INSERT INTO auctions(seller_id,title,description,category,starting_price_cents,status,created_at,ends_at) VALUES(1,'Settlement test','Temporary fixture','Books',1000,$1,clock_timestamp()-interval '2 days',clock_timestamp()+$2::interval) RETURNING id",
      [active ? "active" : "ended", active ? "1 hour" : "-1 day"],
    )
  ).rows[0];
  if (!noBids) {
    await pool.query(
      "INSERT INTO bids(auction_id,bidder_id,amount_cents,request_id,created_at) SELECT $1,2,$2,$3,ends_at-interval '1 second' FROM auctions WHERE id=$1",
      [auction.id, price, randomUUID()],
    );
    await pool.query(
      "UPDATE auctions SET current_bid_cents=$2,highest_bidder_id=2,bid_count=1 WHERE id=$1",
      [auction.id, price],
    );
    await pool.query(
      "UPDATE wallets SET reserved_cents=reserved_cents+$1 WHERE user_id=2",
      [price],
    );
  }
  await pool.query(
    "INSERT INTO auction_settlement_jobs(auction_id) VALUES($1)",
    [auction.id],
  );
  return auction.id;
}
async function wallet(id) {
  return (await pool.query("SELECT * FROM wallets WHERE user_id=$1", [id]))
    .rows[0];
}
async function count(table, id) {
  return (
    await pool.query(
      "SELECT count(*)::int AS n FROM " + table + " WHERE auction_id=$1",
      [id],
    )
  ).rows[0].n;
}
test("winner pays seller once and records sale, paired ledger entries, and event", async () => {
  const id = await fixture();
  assert.equal((await settleAuction(pool, id)).outcome, "sold");
  assert.equal((await wallet(2)).balance_cents, 9000);
  assert.equal((await wallet(2)).reserved_cents, 0);
  assert.equal((await wallet(1)).balance_cents, 1500);
  assert.equal(await count("auction_settlements", id), 1);
  assert.equal(await count("wallet_ledger", id), 2);
  assert.equal(
    (await pool.query("SELECT status FROM auctions WHERE id=$1", [id])).rows[0]
      .status,
    "settled",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT status FROM auction_settlement_jobs WHERE auction_id=$1",
        [id],
      )
    ).rows[0].status,
    "completed",
  );
  assert.equal(
    (
      await pool.query("SELECT kind FROM auction_events WHERE auction_id=$1", [
        id,
      ])
    ).rows[0].kind,
    "AUCTION_SETTLED",
  );
});
test("simultaneous settlement and repeated job execution cannot transfer twice", async () => {
  const id = await fixture();
  const results = await Promise.all([
    settleAuction(pool, id),
    settleAuction(pool, id),
  ]);
  assert.equal(results.filter((result) => result.duplicate).length, 1);
  await settleAuction(pool, id);
  await settleDueAuctions(pool);
  assert.equal((await wallet(2)).balance_cents, 9000);
  assert.equal((await wallet(1)).balance_cents, 1500);
  assert.equal(await count("wallet_ledger", id), 2);
});
test("settlement preserves the buyer funds reserved on another auction", async () => {
  const one = await fixture(),
    two = await fixture({ price: 2000, active: true });
  assert.equal((await wallet(2)).reserved_cents, 3000);
  await settleAuction(pool, one);
  assert.equal((await wallet(2)).balance_cents, 9000);
  assert.equal((await wallet(2)).reserved_cents, 2000);
  assert.equal(
    (await pool.query("SELECT status FROM auctions WHERE id=$1", [two])).rows[0]
      .status,
    "active",
  );
});
test("no-bid auctions complete without a money transfer or purchase", async () => {
  const id = await fixture({ noBids: true });
  assert.equal((await settleAuction(pool, id)).outcome, "no_bids");
  assert.equal((await wallet(1)).balance_cents, 500);
  assert.equal((await wallet(2)).balance_cents, 10000);
  assert.equal(await count("wallet_ledger", id), 0);
  assert.equal(
    (
      await pool.query(
        "SELECT outcome,amount_cents FROM auction_settlements WHERE auction_id=$1",
        [id],
      )
    ).rows[0].amount_cents,
    0,
  );
  assert.equal(
    (await pool.query("SELECT status FROM auctions WHERE id=$1", [id])).rows[0]
      .status,
    "ended",
  );
  await settleAuction(pool, id);
  assert.equal(await count("auction_settlements", id), 1);
});
test("missing held funds leave pending status and respect retry backoff", async () => {
  const id = await fixture();
  await pool.query("UPDATE wallets SET reserved_cents=0 WHERE user_id=2");
  const result = await settleAuction(pool, id);
  assert.equal(result.error, "RESERVED_FUNDS_MISSING");
  assert.equal((await wallet(1)).balance_cents, 500);
  assert.equal((await wallet(2)).balance_cents, 10000);
  assert.equal(await count("wallet_ledger", id), 0);
  assert.equal(await count("auction_settlements", id), 0);
  assert.equal((await settleDueAuctions(pool)).length, 0);
  const job = (
    await pool.query(
      "SELECT * FROM auction_settlement_jobs WHERE auction_id=$1",
      [id],
    )
  ).rows[0];
  assert.equal(job.status, "pending");
  assert.equal(job.attempts, 1);
  await pool.query("UPDATE wallets SET reserved_cents=1000 WHERE user_id=2");
  await pool.query(
    "UPDATE auction_settlement_jobs SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE auction_id=$1",
    [id],
  );
  assert.equal((await settleDueAuctions(pool))[0].status, "completed");
  assert.equal((await wallet(1)).balance_cents, 1500);
});
test("a ledger failure rolls back every sale/balance write before retry", async () => {
  const id = await fixture();
  const failing = {
    async connect() {
      const client = await pool.connect();
      return {
        release: client.release,
        query(sql, args) {
          if (sql.startsWith("INSERT INTO wallet_ledger"))
            throw new Error("Injected failure");
          return client.query(sql, args);
        },
      };
    },
  };
  assert.equal((await settleAuction(failing, id)).status, "pending");
  assert.equal((await wallet(1)).balance_cents, 500);
  assert.equal((await wallet(2)).balance_cents, 10000);
  assert.equal((await wallet(2)).reserved_cents, 1000);
  assert.equal(await count("auction_settlements", id), 0);
  assert.equal(await count("auction_events", id), 0);
  assert.equal(
    (await pool.query("SELECT status FROM auctions WHERE id=$1", [id])).rows[0]
      .status,
    "ended",
  );
  assert.equal((await settleAuction(pool, id)).status, "completed");
  assert.equal(await count("wallet_ledger", id), 2);
});
test("invalid winning account is held for review instead of charging a lower bid", async () => {
  const id = await fixture();
  await pool.query(
    "INSERT INTO bids(auction_id,bidder_id,amount_cents,request_id) VALUES($1,3,900,$2)",
    [id, randomUUID()],
  );
  await pool.query("UPDATE users SET verified=false WHERE id=2");
  assert.equal((await settleAuction(pool, id)).error, "WINNER_NOT_ELIGIBLE");
  assert.equal((await wallet(3)).balance_cents, 10000);
  assert.equal(await count("wallet_ledger", id), 0);
});
test("inconsistent winner snapshot cannot transfer funds", async () => {
  const id = await fixture();
  await pool.query("UPDATE auctions SET current_bid_cents=1100 WHERE id=$1", [
    id,
  ]);
  assert.equal((await settleAuction(pool, id)).error, "BID_STATE_MISMATCH");
  assert.equal((await wallet(1)).balance_cents, 500);
});
test("cannot settle before deadline or on a cancelled auction", async () => {
  const id = await fixture({ active: true });
  assert.equal((await settleAuction(pool, id)).error, "AUCTION_NOT_ENDED");
  assert.equal((await wallet(1)).balance_cents, 500);
  const cancelled = await fixture({ noBids: true });
  await pool.query("UPDATE auctions SET status='cancelled' WHERE id=$1", [
    cancelled,
  ]);
  assert.equal(
    (await settleAuction(pool, cancelled)).error,
    "AUCTION_NOT_ENDED",
  );
  assert.equal(await count("wallet_ledger", cancelled), 0);
});
test("balance overflow leaves funds untouched and job pending", async () => {
  const id = await fixture();
  await pool.query(
    "UPDATE wallets SET balance_cents=2147483647 WHERE user_id=1",
  );
  assert.equal((await settleAuction(pool, id)).error, "SELLER_BALANCE_LIMIT");
  assert.equal((await wallet(2)).balance_cents, 10000);
  assert.equal((await wallet(2)).reserved_cents, 1000);
});
test("sale history is scoped to the session owner and public result hides user IDs", async () => {
  const id = await fixture();
  await settleAuction(pool, id);
  const express = require("express"),
    app = express();
  app.use((req, res, next) => {
    if (req.get("Test-User"))
      req.session = { userId: Number(req.get("Test-User")) };
    next();
  });
  app.use("/history", require("../routes/auction-history")(pool));
  app.use(
    "/auctions",
    require("../routes/auctions")(pool, () => true),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    assert.equal((await fetch(base + "/history")).status, 401);
    const buyer = await (
      await fetch(base + "/history", { headers: { "Test-User": "2" } })
    ).json();
    const seller = await (
      await fetch(base + "/history", { headers: { "Test-User": "1" } })
    ).json();
    const other = await (
      await fetch(base + "/history?userId=2", { headers: { "Test-User": "3" } })
    ).json();
    assert.equal(buyer.purchases.length, 1);
    assert.equal(seller.sales.length, 1);
    assert.equal(other.purchases.length, 0);
    assert.equal(other.sales.length, 0);
    const result = await (
      await fetch(base + "/auctions/" + id + "/settlement")
    ).json();
    assert.equal(result.settlement.status, "completed");
    assert.equal(result.settlement.outcome, "sold");
    assert.equal(result.settlement.buyer_id, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test("worker startup processes settlement backlog even without newly expired auctions", async () => {
  const id = await fixture();
  const { startDeadlineWorker } = require("../lib/auction-deadlines");
  const worker = startDeadlineWorker({
    db: pool,
    intervalMs: 60000,
    afterClose: () => settleDueAuctions(pool),
  });
  try {
    await worker.run();
  } finally {
    await worker.stop();
  }
  assert.equal((await wallet(2)).balance_cents, 9000);
  assert.equal(
    (
      await pool.query(
        "SELECT status FROM auction_settlement_jobs WHERE auction_id=$1",
        [id],
      )
    ).rows[0].status,
    "completed",
  );
});
test("an after-deadline bid record is left pending for review without charging", async () => {
  const id = await fixture();
  await pool.query(
    "UPDATE bids SET created_at=clock_timestamp() WHERE auction_id=$1",
    [id],
  );
  assert.equal((await settleAuction(pool, id)).error, "BID_AFTER_DEADLINE");
  assert.equal((await wallet(2)).balance_cents, 10000);
  assert.equal(await count("wallet_ledger", id), 0);
});
