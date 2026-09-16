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
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { columnsFromSql, columnTypes, requiredColumns, readSql, REFUSES_BLANK } from '../schema.mjs'
import { TABLES, SYNCED } from '../../src/lib/storage/corporateSync.js'
import { makeEntity, makeMember, makeDepartment, makeAuditEvent, makeApprovalPolicy } from '../../src/lib/corporate.js'
import { makeProject } from '../../src/lib/projects.js'
import { makeItem, makeMovement } from '../../src/lib/inventory.js'
import { makeQuote, makeQuoteLine } from '../../src/lib/quotes.js'
import { makeMuster } from '../../src/lib/labour.js'
import { makeWorkOrder, makeRaBill } from '../../src/lib/subcontract.js'
import { makeWorkItem, makeMeasurement } from '../../src/lib/progress.js'
import { makePlant, makePlantLog } from '../../src/lib/plant.js'
import { makeUnit, makePlanStage, makeReceipt } from '../../src/lib/sales.js'
import { makeAdvance, makeAdjustment } from '../../src/lib/advances.js'
import { makeEmployee, makePayrollRun, runPayroll } from '../../src/lib/payroll.js'
import { makeStockCount } from '../../src/lib/stockcount.js'
import { tag } from '../../src/lib/sampleData.js'
import { buildSample } from '../../src/lib/sampleSite.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

// The parser lives in tests/schema.mjs: the browser suite asks the same
// question of the same files from the other end, and two copies of it would
// eventually disagree about what a column is.
const sql = readSql()
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
  stockCounts: makeStockCount({ entityId: E, itemId: 'i' }),
  payrollRuns: makePayrollRun({
    entityId: E, period: '2026-03', employees: [makeEmployee({ entityId: E, id: 'x', name: 'X', basic: 1000 })],
    run: runPayroll([makeEmployee({ entityId: E, id: 'x', name: 'X', basic: 1000 })], { period: '2026-03' }),
  }),
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

console.log('\n── AND A COLUMN THAT EXISTS STILL HAS TO ACCEPT WHAT IS SENT ──')
// The half of this question a name-only check cannot ask, and the one that was
// wrong in eleven places at once.
//
// Every maker in this app defaulted an unfilled optional date to the empty
// string, and PostgreSQL refuses `''` for a date, a timestamp, a number or a
// uuid — `invalid input syntax for type date: ""`. So a work order with no due
// date was not a row with a blank field. It was a row the server rejected
// whole, and every column name in it matched perfectly.
//
// Nothing here would have said so: the sync tests run against a stub that
// accepts what it is handed, and the schema tests run against a database
// nothing pushes to. This is the seam, so it is checked at the seam.
const types = columnTypes(sql)
ok('the types were read as well as the names', types.size > 20, `${types.size} tables`)
ok('a date column reads as a date', /^date/.test(types.get('work_orders')?.get('due_on') || ''),
  types.get('work_orders')?.get('due_on'))
ok('and a text column does not', !REFUSES_BLANK.test(types.get('work_orders')?.get('contractor') || ''),
  types.get('work_orders')?.get('contractor'))
ok('an empty string is refused by a date', REFUSES_BLANK.test('date'))
ok('and by a number, a uuid and a timestamp',
  ['numeric(14,2)', 'uuid', 'timestamptz'].every((t) => REFUSES_BLANK.test(t)))
ok('but not by text', !REFUSES_BLANK.test('text') && !REFUSES_BLANK.test('text not null'))

for (const kind of SYNCED) {
  const t = types.get(TABLES[kind]) || new Map()
  const blanks = Object.entries(MADE[kind])
    .filter(([k, v]) => v === '' && REFUSES_BLANK.test(t.get(k) || ''))
    .map(([k]) => `${k} (${t.get(k)})`)
  ok(`nothing ${kind} leaves blank is a column that refuses blanks`, blanks.length === 0,
    `sends '' to ${blanks.join(', ')}`)
}

