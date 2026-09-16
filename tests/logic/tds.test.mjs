// Tax deducted at source, against what the company actually deducted.
//
// A work order already carries a `tds_percent` and the ladder already applies
// it. What nothing has checked is that figure against what the law requires —
// and the law does not ask about one order, it asks about one deductee across
// one financial year.
//
// The case this file exists for: a contractor paid ₹28,000, ₹34,000 and
// ₹41,000 on three separate orders. Every payment is under the single-payment
// limit or barely over it, every order looks fine on its own screen, and the
// year has crossed ₹1,00,000 — at which point the *whole year* becomes liable,
// not the excess. Nobody finds this without adding a name up across a year.
//
// And the bug that found itself on the way: a payment already liable under the
// single-payment rule was charged again when the year crossed, so the liable
// total came out larger than the amount paid. That is not a number that can
// exist, and the probe printed it before any test was written.
import {
  required, tdsLedger, fyOf, fyRange, quarterOf, hasPan, deducteeOf,
  SECTIONS, SECTION_IDS, DEDUCTEE_IDS, PAN,
} from '../../src/lib/tds.js'
import { makeWorkOrder, makeRaBill } from '../../src/lib/subcontract.js'
import { buildSample } from '../../src/lib/sampleSite.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, got, want) => ok(n, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const E = 'e1'
const pay = (date, amount) => ({ date, amount })

console.log('\n── THE YEAR A DATE FALLS IN ──')
eq('February belongs to the year that started last April', fyOf('2026-02-10').label, '25-26')
eq('and April to the one starting that month', fyOf('2026-04-01').label, '26-27')
eq('March is the last month of the old year', fyOf('2026-03-31').label, '25-26')
const range = fyRange(fyOf('2026-02-10'))
eq('which runs from the first of April', range.from, '2025-04-01')
eq('to the thirty-first of March', range.to, '2026-03-31')
// A company on a January year is a real thing, and the module is told rather
// than assuming.
eq('a January year starts in January', fyOf('2026-02-10', 1).label, '26-27')
eq('and ends on the thirty-first of December', fyRange(fyOf('2026-02-10', 1), 1).to, '2026-12-31')
eq('nothing in gives nothing out', fyOf(''), null)

console.log('\n── AND THE QUARTER OF THE RETURN ──')
eq('April is the first quarter', quarterOf('2026-04-05'), 1)
eq('August the second', quarterOf('2026-08-05'), 2)
eq('November the third', quarterOf('2026-11-05'), 3)
eq('February the fourth', quarterOf('2027-02-05'), 4)
eq('and on a January year April is the second', quarterOf('2026-04-05', 1), 2)

console.log('\n── A PAN IS TEN CHARACTERS ──')
ok('a real one passes', PAN.test('AAAPZ1234C'))
ok('a blank is not one', !hasPan({ pan: '' }))
ok('nor is a typo', !hasPan({ pan: 'AAAPZ1234' }))
ok('case does not matter', hasPan({ pan: 'aaapz1234c' }))
eq('an order says who it is paying', deducteeOf({ deductee_type: 'individual' }), 'individual')
eq('and defaults to the higher rate, not the lower', deducteeOf({}), 'other')
eq('there are two kinds', DEDUCTEE_IDS.join(','), 'individual,other')
eq('and two sections', SECTION_IDS.join(','), '194C,194Q')

console.log('\n── UNDER BOTH LIMITS, NOTHING IS DEDUCTED ──')
const small = required([pay('2026-05-01', 12000), pay('2026-07-01', 15000)])
eq('nothing is liable', small.liable, 0)
eq('so nothing is deducted', small.tds, 0)
eq('and it says so rather than reading as an error', small.below, true)
eq('the year was never crossed', small.crossedOn, null)
ok('and each payment says why', small.lines.every((l) => /under the limits/.test(l.reason)))

console.log('\n── ONE PAYMENT AT THE SINGLE LIMIT ──')
// Thirty thousand on its own attracts deduction whatever the year's total.
const single = required([pay('2026-05-01', 30000)])
eq('it is liable on its own', single.liable, 30000)
eq('at two per cent for a company', single.tds, 600)
ok('and says which rule caught it', /single-payment limit/.test(single.lines[0].reason), single.lines[0].reason)
eq('a rupee under it is not', required([pay('2026-05-01', 29999)]).liable, 0)

