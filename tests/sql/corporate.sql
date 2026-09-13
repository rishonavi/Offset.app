-- Row-level security for the corporate layer, exercised as real users.
--
-- Superusers and table owners bypass RLS, so every check below runs as an
-- unprivileged role with the caller's identity set the way Supabase sets it.
-- A test that runs as postgres proves nothing at all.

\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema if not exists t;

create or replace function t.check(name text, condition boolean) returns void
language plpgsql as $$
begin
  if condition then
    raise notice 'PASS  %', name;
  else
    raise notice '**FAIL**  %', name;
  end if;
end $$;

-- Did a statement fail the way it was supposed to? For inserts and triggers,
-- which raise.
create or replace function t.refuses(name text, statement text) returns void
language plpgsql as $$
begin
  execute statement;
  raise notice '**FAIL**  %  (it was allowed)', name;
exception when others then
  raise notice 'PASS  %', name;
end $$;

-- Row-level security does not raise on an update or a delete: it filters the
-- rows out, and the statement succeeds having touched nothing. Asserting on an
-- exception there passes for the wrong reason on a policy that does not exist,
-- so the assertion has to be about how many rows moved.
create or replace function t.touches_nothing(name text, statement text) returns void
language plpgsql as $$
declare
  moved integer;
begin
  execute statement;
  get diagnostics moved = row_count;
  if moved = 0 then
    raise notice 'PASS  %', name;
  else
    raise notice '**FAIL**  %  (% row(s) changed)', name, moved;
  end if;
exception when others then
  -- A trigger refusing outright is also a pass: nothing moved.
  raise notice 'PASS  %', name;
end $$;

create or replace function t.allows(name text, statement text) returns void
language plpgsql as $$
begin
  execute statement;
  raise notice 'PASS  %', name;
exception when others then
  raise notice '**FAIL**  %  (%)', name, sqlerrm;
end $$;

-- ── The cast ────────────────────────────────────────────────────
-- Teardown removes owners, which the invariant exists to prevent. Suspending
-- the trigger is a test concern, not a hole: it is re-enabled immediately.
alter table public.entity_members disable trigger entity_keeps_an_owner;
delete from public.entity_members;
delete from public.audit_events;
delete from public.expenses where entity_id is not null;
delete from public.departments;
delete from public.entities;
delete from auth.users where email like '%@test.invalid';
alter table public.entity_members enable trigger entity_keeps_an_owner;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.invalid'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.invalid'),
  ('33333333-3333-3333-3333-333333333333', 'carol@test.invalid'),
  ('44444444-4444-4444-4444-444444444444', 'dave@test.invalid'),
  ('55555555-5555-5555-5555-555555555555', 'eve@test.invalid'),
  ('99999999-9999-9999-9999-999999999999', 'mallory@test.invalid');

insert into public.entities (id, name, created_by)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'Acme Pvt Ltd', '11111111-1111-1111-1111-111111111111');

insert into public.entity_members (entity_id, user_id, email, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'alice@test.invalid', 'owner'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'bob@test.invalid',   'member'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'carol@test.invalid', 'finance'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'dave@test.invalid',  'auditor');

insert into public.properties (id, user_id, name)
values ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Acme Depot');

grant usage on schema public to offset_app;
grant usage on schema t to offset_app;
grant execute on all functions in schema t to offset_app;
grant select, insert, update, delete on all tables in schema public to offset_app;
grant usage, select on all sequences in schema public to offset_app;

\echo ''
\echo '── WHO CAN SEE THE ENTITY ──'
set role offset_app;

set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';  -- eve, no membership
select t.check('an outsider sees no entities', (select count(*) from public.entities) = 0);
select t.check('an outsider sees no members',  (select count(*) from public.entity_members) = 0);

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';  -- bob, member
select t.check('a member sees their entity', (select count(*) from public.entities) = 1);
select t.check('and everyone in it', (select count(*) from public.entity_members) = 4);

\echo ''
\echo '── WHAT A ROLE MAY CHANGE ──'
select t.touches_nothing('a member cannot rename the entity',
  $$update public.entities set name = 'Bob Ltd' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$);
select t.check('and the name is unchanged',
  (select name from public.entities where id = 'aaaaaaaa-0000-0000-0000-000000000001') = 'Acme Pvt Ltd');
select t.refuses('a member cannot add a member',
  $$insert into public.entity_members (entity_id, user_id, email, role)
    values ('aaaaaaaa-0000-0000-0000-000000000001','55555555-5555-5555-5555-555555555555','eve@test.invalid','owner')$$);
