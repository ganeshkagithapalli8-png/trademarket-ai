-- ═══════════════════════════════════════════════════════════════════════════
--  TradeMarket AI — database schema
--  Runs unchanged on local Postgres and on Supabase Postgres.
--  Idempotent: safe to run repeatedly.
--
--  SECURITY MODEL
--  ──────────────
--  This app uses its own email+password auth (bcrypt), NOT Supabase Auth, so
--  auth.uid() is always null. RLS is therefore keyed on a per-transaction GUC:
--
--        current_setting('app.user_id', true)::uuid
--
--  The server sets it with SET LOCAL inside every user-scoped transaction and
--  connects as the non-privileged `tm_app` role, which does NOT have BYPASSRLS.
--  Express ownership checks remain as a second, independent layer.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ── shared helpers ──────────────────────────────────────────────────────────

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- The id every RLS policy compares against. Null-safe: returns null when unset.
create or replace function app_user_id()
returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- ── profiles ────────────────────────────────────────────────────────────────

create table if not exists profiles (
  id              uuid primary key default uuid_generate_v4(),
  email           text not null unique,
  full_name       text,
  password_hash   text not null,
  date_of_birth   date,
  age_verified    boolean not null default false,
  risk_per_trade  numeric(5,2) not null default 1.00,      -- % of capital per trade
  max_daily_loss  numeric(6,2) not null default 3.00,      -- % of capital per day
  max_open_positions integer not null default 3,
  markets_enabled text[] not null default array['stocks'],
  bot_armed       boolean not null default false,
  onboarded       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint risk_per_trade_range check (risk_per_trade between 0.10 and 5.00),
  constraint max_daily_loss_range check (max_daily_loss between 0.50 and 20.00),
  constraint max_open_positions_range check (max_open_positions between 1 and 10)
);

drop trigger if exists profiles_set_updated_at on profiles;
create trigger profiles_set_updated_at before update on profiles
  for each row execute function set_updated_at();

-- ── sessions (cross-device: one row per logged-in device) ───────────────────

create table if not exists sessions (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references profiles(id) on delete cascade,
  jti          text not null unique,
  device_label text,
  ip           text,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz
);
create index if not exists sessions_user_idx on sessions(user_id);
create index if not exists sessions_jti_idx on sessions(jti);

-- ── wallets (SIMULATED INR — no payment gateway, no custody) ────────────────

create table if not exists wallets (
  user_id        uuid primary key references profiles(id) on delete cascade,
  sim_balance    numeric(16,2) not null default 0.00,
  total_deposits numeric(16,2) not null default 0.00,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint sim_balance_non_negative check (sim_balance >= 0)
);

drop trigger if exists wallets_set_updated_at on wallets;
create trigger wallets_set_updated_at before update on wallets
  for each row execute function set_updated_at();

