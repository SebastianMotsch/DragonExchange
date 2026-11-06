const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');
const { validateAuction } = require('../lib/auction-input');
const router = require('../routes/auctions');

let db, server, url;
const valid = () => ({
  title: '<script>textbook</script>', description: 'A useful book.',
  category: 'Books', startingPrice: '12.34',
  endsAt: new Date(Date.now() + 3600000).toISOString()
});
before(async () => {
  db = new PGlite();
  await db.exec(fs.readFileSync(path.join(__dirname, '../sql/schema.sql'), 'utf8'));
  const migration = fs.readFileSync(path.join(__dirname, '../sql/migrations/001_auctions.sql'), 'utf8');
  await db.exec(migration);
  await db.exec(migration); // Repeatable migration must not lose data or fail.
  await db.query("INSERT INTO users (email,password_hash,verified) VALUES ('seller@drexel.edu','test-only',true), ('pending@drexel.edu','test-only',false)");
  const app = express();
  app.use(express.json());
  // Test-only session fixture. Production has no route/header to bypass login.
  app.use((req, res, next) => {
    if (req.get('Test-User')) req.session = { userId: Number(req.get('Test-User')) };
    next();
  });
  app.use('/api/auctions', router(db, () => true));
  app.use('/unconfigured', router(db, () => false));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  url = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (db) await db.close();
});
async function post(body, user, custom = true) {
  return fetch(url + '/api/auctions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(custom ? { 'X-Requested-With': 'DragonExchange' } : {}), ...(user ? { 'Test-User': user } : {}) },
    body: JSON.stringify(body)
  });
}
test('money and deadlines reject unsafe or invalid inputs', () => {
  assert.ok(validateAuction(null).errors.title);
  assert.ok(validateAuction([]).errors.title);
  for (const price of ['0', '-1', '1.001', '1e3', '21474836.48', 12.34]) {
    assert.ok(validateAuction({ ...valid(), startingPrice: price }).errors.startingPrice);
  }
  assert.equal(validateAuction({ ...valid(), startingPrice: '0.01' }).value.cents, 1);
  assert.equal(validateAuction({ ...valid(), startingPrice: '21474836.47' }).value.cents, 2147483647);
  for (const endsAt of ['bad', '2020-01-01T00:00:00Z', '2030-01-01T00:00:00']) {
    assert.ok(validateAuction({ ...valid(), endsAt }).errors.endsAt);
  }
});
test('empty, missing, and unconfigured reads have explicit responses', async () => {
  assert.deepEqual(await (await fetch(url + '/api/auctions')).json(), { auctions: [] });
  for (const id of ['0', 'abc', '2147483648', '999']) {
    assert.equal((await fetch(url + '/api/auctions/' + id)).status, 404);
  }
  assert.equal((await fetch(url + '/unconfigured')).status, 503);
});
test('anonymous, unverified, missing users and cross-site form requests cannot create auctions', async () => {
  assert.equal((await post(valid())).status, 401);
  assert.equal((await post(valid(), '2')).status, 403);
  assert.equal((await post(valid(), '999')).status, 403);
  assert.equal((await post(valid(), '1', false)).status, 403);
  const count = await db.query('SELECT count(*)::int AS count FROM auctions');
  assert.equal(count.rows[0].count, 0);
});
test('invalid submissions leave the database unchanged', async () => {
  const response = await post({ ...valid(), title: ' ', category: 'Bad', startingPrice: '-3' }, '1');
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.ok(body.errors.title && body.errors.category && body.errors.startingPrice);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM auctions')).rows[0].count, 0);
});
test('create, list and detail persist cents/UTC and cannot spoof the seller', async () => {
  const input = { ...valid(), seller_id: 2, status: 'settled' };
  const response = await post(input, '1');
  assert.equal(response.status, 201);
  const { auction } = await response.json();
  assert.equal(auction.starting_price_cents, 1234);
  assert.equal(auction.status, 'active');
  assert.equal(new Date(auction.ends_at).toISOString(), input.endsAt);
  const stored = (await db.query('SELECT seller_id FROM auctions WHERE id=$1', [auction.id])).rows[0];
  assert.equal(stored.seller_id, 1);
  const detail = await (await fetch(url + '/api/auctions/' + auction.id)).json();
  assert.equal(detail.auction.title, input.title);
  assert.equal(detail.auction.seller_id, undefined);
  const list = await (await fetch(url + '/api/auctions')).json();
  assert.equal(list.auctions[0].id, auction.id);
});
test('expired auctions display ended and cancelled auctions are hidden', async () => {
  await db.query("INSERT INTO auctions(seller_id,title,description,category,starting_price_cents,created_at,ends_at) VALUES (1,'Old','Book','Books',100,now()-interval '2 days',now()-interval '1 day')");
  const list = await (await fetch(url + '/api/auctions')).json();
  assert.equal(list.auctions.find(row => row.title === 'Old').status, 'ended');
  await db.query("UPDATE auctions SET status='cancelled' WHERE title='Old'");
  const hidden = await (await fetch(url + '/api/auctions')).json();
  assert.equal(hidden.auctions.some(row => row.title === 'Old'), false);
});
test('database constraints reject invalid data and RLS denies browser roles', async () => {
  await assert.rejects(db.query("INSERT INTO auctions(seller_id,title,description,category,starting_price_cents,ends_at) VALUES (1,'Bad','x','Books',0,now()+interval '1 day')"));
  await db.exec('CREATE ROLE auction_browser; GRANT USAGE ON SCHEMA public TO auction_browser; GRANT SELECT ON auctions TO auction_browser; SET ROLE auction_browser;');
  try { assert.equal((await db.query('SELECT * FROM auctions')).rows.length, 0); }
  finally { await db.exec('RESET ROLE'); }
});
