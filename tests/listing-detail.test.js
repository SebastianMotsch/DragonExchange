const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('listing details validate IDs, filter available regular listings and handle missing rows and database errors', async () => {
  let handler;
  const calls = [];
  let rows = [{ id: 8, title: 'Book', price_cents: 2500, seller_id: 7 }];
  let failed = false;
  vm.runInNewContext(fs.readFileSync('routes/listings.js', 'utf8'), {
    require: name => name === 'express'
      ? { Router: () => ({ get(path, fn) { if (path === '/:id') handler = fn; }, post() {}, delete() {} }) }
      : { query: async (sql, values) => { calls.push({ sql, values }); if (failed) throw { code: 'TEST' }; return { rows }; } },
    module: {}, console: { error() {} },
  });
  async function get(id, userId) {
    const res = { code: 200, set() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ params: { id }, session: userId ? { userId } : undefined }, res);
    return res;
  }
  for (const id of ['0', '-1', 'abc', '2147483648']) assert.equal((await get(id)).code, 400);
  assert.equal(calls.length, 0);
  const found = await get('8');
  assert.equal(found.code, 200);
  assert.equal(found.body.listing.id, 8);
  assert.equal(found.body.isOwner, false);
  assert.equal(found.body.listing.seller_id, undefined);
  assert.equal((await get('8', 7)).body.isOwner, true);
  assert.equal((await get('8', 9)).body.isOwner, false);
  rows = [{ ...rows[0], seller_id: null }];
  assert.equal((await get('8')).body.isOwner, false);
  assert.deepEqual(Array.from(calls[0].values), [8]);
  assert.match(calls[0].sql, /l.id = \$1 AND l.type = 'regular' AND l.status IN \('active', 'sold'\)/);
  assert.doesNotMatch(calls[0].sql, /email|password_hash/);
  rows = [];
  assert.equal((await get('8')).code, 404);
  failed = true;
  assert.equal((await get('8')).code, 500);
});

test('detail page displays safe text and cents, and handles invalid, deleted and failed loads', async () => {
  let requests = 0;
  async function render(search, response) {
    const nodes = {};
    const result = vm.runInNewContext(fs.readFileSync('public/assets/js/listing-detail.js', 'utf8'), {
      document: { querySelector(id) { return nodes[id] ||= {
        textContent: '', hidden: true, attrs: {},
        addEventListener(name, handler) { this[name] = handler; },
        setAttribute(name, value) { this.attrs[name] = value; },
      }; } },
      window: { location: { search } }, URLSearchParams, Intl, Date,
      fetch: async () => { requests++; if (response instanceof Error) throw response; return response; },
    });
    await result;
    return nodes;
  }
  const invalid = await render('');
  assert.match(invalid['#listing-status'].textContent, /valid listing/);
  assert.equal(requests, 0);
  const loaded = await render('?id=8', { ok: true, json: async () => ({ listing: {
    title: '<script>unsafe</script>', price_cents: 1299, category: 'Books',
    description: 'A textbook', seller_name: null, created_at: '2026-11-13T12:00:00Z',
  } }) });
  assert.equal(loaded['#listing-title'].textContent, '<script>unsafe</script>');
  assert.equal(loaded['#listing-price'].textContent, '$12.99');
  assert.equal(loaded['#listing-seller'].textContent, 'Seller name unavailable');
  assert.equal(loaded['#listing-details'].hidden, false);
  assert.equal(loaded['#buyer-actions'].hidden, false);
  assert.equal(loaded['#buy-now'].href, 'purchase.html?id=8');
  assert.equal(loaded['#seller-preview-controls'], undefined, 'Visitors do not receive seller controls');
  const owner = await render('?id=8', { ok: true, json: async () => ({ isOwner: true, listing: {
    title: 'Book', price_cents: 1299, category: 'Books', description: 'A textbook',
    seller_name: 'Test Seller', created_at: '2026-11-13T12:00:00Z',
  } }) });
  assert.equal(owner['#seller-preview-controls'].hidden, false);
  assert.equal(owner['#seller-information'].hidden, false);
  assert.equal(owner['#buyer-actions'].hidden, true);
  owner['#preview-buyer'].click();
  assert.equal(owner['#seller-information'].hidden, true);
  assert.equal(owner['#buyer-actions'].hidden, false);
  assert.equal(owner['#seller-navigation'].hidden, true);
  assert.equal(owner['#preview-buyer'].attrs['aria-pressed'], 'true');
  assert.equal(owner['#preview-buyer'].textContent, 'Back to seller view');
  assert.equal(owner['#listing-description'].textContent, 'A textbook');
  owner['#preview-buyer'].click();
  assert.equal(owner['#seller-information'].hidden, false);
  assert.equal(owner['#seller-navigation'].hidden, false);
  assert.equal(owner['#preview-buyer'].attrs['aria-pressed'], 'false');
  assert.equal(owner['#buyer-actions'].hidden, true);
  const missing = await render('?id=8', { ok: false, status: 404, json: async () => ({}) });
  assert.match(missing['#listing-status'].textContent, /no longer available/);
  assert.equal(missing['#listing-details'].hidden, true);
  const offline = await render('?id=8', new Error('offline'));
  assert.match(offline['#listing-status'].textContent, /Refresh the page/);
});
