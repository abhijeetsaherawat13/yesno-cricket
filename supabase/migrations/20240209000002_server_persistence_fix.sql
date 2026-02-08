-- Fix server persistence tables to accept text user_ids (not just UUIDs)
-- This allows the server to persist data for both authenticated users (UUID) and test users (text)

-- Create server-managed wallet table (separate from auth-linked wallet_accounts)
CREATE TABLE IF NOT EXISTS public.server_wallets (
  user_id text PRIMARY KEY,
  balance numeric(12,2) NOT NULL DEFAULT 0,
  bonus_balance numeric(12,2) NOT NULL DEFAULT 0,
  held_balance numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create server-managed positions table (separate from auth-linked positions)
CREATE TABLE IF NOT EXISTS public.server_positions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL,
  match_id bigint NOT NULL,
  match_label text NOT NULL,
  market_title text NOT NULL,
  option_label text NOT NULL,
  side text NOT NULL CHECK (side IN ('yes', 'no')),
  shares int NOT NULL CHECK (shares > 0),
  avg_price int NOT NULL CHECK (avg_price BETWEEN 1 AND 99),
  cost numeric(12,2) NOT NULL,
  potential_payout numeric(12,2) NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'settled')),
  is_live boolean NOT NULL DEFAULT false,
  outcome text CHECK (outcome IN ('win', 'lose', 'void')),
  payout numeric(12,2),
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

-- Create server-managed wallet transactions
CREATE TABLE IF NOT EXISTS public.server_wallet_transactions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('credit', 'debit')),
  amount numeric(12,2) NOT NULL,
  description text NOT NULL,
  icon text NOT NULL DEFAULT '📝',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_server_wallets_user_id ON public.server_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_server_positions_user_id ON public.server_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_server_positions_match_id ON public.server_positions(match_id);
CREATE INDEX IF NOT EXISTS idx_server_positions_status ON public.server_positions(status);
CREATE INDEX IF NOT EXISTS idx_server_wallet_transactions_user_id ON public.server_wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_server_wallet_transactions_created_at ON public.server_wallet_transactions(created_at DESC);

-- Enable RLS (allow all for service role)
ALTER TABLE public.server_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.server_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.server_wallet_transactions ENABLE ROW LEVEL SECURITY;

-- Create policies (allow all - service role bypasses RLS anyway)
CREATE POLICY "server_wallets_all" ON public.server_wallets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "server_positions_all" ON public.server_positions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "server_wallet_transactions_all" ON public.server_wallet_transactions FOR ALL USING (true) WITH CHECK (true);

-- Updated_at trigger for server_wallets
DROP TRIGGER IF EXISTS trg_server_wallets_updated_at ON public.server_wallets;
CREATE TRIGGER trg_server_wallets_updated_at
  BEFORE UPDATE ON public.server_wallets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
