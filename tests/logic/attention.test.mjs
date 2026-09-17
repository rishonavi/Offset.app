// What is going wrong, in one place, ranked.
//
// The assertions worth reading are about ordering and about silence: that a
// wrong number outranks a large one, because every total downstream of a wrong
// number is also suspect; and that a company with nothing wrong is told so
// plainly rather than shown an empty list that reads like a failure to load.
import { attention, LEVELS, LEVEL_IDS } from '../../src/lib/attention.js'
import { makeItem, makeMovement } from '../../src/lib/inventory.js'
import { makeProject } from '../../src/lib/projects.js'
import { makeMuster } from '../../src/lib/labour.js'
import { makeWorkOrder, makeRaBill } from '../../src/lib/subcontract.js'
import { makePlant, makePlantLog } from '../../src/lib/plant.js'
import { makeUnit, makePlanStage } from '../../src/lib/sales.js'
import { makeAdvance, makeAdjustment } from '../../src/lib/advances.js'
import { makeDepartment } from '../../src/lib/corporate.js'
import { makeEmployee } from '../../src/lib/payroll.js'
import { makeWorkItem, makeMeasurement } from '../../src/lib/progress.js'
import { makeQuote, makeQuoteLine } from '../../src/lib/quotes.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${e ? '  — ' + e : ''}`) }
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)
const has = (r, id) => r.findings.some((f) => f.id === id)
const get = (r, id) => r.findings.find((f) => f.id === id)

const E = 'e1'

console.log('\n── A COMPANY WITH NOTHING WRONG ──')
// An empty list reads like something failed to load. Saying so is the point.
const quiet = attention({ entityId: E })
ok('is told so plainly', quiet.clear)
eq('with nothing in the list', quiet.count, 0)
eq('and nothing at stake', quiet.atStake, 0)
eq('there are four levels', LEVEL_IDS.length, 4)
ok('each with a label', LEVEL_IDS.every((k) => LEVELS[k].label))

console.log('\n── WRONG COMES FIRST ──')
// A site holding less than nothing has issued material it was never sent. The
// company can be square overall and still have a store that is short, which is
// exactly the case a single total hides.
const cement = makeItem({ entityId: E, name: 'Cement', unit: 'bag' })
const short = [
  makeMovement({ itemId: cement.id, entityId: E, kind: 'receipt', qty: 500, unitCost: 400, date: '2026-01-01' }),
  makeMovement({ itemId: cement.id, entityId: E, kind: 'issue', qty: 50, date: '2026-02-01', storeId: 'site-a', projectId: 'site-a' }),
]
const wrong = attention({ entityId: E, items: [cement], movements: short })
ok('a store issuing what it never received is reported', has(wrong, 'stock.negative'))
eq('as wrong, not merely worth watching', get(wrong, 'stock.negative').level, 'error')
ok('and says why it poisons everything downstream',
  /every cost that draws on that store is wrong/.test(get(wrong, 'stock.negative').detail))

// A wrong number outranks a large one, whatever it is worth.
const order = makeWorkOrder({ entityId: E, contractor: 'Sharma', orderValue: 2000000 })
const typo = [makeRaBill({ workOrderId: order.id, entityId: E, number: 1, claimedToDate: 100, certifiedToDate: 5000000 })]
const mixed = attention({
  entityId: E, items: [cement], movements: short,
  workOrders: [order], raBills: typo,
  units: [makeUnit({ entityId: E, name: 'A-1', carpetArea: 1000, ratePerArea: 10000, status: 'available' })],
})
eq('the first thing on the list is something wrong', mixed.findings[0].level, 'error')
ok('even with a crore of saleable stock on the same list',
  mixed.findings.some((f) => f.level === 'chance' && f.amount > 5000000))
ok('a certification above the claim is wrong', has(mixed, 'rabill.problems'))

// Somebody adjusted an advance past its balance.
const adv = makeAdvance({ entityId: E, party: 'Sharma', amount: 50000 })
const over = attention({
  entityId: E,
  advances: [adv],
  adjustments: [makeAdjustment({ advanceId: adv.id, entityId: E, amount: 99999 })],
})
ok('an over-adjusted advance is wrong', has(over, 'advance.overadjusted'))
// Every plan ends with "on possession", which names no stage and has no date.
const flat = makeUnit({ entityId: E, name: 'A-1204', carpetArea: 1000, ratePerArea: 10000, status: 'booked' })
const dead = attention({
  entityId: E, units: [flat],
  planStages: [makePlanStage({ unitId: flat.id, entityId: E, label: 'On possession', amount: 1500000 })],
})
ok('an instalment that will never fall due is wrong', has(dead, 'sales.untriggered'))
ok('and says nothing will ever make it payable',
  /nothing will ever make them payable/.test(get(dead, 'sales.untriggered').detail))

