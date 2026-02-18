-- YesNo Cricket v2 - New Schema (5 tables)
-- This migration adds the v2 tables alongside existing ones

-- 1. Users v2 (single source of truth, phone-based)
CREATE TABLE IF NOT EXISTS users_v2 (
  id TEXT PRIMARY KEY,                    -- phone number (e.g., "9876543210")
  name TEXT DEFAULT 'User',
  balance DECIMAL(12,2) DEFAULT 100.00,
  held_balance DECIMAL(12,2) DEFAULT 0.00,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Positions v2 (open trades)
CREATE TABLE IF NOT EXISTS positions_v2 (
  id SERIAL PRIMARY KEY,
  user_id TEXT REFERENCES users_v2(id),
  match_key TEXT NOT NULL,                -- e.g., "ind-vs-aus-2024-02-18"
  market_id INTEGER NOT NULL,             -- 1 = Match Winner
  direction TEXT NOT NULL,                -- "A" or "B"
  quantity INTEGER NOT NULL,
  avg_price DECIMAL(5,4) NOT NULL,
  status TEXT DEFAULT 'open',             -- open, won, lost, closed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_positions_v2_user ON positions_v2(user_id, status);
CREATE INDEX IF NOT EXISTS idx_positions_v2_match ON positions_v2(match_key, status);

-- 3. Transactions v2 (audit trail)
CREATE TABLE IF NOT EXISTS transactions_v2 (
  id SERIAL PRIMARY KEY,
  user_id TEXT REFERENCES users_v2(id),
  type TEXT NOT NULL,                     -- deposit, withdrawal, trade, settlement, bonus
  amount DECIMAL(12,2) NOT NULL,
  balance_after DECIMAL(12,2) NOT NULL,
  reference_id TEXT,                      -- position_id or external ref
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_v2_user ON transactions_v2(user_id, created_at DESC);

-- 4. Settlements v2 (match outcomes)
CREATE TABLE IF NOT EXISTS settlements_v2 (
  id SERIAL PRIMARY KEY,
  match_key TEXT NOT NULL UNIQUE,
  winner TEXT NOT NULL,                   -- "A" or "B"
  settled_by TEXT,                        -- admin user_id
  settled_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Price History v2 (for charts)
CREATE TABLE IF NOT EXISTS price_history_v2 (
  id SERIAL PRIMARY KEY,
  match_key TEXT NOT NULL,
  market_id INTEGER NOT NULL,
  price_a DECIMAL(5,4) NOT NULL,
  price_b DECIMAL(5,4) NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_history_v2_lookup ON price_history_v2(match_key, market_id, recorded_at DESC);

-- Enable RLS on all v2 tables
ALTER TABLE users_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history_v2 ENABLE ROW LEVEL SECURITY;

-- Permissive policies for server access (using service_role key)
CREATE POLICY "Server access for users_v2" ON users_v2 FOR ALL USING (true);
CREATE POLICY "Server access for positions_v2" ON positions_v2 FOR ALL USING (true);
CREATE POLICY "Server access for transactions_v2" ON transactions_v2 FOR ALL USING (true);
CREATE POLICY "Server access for settlements_v2" ON settlements_v2 FOR ALL USING (true);
CREATE POLICY "Server access for price_history_v2" ON price_history_v2 FOR ALL USING (true);
