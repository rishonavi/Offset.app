// The same thing recorded twice.
//
// A site engineer taps Record, the phone is on 2G in a basement lift shaft, and
// nothing visible happens for four seconds. He taps it again. The books now say
// the gang was twice the size it was, with two rows that are individually
// perfect and a total nobody will question.
//
// The line this file is about is the one between a double tap and two gangs.
// Fifteen seconds apart it is a tap; an hour apart it is two gangs of six
// masons at ₹850 on the same site on the same day, which is an ordinary thing
// that happens — and a rule that refused it would have people entering fiction
// to get round the app.
import { contentKey, findRepeat, repeatNote, WINDOW_SECONDS } from '../../src/lib/idempotent.js'
import { makeMuster } from '../../src/lib/labour.js'
import { createEntity, muster, movements, clearCorporate } from '../../src/lib/storage/corporate.js'
import { makeMovement } from '../../src/lib/inventory.js'
import { listAudit } from '../../src/lib/storage/corporate.js'

const map = new Map()
globalThis.localStorage = {
  getItem: (k) => (map.has(k) ? map.get(k) : null),
  setItem: (k, v) => map.set(k, String(v)),
  removeItem: (k) => map.delete(k),
}

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, got, want) => ok(n, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const T = Date.parse('2026-06-15T09:00:00.000Z')
const row = (over = {}) => ({
  id: 'a', entity_id: 'e1', date: '2026-06-15', trade: 'mason', headcount: 6, rate: 850,
  created_at: new Date(T).toISOString(), ...over,
})

console.log('\n── WHAT A ROW ACTUALLY SAYS ──')
eq('two rows with the same content agree', contentKey(row()), contentKey(row({ id: 'b' })))
// The whole point of excluding these: a second tap makes a new id and a new
// timestamp, and neither says anything about what was recorded.
ok('an id does not change what a row says', contentKey(row({ id: 'zzz' })) === contentKey(row()))
ok('nor does when it was written', contentKey(row({ created_at: '2027-01-01T00:00:00.000Z' })) === contentKey(row()))
ok('nor a device’s own bookkeeping', contentKey(row({ _rev: 'x' })) === contentKey(row()))
ok('but a different headcount does', contentKey(row({ headcount: 7 })) !== contentKey(row()))
ok('and a different rate', contentKey(row({ rate: 900 })) !== contentKey(row()))
ok('and a different day', contentKey(row({ date: '2026-06-16' })) !== contentKey(row()))
// Key order is not content. Two objects built by different code paths must
// compare equal or the guard fires at random.
const shuffled = { rate: 850, trade: 'mason', entity_id: 'e1', headcount: 6, date: '2026-06-15', id: 'a', created_at: new Date(T).toISOString() }
eq('the order the keys were written in is not content', contentKey(shuffled), contentKey(row()))
eq('an empty row says nothing', contentKey({}), '')

console.log('\n── A SECOND TAP ──')
const first = row()
const again = row({ id: 'b', created_at: new Date(T + 3000).toISOString() })
ok('three seconds later is the same entry',
  findRepeat(again, [first], { now: T + 3000 })?.id === 'a')
eq('fifteen seconds is the line', WINDOW_SECONDS, 15)
ok('fourteen seconds is still a tap',
  Boolean(findRepeat(row({ id: 'b' }), [first], { now: T + 14000 })))
// And the other side of it, which is the assertion that keeps this honest.
ok('an hour later is two gangs',
  findRepeat(row({ id: 'b' }), [first], { now: T + 3600000 }) === null)
ok('and so is the next morning',
  findRepeat(row({ id: 'b' }), [first], { now: T + 86400000 }) === null)

console.log('\n── AND WHAT IS NOT A REPEAT ──')
ok('a different headcount is a different entry',
  findRepeat(row({ id: 'b', headcount: 7 }), [first], { now: T + 3000 }) === null)
ok('a row is not a repeat of itself',
  findRepeat(first, [first], { now: T + 3000 }) === null)
// Somebody who deleted a line and entered it again meant to, and handing back
// the tombstone would undo the correction.
ok('a deleted row is not handed back',
  findRepeat(row({ id: 'b' }), [{ ...first, deleted_at: '2026-06-15T09:00:01.000Z' }], { now: T + 3000 }) === null)
// A row with no usable timestamp cannot be shown to be recent, and guessing
// that it is would silently drop a legitimate entry.
ok('a row with no timestamp is not assumed recent',
  findRepeat(row({ id: 'b' }), [row({ created_at: '' })], { now: T + 3000 }) === null)
ok('nor one with a timestamp that is not one',
  findRepeat(row({ id: 'b' }), [row({ created_at: 'whenever' })], { now: T + 3000 }) === null)
// A clock ahead of ours is not evidence of anything.
ok('and not one written in the future',
  findRepeat(row({ id: 'b' }), [row({ created_at: new Date(T + 60000).toISOString() })], { now: T }) === null)
ok('the most recent match is the one returned',
  findRepeat(row({ id: 'c' }), [
    row({ id: 'a', created_at: new Date(T).toISOString() }),
    row({ id: 'b', created_at: new Date(T + 5000).toISOString() }),
  ], { now: T + 6000 })?.id === 'b')
ok('and there is a sentence for the screen', /nothing was added twice/.test(repeatNote('muster')), repeatNote('muster'))

console.log('\n── AND THE STORE IS WHAT STOPS IT ──')
// The form is not the control. A second tap reaches the store, and so would a
// retry from anything else that writes.
map.clear()
const actor = { id: 'u1', email: 'a@b.c' }
const company = createEntity({ name: 'Navi Builders' }, actor)
const day = () => makeMuster({ entityId: company.id, date: '2026-06-15', trade: 'mason', headcount: 6, rate: 850 })
const wrote = muster.add(day(), actor)
eq('the first tap is recorded', muster.list(company.id).length, 1)
ok('and it is not marked a repeat', !wrote._repeat)
const second = muster.add(day(), actor)
eq('the second changes nothing', muster.list(company.id).length, 1)
ok('and comes back marked', second._repeat === true)
eq('as the row that was already there', second.id, wrote.id)
// The control has to let a real second entry through, or it is a wall.
eq('a different gang is a different line',
  (muster.add(makeMuster({ entityId: company.id, date: '2026-06-15', trade: 'mason', headcount: 8, rate: 850 }), actor),
    muster.list(company.id).length), 2)
// And across ledgers, because the guard is on the collection and not on one form.
const lorry = () => makeMovement({ entityId: company.id, itemId: 'cement', kind: 'receipt', qty: 400, unitCost: 390, date: '2026-06-15' })
movements.add(lorry(), actor)
movements.add(lorry(), actor)
eq('one lorry, tapped twice, is one lorry', movements.list(company.id).length, 1)
// And the trail says one lorry too. A log recording two things when one
// happened is worse than no log, because somebody will reconcile against it.
eq('the trail records the delivery once',
  listAudit(company.id).filter((a) => a.action === 'movement.create').length, 1)
eq('and the muster twice, because two real gangs went in',
  listAudit(company.id).filter((a) => a.action === 'muster.create').length, 2)
clearCorporate()

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
