// The part that talks: what a pull asks for, what a push sends, and what
// happens when one table fails halfway.
//
// Run against a stub rather than a server, which is the point of the client
// being an argument. What this cannot prove is that the column names match the
// schema — that is what `tests/sql` is for, against a real PostgreSQL — but it
// can prove every decision made around the call.
import { syncCollection, syncAll, TABLES, SYNCED, ORDER } from '../../src/lib/storage/corporateSync.js'
import { touch, isDirty } from '../../src/lib/sync.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${e ? '  — ' + e : ''}`) }
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

const T1 = '2026-03-01T10:00:00.000Z'
const T2 = '2026-03-01T11:00:00.000Z'
const T3 = '2026-03-01T12:00:00.000Z'

// A stub that records what it was asked, so the assertions can be about the
// request and not only the answer.
function stub({ tables = {}, failOn = null } = {}) {
  const calls = []
  const client = {
    from(table) {
      const q = {
        _table: table, _filters: [], _rows: null, _op: 'select',
        select() { calls.push({ op: 'select', table, filters: q._filters }); return q },
        gt(col, val) { q._filters.push(['gt', col, val]); return q },
        in(col, vals) { q._filters.push(['in', col, vals]); return q },
        eq(col, val) { q._filters.push(['eq', col, val]); return q },
        upsert(rows) {
          calls.push({ op: 'upsert', table, rows })
          q._op = 'upsert'; q._rows = rows
          return q
        },
        insert(rows) { calls.push({ op: 'insert', table, rows }); q._op = 'insert'; q._rows = rows; return q },
        delete() { calls.push({ op: 'delete', table, filters: q._filters }); q._op = 'delete'; return q },
        then(resolve) {
          if (failOn === table) return resolve({ data: null, error: new Error(`${table} is unavailable`) })
          if (q._op === 'upsert' || q._op === 'insert') {
            // The server stamps its own version, which is the whole reason the
            // client does not get to.
            return resolve({ data: q._rows.map((r) => ({ ...r, updated_at: T3 })), error: null })
          }
          if (q._op === 'delete') return resolve({ data: [], error: null })
          let rows = tables[table] || []
          for (const [kind, col, val] of q._filters) {
            if (kind === 'gt') rows = rows.filter((r) => String(r[col] || '') > String(val))
            if (kind === 'in') rows = rows.filter((r) => val.includes(r[col]))
            if (kind === 'eq') rows = rows.filter((r) => r[col] === val)
          }
          return resolve({ data: rows, error: null })
        },
      }
      return q
    },
  }
  return { client, calls }
}

console.log('\n── EVERY COLLECTION KNOWS ITS TABLE ──')
// A guessed name that is nearly right fails at run time on somebody else's
// phone, which is the worst place to find out.
ok('every synced collection names a table', SYNCED.every((k) => TABLES[k]))
ok('no two collections share one', new Set(Object.values(TABLES)).size === SYNCED.length)
eq('and everything that syncs is in the order', ORDER.slice().sort(), SYNCED.slice().sort())
// Parents before children, or the server rejects a row pointing at nothing.
ok('companies go before the sites inside them', ORDER.indexOf('entities') < ORDER.indexOf('projects'))
ok('sites before what is issued to them', ORDER.indexOf('projects') < ORDER.indexOf('movements'))
ok('work orders before the bills against them', ORDER.indexOf('workOrders') < ORDER.indexOf('raBills'))
ok('units before their payment plans', ORDER.indexOf('units') < ORDER.indexOf('planStages'))

console.log('\n── A PULL ASKS FOR WHAT IT HAS NOT SEEN ──')
const { client: c1, calls: calls1 } = stub({ tables: { projects: [{ id: 'r1', name: 'From elsewhere', updated_at: T3 }] } })
const seen = [{ id: 'l1', name: 'Known', updated_at: T1, _rev: T1 }]
const first = await syncCollection(c1, 'projects', seen)
const asked = calls1.find((c) => c.op === 'select' && c.table === 'projects')
eq('it asks only for what is newer than the newest it holds',
  asked.filters.find((f) => f[0] === 'gt'), ['gt', 'updated_at', T1])
eq('and takes in what came back', first.pulled, 1)
ok('with the new row present', first.rows.some((r) => r.id === 'r1'))
// A first run has nothing to be newer than, which is what a first run is.
const { client: c2, calls: calls2 } = stub({ tables: { projects: [] } })
await syncCollection(c2, 'projects', [])
ok('a first run asks for everything',
  !calls2.find((c) => c.op === 'select').filters.some((f) => f[0] === 'gt'))

console.log('\n── A PUSH SENDS WHAT IS STILL OURS ──')
const { client: c3, calls: calls3 } = stub({ tables: { projects: [] } })
const mine = [
  { id: 'a', name: 'Unsent', updated_at: T2, _rev: undefined },
  { id: 'b', name: 'Already sent', updated_at: T1, _rev: T1 },
]
const sent = await syncCollection(c3, 'projects', mine)
const push = calls3.find((c) => c.op === 'upsert')
eq('only the unsent row goes', push.rows.map((r) => r.id), ['a'])
// Sending `_rev` would have the database reject the row for a column it does
// not have.
ok('and the device’s own bookkeeping does not go with it',
  push.rows.every((r) => !Object.keys(r).some((k) => k.startsWith('_'))), JSON.stringify(push.rows[0]))
