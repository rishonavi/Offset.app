-- ════════════════════════════════════════════════════════════════
--  Offset — server-side plan limits (opt-in)
--
--  Run this AFTER schema.sql, and ONLY when you have enabled billing and
--  want the Free-plan caps enforced in the database (so they can't be
--  bypassed from the browser). While billing is off, everyone is treated as
--  Pro and you should NOT run this. Safe to re-run.
--
--  Keep the numbers in sync with src/lib/plans.js.
-- ════════════════════════════════════════════════════════════════

-- Per-plan asset cap. The free cap is read from app_config ('plans'.free_assets)
-- when present (so the admin config editor stays in sync), else defaults to 2.
create or replace function public.plan_asset_limit(p text)
returns integer
language plpgsql
stable
set search_path = public
as $$
declare v integer := 2;
begin
  if coalesce(p, 'free') = 'pro' then
    return 2147483647; -- effectively unlimited
  end if;
  begin
    select (value ->> 'free_assets')::int into v from public.app_config where key = 'plans';
  exception when undefined_table then v := 2;
  end;
  return coalesce(v, 2);
end;
$$;

-- Reject an insert that would take the workspace owner over their plan's asset
-- limit. Counts against new.user_id (the workspace owner), so an editor adding
-- to a shared workspace is governed by the OWNER's plan.
create or replace function public.enforce_asset_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_plan text;
  cap integer;
  existing integer;
begin
  select plan into current_plan from public.profiles where user_id = new.user_id;
  cap := public.plan_asset_limit(current_plan);
  select count(*) into existing from public.properties where user_id = new.user_id;
  if existing >= cap then
    raise exception 'asset_limit_reached'
      using errcode = 'check_violation',
            hint = 'Upgrade to Pro for unlimited assets.';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_asset_limit on public.properties;
create trigger enforce_asset_limit
  before insert on public.properties
  for each row execute function public.enforce_asset_limit();

-- ── AI-scan usage (monthly, per user) ────────────────────────────
-- The /api/scan-receipt function records a scan here (service role) and checks
-- the count against the plan before scanning when ENFORCE_PLAN_LIMITS=true.
create table if not exists public.scan_usage (
  user_id uuid  not null references auth.users(id) on delete cascade,
  month   text  not null,               -- 'YYYY-MM'
  count   integer not null default 0,
  primary key (user_id, month)
);
alter table public.scan_usage enable row level security;
-- Users may read their own usage; only the service role writes it.
drop policy if exists "own scan usage read" on public.scan_usage;
create policy "own scan usage read" on public.scan_usage
  for select using (auth.uid() = user_id);

-- Atomic increment used by the serverless function.
create or replace function public.record_scan(uid uuid, mon text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare c integer;
begin
  insert into public.scan_usage (user_id, month, count)
  values (uid, mon, 1)
  on conflict (user_id, month) do update set count = public.scan_usage.count + 1
  returning count into c;
  return c;
end;
$$;
