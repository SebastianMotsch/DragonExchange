const listingForm = document.querySelector('#listing-form');
const MAX_PHOTOS = 5;
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Returns a message for the first problem with the chosen photos, or '' if they look fine.
// The server checks the real file contents again before saving anything.
function photoProblem(photos) {
  if (photos.length > MAX_PHOTOS) return `You can upload up to ${MAX_PHOTOS} photos.`;
  for (let i = 0; i < photos.length; i++) {
    if (!PHOTO_TYPES.includes(photos[i].type)) return `Photo ${i + 1} must be a JPEG, PNG, or WebP image.`;
    if (photos[i].size > MAX_PHOTO_SIZE) return `Photo ${i + 1} is larger than 5 MB.`;
  }
  return '';
}

if (listingForm) {
  const status = listingForm.querySelector('.status');
  const submitButton = listingForm.querySelector('button[type="submit"]');
  const photoInput = listingForm.querySelector('input[name="photos"]');
  const previews = document.querySelector('#photo-previews');
  let previewUrls = [];
  let submitting = false;

  // Show small previews of the chosen photos, in upload order.
  photoInput.addEventListener('change', () => {
    previewUrls.forEach(url => URL.revokeObjectURL(url));
    previewUrls = [];
    previews.replaceChildren();
    const photos = Array.from(photoInput.files);
    status.textContent = photoProblem(photos);
    photos.slice(0, MAX_PHOTOS).forEach((photo, index) => {
      if (!PHOTO_TYPES.includes(photo.type)) return;
      const url = URL.createObjectURL(photo);
      previewUrls.push(url);
      const image = document.createElement('img');
      image.src = url;
      image.alt = index === 0 ? `Cover photo: ${photo.name}` : `Photo ${index + 1}: ${photo.name}`;
      previews.append(image);
    });
    previews.hidden = previewUrls.length === 0;
  });

  listingForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting || !listingForm.reportValidity()) return;

    const fields = new FormData(listingForm);
    const title = fields.get('title').trim();
    const description = fields.get('description').trim();
    if (!title || !description) {
      status.textContent = 'Enter a title and description.';
      return;
    }
    fields.set('title', title);
    fields.set('description', description);

    // An empty file input still adds a blank entry; send only real photos.
    const photos = fields.getAll('photos').filter(photo => photo.size > 0);
    const problem = photoProblem(photos);
    if (problem) {
      status.textContent = problem;
      return;
    }
    fields.delete('photos');
    photos.forEach(photo => fields.append('photos', photo));

    submitting = true;
    submitButton.disabled = true;
    status.textContent = photos.length ? 'Uploading your photos and creating your listing…' : 'Creating your listing…';

    try {
      // Sending FormData lets the browser set the multipart Content-Type header.
      const response = await fetch(listingForm.action, {
        method: 'POST',
        credentials: 'same-origin',
        body: fields,
      });
      const result = await response.json();
      if (!response.ok) {
        status.textContent = result.error || 'Could not create your listing. Please try again.';
        return;
      }
      status.textContent = 'Your listing has been created. Opening it…';
      window.location.assign(`detail.html?id=${result.listing.id}`);
    } catch {
      status.textContent = 'Could not reach the server. Please try again.';
    } finally {
      submitting = false;
      submitButton.disabled = false;
    }
  });
}