eq('one row was pushed', sent.pushed, 1)
// The bug this nearly shipped with: a pull only carries what changed, so a row
// the server said nothing about must survive it. Reading silence as deletion
// would empty the device on its first sync.
ok('and the row the server said nothing about is still here',
  sent.rows.some((r) => r.id === 'b'), sent.rows.map((r) => r.id).join(','))
eq('nothing was lost', sent.rows.length, 2)
// The server stamps its own version, and taking it back is what makes the row
// read as sent rather than being pushed again for ever.
const after = sent.rows.find((r) => r.id === 'a')
ok('the server’s version comes back on it', after.updated_at === T3 && after._rev === T3)
ok('so it is no longer waiting to go', !isDirty(after))
eq('and nothing is stuck', sent.stuck, 0)

console.log('\n── A CLASH IS CARRIED BACK, NOT SWALLOWED ──')
const { client: c4 } = stub({ tables: { projects: [{ id: 'x', name: 'Theirs', estimate: 9, updated_at: T3 }] } })
const clashed = await syncCollection(c4, 'projects', [{ id: 'x', name: 'Mine', estimate: 5, updated_at: T2, _rev: T1 }])
eq('the clash is reported', clashed.conflicts.length, 1)
eq('naming the row', clashed.conflicts[0].id, 'x')
eq('the server’s version stands', clashed.rows.find((r) => r.id === 'x').estimate, 9)
ok('and the losing version is kept so it can be redone',
  clashed.conflicts[0].mine.estimate === 5)

console.log('\n── A QUOTATION IS ONE ROW HERE AND TWO TABLES THERE ──')
const { client: c5, calls: calls5 } = stub({
  tables: {
    material_quotes: [{ id: 'q1', vendor: 'Shree', updated_at: T3 }],
    material_quote_lines: [{ id: 'ql1', quote_id: 'q1', name: 'Cement', rate: 400 }],
  },
})
const quotes = await syncCollection(c5, 'quotes', [])
eq('its lines are fetched and put back on it', quotes.rows[0].lines.length, 1)
eq('so a screen still reads a quote whole', quotes.rows[0].lines[0].name, 'Cement')
const { client: c6, calls: calls6 } = stub({ tables: { material_quotes: [], material_quote_lines: [] } })
await syncCollection(c6, 'quotes', [{ id: 'q2', vendor: 'Konkan', lines: [{ id: 'l1', name: 'Sand', rate: 4500 }], updated_at: T2 }])
const quotePush = calls6.find((c) => c.op === 'upsert' && c.table === 'material_quotes')
ok('the quote goes without its lines inside it', quotePush.rows[0].lines === undefined)
const linePush = calls6.find((c) => c.op === 'insert' && c.table === 'material_quote_lines')
eq('and the lines go to their own table', linePush.rows[0].name, 'Sand')
eq('pointed at their quote', linePush.rows[0].quote_id, 'q2')
// Replaced wholesale: a quote's lines are written together and read together,
// and reconciling them one by one would be machinery for a case nobody has.
ok('the old lines are cleared first',
  calls6.some((c) => c.op === 'delete' && c.table === 'material_quote_lines'))

console.log('\n── ONE TABLE FAILING DOES NOT STOP THE REST ──')
const store = {
  entities: [{ id: 'e1', name: 'Navi Builders', updated_at: T2 }],
  muster: [{ id: 'm1', date: '2026-03-03', headcount: 14, updated_at: T2 }],
  quotes: [{ id: 'q1', vendor: 'Shree', lines: [], updated_at: T2 }],
}
const { client: c7 } = stub({ tables: {}, failOn: 'material_quotes' })
const read = (kind) => store[kind] || []
const written = {}
const all = await syncAll(c7, read, (kind, rows) => { written[kind] = rows })
eq('the one that failed is named', all.failures.map((f) => f.kind), ['quotes'])
ok('with what it said', /unavailable/.test(all.failures[0].message), all.failures[0].message)
// A company whose quotations will not sync should still get its muster through.
ok('the muster still went', written.muster.every((r) => !isDirty(r)), JSON.stringify(written.muster))
ok('and so did the company', written.entities.every((r) => !isDirty(r)))
ok('the failed collection keeps what the device had', written.quotes === undefined || written.quotes.length === 1)
// A run with a failure in it has not synced, and saying otherwise is the kind
// of reassurance that costs somebody a day.
ok('a run with a failure does not claim to be settled', !all.state.settled)
ok('and says which tables did not go', /quotes/.test(all.state.why), all.state.why)
const { client: c8 } = stub({ tables: {} })
const clean = await syncAll(c8, read, (kind, rows) => { written[kind] = rows })
eq('a clean run reports no failures', clean.failures.length, 0)
ok('and does claim to be settled', clean.state.settled, clean.state.why)
ok('with a time on it', Boolean(clean.at))

console.log('\n── PROGRESS ──')
const seenSteps = []
const { client: c9 } = stub({ tables: {} })
await syncAll(c9, read, () => {}, { onProgress: (p) => seenSteps.push(p) })
eq('every collection reports progress', seenSteps.length, ORDER.length)
eq('counting up to the total', seenSteps[seenSteps.length - 1].done, ORDER.length)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
