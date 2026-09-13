// The same books on four phones and a laptop.
//
// The assertion worth reading is the one where two people edit the same site
// and neither of them loses an afternoon. Last-write-wins would pass a shorter
// test and be the wrong answer: it is the rule under which somebody's work
// disappears and nobody finds out until a total is wrong.
import {
  isDirty, touch, accepted, toPush, reconcile, describeConflict,
  mergePull, duplicates, hasSignature, syncState, isAppendOnly, APPEND_ONLY,
} from '../../src/lib/sync.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${e ? '  — ' + e : ''}`) }
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

const T1 = '2026-03-01T10:00:00.000Z'
const T2 = '2026-03-01T11:00:00.000Z'
const T3 = '2026-03-01T12:00:00.000Z'

console.log('\n── SENT, OR NOT ──')
// One derived flag beats two stored ones, because two stored ones can disagree.
ok('a row made here has never been sent', isDirty({ id: 'a', updated_at: T1 }))
ok('a row just pulled has been', !isDirty({ id: 'a', updated_at: T1, _rev: T1 }))
ok('and editing it makes it unsent again', isDirty({ id: 'a', updated_at: T2, _rev: T1 }))
ok('touching a row moves its clock', isDirty(touch({ id: 'a', updated_at: T1, _rev: T1 })))
// A version never repeats. Milliseconds are coarse enough that creating a row
// and correcting it immediately lands both in the same one, and two versions
// carrying the same stamp are two versions nothing can tell apart.
const first = touch({ id: 'a' })
const second = touch(first)
ok('two writes in the same instant get different versions', second.updated_at > first.updated_at,
  `${first.updated_at} → ${second.updated_at}`)
const third = touch(second)
ok('and a third keeps going forward', third.updated_at > second.updated_at)
ok('a stamp from the future is not rewound',
  touch({ id: 'a', updated_at: '2099-01-01T00:00:00.000Z' }).updated_at > '2099-01-01T00:00:00.000Z')
const ack = accepted({ id: 'a', updated_at: T1 }, T2)
ok('accepting it settles both timestamps', !isDirty(ack) && ack.updated_at === T2 && ack._rev === T2)
eq('only the unsent rows go out',
  toPush([{ id: 'a', updated_at: T1, _rev: T1 }, { id: 'b', updated_at: T2 }]).map((r) => r.id), ['b'])
eq('nothing to send is nothing', toPush([]).length, 0)

console.log('\n── WHICH VERSION SURVIVES ──')
eq('a row only the server has arrives', reconcile(null, { id: 'a', updated_at: T1 }).take, 'remote')
eq('a row only this device has is ours to send', reconcile({ id: 'a', updated_at: T1 }, null).take, 'local')
eq('with nothing of ours at stake the server is simply newer news',
  reconcile({ id: 'a', updated_at: T1, _rev: T1 }, { id: 'a', updated_at: T2 }).take, 'remote')
// Unsent here and untouched there: this is the next version, not a clash.
eq('our unsent edit goes out when nobody else moved',
  reconcile({ id: 'a', updated_at: T2, _rev: T1 }, { id: 'a', updated_at: T1 }).take, 'local')
ok('and that is not a conflict',
  !reconcile({ id: 'a', updated_at: T2, _rev: T1 }, { id: 'a', updated_at: T1 }).conflict)

// The case the whole design is for.
const clash = reconcile({ id: 'a', updated_at: T2, _rev: T1 }, { id: 'a', updated_at: T3 })
eq('when both moved, the one that got there first stands', clash.take, 'remote')
ok('and it is reported as a clash rather than swallowed', clash.conflict)
ok('with a reason a person can read', /first/.test(clash.reason), clash.reason)
eq('two absences are nothing at all', reconcile(null, null).take, 'none')

