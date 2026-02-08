-- Yes/No Supabase schema + RPC functions
-- Apply in Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  phone text unique not null,
  full_name text not null default 'YesNo User',
  email text,
  kyc_status text not null default 'pending' check (kyc_status in ('pending', 'submitted', 'verified', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance numeric(12,2) not null default 0,
  bonus_balance numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.matches (
  id bigint generated always as identity primary key,
  team_a_code text not null,
  team_b_code text not null,
  team_a_full text not null,
  team_b_full text not null,
  flag_a text not null,
  flag_b text not null,
  score_a text not null default '0-0',
  score_b text not null default '0-0',
  overs_a text not null default '',
  overs_b text not null default '',
  price_a int not null default 50 check (price_a between 1 and 99),
  price_b int not null default 50 check (price_b between 1 and 99),
  volume text not null default '0',
  time_label text not null default 'TBD',
  is_live boolean not null default false,
  category text not null default 'Cricket',
  markets_count int not null default 0,
  status text not null default 'upcoming' check (status in ('upcoming', 'live', 'completed')),
  start_time timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.markets (
  id bigint generated always as identity primary key,
  match_id bigint not null references public.matches(id) on delete cascade,
  category text not null,
  title text not null,
  volume numeric(14,2) not null default 0,
  is_live boolean not null default false,
  status text not null default 'open' check (status in ('open', 'suspended', 'settled')),
  yes_label text not null,
  no_label text not null,
  yes_price int not null check (yes_price between 1 and 99),
  no_price int generated always as (100 - yes_price) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.positions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  match_id bigint not null references public.matches(id) on delete cascade,
  match_label text not null,
  market_title text not null,
  option_label text not null,
  side text not null check (side in ('yes', 'no')),
  shares int not null check (shares > 0),
  avg_price int not null check (avg_price between 1 and 99),
  cost numeric(12,2) not null,
  potential_payout numeric(12,2) not null,
  status text not null default 'open' check (status in ('open', 'closed', 'settled')),
  is_live boolean not null default false,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.wallet_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('credit', 'debit')),
  amount numeric(12,2) not null,
  description text not null,
  icon text not null default '📝',
  created_at timestamptz not null default now()
);

create table if not exists public.user_notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  text text not null,
  icon text not null default '📢',
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.kyc_records (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  pan_number text,
  aadhaar_number text,
  bank_account_number text,
  ifsc_code text,
  account_holder_name text,
  status text not null default 'pending' check (status in ('pending', 'submitted', 'verified', 'rejected')),
  submitted_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists trg_wallet_updated_at on public.wallet_accounts;
create trigger trg_wallet_updated_at
before update on public.wallet_accounts
for each row execute function public.touch_updated_at();

drop trigger if exists trg_matches_updated_at on public.matches;
create trigger trg_matches_updated_at
before update on public.matches
for each row execute function public.touch_updated_at();

drop trigger if exists trg_markets_updated_at on public.markets;
create trigger trg_markets_updated_at
before update on public.markets
for each row execute function public.touch_updated_at();

drop trigger if exists trg_kyc_updated_at on public.kyc_records;
create trigger trg_kyc_updated_at
before update on public.kyc_records
for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.wallet_accounts enable row level security;
alter table public.positions enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.user_notifications enable row level security;
alter table public.kyc_records enable row level security;
alter table public.matches enable row level security;
alter table public.markets enable row level security;

-- User-owned tables
create policy if not exists "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy if not exists "profiles_update_own" on public.profiles for update using (auth.uid() = id);
create policy if not exists "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);

create policy if not exists "wallet_select_own" on public.wallet_accounts for select using (auth.uid() = user_id);
create policy if not exists "wallet_insert_own" on public.wallet_accounts for insert with check (auth.uid() = user_id);
create policy if not exists "wallet_update_own" on public.wallet_accounts for update using (auth.uid() = user_id);

create policy if not exists "positions_select_own" on public.positions for select using (auth.uid() = user_id);
create policy if not exists "positions_insert_own" on public.positions for insert with check (auth.uid() = user_id);
create policy if not exists "positions_update_own" on public.positions for update using (auth.uid() = user_id);

create policy if not exists "transactions_select_own" on public.wallet_transactions for select using (auth.uid() = user_id);
create policy if not exists "transactions_insert_own" on public.wallet_transactions for insert with check (auth.uid() = user_id);

create policy if not exists "notifications_select_own" on public.user_notifications for select using (auth.uid() = user_id);
create policy if not exists "notifications_insert_own" on public.user_notifications for insert with check (auth.uid() = user_id);
create policy if not exists "notifications_update_own" on public.user_notifications for update using (auth.uid() = user_id);

create policy if not exists "kyc_select_own" on public.kyc_records for select using (auth.uid() = user_id);
create policy if not exists "kyc_insert_own" on public.kyc_records for insert with check (auth.uid() = user_id);
create policy if not exists "kyc_update_own" on public.kyc_records for update using (auth.uid() = user_id);

-- Public read tables
create policy if not exists "matches_read" on public.matches for select using (true);
create policy if not exists "markets_read" on public.markets for select using (true);

create or replace function public.execute_buy_order(
  p_match_id bigint,
  p_match_label text,
  p_market_title text,
  p_option_label text,
  p_side text,
  p_shares int,
  p_avg_price int,
  p_cost numeric,
  p_potential_payout numeric,
  p_is_live boolean
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_balance numeric;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_side not in ('yes', 'no') then
    raise exception 'Invalid side';
  end if;

  if p_shares <= 0 or p_cost <= 0 then
    raise exception 'Invalid order size';
  end if;

  select balance into v_balance
  from public.wallet_accounts
  where user_id = v_user_id
  for update;

  if v_balance is null then
    raise exception 'Wallet not found';
  end if;

  if v_balance < p_cost then
    raise exception 'Insufficient wallet balance';
  end if;

  update public.wallet_accounts
  set balance = balance - p_cost
  where user_id = v_user_id;

  insert into public.positions (
    user_id, match_id, match_label, market_title, option_label, side,
    shares, avg_price, cost, potential_payout, status, is_live
  ) values (
    v_user_id, p_match_id, p_match_label, p_market_title, p_option_label, p_side,
    p_shares, p_avg_price, p_cost, p_potential_payout, 'open', p_is_live
  );

  insert into public.wallet_transactions (user_id, type, amount, description, icon)
  values (v_user_id, 'debit', p_cost, 'Bought ' || p_option_label || ' ' || upper(p_side), '📉');

  insert into public.user_notifications (user_id, title, text, icon, read)
  values (v_user_id, 'Position Opened!', p_shares || ' shares of ' || p_option_label || ' @ ' || p_avg_price || 'p', '✅', false);

  select balance into v_balance from public.wallet_accounts where user_id = v_user_id;
  return v_balance;
end;
$$;

create or replace function public.execute_sell_order(
  p_position_id bigint,
  p_sell_shares int
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_position public.positions%rowtype;
  v_current_price int;
  v_sell_value numeric;
  v_cost_basis numeric;
  v_pnl numeric;
  v_remaining_shares int;
  v_balance numeric;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_sell_shares <= 0 then
    raise exception 'Invalid sell quantity';
  end if;

  select * into v_position
  from public.positions
  where id = p_position_id and user_id = v_user_id and status = 'open'
  for update;

  if v_position.id is null then
    raise exception 'Position not found';
  end if;

  if p_sell_shares > v_position.shares then
    raise exception 'Sell quantity exceeds held shares';
  end if;

  v_current_price := greatest(1, least(99, v_position.avg_price + (floor(random() * 10)::int - 5)));
  v_sell_value := p_sell_shares * (v_current_price / 100.0);
  v_cost_basis := p_sell_shares * (v_position.avg_price / 100.0);
  v_pnl := v_sell_value - v_cost_basis;
  v_remaining_shares := v_position.shares - p_sell_shares;

  if v_remaining_shares <= 0 then
    update public.positions
    set shares = 0,
        cost = 0,
        potential_payout = 0,
        status = 'closed',
        closed_at = now()
    where id = v_position.id;
  else
    update public.positions
    set shares = v_remaining_shares,
        cost = (v_position.cost * v_remaining_shares::numeric / v_position.shares::numeric),
        potential_payout = (v_position.potential_payout * v_remaining_shares::numeric / v_position.shares::numeric)
    where id = v_position.id;
  end if;

  update public.wallet_accounts
  set balance = balance + v_sell_value
  where user_id = v_user_id;

  insert into public.wallet_transactions (user_id, type, amount, description, icon)
  values (v_user_id, 'credit', v_sell_value, 'Sold ' || p_sell_shares || ' shares of ' || v_position.option_label, '📈');

  insert into public.user_notifications (user_id, title, text, icon, read)
  values (
    v_user_id,
    'Position Closed!',
    case when v_pnl >= 0 then 'Profit: Rs ' || round(v_pnl, 2) else 'Loss: Rs ' || round(abs(v_pnl), 2) end,
    case when v_pnl >= 0 then '🎉' else '📉' end,
    false
  );

  select balance into v_balance from public.wallet_accounts where user_id = v_user_id;
  return v_balance;
end;
$$;

create or replace function public.execute_wallet_deposit(p_amount numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_balance numeric;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_amount < 100 then
    raise exception 'Minimum deposit is Rs 100';
  end if;

  update public.wallet_accounts
  set balance = balance + p_amount
  where user_id = v_user_id;

  insert into public.wallet_transactions (user_id, type, amount, description, icon)
  values (v_user_id, 'credit', p_amount, 'Added Money', '➕');

  insert into public.user_notifications (user_id, title, text, icon, read)
  values (v_user_id, 'Deposit Successful', 'Rs ' || p_amount || ' added to your wallet', '✅', false);

  select balance into v_balance from public.wallet_accounts where user_id = v_user_id;
  return v_balance;
end;
$$;

create or replace function public.execute_wallet_withdrawal(p_amount numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_balance numeric;
  v_kyc_status text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_amount < 500 then
    raise exception 'Minimum withdrawal is Rs 500';
  end if;

  select kyc_status into v_kyc_status
  from public.profiles
  where id = v_user_id;

  if coalesce(v_kyc_status, 'pending') <> 'verified' then
    raise exception 'KYC must be verified before withdrawal';
  end if;

  select balance into v_balance
  from public.wallet_accounts
  where user_id = v_user_id
  for update;

  if v_balance < p_amount then
    raise exception 'Insufficient balance';
  end if;

  update public.wallet_accounts
  set balance = balance - p_amount
  where user_id = v_user_id;

  insert into public.wallet_transactions (user_id, type, amount, description, icon)
  values (v_user_id, 'debit', p_amount, 'Withdrawal', '💸');

  insert into public.user_notifications (user_id, title, text, icon, read)
  values (v_user_id, 'Withdrawal Initiated', 'Rs ' || p_amount || ' will be credited in 24-48 hours', '🏦', false);

  select balance into v_balance from public.wallet_accounts where user_id = v_user_id;
  return v_balance;
end;
$$;

grant execute on function public.execute_buy_order(bigint, text, text, text, text, int, int, numeric, numeric, boolean) to authenticated;
grant execute on function public.execute_sell_order(bigint, int) to authenticated;
grant execute on function public.execute_wallet_deposit(numeric) to authenticated;
grant execute on function public.execute_wallet_withdrawal(numeric) to authenticated;

-- Seed matches if empty
insert into public.matches (
  team_a_code, team_b_code, team_a_full, team_b_full,
  flag_a, flag_b, score_a, score_b, overs_a, overs_b,
  price_a, price_b, volume, time_label, is_live, category, markets_count, status, start_time
)
select * from (
  values
    ('MI','CSK','Mumbai Indians','Chennai Super Kings','🔵','🟡','165/4','Yet to bat','18.2','',58,42,'3.2L','Now',true,'IPL',16,'live', now()),
    ('IND','AUS','India','Australia','🇮🇳','🇦🇺','0-0','0-0','','',62,38,'5.8L','2:00 PM',false,'International',16,'upcoming', now() + interval '5 hours'),
    ('RCB','DC','Royal Challengers','Delhi Capitals','🔴','🔵','0-0','0-0','','',55,45,'2.1L','7:30 PM',false,'IPL',16,'upcoming', now() + interval '10 hours'),
    ('SA','WI','South Africa','West Indies','🇿🇦','🌴','0-0','0-0','','',68,32,'1.4L','Tomorrow, 10 AM',false,'International',16,'upcoming', now() + interval '1 day'),
    ('KKR','SRH','Kolkata Knight Riders','Sunrisers Hyderabad','💜','🧡','0-0','0-0','','',52,48,'1.8L','Tomorrow, 7:30 PM',false,'IPL',16,'upcoming', now() + interval '1 day 8 hours'),
    ('ENG','NZ','England','New Zealand','🏴','🇳🇿','0-0','0-0','','',55,45,'2.3L','Wed, 2:00 PM',false,'International',16,'upcoming', now() + interval '2 days')
) as seed(
  team_a_code, team_b_code, team_a_full, team_b_full,
  flag_a, flag_b, score_a, score_b, overs_a, overs_b,
  price_a, price_b, volume, time_label, is_live, category, markets_count, status, start_time
)
where not exists (select 1 from public.matches limit 1);

-- Seed starter markets for match 1 if empty
insert into public.markets (match_id, category, title, volume, is_live, status, yes_label, no_label, yes_price)
select match_id, category, title, volume, is_live, status, yes_label, no_label, yes_price
from (
  select (select id from public.matches order by id asc limit 1) as match_id,
         'winner' as category,
         'Match Winner' as title,
         240000::numeric as volume,
         true as is_live,
         'open' as status,
         (select team_a_code from public.matches order by id asc limit 1) as yes_label,
         (select team_b_code from public.matches order by id asc limit 1) as no_label,
         58 as yes_price
  union all
  select (select id from public.matches order by id asc limit 1), 'winner', 'Toss Winner', 54000, true, 'open',
         (select team_a_code from public.matches order by id asc limit 1),
         (select team_b_code from public.matches order by id asc limit 1), 50
  union all
  select (select id from public.matches order by id asc limit 1), 'sessions', '6 Over Runs', 160000, true, 'open', 'Over 48.5', 'Under 48.5', 55
  union all
  select (select id from public.matches order by id asc limit 1), 'sessions', '10 Over Runs', 210000, true, 'open', 'Over 89.5', 'Under 89.5', 52
  union all
  select (select id from public.matches order by id asc limit 1), 'player', 'Rohit Sharma Runs', 140000, true, 'open', 'Over 32.5', 'Under 32.5', 52
  union all
  select (select id from public.matches order by id asc limit 1), 'wickets', 'Fall of 1st Wicket Runs', 110000, true, 'open', 'Over 28.5', 'Under 28.5', 52
  union all
  select (select id from public.matches order by id asc limit 1), 'overbyover', 'Over 19 Runs', 52000, true, 'open', 'Over 11.5', 'Under 11.5', 52
  union all
  select (select id from public.matches order by id asc limit 1), 'oddeven', 'Match Total — Odd or Even?', 54000, true, 'open', 'Odd', 'Even', 50
) seed
where not exists (select 1 from public.markets limit 1);

-- ============================================================
-- Milestone 1: held_balance + withdrawal_requests
-- ============================================================

-- Add held_balance to wallet_accounts (funds locked during pending withdrawal)
ALTER TABLE public.wallet_accounts
  ADD COLUMN IF NOT EXISTS held_balance numeric(12,2) NOT NULL DEFAULT 0;

-- Withdrawal requests table
CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount      numeric(12,2) NOT NULL CHECK (amount >= 500),
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'approved', 'rejected', 'sent')),
  upi_id      text,
  bank_details text,
  admin_notes text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS: users can read their own withdrawal requests
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "withdrawal_requests_select_own"
  ON public.withdrawal_requests FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "withdrawal_requests_insert_own"
  ON public.withdrawal_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Auto-update updated_at on withdrawal_requests
CREATE TRIGGER trg_withdrawal_requests_updated_at
  BEFORE UPDATE ON public.withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================
-- M3: Settlement columns on positions
-- ============================================================

ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS outcome text CHECK (outcome IN ('win', 'lose', 'void')),
  ADD COLUMN IF NOT EXISTS payout numeric(12,2),
  ADD COLUMN IF NOT EXISTS settled_at timestamptz;

-- ============================================================
-- Server State Persistence Tables
-- ============================================================

-- All-time trade orders (replaces in-memory orders array)
CREATE TABLE IF NOT EXISTS public.all_orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL,  -- Using text for 'user-123' compatibility
  match_id bigint NOT NULL,
  market_id bigint NOT NULL,
  option_label text NOT NULL,
  side text NOT NULL CHECK (side IN ('yes', 'no')),
  shares int NOT NULL,
  price int NOT NULL,
  cost numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_all_orders_user_id ON public.all_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_all_orders_match_id ON public.all_orders(match_id);
CREATE INDEX IF NOT EXISTS idx_all_orders_created_at ON public.all_orders(created_at DESC);

-- Match settlements (replaces in-memory settlementsByMatch Map)
CREATE TABLE IF NOT EXISTS public.match_settlements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id bigint NOT NULL,
  winner_code text NOT NULL,
  winner_full text NOT NULL,
  settled_by text NOT NULL,
  settled_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_match_settlements_match_id ON public.match_settlements(match_id);

-- Admin audit log (replaces in-memory audits array)
CREATE TABLE IF NOT EXISTS public.admin_audits (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action text NOT NULL,
  admin_id text NOT NULL,
  target_id text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audits_created_at ON public.admin_audits(created_at DESC);

-- RLS policies (allow all for service role key operations)
ALTER TABLE public.all_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audits ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "all_orders_read" ON public.all_orders FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "match_settlements_read" ON public.match_settlements FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "admin_audits_read" ON public.admin_audits FOR SELECT USING (true);
