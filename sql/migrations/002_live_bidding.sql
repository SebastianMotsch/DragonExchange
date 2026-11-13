BEGIN;
ALTER TABLE public.auctions ADD COLUMN IF NOT EXISTS current_bid_cents INTEGER;
ALTER TABLE public.auctions ADD COLUMN IF NOT EXISTS highest_bidder_id INTEGER REFERENCES public.users(id);
ALTER TABLE public.auctions ADD COLUMN IF NOT EXISTS bid_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.auctions ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.auctions ADD COLUMN IF NOT EXISTS min_increment_cents INTEGER NOT NULL DEFAULT 100 CHECK (min_increment_cents > 0);
CREATE TABLE IF NOT EXISTS public.wallets (
 user_id INTEGER PRIMARY KEY REFERENCES public.users(id),
 balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
 reserved_cents INTEGER NOT NULL DEFAULT 0 CHECK (reserved_cents >= 0 AND reserved_cents <= balance_cents)
);
CREATE TABLE IF NOT EXISTS public.bids (
 id SERIAL PRIMARY KEY,
 auction_id INTEGER NOT NULL REFERENCES public.auctions(id),
 bidder_id INTEGER NOT NULL REFERENCES public.users(id),
 amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
 request_id UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (bidder_id, request_id)
);
CREATE INDEX IF NOT EXISTS bids_auction_idx ON public.bids(auction_id, id);
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bids ENABLE ROW LEVEL SECURITY;
-- No browser grants/policies. Authorization runs in Express/Socket.IO.
COMMIT;
