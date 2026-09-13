// Labour, subcontractors and what is actually built.
//
// The assertions worth reading are about cumulative bills — a running account
// bill states everything done to date, and treating one as this month's amount
// pays the job several times over — and about physical progress, which is the
// one number in this app that a ledger cannot produce.
import {
  makeMuster, musterCost, labourReport, labourCostsBySite,
  TRADES, TRADE_IDS, tradeOf,
} from '../../src/lib/labour.js'
import {
  makeWorkOrder, makeRaBill, billLadder, subcontractReport, subcontractCostsBySite,
  ORDER_STATUS_IDS, PRICING_IDS, isOrderOpen,
} from '../../src/lib/subcontract.js'
import {
  makeWorkItem, makeMeasurement, itemProgress, siteProgress, progressAgainstSpend,
  WORK_STAGES, WORK_STAGE_IDS, stageOf,
} from '../../src/lib/progress.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${e ? '  — ' + e : ''}`) }
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

console.log('\n── THE MUSTER ──')
// Not payroll: nobody is named. The unit is "fourteen masons on Tuesday",
// which is what a site diary already records.
const m1 = makeMuster({ entityId: 'e1', projectId: 'site-a', date: '2026-03-02', trade: 'mason', headcount: 14, rate: 800 })
eq('a day of masons costs headcount times rate', musterCost(m1).total, 11200)
eq('with no overtime yet', musterCost(m1).overtime, 0)
// Overtime is kept apart because it is the figure that quietly doubles.
const m2 = makeMuster({ entityId: 'e1', projectId: 'site-a', date: '2026-03-02', trade: 'helper', headcount: 22, rate: 500, overtimeHours: 40, overtimeRate: 90 })
eq('overtime is counted separately', musterCost(m2).overtime, 3600)
eq('and added to the day', musterCost(m2).total, 14600)
eq('half a mason is not a thing', makeMuster({ headcount: 3.6 }).headcount, 4)
eq('a negative headcount is floored', makeMuster({ headcount: -5 }).headcount, 0)
eq('an unknown trade falls back rather than vanishing', makeMuster({ trade: 'astronaut' }).trade, 'helper')
eq('every trade has a label', TRADE_IDS.filter((t) => !TRADES[t].label).length, 0)
ok('a mason is skilled and a helper is not', TRADES.mason.skilled && !TRADES.helper.skilled)
eq('a trade nobody listed still reads', tradeOf('nonsense').label, 'Other')

console.log('\n── THE REGISTER ──')
const muster = [
  m1, m2,
  makeMuster({ entityId: 'e1', projectId: 'site-a', date: '2026-03-03', trade: 'mason', headcount: 12, rate: 800 }),
  makeMuster({ entityId: 'e1', projectId: 'site-b', date: '2026-03-03', trade: 'carpenter', headcount: 6, rate: 900 }),
  makeMuster({ entityId: 'e1', date: '2026-03-04', trade: 'supervisor', headcount: 1, rate: 1500 }),
  makeMuster({ entityId: 'e2', projectId: 'other-co', date: '2026-03-03', trade: 'mason', headcount: 99, rate: 800 }),
]
const reg = labourReport(muster, { entityId: 'e1' })
eq('another company’s muster is not counted', reg.entries, 5)
eq('the wage bill adds up', reg.total, 11200 + 14600 + 9600 + 5400 + 1500)
eq('head-days are counted', reg.headDays, 14 + 22 + 12 + 6 + 1)
eq('skilled and unskilled apart', [reg.skilledDays, reg.unskilledDays], [33, 22])
eq('the average day rate follows', reg.averageDayRate, 769.09)
// The figure that quietly doubles while everyone watches the material rates.
eq('overtime as a share of the bill', reg.overtimePercent, 8.5)
eq('the costliest trade leads, which is not the most numerous', reg.byTrade[0].trade.id, 'mason')
ok('and trades are ordered by what they cost, not how many turned up',
  reg.byTrade.every((t, i) => i === 0 || reg.byTrade[i - 1].cost >= t.cost),
  reg.byTrade.map((t) => `${t.trade.id}:${t.cost}`).join(' '))
