BEGIN;
CREATE TABLE IF NOT EXISTS wallet_deposits (
 id UUID PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 100 AND 50000),
 currency TEXT NOT NULL DEFAULT 'usd' CHECK(currency='usd'),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','credited')),
 stripe_session_id TEXT UNIQUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 credited_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS wallet_ledger (
 id BIGSERIAL PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 kind TEXT NOT NULL CHECK(kind='test_deposit'),
 deposit_id UUID NOT NULL UNIQUE REFERENCES wallet_deposits(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE wallet_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_ledger ENABLE ROW LEVEL SECURITY;
COMMIT;
