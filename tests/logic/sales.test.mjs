// Flats and shops: what is unsold, what is sold, and what the buyers owe.
//
// The assertion worth reading is the one that ties an instalment to the
// building. "10% on completion of 4th slab" is a fact about the structure, not
// a date, so what is due for work done is derived from measured progress
// rather than typed in by somebody who checked last month.
import {
  makeUnit, makePlanStage, makeReceipt, unitLedger, salesReport, salesAgainstBuild,
  UNIT_KINDS, UNIT_KIND_IDS, UNIT_STATUS, UNIT_STATUS_IDS, AREA_BASIS_IDS,
  isSold, isSellable, unitKindOf,
} from '../../src/lib/sales.js'
import { makeWorkItem, makeMeasurement, siteProgress } from '../../src/lib/progress.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${e ? '  — ' + e : ''}`) }
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

console.log('\n── WHAT IS BEING SOLD ──')
eq('there is a kind for each thing a tower holds', UNIT_KIND_IDS.length, 7)
ok('a flat is residential and a shop is not', UNIT_KINDS.flat.residential && !UNIT_KINDS.shop.residential)
eq('a kind nobody listed still reads', unitKindOf('dungeon').label, 'Other')
eq('every status has a label', UNIT_STATUS_IDS.filter((k) => !UNIT_STATUS[k].label).length, 0)
eq('an unnamed unit still has a name', makeUnit({}).name, 'Unnamed unit')
// Three numbers describe the same flat in India and they are not close: carpet
// is what you can walk on, super built-up adds a share of the lobby.
eq('there are three ways to quote an area', AREA_BASIS_IDS.length, 3)
const priced = makeUnit({ entityId: 'e1', name: 'A-1204', kind: 'flat', carpetArea: 900, superBuiltUpArea: 1200, areaBasis: 'superBuiltUp', ratePerArea: 10000 })
eq('a price comes off the rate and the area it is quoted on', priced.agreed_price, 12000000)
ok('and not off the carpet area, which is a different number', priced.agreed_price !== 900 * 10000)
// The agreement is what is enforceable, so a negotiated price always wins.
eq('a negotiated price beats the rate card',
  makeUnit({ carpetArea: 900, areaBasis: 'carpet', ratePerArea: 10000, agreedPrice: 8500000 }).agreed_price, 8500000)

console.log('\n── UNSOLD IS NOT ONE THING ──')
// A flat held back for a director and one genuinely available are not the
// same, and counting them together is how a developer believes he has stock he
// cannot sell.
ok('an available flat can be sold', isSellable('available') && !isSold('available'))
ok('a held-back one cannot', !isSellable('held') && !isSold('held'))
ok('a blocked one cannot either', !isSellable('blocked'))
ok('a booked one is sold', isSold('booked'))
ok('so is one at agreement, registration and possession',
  ['agreement', 'registered', 'possession'].every((s) => isSold(s)))
// A cancellation puts the flat back on the shelf, which is the whole point of
// recording it rather than deleting the booking.
ok('a cancelled booking returns the flat to stock', isSellable('cancelled') && !isSold('cancelled'))

console.log('\n── AGREED IS NOT DEMANDED ──')
const flat = makeUnit({
  entityId: 'e1', projectId: 'site-a', name: 'A-1204', kind: 'flat', tower: 'A', floor: 12,
  configuration: '3BHK', carpetArea: 1100, areaBasis: 'carpet', ratePerArea: 10000,
  otherCharges: 500000, status: 'booked',
})
eq('the flat is agreed at eleven lakh a floor plus charges', flat.agreed_price, 11000000)
// Construction-linked, the Indian standard. Each instalment names a stage of
// the building rather than a date.
const plan = [
  // Carries the booking date, because a booking amount is due at booking and
  // that is a date. Every instalment needs something to wait for.
  makePlanStage({ unitId: flat.id, entityId: 'e1', label: 'On booking', amount: 1000000, dueOn: '2026-01-01', sequence: 1 }),
  makePlanStage({ unitId: flat.id, entityId: 'e1', label: 'On foundation', percent: 15, workStage: 'earthwork', triggerAt: 100, sequence: 2 }),
  makePlanStage({ unitId: flat.id, entityId: 'e1', label: 'On structure', percent: 40, workStage: 'structure', triggerAt: 100, sequence: 3 }),
  makePlanStage({ unitId: flat.id, entityId: 'e1', label: 'On finishes', percent: 25, workStage: 'finishes', triggerAt: 100, sequence: 4 }),
  // Names no stage of work and carries no date. It will not fall due on its
  // own, and the ledger counts it rather than demanding it today.
  makePlanStage({ unitId: flat.id, entityId: 'e1', label: 'On possession', amount: 1500000, sequence: 5 }),
]
// The building: foundation done, structure half up, finishes untouched.
const items = [
  makeWorkItem({ entityId: 'e1', projectId: 'site-a', stage: 'earthwork', description: 'Excavation', plannedQty: 800, rate: 250 }),
  makeWorkItem({ entityId: 'e1', projectId: 'site-a', stage: 'structure', description: 'RCC', plannedQty: 600, rate: 6500 }),
  makeWorkItem({ entityId: 'e1', projectId: 'site-a', stage: 'finishes', description: 'Flooring', plannedQty: 20000, rate: 120 }),
]
const measured = [
  makeMeasurement({ workItemId: items[0].id, entityId: 'e1', date: '2026-02-01', qty: 800 }),
  makeMeasurement({ workItemId: items[1].id, entityId: 'e1', date: '2026-05-01', qty: 300 }),
]
const build = siteProgress(items, measured)
eq('the foundation is done', build.stages[0].percent, 100)
eq('the structure is half up', build.stages[1].percent, 50)
eq('and the finishes have not started', build.stages[2].percent, 0)

