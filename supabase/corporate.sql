-- ════════════════════════════════════════════════════════════════
--  Offset — the corporate layer (entities, control, ledgers)
--
--  Run this AFTER schema.sql. It is ADDITIVE: it creates its own tables and
--  adds nullable columns to expenses/income. A personal install that never
--  creates an entity is unaffected — every added column stays null and every
--  policy below is scoped to entity membership, of which there is none.
--
--  Safe to re-run.
--
--  ⚠️ This touches row-level security. Test on a branch first if you can.
-- ════════════════════════════════════════════════════════════════

-- ── Entities ─────────────────────────────────────────────────────
-- The thing that files its own return: its own books, its own GSTIN, its own
-- financial-year start (April here; a foreign subsidiary may differ).
create table if not exists public.entities (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  registration    text,
  gstin           text,
  currency        text not null default 'INR',
  fy_start_month  smallint not null default 4 check (fy_start_month between 1 and 12),
  -- Archived, never deleted: deleting an entity orphans its books.
  archived_at     timestamptz,
  created_by      uuid not null references auth.users(id) on delete restrict default auth.uid(),
  created_at      timestamptz not null default now()
);

-- ── Departments / cost centres ───────────────────────────────────
create table if not exists public.departments (
  id              uuid primary key default gen_random_uuid(),
  entity_id       uuid not null references public.entities(id) on delete cascade,
  name            text not null,
  code            text,
  budget_monthly  numeric(14,2) not null default 0,
  -- on delete restrict, not cascade: removing a parent must not silently take
  -- its children and their budgets with it.
  parent_id       uuid references public.departments(id) on delete restrict,
  created_at      timestamptz not null default now()
);
create index if not exists departments_entity_idx on public.departments (entity_id);

