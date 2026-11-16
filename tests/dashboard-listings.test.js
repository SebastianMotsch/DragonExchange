const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const express = require('express');

test('seller listings require a session and use its user ID instead of query parameters', async t => {
  const calls = [];
  let rows = [{ id: 12, title: 'Textbook', price_cents: 2500 }];
  let failing = false;
  const db = { query: async (sql, values) => {
    calls.push({ sql, values });
    if (failing) throw Object.assign(new Error('private details'), { code: 'TEST' });
    return { rows };
  } };
  const moduleObject = { exports: {} };
  vm.runInNewContext(fs.readFileSync('routes/listings.js', 'utf8'), {
    require: name => name === '../db' ? db : require(name),
    module: moduleObject, console: { error() {} }, process: { env: { LOCAL_AUTH: 'true' } },
  });
  const app = express();
  app.use((req, res, next) => {
    if (req.headers['x-test-user']) req.session = { userId: Number(req.headers['x-test-user']) };
    next();
  });
  app.use('/listings', moduleObject.exports);
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve(listener));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const guest = await fetch(`${base}/listings/mine?seller_id=99`);
  assert.equal(guest.status, 401);
  assert.equal((await guest.json()).loginUrl, '/auth/login.html');
  assert.equal(calls.length, 0);
  const mine = await fetch(`${base}/listings/mine?seller_id=99`, { headers: { 'x-test-user': '7' } });
  assert.equal(mine.status, 200);
  assert.equal(mine.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await mine.json()).listings, rows);
  assert.deepEqual(Array.from(calls[0].values), [7]);
  assert.match(calls[0].sql, /seller_id = \$1 AND type = 'regular' AND status = 'active'/);
  assert.match(calls[0].sql, /ORDER BY created_at DESC, id DESC/);
  await fetch(`${base}/listings/mine`, { headers: { 'x-test-user': '8' } });
  assert.deepEqual(Array.from(calls[1].values), [8]);
  rows = [];
  const empty = await fetch(`${base}/listings/mine`, { headers: { 'x-test-user': '7' } });
  assert.deepEqual(await empty.json(), { listings: [] });
  failing = true;
  const failed = await fetch(`${base}/listings/mine`, { headers: { 'x-test-user': '7' } });
  assert.equal(failed.status, 500);
  assert.ok(!JSON.stringify(await failed.json()).includes('private details'));
});