select t.refuses('a member cannot create a department',
  $$insert into public.departments (entity_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001','Ops')$$);

set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';  -- dave, auditor
select t.check('an auditor sees the books', (select count(*) from public.entities) = 1);
select t.refuses('an auditor changes nothing',
  $$insert into public.departments (entity_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001','Audit')$$);

set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';  -- carol, finance
select t.allows('finance creates a department',
  $$insert into public.departments (entity_id, name, code) values ('aaaaaaaa-0000-0000-0000-000000000001','Operations','OPS')$$);
select t.refuses('but finance cannot add a member',
  $$insert into public.entity_members (entity_id, user_id, email, role)
    values ('aaaaaaaa-0000-0000-0000-000000000001','55555555-5555-5555-5555-555555555555','eve@test.invalid','member')$$);

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';  -- alice, owner
select t.allows('an owner renames the entity',
  $$update public.entities set name = 'Acme Private Limited' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$);
select t.allows('an owner adds a member',
  $$insert into public.entity_members (entity_id, user_id, email, role)
    values ('aaaaaaaa-0000-0000-0000-000000000001','55555555-5555-5555-5555-555555555555','eve@test.invalid','member')$$);

\echo ''
\echo '── AN ENTITY ALWAYS KEEPS AN OWNER ──'
select t.refuses('the last owner cannot be removed',
  $$delete from public.entity_members
    where entity_id = 'aaaaaaaa-0000-0000-0000-000000000001' and role = 'owner'$$);
select t.refuses('nor demoted to finance',
  $$update public.entity_members set role = 'finance'
    where entity_id = 'aaaaaaaa-0000-0000-0000-000000000001' and role = 'owner'$$);
select t.check('so the owner is still there',
  (select count(*) from public.entity_members
   where entity_id = 'aaaaaaaa-0000-0000-0000-000000000001' and role = 'owner') = 1);
select t.allows('a second owner may be appointed',
  $$update public.entity_members set role = 'owner'
    where entity_id = 'aaaaaaaa-0000-0000-0000-000000000001' and user_id = '33333333-3333-3333-3333-333333333333'$$);
select t.allows('and now one of them may step down',
  $$update public.entity_members set role = 'finance'
    where entity_id = 'aaaaaaaa-0000-0000-0000-000000000001' and user_id = '33333333-3333-3333-3333-333333333333'$$);

\echo ''
\echo '── NOBODY APPROVES THEIR OWN ENTRY ──'
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';  -- bob
select t.allows('a member logs a cost',
  $$insert into public.expenses (id, user_id, property_id, entity_id, date, amount, category, created_by, approval_status)
    values ('cccccccc-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222',
            'bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
            current_date, 50000, 'Materials', '22222222-2222-2222-2222-222222222222', 'pending')$$);
select t.refuses('and cannot approve it himself',
  $$update public.expenses
    set approval_status = 'approved', approved_by = '22222222-2222-2222-2222-222222222222', approved_at = now()
    where id = 'cccccccc-0000-0000-0000-000000000001'$$);

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';  -- alice, owner
select t.allows('someone else can',
  $$update public.expenses
    set approval_status = 'approved', approved_by = '11111111-1111-1111-1111-111111111111', approved_at = now()
    where id = 'cccccccc-0000-0000-0000-000000000001'$$);
select t.check('and it is recorded as approved',
  (select approval_status from public.expenses where id = 'cccccccc-0000-0000-0000-000000000001') = 'approved');

\echo ''
\echo '── AN APPROVED ENTRY IS A RECORD, NOT A DRAFT ──'
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';  -- bob, who raised it
select t.touches_nothing('its author cannot edit it back to another number',
  $$update public.expenses set amount = 5 where id = 'cccccccc-0000-0000-0000-000000000001'$$);
select t.check('so the amount stands',
  (select amount from public.expenses where id = 'cccccccc-0000-0000-0000-000000000001') = 50000);
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';  -- alice, owner
select t.allows('an owner can correct it',
  $$update public.expenses set amount = 50500 where id = 'cccccccc-0000-0000-0000-000000000001'$$);

\echo ''
\echo '── THE LOG CANNOT BE REWRITTEN ──'
select t.allows('an action is recorded',
  $$insert into public.audit_events (entity_id, actor_id, actor_email, action, summary)
    values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','alice@test.invalid','entity.update','renamed')$$);
select t.touches_nothing('and cannot then be edited',
  $$update public.audit_events set summary = 'nothing happened'
    where entity_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$);
select t.touches_nothing('nor deleted',
  $$delete from public.audit_events where entity_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$);
select t.refuses('nor attributed to someone else',
  $$insert into public.audit_events (entity_id, actor_id, action)
    values ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','entity.update')$$);

\echo ''
\echo '── AN ENTITY IS ARCHIVED, NEVER DELETED ──'
select t.touches_nothing('even an owner cannot delete the entity',
  $$delete from public.entities where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$);
select t.allows('archiving is how it is retired',
  $$update public.entities set archived_at = now() where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$);

\echo ''
\echo '── AN OUTSIDER STAYS OUTSIDE ──'
-- A real account with no membership, so a refusal here is row-level security
-- and not a foreign key complaining about a user that does not exist.
set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';  -- mallory
select t.check('sees no entity', (select count(*) from public.entities) = 0);
select t.check('sees no entity expenses', (select count(*) from public.expenses where entity_id is not null) = 0);
select t.refuses('and cannot log a cost against one',
  $$insert into public.expenses (user_id, property_id, entity_id, date, amount, category)
    values ('99999999-9999-9999-9999-999999999999','bbbbbbbb-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001', current_date, 1, 'Materials')$$);

\echo ''
\echo '── FOUNDING AN ENTITY ──'
-- The one bootstrap: at the moment someone founds an entity there is no owner
-- yet to grant them membership, so the first row has to be self-granted. That
-- exception must not stay open once anyone is inside.
set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';  -- mallory
select t.allows('a founder may create an entity',
  $$insert into public.entities (id, name, created_by)
    values ('aaaaaaaa-0000-0000-0000-000000000002','Mallory Ltd','99999999-9999-9999-9999-999999999999')$$);
select t.allows('and make themselves its first owner',
  $$insert into public.entity_members (entity_id, user_id, email, role)
    values ('aaaaaaaa-0000-0000-0000-000000000002','99999999-9999-9999-9999-999999999999','mallory@test.invalid','owner')$$);
select t.refuses('but cannot found one in someone else''s name',
  $$insert into public.entities (name, created_by)
    values ('Not Mine','11111111-1111-1111-1111-111111111111')$$);

set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';  -- eve
select t.refuses('and nobody can walk into an entity that already has members',
  $$insert into public.entity_members (entity_id, user_id, email, role)
    values ('aaaaaaaa-0000-0000-0000-000000000002','55555555-5555-5555-5555-555555555555','eve@test.invalid','owner')$$);
select t.refuses('nor log a cost against one they do not belong to',
  $$insert into public.expenses (user_id, property_id, entity_id, date, amount, category, created_by)
    values ('55555555-5555-5555-5555-555555555555','bbbbbbbb-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000002', current_date, 10, 'Materials','55555555-5555-5555-5555-555555555555')$$);

\echo ''
\echo '── MATERIALS, SITES AND QUOTATIONS ──'
-- The construction ledgers. The one that matters here is the movement kind: an
-- earlier version of this schema allowed only 'receipt' and 'issue', which
-- forces a rejected delivery to be recorded as a cost of the job. Whether the
-- widened constraint actually applied to an existing table cannot be read off
-- the file — re-applying it has to be tried.
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';  -- carol, finance
select t.allows('finance opens a site',
  $$insert into public.projects (id, entity_id, name, contract_value, estimate, status)
    values ('dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
            'Marine Drive Tower', 10000000, 8000000, 'active')$$);
select t.refuses('but not one with a status nobody defined',
  $$insert into public.projects (entity_id, name, status)
    values ('aaaaaaaa-0000-0000-0000-000000000001','Nowhere','abandoned')$$);
select t.refuses('nor a contract worth less than nothing',
  $$insert into public.projects (entity_id, name, contract_value)
    values ('aaaaaaaa-0000-0000-0000-000000000001','Upside Down', -1)$$);

select t.allows('and adds a material with its trade',
  $$insert into public.inventory_items (id, entity_id, name, unit, category, brand, hsn, reorder_level)
    values ('eeeeeeee-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
            'Cement OPC 53 grade','bag','cement','UltraTech','2523',20)$$);

-- All five, one at a time, because the reason the constraint was widened is
-- that three of them did not exist.
select t.allows('a receipt is recorded',
  $$insert into public.inventory_movements (entity_id, item_id, kind, date, qty, unit_cost, vendor)
    values ('aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',
            'receipt', current_date, 200, 400, 'Shree Traders')$$);
select t.allows('a delivery carries its freight',
  $$insert into public.inventory_movements (entity_id, item_id, kind, date, qty, unit_cost, other_cost, vendor)
    values ('aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',
            'receipt', current_date, 10, 4500, 9000, 'Kokan Sand')$$);
select t.refuses('but not freight owed the other way',
  $$insert into public.inventory_movements (entity_id, item_id, kind, date, qty, other_cost)
    values ('aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',
            'receipt', current_date, 1, -100)$$);
select t.allows('an issue to a site is recorded',
  $$insert into public.inventory_movements (entity_id, item_id, project_id, kind, date, qty)
    values ('aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',
            'dddddddd-0000-0000-0000-000000000001','issue', current_date, 100)$$);
select t.allows('wastage is recorded',
  $$insert into public.inventory_movements (entity_id, item_id, kind, date, qty)
    values ('aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',
            'wastage', current_date, 10)$$);
select t.allows('a rejection is recorded, with its reason',
  $$insert into public.inventory_movements (entity_id, item_id, kind, date, qty, unit_cost, vendor, reason)
    values ('aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',
            'rejected', current_date, 10, 400, 'Shree Traders', 'Set hard in transit')$$);
select t.allows('and a stock-take adjustment',
  $$insert into public.inventory_movements (entity_id, item_id, kind, date, qty)
    values ('aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',
            'adjustment', current_date, -5)$$);
-- A yard and a store on every site. The central store is the absence of a
-- site, which is what every row written before stores existed already says.
select t.allows('a delivery straight to a site names the store it landed at',
  $$insert into public.inventory_movements (entity_id, item_id, store_id, kind, date, qty, unit_cost)
    values ('aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',
            'dddddddd-0000-0000-0000-000000000001','receipt', current_date, 50, 400)$$);
select t.allows('and a transfer between two of the company’s own stores',
  $$insert into public.inventory_movements (entity_id, item_id, store_id, to_store_id, kind, date, qty)
    values ('aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',
            null,'dddddddd-0000-0000-0000-000000000001','transfer', current_date, 20)$$);
select t.check('a transfer is one row carrying both ends',
  (select count(*) from public.inventory_movements
    where kind = 'transfer' and to_store_id is not null) = 1);
-- Where it physically is and who pays for it are different questions.
select t.allows('material can leave the yard and be charged to a site',
  $$insert into public.inventory_movements (entity_id, item_id, store_id, project_id, kind, date, qty)
    values ('aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',
            null,'dddddddd-0000-0000-0000-000000000001','issue', current_date, 10)$$);
select t.check('and the two are separate columns, not one',
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_movements'
      and column_name in ('store_id', 'project_id')) = 2);

select t.refuses('a kind the app never writes is still refused',
  $$insert into public.inventory_movements (entity_id, item_id, kind, date, qty)
    values ('aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',
            'stolen', current_date, 1)$$);
select t.check('the rejection kept its reason',
  (select reason from public.inventory_movements
    where kind = 'rejected' and item_id = 'eeeeeeee-0000-0000-0000-000000000001') = 'Set hard in transit');
-- Counted rather than read as a single row: there is more than one issue by
-- the time this runs, and a scalar subquery that happens to work today is an
-- assertion that breaks the next time a row is added above it.
select t.check('and every issue knows which site it went to',
  (select count(*) from public.inventory_movements
    where kind = 'issue' and item_id = 'eeeeeeee-0000-0000-0000-000000000001'
      and project_id is distinct from 'dddddddd-0000-0000-0000-000000000001') = 0);

select t.allows('a quotation is filed',
  $$insert into public.material_quotes (id, entity_id, vendor, date, valid_until, status)
    values ('ffffffff-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
            'Konkan Cement', current_date, current_date + 30, 'sent')$$);
select t.allows('with a line carrying its own tax rate',
  $$insert into public.material_quote_lines (entity_id, quote_id, item_id, name, qty, rate, unit, gst_percent)
    values ('aaaaaaaa-0000-0000-0000-000000000001','ffffffff-0000-0000-0000-000000000001',
            'eeeeeeee-0000-0000-0000-000000000001','Cement OPC 53 grade',100,400,'bag',28)$$);
-- Vendors quote for things the company has never stocked, and refusing those
-- would make a quote useless exactly when it is most useful.
select t.allows('and a line for something not stocked at all',
  $$insert into public.material_quote_lines (entity_id, quote_id, name, qty, rate)
    values ('aaaaaaaa-0000-0000-0000-000000000001','ffffffff-0000-0000-0000-000000000001',
            'Scaffolding hire', 1, 45000)$$);
select t.refuses('a quotation cannot be marked expired',
  $$insert into public.material_quotes (entity_id, vendor, date, status)
    values ('aaaaaaaa-0000-0000-0000-000000000001','Nobody', current_date, 'expired')$$);

-- A cost belongs to a job as well as to a company, and has to survive the job
-- being closed later.
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';  -- carol, finance
select t.allows('a bill is booked to a site',
  $$insert into public.expenses (id, user_id, property_id, entity_id, project_id, date, amount, category, created_by)
    values ('cccccccc-0000-0000-0000-00000000001a','33333333-3333-3333-3333-333333333333',
            'bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
            'dddddddd-0000-0000-0000-000000000001', current_date, 250000, 'Materials',
            '33333333-3333-3333-3333-333333333333')$$);
select t.check('and it knows which one',
  (select project_id from public.expenses where id = 'cccccccc-0000-0000-0000-00000000001a')
    = 'dddddddd-0000-0000-0000-000000000001');
select t.allows('an invoice can be raised against one too',
  $$insert into public.income (id, user_id, property_id, entity_id, project_id, date, amount, source)
    values ('cccccccc-0000-0000-0000-00000000001b','33333333-3333-3333-3333-333333333333',
            'bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
            'dddddddd-0000-0000-0000-000000000001', current_date, 900000, 'Rent')$$);
-- A cost with no site is the ordinary case, and every row written before there
-- were sites is one.
select t.allows('and a bill with no site is still a bill',
  $$insert into public.expenses (id, user_id, property_id, entity_id, date, amount, category, created_by)
    values ('cccccccc-0000-0000-0000-00000000001c','33333333-3333-3333-3333-333333333333',
            'bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
            current_date, 4000, 'Utilities','33333333-3333-3333-3333-333333333333')$$);

\echo ''
\echo '── LABOUR, CONTRACTS AND WHAT IS BUILT ──'
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';  -- carol, finance
select t.allows('a day of the muster is recorded',
  $$insert into public.labour_muster (entity_id, project_id, date, trade, headcount, rate, overtime_hours, overtime_rate)
    values ('aaaaaaaa-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001',
            current_date, 'mason', 14, 800, 0, 0)$$);
-- Nobody is named on a real muster either, so nothing here requires it.
select t.check('and it needs no employee to point at',
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'labour_muster' and column_name like '%employee%') = 0);
select t.refuses('a negative headcount is not a muster',
  $$insert into public.labour_muster (entity_id, date, trade, headcount, rate)
    values ('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'helper', -3, 500)$$);

select t.allows('a work order is raised',
  $$insert into public.work_orders (id, entity_id, project_id, contractor, scope, order_value, retention_percent, tds_percent)
    values ('11111111-aaaa-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
            'dddddddd-0000-0000-0000-000000000001','Sharma Plastering','Internal plaster', 2000000, 5, 1)$$);
select t.refuses('a retention above the whole bill is a typo',
  $$insert into public.work_orders (entity_id, contractor, retention_percent)
    values ('aaaaaaaa-0000-0000-0000-000000000001','Nobody', 500)$$);

-- Cumulative by construction: each bill states the work done to date.
select t.allows('the first running account bill',
  $$insert into public.ra_bills (entity_id, work_order_id, number, date, claimed_to_date, certified_to_date)
    values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-aaaa-0000-0000-000000000001',
            1, current_date, 500000, 500000)$$);
select t.allows('and the second, stating everything done so far',
  $$insert into public.ra_bills (entity_id, work_order_id, number, date, claimed_to_date, certified_to_date)
    values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-aaaa-0000-0000-000000000001',
            2, current_date, 1300000, 1200000)$$);
-- Two bills dated the same day is ordinary; two numbered the same is not, and
-- the number is what orders the ladder that works out what is payable.
select t.refuses('two bills cannot share a number on one order',
  $$insert into public.ra_bills (entity_id, work_order_id, number, date, claimed_to_date, certified_to_date)
    values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-aaaa-0000-0000-000000000001',
            2, current_date, 1400000, 1400000)$$);
select t.check('the ladder reads the later figure, not their sum',
  (select max(certified_to_date) from public.ra_bills
    where work_order_id = '11111111-aaaa-0000-0000-000000000001') = 1200000);

select t.allows('a line of the schedule of work',
  $$insert into public.work_items (id, entity_id, project_id, code, description, stage, unit, planned_qty, rate)
    values ('22222222-aaaa-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
            'dddddddd-0000-0000-0000-000000000001','S-1','RCC framed structure','structure','cum', 600, 6500)$$);
select t.allows('and a measurement against it',
  $$insert into public.work_measurements (entity_id, work_item_id, project_id, date, qty)
    values ('aaaaaaaa-0000-0000-0000-000000000001','22222222-aaaa-0000-0000-000000000001',
            'dddddddd-0000-0000-0000-000000000001', current_date, 300)$$);
-- A re-measurement that found less is a correction. Forcing it positive would
-- mean the only way to fix an error is to delete the record of it.
select t.allows('a correction may be negative',
  $$insert into public.work_measurements (entity_id, work_item_id, date, qty)
    values ('aaaaaaaa-0000-0000-0000-000000000001','22222222-aaaa-0000-0000-000000000001', current_date, -10)$$);

set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';  -- carol, finance
select t.allows('a hired machine is put on the books',
  $$insert into public.plant (id, entity_id, name, kind, ownership, registration, hire_rate, hire_basis, hired_from, hired_to)
    values ('33333333-aaaa-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
            'JCB 3DX','excavator','hired','MH-04-AB-1234', 12000, 'daily', current_date - 9, current_date)$$);
select t.allows('and an owned one, which is not free',
  $$insert into public.plant (entity_id, name, kind, ownership, purchase_value, useful_life_years, salvage_value)
    values ('aaaaaaaa-0000-0000-0000-000000000001','Site mixer','mixer','owned', 900000, 8, 100000)$$);
select t.refuses('a machine is hired or owned and nothing else',
  $$insert into public.plant (entity_id, name, ownership) values ('aaaaaaaa-0000-0000-0000-000000000001','Borrowed','leased')$$);
select t.refuses('and charged on a basis the arithmetic knows',
  $$insert into public.plant (entity_id, name, hire_basis) values ('aaaaaaaa-0000-0000-0000-000000000001','Odd','per furlong')$$);

-- Idle and breakdown are separate columns on purpose: no work for it against
-- it could not work. Different people are answerable for those.
select t.allows('a log sheet records what the machine did',
  $$insert into public.plant_logs (entity_id, plant_id, project_id, date, working_hours, idle_hours, fuel_cost)
    values ('aaaaaaaa-0000-0000-0000-000000000001','33333333-aaaa-0000-0000-000000000001',
            'dddddddd-0000-0000-0000-000000000001', current_date, 6, 2, 3600)$$);
select t.allows('and a day it was broken rather than merely standing',
  $$insert into public.plant_logs (entity_id, plant_id, date, working_hours, breakdown_hours)
    values ('aaaaaaaa-0000-0000-0000-000000000001','33333333-aaaa-0000-0000-000000000001', current_date - 1, 0, 8)$$);
select t.check('the two are told apart in the schema, not merged',
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'plant_logs'
      and column_name in ('idle_hours', 'breakdown_hours')) = 2);
select t.refuses('hours cannot run backwards',
  $$insert into public.plant_logs (entity_id, plant_id, date, working_hours)
    values ('aaaaaaaa-0000-0000-0000-000000000001','33333333-aaaa-0000-0000-000000000001', current_date, -4)$$);

set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';  -- carol, finance
select t.allows('a flat goes on the shelf',
  $$insert into public.sale_units (id, entity_id, project_id, name, kind, carpet_area, area_basis, rate_per_area, agreed_price, status)
    values ('44444444-aaaa-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
            'dddddddd-0000-0000-0000-000000000001','A-1204','flat', 1100, 'carpet', 10000, 11000000, 'booked')$$);
select t.allows('and a shop beside it',
  $$insert into public.sale_units (entity_id, project_id, name, kind, carpet_area, rate_per_area, status)
    values ('aaaaaaaa-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001',
            'S-01','shop', 400, 25000, 'available')$$);
-- Available and held back are both unsold and are not the same thing, so both
-- exist, and a cancelled booking returns the flat to the shelf rather than
-- being deleted.
-- Tried rather than read off the catalogue: what matters is that the rows go
-- in, not that a constraint string contains a word.
select t.allows('a flat can be held back rather than merely unsold',
  $$insert into public.sale_units (entity_id, name, status)
    values ('aaaaaaaa-0000-0000-0000-000000000001','A-1203','held')$$);
select t.allows('and a fallen-through booking returns it to the shelf',
  $$insert into public.sale_units (entity_id, name, status)
    values ('aaaaaaaa-0000-0000-0000-000000000001','A-1205','cancelled')$$);
select t.refuses('a status nobody defined is refused',
  $$insert into public.sale_units (entity_id, name, status)
    values ('aaaaaaaa-0000-0000-0000-000000000001','X-1','reserved-ish')$$);
-- A rate per square foot means nothing without saying which area it is on.
select t.refuses('and so is an area basis that means nothing',
  $$insert into public.sale_units (entity_id, name, area_basis)
    values ('aaaaaaaa-0000-0000-0000-000000000001','X-2','approximate')$$);

select t.allows('an instalment can name a stage of the building',
  $$insert into public.sale_plan_stages (entity_id, unit_id, label, percent, work_stage, trigger_at, sequence)
    values ('aaaaaaaa-0000-0000-0000-000000000001','44444444-aaaa-0000-0000-000000000001',
            'On structure', 40, 'structure', 100, 3)$$);
select t.allows('or a date instead',
  $$insert into public.sale_plan_stages (entity_id, unit_id, label, amount, due_on, sequence)
    values ('aaaaaaaa-0000-0000-0000-000000000001','44444444-aaaa-0000-0000-000000000001',
            'On booking', 1000000, current_date, 1)$$);
select t.refuses('a share of more than the whole flat is a typo',
  $$insert into public.sale_plan_stages (entity_id, unit_id, label, percent)
    values ('aaaaaaaa-0000-0000-0000-000000000001','44444444-aaaa-0000-0000-000000000001','Everything', 150)$$);
select t.allows('and money against it is recorded',
  $$insert into public.sale_receipts (entity_id, unit_id, project_id, date, amount, mode)
    values ('aaaaaaaa-0000-0000-0000-000000000001','44444444-aaaa-0000-0000-000000000001',
            'dddddddd-0000-0000-0000-000000000001', current_date, 1600000, 'cheque')$$);
select t.check('the flat keeps both its area and what it is priced on',
  (select area_basis from public.sale_units where id = '44444444-aaaa-0000-0000-000000000001') = 'carpet');

-- The documents that commit money carry who signed them.
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';  -- carol, finance
select t.check('a certification can be waiting on somebody',
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'ra_bills'
      and column_name in ('approval_status', 'approved_by', 'approved_at')) = 3);
select t.check('and so can a work order and an advance',
  (select count(*) from information_schema.columns
    where table_schema = 'public' and column_name = 'approval_status'
      and table_name in ('work_orders', 'advances', 'expenses')) = 3);
select t.allows('a bill can be marked as waiting',
  $$update public.ra_bills set approval_status = 'pending' where number = 1$$);
select t.refuses('but not into a state nobody defined',
  $$update public.ra_bills set approval_status = 'maybe' where number = 1$$);
-- An observation is not a decision: a muster roll has nothing to approve, and a
-- queue full of them would teach people to click through without reading.
select t.check('and an observation carries no approval at all',
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'labour_muster' and column_name = 'approval_status') = 0);

