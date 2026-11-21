# Listing photos

Sellers can add up to **5 photos** to a regular listing on the Sell page. Each photo must be a **JPEG, PNG, or WebP** file of **5 MB or less**. The first photo is the cover shown on listing cards.

## How it works

- `POST /listings` accepts the form as `multipart/form-data`. multer keeps the files in memory, and `validatePhotos()` in `lib/photos.js` checks the count, size, and real image type from the file bytes before anything is saved.
- Valid photos are written to the **static uploads folder** (`uploads/` in the project root, or `UPLOAD_DIR` if set). Each file is named `crypto.randomUUID()` plus an extension from the detected type, so uploaded file names are never used.
- The `listing_photos` table (`sql/migrations/003_listing_photos.sql`) records which files belong to which listing and in what order. The listing and its photo rows are saved in one transaction; if that fails, the saved files are removed.
- `app.js` serves the folder at `/uploads`, so a photo's URL is `/uploads/<uuid>.jpg`.
- Deleting a listing removes its photo rows (`ON DELETE CASCADE`) and its files.

## Setup

Run `npm run db:migrate` once against the shared database to create `listing_photos`. The listing pages query that table, so they return errors until the migration has run.

## Limits

- `uploads/` is Git-ignored. Photos exist only on the machine or server that received them.
- On Render's free tier the filesystem is wiped on every redeploy, restart, or spin-down, so uploaded photos disappear then. Photos committed to the repository (for seeded demo listings) are not affected.
- Auctions do not have photos yet. Editing a listing's photos is part of the remaining work on #18.