console.log('\n── MONEY NOBODY IS CHASING ──')
const rejected = [
  makeMovement({ itemId: cement.id, entityId: E, kind: 'receipt', qty: 200, unitCost: 400, date: '2026-01-01' }),
  makeMovement({ itemId: cement.id, entityId: E, kind: 'rejected', qty: 10, unitCost: 400, date: '2026-01-02', reason: 'set hard' }),
]
const owed = attention({ entityId: E, items: [cement], movements: rejected })
ok('a rejected delivery nobody claimed is money', has(owed, 'stock.rejected'))
eq('with the figure on it', get(owed, 'stock.rejected').amount, 4000)
eq('ranked as owed rather than merely risky', get(owed, 'stock.rejected').level, 'money')

// The quietest money there is: the machine billed and nobody wrote down whether
// it turned a wheel.
const jcb = makePlant({ entityId: E, name: 'JCB', kind: 'excavator', ownership: 'hired', hireRate: 12000, hireBasis: 'daily', hiredFrom: '2026-03-01', hiredTo: '2026-03-10' })
const unlogged = attention({
  entityId: E, plant: [jcb],
  plantLogs: [makePlantLog({ plantId: jcb.id, entityId: E, date: '2026-03-01', workingHours: 8 })],
})
ok('plant billed with no log sheet is money', has(unlogged, 'plant.unlogged'))
eq('for the days nobody wrote up', get(unlogged, 'plant.unlogged').count, 9)
eq('worth this much', get(unlogged, 'plant.unlogged').amount, 108000)

const loose = attention({ entityId: E, expenses: [{ id: 'x', amount: 400000, status: 'paid' }] })
ok('bills booked to no site are money', has(loose, 'cost.unattributed'))
ok('and it says the jobs look cheaper by exactly that much',
  /cheaper than they are by exactly this much/.test(get(loose, 'cost.unattributed').detail))

console.log('\n── GOING WRONG, BUT NOT WRONG YET ──')
const job = makeProject({ entityId: E, name: 'Marine Drive', contractValue: 10000000, estimate: 4000000 })
const spendy = attention({
  entityId: E, projects: [job],
  expenses: [{ id: 'x', project_id: job.id, amount: 5000000, status: 'paid' }],
})
ok('a job over its costing is worth watching', has(spendy, 'job.overrun'))
eq('and is not called wrong', get(spendy, 'job.overrun').level, 'risk')
// Over the estimate is not the same as losing money, and the list says which.
ok('while still inside the contract it is not called a loss', !has(spendy, 'job.losing'))
const losing = attention({
  entityId: E, projects: [makeProject({ entityId: E, id: 'j2', name: 'Bad', contractValue: 1000000, estimate: 2000000 })],
  expenses: [{ id: 'x', project_id: 'j2', amount: 1500000, status: 'paid' }],
})
ok('and a job past its contract value is', has(losing, 'job.losing'))
ok('with finishing it described as costing money', /finishing it costs money/.test(get(losing, 'job.losing').detail))

// The earliest warning a builder gets, and it arrives months before the money
// runs out.
const paced = makeProject({ entityId: E, name: 'Tower', contractValue: 10000000, estimate: 6500000 })
const behind = attention({
  entityId: E, projects: [paced],
  expenses: [{ id: 'x', project_id: paced.id, amount: 3900000, status: 'paid' }],
  workItems: [
    makeWorkItem({ entityId: E, projectId: paced.id, stage: 'earthwork', description: 'Excavation', plannedQty: 800, rate: 250 }),
    makeWorkItem({ entityId: E, projectId: paced.id, stage: 'structure', description: 'RCC', plannedQty: 600, rate: 6500 }),
    makeWorkItem({ entityId: E, projectId: paced.id, stage: 'finishes', description: 'Flooring', plannedQty: 20000, rate: 120 }),
  ],
  measurements: [],
})
ok('a job spending faster than it builds is reported', behind.findings.some((f) => f.id.startsWith('job.pace.')))
ok('with both percentages in the sentence',
  /% of the budget is gone and .*% of the work is done/.test(behind.findings.find((f) => f.id.startsWith('job.pace.')).detail))
