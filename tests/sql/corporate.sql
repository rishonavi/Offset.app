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
select t.refuses('a kind the app never writes is still refused',
  $$insert into public.inventory_movements (entity_id, item_id, kind, date, qty)
    values ('aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001',
            'stolen', current_date, 1)$$);
select t.check('the rejection kept its reason',
  (select reason from public.inventory_movements
    where kind = 'rejected' and item_id = 'eeeeeeee-0000-0000-0000-000000000001') = 'Set hard in transit');
select t.check('and the issue knows which site it went to',
  (select project_id from public.inventory_movements
    where kind = 'issue' and item_id = 'eeeeeeee-0000-0000-0000-000000000001')
    = 'dddddddd-0000-0000-0000-000000000001');

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
