-- YesNo Cricket v2 - Initial Schema
-- Run this in Supabase SQL Editor

-- 1. Users (single source of truth)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                    -- phone number (e.g., "9876543210")
  name TEXT DEFAULT 'User',
  balance DECIMAL(12,2) DEFAULT 100.00,
  held_balance DECIMAL(12,2) DEFAULT 0.00,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Positions (open trades)
CREATE TABLE IF NOT EXISTS positions (
  id SERIAL PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  match_key TEXT NOT NULL,                -- e.g., "ind-vs-aus-2024-02-18"
  market_id INTEGER NOT NULL,             -- 1 = Match Winner
  direction TEXT NOT NULL,                -- "A" or "B"
  quantity INTEGER NOT NULL,
  avg_price DECIMAL(5,4) NOT NULL,
  status TEXT DEFAULT 'open',             -- open, won, lost, closed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_positions_match ON positions(match_key, status);

-- 3. Transactions (audit trail)
CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  type TEXT NOT NULL,                     -- deposit, withdrawal, trade, settlement, bonus
  amount DECIMAL(12,2) NOT NULL,
  balance_after DECIMAL(12,2) NOT NULL,
  reference_id TEXT,                      -- position_id or external ref
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, created_at DESC);

-- 4. Settlements (match outcomes)
CREATE TABLE IF NOT EXISTS settlements (
  id SERIAL PRIMARY KEY,
  match_key TEXT NOT NULL UNIQUE,
  winner TEXT NOT NULL,                   -- "A" or "B"
  settled_by TEXT,                        -- admin user_id
  settled_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Price History (for charts)
CREATE TABLE IF NOT EXISTS price_history (
  id SERIAL PRIMARY KEY,
  match_key TEXT NOT NULL,
  market_id INTEGER NOT NULL,
  price_a DECIMAL(5,4) NOT NULL,
  price_b DECIMAL(5,4) NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_history_lookup ON price_history(match_key, market_id, recorded_at DESC);

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;

-- Permissive policies for server access (using service_role key)
CREATE POLICY "Server access for users" ON users FOR ALL USING (true);
CREATE POLICY "Server access for positions" ON positions FOR ALL USING (true);
CREATE POLICY "Server access for transactions" ON transactions FOR ALL USING (true);
CREATE POLICY "Server access for settlements" ON settlements FOR ALL USING (true);
CREATE POLICY "Server access for price_history" ON price_history FOR ALL USING (true);
