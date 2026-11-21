BEGIN;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS auctions_due_idx ON auctions(ends_at,id) WHERE status='active';
CREATE TABLE IF NOT EXISTS auction_events (
 id BIGSERIAL PRIMARY KEY,
 auction_id INTEGER NOT NULL REFERENCES auctions(id),
 kind TEXT NOT NULL CHECK(kind IN ('AUCTION_ENDED','AUCTION_CANCELLED')),
 version INTEGER NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(auction_id,kind,version)
);
-- Durable handoff to story #11. Closing does not itself move funds.
CREATE TABLE IF NOT EXISTS auction_settlement_jobs (
 auction_id INTEGER PRIMARY KEY REFERENCES auctions(id),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE auction_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_settlement_jobs ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION guard_auction_deadline() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.bid_count>0 AND (NEW.ends_at IS DISTINCT FROM OLD.ends_at OR NEW.starting_price_cents IS DISTINCT FROM OLD.starting_price_cents) THEN
  RAISE EXCEPTION 'Price and deadline cannot change after bidding starts' USING ERRCODE='23514';
 END IF;
 IF NEW.status='cancelled' AND OLD.bid_count>0 THEN
  RAISE EXCEPTION 'Auctions with bids require the agreed cancellation policy' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS auction_deadline_guard ON auctions;
CREATE TRIGGER auction_deadline_guard BEFORE UPDATE ON auctions FOR EACH ROW EXECUTE FUNCTION guard_auction_deadline();
COMMIT;
