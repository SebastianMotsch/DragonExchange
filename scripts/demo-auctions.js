// Local-only demo with real cookie login and Socket.IO, never Supabase credentials.
const fs = require("node:fs");
const path = require("node:path");
const withFunding = process.argv.includes("--funding");
const demoConfig = withFunding
  ? require("dotenv").parse(fs.readFileSync(path.join(__dirname, "../.env")))
  : {};
// Even with sandbox funding, never connect this demo to the shared database.
process.env.DATABASE_URL = "";
process.env.APP_ORIGIN = "http://127.0.0.1:3001";
const bcrypt = require("bcrypt");
const session = require("express-session");
const { PGlite } = require("@electric-sql/pglite");
const { createApp } = require("../app");
const { createAuctionServer } = require("../lib/live-auctions");
const poolFor = require("./pglite-pool");
const { startDeadlineWorker } = require("../lib/auction-deadlines");
async function start() {
  if (withFunding && (!/^sk_test_/.test(demoConfig.STRIPE_SECRET_KEY || "") || !demoConfig.STRIPE_WEBHOOK_SECRET)) {
    throw new Error("Set the Stripe test key and run npm run stripe:listen:demo first.");
  }
  const db = new PGlite(),
    root = path.join(__dirname, "..");
  await db.exec(fs.readFileSync(path.join(root, "sql/schema.sql"), "utf8"));
  for (const file of [
    "001_auctions.sql",
    "002_live_bidding.sql",
    "003_auction_deadlines.sql",
    "004_wallet_funding.sql",
    "005_auction_settlement.sql",
  ])
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
    fundingOptions: {
      secretKey: demoConfig.STRIPE_SECRET_KEY || "",
      webhookSecret: demoConfig.STRIPE_WEBHOOK_SECRET || "",
      origin: "http://127.0.0.1:3001",
    },
  });
  const { server, io } = createAuctionServer(app, pool);
  const worker = startDeadlineWorker({
    db: pool,
    afterClose:()=>require("../lib/auction-settlement").settleDueAuctions(pool),
    onError: (error) => console.error("Demo worker:", error.code || error.name),
  });
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
    if(withFunding) console.log("Stripe sandbox funding enabled; credits affect only this temporary database.");
  });
  async function stop() {
    await worker.stop();
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
