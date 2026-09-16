// What was certified, against what was measured.
//
// The comparison this app could not make. A running account bill is what the
// contractor claims and a schedule of work is what the engineer measured, and
// they were two tables with nothing between them — so a bill could certify
// thirty lakh of plaster against twenty-two lakh of measured plaster and every
// total in the app would still add up.
//
// The honest limit is worth as much as the check: it only says anything where
// somebody has said which scheduled items an order covers, and where nobody
// has it must say *that* rather than report a hundred per cent gap against a
// measured value of nothing. A check that shouts at every unlinked contract is
// a check that gets ignored on the contracts that matter.
import { certifiedAgainstMeasured, measurementCheck, makeWorkOrder, makeRaBill } from '../../src/lib/subcontract.js'
import { makeWorkItem, makeMeasurement } from '../../src/lib/progress.js'
import { buildSample } from '../../src/lib/sampleSite.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, got, want) => ok(n, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const E = 'e1'
const order = (id, over = {}) => makeWorkOrder({ entityId: E, id, projectId: 'site', contractor: id, orderValue: 3000000, ...over })
const bill = (id, orderId, certified) => makeRaBill({ entityId: E, id, workOrderId: orderId, number: 1, certifiedToDate: certified, claimedToDate: certified, status: 'certified' })
const item = (id, orderId, qty, rate) => makeWorkItem({ entityId: E, id, projectId: 'site', stage: 'plaster', plannedQty: qty, rate, workOrderId: orderId })
const measured = (itemId, qty) => makeMeasurement({ entityId: E, workItemId: itemId, qty })

console.log('\n── THE LINK ITSELF ──')
eq('an item can name the contract that bills it', makeWorkItem({ entityId: E, workOrderId: 'wo1' }).work_order_id, 'wo1')
eq('and one written before there was a link names none', makeWorkItem({ entityId: E }).work_order_id, null)
eq('an empty string is not an id', makeWorkItem({ entityId: E, workOrderId: '' }).work_order_id, null)

console.log('\n── CERTIFIED AHEAD OF THE TAPE ──')
const wo = order('Sai Plastering')
// 4,100 sqm measured at ₹210 is ₹8,61,000 in the ground. He has certified
// ₹9,80,000.
const items = [item('wi1', 'Sai Plastering', 14500, 210)]
const takes = [measured('wi1', 2400), measured('wi1', 1700)]
const c = certifiedAgainstMeasured(wo, [bill('ra1', 'Sai Plastering', 980000)], items, takes)
eq('the order is linked', c.linked, true)
eq('one item is covered', c.items, 1)
eq('what was measured is the quantity times the rate', c.measured, 861000)
eq('against what was certified', c.certified, 980000)
eq('the gap is the difference', c.gap, 119000)
eq('as a share of the work in the ground', c.gapPercent, 13.8)
eq('and it is ahead', c.ahead, true)
eq('which is not behind', c.behind, false)

console.log('\n── A FEW DAYS OF LAG IS NOT A PROBLEM ──')
// The measurement book always trails the bill. Four per cent is a Tuesday.
const small = certifiedAgainstMeasured(wo, [bill('ra1', 'Sai Plastering', 895000)], items, takes)
eq('a small gap is not flagged', small.ahead, false)
eq('though it is still reported', small.gap, 34000)
eq('and a stricter tolerance does flag it',
  certifiedAgainstMeasured(wo, [bill('ra1', 'Sai Plastering', 895000)], items, takes, { tolerance: 2 }).ahead, true)

console.log('\n── AND THE OTHER DIRECTION ──')
// Work in the ground nobody has billed for. On a client contract this is the
// company's own money it has not asked for.
const behind = certifiedAgainstMeasured(wo, [bill('ra1', 'Sai Plastering', 700000)], items, takes)
eq('measured beyond what was certified is behind', behind.behind, true)
eq('which is not ahead', behind.ahead, false)
eq('and the gap is negative', behind.gap, -161000)

