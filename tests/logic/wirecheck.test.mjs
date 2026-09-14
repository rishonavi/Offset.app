// Does the client send columns the database actually has?
//
// The sync layer has been tested from both ends and never in the middle. The
// reconciliation rules run against a stub that accepts whatever it is handed;
// the schema runs against a real PostgreSQL that nothing pushes to. Between
// them sits the question neither asks: the rows this app builds are upserted
// key by key, so a field the makers produce and the schema does not have is a
// row the server refuses — and nothing here would have said so until somebody
// connected a project and watched it fail.
//
// That much is checkable without a server. It is not the whole of what a live
// Supabase would prove — auth, row-level security under a real token, the
// network — but it is the specific failure worth naming, so it is worth
// catching here rather than in somebody's first sync.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { TABLES, SYNCED } from '../../src/lib/storage/corporateSync.js'
import { makeEntity, makeMember, makeDepartment, makeAuditEvent } from '../../src/lib/corporate.js'
import { makeProject } from '../../src/lib/projects.js'
import { makeItem, makeMovement } from '../../src/lib/inventory.js'
import { makeQuote, makeQuoteLine } from '../../src/lib/quotes.js'
import { makeMuster } from '../../src/lib/labour.js'
import { makeWorkOrder, makeRaBill } from '../../src/lib/subcontract.js'
import { makeWorkItem, makeMeasurement } from '../../src/lib/progress.js'
import { makePlant, makePlantLog } from '../../src/lib/plant.js'
import { makeUnit, makePlanStage, makeReceipt } from '../../src/lib/sales.js'
import { makeAdvance, makeAdjustment } from '../../src/lib/advances.js'
import { makeEmployee } from '../../src/lib/payroll.js'
import { tag } from '../../src/lib/sampleData.js'
import { buildSample } from '../../src/lib/sampleSite.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sql = ['schema.sql', 'corporate.sql']
  .map((f) => readFileSync(join(repo, 'supabase', f), 'utf8'))
  .join('\n')

// ── Reading the schema ──────────────────────────────────────────────
// Deliberately simple, and deliberately not a SQL parser: it reads the two
// files this repository ships, whose shape is known. A line inside a CREATE
// TABLE that starts with a word is a column; one that starts with a constraint
// keyword is not. ALTER TABLE ... ADD COLUMN adds to whatever is already there.
const CONSTRAINT = /^(primary|unique|check|foreign|constraint|exclude)\b/i

function columnsFromSql(text) {
  const tables = new Map()
  const add = (table, column) => {
    if (!tables.has(table)) tables.set(table, new Set())
    tables.get(table).add(column)
  }

  const creates = text.matchAll(/create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\);/gi)
  for (const [, table, body] of creates) {
    let depth = 0
    for (const raw of body.split('\n')) {
      const line = raw.replace(/--.*$/, '').trim()
      if (!line) continue
      // A column whose type carries its own parentheses — numeric(14,2), or a
      // check constraint spanning lines — must not be read as a new column.
      const before = depth
      depth += (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length
      if (before > 0) continue
      if (CONSTRAINT.test(line)) continue
      const name = line.match(/^(\w+)/)?.[1]
      if (name) add(table, name)
    }
  }

  const alters = text.matchAll(/alter table (?:if exists )?public\.(\w+)\s+add column (?:if not exists )?(\w+)/gi)
  for (const [, table, column] of alters) add(table, column)

  // `updated_at` and `deleted_at` are added to twenty-odd tables at once by a
  // DO block looping over an array of names. Reading only the literal ALTERs
  // would report every one of those columns as missing, which is the sort of
  // false alarm that gets a check switched off.
  const loops = text.matchAll(/do \$\$[\s\S]*?foreach \w+ in array array\[([\s\S]*?)\]([\s\S]*?)end \$\$;/gi)
  for (const [, list, body] of loops) {
    const names = [...list.matchAll(/'(\w+)'/g)].map((m) => m[1])
    for (const [, column] of body.matchAll(/add column (?:if not exists )?(\w+)/gi)) {
      for (const t of names) add(t, column)
    }
  }

  return tables
}

const schema = columnsFromSql(sql)

