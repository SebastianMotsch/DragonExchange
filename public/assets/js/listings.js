const listingForm = document.querySelector('#listing-form');

if (listingForm) {
  const status = listingForm.querySelector('.status');
  const submitButton = listingForm.querySelector('button[type="submit"]');
  let submitting = false;

  listingForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting || !listingForm.reportValidity()) return;

    const fields = new FormData(listingForm);
    const listing = {
      title: fields.get('title').trim(),
      description: fields.get('description').trim(),
      category: fields.get('category'),
      price: fields.get('price'),
    };

    if (!listing.title || !listing.description) {
      status.textContent = 'Enter a title and description.';
      return;
    }

    submitting = true;
    submitButton.disabled = true;
    status.textContent = 'Creating your listing…';

    try {
      const response = await fetch(listingForm.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(listing),
      });
      const result = await response.json();
      if (!response.ok) {
        status.textContent = result.error || 'Could not create your listing. Please try again.';
        return;
      }
      listingForm.reset();
      status.textContent = 'Your listing has been created.';
    } catch {
      status.textContent = 'Could not reach the server. Please try again.';
    } finally {
      submitting = false;
      submitButton.disabled = false;
    }
  });
}
