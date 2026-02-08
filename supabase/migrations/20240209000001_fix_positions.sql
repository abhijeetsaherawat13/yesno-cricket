-- Fix positions table - add missing columns

ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'settled'));

ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS outcome text CHECK (outcome IN ('win', 'lose', 'void'));

ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS payout numeric(12,2);

ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS settled_at timestamptz;

ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;