eq('sites are totalled', reg.bySite.length, 3)
eq('the costliest site first', reg.bySite[0].projectId, 'site-a')
// Labour booked to no site is labour no job is charged for.
ok('and the one booked to nothing is still there', reg.bySite.some((s) => s.projectId === null))
eq('days are in order', reg.days.map((d) => d.date), ['2026-03-02', '2026-03-03', '2026-03-04'])
eq('one site can be asked for', labourReport(muster, { entityId: 'e1', projectId: 'site-b' }).total, 5400)
eq('and so can the unbooked ones', labourReport(muster, { entityId: 'e1', projectId: null }).total, 1500)
eq('a window narrows it', labourReport(muster, { entityId: 'e1', from: '2026-03-03', to: '2026-03-03' }).headDays, 18)
eq('an empty register is zero, not a crash', labourReport([]).total, 0)
eq('and has no average to divide by', labourReport([]).averageDayRate, 0)
eq('costs per site come out as a map', labourCostsBySite(muster, { entityId: 'e1' })['site-a'], 35400)
ok('with nothing for the unbooked', !('null' in labourCostsBySite(muster, { entityId: 'e1' })))

console.log('\n── A RUNNING ACCOUNT BILL IS CUMULATIVE ──')
// The distinction the module exists for. Each bill states everything done to
// date; reading one as this month's amount pays the job several times over,
// and the arithmetic still adds up, which is what makes it dangerous.
const order = makeWorkOrder({
  entityId: 'e1', projectId: 'site-a', contractor: 'Sharma Plastering',
  scope: 'Internal plaster, all floors', orderValue: 2000000, retentionPercent: 5, tdsPercent: 1,
})
const bills = [
  makeRaBill({ workOrderId: order.id, entityId: 'e1', number: 1, date: '2026-03-31', claimedToDate: 500000, certifiedToDate: 500000 }),
  makeRaBill({ workOrderId: order.id, entityId: 'e1', number: 2, date: '2026-04-30', claimedToDate: 1300000, certifiedToDate: 1200000 }),
  makeRaBill({ workOrderId: order.id, entityId: 'e1', number: 3, date: '2026-05-31', claimedToDate: 1800000, certifiedToDate: 1750000, advanceRecovered: 100000 }),
]
const ladder = billLadder(order, bills)
eq('the first bill is worth what it certifies', ladder.lines[0].gross, 500000)
// 12,00,000 to date less 5,00,000 already certified.
eq('the second is the difference, not the total', ladder.lines[1].gross, 700000)
eq('and the third likewise', ladder.lines[2].gross, 550000)
eq('certified to date is the last figure, not the sum', ladder.certifiedToDate, 1750000)
ok('which is not what adding the bills would give', 500000 + 1200000 + 1750000 !== ladder.certifiedToDate)

console.log('\n── WHAT IS ACTUALLY PAID ──')
eq('retention comes off each bill', ladder.lines[1].retention, 35000)
eq('and TDS', ladder.lines[1].tds, 7000)
eq('leaving the net', ladder.lines[1].net, 658000)
eq('an advance is recovered from the bill it is deducted in', ladder.lines[2].recovered, 100000)
eq('so that bill pays less', ladder.lines[2].net, 550000 - 27500 - 5500 - 100000)
// A liability with a release date, not a discount.
eq('retention held is money still owed', ladder.retentionHeld, 87500)
eq('releasing some reduces what is held',
  billLadder({ ...order, retention_released: 40000 }, bills).retentionHeld, 47500)
// The job cost what was certified. Retention and TDS change when the money
// leaves, not whether it was spent.
eq('the cost of the work is what was certified', ladder.cost, 1750000)
ok('which is more than what was paid out', ladder.cost > ladder.netPayable, `${ladder.cost} vs ${ladder.netPayable}`)
eq('how much of the order is done', ladder.percentComplete, 87.5)
eq('and what is left on it', ladder.balance, 250000)
// The gap between what was asked for and what was measured.
eq('work claimed but not certified is visible', ladder.unCertified, 50000)
eq('with nothing billed there is nothing to say', billLadder(order, []).certifiedToDate, 0)
eq('and no problems either', billLadder(order, []).problems, 0)

console.log('\n── THE THREE THINGS THAT GO WRONG ──')
// Certifying more than was even claimed pays a contractor for work nobody says
// they did. Almost always a typo, and the one kind that costs money.
const typo = [makeRaBill({ workOrderId: order.id, number: 1, claimedToDate: 500000, certifiedToDate: 5000000 })]
ok('certifying above the claim is flagged', billLadder(order, typo).lines[0].overClaimed)
ok('and so is running past the order value', billLadder(order, typo).overOrder)
// A correction is legitimate and the net goes negative, which somebody should
// see rather than discover in the bank.
const correction = [
  makeRaBill({ workOrderId: order.id, number: 1, claimedToDate: 900000, certifiedToDate: 900000 }),
  makeRaBill({ workOrderId: order.id, number: 2, claimedToDate: 700000, certifiedToDate: 700000 }),
]
ok('a bill certifying less than the last is flagged', billLadder(order, correction).lines[1].negative)
ok('and its net is negative rather than hidden', billLadder(order, correction).lines[1].net < 0)
eq('problems are counted', billLadder(order, correction).problems, 1)
// Bills are ordered by their number, not by the order they were typed in.
const shuffled = [bills[2], bills[0], bills[1]]
eq('bills are read in number order however they were entered',
  billLadder(order, shuffled).lines.map((l) => l.gross), [500000, 700000, 550000])
