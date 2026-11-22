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

test('home restores filters, links to each sale type, and renders text safely', async () => {
  function element() {
    return { children: [], textContent: '', attrs: {}, append(...nodes) { this.children.push(...nodes); }, replaceChildren() { this.children = []; }, setAttribute(key, value) { this.attrs[key] = value; } };
  }
  async function render(response) {
    const container = element();
    const status = element();
    const next = element();
    const keyword = { name: 'q' };
    const category = { name: 'category' };
    const form = { elements: [keyword, category], addEventListener(event, listener) { this[event] = listener; } };
    const requests = [];
    const history = [];
    const panel = { hidden: true };
    const toggle = {
      ...element(),
      addEventListener(event, listener) { this[event] = listener; },
    };
    const nodes = {
      '#listing-filters': form,
      '#listing-filter-panel': panel,
      '#listing-filter-toggle': toggle,
      '#marketplace-results': container,
      '#marketplace-status': status,
      '#marketplace-next': next,
      '#marketplace-previous': element(),
    };
    await vm.runInNewContext(fs.readFileSync('public/assets/js/home.js', 'utf8'), {
      document: { querySelector: id => nodes[id], createElement: element },
      window: {
        location: { search: '?q=Book', pathname: '/', hash: '' },
        history: { pushState(_, __, url) { history.push(url); } },
        addEventListener() {},
      },
      URLSearchParams, Intl, Date,
      fetch: async url => {
        requests.push(url);
        if (response instanceof Error) throw response;
        return response;
      },
    });
    return { container, status, next, keyword, category, panel, toggle, form, requests, history };
  }
  const loaded = await render({ ok: true, json: async () => ({ hasMore: true, listings: [
    { id: 8, title: '<em>Book</em>', category: 'Books', price_cents: 1299, created_at: '2026-11-14T12:00:00Z' },
    { id: 8, title: 'Auction', category: 'Books', price_cents: 2500, sale_type: 'auction', ends_at: '2026-11-15T12:00:00Z' },
  ] }) });
  const card = loaded.container.children[0];
  assert.equal(card.children[1].children[0].textContent, '<em>Book</em>');
  assert.equal(card.children[1].children[0].href, 'listings/detail.html?id=8');
  assert.equal(card.children[3].textContent, '$12.99');
  assert.equal(loaded.container.attrs['aria-busy'], 'false');
  assert.equal(loaded.container.children[1].children[1].children[0].href, 'auctions/detail.html?id=8');
  assert.equal(loaded.keyword.value, 'Book');
  assert.equal(loaded.next.href, '?q=Book&page=2');
  assert.equal(loaded.panel.hidden, true);
  loaded.toggle.click();
  assert.equal(loaded.panel.hidden, false);
  assert.equal(loaded.toggle.attrs['aria-expanded'], 'true');
  loaded.category.value = 'Books';
  let prevented = false;
  await loaded.form.submit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(loaded.panel.hidden, false);
  assert.deepEqual(loaded.history, ['/?q=Book&category=Books']);
  assert.deepEqual(loaded.requests, ['/api/marketplace?q=Book', '/api/marketplace?q=Book&category=Books']);
  assert.equal(loaded.container.children.length, 2);
  loaded.toggle.click();
  assert.equal(loaded.panel.hidden, true);
  assert.equal(loaded.toggle.attrs['aria-expanded'], 'false');
  const empty = await render({ ok: true, json: async () => ({ listings: [] }) });
  assert.match(empty.status.textContent, /No listings match/);
  for (const response of [{ ok: false }, new Error('offline')]) {
    const failed = await render(response);
    assert.match(failed.status.textContent, /Try searching again|Refresh the page/);
    assert.equal(failed.container.attrs['aria-busy'], 'false');
  }
});
