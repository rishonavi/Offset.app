// Runs tests/sql/corporate.sql against a real PostgreSQL.
//
// Skipped unless OFFSET_TEST_PG is set, because most machines have no Postgres
// and a suite that fails for want of a server teaches people to ignore it. The
// schema is the one thing here that cannot be checked any other way: RLS
// policies are evaluated by the database or not at all, and reading them is no
// substitute — two of the policies in this file looked right and were wrong.
//
//   createdb offset_test
//   OFFSET_TEST_PG='postgresql:///offset_test' node tests/sql/run.mjs
//
// The database is emptied first and left in place afterwards. Point it at a
// scratch database and nothing else.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

const conn = process.env.OFFSET_TEST_PG
if (!conn) {
  console.log('skipped — set OFFSET_TEST_PG to a scratch PostgreSQL database to run the schema tests.')
  console.log('  e.g. createdb offset_test && OFFSET_TEST_PG=postgresql:///offset_test node tests/sql/run.mjs')
  process.exit(0)
}

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
// stderr folded into stdout, in order.
//
// psql sends `\echo` to stdout and `raise notice` to stderr. This suite puts
// its section headings in the first and every single PASS/FAIL in the second,
// and the reader below concatenated the two streams — so it printed all 193
// results in one block and then all 16 headings after them, every assertion
// detached from the heading that says what it is about. A heading with nothing
// under it is also exactly what a whole section silently failing to run looks
// like, which is why this was worth more than tidiness.
const psql = (args, opts = {}) =>
  spawnSync('sh', ['-c', 'exec psql "$0" -v ON_ERROR_STOP=1 "$@" 2>&1', conn, ...args],
    { encoding: 'utf8', ...opts })

// Supabase supplies auth.uid(), auth.users and a storage schema. A plain
// Postgres has none of them, so they are stood up here rather than being
// written into the shipped files, which must stay exactly what you paste into
// the Supabase SQL editor.
const stub = join(mkdtempSync(join(tmpdir(), 'offset-sql-')), 'stub.sql')
writeFileSync(stub, `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text unique);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(regexp_replace(name, '/[^/]*$', ''), '/') $$;
-- Stands in for Supabase's "authenticated" role. Superusers and table owners
-- bypass row-level security, so the checks must run as somebody who cannot.
-- Created rather than recreated: roles are cluster-wide, so dropping one that
-- holds grants in another database fails, and this suite must not care what
-- else is on the server.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'offset_app') then
    create role offset_app nologin nobypassrls;
  end if;
end $$;
-- And the three roles Supabase itself provides, which the shipped files grant
-- to by name. Without them \`teams.sql\`, \`admin.sql\` and \`reports.sql\` stop at
-- their first grant with \`role "authenticated" does not exist\` — so four of
-- the six files were never applied here, and the tables they hold were never
-- in the database for anything to check. The shipped SQL is right; the
-- stand-in was short.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role']
  loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin nobypassrls', r);
    end if;
  end loop;
end $$;
`)

// Emptied before anything is applied, because a suite that runs on top of the
// last run is a suite that cannot see a migration go missing: drop the line
// that makes a column nullable and the column stays nullable from yesterday,
// and every assertion still passes. Found exactly that way.
const reset = psql(['-q', '-c', 'drop schema if exists public cascade; create schema public;'
  + ' drop schema if exists auth cascade; drop schema if exists storage cascade;'])
if (reset.status !== 0) {
  console.log(`**FAIL**  could not empty the database\n${(reset.stdout || reset.stderr || '').trim()}`)
  process.exit(1)
}

// All six, in the order DEPLOY.md gives: `schema.sql` first, and the other
// five depend only on it. It used to be these two alone, so four of the files
// this deployment needs were never applied here at all — and the tables they
// hold (`memberships`, `app_config`, `scan_usage`, `bug_reports`) were never
// in the database for any assertion to reach. That is the same gap the deploy
// guide had, which named two files and left four for people to discover as
// 404s from PostgREST.
const SQL_FILES = ['schema.sql', 'corporate.sql', 'teams.sql', 'admin.sql', 'limits.sql', 'reports.sql']
const sqlPath = (f) => join(repo, 'supabase', f)
const steps = [
  ['Supabase stand-ins', stub],
  ...SQL_FILES.map((f) => [f, sqlPath(f)]),
  // Applied twice on purpose: every one of them claims to be safe to re-run,
  // and that claim is what somebody relies on after pulling a change.
  ...SQL_FILES.map((f) => [`${f} again`, sqlPath(f)]),
]

let pass = 0, fail = 0
for (const [label, file] of steps) {
  const r = psql(['-q', '-f', file])
  if (r.status === 0) { pass++; console.log(`PASS  ${label} applies cleanly`) }
  else { fail++; console.log(`**FAIL**  ${label}\n${(r.stdout || r.stderr || '').trim().split('\n').slice(0, 6).join('\n')}`) }
}

// In order, in one database: `corporate.sql` defines the `t.*` helpers and the
// users, and `sharing.sql` uses them.
for (const file of ['corporate.sql', 'sharing.sql']) {
  const run = psql(['-f', join(here, file)])
  for (const line of (run.stdout + run.stderr).split('\n')) {
    const text = line.replace(/^psql:[^ ]* NOTICE:\s{2}/, '').trimEnd()
    if (/^\*\*FAIL\*\*/.test(text)) { fail++; console.log(text) }
    else if (/^PASS/.test(text)) { pass++; console.log(text) }
    else if (/^──/.test(text)) console.log('\n' + text)
    else if (/^psql:.*ERROR/.test(line)) { fail++; console.log(line.trim()) }
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