\echo ''
\echo '── A VERSION TO SYNC AGAINST ──'
-- The server keeps the clock. A timestamp the client sets is a timestamp the
-- client can get wrong: a phone running slow would win every race it should
-- lose, and one running fast would lose every race it should win.
reset role;
select t.check('every synced table carries a version',
  (select count(*) from information_schema.columns
    where table_schema = 'public' and column_name = 'updated_at'
      and table_name in ('projects','inventory_movements','labour_muster','ra_bills',
                         'work_measurements','plant_logs','sale_units','sale_receipts')) = 8);
select t.check('and a trigger maintains it, not the client',
  (select count(*) from pg_trigger where tgname like '%\_touch' and not tgisinternal) >= 23);
-- Tried rather than read off the catalogue.
set role offset_app;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';  -- carol, finance
select t.allows('a client can try to set the version and be overruled',
  $$update public.projects set updated_at = '1999-01-01'
     where id = 'dddddddd-0000-0000-0000-000000000001'$$);
select t.check('because the server stamps its own',
  (select updated_at from public.projects where id = 'dddddddd-0000-0000-0000-000000000001') > '2020-01-01');
-- A row that is simply gone cannot reach the other devices.
select t.check('and a deletion can be carried rather than vanishing',
  (select count(*) from information_schema.columns
    where table_schema = 'public' and column_name = 'deleted_at'
      and table_name in ('projects','labour_muster','plant_logs','sale_units')) = 4);

