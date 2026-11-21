const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const multer = require("multer");
const { MAX_PHOTOS, MAX_SIZE, getImageType } = require("./photos");

const UPLOAD_DIR =
  process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads");
const EXTENSIONS = { jpeg: ".jpg", png: ".png", webp: ".webp" };
const SAFE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE, files: MAX_PHOTOS },
}).array("photos", MAX_PHOTOS);

function readPhotos(req, res, next) {
  upload(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE")
      return res.status(400).json({ error: "Each photo must be 5 MB or smaller." });
    if (error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE")
      return res.status(400).json({ error: "You can upload up to " + MAX_PHOTOS + " photos." });
    return res.status(400).json({ error: "Your photos could not be read. Please try again." });
  });
}

async function savePhotos(files) {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const names = [];
  try {
    for (const file of files) {
      const name = crypto.randomUUID() + EXTENSIONS[getImageType(file.buffer)];
      await fs.writeFile(path.join(UPLOAD_DIR, name), file.buffer, { flag: "wx" });
      names.push(name);
    }
  } catch (error) {
    await removePhotos(names);
    throw error;
  }
  return names;
}

async function removePhotos(names) {
  for (const name of names) {
    if (SAFE_NAME.test(name)) {
      await fs.unlink(path.join(UPLOAD_DIR, name)).catch(() => {});
    }
  }
}

module.exports = { UPLOAD_DIR, readPhotos, savePhotos, removePhotos };