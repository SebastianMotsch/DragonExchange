async function loadRecentListings() {
  const container = document.querySelector('#recent-listings');
  const status = document.querySelector('#recent-listings-status');
  const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

  try {
    const response = await fetch('/listings', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load listings');
    const { listings } = await response.json();
    for (const listing of listings) {
      const card = document.createElement('article');
      card.className = 'listing-card';
      
            let image;
      if (listing.photo_url) {
        // The cover photo; the title right below already describes it.
        image = document.createElement('img');
        image.className = 'listing-photo';
        image.src = listing.photo_url;
        image.alt = '';
        image.loading = 'lazy';
      } else {
        image = document.createElement('div');
        image.className = 'listing-image-placeholder';
        image.textContent = 'No photos yet';
      }

      const title = document.createElement('h3');
      const link = document.createElement('a');
      link.href = `listings/detail.html?id=${listing.id}`;
      link.textContent = listing.title;
      title.append(link);
      const category = document.createElement('p');
      category.className = 'muted';
      category.textContent = listing.category;
      const price = document.createElement('p');
      price.className = 'price';
      price.textContent = currency.format(listing.price_cents / 100);
      const posted = document.createElement('p');
      posted.className = 'muted';
      const date = document.createElement('time');
      date.dateTime = listing.created_at;
      date.textContent = `Posted ${new Date(listing.created_at).toLocaleDateString()}`;
      posted.append(date);
      card.append(image, title, category, price, posted);
      container.append(card);
    }
    status.textContent = listings.length ? 'Newest listings first.' : 'No listings yet. Check back soon.';
  } catch {
    status.textContent = 'Could not load recent listings. Refresh the page to try again.';
  } finally {
    container.setAttribute('aria-busy', 'false');
  }
}

loadRecentListings();
