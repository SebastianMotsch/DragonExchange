const MAX_PHOTOS = 5;
const MAX_SIZE = 5 * 1024 * 1024;

function getImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    return null;
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }

  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "png";
  }

  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "webp";
  }

  return null;
}

function validatePhotos(files) {
  if (!Array.isArray(files)) {
    return "Photos must be sent as a list.";
  }

  if (files.length > MAX_PHOTOS) {
    return "You can upload up to " + MAX_PHOTOS + " photos.";
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (!file || !Buffer.isBuffer(file.buffer)) {
      return "Photo " + (i + 1) + " could not be read.";
    }

    if (file.buffer.length > MAX_SIZE) {
      return "Photo " + (i + 1) + " is larger than 5 MB.";
    }

    if (getImageType(file.buffer) === null) {
      return "Photo " + (i + 1) + " must be a JPEG, PNG, or WebP image.";
    }
  }

  return null;
}

module.exports = { MAX_PHOTOS, MAX_SIZE, getImageType, validatePhotos };
