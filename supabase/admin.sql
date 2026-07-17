-- ════════════════════════════════════════════════════════════════
--  Offset — operator / platform admin
--
--  Run this AFTER schema.sql (and teams.sql / limits.sql if you use those
--  features). It adds an admins allowlist, an is_admin() gate, audited admin
--  actions, and read-only aggregate functions for the /admin dashboard.
--
--  SECURITY MODEL: every admin function is SECURITY DEFINER but guarded by
--  is_admin() (which reads the caller's JWT via auth.uid()), so only allow-
--  listed admins can execute them — even though the body runs with elevated
--  rights to read across all users. The service-role key is NOT needed.
--
--  ⚠️ BOOTSTRAP: make yourself the first admin by inserting your auth user id:
--      insert into public.admins (user_id) values ('<your-auth-uid>');
--  (find it in Supabase → Authentication → Users). Safe to re-run.
-- ════════════════════════════════════════════════════════════════

-- Who is an operator/admin. Roles: superadmin | admin | support.
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'admin',
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

-- Is the current caller (or a given uid) an admin?
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.admins a where a.user_id = uid);
$$;
grant execute on function public.is_admin(uuid) to authenticated;

-- Admins may read the allowlist (to learn their own role); no client writes.
drop policy if exists "admins read" on public.admins;
create policy "admins read" on public.admins
  for select using (auth.uid() = user_id or public.is_admin());

-- Audit trail of admin actions (accountability).
create table if not exists public.admin_audit (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid references auth.users(id) on delete set null,
  admin_email  text,
  action       text not null,
  target_user  uuid,
  target_email text,
  detail       jsonb,
  created_at   timestamptz not null default now()
);
alter table public.admin_audit enable row level security;
drop policy if exists "audit read admins" on public.admin_audit;
create policy "audit read admins" on public.admin_audit
  for select using (public.is_admin());

-- ── Read-only aggregate for the admin dashboard ──────────────────
-- Optional tables (memberships, documents, scan_usage) are counted defensively
-- so this works whether or not you've applied teams.sql / limits.sql.
create or replace function public.admin_overview()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
stable
as $$
declare
  v_members bigint := 0;
  v_docs    bigint := 0;
  v_scans   bigint := 0;
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  begin select count(*) into v_members from public.memberships; exception when undefined_table then v_members := 0; end;
  begin select count(*) into v_docs    from public.documents;   exception when undefined_table then v_docs := 0; end;
  begin
    select coalesce(sum(count), 0) into v_scans from public.scan_usage where month = to_char(now(), 'YYYY-MM');
  exception when undefined_table then v_scans := 0;
  end;

  return jsonb_build_object(
    'users',            (select count(*) from auth.users),
    'signups_7d',       (select count(*) from auth.users where created_at >= now() - interval '7 days'),
    'signups_30d',      (select count(*) from auth.users where created_at >= now() - interval '30 days'),
    'active_30d',       (select count(*) from auth.users where last_sign_in_at >= now() - interval '30 days'),
    'pro_users',        (select count(*) from public.profiles where plan = 'pro'),
    'sub_active',       (select count(*) from public.profiles where status = 'active'),
    'sub_past_due',     (select count(*) from public.profiles where status in ('past_due', 'unpaid')),
    'sub_canceled',     (select count(*) from public.profiles where status = 'canceled'),
    'assets',           (select count(*) from public.properties),
    'expenses',         (select count(*) from public.expenses),
    'income',           (select count(*) from public.income),
    'documents',        v_docs,
    'memberships',      v_members,
    'scans_this_month', v_scans
  );
end;
$$;
grant execute on function public.admin_overview() to authenticated;

-- Paginated, searchable user list with per-user activity + plan.
create or replace function public.admin_list_users(p_search text default '', p_limit int default 50, p_offset int default 0)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
stable
as $$
declare result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into result
  from (
    select
      u.id                                                        as user_id,
      u.email                                                     as email,
      u.created_at                                                as created_at,
      u.last_sign_in_at                                           as last_sign_in_at,
      coalesce(pr.plan, 'free')                                   as plan,
      (select count(*) from public.properties p where p.user_id = u.id) as assets,
      (select count(*) from public.expenses  e where e.user_id = u.id) as expenses,
      (select count(*) from public.income    i where i.user_id = u.id) as income,
      public.is_admin(u.id)                                       as is_admin
    from auth.users u
    left join public.profiles pr on pr.user_id = u.id
    where p_search = '' or u.email ilike '%' || p_search || '%'
    order by u.created_at desc
    limit greatest(1, least(p_limit, 200))
    offset greatest(0, p_offset)
  ) t;

  return result;
end;
$$;
grant execute on function public.admin_list_users(text, int, int) to authenticated;