ok('and says no ledger would tell you',
  /Nothing in a ledger/.test(behind.findings.find((f) => f.id.startsWith('job.pace.')).detail))

const idle = attention({
  entityId: E, plant: [jcb],
  plantLogs: [
    makePlantLog({ plantId: jcb.id, entityId: E, date: '2026-03-01', workingHours: 2, idleHours: 8 }),
    makePlantLog({ plantId: jcb.id, entityId: E, date: '2026-03-02', workingHours: 2, idleHours: 8 }),
  ],
})
ok('a machine working under half the time is worth watching', has(idle, 'plant.idle'))
const overtime = attention({
  entityId: E,
  muster: [makeMuster({ entityId: E, date: '2026-03-02', trade: 'helper', headcount: 10, rate: 500, overtimeHours: 40, overtimeRate: 90 })],
})
ok('heavy overtime is worth watching', has(overtime, 'labour.overtime'))
ok('and says it is the figure that quietly doubles',
  /quietly doubles/.test(get(overtime, 'labour.overtime').detail))
ok('ordinary overtime is not mentioned at all',
  !has(attention({ entityId: E, muster: [makeMuster({ entityId: E, headcount: 10, rate: 500, overtimeHours: 1, overtimeRate: 90 })] }), 'labour.overtime'))

console.log('\n── WORTH DOING ──')
const steel = makeItem({ entityId: E, name: 'TMT 12mm', unit: 'kg' })
const cheaper = attention({
  entityId: E, items: [steel],
  movements: [makeMovement({ itemId: steel.id, entityId: E, kind: 'receipt', qty: 1000, unitCost: 60, date: '2026-01-01' })],
  quotes: [makeQuote({
    entityId: E, vendor: 'Konkan Steel', date: '2026-02-01', validUntil: '2099-01-01', status: 'sent',
    lines: [makeQuoteLine({ itemId: steel.id, name: 'TMT 12mm', qty: 1000, rate: 52, gstPercent: 18 })],
  })],
})
ok('a live quote under what you paid is worth doing', has(cheaper, 'price.cheaper'))
eq('and is ranked below everything that is wrong or owed', get(cheaper, 'price.cheaper').level, 'chance')
ok('naming the vendor and the saving',
  /Konkan Steel/.test(get(cheaper, 'price.cheaper').detail), get(cheaper, 'price.cheaper').detail)
const expired = attention({
  entityId: E,
  quotes: [makeQuote({ entityId: E, vendor: 'Old', date: '2025-01-01', validUntil: '2025-02-01', status: 'sent', lines: [] })],
  asOf: '2026-06-01',
})
ok('a quote that ran out while nobody decided is worth knowing', has(expired, 'quote.expired'))

console.log('\n── HOW THE LIST IS ORDERED ──')
const everything = attention({
  entityId: E,
  items: [cement], movements: [...short, ...rejected],
  projects: [job], expenses: [{ id: 'x', project_id: job.id, amount: 5000000, status: 'paid' }],
  plant: [jcb], plantLogs: [makePlantLog({ plantId: jcb.id, entityId: E, date: '2026-03-01', workingHours: 8 })],
  // A large opportunity on the same list, so the ordering and the total both
  // have something to get wrong.
  units: [makeUnit({ entityId: E, name: 'A-1', carpetArea: 2000, ratePerArea: 10000, status: 'available' })],
})
const ranks = everything.findings.map((f) => LEVELS[f.level].rank)
ok('wrong, then owed, then watch, then worth doing',
  ranks.every((r, i) => i === 0 || ranks[i - 1] <= r), everything.findings.map((f) => `${f.level}:${f.amount}`).join(' '))
// Within a level the biggest number is the one that gets acted on.
const money = everything.findings.filter((f) => f.level === 'money')
ok('and inside a level, the biggest first',
  money.every((f, i) => i === 0 || money[i - 1].amount >= f.amount), money.map((f) => f.amount).join(','))
ok('every finding says where to go', everything.findings.every((f) => f.where?.to))
ok('and every one carries a number or a count',
  everything.findings.every((f) => f.amount > 0 || f.count > 0))
