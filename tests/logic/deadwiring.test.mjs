// Wiring that goes nowhere.
//
// The highest-yield bug class in this codebase has not been wrong arithmetic.
// It has been things connected at one end: a column the client writes that the
// database does not have, a field a form fills that no report reads, a function
// exported and never called. Every one of them looks right in the file it lives
// in, and three separate audits of this kind produced five real bugs in two
// commits — including the delivery stamp that made a guard against double-
// counting stock fail silently in cloud mode.
//
// Those audits were done by hand, on a good day. This is them on every commit.
//
// It is a **ratchet, not a wall.** Static scanning of a JavaScript codebase
// cannot be exact — a name reached through a computed property or a re-export
// looks dead and is not. So every finding that exists today is written down
// with the reason it is allowed, and the suite fails on two things: a finding
// that is not on the list, and a listed finding that has gone away. The second
// matters as much as the first, or the list rots into a page of excuses for
// code that was cleaned up years ago.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { columnsFromSql, readSql } from '../schema.mjs'
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
import { makeEmployee, makePayrollRun, runPayroll } from '../../src/lib/payroll.js'
import { makeStockCount } from '../../src/lib/stockcount.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const gather = (dir, match) => {
  const out = []
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (match.test(name)) out.push([relative(ROOT, full), readFileSync(full, 'utf8')])
    }
  }
  walk(dir)
  return out
}
const src = gather(join(ROOT, 'src'), /\.(js|jsx)$/)
const tests = gather(join(ROOT, 'tests'), /\.mjs$/)
// Every name below appears in this file's own allowlist, so counting this file
// as usage makes the scan find nothing at all and pass — which is exactly what
// the first run did.
const SELF = relative(ROOT, fileURLToPath(import.meta.url))
const testText = tests.filter(([p]) => p !== SELF).map(([, t]) => t).join('\n')

// A scan that finds no files makes every check below pass, so the inputs are
// asserted before anything is concluded from them.
console.log('\n── THE SCAN CAN SEE ──')
ok('the source was read', src.length > 60, `${src.length} files`)
ok('and the tests', tests.length > 40, `${tests.length} files`)
ok('but not itself, or its own list would read as usage',
  !tests.filter(([p]) => p !== SELF).some(([p]) => p === SELF))
ok('a name that is obviously used is not reported', /\bmakeMovement\b/.test(src.filter(([p]) => !p.endsWith('inventory.js')).map(([, t]) => t).join('\n')))

// ── Exported and called by nothing ──────────────────────────────────
// Reasons, not excuses: each says what it is, so the next person can act.
const UNCALLED = {
  'src/lib/errorLog.js :: clearErrorLog':
    'no screen offers clearing the log yet; the log itself is read in Settings',
  'src/lib/inventory.js :: locationOf':
    'superseded by `store_id || CENTRAL` written out at each site; kept because it is the one place the rule is named',
  'src/lib/marketHours.js :: sessionLabel':
    'the metals screen shows the session state rather than its label',
  'src/lib/metalBill.js :: billNotes':
    'the bill reader fills the holding’s own note field instead',
  'src/lib/metalBill.js :: RATE_BASES':
    'the form offers the two bases inline; this is the list they came from',
  'src/lib/payroll.js :: RUN_STATUS_IDS':
    'the screen walks RUN_STATUS_LABEL; the id list is what the schema check reads',
  'src/lib/reportsCloud.js :: cloudReportsAvailable':
    'the report screen asks `wasDelivered` after the fact rather than asking in advance',
  'src/lib/storage/blobs.js :: nameFrom':
    'attachment names come off the File object directly',
}

const uncalled = []
for (const [file, text] of src) {
  const names = [
    ...[...text.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]),
    ...[...text.matchAll(/^export const (\w+)\s*=/gm)].map((m) => m[1]),
  ]
  const elsewhere = src.filter(([p]) => p !== file).map(([, t]) => t).join('\n')
  for (const name of names) {
    const word = new RegExp(`\\b${name}\\b`)
    if (word.test(elsewhere)) continue
    // Used inside its own file is used. Counted with a global match, because
    // `String.match` without the flag returns one hit and makes everything look
    // dead — which is exactly what the first version of this scan reported.
    if ((text.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length > 1) continue
    if (word.test(testText)) continue
    uncalled.push(`${file} :: ${name}`)
  }
}

console.log('\n── EXPORTED, AND CALLED BY NOTHING ──')
ok('the scan found something to judge', uncalled.length > 0, 'nothing at all, which means it stopped working')
for (const finding of uncalled) {
  ok(`${finding} is known`, Boolean(UNCALLED[finding]), 'new — either wire it up or write down why it is here')
}
for (const known of Object.keys(UNCALLED)) {
  ok(`${known} is still there`, uncalled.includes(known),
    'gone — take it off the list rather than leaving an excuse for code that no longer exists')
}

// ── A column nothing ever writes ────────────────────────────────────
const E = 'aaaaaaaa-0000-0000-0000-000000000001'
const emp = makeEmployee({ entityId: E, id: 'x', name: 'X', basic: 1000 })
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
  employees: emp,
  stockCounts: makeStockCount({ entityId: E, itemId: 'i' }),
  payrollRuns: makePayrollRun({
    entityId: E, period: '2026-03', employees: [emp], run: runPayroll([emp], { period: '2026-03' }),
  }),
}
// The server fills these, or the store adds them on the way past.
const SERVER_FILLS = new Set([
  'id', 'created_at', 'updated_at', 'deleted_at',
  'approval_status', 'approved_by', 'approved_at',
])
const UNWRITTEN = {
  'entities.archived_at': 'written by `archiveEntity`, which replaces the row rather than going through a maker',
  'entities.created_by': 'the founder is the first member, and membership is where that is recorded',
  'inventory_items.opening_qty': 'opening stock has no screen — every balance here is built from movements',
  'inventory_items.opening_value': 'the same: an opening balance would be a movement like any other',
  'inventory_movements.value': 'value is derived per store at that store’s average, never stored',
  'advances.party_kind': 'renamed to `party_type` by a guarded ALTER further down the file, which this parser cannot see',
  'advances.note': 'an advance carries `purpose`; this is the older spelling and nothing writes it',
  'employees.basic': 'pay moved into one `pay` object; the four flat columns are what it moved out of',
  'employees.hra': 'see employees.basic',
  'employees.allowances': 'see employees.basic',
  'employees.pf_on_actual': 'see employees.basic',
}

const schema = columnsFromSql(readSql())
const unwritten = []
for (const kind of SYNCED) {
  const cols = schema.get(TABLES[kind]) || new Set()
  const sent = new Set(Object.keys(MADE[kind]))
  for (const col of cols) {
    if (sent.has(col) || SERVER_FILLS.has(col)) continue
    unwritten.push(`${TABLES[kind]}.${col}`)
  }
}

console.log('\n── A COLUMN NOTHING EVER WRITES ──')
// The other half of the wire check. That one asks whether every column the
// client sends exists; this asks whether every column that exists is ever sent —
// and a column nobody writes is either a feature that was never finished or a
// rename that left its old name behind.
ok('the schema was read', schema.size > 20, `${schema.size} tables`)
ok('and something was found to judge', unwritten.length > 0, 'nothing, which means the scan stopped working')
for (const finding of unwritten) {
  ok(`${finding} is known`, Boolean(UNWRITTEN[finding]),
    'new — either something writes it and this cannot see it, or nothing does')
}
for (const known of Object.keys(UNWRITTEN)) {
  ok(`${known} is still unwritten`, unwritten.includes(known),
    'something writes it now, or it is gone — take it off the list')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