console.log('\n── THE SCHEMA READS AS A SCHEMA ──')
ok('the files were found and parsed', schema.size > 20, `${schema.size} tables`)
// A parser that quietly finds nothing would make every check below pass, so
// these are the control: known columns that must be there, and a made-up one
// that must not.
ok('expenses has the columns it obviously has',
  ['id', 'user_id', 'property_id', 'date', 'amount', 'category'].every((c) => schema.get('expenses')?.has(c)),
  [...(schema.get('expenses') || [])].join(', '))
ok('and the ones corporate.sql adds later',
  ['entity_id', 'project_id', 'approval_status', 'deleted_at'].every((c) => schema.get('expenses')?.has(c)),
  [...(schema.get('expenses') || [])].join(', '))
// Not `updated_at`: the personal ledger is not one of the tables the corporate
// sync layer carries, and it goes to Supabase through its own backend. Worth
// stating, because the absence otherwise reads as an oversight.
ok('but not the corporate sync layer\'s own clock, which expenses do not use',
  !schema.get('expenses')?.has('updated_at'))
ok('a column nobody wrote is not found', !schema.get('expenses')?.has('nonsense_column'))
ok('a constraint line is not read as a column',
  !schema.get('expenses')?.has('primary') && !schema.get('expenses')?.has('check'))
// The DO-block loop, read as if it had been written out table by table.
ok('columns added by the loop are found',
  schema.get('plant_logs')?.has('updated_at') && schema.get('sale_receipts')?.has('deleted_at'),
  [...(schema.get('plant_logs') || [])].join(', '))
// And not added to tables the loop leaves out: `deleted_at` is on the ledgers
// and not on the five tables that never tombstone.
ok('and not to the tables it leaves out', !schema.get('audit_events')?.has('deleted_at'))

// ── What the client actually sends ──────────────────────────────────
// `syncCollection` upserts `strip(row)` — every key of the local row except
// those beginning with an underscore. So the keys the makers produce are, to
// the column, what the database is asked to accept.
const E = 'aaaaaaaa-0000-0000-0000-000000000001'
const MADE = {
  entities: makeEntity({ name: 'X' }),
  members: makeMember({ entityId: E, userId: 'u', email: 'a@b.c' }),
  departments: makeDepartment({ entityId: E, name: 'X' }),
  audit: makeAuditEvent({ entityId: E, actorId: 'u', actorEmail: 'a@b.c', action: 'site.create' }),
  projects: makeProject({ entityId: E, name: 'X' }),
  items: makeItem({ entityId: E, name: 'X' }),
  movements: makeMovement({ entityId: E, itemId: 'i' }),
  quotes: makeQuote({ entityId: E, vendor: 'V', lines: [makeQuoteLine({ name: 'L', qty: 1, rate: 1 })] }),
  muster: makeMuster({ entityId: E }),
  workOrders: makeWorkOrder({ entityId: E, contractor: 'C' }),
  raBills: makeRaBill({ entityId: E, workOrderId: 'w' }),
  workItems: makeWorkItem({ entityId: E }),
  measurements: makeMeasurement({ entityId: E, workItemId: 'w' }),
  plant: makePlant({ entityId: E, name: 'X' }),
  plantLogs: makePlantLog({ entityId: E, plantId: 'p' }),
  units: makeUnit({ entityId: E, name: 'X' }),
  planStages: makePlanStage({ entityId: E, unitId: 'u' }),
  receipts: makeReceipt({ entityId: E, unitId: 'u' }),
  advances: makeAdvance({ entityId: E, employeeId: 'e' }),
  adjustments: makeAdjustment({ entityId: E, advanceId: 'a' }),
  employees: makeEmployee({ entityId: E, name: 'X' }),
}

// Added by the store rather than by the maker, and sent all the same.
// `updated_at` rides on every row; `deleted_at` only on the ledgers, because
// entities are archived rather than deleted and the other three are not
// tombstoned at all.
const STORE_ADDS = ['updated_at']
const NEVER_TOMBSTONED = ['entities', 'members', 'departments', 'audit']
const APPROVAL_ADDS = ['approval_status', 'approved_by', 'approved_at']
const APPROVABLE = ['workOrders', 'raBills', 'advances']
// A quote's lines are a table of their own, removed before the parent is sent.
const NOT_SENT = { quotes: ['lines'] }

console.log('\n── EVERY KIND HAS SOMETHING TO BE SENT TO ──')
ok('every synced collection names a table', SYNCED.every((k) => TABLES[k]))
ok('and every one of those tables exists',
  SYNCED.every((k) => schema.has(TABLES[k])),
  SYNCED.filter((k) => !schema.has(TABLES[k])).map((k) => `${k} → ${TABLES[k]}`).join(', '))
