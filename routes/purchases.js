const express = require('express');

module.exports = function createPurchasesRouter({ db }) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!req.session?.userId) return res.status(401).json({ error: 'Log in to purchase an item or view your purchases.' });
    next();
  });

  router.get('/mine', async (req, res) => {
    try {
      const result = await db.query(
        `SELECT p.id, p.listing_id, p.buyer_id, p.seller_id, p.amount_cents, p.created_at,
                l.title, l.type, buyer.name AS buyer_name, seller.name AS seller_name
         FROM purchases p JOIN listings l ON l.id = p.listing_id
         LEFT JOIN users buyer ON buyer.id = p.buyer_id
         LEFT JOIN users seller ON seller.id = p.seller_id
         WHERE p.buyer_id = $1 OR p.seller_id = $1
         ORDER BY p.created_at DESC, p.id DESC`,
        [req.session.userId]
      );
      const mine = id => String(id) === String(req.session.userId);
      res.json({ purchases: result.rows.filter(row => mine(row.buyer_id)), sales: result.rows.filter(row => mine(row.seller_id)) });
    } catch (error) {
      console.error('Could not load purchases:', error.code);
      res.status(500).json({ error: 'Could not load purchases. Refresh the page to try again.' });
    }
  });

  router.post('/', async (req, res) => {
    const { listingId, expectedAmountCents } = req.body || {};
    if (!['string', 'number'].includes(typeof listingId) || !/^[1-9]\d*$/.test(String(listingId)) ||
        BigInt(listingId) > 9223372036854775807n ||
        (typeof listingId === 'number' && !Number.isSafeInteger(listingId)) ||
        !Number.isInteger(expectedAmountCents) || expectedAmountCents <= 0 || expectedAmountCents > 2147483647) {
      return res.status(400).json({ error: 'Choose a valid listing and review its price before purchasing.' });
    }
    const buyerId = req.session.userId;
    let client;
    let transaction = false;
    try {
      client = await db.connect();
      await client.query('BEGIN');
      transaction = true;
      const buyer = await client.query('SELECT id, verified FROM users WHERE id = $1', [buyerId]);
      if (!buyer.rows[0]?.verified) {
        await client.query('ROLLBACK');
        transaction = false;
        return res.status(403).json({ error: 'A verified account is required to purchase an item.' });
      }
      // Every buyer locks the same listing before checking availability or inserting.
      const result = await client.query(
        'SELECT id, seller_id, type, price_cents, status FROM listings WHERE id = $1 FOR UPDATE',
        [String(listingId)]
      );
      const listing = result.rows[0];
      if (!listing) {
        await client.query('ROLLBACK'); transaction = false;
        return res.status(404).json({ error: 'This listing no longer exists.' });
      }
      const existing = await client.query(
        'SELECT id, listing_id, buyer_id, seller_id, winning_bid_id, amount_cents, created_at FROM purchases WHERE listing_id = $1',
        [String(listingId)]
      );
      if (existing.rows[0]) {
        await client.query('ROLLBACK'); transaction = false;
        // Retrying after a lost response returns the original order without inserting again.
        if (String(existing.rows[0].buyer_id) === String(buyerId) && listing.type === 'regular') {
          return res.json({ purchase: existing.rows[0], alreadyPurchased: true });
        }
        return res.status(409).json({ error: 'This item has already been purchased.' });
      }
      if (listing.type !== 'regular' || listing.status !== 'active') {
        await client.query('ROLLBACK'); transaction = false;
        return res.status(409).json({ error: 'This item is not available for a regular purchase.' });
      }
      if (listing.seller_id == null || String(listing.seller_id) === String(buyerId)) {
        await client.query('ROLLBACK'); transaction = false;
        return res.status(403).json({ error: listing.seller_id == null ? 'This listing has no seller account and cannot be purchased.' : 'You cannot purchase your own listing.' });
      }
      if (!Number.isInteger(listing.price_cents) || listing.price_cents <= 0 || listing.price_cents !== expectedAmountCents) {
        await client.query('ROLLBACK'); transaction = false;
        return res.status(409).json({ error: 'The listing price has changed or is unavailable. Refresh the page and review it before purchasing.' });
      }
      const purchase = await client.query(
        `INSERT INTO purchases (listing_id, buyer_id, seller_id, winning_bid_id, amount_cents)
         VALUES ($1, $2, $3, NULL, $4)
         RETURNING id, listing_id, buyer_id, seller_id, winning_bid_id, amount_cents, created_at`,
        [String(listingId), buyerId, listing.seller_id, listing.price_cents]
      );
      await client.query("UPDATE listings SET status = 'sold' WHERE id = $1", [String(listingId)]);
      await client.query('COMMIT');
      transaction = false;
      return res.status(201).json({ purchase: purchase.rows[0] });
    } catch (error) {
      if (transaction) await client.query('ROLLBACK').catch(() => {});
      console.error('Could not create purchase:', error.code);
      if (error.code === '23505') return res.status(409).json({ error: 'This item has already been purchased. Refresh the page.' });
      if (error.code === '22003') return res.status(400).json({ error: 'Invalid listing ID.' });
      return res.status(500).json({ error: 'Could not confirm your purchase. You can retry safely or check My purchases on your dashboard.' });
    } finally {
      client?.release();
    }
  });

  return router;
};
