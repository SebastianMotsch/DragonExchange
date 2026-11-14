const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function render(response) {
  const nodes = {};
  function element() { return { children: [], textContent: '', append(...items) { this.children.push(...items); } }; }
  await vm.runInNewContext(fs.readFileSync('public/assets/js/purchase-history.js', 'utf8'), {
    document: { querySelector(id) { return nodes[id] ||= element(); }, createElement: element }, Intl, Date,
    fetch: async () => { if (response instanceof Error) throw response; return response; },
  });
  return nodes;
}

test('dashboard shows purchase and sale snapshots with detail links and safe text', async () => {
  const order = { id: 9, listing_id: 8, type: 'regular', title: '<script>Book</script>', amount_cents: 1299, seller_name: 'Seller', buyer_name: 'Buyer', created_at: '2026-11-14T12:00:00Z' };
  const nodes = await render({ ok: true, json: async () => ({ purchases: [order], sales: [order] }) });
  for (const id of ['#my-purchases', '#my-sales']) {
    const entry = nodes[id].children[0];
    assert.equal(entry.children[0].children[0].textContent, '<script>Book</script>');
    assert.equal(entry.children[0].children[0].href, '../listings/detail.html?id=8');
    assert.equal(entry.children[1].textContent, '$12.99 · Order #9');
  }
  assert.equal(nodes['#my-purchases'].children[0].children[2].textContent, 'Seller: Seller');
  assert.equal(nodes['#my-sales'].children[0].children[2].textContent, 'Buyer: Buyer');
});

test('history provides empty, logged-out and failure states', async () => {
  const empty = await render({ ok: true, json: async () => ({ purchases: [], sales: [] }) });
  assert.equal(empty['#purchases-status'].textContent, 'No purchases yet.');
  assert.equal(empty['#sales-status'].textContent, 'No sales yet.');
  const guest = await render({ status: 401 });
  assert.match(guest['#purchases-status'].textContent, /Log in/);
  assert.match(guest['#sales-status'].textContent, /Log in/);
  const failed = await render(new Error('offline'));
  assert.match(failed['#purchases-status'].textContent, /Refresh the page/);
  assert.match(failed['#sales-status'].textContent, /Refresh the page/);
});
