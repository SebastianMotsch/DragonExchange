async function loadListingDetail() {
  const status = document.querySelector('#listing-status');
  const details = document.querySelector('#listing-details');
  const id = new URLSearchParams(window.location.search).get('id');
  if (!id || !/^[1-9]\d*$/.test(id) || Number(id) > 2147483647) {
    status.textContent = 'Choose a valid listing to view.';
    return;
  }

  try {
    const response = await fetch(`/listings/${id}`, { cache: 'no-store', credentials: 'same-origin' });
    const data = await response.json();
    if (!response.ok) {
      status.textContent = response.status === 404
        ? 'This listing is no longer available or does not exist.'
        : 'Could not load this listing. Refresh the page to try again.';
      return;
    }
    const listing = data.listing;
    document.querySelector('#buy-now').href = `purchase.html?id=${id}`;
    document.title = `${listing.title} | DragonExchange`;
    document.querySelector('#listing-title').textContent = listing.title;
    document.querySelector('#listing-price').textContent = new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD',
    }).format(listing.price_cents / 100);
    document.querySelector('#listing-category').textContent = listing.category;
    document.querySelector('#listing-seller').textContent = listing.seller_name || 'Seller name unavailable';
    document.querySelector('#listing-state').textContent = listing.status === 'sold' ? 'Sold' : 'Active';
    document.querySelector('#listing-description').textContent = listing.description;
    const date = document.querySelector('#listing-date');
    date.dateTime = listing.created_at;
    date.textContent = new Date(listing.created_at).toLocaleDateString();
    if (listing.photos && listing.photos.length) showPhotos(listing.photos, listing.title);
    details.hidden = false;
    status.textContent = '';
    const buyerActions = document.querySelector('#buyer-actions');
    buyerActions.hidden = Boolean(data.isOwner) || listing.status === 'sold';
    if (data.isOwner) {
      const navigation = document.querySelector('#seller-navigation');
      const sellerInformation = document.querySelector('#seller-information');
      const button = document.querySelector('#preview-buyer');
      const previewStatus = document.querySelector('#preview-status');
      document.querySelector('#seller-preview-controls').hidden = false;
      navigation.hidden = false;
      sellerInformation.hidden = false;
      let previewing = false;
      button.addEventListener('click', () => {
        previewing = !previewing;
        navigation.hidden = previewing;
        sellerInformation.hidden = previewing;
        buyerActions.hidden = !previewing || listing.status === 'sold';
        button.textContent = previewing ? 'Back to seller view' : 'Preview as buyer';
        button.setAttribute('aria-pressed', String(previewing));
        previewStatus.textContent = previewing ? 'Buyer preview — this is how other users see your listing.' : '';
      });
    }
  } catch {
    status.textContent = 'Could not load this listing. Refresh the page to try again.';
  }
}

// Shows the cover photo large, with clickable thumbnails when there is more than one.
function showPhotos(photos, title) {
  const main = document.querySelector('#listing-photo');
  const thumbnails = document.querySelector('#listing-thumbnails');
  document.querySelector('#listing-photo-placeholder').hidden = true;
  main.src = photos[0];
  main.alt = `${title}, photo 1 of ${photos.length}`;
  main.hidden = false;
  if (photos.length < 2) return;

  photos.forEach((url, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'thumbnail';
    button.setAttribute('aria-label', `Show photo ${index + 1} of ${photos.length}`);
    button.setAttribute('aria-pressed', String(index === 0));
    const image = document.createElement('img');
    image.src = url;
    image.alt = '';
    button.append(image);
    button.addEventListener('click', () => {
      main.src = url;
      main.alt = `${title}, photo ${index + 1} of ${photos.length}`;
      thumbnails.querySelectorAll('button').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    });
    thumbnails.append(button);
  });
  thumbnails.hidden = false;
}

loadListingDetail();
