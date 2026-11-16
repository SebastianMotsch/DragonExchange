-- Run this in the Supabase SQL Editor.
-- Teammates add their tables (bids, transactions) below.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL CHECK (email LIKE '%@drexel.edu'),
  password_hash TEXT NOT NULL,
  name          TEXT,
  verified      BOOLEAN NOT NULL DEFAULT false,
  verify_code   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listings (
  id            SERIAL PRIMARY KEY,
  seller_id     INTEGER REFERENCES users(id),
  type          TEXT NOT NULL DEFAULT 'regular' CHECK (type IN ('regular', 'auction')),
  title         VARCHAR(150) NOT NULL CHECK (length(trim(title)) > 0),
  description   TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 5000),
  category      TEXT NOT NULL CHECK (category IN ('Books', 'Electronics', 'Furniture', 'Clothing', 'Other')),
  image_url     TEXT,
  price_cents   INTEGER NOT NULL CHECK (price_cents > 0),
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Temporarily allow guest listings, including in databases created previously.
ALTER TABLE listings ALTER COLUMN seller_id DROP NOT NULL;

-- Listings are accessed through the Express backend.
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