console.log('\n── AND THE YEAR THAT CREEPS PAST THE AGGREGATE ──')
// The case worth the module. Three orders, none of them alarming.
const creep = required([pay('2026-05-01', 28000), pay('2026-07-01', 34000), pay('2026-09-01', 41000)])
eq('the first is under everything', creep.lines[0].liable, 0)
eq('the second is over the single limit on its own', creep.lines[1].liable, 34000)
// The assertion the module exists for, and the bug it caught. When the year
// crosses, everything paid becomes liable — less what was already liable, or
// the total comes out bigger than the money.
eq('the third brings the rest of the year with it', creep.lines[2].liable, 69000)
eq('so the whole year is liable', creep.liable, 103000)
eq('which is exactly what was paid, and can never be more', creep.liable, creep.paid)
eq('at two per cent', creep.tds, 2060)
eq('and the day it crossed is named', creep.crossedOn, '2026-09-01')
ok('with the reason spelt out', /whole year becomes liable/.test(creep.lines[2].reason), creep.lines[2].reason)
// Everything after the crossing is liable in full without recomputing.
const after = required([pay('2026-05-01', 28000), pay('2026-07-01', 34000), pay('2026-09-01', 41000), pay('2026-11-01', 20000)])
eq('a later payment is liable in full', after.lines[3].liable, 20000)
ok('because the limit was already crossed', /already crossed/.test(after.lines[3].reason), after.lines[3].reason)
eq('and the liable total still equals the paid total', after.liable, after.paid)

console.log('\n── WHO IS BEING PAID CHANGES THE RATE, NOT THE LIMIT ──')
eq('an individual is one per cent', required([pay('2026-05-01', 200000)], { status: 'individual' }).tds, 2000)
eq('anybody else two', required([pay('2026-05-01', 200000)], { status: 'other' }).tds, 4000)
// Twenty per cent is a penalty, not a bracket.
eq('and no PAN is twenty', required([pay('2026-05-01', 200000)], { status: 'individual', pan: false }).tds, 40000)
eq('the limits do not move for any of them',
  required([pay('2026-05-01', 20000)], { status: 'individual', pan: false }).liable, 0)

console.log('\n── GOODS ARE THE OTHER WAY ROUND ──')
// 194Q deducts on the amount ABOVE the limit, where 194C deducts on everything
// once the limit is passed. Getting these the same way round is how a return
// comes out wrong by fifty lakh.
const goods = required([pay('2026-05-01', 4000000), pay('2026-09-01', 2000000)], { section: '194Q' })
eq('nothing below the limit is liable', goods.lines[0].liable, 0)
eq('only the part above it', goods.lines[1].liable, 1000000)
eq('at a tenth of a per cent', goods.tds, 1000)
ok('and it says why', /above the yearly limit/.test(goods.lines[1].reason), goods.lines[1].reason)
eq('the limit is fifty lakh', SECTIONS['194Q'].annualLimit, 5000000)
// The contrast, on the same money under the other section.
ok('the same money under 194C would be liable in full',
  required([pay('2026-05-01', 4000000), pay('2026-09-01', 2000000)]).liable === 6000000)

console.log('\n── A CONTRACTOR ACROSS THREE ORDERS ──')
const order = (id, over = {}) => makeWorkOrder({
  entityId: E, id, contractor: 'Ganesh Construction Co.', orderValue: 500000,
  retentionPercent: 0, tdsPercent: 0, pan: 'AAAPZ1234C', deducteeType: 'other', ...over,
})
const bill = (id, orderId, amount, date) => makeRaBill({
  entityId: E, id, workOrderId: orderId, number: 1, certifiedToDate: amount, claimedToDate: amount, date, status: 'certified',
})
const orders = [order('w1'), order('w2'), order('w3')]
const bills = [
  bill('b1', 'w1', 28000, '2026-05-01'),
  bill('b2', 'w2', 34000, '2026-07-01'),
  bill('b3', 'w3', 41000, '2026-09-01'),
]
const book = tdsLedger(orders, bills, { entityId: E, asOf: '2026-10-01' })
eq('three orders are one deductee', book.count, 1)
eq('and the name is kept', book.lines[0].party, 'Ganesh Construction Co.')
eq('the year adds up across all three', book.paid, 103000)
eq('and requires this much', book.required, 2060)
// The orders were written at nought per cent, which is the mistake.
eq('the company deducted nothing', book.deducted, 0)
eq('so it is short by the whole of it', book.shortfall, 2060)
eq('and it is counted as one contractor short', book.short, 1)
eq('the year is named', book.fy.label, '26-27')
eq('running from April', book.from, '2026-04-01')

console.log('\n── AND WHEN IT DEDUCTED TOO MUCH ──')
const over = tdsLedger(
  [order('w1', { tdsPercent: 2 })],
  [bill('b1', 'w1', 20000, '2026-05-01')],
  { entityId: E, asOf: '2026-10-01' })
eq('twenty thousand is under both limits', over.required, 0)
eq('but four hundred was deducted', over.deducted, 400)
eq('which is an excess', over.excess, 400)
eq('counted as one', over.over, 1)
eq('and not as a shortfall', over.shortfall, 0)
// Never netted: one contractor short and another over are two returns to
// correct, and the difference of nothing is neither.
const both = tdsLedger(
  [order('w1', { tdsPercent: 0 }), order('w2', { contractor: 'Other Co.', tdsPercent: 2 })],
  [bill('b1', 'w1', 200000, '2026-05-01'), bill('b2', 'w2', 20000, '2026-05-01')],
  { entityId: E, asOf: '2026-10-01' })
