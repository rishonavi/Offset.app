// When the retention comes back, and whose money it is.
//
// `retention_released` was always a single running total. A single running
// total cannot answer the question a contractor actually asks — "when do I get
// the rest?" — because retention returns in two pieces months apart, and a
// number with no date attached to it cannot be due.
//
// Two things are worth breaking deliberately here. The allocation rule: money
// released fills the completion tranche before the defects tranche, and any
// other rule makes a company that paid the first half look as though it still
// owes it. And the side: work certified to a client is revenue, so a client
// order that reached `subcontractCostsBySite` would book the company's own
// income as money it spent — which is the one mistake this file exists to make
// impossible.
import {
  makeWorkOrder, makeRaBill, billLadder, retentionSchedule, retentionBook,
  subcontractReport, subcontractCostsBySite, clientContracts,
  addMonths, sideOf, SIDE, SIDE_IDS, TRANCHES,
} from '../../src/lib/subcontract.js'
import { buildSample } from '../../src/lib/sampleSite.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, got, want) => ok(n, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const E = 'e1'
const order = (over = {}) => makeWorkOrder({ entityId: E, contractor: 'Ram Builders', orderValue: 1000000, retentionPercent: 5, tdsPercent: 1, ...over })
const bill = (o, number, certified, over = {}) =>
  makeRaBill({ workOrderId: o.id, entityId: E, number, certifiedToDate: certified, claimedToDate: certified, ...over })

console.log('\n── MONTH ARITHMETIC THAT DOES NOT INVENT A DATE ──')
eq('twelve months on is a year on', addMonths('2025-06-30', 12), '2026-06-30')
eq('six months crosses the year end', addMonths('2025-10-15', 6), '2026-04-15')
// The one that goes wrong by hand: there is no 31st of April.
eq('a month too short is clamped to its last day', addMonths('2026-01-31', 1), '2026-02-28')
eq('and a leap February has one more', addMonths('2024-01-31', 1), '2024-02-29')
eq('thirty-one to a thirty-day month', addMonths('2026-03-31', 1), '2026-04-30')
eq('zero months is the same day', addMonths('2026-03-15', 0), '2026-03-15')
eq('twenty-four months is two years', addMonths('2025-02-28', 24), '2027-02-28')
eq('nothing in gives nothing out', addMonths('', 12), '')
eq('and so does a date that is not one', addMonths('not a date', 12), '')
eq('a partial date is not a date', addMonths('2026-03', 12), '')

console.log('\n── THE TWO TRANCHES ──')
const o1 = order({ completedOn: '2025-06-30', dlpMonths: 12 })
const bills1 = [bill(o1, 1, 200000), bill(o1, 2, 500000)]
const l1 = billLadder(o1, bills1)
eq('retention accrued across both bills', l1.retentionAccrued, 25000)
const s1 = retentionSchedule(o1, l1, { asOf: '2026-01-15' })
eq('two tranches, always', s1.tranches.length, 2)
eq('half at completion', s1.tranches[0].amount, 12500)
eq('half after the defect liability period', s1.tranches[1].amount, 12500)
eq('completion is dated the day the work finished', s1.tranches[0].dueOn, '2025-06-30')
eq('and the second a year after that', s1.tranches[1].dueOn, '2026-06-30')
eq('the first has fallen due', s1.tranches[0].state, 'due')
eq('the second has not', s1.tranches[1].state, 'waiting')
eq('due says how much, not how many', s1.due, 12500)
eq('and waiting is the rest', s1.waiting, 12500)
eq('overdue is counted in days', s1.tranches[0].overdueDays, 199)
eq('a tranche that has not fallen due is not overdue by a negative number', s1.tranches[1].overdueDays, 0)
eq('the labels come from one place', s1.tranches[0].label, TRANCHES.completion.label)

console.log('\n── WHAT WAS RELEASED FILLS THE EARLIER TRANCHE FIRST ──')
// The rule that had to be decided rather than read. Anything else reports a
// company that has paid the first half as though it still owed it.
const half = retentionSchedule(order({ completedOn: '2025-06-30', retentionReleased: 12500 }),
  { ...l1, retentionReleased: 12500 }, { asOf: '2026-01-15' })
eq('the completion half is settled', half.tranches[0].state, 'released')
eq('nothing of it is left', half.tranches[0].outstanding, 0)
eq('and the defects half is untouched', half.tranches[1].outstanding, 12500)
eq('so nothing is due', half.due, 0)

const part = retentionSchedule(o1, { ...l1, retentionReleased: 20000 }, { asOf: '2026-01-15' })
eq('a release past the first tranche spills into the second', part.tranches[1].released, 7500)
eq('leaving the remainder', part.tranches[1].outstanding, 5000)
eq('the first is still fully settled', part.tranches[0].outstanding, 0)

