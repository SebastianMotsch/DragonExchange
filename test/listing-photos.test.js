const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');
const poolFor = require('../scripts/pglite-pool');

process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dx-photos-'));
const uploadDir = process.env.UPLOAD_DIR;
const { removePhotos } = require('../lib/photo-upload');

const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)]);
const savedFiles = () => fs.readdirSync(uploadDir).filter(name => !name.startsWith('keep'));

let db;
let base;
let server;

test.before(async () => {
  db = new PGlite();
  await db.exec(fs.readFileSync('sql/schema.sql', 'utf8'));
  await db.exec(fs.readFileSync('sql/migrations/003_listing_photos.sql', 'utf8'));
  await db.query("INSERT INTO users(name, email, password_hash, verified) VALUES('Seller', 'seller@drexel.edu', 'x', true)");
  const pool = poolFor(db);
  const moduleObject = { exports: {} };
  vm.runInNewContext(fs.readFileSync('routes/listings.js', 'utf8'), {
    require: name => name === '../db' ? pool : require(name),
    module: moduleObject, console: { error() {} },
  });
  const app = express();
  app.use((req, res, next) => {
    if (req.headers['x-test-user']) req.session = { userId: Number(req.headers['x-test-user']) };
    next();
  });
  app.use('/listings', moduleObject.exports);
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  await db.close();
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

function listingForm(photos) {
  const form = new FormData();
  form.append('title', 'Desk lamp');
  form.append('description', 'Warm white, three brightness levels.');
  form.append('category', 'Electronics');
  form.append('price', '12.50');
  for (const [name, bytes, type] of photos) form.append('photos', new Blob([bytes], { type }), name);
  return form;
}

const post = form => fetch(`${base}/listings`, { method: 'POST', body: form, headers: { 'x-test-user': '1' } });

test('valid photos are saved with random names, shown with the listing, and removed with it', async () => {
  const created = await post(listingForm([['my lamp.png', png(), 'image/png'], ['side.jpg', jpeg(), 'image/jpeg']]));
  assert.equal(created.status, 201);
  const { listing } = await created.json();
  assert.equal(listing.photos.length, 2);
  assert.match(listing.photos[0], /^\/uploads\/[0-9a-f-]{36}\.png$/, 'The cover keeps upload order and gets a random name');
  assert.match(listing.photos[1], /^\/uploads\/[0-9a-f-]{36}\.jpg$/);
  assert.ok(!listing.photos.join().includes('lamp'), 'The uploaded file name is never used');

  const names = listing.photos.map(url => url.replace('/uploads/', ''));
  assert.deepEqual(savedFiles().sort(), [...names].sort());
  assert.deepEqual(fs.readFileSync(path.join(uploadDir, names[0])), png());

  const recent = await (await fetch(`${base}/listings`)).json();
  assert.equal(recent.listings[0].photo_url, listing.photos[0]);
  const mine = await (await fetch(`${base}/listings/mine`, { headers: { 'x-test-user': '1' } })).json();
  assert.equal(mine.listings[0].photo_url, listing.photos[0]);
  const detail = await (await fetch(`${base}/listings/${listing.id}`)).json();
  assert.deepEqual(detail.listing.photos, listing.photos);

  const removed = await fetch(`${base}/listings/${listing.id}`, { method: 'DELETE', headers: { 'x-test-user': '1' } });
  assert.equal(removed.status, 200);
  assert.deepEqual(savedFiles(), [], 'Deleting the listing deletes its photo files');
  assert.equal((await db.query('SELECT * FROM listing_photos')).rows.length, 0);
});

test('a listing without photos still works and falls back to no cover', async () => {
  const created = await post(listingForm([]));
  assert.equal(created.status, 201);
  const { listing } = await created.json();
  assert.deepEqual(listing.photos, []);
  const detail = await (await fetch(`${base}/listings/${listing.id}`)).json();
  assert.deepEqual(detail.listing.photos, []);
  const recent = await (await fetch(`${base}/listings`)).json();
  assert.equal(recent.listings[0].photo_url, null);
  assert.equal((await fetch(`${base}/listings/${listing.id}`, { method: 'DELETE', headers: { 'x-test-user': '1' } })).status, 200);
});

test('fake, oversized, and extra photos are rejected before anything is saved', async () => {
  const before = (await db.query('SELECT count(*)::int AS n FROM listings')).rows[0].n;
  const cases = [
    [[['notes.jpg', Buffer.from('these are class notes, not a photo'), 'image/jpeg']], /must be a JPEG, PNG, or WebP/],
    [[['big.png', Buffer.concat([png(), Buffer.alloc(5 * 1024 * 1024)]), 'image/png']], /5 MB/],
    [Array.from({ length: 6 }, (_, i) => [`p${i}.png`, png(), 'image/png']), /up to 5 photos/],
  ];
  for (const [photos, message] of cases) {
    const response = await post(listingForm(photos));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, message);
  }
  assert.deepEqual(savedFiles(), []);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM listings')).rows[0].n, before);
});

test('cleanup only deletes file names the server created', async () => {
  fs.writeFileSync(path.join(uploadDir, 'keep.txt'), 'keep');
  await removePhotos(['keep.txt', '../keep.txt', 'not-a-uuid.png']);
  assert.ok(fs.existsSync(path.join(uploadDir, 'keep.txt')));
});

test('the uploads folder is served as static files', async () => {
  const { createApp } = require('../app');
  const app = createApp({ db: { query: async () => ({ rows: [] }) }, configured: () => false });
  const listener = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const name = '0b8c3a4e-1f2d-4c5b-9a6e-7d8f9e0a1b2c.png';
    fs.writeFileSync(path.join(uploadDir, name), png());
    const response = await fetch(`http://127.0.0.1:${listener.address().port}/uploads/${name}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    fs.unlinkSync(path.join(uploadDir, name));
  } finally {
    await new Promise(resolve => listener.close(resolve));
  }
});