eq('one short', both.short, 1)
eq('one over', both.over, 1)
eq('the shortfall carries its own figure', both.shortfall, 4000)
eq('and the excess its own', both.excess, 400)
ok('which are not netted', both.shortfall !== 3600)

console.log('\n── THE THINGS THAT MAKE A ROW WRONG ──')
// No PAN on any one order is no PAN for the deductee.
const noPan = tdsLedger(
  [order('w1', { pan: '' }), order('w2')],
  [bill('b1', 'w1', 100000, '2026-05-01'), bill('b2', 'w2', 100000, '2026-06-01')],
  { entityId: E, asOf: '2026-10-01' })
eq('the deductee has no PAN', noPan.lines[0].pan, false)
eq('so the rate is twenty', noPan.lines[0].rate, 20)
eq('and one row is counted as unidentified', noPan.noPan, 1)
// Two PANs against one name is two companies filed as one.
const clash = tdsLedger(
  [order('w1', { pan: 'AAAPZ1234C' }), order('w2', { pan: 'BBBPZ4321D' })],
  [bill('b1', 'w1', 100000, '2026-05-01'), bill('b2', 'w2', 100000, '2026-06-01')],
  { entityId: E, asOf: '2026-10-01' })
eq('the clash is flagged', clash.lines[0].panConflict, true)
eq('and counted', clash.conflicts, 1)
eq('one PAN is not a clash', book.lines[0].panConflict, false)

console.log('\n── WHAT IS NOT IN THIS RETURN ──')
// On a client contract the company is the one being deducted from, and that is
// somebody else's return.
eq('a client contract is not a payment out',
  tdsLedger([order('w1', { side: 'client' })], [bill('b1', 'w1', 500000, '2026-05-01')], { entityId: E, asOf: '2026-10-01' }).count, 0)
// Last year's payments are last year's return.
eq('a payment before the year started is out',
  tdsLedger(orders, [bill('b1', 'w1', 500000, '2026-03-01')], { entityId: E, asOf: '2026-10-01' }).count, 0)
eq('and one after it ends', tdsLedger(orders, [bill('b1', 'w1', 500000, '2027-05-01')], { entityId: E, asOf: '2026-10-01' }).count, 0)
eq('another company’s contractors are not these', tdsLedger(orders, bills, { entityId: 'e2' }).count, 0)

console.log('\n── AND THE QUARTERS THE RETURN IS FILED IN ──')
const year = tdsLedger(
  [order('w1', { tdsPercent: 2 })],
  // Cumulative, as every RA bill is: the second states the work done *to date*,
  // so ₹4,00,000 is another ₹2,00,000 and not a repeat of the first.
  [bill('b1', 'w1', 200000, '2026-05-01'), { ...bill('b2', 'w1', 400000, '2026-11-01'), number: 2 }],
  { entityId: E, asOf: '2027-03-01' })
eq('four quarters, always', year.quarters.length, 4)
eq('the first carries the May payment', year.quarters[0].paid, 200000)
eq('the third the November one', year.quarters[2].paid, 200000)
eq('the second carries nothing', year.quarters[1].paid, 0)
eq('and the quarters add to the year', year.quarters.reduce((t, q) => t + q.paid, 0), year.paid)
eq('as does the tax', Math.round(year.quarters.reduce((t, q) => t + q.tds, 0) * 100) / 100, year.required)

console.log('\n── AND THE SAMPLE MAKES THE MISTAKE ──')
// Deducting the individual rate from a partnership firm. It is the commonest
// way this goes wrong, every order looks right on its own screen, and until
// there was something to compare against, nothing in the app could disagree.
const sample = tdsLedger(buildSample(E).workOrders, buildSample(E).raBills, { entityId: E })
eq('four contractors were paid this year', sample.count, 4)
eq('one of them had too little deducted', sample.short, 1)
eq('and it is the firm', sample.lines[0].party, 'Ganesh Construction Co.')
eq('which is not an individual', sample.lines[0].status, 'other')
eq('so two per cent was required', sample.lines[0].rate, 2)
eq('where one was deducted', sample.lines[0].deducted, 96000)
eq('leaving this much short', sample.shortfall, 96000)
// The control beside it: the three individuals are at the right rate, so the
// finding is the rate and not the module disliking everybody.
eq('nobody else is short', sample.lines.filter((l) => l.short).length, 1)
eq('and nobody had too much taken', sample.excess, 0)
eq('every contractor has a PAN', sample.noPan, 0)
eq('and none is on file twice', sample.conflicts, 0)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