const all = retentionSchedule(o1, { ...l1, retentionReleased: 25000 }, { asOf: '2027-01-15' })
eq('everything released settles both', all.held, 0)
ok('and neither is due', all.due === 0 && all.waiting === 0)

console.log('\n── MORE GIVEN BACK THAN WAS EVER HELD ──')
// Capping in silence would make this disappear into a balance of zero. It is
// an arithmetic mistake and it is reported as one.
const over = retentionSchedule(o1, { ...l1, retentionReleased: 30000 }, { asOf: '2027-01-15' })
eq('the excess is named', over.overReleased, 5000)
eq('the balance held does not go negative', over.held, 0)
eq('and the releases counted stop at what was accrued', over.released, 25000)
eq('an ordinary order has no excess', s1.overReleased, 0)

console.log('\n── RETENTION WITH NO RELEASE DATE ──')
// Undated is its own answer. Calling it "waiting" would imply a day is coming.
const und = retentionSchedule(order(), l1, { asOf: '2026-01-15' })
eq('both tranches are undated', und.tranches.map((t) => t.state).join(','), 'undated,undated')
eq('all of it is undated money', und.undated, 25000)
eq('none of it is due', und.due, 0)
eq('and none of it is waiting', und.waiting, 0)
// A completion date alone dates both, because the second is counted from it.
const dated = retentionSchedule(order({ completedOn: '2026-01-01' }), l1, { asOf: '2026-01-15' })
eq('a completion date dates both tranches', dated.undated, 0)

console.log('\n── THE SPLIT ──')
const noneFirst = retentionSchedule(order({ completedOn: '2025-06-30', releaseSplitPercent: 0 }), l1, { asOf: '2026-01-15' })
eq('nothing at completion means an empty first tranche', noneFirst.tranches[0].amount, 0)
eq('which is not "released" and not "due"', noneFirst.tranches[0].state, 'none')
eq('the whole of it waits for the defect period', noneFirst.tranches[1].amount, 25000)
const allFirst = retentionSchedule(order({ completedOn: '2025-06-30', releaseSplitPercent: 100 }), l1, { asOf: '2026-01-15' })
eq('all at completion leaves nothing for later', allFirst.tranches[1].amount, 0)
eq('and all of it is due', allFirst.due, 25000)
// The remainder rather than the complementary percentage, so a rounding
// difference cannot lose a paisa between the two.
const odd = billLadder(order({ completedOn: '2025-06-30' }), [bill(o1, 1, 100001)])
const oddSched = retentionSchedule(order({ completedOn: '2025-06-30' }), { ...odd, retentionAccrued: 5000.05 }, { asOf: '2026-01-15' })
eq('the two tranches add to the accrual exactly',
  Math.round((oddSched.tranches[0].amount + oddSched.tranches[1].amount) * 100) / 100, 5000.05)

console.log('\n── A THIRTY-SIX MONTH LIABILITY IS NOT A TWELVE MONTH ONE ──')
const long = retentionSchedule(order({ completedOn: '2025-06-30', dlpMonths: 24 }), l1, { asOf: '2026-01-15' })
eq('the period is read from the order', long.tranches[1].dueOn, '2027-06-30')
const short = retentionSchedule(order({ completedOn: '2025-06-30', dlpMonths: 0 }), l1, { asOf: '2026-01-15' })
eq('no defect liability at all releases on the same day', short.tranches[1].dueOn, '2025-06-30')
eq('so all of it is due', short.due, 25000)

console.log('\n── THE TWO SIDES ──')
eq('a side is one of two', SIDE_IDS.join(','), 'sub,client')
eq('an order written before there were sides is a subcontract', sideOf({}), 'sub')
eq('and so is one with a side nobody recognises', sideOf({ side: 'nonsense' }), 'sub')
eq('a subcontract is a cost', SIDE.sub.cost, true)
eq('a client contract is not', SIDE.client.cost, false)
eq('the maker defaults to the subcontract', makeWorkOrder({ entityId: E }).side, 'sub')
eq('and keeps a client one', makeWorkOrder({ entityId: E, side: 'client' }).side, 'client')
eq('and refuses a third', makeWorkOrder({ entityId: E, side: 'principal' }).side, 'sub')

const sub = order({ projectId: 'p1' })
const client = order({ projectId: 'p1', side: 'client', contractor: 'Metro Development Authority' })
const mixed = [sub, client]
const mixedBills = [bill(sub, 1, 400000), bill(client, 1, 900000)]

eq('the report is the subcontracts by default', subcontractReport(mixed, mixedBills, { entityId: E }).count, 1)
eq('and it is the subcontract that is in it',
  subcontractReport(mixed, mixedBills, { entityId: E }).lines[0].order.contractor, 'Ram Builders')
