// A month that has been closed, and what that has to mean.
//
// Every report in this app is a photograph of a moving thing. Somebody prints
// March, sends it to the bank, and a fortnight later a bill dated the 28th of
// March is entered — not dishonestly, just late — and March is now a different
// number from the one in the bank's file. Nothing in the app had any idea March
// was ever finished.
//
// The assertions worth reading are about where the rule lives. A control
// enforced by a disabled field is not a control: an import, a second screen and
// a restored backup all reach the store directly, so the store is what refuses.
import {
  monthOf, nextMonth, prevMonth, lockedThrough, isLockedOn,
  checkPeriod, monthsToClose, nextToClose, reopenTo, describeLock,
} from '../../src/lib/periods.js'
import { makeEntity } from '../../src/lib/corporate.js'
import { createEntity, updateEntity, movements, muster, workOrders, clearCorporate } from '../../src/lib/storage/corporate.js'
import { makeMovement } from '../../src/lib/inventory.js'
import { makeMuster } from '../../src/lib/labour.js'
import { makeWorkOrder } from '../../src/lib/subcontract.js'

const map = new Map()
globalThis.localStorage = {
  getItem: (k) => (map.has(k) ? map.get(k) : null),
  setItem: (k, v) => map.set(k, String(v)),
  removeItem: (k) => map.delete(k),
}

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, got, want) => ok(n, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const closed = (m) => ({ id: 'e1', books_locked_through: m })

console.log('\n── MONTHS ──')
eq('a date is in a month', monthOf('2026-06-28'), '2026-06')
eq('a month is its own month', monthOf('2026-06'), '2026-06')
eq('nothing is in no month', monthOf(''), null)
eq('and neither is a thirteenth one', monthOf('2026-13-01'), null)
eq('December is followed by January', nextMonth('2026-12'), '2027-01')
eq('and preceded by November', prevMonth('2026-12'), '2026-11')
eq('January is preceded by the December before', prevMonth('2026-01'), '2025-12')
eq('a month that is not one has no next', nextMonth('nonsense'), null)

console.log('\n── WHAT COUNTS AS CLOSED ──')
eq('a month reads as a lock', lockedThrough(closed('2026-06')), '2026-06')
eq('nothing is not a lock', lockedThrough({}), null)
// Read strictly in both directions. A half-written value must not close the
// books by accident and must not leave them open by accident either.
eq('a thirteenth month is not a lock', lockedThrough(closed('2026-13')), null)
eq('and neither is a word', lockedThrough(closed('yes')), null)
eq('nor a date', lockedThrough(closed('2026-06-01')), null)
eq('the maker keeps a real one', makeEntity({ name: 'X', booksLockedThrough: '2026-06' }).books_locked_through, '2026-06')
eq('and refuses a fake one', makeEntity({ name: 'X', booksLockedThrough: '2026-13' }).books_locked_through, null)
eq('a new company has closed nothing', makeEntity({ name: 'X' }).books_locked_through, null)

console.log('\n── WHAT MAY BE WRITTEN ──')
const e = closed('2026-06')
eq('the last day of a closed month is closed', checkPeriod(e, '2026-06-30').ok, false)
eq('and the first', checkPeriod(e, '2026-06-01').ok, false)
eq('an earlier month is closed too', checkPeriod(e, '2025-01-01').ok, false)
eq('the month after is open', checkPeriod(e, '2026-07-01').ok, true)
// The sentence is half the feature. "Refused" on its own is a bug report.
ok('and the refusal says what to do', /Reopen them/.test(checkPeriod(e, '2026-06-30').why), checkPeriod(e, '2026-06-30').why)
ok('naming the month it is closed through', /2026-06/.test(checkPeriod(e, '2026-06-30').why))
// A row with no date is not an entry in a period. Refusing those would close
// the company rather than its books.
eq('a row with no date is never in a closed month', checkPeriod(e, '').ok, true)
eq('nor is one with a date that is not one', checkPeriod(e, 'someday').ok, true)
eq('with nothing closed, everything is open', checkPeriod({}, '1999-01-01').ok, true)
eq('the shorthand agrees', isLockedOn(e, '2026-06-15'), true)
eq('both ways', isLockedOn(e, '2026-07-15'), false)

console.log('\n── WHAT COULD BE CLOSED NOW ──')
// The current month is never offered: it is not over, and closing it would
// refuse entries for work being done today.
const open = monthsToClose(closed('2026-06'), '2026-09-16')
eq('two finished months are open', open.length, 2)
eq('starting the month after the lock', open[0], '2026-07')
eq('and ending with the month just gone', open[1], '2026-08')
ok('this month is not offered', !open.includes('2026-09'))
eq('the next one to close is the earliest', nextToClose(closed('2026-06'), '2026-09-16'), '2026-07')
// A company that has closed nothing is offered one month, not eleven years of
// buttons.
eq('with nothing closed, only the month just gone is offered', monthsToClose({}, '2026-09-16').join(','), '2026-08')
eq('a company already up to date has nothing to close', monthsToClose(closed('2026-08'), '2026-09-16').length, 0)
// And one somehow closed into the future is not offered a negative list.
eq('nor has one closed ahead of itself', monthsToClose(closed('2027-01'), '2026-09-16').length, 0)

console.log('\n── REOPENING IS A STEP BACKWARDS ──')
eq('reopening June leaves the books closed through May', reopenTo(closed('2026-06')), '2026-05')
eq('and reopening January the December before', reopenTo(closed('2026-01')), '2025-12')
eq('there is nothing to reopen when nothing is closed', reopenTo({}), null)
// The honest consequence: July and August come back with it, because a month
// cannot be final while the month before it is being edited.
const after = { books_locked_through: reopenTo(closed('2026-08')) }
eq('reopening August reopens August', checkPeriod(after, '2026-08-15').ok, true)
eq('and leaves July closed', checkPeriod(after, '2026-07-15').ok, false)

console.log('\n── SAID IN A SENTENCE ──')
ok('a company that has never closed is told so',
  /never been closed/.test(describeLock({}, '2026-09-16')), describeLock({}, '2026-09-16'))
ok('one up to date is told nothing older can change',
  /Nothing older can change/.test(describeLock(closed('2026-08'), '2026-09-16')), describeLock(closed('2026-08'), '2026-09-16'))
ok('one month behind is named',
  /2026-08 is finished and still open/.test(describeLock(closed('2026-07'), '2026-09-16')), describeLock(closed('2026-07'), '2026-09-16'))
ok('several are counted',
  /2 finished months/.test(describeLock(closed('2026-06'), '2026-09-16')), describeLock(closed('2026-06'), '2026-09-16'))

console.log('\n── AND THE STORE IS WHAT REFUSES ──')
// The assertion the whole feature rests on. A control enforced by a disabled
// field is not a control: an import, a second screen and a restored backup all
// reach the store directly, and none of them looks at a button.
map.clear()
const actor = { id: 'u1', email: 'a@b.c' }
const company = createEntity({ name: 'Navi Builders' }, actor)
const threw = (fn) => { try { fn(); return null } catch (err) { return err.message } }

// Open books first: the control has to let the ordinary case through, or it is
// not a control, it is a wall.
ok('with nothing closed, a movement saves',
  threw(() => movements.add(makeMovement({ entityId: company.id, itemId: 'i', kind: 'receipt', qty: 1, unitCost: 1, date: '2026-06-15' }), actor)) === null)
eq('and it is there', movements.list(company.id).length, 1)

updateEntity(company.id, { books_locked_through: '2026-06' }, actor)
const refusal = threw(() => movements.add(makeMovement({ entityId: company.id, itemId: 'i', kind: 'receipt', qty: 1, unitCost: 1, date: '2026-06-20' }), actor))
ok('once closed, a movement dated into it is refused', refusal !== null, 'it saved')
ok('with the reason on the error', /closed through 2026-06/.test(refusal || ''), refusal)
eq('and nothing was written', movements.list(company.id).length, 1)
ok('a later month still saves',
  threw(() => movements.add(makeMovement({ entityId: company.id, itemId: 'i', kind: 'receipt', qty: 1, unitCost: 1, date: '2026-07-02' }), actor)) === null)
eq('so the ledger grew by one', movements.list(company.id).length, 2)
// Every dated ledger, not only the one that was tried first.
ok('a muster roll in a closed month is refused too',
  threw(() => muster.add(makeMuster({ entityId: company.id, date: '2026-05-01', trade: 'mason', headcount: 4, rate: 800 }), actor)) !== null)
// And the rows that carry no date are untouched: refusing those would close the
// company rather than its books.
ok('a work order, which is not dated, still saves',
  threw(() => workOrders.add(makeWorkOrder({ entityId: company.id, contractor: 'Ganesh' }), actor)) === null)

console.log('\n── AND IT REFUSES BOTH ENDS OF A MOVE ──')
const inside = movements.list(company.id)[0]
ok('editing a row already in a closed month is refused',
  threw(() => movements.update(inside.id, { qty: 99 }, actor)) !== null)
ok('and so is deleting it',
  threw(() => movements.remove(inside.id, actor)) !== null)
const outside = movements.list(company.id).find((m) => m.date === '2026-07-02')
// The half a one-sided check would miss: redating an open row into a closed
// month restates that month just as surely.
ok('and so is redating an open row into a closed month',
  threw(() => movements.update(outside.id, { date: '2026-06-10' }, actor)) !== null)
ok('though moving it within the open months is fine',
  threw(() => movements.update(outside.id, { date: '2026-08-10' }, actor)) === null)
eq('and it moved', movements.list(company.id).find((m) => m.id === outside.id).date, '2026-08-10')

console.log('\n── REOPENING LETS IT THROUGH AGAIN ──')
updateEntity(company.id, { books_locked_through: reopenTo({ books_locked_through: '2026-06' }) }, actor)
ok('the same write now succeeds',
  threw(() => movements.add(makeMovement({ entityId: company.id, itemId: 'i', kind: 'receipt', qty: 1, unitCost: 1, date: '2026-06-20' }), actor)) === null)
// And May is still shut, because reopening June only went back to May.
ok('but the month before it is still closed',
  threw(() => muster.add(makeMuster({ entityId: company.id, date: '2026-05-01', trade: 'mason', headcount: 4, rate: 800 }), actor)) !== null)
clearCorporate()

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
