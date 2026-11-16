const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function render(search, response, account = { user: { verified: true } }) {
  const nodes = {};
  const calls = [];
  await vm.runInNewContext(fs.readFileSync('public/assets/js/purchase.js', 'utf8'), {
    document: { querySelector(id) { return nodes[id] ||= { textContent: '', hidden: true, disabled: true, addEventListener(name, fn) { this[name] = fn; } }; } },
    window: { location: { search } }, URLSearchParams, Intl,
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === '/auth/me') return { ok: Boolean(account), json: async () => account };
      if (response instanceof Error) throw response;
      return response;
    },
  });
  return { nodes, calls };
}

test('purchase summary uses server price and item, including seller preview', async () => {
  for (const isOwner of [false, true]) {
    const { nodes, calls } = await render('?id=8&price=0.01', { ok: true, json: async () => ({ isOwner, listing: {
      title: '<script>Book</script>', seller_name: 'Student', category: 'Books', description: 'Used textbook', price_cents: 1299, status: 'active',
    } }) });
    assert.equal(calls.length, isOwner ? 1 : 2);
    assert.equal(calls[0].url, '/listings/8');
    assert.equal(calls[0].options.method, undefined, 'Loading a summary does not submit a purchase');
    assert.equal(nodes['#purchase-title'].textContent, '<script>Book</script>');
    assert.equal(nodes['#purchase-total'].textContent, '$12.99');
    assert.equal(nodes['#purchase-back'].href, 'detail.html?id=8');
    assert.equal(nodes['#purchase-preview'].hidden, !isOwner);
    assert.equal(nodes['#purchase-details'].hidden, false);
    assert.equal(nodes['#confirm-purchase'].disabled, isOwner);
  }
});

test('confirmation submits the reviewed price once, displays receipt and prevents duplicate clicks', async () => {
  const nodes = {};
  const posts = [];
  let fail = true;
  let loggedOut = false;
  await vm.runInNewContext(fs.readFileSync('public/assets/js/purchase.js', 'utf8'), {
    document: { querySelector(id) { return nodes[id] ||= { hidden: true, disabled: true, addEventListener(name, fn) { this[name] = fn; } }; } },
    window: { location: { search: '?id=8' } }, URLSearchParams, Intl,
    fetch: async (url, options) => {
      if (url === '/listings/8') return { ok: true, json: async () => ({ listing: { title: 'Book', price_cents: 1299, status: 'active' } }) };
      if (url === '/auth/me') return { ok: true, json: async () => ({ user: { verified: true } }) };
      posts.push(JSON.parse(options.body));
      if (fail) throw new Error('response lost');
      if (loggedOut) return { ok: false, status: 401, json: async () => ({ error: 'Log in.' }) };
      return { ok: true, json: async () => ({ purchase: { id: 11, amount_cents: 1299 }, alreadyPurchased: true }) };
    },
  });
  const button = nodes['#confirm-purchase'];
  await button.click();
  assert.equal(button.disabled, false);
  assert.match(nodes['#purchase-status'].textContent, /Retry safely/);
  fail = false;
  const pending = button.click();
  await button.click();
  await pending;
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[1], { listingId: '8', expectedAmountCents: 1299 });
  assert.equal(nodes['#purchase-receipt'].hidden, false);
  assert.equal(nodes['#purchase-order-id'].textContent, 11);
  assert.equal(button.disabled, true);
  assert.match(nodes['#purchase-status'].textContent, /already confirmed/);
});

test('logged-out buyers see login link and sold listings cannot be confirmed', async () => {
  const available = { ok: true, json: async () => ({ listing: { title: 'Book', price_cents: 100, status: 'active' } }) };
  const guest = await render('?id=8', available, null);
  assert.equal(guest.nodes['#purchase-login'].hidden, false);
  assert.equal(guest.nodes['#confirm-purchase'].disabled, true);
  const sold = await render('?id=8', { ok: true, json: async () => ({ listing: { status: 'sold' } }) });
  assert.equal(sold.nodes['#confirm-purchase'].disabled, true);
  assert.match(sold.nodes['#purchase-status'].textContent, /no longer available/);
});

test('purchase page handles invalid IDs, unavailable listings and network failures', async () => {
  const invalid = await render('?id=abc');
  assert.equal(invalid.calls.length, 0);
  assert.match(invalid.nodes['#purchase-status'].textContent, /valid listing/);
  const missing = await render('?id=8', { ok: false, status: 404, json: async () => ({}) });
  assert.match(missing.nodes['#purchase-status'].textContent, /no longer available/);
  assert.equal(missing.nodes['#purchase-details'], undefined);
  const offline = await render('?id=8', new Error('offline'));
  assert.match(offline.nodes['#purchase-status'].textContent, /Refresh the page/);
});
