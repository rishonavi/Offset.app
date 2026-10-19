// Whether the tables the sync layer talks to are the tables the schema ships.
//
// Cloud mode is the half of this app that development never exercises: a demo
// build never calls it, and no test could, because doing so needs a Supabase
// project. The last audit of that half found six functions that had never run
// once. This one reads the SQL instead, and asks whether every column the sync
// actually names exists in the table it names it on.
//
// It found one. `syncCollection` filtered every pull with `.in('entity_id', …)`,
// including the pull of `entities` — the table that *is* the company, whose own
// id is the entity id and which has no `entity_id` column. Postgres answers 400,
// so the first collection in the order failed on every sync while the
// twenty-two that point at it went through. A second device got a yard, a
// muster roll and a payroll whose company was not there.
import { readFileSync, readdirSync } from 'node:fs'
import { TABLES, ORDER, scopeColumn } from '../../src/lib/storage/corporateSync.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

const sql = ['schema.sql', 'corporate.sql', 'teams.sql', 'admin.sql', 'limits.sql', 'reports.sql']
  .map((f) => readFileSync(new URL(`../../supabase/${f}`, import.meta.url), 'utf8'))
  .join('\n')

// Columns per table, from the three ways this schema declares them. The third
// is the one that matters and the one a naive reader misses: most of the synced
// columns are added inside `do $$ … foreach t in array array[…] … add column
// if not exists %I … $$` loops, so a scan that only understands CREATE TABLE
// and literal ALTERs reports twenty-two tables as missing `updated_at` when
// every one of them has it. That scan was my first attempt at this.
function schemaColumns() {
  const tables = new Map()
  const add = (t, c) => {
    if (!tables.has(t)) tables.set(t, new Set())
    tables.get(t).add(c)
  }

  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_]+)\s*\(([\s\S]*?)\n\)\s*;/gi)) {
    const [, table, body] = m
    if (!tables.has(table)) tables.set(table, new Set())
    for (const line of body.split('\n')) {
      const col = line.trim().replace(/,$/, '').match(/^([a-z_]+)\s/)
      if (col && !['primary', 'unique', 'constraint', 'foreign', 'check', 'exclude'].includes(col[1])) {
        add(table, col[1])
      }
    }
  }

  for (const m of sql.matchAll(/alter\s+table\s+(?:public\.)?([a-z_]+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_]+)/gi)) {
    add(m[1], m[2])
  }

  // `do $$ … $$` blocks that loop a list of tables and add one column to each.
  for (const block of sql.matchAll(/do\s+\$\$([\s\S]*?)\$\$\s*;/gi)) {
    const body = block[1]
    const list = body.match(/foreach\s+\w+\s+in\s+array\s+array\[([\s\S]*?)\]/i)
    if (!list) continue
    const names = [...list[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    for (const col of body.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_]+)/gi)) {
      for (const t of names) add(t, col[1])
    }
  }
  return tables
}

const SCHEMA = schemaColumns()
const has = (table, col) => Boolean(SCHEMA.get(table)?.has(col))

