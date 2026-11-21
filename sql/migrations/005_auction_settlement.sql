BEGIN;
CREATE TABLE IF NOT EXISTS auction_settlements (
 auction_id INTEGER PRIMARY KEY REFERENCES auctions(id),
 seller_id INTEGER NOT NULL REFERENCES users(id),
 buyer_id INTEGER REFERENCES users(id),
 winning_bid_id INTEGER UNIQUE REFERENCES bids(id),
 amount_cents INTEGER NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN ('sold','no_bids')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 CHECK((outcome='sold' AND buyer_id IS NOT NULL AND winning_bid_id IS NOT NULL AND amount_cents>0 AND buyer_id<>seller_id)
    OR (outcome='no_bids' AND buyer_id IS NULL AND winning_bid_id IS NULL AND amount_cents=0))
);
ALTER TABLE auction_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_settlement_jobs ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auction_settlement_jobs ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE auction_settlement_jobs ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE wallet_ledger ALTER COLUMN deposit_id DROP NOT NULL;
ALTER TABLE wallet_ledger ADD COLUMN IF NOT EXISTS auction_id INTEGER REFERENCES auctions(id);
ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_kind_check;
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_kind_check CHECK(kind IN ('test_deposit','auction_debit','auction_credit'));
ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_source_check;
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_source_check CHECK(
 (kind='test_deposit' AND deposit_id IS NOT NULL AND auction_id IS NULL)
 OR (kind IN ('auction_debit','auction_credit') AND deposit_id IS NULL AND auction_id IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS wallet_ledger_auction_once_idx ON wallet_ledger(auction_id,kind);
ALTER TABLE auction_events DROP CONSTRAINT IF EXISTS auction_events_kind_check;
ALTER TABLE auction_events ADD CONSTRAINT auction_events_kind_check CHECK(kind IN ('AUCTION_ENDED','AUCTION_CANCELLED','AUCTION_SETTLED'));
COMMIT;
