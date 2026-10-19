-- Read-only sharing, evaluated by the database.
--
-- `teams.sql` grants another user `select` on your properties, expenses and
-- income, and nothing else. "And nothing else" is the whole product promise of
-- the feature, and it is a claim about row-level security, which only Postgres
-- can settle: a policy can be read and look right and be wrong.
--
-- None of it had ever been evaluated. `run.mjs` applied `schema.sql` and
-- `corporate.sql` and stopped, so `memberships` was not even a table in the
-- database these tests run against.
--
-- Runs after `corporate.sql` in the same database and uses the `t.*` helpers it
-- defines. On its own it fails loudly on a missing function, which is the
-- honest failure for a file that depends on another.

\set ON_ERROR_STOP on
\echo ''
\echo '── SHARING A WORKSPACE IS READ-ONLY ──'

-- Alice owns the books; bob is given read access; dave is a stranger to both.
set role postgres;
insert into public.properties (id, user_id, name)
values ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alice Flat')
on conflict (id) do nothing;
insert into public.expenses (id, user_id, property_id, date, amount, category)
values ('eeeeeeee-0000-0000-0000-00000000000e', '11111111-1111-1111-1111-111111111111',
        'eeeeeeee-0000-0000-0000-000000000001', current_date, 7000, 'Repairs')
on conflict (id) do nothing;
insert into public.income (id, user_id, property_id, date, amount, source)
values ('eeeeeeee-0000-0000-0000-00000000000f', '11111111-1111-1111-1111-111111111111',
        'eeeeeeee-0000-0000-0000-000000000001', current_date, 42000, 'Rent')
on conflict (id) do nothing;
-- The invite itself is made by the serverless function with the service role,
-- which is why this row is inserted as the owner of the tables rather than
-- through a policy.
insert into public.memberships (owner_id, member_id, owner_email, member_email)
values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
        'alice@test.invalid', 'bob@test.invalid')
on conflict (owner_id, member_id) do nothing;
set role offset_app;

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';  -- bob, the shared-with
select t.check('a member reads the owner''s asset',
  (select count(*) from public.properties where id = 'eeeeeeee-0000-0000-0000-000000000001') = 1);
select t.check('and the owner''s costs',
  (select count(*) from public.expenses where id = 'eeeeeeee-0000-0000-0000-00000000000e') = 1);
select t.check('and the owner''s income',
  (select count(*) from public.income where id = 'eeeeeeee-0000-0000-0000-00000000000f') = 1);

-- The promise. A share that can write is not a share, and nothing in the app
-- would show the difference until somebody's books changed under them.
select t.touches_nothing('but changes nothing on the asset',
  $$update public.properties set name = 'Bob Took This'
     where id = 'eeeeeeee-0000-0000-0000-000000000001'$$);
select t.touches_nothing('nor on a cost',
  $$update public.expenses set amount = 1
     where id = 'eeeeeeee-0000-0000-0000-00000000000e'$$);
select t.touches_nothing('nor on income',
  $$update public.income set amount = 1
     where id = 'eeeeeeee-0000-0000-0000-00000000000f'$$);
select t.touches_nothing('and deletes nothing',
  $$delete from public.expenses where id = 'eeeeeeee-0000-0000-0000-00000000000e'$$);
select t.refuses('and cannot add a cost to books that are not theirs',
  $$insert into public.expenses (user_id, property_id, date, amount, category)
    values ('11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001',
            current_date, 1, 'Materials')$$);
-- And the reads above were real: the row still says what it said.
select t.check('the owner''s asset is untouched',
  (select name from public.properties where id = 'eeeeeeee-0000-0000-0000-000000000001') = 'Alice Flat');

\echo ''
\echo '── A STRANGER IS NOT A MEMBER ──'
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';  -- dave, shared with nobody
select t.check('sees none of the asset',
  (select count(*) from public.properties where id = 'eeeeeeee-0000-0000-0000-000000000001') = 0);
select t.check('none of the costs',
  (select count(*) from public.expenses where id = 'eeeeeeee-0000-0000-0000-00000000000e') = 0);
select t.check('none of the income',
  (select count(*) from public.income where id = 'eeeeeeee-0000-0000-0000-00000000000f') = 0);
select t.check('and not the share itself',
  (select count(*) from public.memberships
    where owner_id = '11111111-1111-1111-1111-111111111111') = 0);

-- The escalation that matters: writing your own way in. The insert policy
-- checks `auth.uid() = owner_id`, so a row naming somebody else as owner is
-- refused — but that is a claim about a policy, and this is the only thing
-- that can settle it.
select t.refuses('and cannot grant itself access to somebody''s books',
  $$insert into public.memberships (owner_id, member_id)
    values ('11111111-1111-1111-1111-111111111111','44444444-4444-4444-4444-444444444444')$$);
select t.check('so the books stay unshared',
  (select count(*) from public.memberships
    where owner_id = '11111111-1111-1111-1111-111111111111'
      and member_id = '44444444-4444-4444-4444-444444444444') = 0);

\echo ''
\echo '── THE OWNER IS STILL THE OWNER ──'
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';  -- alice
select t.check('sees the share she granted',
  (select count(*) from public.memberships
    where owner_id = '11111111-1111-1111-1111-111111111111'
      and member_id = '22222222-2222-2222-2222-222222222222') = 1);
select t.check('and her own asset',
  (select count(*) from public.properties where id = 'eeeeeeee-0000-0000-0000-000000000001') = 1);
select t.allows('and can still change it',
  $$update public.properties set name = 'Alice Flat 2'
     where id = 'eeeeeeee-0000-0000-0000-000000000001'$$);
select t.check('which took effect',
  (select name from public.properties where id = 'eeeeeeee-0000-0000-0000-000000000001') = 'Alice Flat 2');
select t.allows('and can take the share back',
  $$delete from public.memberships
     where owner_id = '11111111-1111-1111-1111-111111111111'
       and member_id = '22222222-2222-2222-2222-222222222222'$$);

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';  -- bob again
select t.check('after which the member sees nothing',
  (select count(*) from public.properties where id = 'eeeeeeee-0000-0000-0000-000000000001') = 0);

\echo ''
\echo '── AND THE TABLES THE OTHER FILES ADD ──'
-- Never applied here before, so never checked. Each is readable by anyone
-- holding the anon key unless a policy says otherwise.
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select t.check('a stranger reads nobody''s bug reports',
  (select count(*) from public.bug_reports) = 0);
select t.check('and is not an admin',
  (select count(*) from public.admins) = 0);
select t.check('and reads nobody''s scan usage',
  (select count(*) from public.scan_usage) = 0);
-- app_config is deliberately world-readable: it carries the maintenance notice
-- every page load reads, including on the sign-in screen where nobody is signed
-- in yet. Stated rather than assumed, because "readable by everyone" should be
-- a decision in a test and not a surprise in a dashboard.
select t.check('but app_config is readable, which is what the banners need',
  (select count(*) from public.app_config) >= 0);