-- ── Admin roles ──────────────────────────────────────────────────
-- superadmin: everything, incl. managing admins & app config.
-- admin:      users + plans + config.
-- support:    users + plans.
-- readonly:   view only.
create or replace function public.admin_role(uid uuid default auth.uid())
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.admins where user_id = uid;
$$;
grant execute on function public.admin_role(uuid) to authenticated;

-- May the caller perform user/plan write actions?
create or replace function public.admin_can_write()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.admin_role() in ('superadmin', 'admin', 'support');
$$;
grant execute on function public.admin_can_write() to authenticated;

-- Set a user's plan (comp Pro / downgrade), writing an audit row.
create or replace function public.admin_set_plan(p_target uuid, p_plan text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_email text;
begin
  if not public.admin_can_write() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if p_plan not in ('free', 'pro') then
    raise exception 'invalid_plan';
  end if;

  insert into public.profiles (user_id, plan, updated_at)
  values (p_target, p_plan, now())
  on conflict (user_id) do update set plan = excluded.plan, updated_at = now();

  select email into v_email from auth.users where id = p_target;
  insert into public.admin_audit (admin_id, admin_email, action, target_user, target_email, detail)
  values (
    auth.uid(),
    (select email from auth.users where id = auth.uid()),
    'set_plan', p_target, v_email, jsonb_build_object('plan', p_plan)
  );

  return p_plan;
end;
$$;
grant execute on function public.admin_set_plan(uuid, text) to authenticated;

-- Recent admin audit entries.
create or replace function public.admin_audit_log(p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into result
  from (
    select id, admin_email, action, target_email, detail, created_at
    from public.admin_audit
    order by created_at desc
    limit greatest(1, least(p_limit, 200))
  ) t;
  return result;
end;
$$;
grant execute on function public.admin_audit_log(int) to authenticated;

-- ── App config: banners, maintenance mode, editable plan limits ──
-- Publicly readable (drives the app-wide banner and the plan limits shown in
-- the app); written only by admin/superadmin via admin_set_config().
create table if not exists public.app_config (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
drop policy if exists "config public read" on public.app_config;
create policy "config public read" on public.app_config for select using (true);

insert into public.app_config (key, value) values
  ('announcement', jsonb_build_object('active', false, 'text', '')),
  ('maintenance',  jsonb_build_object('active', false, 'message', 'Offset is undergoing brief maintenance — please check back soon.')),
  ('plans',        jsonb_build_object('pro_price', 499, 'free_assets', 2, 'free_scans', 10))
on conflict (key) do nothing;

create or replace function public.admin_set_config(p_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if public.admin_role() not in ('superadmin', 'admin') then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  insert into public.app_config (key, value, updated_at)
  values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into public.admin_audit (admin_id, admin_email, action, detail)
  values (auth.uid(), (select email from auth.users where id = auth.uid()), 'set_config', jsonb_build_object('key', p_key, 'value', p_value));
  return p_value;
end;
$$;
grant execute on function public.admin_set_config(text, jsonb) to authenticated;

-- ── Manage the admin allowlist (superadmin only) ─────────────────
create or replace function public.admin_list_admins()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
stable
as $$
declare result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into result
  from (
    select a.user_id, u.email, a.role, a.created_at
    from public.admins a
    join auth.users u on u.id = a.user_id
    order by a.created_at
  ) t;
  return result;
end;
$$;
grant execute on function public.admin_list_admins() to authenticated;

create or replace function public.admin_add_admin(p_email text, p_role text default 'admin')
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_uid uuid;
begin
  if public.admin_role() <> 'superadmin' then
    raise exception 'not_superadmin' using errcode = '42501';
  end if;
  if p_role not in ('superadmin', 'admin', 'support', 'readonly') then
    raise exception 'invalid_role';
  end if;
  select id into v_uid from auth.users where lower(email) = lower(p_email);
  if v_uid is null then
    raise exception 'no_such_user';
  end if;
  insert into public.admins (user_id, role) values (v_uid, p_role)
    on conflict (user_id) do update set role = excluded.role;
  insert into public.admin_audit (admin_id, admin_email, action, target_user, target_email, detail)
    values (auth.uid(), (select email from auth.users where id = auth.uid()), 'add_admin', v_uid, p_email, jsonb_build_object('role', p_role));
  return p_role;
end;
$$;
grant execute on function public.admin_add_admin(text, text) to authenticated;

create or replace function public.admin_remove_admin(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if public.admin_role() <> 'superadmin' then
    raise exception 'not_superadmin' using errcode = '42501';
  end if;
  if p_uid = auth.uid() then
    raise exception 'cannot_remove_self';
  end if;
  delete from public.admins where user_id = p_uid;
  insert into public.admin_audit (admin_id, admin_email, action, target_user)
    values (auth.uid(), (select email from auth.users where id = auth.uid()), 'remove_admin', p_uid);
end;
$$;
grant execute on function public.admin_remove_admin(uuid) to authenticated;
