function initializeMarketplace() {
  const filters = document.querySelector('#listing-filters');
  const container = document.querySelector('#marketplace-results');
  const status = document.querySelector('#marketplace-status');
  const previous = document.querySelector('#marketplace-previous');
  const next = document.querySelector('#marketplace-next');
  let requestId = 0;
  const filterToggle = document.querySelector('#listing-filter-toggle');
  const filterPanel = document.querySelector('#listing-filter-panel');
  const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

  filterToggle.addEventListener('click', () => {
    filterPanel.hidden = !filterPanel.hidden;
    filterToggle.setAttribute('aria-expanded', String(!filterPanel.hidden));
  });

  function loadFromLocation() {
    const params = new URLSearchParams(window.location.search);
    for (const field of filters.elements) {
      if (field.name) field.value = params.get(field.name) ?? field.defaultValue ?? (field.name === 'sort' ? 'newest' : '');
    }
    return loadResults(params);
  }

  filters.addEventListener('submit', event => {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const field of filters.elements) {
      if (field.name && field.value && !(field.name === 'sort' && field.value === 'newest')) {
        params.set(field.name, field.value);
      }
    }
    const query = params.toString();
    const url = window.location.pathname + (query ? '?' + query : '') + window.location.hash;
    if (window.location.search !== (query ? '?' + query : '')) {
      window.history.pushState(null, '', url);
    }
    return loadResults(params);
  });
  window.addEventListener('popstate', loadFromLocation);

  async function loadResults(params) {
    const id = ++requestId;
    const activeFilters = ['category', 'type', 'min', 'max', 'sort'].filter(name => {
      const value = params.get(name);
      return value && !(name === 'sort' && value === 'newest');
    }).length;
    filterToggle.textContent = activeFilters ? 'Filters (' + activeFilters + ')' : 'Filters';
    container.setAttribute('aria-busy', 'true');
    container.replaceChildren();
    previous.hidden = true;
    next.hidden = true;
    status.textContent = 'Loading listings…';
    function pageLink(link, page) {
      const query = new URLSearchParams(params);
      query.set('page', page);
      link.href = '?' + query.toString();
      link.hidden = false;
    }

    try {
      const response = await fetch('/api/marketplace?' + params.toString());
      const { listings, hasMore, error } = await response.json();
      if (id !== requestId) return;
      if (!response.ok) {
        status.textContent = error || 'Could not load listings. Refresh the page to try again.';
        return;
      }
      for (const listing of listings) {
        const auction = listing.sale_type === 'auction';
        const card = document.createElement('article');
        card.className = 'listing-card';
        const image = document.createElement('div');
        image.className = 'listing-image-placeholder';
        image.textContent = 'No photo';
        const title = document.createElement('h3');
        const link = document.createElement('a');
        link.href = (auction ? 'auctions' : 'listings') + '/detail.html?id=' + listing.id;
        link.textContent = listing.title;
        title.append(link);
        const category = document.createElement('p');
        category.className = 'muted';
        category.textContent = listing.category + (auction ? ' · Auction' : ' · Buy now');
        const price = document.createElement('p');
        price.className = 'price';
        price.textContent = currency.format(listing.price_cents / 100);
        const timing = document.createElement('p');
        timing.className = 'muted';
        const date = document.createElement('time');
        date.dateTime = auction ? listing.ends_at : listing.created_at;
        const timestamp = new Date(date.dateTime);
        date.textContent = auction ? 'Ends ' + timestamp.toLocaleString() : 'Posted ' + timestamp.toLocaleDateString();
        timing.append(date);
        card.append(image, title, category, price, timing);
        container.append(card);
      }
      const page = Number(params.get('page') || 1);
      status.textContent = listings.length
        ? 'Page ' + page + ' · ' + listings.length + (listings.length === 1 ? ' listing' : ' listings')
        : 'No listings match these filters.';
      if (page > 1) pageLink(previous, page - 1);
      if (hasMore) pageLink(next, page + 1);
    } catch {
      if (id === requestId) status.textContent = 'Could not load listings. Try searching again.';
    } finally {
      if (id === requestId) container.setAttribute('aria-busy', 'false');
    }
  }

  return loadFromLocation();
}

initializeMarketplace();