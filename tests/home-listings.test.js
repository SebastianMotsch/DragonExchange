const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('recent listings are public, limited and sorted newest first, with safe database errors', async () => {
  let handler;
  let query;
  let rows = [{ id: 8, title: 'Book', price_cents: 1200 }];
  let fail = false;
  vm.runInNewContext(fs.readFileSync('routes/listings.js', 'utf8'), {
    require: name => name === 'express'
      ? { Router: () => ({ get(path, fn) { if (path === '/') handler = fn; }, post() {}, delete() {} }) }
      : { query: async sql => { query = sql; if (fail) throw { code: 'TEST', message: 'private detail' }; return { rows }; } },
    module: {}, console: { error() {} },
  });
  async function load() {
    const res = { code: 200, set() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({}, res);
    return res;
  }
  assert.equal((await load()).body.listings[0].id, 8);
  assert.match(query, /type = 'regular' AND status = 'active'/);
  assert.match(query, /ORDER BY created_at DESC, id DESC\s+LIMIT 6/);
  assert.doesNotMatch(query, /seller_id|password|email/);
  rows = [];
  assert.equal((await load()).body.listings.length, 0);
  fail = true;
  const failed = await load();
  assert.equal(failed.code, 500);
  assert.ok(!JSON.stringify(failed.body).includes('private detail'));
});

test('home renders real listing links, safe text, prices, empty and failed states', async () => {
  function element() {
    return { children: [], textContent: '', attrs: {}, append(...nodes) { this.children.push(...nodes); }, setAttribute(key, value) { this.attrs[key] = value; } };
  }
  async function render(response) {
    const container = element();
    const status = element();
    await vm.runInNewContext(fs.readFileSync('public/assets/js/home.js', 'utf8'), {
      document: { querySelector: id => id === '#recent-listings' ? container : status, createElement: element },
      Intl, Date, fetch: async () => { if (response instanceof Error) throw response; return response; },
    });
    return { container, status };
  }
  const loaded = await render({ ok: true, json: async () => ({ listings: [{ id: 8, title: '<script>unsafe</script>', category: 'Books', price_cents: 1299, created_at: '2026-11-14T12:00:00Z' }] }) });
  const card = loaded.container.children[0];
  assert.equal(card.children[1].children[0].textContent, '<script>unsafe</script>');
  assert.equal(card.children[1].children[0].href, 'listings/detail.html?id=8');
  assert.equal(card.children[3].textContent, '$12.99');
  assert.equal(loaded.container.attrs['aria-busy'], 'false');
  const empty = await render({ ok: true, json: async () => ({ listings: [] }) });
  assert.match(empty.status.textContent, /No listings yet/);
  for (const response of [{ ok: false }, new Error('offline')]) {
    const failed = await render(response);
    assert.match(failed.status.textContent, /Refresh the page/);
    assert.equal(failed.container.attrs['aria-busy'], 'false');
  }
});