ok('a row was built for each of them',
  SYNCED.every((k) => MADE[k] && typeof MADE[k] === 'object'),
  SYNCED.filter((k) => !MADE[k]).join(', '))
ok('no two collections share a table',
  new Set(Object.values(TABLES)).size === Object.keys(TABLES).length)

console.log('\n── AND EVERY COLUMN IT SENDS EXISTS THERE ──')
for (const kind of SYNCED) {
  const table = TABLES[kind]
  const cols = schema.get(table) || new Set()
  const sent = [
    ...Object.keys(MADE[kind]).filter((k) => !k.startsWith('_')),
    ...STORE_ADDS,
    ...(NEVER_TOMBSTONED.includes(kind) ? [] : ['deleted_at']),
    ...(APPROVABLE.includes(kind) ? APPROVAL_ADDS : []),
  ].filter((k) => !(NOT_SENT[kind] || []).includes(k))
  const missing = sent.filter((c) => !cols.has(c))
  ok(`${kind} → ${table}`, missing.length === 0, `no such column: ${missing.join(', ')}`)
}

console.log('\n── A QUOTATION’S LINES, WHICH ARE THEIR OWN TABLE ──')
const lineCols = schema.get('material_quote_lines') || new Set()
const lineSent = [...Object.keys(makeQuoteLine({ name: 'L', qty: 1, rate: 1 })), 'quote_id', 'entity_id']
ok('every column a quote line sends exists',
  lineSent.every((c) => lineCols.has(c)),
  lineSent.filter((c) => !lineCols.has(c)).join(', '))

console.log('\n── NOTHING REQUIRED IS LEFT OUT ──')
// The other direction, and the one a stub can never catch: a column the server
// insists on that the client never fills. Only checked where the schema says
// NOT NULL with no default, since everything else the database can supply.
function requiredOf(table) {
  const body = sql.match(new RegExp(`create table (?:if not exists )?public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i'))?.[1]
  if (!body) return []
  const out = []
  for (const raw of body.split('\n')) {
    const line = raw.replace(/--.*$/, '').trim().replace(/,$/, '')
    if (!line || CONSTRAINT.test(line)) continue
    const name = line.match(/^(\w+)/)?.[1]
    if (!name) continue
    if (/\bnot null\b/i.test(line) && !/\bdefault\b/i.test(line)) out.push(name)
  }
  return out
}
for (const kind of SYNCED) {
  const need = requiredOf(TABLES[kind])
  const sent = new Set(Object.keys(MADE[kind]))
  const absent = need.filter((c) => !sent.has(c))
  ok(`${kind} fills everything ${TABLES[kind]} insists on`, absent.length === 0,
    `never sent: ${absent.join(', ')}`)
}

console.log('\n── AND THE DEMO ROWS, WHICH ARE ROWS LIKE ANY OTHER ──')
// Sample data goes through the same insert as everything else. A tag the
// database has no column for does not make a demo row that is quietly untagged;
// it makes an insert the server refuses, and a button that does nothing.
const tagged = Object.keys(tag({}))
for (const table of ['properties', 'expenses', 'income']) {
  const cols = schema.get(table) || new Set()
  const missing = tagged.filter((c) => !cols.has(c))
  ok(`a tagged row can be written to ${table}`, missing.length === 0,
    `no such column: ${missing.join(', ')}`)
}
const built = buildSample(E)
for (const [kind, rows] of Object.entries(built)) {
  if (!TABLES[kind] || !rows.length) continue
  const cols = schema.get(TABLES[kind])
  const missing = [...new Set(rows.flatMap((r) => Object.keys(r)))]
    .filter((c) => !c.startsWith('_') && !cols.has(c))
  ok(`the sample's ${kind} fit ${TABLES[kind]}`, missing.length === 0,
    `no such column: ${missing.join(', ')}`)
}
for (const [kind, table] of [['expenses', 'expenses'], ['income', 'income']]) {
  const cols = schema.get(table)
  const missing = [...new Set(built[kind].flatMap((r) => Object.keys(r)))].filter((c) => !cols.has(c))
  ok(`the sample's ${kind} fit ${table}`, missing.length === 0, `no such column: ${missing.join(', ')}`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
