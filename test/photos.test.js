const { test } = require("node:test");
const assert = require("node:assert/strict");
const { MAX_PHOTOS, MAX_SIZE, getImageType, validatePhotos } = require("../lib/photos");

function makeFile(name, startBytes, size) {
  const buffer = Buffer.alloc(size || 100);
  for (let i = 0; i < startBytes.length; i++) {
    buffer[i] = startBytes[i];
  }
  return { originalname: name, buffer: buffer };
}

function jpeg(name, size) {
  return makeFile(name || "photo.jpg", [0xff, 0xd8, 0xff, 0xe0], size);
}

function png(name) {
  return makeFile(name || "photo.png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function webp(name) {
  const file = makeFile(name || "photo.webp", []);
  file.buffer.write("RIFF", 0, "ascii");
  file.buffer.write("WEBP", 8, "ascii");
  return file;
}

test("detects JPEG, PNG, and WebP from the file bytes", function () {
  assert.equal(getImageType(jpeg().buffer), "jpeg");
  assert.equal(getImageType(png().buffer), "png");
  assert.equal(getImageType(webp().buffer), "webp");
});

test("accepts valid photos", function () {
  assert.equal(validatePhotos([jpeg(), png(), webp()]), null);
});

test("accepts a listing with no photos", function () {
  assert.equal(validatePhotos([]), null);
});

test("rejects photos that are not sent as a list", function () {
  assert.equal(validatePhotos(jpeg()), "Photos must be sent as a list.");
});

test("rejects too many photos", function () {
  const files = [];
  for (let i = 0; i < MAX_PHOTOS + 1; i++) {
    files.push(jpeg());
  }
  assert.equal(validatePhotos(files), "You can upload up to 5 photos.");
});

test("rejects a photo over 5 MB", function () {
  assert.equal(validatePhotos([jpeg("big.jpg", MAX_SIZE + 1)]), "Photo 1 is larger than 5 MB.");
});

test("rejects a text file renamed to .jpg", function () {
  const fake = { originalname: "notes.jpg", buffer: Buffer.from("these are my class notes, not a photo") };
  assert.equal(validatePhotos([png(), fake]), "Photo 2 must be a JPEG, PNG, or WebP image.");
});

test("rejects a file with no data", function () {
  assert.equal(validatePhotos([{ originalname: "empty.jpg" }]), "Photo 1 could not be read.");
});
