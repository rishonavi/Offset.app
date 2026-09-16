// What is already promised, and what is already owed.
//
// Three horizons that must not be added together: committed (agreed, not yet
// incurred), due (incurred, not yet settled), and coming (contracted to
// arrive). Folding the first into the second makes a solvent company look
// bankrupt, which is the kind of wrong answer people act on.
//
// The assertion this file exists for is the one about sites. An instalment
// falls due when a stage of *that* building is finished, and `salesReport` is
// handed the completed stages rather than working them out — so asking it about
// every unit at once with one merged list triggers a demand on the villas
// because the tower reached its eighth slab. It is a silent wrong answer in the
// direction a builder would like, which is the worst direction.
import { commitments, describeGap } from '../../src/lib/commitments.js'
import { makeWorkOrder, makeRaBill } from '../../src/lib/subcontract.js'
import { makeQuote, makeQuoteLine } from '../../src/lib/quotes.js'
import { makeUnit, makePlanStage, makeReceipt } from '../../src/lib/sales.js'
import { makeWorkItem, makeMeasurement } from '../../src/lib/progress.js'
import { buildSample } from '../../src/lib/sampleSite.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, got, want) => ok(n, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const E = 'e1'
const empty = { workOrders: [], raBills: [], quotes: [], units: [], planStages: [], receipts: [], expenses: [], income: [], workItems: [], measurements: [] }

console.log('\n── NOTHING AT ALL ──')
const none = commitments(empty, { entityId: E })
eq('nothing is committed', none.committed, 0)
eq('nothing is due out', none.dueOut, 0)
eq('nothing is due in', none.dueIn, 0)
eq('the gap is nothing rather than a division by nothing', none.gap, 0)
// A ratio of nothing to nothing is not 1 and not 0. It is not a number.
eq('and cover has no answer', none.cover, null)
eq('which is said in words too', describeGap(none), 'Nothing due in either direction.')

console.log('\n── WORK AGREED AND NOT YET DONE ──')
const wo = makeWorkOrder({ entityId: E, id: 'wo1', contractor: 'Ganesh', orderValue: 1000000, retentionPercent: 5, tdsPercent: 1, status: 'running' })
const ra = makeRaBill({ workOrderId: 'wo1', entityId: E, number: 1, certifiedToDate: 400000, claimedToDate: 400000, status: 'certified' })
const one = commitments({ ...empty, workOrders: [wo], raBills: [ra] }, { entityId: E })
eq('the unspent part of the order is a commitment', one.subcontract.remaining, 600000)
eq('and it is not cash due today', one.committed, 600000)
// 400,000 certified less 5% retention and 1% TDS.
eq('the certified bill is cash due', one.subcontract.unpaid, 376000)
eq('which is what goes into the outgoing total', one.dueOut, 376000)
ok('the two are never the same figure', one.committed !== one.dueOut)

console.log('\n── A CLOSED ORDER IS A SAVING, NOT A DEBT ──')
// The distinction nothing else in the app draws. An order closed at half its
// value did not leave the company owing the other half.
const closed = commitments({ ...empty, workOrders: [{ ...wo, status: 'closed' }], raBills: [ra] }, { entityId: E })
eq('nothing is still committed on it', closed.subcontract.remaining, 0)
eq('though the certified bill is still owed', closed.subcontract.unpaid, 376000)

console.log('\n── AN ORDER WITH NO VALUE ON IT ──')
// A rate contract commits a real amount that nobody wrote down. Counting it as
// zero would report "nothing left to spend" on a job with everything left.
const rate = makeWorkOrder({ entityId: E, id: 'wo2', contractor: 'Daily gang', orderValue: 0, pricing: 'rate' })
const unvalued = commitments({ ...empty, workOrders: [wo, rate], raBills: [ra] }, { entityId: E })
eq('it adds nothing to the total', unvalued.subcontract.remaining, 600000)
eq('but it is counted', unvalued.subcontract.unvalued, 1)
eq('and the reader is told the total is a floor', unvalued.incomplete, true)
eq('where an ordinary book is not', one.incomplete, false)

console.log('\n── A LORRY AGREED AND NOT DELIVERED ──')
const quote = (id, status, receivedAt = '') => makeQuote({
  entityId: E, id, vendor: 'Shakti Steel', status, receivedAt,
  lines: [makeQuoteLine({ name: 'TMT 12mm', qty: 1000, rate: 60, gstPercent: 18 })],
})
const q = commitments({ ...empty, quotes: [quote('q1', 'accepted')] }, { entityId: E })
eq('an accepted quotation is a commitment', q.materials.ordered, 70800)
eq('inclusive of the tax that leaves the bank', q.materials.tax, 10800)
eq('and reported without it as well', q.materials.net, 60000)
// The three that are not commitments, each for a different reason.
eq('a quotation nobody has accepted is not',
  commitments({ ...empty, quotes: [quote('q1', 'sent')] }, { entityId: E }).materials.ordered, 0)
eq('nor a declined one',
  commitments({ ...empty, quotes: [quote('q1', 'declined')] }, { entityId: E }).materials.ordered, 0)
eq('nor one already delivered',
  commitments({ ...empty, quotes: [quote('q1', 'accepted', '2026-01-01T00:00:00.000Z')] }, { entityId: E }).materials.ordered, 0)
