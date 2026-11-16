// Local-only demo with real cookie login and Socket.IO, never Supabase credentials.
const fs = require("node:fs");
const path = require("node:path");
const bcrypt = require("bcrypt");
const session = require("express-session");
const { PGlite } = require("@electric-sql/pglite");
const { createApp } = require("../app");
const { createAuctionServer } = require("../lib/live-auctions");
const poolFor = require("./pglite-pool");
async function start() {
  const db = new PGlite(),
    root = path.join(__dirname, "..");
  await db.exec(fs.readFileSync(path.join(root, "sql/schema.sql"), "utf8"));
  for (const file of ["001_auctions.sql", "002_live_bidding.sql"])
    await db.exec(
      fs.readFileSync(path.join(root, "sql/migrations", file), "utf8"),
    );
  await db.exec(fs.readFileSync(path.join(root, "sql/purchases.sql"), "utf8"));
  const hash = await bcrypt.hash("DemoPass123!", 4);
  for (const name of ["seller", "buyer", "other"])
    await db.query(
      "INSERT INTO users(name,email,password_hash,verified) VALUES($1,$2,$3,true)",
      [name, name + "@drexel.edu", hash],
    );
  await db.exec(
    "INSERT INTO wallets(user_id,balance_cents) VALUES(2,100000),(3,100000)",
  );
  const pool = poolFor(db);
  const app = createApp({
    db: pool,
    sessionStore: new session.MemoryStore(),
    sessionSecret: "local-demo-only-session-secret",
    configured: () => true,
    authRouter: require("./demo-auth")(pool),
    beforeStatic: require("./demo-pages"),
  });
  const { server, io } = createAuctionServer(app, pool);
  server.listen(3001, "127.0.0.1", () => {
    console.log("Local auction demo: http://127.0.0.1:3001");
    console.log(
      "Accounts: seller@drexel.edu, buyer@drexel.edu, other@drexel.edu",
    );
    console.log("Password for all three: DemoPass123!");
    console.log(
      "Buyers each have $1,000 in demo funds. Use separate browser profiles for separate logins.",
    );
    console.log(
      "Temporary database only; everything resets on exit. Use the seeded accounts; registration is not part of this demo.",
    );
  });
  async function stop() {
    io.close(async () => {
      await db.close();
      process.exit(0);
    });
  }
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  server.on("error", async (error) => {
    console.error(error.code || "Demo startup failed");
    await db.close();
    process.exitCode = 1;
  });
}
start().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
