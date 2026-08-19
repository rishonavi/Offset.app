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
// The database is left in place afterwards. Point it at a scratch database.
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
const psql = (args, opts = {}) =>
  spawnSync('psql', [conn, '-v', 'ON_ERROR_STOP=1', ...args], { encoding: 'utf8', ...opts })

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
`)

const steps = [
  ['Supabase stand-ins', stub],
  ['schema.sql', join(repo, 'supabase', 'schema.sql')],
  ['corporate.sql', join(repo, 'supabase', 'corporate.sql')],
  // Applied twice on purpose: both files claim to be safe to re-run, and that
  // claim is what someone relies on after pulling a change.
  ['schema.sql again', join(repo, 'supabase', 'schema.sql')],
  ['corporate.sql again', join(repo, 'supabase', 'corporate.sql')],
]

let pass = 0, fail = 0
for (const [label, file] of steps) {
  const r = psql(['-q', '-f', file])
  if (r.status === 0) { pass++; console.log(`PASS  ${label} applies cleanly`) }
  else { fail++; console.log(`**FAIL**  ${label}\n${(r.stderr || '').trim().split('\n').slice(0, 6).join('\n')}`) }
}

const run = psql(['-f', join(here, 'corporate.sql')])
const lines = (run.stderr + run.stdout).split('\n')
for (const line of lines) {
  const text = line.replace(/^psql:[^ ]* NOTICE:\s{2}/, '').trimEnd()
  if (/^\*\*FAIL\*\*/.test(text)) { fail++; console.log(text) }
  else if (/^PASS/.test(text)) { pass++; console.log(text) }
  else if (/^──/.test(text)) console.log('\n' + text)
  else if (/^psql:.*ERROR/.test(line)) { fail++; console.log(line.trim()) }
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