// Control: the delivered one is the same quotation, so the difference is the
// stamp and not the quotation.
eq('the delivered one was counted before it was stamped', q.materials.count, 1)

console.log('\n── AN INSTALMENT FALLS DUE ON ITS OWN BUILDING ──')
// Two sites. The tower has finished its structure; the villas have not. One
// instalment on each, both waiting on the same named stage.
// 'agreement', not 'sold': there is no such status, and `makeUnit` quietly
// turns one it does not know into 'available' — which counts as unsold, so the
// whole sales block reads zero and every assertion about it passes for the
// wrong reason.
const unitIn = (id, site) => makeUnit({ entityId: E, id, projectId: site, name: id, agreedPrice: 1000000, status: 'agreement' })
const stageOn = (id, unitId) => makePlanStage({
  entityId: E, id, unitId, label: 'On structure', percent: 30, workStage: 'structure', triggerAt: 100, sequence: 1,
})
const item = (id, site) => makeWorkItem({ entityId: E, id, projectId: site, stage: 'structure', plannedQty: 100, rate: 1000 })
const built = (id, qty) => makeMeasurement({ entityId: E, workItemId: id, qty })
const twoSites = {
  ...empty,
  units: [unitIn('u-tower', 'tower'), unitIn('u-villa', 'villa')],
  planStages: [stageOn('s-tower', 'u-tower'), stageOn('s-villa', 'u-villa')],
  workItems: [item('wi-tower', 'tower'), item('wi-villa', 'villa')],
  // The tower's structure is finished. The villas' is a tenth done.
  measurements: [built('wi-tower', 100), built('wi-villa', 10)],
}
const sites = commitments(twoSites, { entityId: E })
eq('two buildings are looked at separately', sites.sales.sites, 2)
eq('only the finished one has an instalment due', sites.sales.dueNow, 300000)
// The number the merged version would have produced, named so a later reader
// knows which mistake this assertion is guarding.
ok('not both of them', sites.sales.dueNow !== 600000)
eq('and the rest is not yet due', sites.sales.notYetDue, 1700000)

console.log('\n── WHAT IS ALREADY IN THE BANK COMES OFF IT ──')
const paid = commitments({ ...twoSites, receipts: [makeReceipt({ entityId: E, unitId: 'u-tower', amount: 100000 })] }, { entityId: E })
eq('a receipt reduces what is due', paid.sales.dueNow, 200000)

console.log('\n── THE TWO DIRECTIONS, AND THE GAP ──')
const both = commitments({
  ...twoSites,
  workOrders: [wo, makeWorkOrder({ entityId: E, id: 'wo-c', side: 'client', contractor: 'Authority', orderValue: 5000000 })],
  raBills: [ra, makeRaBill({ workOrderId: 'wo-c', entityId: E, number: 1, certifiedToDate: 1000000, claimedToDate: 1000000, status: 'certified' })],
}, { entityId: E })
eq('the subcontractor is owed', both.subcontract.unpaid, 376000)
eq('and the client owes', both.client.unpaid, 940000)
eq('out is the subcontractor', both.dueOut, 376000)
eq('in is the client and the instalment', both.dueIn, 1240000)
eq('the gap is the difference', both.gap, 864000)
eq('and cover is the ratio', both.cover, 3.3)
ok('a covered book says so', /covers everything owed/.test(describeGap(both)), describeGap(both))
ok('and says the agreed work is still to come', /before the work already agreed/.test(describeGap(both)))
// The same books with nothing coming in.
const short = commitments({ ...empty, workOrders: [wo], raBills: [ra] }, { entityId: E })
ok('an uncovered one says that instead', /More is owed than is due in/.test(describeGap(short)), describeGap(short))

console.log('\n── ANOTHER COMPANY’S BOOKS ARE NOT THESE ──')
const other = commitments({ ...empty, workOrders: [wo], raBills: [ra] }, { entityId: 'e2' })
eq('nothing of it is committed', other.committed, 0)
eq('nothing of it is owed', other.dueOut, 0)

console.log('\n── AND ONE SITE OF SEVERAL ──')
eq('asking about the tower gets the tower',
  commitments(twoSites, { entityId: E, projectId: 'tower' }).sales.dueNow, 300000)
eq('and asking about the villas gets nothing due',
  commitments(twoSites, { entityId: E, projectId: 'villa' }).sales.dueNow, 0)
eq('which is one building, not two',
  commitments(twoSites, { entityId: E, projectId: 'villa' }).sales.sites, 1)

console.log('\n── THE SAMPLE HAS ALL THREE HORIZONS ──')
const s = commitments(buildSample(E), { entityId: E })
ok('work is agreed and not yet done', s.subcontract.remaining > 0, String(s.subcontract.remaining))
ok('a delivery is agreed and not arrived', s.materials.ordered > 0, String(s.materials.ordered))
ok('bills are certified and not paid', s.subcontract.unpaid > 0, String(s.subcontract.unpaid))
ok('buyers owe an instalment', s.sales.dueNow > 0, String(s.sales.dueNow))
ok('and the client is holding retention that fell due', s.client.retentionDue > 0, String(s.client.retentionDue))
ok('the committed figure is not the due figure', s.committed !== s.dueOut)
eq('and both add up to what was agreed in all', s.committedAndDue, Math.round((s.committed + s.dueOut) * 100) / 100)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