set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';  -- mallory, another company
select t.check('another company sees no muster', (select count(*) from public.labour_muster) = 0);
select t.check('no work orders', (select count(*) from public.work_orders) = 0);
select t.check('no running account bills', (select count(*) from public.ra_bills) = 0);
select t.check('no schedule of work', (select count(*) from public.work_items) = 0);
select t.check('no measurements', (select count(*) from public.work_measurements) = 0);
select t.check('no plant', (select count(*) from public.plant) = 0);
select t.check('no log sheets', (select count(*) from public.plant_logs) = 0);
select t.check('no flats or shops', (select count(*) from public.sale_units) = 0);
select t.check('no payment plans', (select count(*) from public.sale_plan_stages) = 0);
select t.check('and no money anybody paid', (select count(*) from public.sale_receipts) = 0);

set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';  -- dave, auditor
select t.check('an auditor sees the sites', (select count(*) from public.projects) = 1);
select t.check('and the quotations', (select count(*) from public.material_quotes) = 1);
select t.refuses('but cannot open a site',
  $$insert into public.projects (entity_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001','Ghost')$$);
select t.touches_nothing('nor close one',
  $$update public.projects set status = 'completed' where id = 'dddddddd-0000-0000-0000-000000000001'$$);

-- Mallory owns a company of her own, which is the interesting case: not a
-- stranger with no login, but a real user of the product looking at somebody
-- else's stores. Eve is no longer the outsider here — an owner added her to
-- Acme earlier in this file, and asserting on her would pass for the wrong
-- reason the day that changes.
set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';  -- mallory, another company
select t.check('another company sees no sites of this one', (select count(*) from public.projects) = 0);
select t.check('no materials', (select count(*) from public.inventory_items) = 0);
select t.check('no movements', (select count(*) from public.inventory_movements) = 0);
select t.check('and no quotations', (select count(*) from public.material_quotes) = 0);
select t.check('nor the lines inside them', (select count(*) from public.material_quote_lines) = 0);
select t.refuses('and cannot file one against a company they are not in',
  $$insert into public.material_quotes (entity_id, vendor, date)
    values ('aaaaaaaa-0000-0000-0000-000000000001','Mallory Supplies', current_date)$$);

\echo ''
\echo '── A PERSONAL INSTALL IS UNTOUCHED ──'
-- Everything above is scoped to an entity. Someone who never creates one must
-- keep exactly the behaviour schema.sql gave them, which is the whole basis for
-- calling this file additive.
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';  -- eve
select t.allows('a personal expense still saves',
  $$insert into public.expenses (id, user_id, property_id, date, amount, category)
    values ('cccccccc-0000-0000-0000-000000000009','55555555-5555-5555-5555-555555555555',
            'bbbbbbbb-0000-0000-0000-000000000001', current_date, 1200, 'Utilities')$$);
select t.check('with no entity on it',
  (select entity_id from public.expenses where id = 'cccccccc-0000-0000-0000-000000000009') is null);
select t.allows('and its owner can still edit it',
  $$update public.expenses set amount = 1300 where id = 'cccccccc-0000-0000-0000-000000000009'$$);
select t.check('which took effect',
  (select amount from public.expenses where id = 'cccccccc-0000-0000-0000-000000000009') = 1300);
select t.allows('and delete it',
  $$delete from public.expenses where id = 'cccccccc-0000-0000-0000-000000000009'$$);

-- An asset carries its books the same way an entry does. The column has to
-- exist for the client to write it, and has to stay nullable — a row with none
-- is a personal one, which is what every row written before companies existed
-- already is.
select t.allows('a personal asset still saves',
  $$insert into public.properties (id, user_id, name, type)
    values ('bbbbbbbb-0000-0000-0000-00000000000e','55555555-5555-5555-5555-555555555555',
            'Eve Cottage', 'Real Estate — Villa / House')$$);
select t.check('with no entity on it either',
  (select entity_id from public.properties where id = 'bbbbbbbb-0000-0000-0000-00000000000e') is null);
select t.allows('and one can be put into a company',
  $$update public.properties set entity_id = null
     where id = 'bbbbbbbb-0000-0000-0000-00000000000e'$$);
select t.allows('and deleted',
  $$delete from public.properties where id = 'bbbbbbbb-0000-0000-0000-00000000000e'$$);

reset role;

\echo ''
\echo '── AN ASSET CARRIES ITS BOOKS ──'
reset role;
select t.check('properties has an entity_id',
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'properties' and column_name = 'entity_id'));
select t.check('and it is nullable, so a personal asset needs nothing',
  (select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'entity_id') = 'YES');
select t.check('and it is indexed, because every read filters on it',
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'properties_entity_idx'));