console.log('\n── AND EVERY COLUMN AN UPDATE SENDS ──')
// The other half of what the client writes, and the half this suite could not
// see. Everything above asks what the makers produce, and a maker is not the
// only thing that writes: `store.quotes.update(id, { received_at })` sends one
// column that no maker ever mentions.
//
// That one was real. Receiving a delivery against an accepted quotation stamps
// the quote so the same lorry cannot be added to stock twice, and
// `material_quotes` had no `received_at`. On a local install it worked. Against
// Supabase the upsert dropped the column, the quote never read as delivered,
// and the button that doubles the stock stayed live — the guard failing exactly
// where the stock is shared.
//
// So the source is read for literal update payloads. Only flat object literals,
// because a spread is a variable and this is a regular expression rather than a
// compiler; what it cannot see it says nothing about rather than guessing.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src')
const sources = []
;(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full)
    else if (/\.(js|jsx)$/.test(name)) sources.push([full, readFileSync(full, 'utf8')])
  }
})(SRC)
ok('the source was found and read', sources.length > 40, `${sources.length} files`)

const writes = []
for (const [file, text] of sources) {
  for (const m of text.matchAll(/store\.(\w+)\.update\([^,()]*,\s*\{([^{}]*)\}/g)) {
    const [, collection, body] = m
    if (!TABLES[collection]) continue
    // Split on top-level commas only: `{ a: f(x, y), b }` is two properties,
    // and a regular expression that splits on every comma reads it as three.
    const parts = []
    let depth = 0, current = ''
    for (const ch of body) {
      if ('([`'.includes(ch)) depth += 1
      else if (')]`'.includes(ch)) depth -= 1
      if (ch === ',' && depth <= 0) { parts.push(current); current = '' } else current += ch
    }
    parts.push(current)
    for (const part of parts) {
      const t = part.trim()
      // A spread carries keys this cannot read. The literal properties beside
      // it still can be, so the payload is checked for what it shows rather
      // than skipped whole.
      if (!t || t.startsWith('...')) continue
      // `{ status }` is a column too. Shorthand was the half the first version
      // of this scan missed, and it is the shorter half to write.
      const name = t.match(/^(\w+)\s*(?::|$)/)?.[1]
      if (name) writes.push({ file: file.slice(SRC.length + 1), collection, column: name })
    }
  }
}
// A scan that found nothing would pass every assertion below it, so the count
// is asserted before the contents are.
ok('literal update payloads were found', writes.length >= 6, `${writes.length} found`)
ok('including the one that was wrong',
  writes.some((w) => w.collection === 'quotes' && w.column === 'received_at'),
  writes.map((w) => `${w.collection}.${w.column}`).join(', '))
for (const w of [...new Map(writes.map((w) => [`${w.collection}.${w.column}`, w])).values()]) {
  ok(`${w.file} writes ${TABLES[w.collection]}.${w.column}`,
    (schema.get(TABLES[w.collection]) || new Set()).has(w.column),
    'no such column')
}

console.log('\n── THE APPROVAL POLICY, WHICH IS NOT A COLLECTION ──')
// The blind spot that let two mismatches through. A policy is one object under
// its own key rather than a row in a synced collection, so it is not in TABLES
// and nothing above looks at it — and it had `alwaysCategories` where the
// column says `always_categories`, and `thresholds` with no column at all, so a
// company's per-document thresholds would have been dropped on the way to the
// server and come back as the base figure for everything.
const policyCols = schema.get('approval_policies') || new Set()
const policySent = [...Object.keys(makeApprovalPolicy({ threshold: 1, alwaysCategories: ['X'] })), 'entity_id']
const policyMissing = policySent.filter((c) => !policyCols.has(c))
ok('every column a policy sends exists', policyMissing.length === 0,
  `no such column: ${policyMissing.join(', ')}`)
ok('including the per-document thresholds', policyCols.has('thresholds'))
ok('and the categories, under the name the column has', policyCols.has('always_categories'))

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
const requiredOf = (table) => requiredColumns(sql, table)
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
    // A quotation's lines are their own table and are lifted out before the
    // parent is sent, the same way the maker check above accounts for them.
    .filter((c) => !c.startsWith('_') && !cols.has(c) && !(NOT_SENT[kind] || []).includes(c))
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
