const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcrypt");
const session = require("express-session");
const { PGlite } = require("@electric-sql/pglite");
const { io: client } = require("socket.io-client");
const { createApp } = require("../app");
const { createAuctionServer } = require("../lib/live-auctions");
const { placeBid } = require("../lib/bidding");
const poolFor = require("../scripts/pglite-pool");
let db,
  pool,
  server,
  io,
  base,
  cookies = {};
const sockets = [];
const root = path.join(__dirname, "..");
test("normal app does not expose the demo auth files", async () => {
  const normal = createApp({ db: pool, configured: () => false });
  const listener = normal.listen(0, "127.0.0.1");
  await new Promise(resolve => listener.once("listening", resolve));
  const address = "http://127.0.0.1:" + listener.address().port;
  try {
    assert.equal((await fetch(address + "/__demo/account.js")).status, 404);
    const loginHtml = await (await fetch(address + "/auth/login.html")).text();
    assert.doesNotMatch(loginHtml, /__demo/);
  } finally { await new Promise(resolve => listener.close(resolve)); }
});
before(async () => {
  db = new PGlite();
  await db.exec(fs.readFileSync(path.join(root, "sql/schema.sql"), "utf8"));
  for (const file of ["001_auctions.sql", "002_live_bidding.sql", "003_auction_deadlines.sql"])
    await db.exec(
      fs.readFileSync(path.join(root, "sql/migrations", file), "utf8"),
    );
  pool = poolFor(db);
  const hash = await bcrypt.hash("DemoPass123!", 4);
  for (const [name, verified] of [
    ["seller", true],
    ["buyer", true],
    ["other", true],
    ["poor", true],
    ["pending", false],
  ]) {
    await db.query(
      "INSERT INTO users(name,email,password_hash,verified) VALUES($1,$2,$3,$4)",
      [name, name + "@drexel.edu", hash, verified],
    );
  }
  await db.exec(
    "INSERT INTO wallets(user_id,balance_cents) VALUES (2,10000),(3,10000),(4,0)",
  );
  const app = createApp({
    db: pool,
    sessionStore: new session.MemoryStore(),
    sessionSecret: "test-session-secret",
    configured: () => true,
    authRouter: require("../scripts/demo-auth")(pool),
  });
  ({ server, io } = createAuctionServer(app, pool));
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = "http://127.0.0.1:" + server.address().port;
  for (const name of ["seller", "buyer", "other", "poor"])
    cookies[name] = await login(name);
});
after(async () => {
  sockets.forEach((socket) => socket.disconnect());
  if (io) await new Promise((resolve) => io.close(resolve));
  if (db) await db.close();
});
async function request(url, body, cookie, extra = {}) {
  return fetch(base + url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "DragonExchange",
      ...(cookie ? { Cookie: cookie } : {}),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function login(name) {
  const r = await request("/auth/login", {
    email: name + "@drexel.edu",
    password: "DemoPass123!",
  });
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie").split(";")[0];
}
async function create() {
  const r = await request(
    "/api/auctions",
    {
      title: "Test auction",
      description: "Description",
      category: "Books",
      startingPrice: "10.00",
      endsAt: new Date(Date.now() + 3600000).toISOString(),
    },
    cookies.seller,
  );
  assert.equal(r.status, 201);
  return (await r.json()).auction;
}
async function connect(cookie) {
  const socket = client(base, {
    transports: ["websocket"],
    extraHeaders: cookie ? { Cookie: cookie } : {},
    reconnection: false,
    timeout: 2000,
  });
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return socket;
}
async function ack(socket, event, data) {
  return socket.timeout(3000).emitWithAck(event, data);
}
const bid = (id, amount, requestId = randomUUID()) => ({
  auctionId: id,
  amount,
  requestId,
});
test("demo auth adapter supplies cookie sessions for isolated auction tests", async () => {
  const r = await request("/auth/login", {
    email: "buyer@drexel.edu",
    password: "wrong",
  });
  assert.equal(r.status, 401);
  assert.equal(
    (
      await request("/auth/login", {
        email: "pending@drexel.edu",
        password: "DemoPass123!",
      })
    ).status,
    403,
  );
  const direct = await fetch(base + "/auctions/create.html", {
    redirect: "manual",
  });
  assert.equal(direct.status, 302);
  assert.equal(
    (await request("/auctions/create.html", undefined, cookies.seller)).status,
    200,
  );
  const me = await request("/auth/me", undefined, cookies.seller);
  assert.equal((await me.json()).user.id, 1);
  assert.equal(
    (
      await request(
        "/auth/login",
        { email: "buyer@drexel.edu", password: "DemoPass123!" },
        null,
        { Origin: "https://evil.example" },
      )
    ).status,
    403,
  );
});
test("authenticated creation persists and appears in list and detail", async () => {
  const auction = await create();
  assert.equal(
    (await db.query("SELECT seller_id FROM auctions WHERE id=$1", [auction.id]))
      .rows[0].seller_id,
    1,
  );
  const list = await (await request("/api/auctions")).json();
  assert.ok(list.auctions.some((row) => row.id === auction.id));
  const detail = await (await request("/api/auctions/" + auction.id)).json();
  assert.equal(detail.auction.title, "Test auction");
});
test("WebSocket handshake rejects anonymous and foreign-origin connections", async () => {
  await assert.rejects(connect());
  const socket = client(base, {
    transports: ["websocket"],
    extraHeaders: { Cookie: cookies.buyer, Origin: "https://evil.example" },
    reconnection: false,
    timeout: 2000,
  });
  sockets.push(socket);
  await new Promise((resolve) => socket.once("connect_error", resolve));
  assert.equal(socket.connected, false);
});
test("room broadcast reaches both viewers and excludes another auction", async () => {
  const a = await create(),
    b = await create();
  const one = await connect(cookies.buyer),
    two = await connect(cookies.other),
    three = await connect(cookies.poor);
  await ack(one, "JOIN_AUCTION_ROOM", { auctionId: a.id });
  await ack(two, "JOIN_AUCTION_ROOM", { auctionId: a.id });
  await ack(three, "JOIN_AUCTION_ROOM", { auctionId: b.id });
  const seen = [[], [], []];
  [one, two, three].forEach((s, i) =>
    s.on("BID_ACCEPTED", (state) => seen[i].push(state)),
  );
  const response = await ack(one, "PLACE_BID", bid(a.id, "10.00"));
  assert.equal(response.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(
    seen.map((rows) => rows.length),
    [1, 1, 0],
  );
  assert.equal(
    (
      await db.query("SELECT amount_cents FROM bids WHERE auction_id=$1", [
        a.id,
      ])
    ).rows[0].amount_cents,
    1000,
  );
  one.disconnect();
  two.disconnect();
  three.disconnect();
});
test("duplicate bids are idempotent; changing their input is rejected", async () => {
  const a = await create(),
    data = bid(a.id, "10.00");
  const first = await placeBid(pool, 2, data),
    again = await placeBid(pool, 2, data);
  assert.equal(first.state.bid_count, 1);
  assert.equal(again.duplicate, true);
  await assert.rejects(
    placeBid(pool, 2, { ...data, amount: "11.00" }),
    (error) => error.code === "REQUEST_REUSED",
  );
});
test("outbid releases old funds; self-raise reserves only the difference", async () => {
  const a = await create();
  const initial = (
    await db.query("SELECT reserved_cents FROM wallets WHERE user_id=2")
  ).rows[0].reserved_cents;
  await placeBid(pool, 2, bid(a.id, "10.00"));
  await placeBid(pool, 2, bid(a.id, "11.00"));
  assert.equal(
    (await db.query("SELECT reserved_cents FROM wallets WHERE user_id=2"))
      .rows[0].reserved_cents,
    initial + 1100,
  );
  await placeBid(pool, 3, bid(a.id, "12.00"));
  assert.equal(
    (await db.query("SELECT reserved_cents FROM wallets WHERE user_id=2"))
      .rows[0].reserved_cents,
    initial,
  );
});
test("rejects own-auction, low, unfunded, and expired bids", async () => {
  const a = await create();
  await assert.rejects(
    placeBid(pool, 1, bid(a.id, "10.00")),
    (e) => e.code === "OWN_AUCTION",
  );
  await assert.rejects(
    placeBid(pool, 2, bid(a.id, "9.99")),
    (e) => e.code === "BID_TOO_LOW",
  );
  await assert.rejects(
    placeBid(pool, 4, bid(a.id, "10.00")),
    (e) => e.code === "INSUFFICIENT_FUNDS",
  );
  await assert.rejects(
    placeBid(pool, 5, bid(a.id, "10.00")),
    (e) => e.code === "NOT_VERIFIED",
  );
  await db.query(
    "UPDATE auctions SET created_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE id=$1",
    [a.id],
  );
  await assert.rejects(
    placeBid(pool, 2, bid(a.id, "10.00")),
    (e) => e.code === "AUCTION_ENDED",
  );
});
test("concurrent bids and multi-auction spending keep reservations within balance", async () => {
  const a = await create(),
    b = await create();
  const results = await Promise.allSettled([
    placeBid(pool, 2, bid(a.id, "60.00")),
    placeBid(pool, 2, bid(b.id, "60.00")),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.ok(
    (await db.query("SELECT * FROM wallets WHERE user_id=2")).rows.every(
      (w) => w.reserved_cents <= w.balance_cents,
    ),
  );
});
test("reconnect returns current state and logout disconnects the session", async () => {
  const a = await create(),
    cookie = await login("other");
  const socket = await connect(cookie);
  await ack(socket, "JOIN_AUCTION_ROOM", { auctionId: a.id });
  socket.disconnect();
  await placeBid(pool, 3, bid(a.id, "10.00"));
  const reconnected = await connect(cookie);
  const result = await ack(reconnected, "JOIN_AUCTION_ROOM", {
    auctionId: a.id,
  });
  assert.equal(result.state.current_bid_cents, 1000);
  const closed = new Promise((resolve) =>
    reconnected.once("disconnect", resolve),
  );
  assert.equal((await request("/auth/logout", {}, cookie)).status, 200);
  await closed;
  assert.equal((await request("/auth/me", undefined, cookie)).status, 401);
  await assert.rejects(connect(cookie));
});
test("deadline worker event reaches an authenticated viewer",async()=>{
  const auction=await create();
  const socket=await connect(cookies.seller);
  await ack(socket,"JOIN_AUCTION_ROOM",{auctionId:auction.id});
  const notification=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error("No end notification received")),5000);
    socket.once("AUCTION_ENDED",state=>{clearTimeout(timer);resolve(state);});
  });
  await pool.query("UPDATE auctions SET created_at=clock_timestamp()-interval '2 days',ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",[auction.id]);
  await require("../lib/auction-deadlines").endDueAuctions(pool);
  const {startAuctionEventRelay}=require("../lib/auction-events");
  const relay=startAuctionEventRelay(pool,io,{intervalMs:60000});
  await relay.poll();await relay.stop();
  const state=await notification;
  assert.equal(state.id,auction.id);assert.equal(state.status,"ended");
  socket.disconnect();
});
test("changing rooms while a bid is saving never broadcasts into the new room", async (t) => {
  const a = await create(),
    b = await create();
  const bidder = await connect(cookies.other),
    oldViewer = await connect(cookies.seller),
    newViewer = await connect(cookies.poor);
  await ack(bidder, "JOIN_AUCTION_ROOM", { auctionId: a.id });
  await ack(oldViewer, "JOIN_AUCTION_ROOM", { auctionId: a.id });
  await ack(newViewer, "JOIN_AUCTION_ROOM", { auctionId: b.id });
  const received = [[], []];
  oldViewer.on("BID_ACCEPTED", (state) => received[0].push(state));
  newViewer.on("BID_ACCEPTED", (state) => received[1].push(state));
  let entered, release;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const original = pool.connect.bind(pool);
  const mock = t.mock.method(pool, "connect", async () => {
    entered();
    await gate;
    return original();
  });
  try {
    const pending = ack(bidder, "PLACE_BID", bid(a.id, "10.00"));
    await waiting;
    await ack(bidder, "JOIN_AUCTION_ROOM", { auctionId: b.id });
    release();
    assert.equal((await pending).ok, true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(
      received.map((rows) => rows.length),
      [1, 0],
    );
  } finally {
    release();
    mock.mock.restore();
    bidder.disconnect();
    oldViewer.disconnect();
    newViewer.disconnect();
  }
});
