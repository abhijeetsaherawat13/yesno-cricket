-- Fix price_history table schema
-- The table had INTEGER columns but code sends DECIMAL values
-- This migration drops and recreates with correct types

DROP TABLE IF EXISTS price_history;

CREATE TABLE price_history (
  id SERIAL PRIMARY KEY,
  match_key TEXT NOT NULL,
  market_id INTEGER NOT NULL,
  price_a DECIMAL(5,4) NOT NULL,
  price_b DECIMAL(5,4) NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_price_history_lookup ON price_history(match_key, market_id, recorded_at DESC);

ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Server access for price_history" ON price_history FOR ALL USING (true);