ok('ids are stable, so a finding can be recognised again',
  new Set(everything.findings.map((f) => f.id)).size === everything.count)
// Money you might save is not money you have lost, and adding them together
// produces a figure that means nothing.
const chances = everything.findings.filter((f) => f.level === 'chance')
const saleable = get(everything, 'sales.available')
ok('there is a large opportunity on the list to get this wrong with', saleable.amount === 20000000)
ok('and what is at stake leaves it out', everything.atStake < saleable.amount,
  `${everything.atStake} vs ${saleable.amount}`)
eq('being only what is wrong, owed or at risk',
  everything.atStake,
  Math.round(everything.findings.filter((f) => f.level !== 'chance').reduce((t, f) => t + f.amount, 0) * 100) / 100)
ok('and the worst thing is the first thing', everything.worst === everything.findings[0])
eq('the levels are counted', Object.values(everything.byLevel).reduce((a, b) => a + b, 0), everything.count)
ok('a company with findings is not called clear', !everything.clear)

console.log('\n── A BUDGET THAT SOMETHING FINALLY CHECKS ──')
// A budget nothing looks at is a number somebody typed once. These two findings
// are the whole reason the cost-centre and payroll-run work is not still half
// wired: a feature that never reaches the surface that says what is wrong is a
// feature nobody will notice going wrong.
const E2 = 'ent-att'
const month = new Date().toISOString().slice(0, 7)
const depts = [
  makeDepartment({ entityId: E2, id: 'dd-a', name: 'Site A', budgetMonthly: 100000 }),
  makeDepartment({ entityId: E2, id: 'dd-b', name: 'Head office', budgetMonthly: 500000 }),
]
const overspend = [
  { id: 'e1', entity_id: E2, department_id: 'dd-a', amount: 160000, date: `${month}-05` },
  { id: 'e2', entity_id: E2, department_id: 'dd-b', amount: 50000, date: `${month}-06` },
]
const budgets = attention({ entityId: E2, departments: depts, expenses: overspend })
const overBudget = get(budgets, 'budget.over')
ok('an overspent cost centre is a finding', Boolean(overBudget))
eq('counted', overBudget.count, 1)
eq('and the amount is the overspend, not the spend', overBudget.amount, 60000)
eq('it is money already gone, not a risk of going', overBudget.level, 'money')
ok('and it points somewhere you can act', Boolean(overBudget.where?.to))
// The control: within budget is not a finding.
ok('a cost centre inside its budget says nothing',
  !get(attention({ entityId: E2, departments: depts, expenses: [overspend[1]] }), 'budget.over'))
ok('nor does one with no budget set',
  !get(attention({
    entityId: E2,
    departments: [makeDepartment({ entityId: E2, id: 'dd-c', name: 'Legal' })],
    expenses: [{ id: 'e3', entity_id: E2, department_id: 'dd-c', amount: 999999, date: `${month}-05` }],
  }), 'budget.over'))

console.log('\n── AND A MONTH NOBODY RAN ──')
const staff = [makeEmployee({ entityId: E2, id: 'emp', name: 'R. Yadav', basic: 40000, joinedOn: '2020-01-01' })]
const unrun = attention({ entityId: E2, employees: staff, payrollRuns: [] })
const miss = get(unrun, 'payroll.unrecorded')
ok('a company with staff and no runs is told', Boolean(miss))
eq('three closed months at most, not a naggings-per-month', miss.count, 3)
eq('it is something to watch, not money owed', miss.level, 'risk')
// The control: run them and it goes quiet.
const prior = (n) => {
  const d = new Date(); d.setMonth(d.getMonth() - n)
  return d.toISOString().slice(0, 7)
}
const ran = [1, 2, 3].map((n) => ({ id: `r${n}`, entity_id: E2, period: prior(n), status: 'approved' }))
ok('once they are run it says nothing', !get(attention({ entityId: E2, employees: staff, payrollRuns: ran }), 'payroll.unrecorded'))
eq('run two of the three and one is left', get(attention({ entityId: E2, employees: staff, payrollRuns: ran.slice(0, 2) }), 'payroll.unrecorded').count, 1)
ok('a discarded run does not count as having run it',
  Boolean(get(attention({ entityId: E2, employees: staff, payrollRuns: ran.map((r) => ({ ...r, deleted_at: 'x' })) }), 'payroll.unrecorded')))