-- ── Members and roles ────────────────────────────────────────────
create table if not exists public.entity_members (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references public.entities(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  -- Denormalised so the members list renders without reading auth.users.
  email         text,
  role          text not null default 'member'
                check (role in ('owner', 'finance', 'member', 'auditor')),
  department_id uuid references public.departments(id) on delete set null,
  created_at    timestamptz not null default now(),
  -- One row per person per entity; two roles for one person is a contradiction
  -- rather than a generalisation.
  unique (entity_id, user_id)
);
create index if not exists entity_members_entity_idx on public.entity_members (entity_id);
create index if not exists entity_members_user_idx on public.entity_members (user_id);

-- ── Approval policy ──────────────────────────────────────────────
-- One per entity: "anything over ₹X needs sign-off, and these categories always
-- do". A threshold of zero means everything does, which is strict but a
-- legitimate thing to ask for.
create table if not exists public.approval_policies (
  entity_id         uuid primary key references public.entities(id) on delete cascade,
  enabled           boolean not null default false,
  threshold         numeric(14,2) not null default 0,
  always_categories text[] not null default '{}',
  updated_at        timestamptz not null default now()
);

-- ── Audit ────────────────────────────────────────────────────────
-- Append-only by policy below: an audit trail that can be edited is not one.
create table if not exists public.audit_events (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid references public.entities(id) on delete cascade,
  actor_id    uuid references auth.users(id) on delete set null,
  actor_email text,
  action      text not null,
  target_id   text,
  summary     text,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_events_entity_idx on public.audit_events (entity_id, created_at desc);

-- ── The four operational ledgers ─────────────────────────────────
create table if not exists public.inventory_items (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references public.entities(id) on delete cascade,
  name          text not null,
  sku           text,
  unit          text,
  opening_qty   numeric(16,4) not null default 0,
  opening_value numeric(16,2) not null default 0,
  created_at    timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid not null references public.entities(id) on delete cascade,
  item_id    uuid not null references public.inventory_items(id) on delete cascade,
  kind       text not null check (kind in ('receipt', 'issue')),
  date       date not null,
  qty        numeric(16,4) not null,
  -- Null on an issue: an issue consumes at the running weighted average and
  -- does not carry a value of its own.
  value      numeric(16,2),
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists inventory_movements_item_idx on public.inventory_movements (item_id, date);

-- An advance is an asset until it is used up. Booking it as a cost
-- double-counts it when the invoice lands.
create table if not exists public.advances (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid not null references public.entities(id) on delete cascade,
  party      text not null,
  party_kind text not null default 'vendor' check (party_kind in ('vendor', 'employee', 'customer')),
  date       date not null,
  amount     numeric(14,2) not null check (amount > 0),
  note       text,
  created_at timestamptz not null default now()
);

create table if not exists public.advance_adjustments (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid not null references public.entities(id) on delete cascade,
  advance_id  uuid not null references public.advances(id) on delete cascade,
  date        date not null,
  amount      numeric(14,2) not null check (amount > 0),
  against     text,
  created_at  timestamptz not null default now()
);
create index if not exists advance_adjustments_advance_idx on public.advance_adjustments (advance_id);

create table if not exists public.employees (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references public.entities(id) on delete cascade,
  name          text not null,
  code          text,
  department_id uuid references public.departments(id) on delete set null,
  basic         numeric(14,2) not null default 0,
  hra           numeric(14,2) not null default 0,
  allowances    numeric(14,2) not null default 0,
  pf_on_actual  boolean not null default false,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ── Entries gain an entity, a cost centre and an approval ────────
-- Nullable throughout: a personal install has no entity and these stay null,
-- which is what keeps this file additive.
alter table public.expenses add column if not exists entity_id       uuid references public.entities(id) on delete set null;
alter table public.expenses add column if not exists department_id   uuid references public.departments(id) on delete set null;
alter table public.expenses add column if not exists created_by      uuid references auth.users(id) on delete set null default auth.uid();
alter table public.expenses add column if not exists approval_status text not null default 'none';
alter table public.expenses add column if not exists approved_by     uuid references auth.users(id) on delete set null;
alter table public.expenses add column if not exists approved_at     timestamptz;

alter table public.income   add column if not exists entity_id       uuid references public.entities(id) on delete set null;
alter table public.income   add column if not exists department_id   uuid references public.departments(id) on delete set null;
alter table public.income   add column if not exists created_by      uuid references auth.users(id) on delete set null default auth.uid();
alter table public.income   add column if not exists approval_status text not null default 'none';
alter table public.income   add column if not exists approved_by     uuid references auth.users(id) on delete set null;
alter table public.income   add column if not exists approved_at     timestamptz;

-- add column if not exists carries its check only when it creates the column,
-- so the constraint is added separately and idempotently.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_approval_status_check') then
    alter table public.expenses add constraint expenses_approval_status_check
      check (approval_status in ('none', 'pending', 'approved', 'rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'income_approval_status_check') then
    alter table public.income add constraint income_approval_status_check
      check (approval_status in ('none', 'pending', 'approved', 'rejected'));
  end if;
end $$;

create index if not exists expenses_entity_idx on public.expenses (entity_id);
create index if not exists income_entity_idx   on public.income (entity_id);

-- ════════════════════════════════════════════════════════════════
--  Who may do what
-- ════════════════════════════════════════════════════════════════

-- SECURITY DEFINER so a policy on entity_members can ask about entity_members
-- without re-entering its own policy and recursing.
create or replace function public.entity_role(entity uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.entity_members
  where entity_id = entity and user_id = auth.uid()
  limit 1
$$;

-- Whether an entity has anybody in it yet, asked with definer rights.
--
-- This cannot be an inline subquery on entity_members. Row-level security
-- applies inside a policy's own subqueries, so a stranger — who by definition
-- sees none of that entity's members — reads it as empty and satisfies a
-- "nobody is here yet" test for every entity in the database. That is how the
-- founder exception turns into a way to walk into somebody else's company as
-- its owner, which is exactly what happened before this existed.
create or replace function public.entity_has_members(entity uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.entity_members where entity_id = entity)
$$;

create or replace function public.is_entity_member(entity uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.entity_members
    where entity_id = entity and user_id = auth.uid()
  )
$$;

-- The same matrix as PERMISSIONS in src/lib/corporate.js, and deliberately
-- written out per role rather than derived: two systems have to agree on it,
-- and a clever encoding here would make the disagreement harder to spot.
create or replace function public.can_in_entity(entity uuid, permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case public.entity_role(entity)
    when 'owner' then permission = any (array[
      'view','export','entry.create','entry.edit.own','entry.edit.any','entry.delete',
      'asset.manage','budget.manage','department.manage','approve','member.manage',
      'entity.manage','audit.view'])
    when 'finance' then permission = any (array[
      'view','export','entry.create','entry.edit.own','entry.edit.any','entry.delete',
      'asset.manage','budget.manage','department.manage','approve','audit.view'])
    when 'member' then permission = any (array[
      'view','export','entry.create','entry.edit.own'])
    when 'auditor' then permission = any (array[
      'view','export','audit.view'])
    else false
  end
$$;

-- ════════════════════════════════════════════════════════════════
--  Invariants the UI must not be the only thing enforcing
-- ════════════════════════════════════════════════════════════════

-- An entity always keeps at least one owner, so it can never be locked out.
create or replace function public.entity_keeps_an_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owners_left integer;
begin
  -- Only the loss of an owner can break this, so nothing else pays for it.
  if tg_op = 'UPDATE' and old.role = 'owner' and new.role = 'owner' then
    return new;
  end if;
  if old.role <> 'owner' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  -- The entity is being deleted and these rows are going with it. Postgres
  -- deletes the parent before cascading to the children, so an absent entity
  -- here means the whole thing is on its way out and there is no entity left to
  -- protect. Without this, a cascade would fail on its own last owner and the
  -- entity could not be removed at all — including by the service role.
  if not exists (select 1 from public.entities where id = old.entity_id) then
    return old;
  end if;

  select count(*) into owners_left
  from public.entity_members
  where entity_id = old.entity_id and role = 'owner' and id <> old.id;

  if owners_left = 0 then
    raise exception 'An entity must keep at least one owner.'
      using errcode = 'check_violation';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end $$;

drop trigger if exists entity_keeps_an_owner on public.entity_members;
create trigger entity_keeps_an_owner
  before update or delete on public.entity_members
  for each row execute function public.entity_keeps_an_owner();

-- Nobody approves their own entry, however senior. That is the entire point of
-- an approval, so it lives here rather than in a form.
create or replace function public.no_self_approval()
returns trigger
language plpgsql
as $$
begin
  if new.approval_status = 'approved'
     and coalesce(old.approval_status, 'none') is distinct from 'approved'
     and new.approved_by is not null
     and new.approved_by = new.created_by then
    raise exception 'Nobody may approve their own entry.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists expenses_no_self_approval on public.expenses;
create trigger expenses_no_self_approval
  before update on public.expenses
  for each row execute function public.no_self_approval();

drop trigger if exists income_no_self_approval on public.income;
create trigger income_no_self_approval
  before update on public.income
  for each row execute function public.no_self_approval();

-- ════════════════════════════════════════════════════════════════
--  Row-level security
-- ════════════════════════════════════════════════════════════════

alter table public.entities            enable row level security;
alter table public.entity_members      enable row level security;
alter table public.departments         enable row level security;
alter table public.approval_policies   enable row level security;
alter table public.audit_events        enable row level security;
alter table public.inventory_items     enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.advances            enable row level security;
alter table public.advance_adjustments enable row level security;
alter table public.employees           enable row level security;

-- Entities: members see it, owners change it. Creation is separate because at
-- the moment of insert there is no membership yet to be a member of.
drop policy if exists "members see their entities" on public.entities;
create policy "members see their entities" on public.entities
  for select using (public.is_entity_member(id));

drop policy if exists "anyone may found an entity" on public.entities;
create policy "anyone may found an entity" on public.entities
  for insert with check (created_by = auth.uid());

drop policy if exists "owners change the entity" on public.entities;
create policy "owners change the entity" on public.entities
  for update using (public.can_in_entity(id, 'entity.manage'))
  with check (public.can_in_entity(id, 'entity.manage'));

-- No delete policy at all, which is the point: an entity is archived, never
-- deleted, because deleting it orphans its books.

-- Members: everyone in an entity can see who else is, owners manage them. The
-- founder's own first row is the exception — there is no owner yet to grant it.
drop policy if exists "members see each other" on public.entity_members;
create policy "members see each other" on public.entity_members
  for select using (public.is_entity_member(entity_id));

drop policy if exists "owners add members" on public.entity_members;
create policy "owners add members" on public.entity_members
  for insert with check (
    public.can_in_entity(entity_id, 'member.manage')
    or (
      user_id = auth.uid()
      and role = 'owner'
      and not public.entity_has_members(entity_id)
    )
  );

drop policy if exists "owners change members" on public.entity_members;
create policy "owners change members" on public.entity_members
  for update using (public.can_in_entity(entity_id, 'member.manage'))
  with check (public.can_in_entity(entity_id, 'member.manage'));

drop policy if exists "owners remove members" on public.entity_members;
create policy "owners remove members" on public.entity_members
  for delete using (public.can_in_entity(entity_id, 'member.manage'));

-- Departments, budgets and the approval policy: finance and owners.
drop policy if exists "members see departments" on public.departments;
create policy "members see departments" on public.departments
  for select using (public.is_entity_member(entity_id));

drop policy if exists "finance manages departments" on public.departments;
create policy "finance manages departments" on public.departments
  for all using (public.can_in_entity(entity_id, 'department.manage'))
  with check (public.can_in_entity(entity_id, 'department.manage'));

drop policy if exists "members see the policy" on public.approval_policies;
create policy "members see the policy" on public.approval_policies
  for select using (public.is_entity_member(entity_id));

drop policy if exists "approvers set the policy" on public.approval_policies;
create policy "approvers set the policy" on public.approval_policies
  for all using (public.can_in_entity(entity_id, 'approve'))
  with check (public.can_in_entity(entity_id, 'approve'));

-- Audit: readable by those allowed to audit, written by anyone acting in the
-- entity, and never updated or deleted by anyone. A log that can be rewritten
-- is not a log, so there is deliberately no update or delete policy.
drop policy if exists "auditors read the log" on public.audit_events;
create policy "auditors read the log" on public.audit_events
  for select using (public.can_in_entity(entity_id, 'audit.view'));

drop policy if exists "members append to the log" on public.audit_events;
create policy "members append to the log" on public.audit_events
  for insert with check (public.is_entity_member(entity_id) and actor_id = auth.uid());

-- The ledgers. Everyone in the entity reads; finance and owners write.
do $$
declare t text;
begin
  foreach t in array array['inventory_items','inventory_movements','advances','advance_adjustments','employees']
  loop
    execute format('drop policy if exists "members read %1$s" on public.%1$I', t);
    execute format(
      'create policy "members read %1$s" on public.%1$I for select using (public.is_entity_member(entity_id))', t);
    execute format('drop policy if exists "finance writes %1$s" on public.%1$I', t);
    execute format(
      'create policy "finance writes %1$s" on public.%1$I for all '
      'using (public.can_in_entity(entity_id, ''budget.manage'')) '
      'with check (public.can_in_entity(entity_id, ''budget.manage''))', t);
  end loop;
end $$;

-- ── Entries inside an entity ─────────────────────────────────────
-- schema.sql already restricts expenses/income to their owner. These add the
-- entity case alongside it: a row tagged to an entity is visible to that
-- entity's members, and writable according to their role.
drop policy if exists "entity members see entity expenses" on public.expenses;
create policy "entity members see entity expenses" on public.expenses
  for select using (entity_id is not null and public.is_entity_member(entity_id));

drop policy if exists "entity members log expenses" on public.expenses;
create policy "entity members log expenses" on public.expenses
  for insert with check (entity_id is not null and public.can_in_entity(entity_id, 'entry.create'));

-- An approved entry is a record, not a draft, so only someone who may edit
-- anyone's entry may touch it once approved.
drop policy if exists "entity members edit entity expenses" on public.expenses;
create policy "entity members edit entity expenses" on public.expenses
  for update using (
    entity_id is not null and (
      public.can_in_entity(entity_id, 'entry.edit.any')
      or (approval_status <> 'approved'
          and public.can_in_entity(entity_id, 'entry.edit.own')
          and created_by = auth.uid())
    )
  );

-- Permissive policies OR together, and schema.sql already grants a user full
-- control of any row carrying their user_id. Those two facts combine badly: the
-- author of an entity entry satisfies "own expenses" and so could edit it after
-- approval, or log one against an entity they do not belong to, whatever the
-- policies above say. A RESTRICTIVE policy is ANDed with the permissive set
-- instead of joining it, which is the only way to bind a rule that already
-- exists. Rows with no entity are untouched, so a personal install is unchanged.
drop policy if exists "entity rules bind entity expenses" on public.expenses;
create policy "entity rules bind entity expenses" on public.expenses
  as restrictive for update using (
    entity_id is null
    or public.can_in_entity(entity_id, 'entry.edit.any')
    or (approval_status <> 'approved'
        and public.can_in_entity(entity_id, 'entry.edit.own')
        and created_by = auth.uid())
  );

drop policy if exists "entity membership binds new expenses" on public.expenses;
create policy "entity membership binds new expenses" on public.expenses
  as restrictive for insert with check (
    entity_id is null or public.can_in_entity(entity_id, 'entry.create')
  );

drop policy if exists "entity rules bind deleting expenses" on public.expenses;
create policy "entity rules bind deleting expenses" on public.expenses
  as restrictive for delete using (
    entity_id is null or public.can_in_entity(entity_id, 'entry.delete')
  );

drop policy if exists "entity rules bind entity income" on public.income;
create policy "entity rules bind entity income" on public.income
  as restrictive for update using (
    entity_id is null
    or public.can_in_entity(entity_id, 'entry.edit.any')
    or (approval_status <> 'approved'
        and public.can_in_entity(entity_id, 'entry.edit.own')
        and created_by = auth.uid())
  );

drop policy if exists "entity membership binds new income" on public.income;
create policy "entity membership binds new income" on public.income
  as restrictive for insert with check (
    entity_id is null or public.can_in_entity(entity_id, 'entry.create')
  );

drop policy if exists "entity rules bind deleting income" on public.income;
create policy "entity rules bind deleting income" on public.income
  as restrictive for delete using (
    entity_id is null or public.can_in_entity(entity_id, 'entry.delete')
  );

drop policy if exists "entity members see entity income" on public.income;
create policy "entity members see entity income" on public.income
  for select using (entity_id is not null and public.is_entity_member(entity_id));

drop policy if exists "entity members log income" on public.income;
create policy "entity members log income" on public.income
  for insert with check (entity_id is not null and public.can_in_entity(entity_id, 'entry.create'));

drop policy if exists "entity members edit entity income" on public.income;
create policy "entity members edit entity income" on public.income
  for update using (
    entity_id is not null and (
      public.can_in_entity(entity_id, 'entry.edit.any')
      or (approval_status <> 'approved'
          and public.can_in_entity(entity_id, 'entry.edit.own')
          and created_by = auth.uid())
    )
  );
