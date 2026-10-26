-- Run this in the Supabase SQL Editor.
-- Teammates add their tables (listings, bids, transactions) below.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL CHECK (email LIKE '%@drexel.edu'),
  password_hash TEXT NOT NULL,
  name          TEXT,
  verified      BOOLEAN NOT NULL DEFAULT false,
  verify_code   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);