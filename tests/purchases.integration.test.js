// Explicit opt-in: creates and removes an isolated test schema in DATABASE_URL.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const express = require('express');
const session = require('express-session');
const { Pool, Client } = require('pg');

test('PostgreSQL purchase flow, competing buyers, retries, rollback and histories', { skip: process.env.PURCHASE_DB_TEST !== '1' }, async () => {
  require('dotenv').config({ quiet: true });
  const config = { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 };
  const admin = new Client(config);
  const pool = new Pool({ ...config, max: 5 });
  const schema = `purchase_test_${crypto.randomUUID().replaceAll('-', '')}`;
  let server;
  let created = false;
  const db = {
    async connect() {
      const client = await pool.connect();
      try { await client.query(`SET search_path TO "${schema}"`); return client; }
      catch (error) { client.release(); throw error; }
    },
    async query(sql, values) { const client = await this.connect(); try { return await client.query(sql, values); } finally { client.release(); } },
  };
  try {
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await admin.query(`
      CREATE TABLE "${schema}".users (id serial PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL, name text, verified boolean DEFAULT false);
      CREATE TABLE "${schema}".listings (id serial PRIMARY KEY, seller_id integer REFERENCES "${schema}".users(id), type text, title text, description text, category text, price_cents integer, status text, created_at timestamptz DEFAULT now());
      CREATE TABLE "${schema}".purchases (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, listing_id integer UNIQUE REFERENCES "${schema}".listings(id), buyer_id integer REFERENCES "${schema}".users(id), seller_id integer REFERENCES "${schema}".users(id), winning_bid_id bigint, amount_cents integer, created_at timestamptz DEFAULT now());
      CREATE FUNCTION "${schema}".fail_sale() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.title = 'Rollback test' AND NEW.status = 'sold' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW;
      END $$;
      CREATE TRIGGER fail_sale BEFORE UPDATE ON "${schema}".listings FOR EACH ROW EXECUTE FUNCTION "${schema}".fail_sale();
    `);
    const app = express();
    app.use(express.json());
    app.use(session({ secret: 'isolated-purchase-test', resave: false, saveUninitialized: false }));
    app.use('/auth', require('../routes/local-auth')({ db }));
    app.use('/purchases', require('../routes/purchases')({ db }));
    const listingModule = { exports: {} };
    vm.runInNewContext(fs.readFileSync('routes/listings.js', 'utf8'), { require: name => name === '../db' ? db : require(name), module: listingModule, console });
    app.use('/listings', listingModule.exports);
    server = await new Promise((resolve, reject) => { const s = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(path, body, cookie) {
      const res = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { code: res.status, body: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
    }
    async function signup(name) {
      const res = await request('/auth/register', { name, email: `${name}@drexel.edu`, password: 'TestPassword123' });
      assert.equal(res.code, 201);
      return res;
    }
    const seller = await signup('seller');
    const buyer = await signup('buyer');
    const buyer2 = await signup('buyer2');
    async function listing(title = 'Test book') {
      const res = await request('/listings', { title, description: 'Test only', category: 'Books', price: '12.99' }, seller.cookie);
      assert.equal(res.code, 201);
      return res.body.listing.id;
    }
    const id = await listing();
    const body = { listingId: String(id), expectedAmountCents: 1299 };
    assert.equal((await request('/purchases', body)).code, 401);
    assert.equal((await request('/purchases', body, seller.cookie)).code, 403);
    assert.equal((await request('/purchases', { ...body, expectedAmountCents: 1 }, buyer.cookie)).code, 409);
    const purchased = await request('/purchases', body, buyer.cookie);
    assert.equal(purchased.code, 201);
    assert.equal(purchased.body.purchase.winning_bid_id, null);
    assert.equal(purchased.body.purchase.amount_cents, 1299);
    assert.equal((await request('/listings')).body.listings.length, 0);
    assert.equal((await request('/listings/mine', undefined, seller.cookie)).body.listings.length, 0);
    assert.equal((await request(`/listings/${id}`)).body.listing.status, 'sold');
    assert.equal((await request('/purchases/mine', undefined, buyer.cookie)).body.purchases.length, 1);
    assert.equal((await request('/purchases/mine', undefined, seller.cookie)).body.sales.length, 1);
    assert.equal((await request('/purchases/mine', undefined, buyer2.cookie)).body.purchases.length, 0);
    const retry = await request('/purchases', body, buyer.cookie);
    assert.equal(retry.code, 200);
    assert.equal(retry.body.purchase.id, purchased.body.purchase.id);
    assert.equal((await request('/purchases', body, buyer2.cookie)).code, 409);
    const raceId = await listing('Concurrent purchase');
    const racing = await Promise.all([buyer, buyer2].map(account => request('/purchases', { listingId: String(raceId), expectedAmountCents: 1299 }, account.cookie)));
    assert.deepEqual(racing.map(res => res.code).sort(), [201, 409]);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM purchases WHERE listing_id = $1', [raceId])).rows[0].count, 1);
    const rollbackId = await listing('Rollback test');
    assert.equal((await request('/purchases', { listingId: String(rollbackId), expectedAmountCents: 1299 }, buyer.cookie)).code, 500);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM purchases WHERE listing_id = $1', [rollbackId])).rows[0].count, 0);
    assert.equal((await db.query('SELECT status FROM listings WHERE id = $1', [rollbackId])).rows[0].status, 'active');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
    if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
