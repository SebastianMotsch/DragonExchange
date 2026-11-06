const express = require('express');
const { validateAuction } = require('../lib/auction-input');

// Factory allows HTTP tests without a real session or production database.
module.exports = function auctionRouter(db, configured = () => Boolean(process.env.DATABASE_URL)) {
  const router = express.Router();
  const fields = "id, title, description, category, starting_price_cents, ends_at, created_at, CASE WHEN status = 'active' AND ends_at <= now() THEN 'ended' ELSE status END AS status";
  router.use((req, res, next) => {
    if (!configured()) return res.status(503).json({ error: 'Auctions are unavailable until the database is configured.' });
    next();
  });
  router.get('/', async (req, res, next) => {
    try {
      const result = await db.query(`SELECT ${fields} FROM public.auctions WHERE status <> 'cancelled' ORDER BY created_at DESC, id DESC LIMIT 50`);
      res.json({ auctions: result.rows });
    } catch (error) { next(error); }
  });
  router.get('/:id', async (req, res, next) => {
    if (!/^[1-9]\d{0,9}$/.test(req.params.id) || Number(req.params.id) > 2147483647) return res.status(404).json({ error: 'Auction not found.' });
    try {
      const result = await db.query(`SELECT ${fields} FROM public.auctions WHERE id = $1 AND status <> 'cancelled'`, [req.params.id]);
      if (!result.rows.length) return res.status(404).json({ error: 'Auction not found.' });
      res.json({ auction: result.rows[0] });
    } catch (error) { next(error); }
  });
  router.post('/', async (req, res, next) => {
    if (!req.session?.userId) return res.status(401).json({ error: 'Log in before creating an auction.' });
    // The form sends JSON through a custom header; cross-site forms cannot send this.
    if (!req.is('application/json') || req.get('X-Requested-With') !== 'DragonExchange') {
      return res.status(403).json({ error: 'Submit the auction using the sell form.' });
    }
    const { errors, value } = validateAuction(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ error: 'Check the auction details.', errors });
    try {
      // Derive ownership from the session and check verification inside the insert.
      const result = await db.query(`INSERT INTO public.auctions
        (seller_id, title, description, category, starting_price_cents, ends_at)
        SELECT id, $2, $3, $4, $5, $6::timestamptz FROM public.users
        WHERE id = $1 AND verified = true AND $6::timestamptz > now()
        RETURNING ${fields}`,
        [req.session.userId, value.title, value.description, value.category, value.cents, value.endsAt]);
      if (!result.rows.length) return res.status(403).json({ error: 'A verified account and a future deadline are required.' });
      res.status(201).location('/api/auctions/' + result.rows[0].id).json({ auction: result.rows[0] });
    } catch (error) { next(error); }
  });
  router.use((error, req, res, next) => {
    console.error('Auction request failed:', error.code || 'database error');
    res.status(503).json({ error: 'Unable to load or save auctions. Please try again later.' });
  });
  return router;
};
