async function loadPurchaseHistory() {
  const purchasesStatus = document.querySelector('#purchases-status');
  const salesStatus = document.querySelector('#sales-status');
  const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  function render(rows, selector, status, empty, role) {
    const container = document.querySelector(selector);
    for (const row of rows) {
      const entry = document.createElement('div');
      const heading = document.createElement('h3');
      if (row.type === 'regular') {
        const link = document.createElement('a');
        link.href = `../listings/detail.html?id=${row.listing_id}`;
        link.textContent = row.title;
        heading.append(link);
      } else heading.textContent = row.title;
      const amount = document.createElement('p');
      amount.textContent = `${currency.format(row.amount_cents / 100)} · Order #${row.id}`;
      const person = document.createElement('p');
      person.textContent = role === 'buyer' ? `Seller: ${row.seller_name || 'Name unavailable'}` : `Buyer: ${row.buyer_name || 'Name unavailable'}`;
      const date = document.createElement('p');
      date.textContent = new Date(row.created_at).toLocaleDateString();
      entry.append(heading, amount, person, date);
      container.append(entry);
    }
    status.textContent = rows.length ? '' : empty;
  }
  try {
    const response = await fetch('/purchases/mine', { credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 401) {
      purchasesStatus.textContent = 'Log in to see your purchases.';
      salesStatus.textContent = 'Log in to see your sales.';
      return;
    }
    if (!response.ok) throw new Error('Could not load purchases');
    const data = await response.json();
    render(data.purchases, '#my-purchases', purchasesStatus, 'No purchases yet.', 'buyer');
    render(data.sales, '#my-sales', salesStatus, 'No sales yet.', 'seller');
  } catch {
    purchasesStatus.textContent = 'Could not load purchases. Refresh the page to try again.';
    salesStatus.textContent = 'Could not load sales. Refresh the page to try again.';
  }
}

loadPurchaseHistory();