console.log('\n── AN ORDER NOBODY LINKED ──')
// The state that must not read as a gap. Measured is null rather than zero,
// because zero is a number and this is an absence.
const loose = certifiedAgainstMeasured(order('Ganesh'), [bill('ra2', 'Ganesh', 5000000)], items, takes)
eq('it is not linked', loose.linked, false)
eq('nothing was measured against it', loose.measured, null)
eq('so there is no gap', loose.gap, null)
eq('and no percentage', loose.gapPercent, null)
eq('it is not ahead', loose.ahead, false)
ok('and it says why', /nothing to measure it against/.test(loose.why), loose.why)
eq('what it certified is still reported', loose.certified, 5000000)

console.log('\n── SEVERAL ITEMS UNDER ONE CONTRACT ──')
const many = certifiedAgainstMeasured(
  wo,
  [bill('ra1', 'Sai Plastering', 980000)],
  [item('wi1', 'Sai Plastering', 14500, 210), item('wi2', 'Sai Plastering', 3000, 180)],
  [...takes, measured('wi2', 500)],
)
eq('both items are counted', many.items, 2)
eq('and both are measured in', many.measured, 951000)
eq('so the gap closes', many.gap, 29000)
eq('and it is no longer ahead', many.ahead, false)
// An item belonging to another contract is not counted into this one.
const notMine = certifiedAgainstMeasured(
  wo,
  [bill('ra1', 'Sai Plastering', 980000)],
  [item('wi1', 'Sai Plastering', 14500, 210), item('wi2', 'Somebody else', 3000, 180)],
  [...takes, measured('wi2', 500)],
)
eq('another contract’s item is left out', notMine.measured, 861000)
ok('so the gap is the one it was', notMine.gap === 119000)

console.log('\n── EVERY CONTRACT AT ONCE ──')
const book = measurementCheck(
  [wo, order('Ganesh'), order('Client', { side: 'client' })],
  [bill('ra1', 'Sai Plastering', 980000), bill('ra2', 'Ganesh', 5000000)],
  items, takes, { entityId: E })
eq('only the linked one is compared', book.count, 1)
eq('and the unlinked one is counted rather than hidden', book.unlinkedCount, 1)
// The client contract is a different side and is not in the subcontract book.
ok('the client contract is on neither list', book.count + book.unlinkedCount === 2)
eq('one contractor is ahead', book.ahead, 1)
eq('by the whole gap', book.aheadBy, 119000)
eq('none is behind', book.behind, 0)
eq('the certified total is of what could be compared', book.certified, 980000)
eq('and so is the measured total', book.measured, 861000)
eq('another company’s contracts are not these',
  measurementCheck([wo], [bill('ra1', 'Sai Plastering', 980000)], items, takes, { entityId: 'e2' }).count, 0)
// Netting an over-biller against an under-biller would report two problems as
// none, so the two totals are kept apart.
const mixed = measurementCheck(
  [wo, order('Under')],
  [bill('ra1', 'Sai Plastering', 980000), bill('ra3', 'Under', 100000)],
  [...items, item('wi3', 'Under', 2000, 300)],
  [...takes, measured('wi3', 1000)],
  { entityId: E })
eq('one ahead', mixed.ahead, 1)
eq('one behind', mixed.behind, 1)
eq('and the two are not netted', mixed.aheadBy, 119000)
eq('each carrying its own figure', mixed.behindBy, 200000)

console.log('\n── AND THE SAMPLE SHOWS IT ──')
const s = buildSample(E)
const sc = measurementCheck(s.workOrders, s.raBills, s.workItems, s.measurements, { entityId: E })
eq('one contract in the demo is priced against the schedule', sc.count, 1)
eq('and it is the plastering', sc.lines[0].order.contractor, 'Sai Plastering Works')
eq('certified ahead of the tape', sc.ahead, 1)
eq('by a figure somebody would ask about', sc.aheadBy, 119000)
// And the caveat is visible in the demo too, which is the point: the check
// covers a quarter of the book and says so.
ok('three contracts name no scheduled item', sc.unlinkedCount === 3, String(sc.unlinkedCount))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
