// Separate from the HTTP server. Run with npm run worker:auctions.
require("dotenv").config();
const db = require("../db");
const { startDeadlineWorker } = require("../lib/auction-deadlines");
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exitCode = 1;
} else {
  const worker = startDeadlineWorker({
    db,
    onRun: (count) => {
      if (count)
        console.log(
          "Ended " + count + " due auctions; settlement jobs queued.",
        );
    },
    onError: (error) =>
      console.error("Auction deadline check failed:", error.code || error.name),
  });
  console.log("Auction worker checks on startup and every 60 seconds.");
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    await worker.stop();
    await db.end();
  }
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
