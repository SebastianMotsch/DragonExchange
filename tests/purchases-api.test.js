const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(options = {}) {
  const handlers = {};
  const calls = [];
  const listing = { id: 8, seller_id: 4, type: 'regular', status: 'active', price_cents: 1299, ...options.listing };
  const order = { id: 10, listing_id: 8, buyer_id: 7, seller_id: 4, winning_bid_id: null, amount_cents: 1299 };
  let released = false;
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (options.failAt && sql.includes(options.failAt)) throw { code: options.errorCode || 'TEST' };
      if (sql.includes('SELECT id, verified')) return { rows: options.missingBuyer ? [] : [{ id: 7, verified: options.verified !== false }] };
      if (sql.includes('FOR UPDATE')) return { rows: options.missing ? [] : [listing] };
      if (sql.includes('FROM purchases WHERE')) return { rows: options.existing ? [options.existing] : [] };
      if (sql.includes('INSERT INTO purchases')) return { rows: [order] };
      return { rows: [] };
    },
    release() { released = true; },
  };
  const moduleObject = {};
  vm.runInNewContext(fs.readFileSync('routes/purchases.js', 'utf8'), {
    require: () => ({ Router: () => ({ use(fn) { handlers.auth = fn; }, get(path, fn) { handlers.get = fn; }, post(path, fn) { handlers.post = fn; } }) }),
    module: moduleObject, console: { error() {} },
  });
  moduleObject.exports({ db: { connect: async () => client, query: async () => ({ rows: options.history || [] }) } });
  async function request(body = { listingId: '8', expectedAmountCents: 1299 }, userId = 7, method = 'post') {
    const res = { code: 200, set() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    const req = { body, session: userId ? { userId } : undefined };
    let allowed = false;
    handlers.auth(req, res, () => { allowed = true; });
    if (allowed) await handlers[method](req, res);
    return res;
  }
  return { request, calls, released: () => released, order };
}

test('purchase transaction derives identities and amount from session and locked listing', async () => {
  const app = setup();
  const result = await app.request({ listingId: '8', expectedAmountCents: 1299, buyer_id: 99, seller_id: 99, amount_cents: 1, winning_bid_id: 99 });
  assert.equal(result.code, 201);
  assert.equal(result.body.purchase.winning_bid_id, null);
  const insert = app.calls.find(call => call.sql.includes('INSERT INTO purchases'));
  assert.deepEqual(Array.from(insert.values), ['8', 7, 4, 1299]);
  assert.match(insert.sql, /VALUES \(\$1, \$2, \$3, NULL, \$4\)/);
  assert.ok(app.calls.findIndex(call => call.sql.includes('FOR UPDATE')) < app.calls.indexOf(insert));
  assert.ok(app.calls.some(call => call.sql.includes("SET status = 'sold'")));
  assert.equal(app.calls.at(-1).sql, 'COMMIT');
  assert.equal(app.released(), true);
});

test('purchase rejects logged-out, unverified, own, guest, auction, sold, missing and repriced items', async () => {
  const guest = setup();
  assert.equal((await guest.request(undefined, null)).code, 401);
  assert.equal(guest.calls.length, 0);
  for (const [options, code] of [
    [{ verified: false }, 403], [{ missingBuyer: true }, 403], [{ missing: true }, 404],
    [{ listing: { seller_id: 7 } }, 403], [{ listing: { seller_id: null } }, 403],
    [{ listing: { type: 'auction' } }, 409], [{ listing: { status: 'sold' } }, 409],
    [{ listing: { price_cents: 1300 } }, 409], [{ listing: { price_cents: null } }, 409],
  ]) {
    const app = setup(options);
    assert.equal((await app.request()).code, code);
    assert.equal(app.calls.at(-1).sql, 'ROLLBACK');
    assert.ok(!app.calls.some(call => call.sql.includes('INSERT')));
    assert.equal(app.released(), true);
  }
  for (const body of [{ listingId: '-1', expectedAmountCents: 1 }, { listingId: '8', expectedAmountCents: 0 }, { listingId: {}, expectedAmountCents: 1 }]) {
    const app = setup();
    assert.equal((await app.request(body)).code, 400);
    assert.equal(app.calls.length, 0);
  }
});

test('retry returns original purchase; competing buyers and failures never create a partial sale', async () => {
  const existing = { id: 10, buyer_id: 7, amount_cents: 1299 };
  const retry = setup({ existing, listing: { status: 'sold' } });
  const result = await retry.request();
  assert.equal(result.code, 200);
  assert.equal(result.body.alreadyPurchased, true);
  assert.ok(!retry.calls.some(call => call.sql.includes('INSERT')));
  const other = setup({ existing: { ...existing, buyer_id: 9 } });
  assert.equal((await other.request()).code, 409);
  for (const failAt of ['INSERT INTO purchases', 'UPDATE listings', 'COMMIT']) {
    const app = setup({ failAt });
    assert.equal((await app.request()).code, 500);
    assert.equal(app.calls.at(-1).sql, 'ROLLBACK');
    assert.equal(app.released(), true);
  }
});

test('history separates buyer purchases and seller sales using session identity', async () => {
  const app = setup({ history: [{ id: 1, buyer_id: 7, seller_id: 4 }, { id: 2, buyer_id: 8, seller_id: 7 }] });
  const res = await app.request({}, 7, 'get');
  assert.equal(res.body.purchases.length, 1);
  assert.equal(res.body.purchases[0].id, 1);
  assert.equal(res.body.sales.length, 1);
  assert.equal(res.body.sales[0].id, 2);
});