console.log('\n── WHAT THE LOSER IS TOLD ──')
// Not a diff of everything: a row has thirty fields and two of them moved.
const mine = { id: 's1', name: 'Marine Drive Tower', estimate: 12000000, status: 'active', updated_at: T2, _rev: T1, created_at: T1 }
const theirs = { id: 's1', name: 'Marine Drive Tower', estimate: 8000000, status: 'onHold', updated_at: T3 }
const told = describeConflict(mine, theirs, { kind: 'projects' })
eq('only what actually differs is listed', told.fields.map((f) => f.field).sort(), ['estimate', 'status'])
eq('showing what this device said', told.fields.find((f) => f.field === 'estimate').mine, 12000000)
eq('and what it says now', told.fields.find((f) => f.field === 'estimate').theirs, 8000000)
ok('the unchanged name is not in it', !told.fields.some((f) => f.field === 'name'))
ok('nor is the plumbing', !told.fields.some((f) => f.field.startsWith('_') || f.field === 'updated_at'))
eq('it is labelled so a person knows which one', told.label, 'Marine Drive Tower')
// Kept whole so the edit can be re-applied rather than retyped from a list.
eq('and the losing version is kept entire', told.mine.estimate, 12000000)

console.log('\n── APPLYING WHAT THE SERVER SENT ──')
const local = [
  { id: 'a', name: 'Untouched', updated_at: T1, _rev: T1 },
  { id: 'b', name: 'Edited here', updated_at: T2, _rev: T1 },
  { id: 'c', name: 'Made here, never sent', updated_at: T2 },
  { id: 'd', name: 'Edited both places', estimate: 5, updated_at: T2, _rev: T1 },
]
const remote = [
  { id: 'a', name: 'Untouched, changed there', updated_at: T3 },
  { id: 'b', name: 'Edited here', updated_at: T1 },
  { id: 'd', name: 'Edited both places', estimate: 9, updated_at: T3 },
  { id: 'e', name: 'New from elsewhere', updated_at: T3 },
]
const merged = mergePull(local, remote, { kind: 'projects' })
const find = (id) => merged.rows.find((r) => r.id === id)
eq('everything is still here', merged.rows.length, 5)
eq('a row nobody touched here takes the server’s version', find('a').name, 'Untouched, changed there')
ok('and is marked as sent', !isDirty(find('a')))
eq('our unsent edit survives the pull', find('b').name, 'Edited here')
ok('and is still waiting to go', isDirty(find('b')))
eq('a row made here and never sent is not dropped', find('c').name, 'Made here, never sent')
eq('a row from elsewhere arrives', find('e').name, 'New from elsewhere')
// First write wins, and the loser is told.
eq('the row both places changed takes the server’s', find('d').estimate, 9)
eq('and exactly one clash is reported', merged.conflicts.length, 1)
eq('naming the row', merged.conflicts[0].id, 'd')
eq('and what this device had said', merged.conflicts[0].fields.find((f) => f.field === 'estimate').mine, 5)
eq('two things are still waiting to go out', merged.pending, 2)
eq('and one change was taken in', merged.applied, 3)

// What an absent row means, which is the one thing here that is catastrophic to
// get wrong. An incremental pull carries only what changed, so silence about a
// row means nothing happened to it — treating that as a deletion would empty
// the device on its first sync.
const quiet = mergePull(
  [{ id: 'x', updated_at: T1, _rev: T1 }, { id: 'y', updated_at: T1 }],
  [], { kind: 'projects' },
)
eq('an incremental pull that mentions nothing deletes nothing', quiet.rows.map((r) => r.id).sort(), ['x', 'y'])
// A full snapshot is the whole truth, so silence there does mean gone — and
// deletions otherwise travel as tombstones, which is what deleted_at is for.
const gone = mergePull(
  [{ id: 'x', updated_at: T1, _rev: T1 }, { id: 'y', updated_at: T1 }],
  [], { kind: 'projects', full: true },
)
eq('a full snapshot drops what it did not mention', gone.rows.map((r) => r.id), ['y'])
ok('but not something this device has never sent', gone.rows[0].id === 'y')
// A tombstone is a row, so it arrives like any other change.
const buried = mergePull(
  [{ id: 'z', name: 'Here', updated_at: T1, _rev: T1 }],
  [{ id: 'z', name: 'Here', deleted_at: T3, updated_at: T3 }],
  { kind: 'projects' },
)
ok('a deletion arrives as a tombstone', Boolean(buried.rows[0].deleted_at))
eq('an empty pull against an empty device is empty', mergePull([], []).rows.length, 0)

