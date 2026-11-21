const express = require("express");
const { validateAuction } = require("../lib/auction-input");
const { fields } = require("../lib/auction-state");
const { validId } = require("../lib/auction-state");
const { cancelAuction } = require("../lib/auction-deadlines");

// Factory allows HTTP tests without a real session or production database.
module.exports = function auctionRouter(
  db,
  configured = () => Boolean(process.env.DATABASE_URL),
) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (!configured())
      return res.status(503).json({
        error: "Auctions are unavailable until the database is configured.",
      });
    next();
  });
  router.get("/", async (req, res, next) => {
    try {
      const result = await db.query(
        `SELECT ${fields} FROM public.auctions WHERE status <> 'cancelled' ORDER BY created_at DESC, id DESC LIMIT 50`,
      );
      res.json({ auctions: result.rows });
    } catch (error) {
      next(error);
    }
  });
  router.get("/:id", async (req, res, next) => {
    if (
      !/^[1-9]\d{0,9}$/.test(req.params.id) ||
      Number(req.params.id) > 2147483647
    )
      return res.status(404).json({ error: "Auction not found." });
    try {
      const result = await db.query(
        `SELECT ${fields} FROM public.auctions WHERE id = $1 AND status <> 'cancelled'`,
        [req.params.id],
      );
      if (!result.rows.length)
        return res.status(404).json({ error: "Auction not found." });
      res.json({ auction: result.rows[0] });
    } catch (error) {
      next(error);
    }
  });
  router.get("/:id/manage", async (req, res, next) => {
    if (!req.session?.userId)
      return res.status(401).json({ error: "Log in to continue." });
    if (!validId(req.params.id))
      return res.status(404).json({ error: "Auction not found." });
    try {
      const r = await db.query(
        "SELECT a.seller_id=$2 AND u.verified AND a.status='active' AND a.ends_at>clock_timestamp() AND a.bid_count=0 AS can_cancel FROM auctions a JOIN users u ON u.id=$2 WHERE a.id=$1",
        [req.params.id, req.session.userId],
      );
      res.json({ canCancel: Boolean(r.rows[0]?.can_cancel) });
    } catch (error) {
      next(error);
    }
  });
  router.post("/:id/cancel", async (req, res, next) => {
    if (!req.session?.userId)
      return res.status(401).json({ error: "Log in to continue." });
    if (req.get("X-Requested-With") !== "DragonExchange")
      return res.status(403).json({ error: "Use the auction page." });
    if (!validId(req.params.id))
      return res.status(404).json({ error: "Auction not found." });
    try {
      await cancelAuction(db, req.session.userId, req.params.id);
      res.json({ ok: true });
    } catch (error) {
      if (error.status)
        return res.status(error.status).json({ error: error.message });
      next(error);
    }
  });
  router.post("/", async (req, res, next) => {
    if (!req.session?.userId)
      return res
        .status(401)
        .json({ error: "Log in before creating an auction." });
    // The form sends JSON through a custom header; cross-site forms cannot send this.
    if (
      !req.is("application/json") ||
      req.get("X-Requested-With") !== "DragonExchange"
    ) {
      return res
        .status(403)
        .json({ error: "Submit the auction using the sell form." });
    }
    const { errors, value } = validateAuction(req.body);
    if (Object.keys(errors).length)
      return res
        .status(400)
        .json({ error: "Check the auction details.", errors });
    try {
      // Derive ownership from the session and check verification inside the insert.
      const result = await db.query(
        `INSERT INTO public.auctions
        (seller_id, title, description, category, starting_price_cents, ends_at)
        SELECT id, $2, $3, $4, $5, $6::timestamptz FROM public.users
        WHERE id = $1 AND verified = true AND $6::timestamptz > now()
        RETURNING ${fields}`,
        [
          req.session.userId,
          value.title,
          value.description,
          value.category,
          value.cents,
          value.endsAt,
        ],
      );
      if (!result.rows.length)
        return res.status(403).json({
          error: "A verified account and a future deadline are required.",
        });
      res
        .status(201)
        .location("/api/auctions/" + result.rows[0].id)
        .json({ auction: result.rows[0] });
    } catch (error) {
      next(error);
    }
  });
  router.use((error, req, res, next) => {
    console.error("Auction request failed:", error.code || "database error");
    res.status(503).json({
      error: "Unable to load or save auctions. Please try again later.",
    });
  });
  return router;
};
