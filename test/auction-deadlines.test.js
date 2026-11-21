const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const { randomUUID } = require("node:crypto");
const {
  endDueAuctions,
  startDeadlineWorker,
  cancelAuction,
} = require("../lib/auction-deadlines");
const { startAuctionEventRelay } = require("../lib/auction-events");
const { placeBid } = require("../lib/bidding");
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
  ])
    await db.exec(
      fs.readFileSync(path.join(__dirname, "../sql/migrations", f), "utf8"),
    );
  pool = poolFor(db);
  await db.exec(
    "INSERT INTO users(email,password_hash,verified) VALUES('seller@drexel.edu','fixture',true),('buyer@drexel.edu','fixture',true)",
  );
  await db.exec("INSERT INTO wallets(user_id,balance_cents) VALUES(2,10000)");
});
after(async () => {
  await db.close();
});
async function auction(expired = false) {
  const r = await pool.query(
    "INSERT INTO auctions(seller_id,title,description,category,starting_price_cents,created_at,ends_at) VALUES(1,'Deadline test','Test','Books',1000,clock_timestamp()-interval '2 days',clock_timestamp()+$1::interval) RETURNING id",
    [expired ? "-1 second" : "1 hour"],
  );
  return r.rows[0].id;
}
test("startup catch-up persists ended state, one event and one settlement job", async () => {
  const id = await auction(true),
    future = await auction();
  const [first, second] = await Promise.all([
    endDueAuctions(pool),
    endDueAuctions(pool),
  ]);
  assert.equal([...first, ...second].filter((value) => value === id).length, 1);
  const state = (
    await pool.query(
      "SELECT status,version,ended_at FROM auctions WHERE id=$1",
      [id],
    )
  ).rows[0];
  assert.equal(state.status, "ended");
  assert.equal(state.version, 1);
  assert.ok(state.ended_at);
  assert.equal(
    (await pool.query("SELECT status FROM auctions WHERE id=$1", [future]))
      .rows[0].status,
    "active",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM auction_events WHERE auction_id=$1",
        [id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT status FROM auction_settlement_jobs WHERE auction_id=$1",
        [id],
      )
    ).rows[0].status,
    "pending",
  );
});
test("closing preserves reserved funds for settlement and rejects late bids", async () => {
  const id = await auction();
  await placeBid(pool, 2, {
    auctionId: id,
    amount: "10.00",
    requestId: randomUUID(),
  });
  // Admin fixture sets an already-ended state without editing a bid-on deadline.
  await pool.query("UPDATE auctions SET status='ended' WHERE id=$1", [id]);
  await assert.rejects(
    placeBid(pool, 2, {
      auctionId: id,
      amount: "11.00",
      requestId: randomUUID(),
    }),
    (e) => e.code === "AUCTION_ENDED",
  );
  assert.equal(
    (await pool.query("SELECT reserved_cents FROM wallets WHERE user_id=2"))
      .rows[0].reserved_cents,
    1000,
  );
  await assert.rejects(
    pool.query(
      "UPDATE auctions SET ends_at=ends_at+interval '1 hour' WHERE id=$1",
      [id],
    ),
    (e) => e.code === "23514",
  );
  await assert.rejects(
    pool.query("UPDATE auctions SET starting_price_cents=500 WHERE id=$1", [
      id,
    ]),
    (e) => e.code === "23514",
  );
});
test("only owner can cancel active bid-free auctions; duplicate cancellation is harmless", async () => {
  const id = await auction();
  await assert.rejects(cancelAuction(pool, 2, id), (e) => e.status === 403);
  await cancelAuction(pool, 1, id);
  await cancelAuction(pool, 1, id);
  assert.equal(
    (await pool.query("SELECT status FROM auctions WHERE id=$1", [id])).rows[0]
      .status,
    "cancelled",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM auction_events WHERE auction_id=$1",
        [id],
      )
    ).rows[0].n,
    1,
  );
  const withBid = await auction();
  await placeBid(pool, 2, {
    auctionId: withBid,
    amount: "10.00",
    requestId: randomUUID(),
  });
  await assert.rejects(
    cancelAuction(pool, 1, withBid),
    (e) => e.status === 409,
  );
  const expired = await auction(true);
  await assert.rejects(
    cancelAuction(pool, 1, expired),
    (e) => e.status === 409,
  );
});
test("event relay delivers only subscribed auctions and can recover after restart", async () => {
  const id = await auction(true),
    elsewhere = await auction(true);
  await endDueAuctions(pool);
  const sent = [];
  const io = {
    sockets: {
      adapter: { rooms: new Map([["auction:" + id, new Set(["socket"])]]) },
    },
    to: (room) => ({ emit: (kind, state) => sent.push({ room, kind, state }) }),
  };
  const relay = startAuctionEventRelay(pool, io, {
    intervalMs: 60000,
    onError: (error) => {
      throw error;
    },
  });
  await relay.poll();
  await relay.poll();
  await relay.stop();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, "AUCTION_ENDED");
  assert.equal(sent[0].state.status, "ended");
  assert.notEqual(sent[0].state.id, elsewhere);
  const restarted = startAuctionEventRelay(pool, io, { intervalMs: 60000 });
  await restarted.poll();
  await restarted.stop();
  assert.equal(sent.length, 2);
});
test("scheduler runs immediately and coalesces overlapping ticks", async () => {
  const beforeQueries = pool.connect;
  let release,
    entered,
    count = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const blocked = {
    async connect() {
      count++;
      entered();
      await gate;
      return beforeQueries();
    },
  };
  const worker = startDeadlineWorker({
    db: blocked,
    intervalMs: 60000,
    onError: (error) => {
      throw error;
    },
  });
  await started;
  const one = worker.run(),
    two = worker.run();
  assert.equal(one, two);
  assert.equal(count, 1);
  release();
  await one;
  await worker.stop();
});
test("a failed event write rolls back closure and settlement handoff", async () => {
  const id=await auction(true);
  const failing={async connect(){
    const client=await pool.connect();
    return {release:client.release,query(sql,args){
      if(sql.startsWith("INSERT INTO auction_events"))throw Object.assign(new Error("Injected event failure"),{code:"TEST_FAILURE"});
      return client.query(sql,args);
    }};
  }};
  await assert.rejects(endDueAuctions(failing));
  assert.equal((await pool.query("SELECT status FROM auctions WHERE id=$1",[id])).rows[0].status,"active");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM auction_settlement_jobs WHERE auction_id=$1",[id])).rows[0].n,0);
});
test("late bids racing the worker are rejected and closure remains idempotent",async()=>{
  const id=await auction(true);
  const result=await Promise.allSettled([placeBid(pool,2,{auctionId:id,amount:"10.00",requestId:randomUUID()}),endDueAuctions(pool)]);
  assert.equal(result[0].status,"rejected");
  assert.equal(result[0].reason.code,"AUCTION_ENDED");
  await endDueAuctions(pool);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM auction_events WHERE auction_id=$1",[id])).rows[0].n,1);
});
