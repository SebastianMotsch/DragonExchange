const express = require("express");
const Stripe = require("stripe");
const { rateLimit } = require("express-rate-limit");
const { createDeposit, creditDeposit } = require("../lib/wallet-funding");
function createFunding({
  db,
  stripe,
  secretKey = process.env.STRIPE_SECRET_KEY,
  webhookSecret = process.env.STRIPE_WEBHOOK_SECRET,
  origin = process.env.APP_ORIGIN ||
    "http://localhost:" + (process.env.PORT || 3000),
}) {
  // No live key can accidentally turn this class-project flow into real charges.
  const client =
    stripe ||
    (/^sk_test_/.test(secretKey || "") ? new Stripe(secretKey) : null);
  const router = express.Router();
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.get("/deposits", async (req, res) => {
    if (!req.session?.userId)
      return res.status(401).json({ error: "Log in to view deposits." });
    try {
      const r = await db.query(
        "SELECT id,amount_cents,currency,status,created_at,credited_at FROM wallet_deposits WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20",
        [req.session.userId],
      );
      res.json({
        deposits: r.rows,
        fundingAvailable: Boolean(client && webhookSecret),
      });
    } catch {
      res.status(503).json({ error: "Deposit history is unavailable." });
    }
  });
  router.post(
    "/checkout",
    rateLimit({
      windowMs: 60000,
      limit: 10,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Too many checkout requests. Try again in a minute." },
    }),
    async (req, res) => {
      if (!req.session?.userId)
        return res.status(401).json({ error: "Log in to add test funds." });
      if (req.get("X-Requested-With") !== "DragonExchange")
        return res.status(403).json({ error: "Use the wallet form." });
      if (!client || !webhookSecret)
        return res
          .status(503)
          .json({ error: "Stripe test funding is not configured yet." });
      try {
        res.json(
          await createDeposit(db, client, req.session.userId, req.body, origin),
        );
      } catch (error) {
        res
          .status(error.status || 503)
          .json({
            error: error.status
              ? error.message
              : "Could not start test checkout. Retry the same request.",
          });
      }
    },
  );
  async function webhook(req, res) {
    if (!client || !webhookSecret)
      return res.status(503).json({ error: "Test funding is not configured." });
    let event;
    try {
      event = client.webhooks.constructEvent(
        req.body,
        req.get("stripe-signature"),
        webhookSecret,
      );
    } catch {
      return res.status(400).json({ error: "Invalid webhook signature." });
    }
    if (event.livemode !== false)
      return res
        .status(400)
        .json({ error: "Live payments are not supported." });
    if (
      ![
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
      ].includes(event.type)
    )
      return res.json({ received: true });
    try {
      const checkout = await client.checkout.sessions.retrieve(
        event.data.object.id,
        { expand: ["line_items"] },
      );
      await creditDeposit(db, checkout);
      res.json({ received: true });
    } catch (error) {
      res
        .status(error.status || 503)
        .json({ error: "Unable to confirm the deposit." });
    }
  }
  return { router, webhook };
}
module.exports = { createFunding };
