-- Yes/No Supabase schema + RPC functions
-- Fixed for standard PostgreSQL syntax

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
  held_balance numeric(12,2) not null default 0,
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
  outcome text check (outcome in ('win', 'lose', 'void')),
  payout numeric(12,2),
  settled_at timestamptz,
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

create table if not exists public.withdrawal_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12,2) not null check (amount >= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'sent')),
  upi_id text,
  bank_details text,
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Server State Persistence Tables

create table if not exists public.all_orders (
  id bigint generated always as identity primary key,
  user_id text not null,
  match_id bigint not null,
  market_id bigint not null,
  option_label text not null,
  side text not null check (side in ('yes', 'no')),
  shares int not null,
  price int not null,
  cost numeric(12,2) not null,
  created_at timestamptz not null default now()
);

create table if not exists public.match_settlements (
  id bigint generated always as identity primary key,
  match_id bigint not null,
  winner_code text not null,
  winner_full text not null,
  settled_by text not null,
  settled_at timestamptz not null default now()
);

create table if not exists public.admin_audits (
  id bigint generated always as identity primary key,
  action text not null,
  admin_id text not null,
  target_id text,
  details jsonb,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_all_orders_user_id on public.all_orders(user_id);
create index if not exists idx_all_orders_match_id on public.all_orders(match_id);
create index if not exists idx_all_orders_created_at on public.all_orders(created_at desc);
create index if not exists idx_match_settlements_match_id on public.match_settlements(match_id);
create index if not exists idx_admin_audits_created_at on public.admin_audits(created_at desc);

-- Updated_at trigger function
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Triggers
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

drop trigger if exists trg_withdrawal_requests_updated_at on public.withdrawal_requests;
create trigger trg_withdrawal_requests_updated_at
before update on public.withdrawal_requests
for each row execute function public.touch_updated_at();

-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.wallet_accounts enable row level security;
alter table public.positions enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.user_notifications enable row level security;
alter table public.kyc_records enable row level security;
alter table public.matches enable row level security;
alter table public.markets enable row level security;
alter table public.withdrawal_requests enable row level security;
alter table public.all_orders enable row level security;
alter table public.match_settlements enable row level security;
alter table public.admin_audits enable row level security;

-- Drop existing policies first, then create new ones
do $$
begin
  -- Profiles
  drop policy if exists "profiles_select_own" on public.profiles;
  drop policy if exists "profiles_update_own" on public.profiles;
  drop policy if exists "profiles_insert_own" on public.profiles;
  -- Wallet
  drop policy if exists "wallet_select_own" on public.wallet_accounts;
  drop policy if exists "wallet_insert_own" on public.wallet_accounts;
  drop policy if exists "wallet_update_own" on public.wallet_accounts;
  -- Positions
  drop policy if exists "positions_select_own" on public.positions;
  drop policy if exists "positions_insert_own" on public.positions;
  drop policy if exists "positions_update_own" on public.positions;
  -- Transactions
  drop policy if exists "transactions_select_own" on public.wallet_transactions;
  drop policy if exists "transactions_insert_own" on public.wallet_transactions;
  -- Notifications
  drop policy if exists "notifications_select_own" on public.user_notifications;
  drop policy if exists "notifications_insert_own" on public.user_notifications;
  drop policy if exists "notifications_update_own" on public.user_notifications;
  -- KYC
  drop policy if exists "kyc_select_own" on public.kyc_records;
  drop policy if exists "kyc_insert_own" on public.kyc_records;
  drop policy if exists "kyc_update_own" on public.kyc_records;
  -- Matches/Markets (public read)
  drop policy if exists "matches_read" on public.matches;
  drop policy if exists "markets_read" on public.markets;
  -- Withdrawal
  drop policy if exists "withdrawal_requests_select_own" on public.withdrawal_requests;
  drop policy if exists "withdrawal_requests_insert_own" on public.withdrawal_requests;
  -- Server persistence tables
  drop policy if exists "all_orders_read" on public.all_orders;
  drop policy if exists "all_orders_insert" on public.all_orders;
  drop policy if exists "match_settlements_read" on public.match_settlements;
  drop policy if exists "match_settlements_insert" on public.match_settlements;
  drop policy if exists "admin_audits_read" on public.admin_audits;
  drop policy if exists "admin_audits_insert" on public.admin_audits;
end $$;

-- User-owned table policies
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);

create policy "wallet_select_own" on public.wallet_accounts for select using (auth.uid() = user_id);
create policy "wallet_insert_own" on public.wallet_accounts for insert with check (auth.uid() = user_id);
create policy "wallet_update_own" on public.wallet_accounts for update using (auth.uid() = user_id);

create policy "positions_select_own" on public.positions for select using (auth.uid() = user_id);
create policy "positions_insert_own" on public.positions for insert with check (auth.uid() = user_id);
create policy "positions_update_own" on public.positions for update using (auth.uid() = user_id);

create policy "transactions_select_own" on public.wallet_transactions for select using (auth.uid() = user_id);
create policy "transactions_insert_own" on public.wallet_transactions for insert with check (auth.uid() = user_id);

create policy "notifications_select_own" on public.user_notifications for select using (auth.uid() = user_id);
create policy "notifications_insert_own" on public.user_notifications for insert with check (auth.uid() = user_id);
create policy "notifications_update_own" on public.user_notifications for update using (auth.uid() = user_id);

create policy "kyc_select_own" on public.kyc_records for select using (auth.uid() = user_id);
create policy "kyc_insert_own" on public.kyc_records for insert with check (auth.uid() = user_id);
create policy "kyc_update_own" on public.kyc_records for update using (auth.uid() = user_id);

create policy "withdrawal_requests_select_own" on public.withdrawal_requests for select using (auth.uid() = user_id);
create policy "withdrawal_requests_insert_own" on public.withdrawal_requests for insert with check (auth.uid() = user_id);

-- Public read policies
create policy "matches_read" on public.matches for select using (true);
create policy "markets_read" on public.markets for select using (true);

-- Server persistence table policies (allow all - service role bypasses RLS anyway)
create policy "all_orders_read" on public.all_orders for select using (true);
create policy "all_orders_insert" on public.all_orders for insert with check (true);
create policy "match_settlements_read" on public.match_settlements for select using (true);
create policy "match_settlements_insert" on public.match_settlements for insert with check (true);
create policy "admin_audits_read" on public.admin_audits for select using (true);
create policy "admin_audits_insert" on public.admin_audits for insert with check (true);

-- RPC Functions

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

-- Grant permissions on RPC functions
grant execute on function public.execute_buy_order(bigint, text, text, text, text, int, int, numeric, numeric, boolean) to authenticated;
grant execute on function public.execute_sell_order(bigint, int) to authenticated;
grant execute on function public.execute_wallet_deposit(numeric) to authenticated;
grant execute on function public.execute_wallet_withdrawal(numeric) to authenticated;