// Row-level security, the other way cloud mode goes wrong — and the quieter
// one. A missing column answers 400 and somebody notices; a table with RLS
// switched off answers everything to everybody and nobody notices at all.
// Policies on such a table are inert: Postgres does not warn, the dashboard
// shows them as present, and PostgREST serves the table to anyone holding the
// anon key, which ships in the browser bundle by design.
function security() {
  const rls = new Set()
  const policies = new Map()
  const bump = (t, n) => policies.set(t, (policies.get(t) || 0) + n)

  for (const m of sql.matchAll(/alter\s+table\s+(?:public\.)?([a-z_]+)\s+enable\s+row\s+level\s+security/gi)) {
    rls.add(m[1])
  }
  for (const m of sql.matchAll(/create\s+policy\s+"?[^"\n]*"?\s+on\s+(?:public\.)?([a-z_]+)/gi)) {
    bump(m[1], 1)
  }
  // The same do-block loops, which is where most of the policies are written.
  for (const block of sql.matchAll(/do\s+\$\$([\s\S]*?)\$\$\s*;/gi)) {
    const body = block[1]
    const list = body.match(/foreach\s+\w+\s+in\s+array\s+array\[([\s\S]*?)\]/i)
    if (!list) continue
    const names = [...list[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    const made = (body.match(/create\s+policy/gi) || []).length
    if (made) for (const t of names) bump(t, made)
    if (/enable\s+row\s+level\s+security/i.test(body)) for (const t of names) rls.add(t)
  }
  return { rls, policies }
}
const { rls, policies } = security()

console.log('── THE READER UNDERSTANDS THIS SCHEMA ──')
// Four facts checked by hand, one for each way a column gets declared, because
// every assertion below is worth exactly as much as the parse is.
ok('a column from CREATE TABLE is found', has('entities', 'name'))
ok('one from a plain ALTER is found', has('entities', 'pf_registered'))
ok('one added by a do-block loop is found', has('projects', 'updated_at'))
ok('and the tombstone loop too', has('work_orders', 'deleted_at'))
// The negative control. A reader that said yes to everything would pass the
// whole suite.
ok('a column that is not there is not found', !has('entities', 'entity_id'))
ok('nor is one nobody ever wrote', !has('projects', 'no_such_column'))
eq('and the schema has a good number of tables', SCHEMA.size > 30, true)

console.log('\n── EVERY SYNCED COLLECTION HAS ITS TABLE ──')
for (const kind of ORDER) {
  const table = TABLES[kind]
  ok(`${kind} → ${table}`, Boolean(table) && SCHEMA.has(table), `no table ${table} in the schema`)
}
eq('and the order covers every mapping', ORDER.length, Object.keys(TABLES).length)

console.log('\n── AND THE COLUMNS EVERY SYNC DEPENDS ON ──')
for (const kind of ORDER) {
  const table = TABLES[kind]
  // `onConflict: 'id'` on the push.
  ok(`${table} can be upserted on id`, has(table, 'id'))
  // `.gt('updated_at', since)` on the pull, and the value handed back as `_rev`.
  ok(`${table} carries updated_at`, has(table, 'updated_at'))
  // The filter the pull actually applies — asked of the module, not assumed,
  // so this tests its choice rather than restating it.
  const scope = scopeColumn(kind)
  ok(`${table} can be scoped by ${scope}`, has(table, scope),
    `${table} has no ${scope}; columns: ${[...(SCHEMA.get(table) || [])].sort().join(', ')}`)
}

console.log('\n── AND THE QUOTATION THAT LIVES IN TWO TABLES ──')
for (const col of ['id', 'quote_id', 'entity_id', 'updated_at']) {
  ok(`material_quote_lines carries ${col}`, has('material_quote_lines', col))
}

console.log('\n── THE PERSONAL LEDGER, WHICH IS THE OTHER BACKEND ──')
// Queried directly by storage/supabase.js rather than through the sync layer.
for (const [table, cols] of [
  ['properties', ['id', 'user_id', 'name']],
  ['expenses', ['id', 'user_id', 'date', 'deleted_at']],
  ['income', ['id', 'user_id', 'date', 'deleted_at']],
  ['documents', ['id']],
  ['comments', ['id']],
  ['personal_expenses', ['id', 'deleted_at']],
  ['personal_budgets', ['user_id', 'category', 'monthly_limit']],
  ['profiles', ['user_id', 'plan']],
]) {
  for (const c of cols) ok(`${table}.${c}`, has(table, c))
}

console.log('\n\u2500\u2500 AND EVERY TABLE IS BEHIND ROW-LEVEL SECURITY \u2500\u2500')
// Every table in `public`, not just the synced ones: PostgREST serves all of
// them. `payroll_runs` was the one that was not \u2014 written into the policy loop
// and left out of the hand-kept list of `enable row level security` lines, so
// every pay run of every company on the deployment was readable and writable by
// any signed-in user. Gross, net, PF, ESI and professional tax, per person, per
// period. One line missing from a list of twenty-four.
{
  const created = [...new Set(
    [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_]+)/gi)].map((m) => m[1]),
  )]
  eq('the schema creates the tables this app needs', created.length > 35, true)
  const open_ = created.filter((t) => !rls.has(t))
  ok('none is left outside row-level security', open_.length === 0, open_.join(', '))
  // And a policy on a table with it switched off is not protection, so the
  // reverse is worth stating too.
  const inert = created.filter((t) => policies.get(t) && !rls.has(t))
  ok('and no policy is written on a table that ignores policies', inert.length === 0, inert.join(', '))
  // The control: a table with RLS and no policy returns nothing to anybody,
  // which is a different fault and would read as "my data is gone".
  const mute = created.filter((t) => rls.has(t) && !policies.get(t))
  ok('nor is any table locked with no way in', mute.length === 0, mute.join(', '))
  // And the reader can tell the difference, otherwise the three above are free.
  ok('the reader sees policies where they are', (policies.get('expenses') || 0) > 5, String(policies.get('expenses')))
  ok('and finds none on a table nobody wrote one for', !policies.get('no_such_table'))
}

console.log('\n\u2500\u2500 AND THE DEPLOY GUIDE NAMES EVERY FILE YOU HAVE TO RUN \u2500\u2500')
// The guide said `schema.sql`, then `corporate.sql` \"if you want entities and
// approvals\". Four files went unmentioned, and between them they hold
// `memberships`, `app_config`, `scan_usage` and `bug_reports` \u2014 tables the app
// queries on sign-in, on every page load, on every receipt scan and from the
// sidebar link of every page. Each missing one is a 404 from PostgREST on a
// deployment whose keys are perfectly correct.
{
  const guide = readFileSync(new URL('../../docs/DEPLOY.md', import.meta.url), 'utf8')
  const files = readdirSync(new URL('../../supabase/', import.meta.url))
    .filter((f) => f.endsWith('.sql'))
  eq('there are six of them', files.length, 6)
  for (const f of files) ok(`DEPLOY.md names ${f}`, guide.includes(f))
  // The control: it is matching names, not just finding the word everywhere.
  ok('and does not claim one that does not exist', !guide.includes('nonexistent.sql'))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
