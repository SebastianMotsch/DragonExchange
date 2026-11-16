-- Apply after sql/schema.sql. Express owns authorization until Supabase Auth is adopted.
BEGIN;
CREATE TABLE IF NOT EXISTS public.auctions (
  id SERIAL PRIMARY KEY,
  seller_id INTEGER NOT NULL REFERENCES public.users(id),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 5000),
  category TEXT NOT NULL CHECK (category IN ('Books', 'Electronics', 'Furniture', 'Clothing', 'Other')),
  starting_price_cents INTEGER NOT NULL CHECK (starting_price_cents > 0),
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'cancelled', 'settled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > created_at)
);
CREATE INDEX IF NOT EXISTS auctions_created_idx ON public.auctions (created_at DESC, id DESC);
ALTER TABLE public.auctions ENABLE ROW LEVEL SECURITY;
-- No browser API policies: reads/writes go through Express, which checks the session.
-- The backend database role must own this table or have BYPASSRLS.
COMMIT;
