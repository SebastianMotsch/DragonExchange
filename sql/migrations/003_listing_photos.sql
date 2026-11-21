-- Apply after 001 and 002. Photo files live in the uploads folder; this table
-- stores which files belong to which listing and in what order.
BEGIN;
CREATE TABLE IF NOT EXISTS public.listing_photos (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  -- Random UUID name created by the server, never the uploaded file name.
  file_name TEXT NOT NULL UNIQUE
    CHECK (file_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'),
  -- 0 is the cover photo. Up to 5 photos per listing.
  position SMALLINT NOT NULL CHECK (position BETWEEN 0 AND 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (listing_id, position)
);
ALTER TABLE public.listing_photos ENABLE ROW LEVEL SECURITY;
-- No browser API policies: reads/writes go through Express.
COMMIT;