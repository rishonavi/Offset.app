-- ════════════════════════════════════════════════════════════════
--  Offset — Teams / shared access (read-only sharing)
--
--  Run this AFTER schema.sql. It is ADDITIVE and owner-preserving: it only
--  GRANTS members read access to a workspace; it never changes who can write
--  (owners keep full control; shared users are read-only). Safe to re-run.
--
--  ⚠️ This touches row-level security. Test on a copy/branch first if you can.
-- ════════════════════════════════════════════════════════════════

-- Who can see whose workspace. The "owner" is the user_id that owns the data
-- rows; a "member" is granted read access. Emails are denormalised so the UI
-- can show them without reading auth.users.
create table if not exists public.memberships (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  member_id    uuid not null references auth.users(id) on delete cascade,
  owner_email  text,
  member_email text,
  role         text not null default 'viewer',
  created_at   timestamptz not null default now(),
  unique (owner_id, member_id)
);

alter table public.memberships enable row level security;

-- A user can see memberships that involve them (as owner or member).
drop policy if exists "memberships involve me" on public.memberships;
create policy "memberships involve me" on public.memberships
  for select using (auth.uid() = owner_id or auth.uid() = member_id);

-- Owners can manage (remove) their own shares from the app. New invites are
-- created by the /api/team/invite function with the service role.
drop policy if exists "owner manages memberships" on public.memberships;
create policy "owner manages memberships" on public.memberships
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- SECURITY DEFINER so it can read memberships without recursive RLS checks.
create or replace function public.can_read_workspace(owner uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select owner = auth.uid()
      or exists (
        select 1 from public.memberships m
        where m.owner_id = owner and m.member_id = auth.uid()
      );
$$;

-- Add a READ policy so members can select an owner's rows. The existing
-- "own …" policies (full owner access incl. writes) stay exactly as they were,
-- so nothing the owner can do changes.
drop policy if exists "read shared properties" on public.properties;
create policy "read shared properties" on public.properties
  for select using (public.can_read_workspace(user_id));

drop policy if exists "read shared expenses" on public.expenses;
create policy "read shared expenses" on public.expenses
  for select using (public.can_read_workspace(user_id));

drop policy if exists "read shared income" on public.income;
create policy "read shared income" on public.income
  for select using (public.can_read_workspace(user_id));

-- Let the function be called by signed-in users.
grant execute on function public.can_read_workspace(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════
--  Editor (write) sharing — additive. Members whose role = 'editor' may
--  WRITE into the owner's workspace; 'viewer' members stay read-only. The
--  existing owner "own …" policies are untouched, so owners keep full control.
--  Safe to re-run.
-- ════════════════════════════════════════════════════════════════

create or replace function public.can_write_workspace(owner uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select owner = auth.uid()
      or exists (
        select 1 from public.memberships m
        where m.owner_id = owner
          and m.member_id = auth.uid()
          and m.role = 'editor'
      );
$$;
grant execute on function public.can_write_workspace(uuid) to authenticated;

-- Additive insert/update/delete policies for editors. Postgres OR-combines
-- these with the owner "own …" policies, so both owner and editor can write.
-- properties
drop policy if exists "write shared properties" on public.properties;
create policy "write shared properties" on public.properties
  for insert with check (public.can_write_workspace(user_id));
drop policy if exists "update shared properties" on public.properties;
create policy "update shared properties" on public.properties
  for update using (public.can_write_workspace(user_id)) with check (public.can_write_workspace(user_id));
drop policy if exists "delete shared properties" on public.properties;
create policy "delete shared properties" on public.properties
  for delete using (public.can_write_workspace(user_id));

-- expenses
drop policy if exists "write shared expenses" on public.expenses;
create policy "write shared expenses" on public.expenses
  for insert with check (public.can_write_workspace(user_id));
drop policy if exists "update shared expenses" on public.expenses;
create policy "update shared expenses" on public.expenses
  for update using (public.can_write_workspace(user_id)) with check (public.can_write_workspace(user_id));
drop policy if exists "delete shared expenses" on public.expenses;
create policy "delete shared expenses" on public.expenses
  for delete using (public.can_write_workspace(user_id));

-- income
drop policy if exists "write shared income" on public.income;
create policy "write shared income" on public.income
  for insert with check (public.can_write_workspace(user_id));
drop policy if exists "update shared income" on public.income;
create policy "update shared income" on public.income
  for update using (public.can_write_workspace(user_id)) with check (public.can_write_workspace(user_id));
drop policy if exists "delete shared income" on public.income;
create policy "delete shared income" on public.income
  for delete using (public.can_write_workspace(user_id));

-- documents: members need read access too (the base schema grants only the
-- owner), plus editor writes.
drop policy if exists "read shared documents" on public.documents;
create policy "read shared documents" on public.documents
  for select using (public.can_read_workspace(user_id));
drop policy if exists "write shared documents" on public.documents;
create policy "write shared documents" on public.documents
  for insert with check (public.can_write_workspace(user_id));
drop policy if exists "update shared documents" on public.documents;
create policy "update shared documents" on public.documents
  for update using (public.can_write_workspace(user_id)) with check (public.can_write_workspace(user_id));
drop policy if exists "delete shared documents" on public.documents;
create policy "delete shared documents" on public.documents
  for delete using (public.can_write_workspace(user_id));

-- Receipt / document files live under <owner_uid>/<name>. Let members read and
-- editors write files in workspaces they can access (owners already can, via
-- the per-uid policies in schema.sql).
drop policy if exists "receipts read shared" on storage.objects;
create policy "receipts read shared" on storage.objects
  for select using (
    bucket_id = 'receipts'
    and public.can_read_workspace(nullif((storage.foldername(name))[1], '')::uuid)
  );
drop policy if exists "receipts write shared" on storage.objects;
create policy "receipts write shared" on storage.objects
  for insert with check (
    bucket_id = 'receipts'
    and public.can_write_workspace(nullif((storage.foldername(name))[1], '')::uuid)
  );
