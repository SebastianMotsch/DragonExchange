async function loadPurchase() {
  const status = document.querySelector('#purchase-status');
  const button = document.querySelector('#confirm-purchase');
  const login = document.querySelector('#purchase-login');
  const id = new URLSearchParams(window.location.search).get('id');
  if (!id || !/^[1-9]\d*$/.test(id) || Number(id) > 2147483647) {
    status.textContent = 'Choose a valid listing before purchasing.';
    return;
  }
  const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  let submitting = false;
  let purchased = false;
  let unavailable = false;
  let amountCents;
  try {
    const response = await fetch(`/listings/${id}`, { credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) {
      status.textContent = response.status === 404
        ? 'This item is no longer available or does not exist.'
        : 'Could not load your item. Refresh the page to try again.';
      return;
    }
    const listing = data.listing;
    amountCents = listing.price_cents;
    const price = currency.format(amountCents / 100);
    document.title = `Purchase ${listing.title} | DragonExchange`;
    document.querySelector('#purchase-title').textContent = listing.title;
    document.querySelector('#purchase-seller').textContent = listing.seller_name || 'Seller name unavailable';
    document.querySelector('#purchase-category').textContent = listing.category;
    document.querySelector('#purchase-description').textContent = listing.description;
    document.querySelector('#purchase-price').textContent = price;
    document.querySelector('#purchase-total').textContent = price;
    document.querySelector('#purchase-back').href = `detail.html?id=${id}`;
    document.querySelector('#purchase-preview').hidden = !data.isOwner;
    document.querySelector('#purchase-details').hidden = false;
    if (data.isOwner) {
      status.textContent = 'You cannot purchase your own listing.';
      return;
    }
    if (listing.status !== 'active') {
      status.textContent = 'This item is no longer available for purchase.';
      return;
    }
    const accountResponse = await fetch('/auth/me', { credentials: 'same-origin', cache: 'no-store' });
    if (!accountResponse.ok) {
      login.hidden = false;
      status.textContent = 'Log in to confirm your purchase.';
      return;
    }
    const account = await accountResponse.json();
    if (!account.user?.verified) {
      status.textContent = 'A verified account is required to purchase an item.';
      return;
    }
    button.disabled = false;
    status.textContent = '';
  } catch {
    status.textContent = 'Could not load your item. Refresh the page to try again.';
    return;
  }

  button.addEventListener('click', async () => {
    if (submitting || purchased || unavailable || button.disabled) return;
    submitting = true;
    button.disabled = true;
    status.textContent = 'Confirming your purchase…';
    try {
      const response = await fetch('/purchases', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId: id, expectedAmountCents: amountCents }),
      });
      const data = await response.json();
      if (!response.ok) {
        status.textContent = data.error || 'Could not confirm your purchase. Please try again.';
        if (response.status === 401) login.hidden = false;
        unavailable = [401, 403, 404, 409].includes(response.status);
        return;
      }
      purchased = true;
      document.querySelector('#purchase-order-id').textContent = data.purchase.id;
      document.querySelector('#purchase-receipt').hidden = false;
      const price = currency.format(data.purchase.amount_cents / 100);
      document.querySelector('#purchase-price').textContent = price;
      document.querySelector('#purchase-total').textContent = price;
      button.textContent = 'Purchased';
      status.textContent = data.alreadyPurchased ? 'This purchase was already confirmed.' : 'Purchase confirmed. The item is now sold.';
    } catch {
      status.textContent = 'Could not confirm the result. Retry safely or check My purchases on your dashboard.';
    } finally {
      submitting = false;
      button.disabled = purchased || unavailable;
    }
  });
}

loadPurchase();