console.log('\n── CREATIONS DO NOT CLASH ──')
// Ids are made on the device, so two people adding Tuesday's muster produce two
// rows and both are kept. The hazard is not a clash, it is a duplicate.
const twoPeople = mergePull(
  [{ id: 'local-made', date: '2026-03-03', updated_at: T2 }],
  [{ id: 'other-made', date: '2026-03-03', updated_at: T2 }],
  { kind: 'muster' },
)
eq('both survive', twoPeople.rows.length, 2)
eq('and neither is a conflict', twoPeople.conflicts.length, 0)

console.log('\n── THE SAME DAY ENTERED TWICE ──')
ok('the append-only ledgers are the ones that get re-entered',
  isAppendOnly('muster') && isAppendOnly('plantLogs') && isAppendOnly('measurements'))
ok('and the documents are not', !isAppendOnly('projects') && !isAppendOnly('units'))
eq('every append-only ledger knows what makes two rows the same event',
  [...APPEND_ONLY].filter((k) => !hasSignature(k)), [])

const muster = [
  { id: 'm1', date: '2026-03-03', trade: 'mason', project_id: 's1', headcount: 14, rate: 800, created_at: T1 },
  { id: 'm2', date: '2026-03-03', trade: 'mason', project_id: 's1', headcount: 14, rate: 800, created_at: T2 },
  { id: 'm3', date: '2026-03-03', trade: 'helper', project_id: 's1', headcount: 22, rate: 500, created_at: T1 },
]
const dupes = duplicates(muster, 'muster')
eq('the day entered twice is found', dupes.length, 1)
eq('and says how many there are', dupes[0].count, 2)
// The first one entered is the one to keep, on the grounds that the later one
// is the re-entry.
eq('keeping the one entered first', dupes[0].keep.id, 'm1')
eq('and offering the other', dupes[0].others[0].id, 'm2')
ok('a different trade on the same day is not a duplicate',
  !dupes.some((d) => d.keep.id === 'm3' || d.others.some((o) => o.id === 'm3')))
eq('a deleted row is not somebody’s duplicate',
  duplicates([...muster.slice(0, 1), { ...muster[1], deleted_at: T3 }], 'muster').length, 0)
// A signature of nothing matches every other empty row, which would report a
// screenful of nonsense on a half-filled ledger.
eq('rows with nothing filled in are not all duplicates of each other',
  duplicates([{ id: 'e1' }, { id: 'e2' }], 'muster').length, 0)
eq('two RA bills numbered the same on one order are a duplicate',
  duplicates([
    { id: 'b1', work_order_id: 'w1', number: 2, created_at: T1 },
    { id: 'b2', work_order_id: 'w1', number: 2, created_at: T2 },
    { id: 'b3', work_order_id: 'w1', number: 3, created_at: T2 },
  ], 'raBills').length, 1)
eq('a ledger with no signature reports none', duplicates(muster, 'projects').length, 0)

console.log('\n── WHAT A PERSON IS SHOWN ──')
const clean = syncState({ collections: { projects: [{ id: 'a', updated_at: T1, _rev: T1 }] }, lastSyncedAt: T3 })
ok('everything sent says so', clean.settled)
ok('in words', /up to date/.test(clean.why), clean.why)
const behind = syncState({ collections: { projects: [{ id: 'a', updated_at: T2, _rev: T1 }] }, lastSyncedAt: T1 })
eq('unsent changes are counted', behind.pending, 1)
// "Synced" with three unsent rows behind it is the kind of reassurance that
// costs somebody a day's work.
ok('and it does not claim to be settled', !behind.settled)
ok('offline says so rather than looking broken',
  /Offline/.test(syncState({ collections: {}, online: false }).why))
ok('offline with work waiting says both',
  /Offline.*waiting/.test(syncState({ collections: { muster: [{ id: 'a', updated_at: T2 }] }, online: false }).why))
const failing = syncState({ collections: {}, error: 'the server said no' })
ok('an error is shown as itself', /server said no/.test(failing.why))
ok('and is never called settled', !failing.settled)
const withDupes = syncState({ collections: { muster } })
eq('duplicates are surfaced alongside', withDupes.duplicateCount, 1)
eq('never synced says that rather than up to date',
  syncState({ collections: {} }).why, 'Not synced yet.')

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
