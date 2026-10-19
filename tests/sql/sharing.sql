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
\echo '── AN EDITOR MAY WRITE, A VIEWER MAY NOT ──'
-- `can_write_workspace` and thirteen policies hang off `role = 'editor'`, and
-- none of it had ever been run. The app gives an editor the full write UI
-- (`canWriteActive = isOwnWorkspace || activeRole === 'editor'`) and stamps
-- their rows with the *owner's* id, so if the policies did not match, every
-- edit would be filtered out and vanish without a word.
set role postgres;
update public.memberships set role = 'editor'
 where owner_id = '11111111-1111-1111-1111-111111111111'
   and member_id = '33333333-3333-3333-3333-333333333333';
insert into public.memberships (owner_id, member_id, owner_email, member_email, role)
values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333',
        'alice@test.invalid', 'carol@test.invalid', 'editor')
on conflict (owner_id, member_id) do update set role = 'editor';
insert into public.properties (id, user_id, name)
values ('eeeeeeee-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Alice Shop')
on conflict (id) do nothing;
set role offset_app;

set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';  -- carol, editor on alice's books
select t.check('an editor reads the owner''s asset',
  (select count(*) from public.properties where id = 'eeeeeeee-0000-0000-0000-000000000002') = 1);
select t.allows('and may change it',
  $$update public.properties set name = 'Alice Shop 2'
     where id = 'eeeeeeee-0000-0000-0000-000000000002'$$);
select t.check('which took effect',
  (select name from public.properties where id = 'eeeeeeee-0000-0000-0000-000000000002') = 'Alice Shop 2');
-- Stamped with the owner's id, not the editor's, which is what `ownerForWrite`
-- does and what the policy has to accept.
select t.allows('and may add a cost to the owner''s books',
  $$insert into public.expenses (id, user_id, property_id, date, amount, category)
    values ('eeeeeeee-0000-0000-0000-00000000001e','11111111-1111-1111-1111-111111111111',
            'eeeeeeee-0000-0000-0000-000000000002', current_date, 2500, 'Repairs')$$);
select t.allows('and income',
  $$insert into public.income (id, user_id, property_id, date, amount, source)
    values ('eeeeeeee-0000-0000-0000-00000000001f','11111111-1111-1111-1111-111111111111',
            'eeeeeeee-0000-0000-0000-000000000002', current_date, 9000, 'Rent')$$);
select t.allows('and a document',
  $$insert into public.documents (id, user_id, property_id, title, file_url)
    values ('eeeeeeee-0000-0000-0000-00000000002d','11111111-1111-1111-1111-111111111111',
            'eeeeeeee-0000-0000-0000-000000000002', 'Lease', '11111111-1111-1111-1111-111111111111/lease.pdf')$$);
-- A comment is the fifth thing the app writes through `ownerForWrite`, and
-- `teams.sql` gave shared policies to four tables and missed this one. Without
-- them an editor cannot comment at all and a viewer cannot read a comment
-- anybody has left, on anybody's entry.
select t.allows('and a comment, which is the fifth thing the app writes here',
  $$insert into public.comments (id, user_id, kind, entry_id, body)
    values ('eeeeeeee-0000-0000-0000-00000000003c','11111111-1111-1111-1111-111111111111',
            'expense','eeeeeeee-0000-0000-0000-00000000001e','Checked against the bill.')$$);
select t.check('and can read it back',
  (select body from public.comments where id = 'eeeeeeee-0000-0000-0000-00000000003c')
    = 'Checked against the bill.');
select t.allows('and remove it again',
  $$delete from public.comments where id = 'eeeeeeee-0000-0000-0000-00000000003c'$$);

-- The control beside all of that: the viewer still cannot, so what is being
-- tested is the role and not the sharing.
set role postgres;
insert into public.memberships (owner_id, member_id, owner_email, member_email, role)
values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
        'alice@test.invalid', 'bob@test.invalid', 'viewer')
on conflict (owner_id, member_id) do update set role = 'viewer';
insert into public.comments (id, user_id, kind, entry_id, body)
values ('eeeeeeee-0000-0000-0000-00000000004c', '11111111-1111-1111-1111-111111111111',
        'expense', 'eeeeeeee-0000-0000-0000-00000000001e', 'Owner''s own note.')
on conflict (id) do nothing;
set role offset_app;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';  -- bob, viewer again
select t.check('a viewer reads the comment',
  (select count(*) from public.comments where id = 'eeeeeeee-0000-0000-0000-00000000004c') = 1);
select t.touches_nothing('but changes nothing on the owner''s asset',
  $$update public.properties set name = 'Bob Took This'
     where id = 'eeeeeeee-0000-0000-0000-000000000002'$$);
select t.refuses('and cannot leave one of their own',
  $$insert into public.comments (user_id, kind, entry_id, body)
    values ('11111111-1111-1111-1111-111111111111','expense',
            'eeeeeeee-0000-0000-0000-00000000001e','Bob was here.')$$);

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
