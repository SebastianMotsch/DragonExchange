const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { createApp } = require('../app');

test('marketplace searches available listings across sale types and pages', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  for (const file of ['schema.sql', 'migrations/001_auctions.sql', 'migrations/002_live_bidding.sql']) {
    await db.exec(fs.readFileSync('sql/' + file, 'utf8'));
  }
  await db.exec(`
    INSERT INTO users (email, password_hash) VALUES ('seller@drexel.edu', 'test-only');
    INSERT INTO listings (title, description, category, price_cents, status) VALUES
      ('Notebook', 'Desk supplies', 'Books', 900, 'active'),
      ('Sold book', 'Book', 'Books', 500, 'sold'),
      ('Keyboard', 'Desk supplies', 'Electronics', 1000, 'active');
    INSERT INTO auctions (seller_id, title, description, category, starting_price_cents,
                          current_bid_cents, ends_at, created_at) VALUES
      (1, 'Calculus', 'TextBOOK for class', 'Books', 500, 1200, now() + interval '1 day', now()),
      (1, 'Book with no bids', 'Like new', 'Books', 1000, NULL, now() + interval '1 day', now()),
      (1, 'Expired book', 'Old edition', 'Books', 1000, NULL, now() - interval '1 day', now() - interval '2 days');
    INSERT INTO listings (title, description, category, price_cents)
    SELECT 'Furniture ' || n, 'Chair', 'Furniture', 100 FROM generate_series(1, 25) AS n;
  `);

  const server = createApp({ db, configured: () => true, sessionSecret: null }).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const search = query => fetch('http://127.0.0.1:' + server.address().port + '/api/marketplace?' + query);
    const filtered = await search('q=book&category=Books&min=9.00&max=12&sort=price-desc');
    assert.equal(filtered.status, 200);
    const { listings } = await filtered.json();
    assert.deepEqual(listings.map(row => [row.title, row.price_cents]), [
      ['Calculus', 1200], ['Book with no bids', 1000], ['Notebook', 900],
    ]);
    const auction = await (await search('type=auction&min=11')).json();
    assert.deepEqual(auction.listings.map(row => row.title), ['Calculus']);
    const fixed = await (await search('type=fixed&category=Books')).json();
    assert.deepEqual(fixed.listings.map(row => row.title), ['Notebook']);
    const literal = await (await search(new URLSearchParams({ q: "Book%_'<em>" }))).json();
    assert.deepEqual(literal.listings, []);
    for (const query of ['min=5&max=4', 'min=0.001', 'category=unknown', 'q=one&q=two', 'page=0', 'sort=unknown']) {
      assert.equal((await search(query)).status, 400);
    }
    const first = await (await search('category=Furniture')).json();
    const second = await (await search('category=Furniture&page=2')).json();
    assert.equal(first.listings.length, 24);
    assert.equal(first.hasMore, true);
    assert.equal(second.listings.length, 1);
    assert.equal(second.hasMore, false);
    assert.equal(new Set([...first.listings, ...second.listings].map(row => row.id)).size, 25);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
