const express = require('express');
const db = require('../db');
const { validatePhotos } = require('../lib/photos');
const { readPhotos, savePhotos, removePhotos } = require('../lib/photo-upload');
const router = express.Router();
const categories = new Set(['Books', 'Electronics', 'Furniture', 'Clothing', 'Other']);
// Saved photos are served from the static uploads folder (see app.js).
const PHOTO_URL = '/uploads/';

router.get('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const result = await db.query(
      `SELECT id, title, category, price_cents, created_at,
              (SELECT '/uploads/' || p.file_name FROM listing_photos p
               WHERE p.listing_id = listings.id ORDER BY p.position LIMIT 1) AS photo_url
       FROM listings
       WHERE type = 'regular' AND status = 'active'
       ORDER BY created_at DESC, id DESC
       LIMIT 6`
    );
    return res.json({ listings: result.rows });
  } catch (error) {
    console.error('Could not load recent listings:', error.code);
    return res.status(500).json({ error: 'Could not load recent listings. Refresh the page to try again.' });
  }
});

router.get('/mine', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const sellerId = req.session?.userId;
  if (!sellerId) {
    return res.status(401).json({
      error: 'Log in to see your current listings.',
      loginUrl: '/auth/login.html',
    });
  }

  try {
    const result = await db.query(
      `SELECT id, title, description, category, price_cents, status, created_at,
              (SELECT '/uploads/' || p.file_name FROM listing_photos p
               WHERE p.listing_id = listings.id ORDER BY p.position LIMIT 1) AS photo_url
       FROM listings
       WHERE seller_id = $1 AND type = 'regular' AND status = 'active'
       ORDER BY created_at DESC, id DESC`,
      [sellerId]
    );
    return res.json({ listings: result.rows });
  } catch (error) {
    console.error('Could not load seller listings:', error.code);
    return res.status(500).json({ error: 'Could not load your listings. Please try again.' });
  }
});

router.get('/:id', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const id = req.params.id;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) > 2147483647) {
    return res.status(400).json({ error: 'Invalid listing ID.' });
  }
  try {
    const result = await db.query(
      `SELECT l.id, l.title, l.description, l.category, l.price_cents,
              l.status, l.created_at, l.seller_id, u.name AS seller_name,
              COALESCE((SELECT json_agg('/uploads/' || p.file_name ORDER BY p.position)
                        FROM listing_photos p WHERE p.listing_id = l.id), '[]'::json) AS photos
       FROM listings l LEFT JOIN users u ON u.id = l.seller_id
       WHERE l.id = $1 AND l.type = 'regular' AND l.status IN ('active', 'sold')`,
      [Number(id)]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'This listing is no longer available or does not exist.' });
    }
    const { seller_id: sellerId, ...listing } = result.rows[0];
    return res.json({ listing, isOwner: sellerId != null && sellerId === req.session?.userId });
  } catch (error) {
    console.error('Could not load listing:', error.code);
    return res.status(500).json({ error: 'Could not load this listing. Refresh the page to try again.' });
  }
});

router.delete('/:id', async (req, res) => {
  const sellerId = req.session?.userId;
  if (!sellerId) return res.status(401).json({ error: 'Log in to delete your listing.' });
  const id = req.params.id;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) > 2147483647) {
    return res.status(400).json({ error: 'Invalid listing ID.' });
  }

  try {
    // Check ownership and status in the delete itself to avoid a check/delete race.
    // Photo rows are removed by ON DELETE CASCADE; the SELECT still sees their
    // file names, so the files can be removed from the uploads folder afterwards.
    const result = await db.query(
      `WITH deleted AS (
         DELETE FROM listings
         WHERE id = $1 AND seller_id = $2 AND type = 'regular' AND status = 'active'
         RETURNING id
       )
       SELECT d.id, p.file_name FROM deleted d
       LEFT JOIN listing_photos p ON p.listing_id = d.id`,
      [Number(id), sellerId]
    );
    const rows = result.rows || [];
    if ((result.rowCount ?? rows.length) === 0) {
      return res.status(404).json({ error: 'Listing not found or no longer available to delete.' });
    }
    const photoNames = rows.map(row => row.file_name).filter(Boolean);
    if (photoNames.length) await removePhotos(photoNames);
    return res.json({ message: 'Listing deleted.' });
  } catch (error) {
    console.error('Could not delete listing:', error.code);
    if (error.code === '23503') {
      return res.status(409).json({ error: 'This listing has related activity and cannot be deleted.' });
    }
    return res.status(500).json({ error: 'Could not delete your listing. Please try again later.' });
  }
});

// The form sends multipart data: text fields plus up to 5 files in "photos".
router.post('/', readPhotos, async (req, res) => {
  // Temporarily allow guest listings while login is being implemented.
  const sellerId = req.session?.userId ?? null;

  const { title, description, category, price } = req.body || {};
  if (
    typeof title !== 'string' || !title.trim() || title.trim().length > 150 ||
    typeof description !== 'string' || !description.trim() || description.trim().length > 5000 ||
    !categories.has(category) ||
    !['string', 'number'].includes(typeof price) ||
    !/^\d{1,8}(\.\d{1,2})?$/.test(String(price)) || Number(price) <= 0
  ) {
    return res.status(400).json({ error: 'Enter a title, description, category, and a valid price between $0.01 and $21,474,836.47.' });
  }

  // Check count, size, and the real image type before anything is saved.
  const files = (req.files || []).filter(file => file.size > 0);
  const photoError = validatePhotos(files);
  if (photoError) {
    return res.status(400).json({ error: photoError });
  }

  // Convert the validated dollar amount to integer cents without rounding.
  const [dollars, cents = ''] = String(price).split('.');
  const priceCents = Number(dollars) * 100 + Number(cents.padEnd(2, '0'));
  if (priceCents > 2147483647) {
    return res.status(400).json({ error: 'Price cannot exceed $21,474,836.47.' });
  }

  let photoNames = [];
  let client;
  try {
    photoNames = await savePhotos(files);
    // The listing and its photo rows are saved together or not at all.
    client = await db.connect();
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO listings (seller_id, type, title, description, category, price_cents, status)
       VALUES ($1, 'regular', $2, $3, $4, $5, 'active')
       RETURNING id, type, title, description, category, price_cents, status, created_at`,
      [sellerId, title.trim(), description.trim(), category, priceCents]
    );
    const listing = result.rows[0];
    for (let i = 0; i < photoNames.length; i++) {
      await client.query(
        'INSERT INTO listing_photos (listing_id, file_name, position) VALUES ($1, $2, $3)',
        [listing.id, photoNames[i], i]
      );
    }
    await client.query('COMMIT');
    listing.photos = photoNames.map(name => PHOTO_URL + name);
    return res.status(201).json({ listing });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    await removePhotos(photoNames);
    console.error('Could not create listing:', error.code, error.message);
    return res.status(500).json({ error: 'Could not save your listing. Please try again later.' });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;