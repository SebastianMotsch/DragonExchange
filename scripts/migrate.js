require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const db = require("../db");
(async () => {
  let client;
  try {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
    client = await db.connect();
    for (const filename of [
      "001_auctions.sql",
      "002_live_bidding.sql",
      "003_auction_deadlines.sql",
      "004_wallet_funding.sql",
    ]) {
      await client.query(
        fs.readFileSync(
          path.join(__dirname, "../sql/migrations", filename),
          "utf8",
        ),
      );
      console.log("Applied " + filename);
    }
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Migration failed:", error.code || error.message);
    process.exitCode = 1;
  } finally {
    if (client) client.release();
    await db.end();
  }
})();