eq('a retention above 100% is a typo, not a payment', makeWorkOrder({ retentionPercent: 500 }).retention_percent, 100)
eq('a contractor with no name still has one', makeWorkOrder({}).contractor, 'Unnamed contractor')
eq('every order status has a label', ORDER_STATUS_IDS.filter((s) => !s).length, 0)
ok('a running order is open and a closed one is not', isOrderOpen('running') && !isOrderOpen('closed'))
ok('pricing has the three a site uses', PRICING_IDS.length === 3)

console.log('\n── EVERY CONTRACTOR AT ONCE ──')
const order2 = makeWorkOrder({ entityId: 'e1', projectId: 'site-b', contractor: 'Verma Steel', orderValue: 500000, status: 'closed' })
const bills2 = [makeRaBill({ workOrderId: order2.id, number: 1, claimedToDate: 600000, certifiedToDate: 600000 })]
const rep = subcontractReport([order, order2], [...bills, ...bills2], { entityId: 'e1' })
eq('both orders are reported', rep.count, 2)
// The one in trouble is the one you opened the report to find.
eq('the one past its order value leads', rep.lines[0].order.contractor, 'Verma Steel')
eq('certified totals across orders', rep.certified, 2350000)
eq('retention held across them', rep.retentionHeld, 87500 + 30000)
eq('open-only drops the closed one', subcontractReport([order, order2], [...bills, ...bills2], { openOnly: true }).count, 1)
eq('one site can be asked for', subcontractReport([order, order2], [...bills, ...bills2], { projectId: 'site-b' }).count, 1)
eq('and costs come out per site', subcontractCostsBySite([order, order2], [...bills, ...bills2])['site-a'], 1750000)
eq('an empty report is zero', subcontractReport([], []).certified, 0)

console.log('\n── A REFUSAL IS NOT A CERTIFICATION ──')
// Somebody refused it, so it certified nothing. A pending one is different: the
// work was done and the company owes for it whether or not finance has cleared
// the payment, and leaving that out would report the job as costing less than
// it did.
const refusedBill = { ...makeRaBill({ workOrderId: order.id, entityId: 'e1', number: 4, claimedToDate: 2000000, certifiedToDate: 2000000 }), approval_status: 'rejected' }
eq('a refused bill is not in the ladder', billLadder(order, [...bills, refusedBill]).count, 3)
eq('so nothing was certified by it', billLadder(order, [...bills, refusedBill]).certifiedToDate, 1750000)
const pendingBill = { ...makeRaBill({ workOrderId: order.id, entityId: 'e1', number: 4, claimedToDate: 2000000, certifiedToDate: 2000000 }), approval_status: 'pending' }
eq('a pending one is', billLadder(order, [...bills, pendingBill]).count, 4)
eq('and the job is charged for it', billLadder(order, [...bills, pendingBill]).certifiedToDate, 2000000)
// A work order nobody approved commits the company to nothing.
eq('a refused work order drops out of the report',
  subcontractReport([{ ...order, approval_status: 'rejected' }], bills, { entityId: 'e1' }).count, 0)
eq('a pending one does not', subcontractReport([{ ...order, approval_status: 'pending' }], bills, { entityId: 'e1' }).count, 1)

console.log('\n── WHAT IS ACTUALLY BUILT ──')
const items = [
  makeWorkItem({ entityId: 'e1', projectId: 'site-a', code: 'e-1', description: 'Excavation', stage: 'earthwork', unit: 'cum', plannedQty: 800, rate: 250 }),
  makeWorkItem({ entityId: 'e1', projectId: 'site-a', code: 's-1', description: 'RCC framed structure', stage: 'structure', unit: 'cum', plannedQty: 600, rate: 6500 }),
  makeWorkItem({ entityId: 'e1', projectId: 'site-a', code: 'f-1', description: 'Vitrified flooring', stage: 'finishes', unit: 'sqft', plannedQty: 20000, rate: 120 }),
]
eq('a code is upper-cased the way a drawing writes it', items[0].code, 'E-1')
eq('an item with no description still has one', makeWorkItem({}).description, 'Untitled item')
eq('an unknown stage falls back', makeWorkItem({ stage: 'magic' }).stage, 'structure')
eq('the stages run in build order', WORK_STAGE_IDS.map((k) => WORK_STAGES[k].sequence), [1, 2, 3, 4, 5, 6, 7, 8])
eq('a stage nobody listed still reads', stageOf('nope').label, 'Other')

