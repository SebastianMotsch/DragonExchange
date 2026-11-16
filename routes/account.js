const express = require("express");

// Private account history for the logged-in student (issue #12).
// Every query uses req.session.userId. No route reads a user ID from the URL,
// query string, or body, so changing an ID in a request can't show someone else's data.
const HISTORY_LIMIT = 20;
const MAX_NAME_LENGTH = 60;

function auctionOutcome(row) {
  if (row.status === "cancelled") return "cancelled";
  if (!row.ended) return row.leading ? "leading" : "outbid";
  return row.leading ? "won" : "lost";
}

module.exports = function createAccountRouter(db) {
  const router = express.Router();

  router.use(function (req, res, next) {
    res.set("Cache-Control", "no-store");
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Log in to see your account." });
    }
    next();
  });

  router.get("/profile", async function (req, res) {
    try {
      const result = await db.query(
        "SELECT name, email, verified, created_at FROM users WHERE id = $1",
        [req.session.userId]
      );
      if (result.rows.length === 0) {
        return res.status(401).json({ error: "Log in to see your account." });
      }
      res.json({ profile: result.rows[0] });
    } catch {
      res.status(500).json({ error: "Could not load your profile. Refresh the page to try again." });
    }
  });

  // Only the display name can be edited. The email can't be changed here,
  // because a new email would need to go through verification again.
  router.patch("/profile", async function (req, res) {
    if (req.get("X-Requested-With") !== "DragonExchange") {
      return res.status(403).json({ error: "Use the profile form." });
    }
    const body = req.body || {};
    if ("email" in body || "verified" in body) {
      return res.status(400).json({ error: "Your email and verification status can't be changed here." });
    }
    if (typeof body.name !== "string" || body.name.trim() === "") {
      return res.status(422).json({ error: "Enter a display name." });
    }
    const name = body.name.trim();
    if (name.length > MAX_NAME_LENGTH) {
      return res.status(422).json({ error: "Use " + MAX_NAME_LENGTH + " characters or fewer." });
    }
    try {
      const result = await db.query(
        "UPDATE users SET name = $1 WHERE id = $2 RETURNING name, email, verified, created_at",
        [name, req.session.userId]
      );
      res.json({ profile: result.rows[0] });
    } catch {
      res.status(500).json({ error: "Could not save your name. Please try again." });
    }
  });

  // Fixed-price listings that are no longer active (sold). Active ones come from GET /listings/mine.
  router.get("/past-listings", async function (req, res) {
    try {
      const result = await db.query(
        `SELECT id, title, price_cents, status, created_at
         FROM listings
         WHERE seller_id = $1 AND type = 'regular' AND status <> 'active'
         ORDER BY created_at DESC, id DESC
         LIMIT $2`,
        [req.session.userId, HISTORY_LIMIT]
      );
      res.json({ listings: result.rows, limit: HISTORY_LIMIT });
    } catch {
      res.status(500).json({ error: "Could not load your past listings. Refresh the page to try again." });
    }
  });

  // Auctions this student is selling, with the current or winning bid.
  router.get("/auctions", async function (req, res) {
    try {
      const result = await db.query(
        `SELECT a.id, a.title, a.starting_price_cents, a.current_bid_cents, a.bid_count,
                a.ends_at, a.status, (a.status <> 'active' OR a.ends_at <= now()) AS ended,
                winner.name AS leading_bidder_name
         FROM auctions a
         LEFT JOIN users winner ON winner.id = a.highest_bidder_id
         WHERE a.seller_id = $1
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT $2`,
        [req.session.userId, HISTORY_LIMIT]
      );
      res.json({ auctions: result.rows, limit: HISTORY_LIMIT });
    } catch {
      res.status(500).json({ error: "Could not load your auctions. Refresh the page to try again." });
    }
  });

  // One row per auction this student has bid on, with their top bid and the outcome.
  router.get("/bids", async function (req, res) {
    try {
      const result = await db.query(
        `SELECT a.id AS auction_id, a.title, a.current_bid_cents, a.ends_at, a.status,
                MAX(b.amount_cents) AS my_top_bid_cents,
                COUNT(*)::int AS my_bid_count,
                MAX(b.created_at) AS last_bid_at,
                (a.highest_bidder_id = $1) AS leading,
                (a.status <> 'active' OR a.ends_at <= now()) AS ended
         FROM bids b
         JOIN auctions a ON a.id = b.auction_id
         WHERE b.bidder_id = $1
         GROUP BY a.id
         ORDER BY last_bid_at DESC
         LIMIT $2`,
        [req.session.userId, HISTORY_LIMIT]
      );
      const bids = result.rows.map(function (row) {
        return { ...row, outcome: auctionOutcome(row) };
      });
      res.json({ bids: bids, limit: HISTORY_LIMIT });
    } catch {
      res.status(500).json({ error: "Could not load your bids. Refresh the page to try again." });
    }
  });

  return router;
};