test('dashboard renders safe listing text, prices, empty state, login and refresh instructions', async () => {
  function element() {
    return {
      children: [], attrs: {}, dataset: {}, hidden: false, textContent: '',
      append(...children) { this.children.push(...children); },
      replaceChildren() { this.children = []; },
      setAttribute(key, value) { this.attrs[key] = value; },
      addEventListener(name, handler) { this[name] = handler; },
    };
  }
  const nodes = Object.fromEntries(['#current-listings', '#listings-status', '#listings-login', '#listings-view-all'].map(id => [id, element()]));
  nodes['#current-listings'].dataset.limit = '5';
  let load;
  let response;
  let offline = false;
  let confirmed = false;
  const deleteRequests = [];
  let deleteResponse = { ok: true, json: async () => ({ message: 'Listing deleted.' }) };
  vm.runInNewContext(fs.readFileSync('public/assets/js/dashboard.js', 'utf8'), {
    document: { querySelector: id => nodes[id], createElement: element },
    window: { confirm: () => confirmed, addEventListener: (name, handler, options) => { assert.equal(name, 'load'); assert.equal(options.once, true); load = handler; } },
    fetch: async (url, options) => {
      if (offline) throw new Error('offline');
      if (options.method === 'DELETE') { deleteRequests.push(url); return deleteResponse; }
      return response;
    }, Intl,
  });
  response = { ok: true, status: 200, json: async () => ({ listings: [{ title: '<img onerror=alert(1)>', description: 'Used', category: 'Books', price_cents: 1299 }] }) };
  await load();
  const card = nodes['#current-listings'].children[0];
  assert.equal(card.children[0].children[0].textContent, '<img onerror=alert(1)>');
  assert.equal(card.children[3].textContent, '$12.99');
  assert.equal(nodes['#listings-status'].textContent, '1 active listing.');
  const addCard = nodes['#current-listings'].children.at(-1);
  assert.equal(addCard.attrs['aria-label'], 'Create a regular listing');
  assert.equal(addCard.href, '../listings/create.html');
  assert.equal(addCard.children[0].textContent, '+');
  assert.equal(nodes['#listings-view-all'].hidden, true);
  const listings = Array.from({ length: 6 }, (_, id) => ({ id, title: `Item ${id}`, price_cents: 100, category: 'Books', description: 'Used' }));
  response.json = async () => ({ listings: listings.slice(0, 5) });
  await load();
  assert.equal(nodes['#current-listings'].children.length, 6);
  assert.equal(nodes['#listings-view-all'].hidden, true);
  response.json = async () => ({ listings });
  await load();
  assert.equal(nodes['#current-listings'].children.length, 6);
  assert.equal(nodes['#current-listings'].children[4].children[0].children[0].textContent, 'Item 4');
  assert.equal(nodes['#listings-view-all'].hidden, false);
  assert.equal(nodes['#listings-status'].textContent, 'Showing 5 of 6 active listings.');

  const deleteButton = nodes['#current-listings'].children[0].children.at(-1);
  await deleteButton.click();
  assert.equal(deleteRequests.length, 0, 'Cancel leaves the listing intact');
  confirmed = true;
  deleteResponse = { ok: false, json: async () => ({ error: 'Could not delete your listing.' }) };
  await deleteButton.click();
  assert.equal(nodes['#current-listings'].children.length, 6);
  assert.equal(deleteButton.disabled, false);
  assert.match(nodes['#listings-status'].textContent, /Could not delete/);
  deleteResponse = { ok: true, json: async () => ({ message: 'Listing deleted.' }) };
  await deleteButton.click();
  assert.equal(deleteRequests.at(-1), '/listings/0');
  assert.equal(nodes['#current-listings'].children[0].children[0].children[0].textContent, 'Item 1');
  assert.equal(nodes['#current-listings'].children[4].children[0].children[0].textContent, 'Item 5');
  assert.equal(nodes['#listings-view-all'].hidden, true);
  assert.match(nodes['#listings-status'].textContent, /Listing deleted/);

  // The separate page has no limit and reuses the same renderer.
  const allNodes = Object.fromEntries(['#current-listings', '#listings-status', '#listings-login'].map(id => [id, element()]));
  let loadAll;
  vm.runInNewContext(fs.readFileSync('public/assets/js/dashboard.js', 'utf8'), {
    document: { querySelector: id => allNodes[id], createElement: element },
    window: { addEventListener: (_, handler) => { loadAll = handler; } },
    fetch: async () => response, Intl,
  });
  await loadAll();
  assert.equal(allNodes['#current-listings'].children.length, 7);
  assert.equal(allNodes['#listings-status'].textContent, '6 active listings.');
  response.json = async () => ({ listings: [] });
  await load();
  assert.equal(nodes['#current-listings'].children.length, 1);
  assert.match(nodes['#listings-status'].textContent, /no current listings/);
  response = { status: 401, json: async () => ({ loginUrl: '/auth/login.html' }) };
  await load();
  assert.equal(nodes['#listings-login'].hidden, false);
  assert.equal(nodes['#listings-login'].href, '/auth/login.html');
  offline = true;
  await load();
  assert.match(nodes['#listings-status'].textContent, /Refresh the page/);
  assert.equal(nodes['#current-listings'].attrs['aria-busy'], 'false');
  offline = false;
  response = { ok: true, status: 200, json: async () => ({ listings: [] }) };
  await load();
  assert.match(nodes['#listings-status'].textContent, /no current listings/);
});

test('deletion validates IDs and atomically restricts deletion to the logged-in seller', async () => {
  let handler;
  const calls = [];
  let result = { rowCount: 1 };
  let failure;
  vm.runInNewContext(fs.readFileSync('routes/listings.js', 'utf8'), {
    require: name => name === 'express'
      ? { Router: () => ({ get() {}, post() {}, delete(path, fn) { handler = fn; } }) }
      : { query: async (sql, values) => { calls.push({ sql, values }); if (failure) throw failure; return result; } },
    module: {}, console: { error() {} },
  });
  async function remove(id, userId) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ params: { id }, session: userId ? { userId } : undefined }, res);
    return res;
  }
  assert.equal((await remove('12')).statusCode, 401);
  for (const id of ['0', '-1', 'abc', '1 OR 1=1', '2147483648']) {
    assert.equal((await remove(id, 7)).statusCode, 400);
  }
  assert.equal(calls.length, 0);
  assert.equal((await remove('12', 7)).statusCode, 200);
  assert.deepEqual(Array.from(calls[0].values), [12, 7]);
  assert.match(calls[0].sql, /WHERE id = \$1 AND seller_id = \$2 AND type = 'regular' AND status = 'active'/);
  result = { rowCount: 0 };
  assert.equal((await remove('12', 8)).statusCode, 404);
  failure = { code: '23503' };
  assert.equal((await remove('12', 7)).statusCode, 409);
  failure = { code: 'TEST', message: 'private details' };
  const failed = await remove('12', 7);
  assert.equal(failed.statusCode, 500);
  assert.ok(!JSON.stringify(failed.body).includes('private details'));
});
