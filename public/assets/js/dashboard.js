const currentListings = document.querySelector('#current-listings');

if (currentListings) {
  const status = document.querySelector('#listings-status');
  const login = document.querySelector('#listings-login');
  const viewAll = document.querySelector('#listings-view-all');
  const limit = Number(currentListings.dataset.limit) || Infinity;
  const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

  let savedListings = [];

  function renderListings(listings) {
    currentListings.replaceChildren();
    const visibleListings = listings.slice(0, limit);
    for (const listing of visibleListings) {
      const card = document.createElement('article');
      const title = document.createElement('h3');
      const detailLink = document.createElement('a');
      detailLink.href = `../listings/detail.html?id=${listing.id}`;
      detailLink.textContent = listing.title;
      title.append(detailLink);
      const description = document.createElement('p');
      description.textContent = listing.description;
      const category = document.createElement('p');
      category.textContent = listing.category;
      const price = document.createElement('p');
      price.textContent = currency.format(listing.price_cents / 100);
      const state = document.createElement('p');
      state.textContent = 'Status: Active';
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'delete-listing';
      deleteButton.textContent = 'Delete';
      deleteButton.setAttribute('aria-label', `Delete ${listing.title}`);
      deleteButton.addEventListener('click', () => deleteListing(listing, deleteButton));
      card.append(title, description, category, price, state, deleteButton);
      currentListings.append(card);
    }
    const addListing = document.createElement('a');
    addListing.className = 'add-listing-card';
    addListing.href = '../listings/create.html';
    addListing.setAttribute('aria-label', 'Create a regular listing');
    addListing.title = 'Create a regular listing';
    const plus = document.createElement('span');
    plus.setAttribute('aria-hidden', 'true');
    plus.textContent = '+';
    addListing.append(plus);
    currentListings.append(addListing);

    const count = listings.length;
    if (viewAll) viewAll.hidden = count <= limit;
    status.textContent = count === 0
      ? 'You have no current listings. Use the + button to add one.'
      : count > limit
        ? `Showing ${visibleListings.length} of ${count} active listings.`
        : `${count} active ${count === 1 ? 'listing' : 'listings'}.`;
  }

  async function deleteListing(listing, button) {
    if (button.disabled || !window.confirm(`Delete "${listing.title}"? This cannot be undone.`)) return;
    button.disabled = true;
    button.textContent = 'Deleting…';
    try {
      const response = await fetch(`/listings/${listing.id}`, {
        method: 'DELETE', credentials: 'same-origin',
      });
      const data = await response.json();
      if (!response.ok) {
        status.textContent = data.error || 'Could not delete your listing.';
        return;
      }
      savedListings = savedListings.filter(item => item.id !== listing.id);
      renderListings(savedListings);
      status.textContent = `Listing deleted. ${status.textContent}`;
    } catch {
      status.textContent = 'Could not confirm deletion. Refresh the page to check your listings.';
    } finally {
      button.disabled = false;
      button.textContent = 'Delete';
    }
  }

  async function loadListings() {
    currentListings.replaceChildren();
    currentListings.setAttribute('aria-busy', 'true');
    login.hidden = true;
    if (viewAll) viewAll.hidden = true;
    status.textContent = 'Loading your listings…';

    try {
      const response = await fetch('/listings/mine', { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json();
      if (response.status === 401) {
        status.textContent = 'Log in to see your current listings.';
        login.href = '/auth/login.html';
        login.hidden = false;
        return;
      }
      if (!response.ok) throw new Error('Could not load listings');

      savedListings = data.listings;
      renderListings(savedListings);
    } catch {
      status.textContent = 'Could not load your listings. Refresh the page to try again.';
    } finally {
      currentListings.setAttribute('aria-busy', 'false');
    }
  }

  window.addEventListener('load', loadListings, { once: true });
}
