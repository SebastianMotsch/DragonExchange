const express = require("express");
module.exports = function auctionHistory(db) {
  const router = express.Router();
  router.get("/", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const userId = req.session?.userId;
    if (!userId)
      return res
        .status(401)
        .json({ error: "Log in to see auction purchases and sales." });
    try {
      const r = await db.query(
        "SELECT s.auction_id,a.title,s.buyer_id,s.seller_id,s.amount_cents,s.created_at FROM auction_settlements s JOIN auctions a ON a.id=s.auction_id WHERE s.outcome='sold' AND (s.buyer_id=$1 OR s.seller_id=$1) ORDER BY s.created_at DESC LIMIT 50",
        [userId],
      );
      const publicRow = (row) => ({
        auction_id: row.auction_id,
        title: row.title,
        amount_cents: row.amount_cents,
        created_at: row.created_at,
      });
      res.json({
        purchases: r.rows
          .filter((row) => row.buyer_id === userId)
          .map(publicRow),
        sales: r.rows.filter((row) => row.seller_id === userId).map(publicRow),
      });
    } catch {
      res.status(503).json({ error: "Auction history is unavailable." });
    }
  });
  return router;
};
