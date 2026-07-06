-- ════════════════════════════════════════════════════════════════
--  Offset — Supabase schema
--  Run this once in your Supabase project:
--    Dashboard → SQL Editor → New query → paste this → Run
-- ════════════════════════════════════════════════════════════════

-- ── Tables ───────────────────────────────────────────────────────
create table if not exists public.properties (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name            text not null,
  type            text,
  address         text,
  monthly_budget  numeric(14,2),
  notes           text,
  created_at      timestamptz not null default now()
);

-- Add the budget + value columns to pre-existing installs (safe to re-run).
alter table public.properties add column if not exists monthly_budget numeric(14,2);
alter table public.properties add column if not exists value          numeric(14,2);

-- Loan / mortgage held against the asset (all optional; safe to re-run).
alter table public.properties add column if not exists loan_principal     numeric(14,2);
alter table public.properties add column if not exists loan_rate          numeric(6,3);
alter table public.properties add column if not exists loan_tenure_months integer;
alter table public.properties add column if not exists loan_start         date;

-- Tenancy / lease for rented assets (all optional; safe to re-run).
alter table public.properties add column if not exists tenant_name text;
alter table public.properties add column if not exists lease_start date;
alter table public.properties add column if not exists lease_end   date;
alter table public.properties add column if not exists deposit     numeric(14,2);

create table if not exists public.expenses (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade default auth.uid(),
  property_id    uuid not null references public.properties(id) on delete cascade,
  date           date not null,
  amount         numeric(14,2) not null check (amount >= 0),
  category       text,
  vendor         text,
  payment_method text,
  description    text,
  receipt_url    text,
  created_at     timestamptz not null default now()
);

create index if not exists expenses_user_idx     on public.expenses(user_id);
create index if not exists expenses_property_idx  on public.expenses(property_id);
create index if not exists expenses_date_idx      on public.expenses(date);

-- ── Row Level Security: a user only ever sees their own rows ─────
alter table public.properties enable row level security;
alter table public.expenses   enable row level security;

drop policy if exists "own properties" on public.properties;
create policy "own properties" on public.properties
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own expenses" on public.expenses;
create policy "own expenses" on public.expenses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Income (rent & other income) ─────────────────────────────────
create table if not exists public.income (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade default auth.uid(),
  property_id    uuid not null references public.properties(id) on delete cascade,
  date           date not null,
  amount         numeric(14,2) not null check (amount >= 0),
  source         text,
  payer          text,
  payment_method text,
  description    text,
  receipt_url    text,
  created_at     timestamptz not null default now()
);

create index if not exists income_user_idx     on public.income(user_id);
create index if not exists income_property_idx  on public.income(property_id);
create index if not exists income_date_idx      on public.income(date);

alter table public.income enable row level security;
drop policy if exists "own income" on public.income;
create policy "own income" on public.income
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Payment tracking: status + due date (safe to re-run) ─────────
alter table public.expenses add column if not exists status   text default 'paid';
alter table public.expenses add column if not exists due_date date;
alter table public.income   add column if not exists status   text default 'received';
alter table public.income   add column if not exists due_date date;

-- ── Tax / GST amount (safe to re-run) ────────────────────────────
alter table public.expenses add column if not exists tax numeric(14,2);
alter table public.income   add column if not exists tax numeric(14,2);

-- ── Recurrence: none | monthly | quarterly | yearly (safe to re-run) ─
alter table public.expenses add column if not exists recurrence text default 'none';
alter table public.income   add column if not exists recurrence text default 'none';

-- ── Billing / plan (commercial tiers; written by the Stripe webhook) ─
create table if not exists public.profiles (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  plan               text not null default 'free',
  stripe_customer_id text,
  status             text,
  updated_at         timestamptz default now()
);
alter table public.profiles enable row level security;
-- Users may READ their own plan; only the service role (Stripe webhook) writes.
drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles
  for select using (auth.uid() = user_id);

-- ── Receipt storage (private bucket) ─────────────────────────────
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- Files live under a folder named after the user's id:  <uid>/<filename>
drop policy if exists "receipts read own" on storage.objects;
create policy "receipts read own" on storage.objects
  for select using (bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "receipts insert own" on storage.objects;
create policy "receipts insert own" on storage.objects
  for insert with check (bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "receipts delete own" on storage.objects;
create policy "receipts delete own" on storage.objects
  for delete using (bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]);
