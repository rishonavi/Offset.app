-- ════════════════════════════════════════════════════════════════
--  Offset — problem reports
--
--  Run this AFTER schema.sql and admin.sql. It gives "Report a problem" a
--  destination: reports land in a table the reporter can read back and an
--  operator can triage from /admin.
--
--  SECURITY MODEL: clients never insert directly. submit_report() is SECURITY
--  DEFINER, takes the reporter's identity from auth.uid() rather than from its
--  arguments (so nobody can file a report as somebody else), and refuses more
--  than RATE_LIMIT reports per day from one account. Reading is RLS: your own
--  reports, or everything if you are an admin. Only admin_set_report_status()
--  can change a report's state, and it writes an audit row when it does.
--
--  Safe to re-run.
-- ════════════════════════════════════════════════════════════════

create table if not exists public.bug_reports (
  id          uuid primary key default gen_random_uuid(),
  -- The short code shown to the reporter ("OF-K3M9P2"), minted client-side so
  -- they have something to quote even if this insert never happens.
  reference   text not null,
  user_id     uuid references auth.users(id) on delete set null,
  email       text,
  kind        text not null default 'other',
  message     text not null,
  expected    text,
  diagnostics jsonb,
  -- new → triaged → fixed | wontfix. 'new' is the operator's inbox.
  status      text not null default 'new',
  admin_note  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists bug_reports_status_idx  on public.bug_reports (status, created_at desc);
create index if not exists bug_reports_user_idx    on public.bug_reports (user_id, created_at desc);
create unique index if not exists bug_reports_ref_idx on public.bug_reports (reference);

alter table public.bug_reports enable row level security;

-- Your own reports; everything if you're an operator. No client INSERT policy:
-- filing goes through submit_report() so the rate limit can't be sidestepped.
drop policy if exists "reports read own" on public.bug_reports;
create policy "reports read own" on public.bug_reports
  for select using (auth.uid() = user_id or public.is_admin());

-- Withdrawing your own report is allowed; editing it after the fact is not.
drop policy if exists "reports delete own" on public.bug_reports;
create policy "reports delete own" on public.bug_reports
  for delete using (auth.uid() = user_id);

-- ── Filing ───────────────────────────────────────────────────────
-- Identity comes from the JWT, never from the arguments.
create or replace function public.submit_report(
  p_reference   text,
  p_kind        text,
  p_message     text,
  p_expected    text default null,
  p_email       text default null,
  p_diagnostics jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid    uuid := auth.uid();
  v_recent int;
  v_row    public.bug_reports;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if coalesce(btrim(p_message), '') = '' then
    raise exception 'empty_report';
  end if;

  -- A jammed key or a bad script shouldn't be able to fill the table. Twenty a
  -- day is far more than a person reports and far less than a loop produces.
  select count(*) into v_recent
    from public.bug_reports
   where user_id = v_uid and created_at > now() - interval '24 hours';
  if v_recent >= 20 then
    raise exception 'too_many_reports';
  end if;

  insert into public.bug_reports (reference, user_id, email, kind, message, expected, diagnostics)
  values (
    coalesce(nullif(btrim(p_reference), ''), 'OF-' || upper(substr(md5(random()::text), 1, 6))),
    v_uid,
    nullif(btrim(p_email), ''),
    coalesce(nullif(btrim(p_kind), ''), 'other'),
    left(btrim(p_message), 4000),
    left(coalesce(btrim(p_expected), ''), 2000),
    p_diagnostics
  )
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;
grant execute on function public.submit_report(text, text, text, text, text, jsonb) to authenticated;

-- ── Operator inbox ───────────────────────────────────────────────
create or replace function public.admin_list_reports(
  p_status text default '',
  p_limit  int  default 50,
  p_offset int  default 0
)
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
      r.id, r.reference, r.kind, r.message, r.expected, r.diagnostics,
      r.status, r.admin_note, r.created_at, r.updated_at,
      -- The address they asked to be replied on, falling back to the account.
      coalesce(r.email, u.email) as email,
      r.user_id
    from public.bug_reports r
    left join auth.users u on u.id = r.user_id
    where p_status = '' or r.status = p_status
    order by
      -- Unlooked-at reports first; then newest.
      case when r.status = 'new' then 0 else 1 end,
      r.created_at desc
    limit greatest(1, least(p_limit, 200))
    offset greatest(0, p_offset)
  ) t;

  return result;
end;
$$;
grant execute on function public.admin_list_reports(text, int, int) to authenticated;

-- How many are waiting, so the admin page can show a badge without pulling
-- every report down.
create or replace function public.admin_report_counts()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
    from (select status, count(*) as n from public.bug_reports group by status) s
  );
end;
$$;
grant execute on function public.admin_report_counts() to authenticated;

create or replace function public.admin_set_report_status(p_id uuid, p_status text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_row public.bug_reports;
begin
  if not public.admin_can_write() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if p_status not in ('new', 'triaged', 'fixed', 'wontfix') then
    raise exception 'invalid_status';
  end if;

  update public.bug_reports
     set status = p_status,
         admin_note = coalesce(nullif(btrim(p_note), ''), admin_note),
         updated_at = now()
   where id = p_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'no_such_report';
  end if;

  insert into public.admin_audit (admin_id, admin_email, action, target_user, target_email, detail)
  values (
    auth.uid(),
    (select email from auth.users where id = auth.uid()),
    'set_report_status', v_row.user_id, v_row.email,
    jsonb_build_object('reference', v_row.reference, 'status', p_status)
  );

  return to_jsonb(v_row);
end;
$$;
grant execute on function public.admin_set_report_status(uuid, text, text) to authenticated;
