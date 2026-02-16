-- Migration: Price history persistence for charts
-- Created: 2026-02-16
-- Purpose: Store price history points so charts survive server restarts

CREATE TABLE IF NOT EXISTS public.server_price_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  market_key text NOT NULL,
  price int NOT NULL CHECK (price BETWEEN 1 AND 99),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- Index for efficient queries by market_key ordered by time
CREATE INDEX idx_server_price_history_key_time
  ON public.server_price_history(market_key, recorded_at DESC);

-- Enable RLS
ALTER TABLE public.server_price_history ENABLE ROW LEVEL SECURITY;

-- Allow all operations (server uses service role key)
CREATE POLICY "server_price_history_all" ON public.server_price_history
  FOR ALL USING (true) WITH CHECK (true);