const led = unitLedger(flat, plan, [], { progressStages: build.stages, asOf: '2026-06-01' })
eq('the whole agreement is this much', led.agreed, 11500000)
// Booking (10,00,000) plus foundation (15% of 1.1cr = 16,50,000). The
// structure instalment is not due: half a structure is not a structure.
eq('only the instalments the building has earned are demanded', led.demanded, 2650000)
ok('the structure money is not demanded at half a structure',
  !led.lines.find((l) => l.stage.label === 'On structure').due)
eq('and the rest is not a receivable', led.notYetDue, 8850000)
ok('agreed and demanded are different numbers', led.agreed !== led.demanded)
// Every plan ends with "on possession", which names no stage and has no date.
// Treating those as payable today would demand the last instalment of every
// flat in the tower on day one.
eq('an instalment waiting on nothing is not demanded', led.untriggered, 1)
ok('and it is not in what is owed',
  !led.lines.find((l) => l.stage.label === 'On possession').due)

console.log('\n── DEMANDED IS NOT RECEIVED ──')
const paid = [
  makeReceipt({ unitId: flat.id, entityId: 'e1', date: '2026-01-10', amount: 1000000, mode: 'cheque' }),
  makeReceipt({ unitId: flat.id, entityId: 'e1', date: '2026-03-10', amount: 600000, mode: 'bank' }),
]
const withMoney = unitLedger(flat, plan, paid, { progressStages: build.stages, asOf: '2026-06-01' })
eq('what came in is what came in', withMoney.received, 1600000)
// The number a developer is asked for and usually cannot produce.
eq('what has fallen due and is unpaid', withMoney.dueNow, 1050000)
eq('what is still to come is untouched by it', withMoney.notYetDue, 8850000)
eq('and the whole balance is the two together', withMoney.balance, 9900000)
eq('as a share of the agreement', withMoney.percentReceived, 13.9)
// Money lands against the oldest instalment first, which is how a clerk does it
// and the only rule that needs no extra data entry.
eq('the booking amount is settled first', withMoney.lines[0].outstanding, 0)
eq('and the rest lands on the next one', withMoney.lines[1].received, 600000)
eq('leaving that one part paid', withMoney.lines[1].outstanding, 1050000)

console.log('\n── THE BUILDING MOVES AND SO DOES THE DEMAND ──')
// The join the module exists for: nobody re-types anything. The structure
// finishes, and 40% of the price becomes due because the building says so.
const finished = siteProgress(items, [...measured, makeMeasurement({ workItemId: items[1].id, entityId: 'e1', date: '2026-08-01', qty: 300 })])
eq('the structure is now complete', finished.stages[1].percent, 100)
const after = unitLedger(flat, plan, paid, { progressStages: finished.stages, asOf: '2026-09-01' })
eq('and the instalment it names has fallen due', after.demanded, 2650000 + 4400000)
ok('without anybody typing a date', after.demanded > withMoney.demanded)
eq('so what is owed today jumps', after.dueNow, 5450000)

console.log('\n── DUE IS NOT OVERDUE ──')
const dated = [
  makePlanStage({ unitId: flat.id, entityId: 'e1', label: 'March instalment', amount: 500000, dueOn: '2026-03-01', sequence: 1 }),
  makePlanStage({ unitId: flat.id, entityId: 'e1', label: 'August instalment', amount: 500000, dueOn: '2026-08-01', sequence: 2 }),
]
const mixed = [
  makePlanStage({ unitId: flat.id, entityId: 'e1', label: 'March instalment', amount: 500000, dueOn: '2026-03-01', sequence: 1 }),
  // Earned by the building last week. Due, and nothing to be late against.
  makePlanStage({ unitId: flat.id, entityId: 'e1', label: 'On foundation', amount: 400000, workStage: 'earthwork', triggerAt: 100, sequence: 2 }),
]
const both = unitLedger(flat, mixed, [], { progressStages: build.stages, asOf: '2026-08-15' })
eq('both have fallen due', both.demanded, 900000)
// A milestone the building earned last week and a date that passed in March
// are not the same conversation.
eq('but only the one with a date behind it is overdue', both.overdue, 500000)
ok('the work-triggered one is due all the same',
  both.lines.find((l) => l.stage.label === 'On foundation').due)