eq('the client side is asked for by name', clientContracts(mixed, mixedBills, { entityId: E }).count, 1)
eq('and reads as revenue', clientContracts(mixed, mixedBills, { entityId: E }).revenue, 900000)
eq('both together when the side is waived', subcontractReport(mixed, mixedBills, { entityId: E, side: null }).count, 2)

console.log('\n── AND A CLIENT CONTRACT IS NEVER A COST ──')
// The mistake worth an assertion of its own. The control is beside it: the
// subcontract on the same site, in the same call, must still be counted.
const costs = subcontractCostsBySite(mixed, mixedBills, { entityId: E })
eq('the site is costed at the subcontract only', costs.p1, 400000)
ok('which is not the client contract', costs.p1 !== 900000)
ok('nor the two added together', costs.p1 !== 1300000)
// And it stays that way even when a caller asks for the other side, because
// the answer to "what did our own billing cost us" is not a number.
const forced = subcontractCostsBySite(mixed, mixedBills, { entityId: E, side: 'client' })
eq('a caller cannot ask for the client side as a cost', forced.p1, 400000)

console.log('\n── EVERY ORDER’S RETENTION AT ONCE ──')
const book = retentionBook(mixed, mixedBills, { entityId: E, side: 'sub', asOf: '2026-01-15' })
eq('one subcontract holds retention', book.count, 1)
eq('five per cent of what was certified', book.accrued, 20000)
eq('none of it released', book.released, 0)
eq('all of it still held', book.held, 20000)
eq('and undated, because nothing says the work is finished', book.undated, 20000)
eq('the client side is a separate book', retentionBook(mixed, mixedBills, { entityId: E, side: 'client' }).accrued, 45000)
eq('an entity that is not this one holds nothing', retentionBook(mixed, mixedBills, { entityId: 'other' }).count, 0)
// An order that never withheld anything is not a line in a book about
// withholding.
const nil = order({ retentionPercent: 0, projectId: 'p2' })
eq('an order with no retention is not listed',
  retentionBook([nil], [bill(nil, 1, 500000)], { entityId: E }).count, 0)
// Worst first, so the list reads as a queue.
const late = order({ completedOn: '2024-01-01', contractor: 'Late' })
const recent = order({ completedOn: '2025-12-01', contractor: 'Recent' })
const queue = retentionBook([recent, late], [bill(recent, 1, 400000), bill(late, 1, 400000)], { entityId: E, asOf: '2026-01-15' })
eq('the longest overdue is first', queue.lines[0].order.contractor, 'Late')
eq('two contracts are due', queue.dueCount, 2)
// Both of the older contract's tranches have passed — completion in January
// 2024 and the defect period a year after — where the recent one has only
// reached the first. Three halves of ten thousand, not two.
eq('and the amount due counts tranches, not contracts', queue.due, 30000)
eq('the later contract still has its defects half waiting', queue.waiting, 10000)

console.log('\n── A DELETED ORDER IS NOT A LIABILITY ──')
eq('deleted orders drop out',
  retentionBook([{ ...sub, deleted_at: '2026-01-01' }], mixedBills, { entityId: E }).count, 0)
eq('and refused ones',
  retentionBook([{ ...sub, approval_status: 'rejected' }], mixedBills, { entityId: E }).count, 0)

console.log('\n── AND THE SAMPLE SHOWS ALL OF IT ──')
// A feature nobody can see in the demo is a feature nobody finds. The sample
// carries a finished subcontract whose first tranche fell due, a client
// contract holding the company's own money, and two running orders that are
// correctly undated because the work is not finished.
const sample = buildSample('e1')
const sSub = retentionBook(sample.workOrders, sample.raBills, { entityId: 'e1', side: 'sub' })
const sCli = retentionBook(sample.workOrders, sample.raBills, { entityId: 'e1', side: 'client' })
eq('three subcontracts hold retention', sSub.count, 3)
eq('one of them has a tranche due', sSub.dueCount, 1)
eq('and the running two have no release date', sSub.undatedCount, 2)
eq('the client holds retention from the company', sCli.held, 425000)
eq('half of which has fallen due', sCli.due, 212500)
eq('and half has not', sCli.waiting, 212500)
// The one that matters on real rows rather than a fixture: the bungalow cost
// what its subcontractor was certified, not what the client was billed.
const sCosts = subcontractCostsBySite(sample.workOrders, sample.raBills, { entityId: 'e1' })
eq('the finished site is costed at its subcontract', sCosts['sample-site-hv'], 920000)
ok('and not at what the client was billed', sCosts['sample-site-hv'] !== 8500000)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