const measured = [
  makeMeasurement({ workItemId: items[0].id, entityId: 'e1', date: '2026-02-10', qty: 800 }),
  makeMeasurement({ workItemId: items[1].id, entityId: 'e1', date: '2026-04-10', qty: 300 }),
  makeMeasurement({ workItemId: items[1].id, entityId: 'e1', date: '2026-05-10', qty: 60 }),
  // A re-measurement that found less. Forcing it positive would mean the only
  // way to fix an error is to delete the record of it.
  makeMeasurement({ workItemId: items[1].id, entityId: 'e1', date: '2026-05-12', qty: -10 }),
]
const excav = itemProgress(items[0], measured)
eq('a finished item is complete', excav.percent, 100)
ok('and says so', excav.complete)
eq('with its value earned', excav.earned, 200000)
const rcc = itemProgress(items[1], measured)
eq('measurements add up, corrections included', rcc.done, 350)
eq('as a percentage of what was planned', rcc.percent, 58.3)
eq('the value in the ground', rcc.earned, 2275000)
eq('and what is left to build', rcc.remaining, 250)
ok('a started item is not complete', rcc.started && !rcc.complete)
const floor = itemProgress(items[2], measured)
ok('an untouched item has not started', !floor.started)
eq('and has earned nothing', floor.earned, 0)
ok('building more than was scheduled is flagged',
  itemProgress(items[0], [...measured, makeMeasurement({ workItemId: items[0].id, qty: 50 })]).over)

console.log('\n── PROGRESS IS WEIGHTED BY VALUE ──')
// One of three items complete is 33% by count. By value it is 4%, because
// excavation is cheap and flooring is not — and on a construction schedule the
// expensive half always comes last.
const prog = siteProgress(items, measured)
eq('three items', prog.count, 3)
eq('one of them finished', prog.itemsComplete, 1)
eq('the schedule is worth this much', prog.value, 200000 + 3900000 + 2400000)
eq('and this much is built', prog.earned, 200000 + 2275000)
eq('which is 38.1% by value, not 33.3% by count', prog.percent, 38.1)
ok('and those are different numbers', prog.percent !== Math.round((1 / 3) * 1000) / 10)
eq('the stages run in build order',
  prog.stages.map((s) => s.stage.id), ['earthwork', 'structure', 'finishes'])
eq('earthwork is done', prog.stages[0].percent, 100)
eq('and finishes have not started', prog.stages[2].percent, 0)
eq('one item is still untouched', prog.itemsNotStarted, 1)
eq('the last measurement is remembered', prog.lastMeasured, '2026-05-12')
eq('an unpriced line is counted as such',
  siteProgress([...items, makeWorkItem({ description: 'No rate', plannedQty: 5 })], measured).unpriced, 1)
eq('an empty schedule has no percentage to invent', siteProgress([], []).percent, null)

console.log('\n── BUILT AGAINST BURNT ──')
// The comparison the module exists for. The ledger says 60% of the budget is
// gone and looks fine; the site says 38% is built. Nothing financial will tell
// you that.
const against = progressAgainstSpend({ earned: prog.earned, value: prog.value, spent: 3900000, estimate: 6500000 })
eq('this much of the building is done', against.built, 38.1)
eq('and this much of the budget', against.burnt, 60)
eq('the gap is the warning', against.gap, -21.9)
ok('and it is called out', against.behind && !against.ahead)
ok('in words, not just a sign', /more of the budget is gone/.test(against.why), against.why)
// A projection, and labelled as one.
eq('finishing at this rate would cost', against.forecast, 10236220.47)
const level = progressAgainstSpend({ earned: 50, value: 100, spent: 50, estimate: 100 })
ok('keeping pace is neither', !level.behind && !level.ahead)
ok('and says so', /keeping pace/.test(level.why))
// Five points of slack: measurement is not that precise, and a site that flags
// every week is a site nobody looks at.
ok('a small gap is not an alarm', !progressAgainstSpend({ earned: 47, value: 100, spent: 50, estimate: 100 }).behind)
ok('ahead of the money is also worth saying',
  progressAgainstSpend({ earned: 70, value: 100, spent: 50, estimate: 100 }).ahead)
// Without both numbers there is no comparison, and an invented one is worse.
const blind = progressAgainstSpend({ earned: 0, value: 0, spent: 100000, estimate: 500000 })
ok('with no priced schedule there is no answer', !blind.known)
ok('and it says why', /No priced schedule/.test(blind.why), blind.why)
ok('with no estimate, likewise',
  /No estimate/.test(progressAgainstSpend({ earned: 10, value: 100, spent: 5, estimate: 0 }).why))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