// Nobody on the payroll, nothing to run.
ok('a company with no staff is not nagged', !get(attention({ entityId: E2, employees: [], payrollRuns: [] }), 'payroll.unrecorded'))
// A company that hired last month is not behind on the months before it.
const fresh = [makeEmployee({ entityId: E2, id: 'new', name: 'New', basic: 10000, joinedOn: prior(1) })]
ok('nor is one that only just took somebody on',
  (get(attention({ entityId: E2, employees: fresh, payrollRuns: [] }), 'payroll.unrecorded')?.count || 0) <= 1)

console.log('\n── THE TWO LIABILITIES THAT REACH NO PAYSLIP ──')
// Gratuity and bonus are costs the company carries rather than deductions, so
// nothing monthly mentions either and both grow in silence. The dashboard is
// the only place they can surface at all.
//
// These fixtures also exist because the strings below were written calling
// formatters the module never imported: every branch threw, and nothing caught
// it because no fixture had ever reached them. A finding nothing exercises is
// a finding nobody has run.
const E3 = 'e3'
const hand = (id, basic, joined, over = {}) =>
  makeEmployee({ entityId: E3, id, name: `Hand ${id}`, basic, joinedOn: joined, ...over })
// Twenty-five on the books, so both Acts apply, and long enough in that
// gratuity has vested for some of them.
const bigCrew = [
  ...Array.from({ length: 5 }, (_, i) => hand(`old${i}`, 15000, '2016-01-01')),
  ...Array.from({ length: 20 }, (_, i) => hand(`new${i}`, 9000, '2024-01-01')),
]
const liable = attention({ entityId: E3, employees: bigCrew })
const gratOwed = get(liable, 'gratuity.accrued')
ok('gratuity already owed reaches the list', Boolean(gratOwed), JSON.stringify(liable.findings.map((f) => f.id)))
eq('it is money, not a mistake', gratOwed.level, 'money')
ok('with an amount on it', gratOwed.amount > 0, String(gratOwed.amount))
eq('and the five who have vested counted', gratOwed.count, 5)
ok('it says the money reaches no payslip', /reaches no payslip/.test(gratOwed.detail), gratOwed.detail)
// The control: a young payroll has accrued but nothing has vested, so there is
// nothing owed yet and the list stays quiet about it.
const young = attention({ entityId: E3, employees: Array.from({ length: 25 }, (_, i) => hand(`y${i}`, 15000, '2024-01-01')) })
ok('a payroll where nobody has five years is not told they are owed', !has(young, 'gratuity.accrued'),
  JSON.stringify(young.findings.map((f) => f.id)))
// Somebody with no joining date is quietly worth nothing.
const undated = attention({ entityId: E3, employees: [...bigCrew, hand('nodate', 12000, '')] })
const nd = get(undated, 'gratuity.undated')
ok('a person with no joining date is raised', Boolean(nd), JSON.stringify(undated.findings.map((f) => f.id)))
eq('as something to watch', nd.level, 'risk')
ok('and the crew with dates is not', !has(liable, 'gratuity.undated'), '')
// Bonus at the minimum because nobody chose.
const noRate = get(liable, 'bonus.noRate')
ok('a bonus rate nobody set is raised', Boolean(noRate), JSON.stringify(liable.findings.map((f) => f.id)))
ok('and the amount is what choosing the maximum would add', noRate.amount > 0, String(noRate.amount))
// The control: choose one and it goes quiet.
const chosen = attention({ entityId: E3, employees: bigCrew, payrollConfig: { bonus: { rate: 12 } } })
ok('choosing a rate takes it off the list', !has(chosen, 'bonus.noRate'),
  JSON.stringify(chosen.findings.map((f) => f.id)))
// Under twenty the Act does not apply, so neither says anything.
const small = attention({ entityId: E3, employees: bigCrew.slice(0, 8) })
ok('a company of eight is not asked about a bonus rate', !has(small, 'bonus.noRate'), '')
ok('nor told it owes gratuity', !has(small, 'gratuity.accrued'), '')
// Unless it says it pays them anyway, which many small firms do.
const paysAnyway = attention({ entityId: E3, employees: bigCrew.slice(0, 8),
  payrollConfig: { gratuity: { voluntary: true }, bonus: { voluntary: true } } })
ok('and is if it says it pays them regardless', has(paysAnyway, 'gratuity.accrued'),
  JSON.stringify(paysAnyway.findings.map((f) => f.id)))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