create table if not exists wallet_transactions (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references profiles(id) on delete cascade,
  kind       text not null check (kind in ('deposit','withdraw','reset')),
  amount     numeric(16,2) not null,
  balance_after numeric(16,2) not null,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists wallet_tx_user_idx on wallet_transactions(user_id, created_at desc);

-- ── orders & positions ──────────────────────────────────────────────────────

create table if not exists orders (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references profiles(id) on delete cascade,
  symbol       text not null,
  market       text not null,
  side         text not null check (side in ('buy','sell')),
  qty          numeric(16,6) not null check (qty > 0),
  order_type   text not null default 'market' check (order_type in ('market','limit')),
  limit_price  numeric(18,6),
  filled_price numeric(18,6),
  stop_loss    numeric(18,6),
  target       numeric(18,6),
  status       text not null default 'filled' check (status in ('filled','rejected','cancelled')),
  reason       text,
  opened_by    text not null default 'user' check (opened_by in ('user','bot')),
  created_at   timestamptz not null default now()
);
create index if not exists orders_user_idx on orders(user_id, created_at desc);

-- Pending-order book (limit orders resting away from the touch, stop orders
-- waiting for their trigger). Idempotent upgrades for existing databases.
alter table orders add column if not exists stop_price numeric(18,6);
alter table orders drop constraint if exists orders_order_type_check;
alter table orders add constraint orders_order_type_check check (order_type in ('market','limit','stop'));
alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check check (status in ('filled','rejected','cancelled','pending'));
alter table orders drop constraint if exists orders_opened_by_check;
alter table orders add constraint orders_opened_by_check check (opened_by in ('user','bot','pending'));


create table if not exists positions (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references profiles(id) on delete cascade,
  symbol        text not null,
  market        text not null,
  side          text not null check (side in ('long','short')),
  qty           numeric(16,6) not null check (qty > 0),
  entry_price   numeric(18,6) not null,
  current_price numeric(18,6) not null,
  stop_loss     numeric(18,6),
  target        numeric(18,6),
  margin_used   numeric(16,2) not null default 0.00,
  risk_amount   numeric(16,2),               -- rupees at risk if the stop is hit
  entry_setup   text not null default 'manual',
  entry_features jsonb,                      -- indicator snapshot captured AT ENTRY
  opened_by     text not null default 'user' check (opened_by in ('user','bot')),
  status        text not null default 'open' check (status in ('open','closed')),
  exit_price    numeric(18,6),
  exit_reason   text,
  pnl           numeric(16,2),
  opened_at     timestamptz not null default now(),
  closed_at     timestamptz
);
create index if not exists positions_user_open_idx on positions(user_id, status);
-- At most one OPEN position per symbol per direction. Partial index, so closed
-- history does not block re-entering the same instrument later.
drop index if exists positions_one_open_per_symbol;
create unique index positions_one_open_per_symbol
  on positions(user_id, symbol, side) where status = 'open';

-- ── closed-trade memory: what the bot learns from ───────────────────────────

create table if not exists bot_memory (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references profiles(id) on delete cascade,
  position_id   uuid,
  symbol        text not null,
  market        text not null,
  side          text not null,
  setup         text not null,               -- strategy label that produced the trade
  qty           numeric(16,6) not null,
  entry_price   numeric(18,6) not null,
  exit_price    numeric(18,6) not null,
  pnl           numeric(16,2) not null,
  pnl_pct       numeric(8,4) not null,
  r_multiple    numeric(8,4),                -- outcome in units of risk
  outcome       text not null check (outcome in ('win','loss','scratch')),
  exit_reason   text,
  -- features captured at entry, used by the online logistic scorer
  f_rsi         numeric(8,4),
  f_trend       numeric(8,4),                -- +1 up / -1 down
  f_trend_str   numeric(8,4),
  f_atr_pct     numeric(8,4),
  f_dist_sup    numeric(8,4),
  f_dist_res    numeric(8,4),
  f_ret5        numeric(8,4),
  f_ret20       numeric(8,4),
  f_body_ratio  numeric(8,4),
  f_risk_pct    numeric(8,4),
  opened_by     text not null default 'bot',
  lesson        text,                        -- human-readable takeaway
  created_at    timestamptz not null default now()
);
create index if not exists bot_memory_user_idx on bot_memory(user_id, created_at desc);
create index if not exists bot_memory_setup_idx on bot_memory(user_id, setup);

create table if not exists bot_state (
  user_id         uuid primary key references profiles(id) on delete cascade,
  enabled         boolean not null default false,
  setups          jsonb not null default '{}'::jsonb,   -- per-setup learned stats/weights
  weights         jsonb not null default '{}'::jsonb,   -- online logistic regression coefficients
  trades_seen     integer not null default 0,
  daily_loss_hit  boolean not null default false,
  kill_switch     boolean not null default false,
  last_run_at     timestamptz,
  updated_at      timestamptz not null default now()
);

drop trigger if exists bot_state_set_updated_at on bot_state;
create trigger bot_state_set_updated_at before update on bot_state
  for each row execute function set_updated_at();

-- ── learning roadmap (the 14 steps) ─────────────────────────────────────────

create table if not exists learning_progress (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null references profiles(id) on delete cascade,
  module_id      text not null,
  status         text not null default 'locked' check (status in ('locked','available','in_progress','completed')),
  lessons_read   text[] not null default '{}',
  quiz_score     integer,
  quiz_attempts  integer not null default 0,
  completed_at   timestamptz,
  updated_at     timestamptz not null default now(),
  unique (user_id, module_id)
);
create index if not exists learning_user_idx on learning_progress(user_id);

drop trigger if exists learning_set_updated_at on learning_progress;
create trigger learning_set_updated_at before update on learning_progress
  for each row execute function set_updated_at();

-- ── user CRUD: watchlist, notes ("items"), journal ──────────────────────────

create table if not exists watchlist (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references profiles(id) on delete cascade,
  symbol     text not null,
  note       text,
  created_at timestamptz not null default now(),
  unique (user_id, symbol)
);

create table if not exists notes (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references profiles(id) on delete cascade,
  title       text not null,
  description text,
  ai_summary  text,
  tags        text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists notes_user_idx on notes(user_id, created_at desc);

drop trigger if exists notes_set_updated_at on notes;
create trigger notes_set_updated_at before update on notes
  for each row execute function set_updated_at();

create table if not exists journal (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references profiles(id) on delete cascade,
  symbol      text,
  side        text,
  emotion     text check (emotion in ('calm','fear','greed','anger','hope','neutral')),
  followed_plan boolean,
  rating      integer check (rating between 1 and 5),
  body        text not null,
  ai_feedback text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists journal_user_idx on journal(user_id, created_at desc);

drop trigger if exists journal_set_updated_at on journal;
create trigger journal_set_updated_at before update on journal
  for each row execute function set_updated_at();

create table if not exists ai_requests (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references profiles(id) on delete cascade,
  mode       text not null,
  prompt     text not null,
  chars_in   integer not null default 0,
  chars_out  integer not null default 0,
  ok         boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists ai_requests_user_idx on ai_requests(user_id, created_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY
--  Every user-owned table: users may touch only their own rows.
--  profiles: read/update own row, never insert/delete through the app role.
-- ═══════════════════════════════════════════════════════════════════════════

alter table profiles            enable row level security;
alter table sessions            enable row level security;
alter table wallets             enable row level security;
alter table wallet_transactions enable row level security;
alter table orders              enable row level security;
alter table positions           enable row level security;
alter table bot_memory          enable row level security;
alter table bot_state           enable row level security;
alter table learning_progress   enable row level security;
alter table watchlist           enable row level security;
alter table notes               enable row level security;
alter table journal             enable row level security;
alter table ai_requests         enable row level security;

-- profiles is keyed on id, everything else on user_id.
do $$
declare t text;
begin
  foreach t in array array['sessions','wallets','wallet_transactions','orders','positions',
                           'bot_memory','bot_state','learning_progress','watchlist','notes',
                           'journal','ai_requests']
  loop
    execute format('drop policy if exists %I on %I', t || '_own_all', t);
    execute format(
      'create policy %I on %I for all using (user_id = app_user_id()) with check (user_id = app_user_id())',
      t || '_own_all', t);
  end loop;
end $$;

drop policy if exists profiles_own_all on profiles;
create policy profiles_own_all on profiles
  for all using (id = app_user_id()) with check (id = app_user_id());

-- The app role must never create or delete accounts; the auth routes use the
-- privileged admin connection for exactly those two operations.
-- These MUST be RESTRICTIVE: permissive policies combine with OR, so a
-- permissive "deny" would be ignored. Restrictive policies AND together.
drop policy if exists profiles_no_insert on profiles;
create policy profiles_no_insert on profiles as restrictive for insert with check (false);
drop policy if exists profiles_no_delete on profiles;
create policy profiles_no_delete on profiles as restrictive for delete using (false);

-- ── application role used for all user-scoped queries (no BYPASSRLS) ────────
-- Password is injected by migrate.js from APP_DB_ROLE_PASSWORD.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'tm_app') then
    execute 'create role tm_app login nobypassrls';
  end if;
end $$;

grant usage on schema public to tm_app;
grant select, insert, update, delete on all tables in schema public to tm_app;
grant usage, select on all sequences in schema public to tm_app;
alter default privileges in schema public grant select, insert, update, delete on tables to tm_app;

-- Sequences aren't used (uuid defaults), but keep this harmless.

-- (appended last: alters must run after every create table)
alter table positions drop constraint if exists positions_opened_by_check;
alter table positions add constraint positions_opened_by_check check (opened_by in ('user','bot','pending'));

-- Real intraday candles aggregated server-side from live quote ticks (Finnhub
-- US equities). Every row came from a real exchange print — never simulated.
create table if not exists live_candles (
  symbol    text           not null,
  t         bigint         not null,
  o         numeric(18,4)  not null,
  h         numeric(18,4)  not null,
  l         numeric(18,4)  not null,
  c         numeric(18,4)  not null,
  v         bigint         not null default 0,
  provider  text           not null default 'finnhub',
  updated_at timestamptz   not null default now(),
  primary key (symbol, t)
);
create index if not exists live_candles_sym_t on live_candles (symbol, t desc);

-- ── LIVE (own-broker) fenced routing ─────────────────────────────────────
-- The app NEVER holds money. These tables store the user's daily broker
-- session (encrypted access token) and a full audit trail of every live
-- order attempt. Funds stay at the SEBI-registered broker at all times.
create table if not exists live_sessions (
  user_id      uuid        primary key references profiles(id) on delete cascade,
  broker       text        not null default 'zerodha',
  access_token text        not null,            -- AES-256-GCM ciphertext
  token_iv     text        not null,
  token_tag    text        not null,
  obtained_at  timestamptz not null default now(),
  expires_at   timestamptz not null,            -- Kite tokens die ~6am IST daily
  active       boolean     not null default false, -- live-mode opt-in switch
  updated_at   timestamptz not null default now()
);

create table if not exists live_orders (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references profiles(id) on delete cascade,
  ts             timestamptz not null default now(),
  symbol         text        not null,
  exchange       text        not null,
  side           text        not null,
  qty            integer     not null,
  product        text        not null,
  order_type     text        not null,
  price          numeric(18,4),
  status         text        not null,          -- requested | placed | rejected | panic_cancelled | error
  broker_order_id text,
  detail         text,
  day_pnl_before numeric(18,2)
);
create index if not exists live_orders_user_ts on live_orders (user_id, ts desc);