const neither = unitLedger(flat, dated, [], { asOf: '2026-02-01' })
eq('before either date nothing is demanded', neither.demanded, 0)
eq('and nothing is overdue', neither.overdue, 0)
// An instalment with neither a stage nor a date has nothing to wait for, so it
// waits — and is counted, rather than quietly demanded or silently ignored.
eq('an instalment waiting on nothing is not demanded',
  unitLedger(flat, [makePlanStage({ unitId: flat.id, amount: 100 })], []).demanded, 0)
eq('but it is counted so the plan gets finished',
  unitLedger(flat, [makePlanStage({ unitId: flat.id, amount: 100 })], []).untriggered, 1)

console.log('\n── A PLAN THAT DOES NOT ADD UP ──')
// Nobody checks, and the last instalment is where it shows.
const shortPlan = [makePlanStage({ unitId: flat.id, entityId: 'e1', label: 'Half', percent: 50, sequence: 1 })]
const gap = unitLedger(flat, shortPlan, [], { asOf: '2026-01-01' })
eq('the plan covers only half the flat', gap.planned, 5500000)
eq('and the shortfall is stated', gap.planGap, 6000000)
eq('a flat with no plan at all owes nothing yet', unitLedger(flat, [], []).demanded, 0)
eq('but its balance is the whole price', unitLedger(flat, [], []).balance, 11500000)
// Advance payment happens; so do double entries, and only one is good news.
eq('money beyond the agreement is called out',
  unitLedger(flat, plan, [makeReceipt({ unitId: flat.id, amount: 12000000 })], { progressStages: build.stages }).overpaid, 500000)

console.log('\n── THE SALES BOOK ──')
const units = [
  flat,
  makeUnit({ entityId: 'e1', projectId: 'site-a', name: 'A-1201', kind: 'flat', carpetArea: 900, areaBasis: 'carpet', ratePerArea: 10000, status: 'available' }),
  makeUnit({ entityId: 'e1', projectId: 'site-a', name: 'A-1202', kind: 'flat', carpetArea: 900, areaBasis: 'carpet', ratePerArea: 10000, status: 'held' }),
  makeUnit({ entityId: 'e1', projectId: 'site-a', name: 'S-01', kind: 'shop', carpetArea: 400, areaBasis: 'carpet', ratePerArea: 25000, status: 'registered' }),
  makeUnit({ entityId: 'e2', projectId: 'other', name: 'Z-1', kind: 'flat', carpetArea: 100, ratePerArea: 1, status: 'available' }),
]
const book = salesReport(units, plan, paid, { entityId: 'e1', progressStages: build.stages, asOf: '2026-06-01' })
eq('another company’s stock is not counted', book.count, 4)
eq('two are sold', book.sold, 2)
eq('one is available', book.available, 1)
// The distinction that matters: held back is not available.
eq('and one is held back, which is not the same thing', book.heldBack, 1)
ok('so unsold is not one number', book.available + book.heldBack === 2)
eq('what is sold is worth this much', book.soldValue, 11500000 + 10000000)
eq('and what can still be sold, this', book.availableValue, 9000000)
// A developer counts stock in square feet as often as in flats.
eq('area is counted too', [book.soldArea, book.availableArea], [1500, 900])
eq('only sold units owe anything', book.agreed, 21500000)
eq('and the collection figures are theirs', book.received, 1600000)
eq('worst first: overdue leads', book.lines[0].unit.name, 'A-1204')
eq('an empty book is zero, not a crash', salesReport([], [], []).count, 0)
eq('one site can be asked for', salesReport(units, plan, paid, { entityId: 'e1', projectId: 'site-a' }).count, 4)

console.log('\n── SELLING AGAINST BUILDING ──')
// A tower 70% sold and 30% built is a company holding other people's money;
// one 30% sold and 70% built is a company funding a building nobody bought.
const racing = salesAgainstBuild({ count: 10, sold: 7 }, 30)
ok('selling ahead of building is called out', racing.aheadOfBuild, JSON.stringify(racing))
ok('and said in words', /other people/.test(racing.why), racing.why)
const lagging = salesAgainstBuild({ count: 10, sold: 3 }, 70)
ok('building ahead of selling is the opposite problem', lagging.behindBuild)
ok('and says the company is funding it', /funding/.test(lagging.why), lagging.why)
const paced = salesAgainstBuild({ count: 10, sold: 5 }, 48)
ok('keeping pace is neither', !paced.aheadOfBuild && !paced.behindBuild)
ok('with no measured schedule there is no comparison',
  !salesAgainstBuild({ count: 10, sold: 5 }, null).known)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
