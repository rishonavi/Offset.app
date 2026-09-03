// Inventory valuation, ageing of what's owed, advances and their adjustment,
// and payroll. All four move money, so all four are tested on the arithmetic
// rather than on the shape of the output.
import { makeItem, makeMovement, stockOf, stockReport, stockOverPeriod, reorderList, consumption, UNITS } from '../../src/lib/inventory.js'
import { ageing, byParty, workingCapital, daysOverdue, bucketFor, describeAgeing, AGE_BUCKETS } from '../../src/lib/payables.js'
import { makeAdvance, makeAdjustment, balanceOf, canAdjust, outstandingAdvances, advancesByParty } from '../../src/lib/advances.js'
import { makeEmployee, grossOf, providentFund, stateInsurance, professionalTax, payslipFor, runPayroll, payrollByDepartment, onPayrollIn, periodsBetween, payrollOverPeriods, DEFAULT_PAYROLL_CONFIG } from '../../src/lib/payroll.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${e ? '  — ' + e : ''}`) }
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

// ════════ INVENTORY ════════
console.log('\n── STOCK VALUATION ──')
const cement = makeItem({ entityId: 'e1', name: 'Cement 50kg', sku: 'cem-50', unit: 'bag', reorderLevel: 20 })
eq('the SKU is upper-cased', cement.sku, 'CEM-50')
eq('an unknown unit falls back', makeItem({ name: 'x', unit: 'furlong' }).unit, 'pcs')
ok('every listed unit is accepted', UNITS.every((u) => makeItem({ name: 'x', unit: u }).unit === u))

const mv = []
const add = (o) => mv.push(makeMovement({ itemId: cement.id, entityId: 'e1', ...o }))
add({ kind: 'receipt', qty: 100, unitCost: 350, date: '2026-01-05' })
let s = stockOf(cement, mv)
eq('a receipt sets the quantity', s.qty, 100)
eq('and the value', s.value, 35000)
eq('and the average cost', s.avgCost, 350)

// A second receipt at a different price must move the average, not replace it.
add({ kind: 'receipt', qty: 100, unitCost: 450, date: '2026-02-05' })
s = stockOf(cement, mv)
eq('a dearer receipt raises the average', s.avgCost, 400)
eq('the value is the weighted sum', s.value, 80000)

add({ kind: 'issue', qty: 50, date: '2026-03-01' })
s = stockOf(cement, mv)
eq('an issue reduces the quantity', s.qty, 150)
eq('issued at the average, the value follows', s.value, 60000)
eq('and the average is unchanged by an issue', s.avgCost, 400)

add({ kind: 'wastage', qty: 10, date: '2026-03-02' })
s = stockOf(cement, mv)
eq('wastage removes stock too', s.qty, 140)
eq('and its value', s.value, 56000)

add({ kind: 'adjustment', qty: -5, date: '2026-03-03', note: 'stock take' })
s = stockOf(cement, mv)
eq('a negative adjustment is allowed', s.qty, 135)
eq('valued at the prevailing average', s.value, 54000)
eq('receipts are tracked', s.received, 200)
eq('and issues', s.issued, 60)
eq('the last movement date is kept', s.lastMovement, '2026-03-03')
ok('above the reorder level, no flag', !s.belowReorder)

// Ordering must come from the dates, not from the order rows were entered.
const shuffled = [mv[2], mv[0], mv[4], mv[1], mv[3]]
eq('movements are applied oldest-first regardless of array order',
  stockOf(cement, shuffled).value, s.value)

console.log('\n── STOCK EDGE CASES ──')
const bolt = makeItem({ entityId: 'e1', name: 'Bolts', reorderLevel: 50 })
const bm = [makeMovement({ itemId: bolt.id, entityId: 'e1', kind: 'receipt', qty: 40, unitCost: 10, date: '2026-01-01' })]
ok('at or below the reorder level it is flagged', stockOf(bolt, bm).belowReorder)
const empty = makeItem({ entityId: 'e1', name: 'Nothing' })
const es = stockOf(empty, [])
eq('an item with no movements has no stock', es.qty, 0)
eq('and no value', es.value, 0)
eq('and no average cost to divide by', es.avgCost, 0)
ok('an item with no reorder level is never flagged', !es.belowReorder)
// Issuing more than exists is a real-world data error, not a crash.
const over = makeItem({ entityId: 'e1', name: 'Over' })
const om = [
  makeMovement({ itemId: over.id, entityId: 'e1', kind: 'receipt', qty: 10, unitCost: 100, date: '2026-01-01' }),
  makeMovement({ itemId: over.id, entityId: 'e1', kind: 'issue', qty: 25, date: '2026-01-02' }),
]
const os = stockOf(over, om)
ok('issuing more than held gives negative stock', os.qty < 0, String(os.qty))
ok('and it is flagged rather than hidden', os.negative)
ok('the value never goes below zero', os.value >= 0, String(os.value))
eq('a negative-qty issue is treated as positive', stockOf(over, [
  makeMovement({ itemId: over.id, entityId: 'e1', kind: 'receipt', qty: 10, unitCost: 100, date: '2026-01-01' }),
  makeMovement({ itemId: over.id, entityId: 'e1', kind: 'issue', qty: -3, date: '2026-01-02' }),
]).qty, 7)

console.log('\n── STOCK REPORT ──')
const rep = stockReport([cement, bolt, empty, over], [...mv, ...bm, ...om])
eq('every item is reported', rep.lines.length, 4)
eq('the total is the sum of the values', rep.totalValue, round(rep.lines.reduce((t, l) => t + l.value, 0)))
function round(n) { return Math.round(n * 100) / 100 }
eq('items below reorder are counted', rep.itemsBelowReorder, 1)
eq('negative items are counted', rep.itemsNegative, 1)
const reorder = reorderList([cement, bolt, empty, over], [...mv, ...bm, ...om])
ok('negative stock comes first on the reorder list', reorder[0].negative, reorder.map((r) => r.item.name).join(', '))
eq('consumption over a window counts issues and wastage', consumption(cement, mv, '2026-03-01', '2026-03-31'), 60)
eq('and excludes anything outside it', consumption(cement, mv, '2026-04-01', '2026-04-30'), 0)

// ════════ DUE PAYMENTS ════════
console.log('\n── AGEING ──')
const ASOF = '2026-06-30'
eq('days overdue counts from the due date', daysOverdue('2026-06-20', ASOF), 10)
eq('a future due date is negative', daysOverdue('2026-07-10', ASOF), -10)
eq('due today is zero', daysOverdue('2026-06-30', ASOF), 0)
eq('no due date cannot be aged', daysOverdue('', ASOF), null)
eq('not yet due lands in current', bucketFor(-5), 'current')
eq('due today is still current', bucketFor(0), 'current')
eq('one day late starts the first bucket', bucketFor(1), 'd1_30')
eq('thirty days is the boundary', bucketFor(30), 'd1_30')
eq('thirty-one moves on', bucketFor(31), 'd31_60')
eq('over ninety is the last bucket', bucketFor(200), 'd90plus')
eq('an unknown age has its own bucket', bucketFor(null), 'nodate')

const bills = [
  { id: 'b1', entity_id: 'e1', vendor: 'Adani', amount: 5000, status: 'unpaid', due_date: '2026-06-25' },   // 5 days
  { id: 'b2', entity_id: 'e1', vendor: 'Adani', amount: 12000, status: 'unpaid', due_date: '2026-03-01' },  // 121 days
  { id: 'b3', entity_id: 'e1', vendor: 'Tata', amount: 8000, status: 'unpaid', due_date: '2026-07-15' },    // not due
  { id: 'b4', entity_id: 'e1', vendor: 'Tata', amount: 3000, status: 'paid', due_date: '2026-01-01' },      // settled
  { id: 'b5', entity_id: 'e1', vendor: '', amount: 1000, status: 'unpaid' },                                 // no due date
  { id: 'b6', entity_id: 'e2', vendor: 'Other Co', amount: 9999, status: 'unpaid', due_date: '2026-01-01' }, // other entity
  { id: 'b7', entity_id: 'e1', vendor: 'Gone', amount: 500, status: 'unpaid', due_date: '2026-01-01', deleted_at: '2026-02-01' },
]
const ag = ageing(bills, { kind: 'payable', asOf: ASOF, entityId: 'e1' })
eq('settled bills are excluded', ag.rows.find((r) => r.id === 'b4'), undefined)
eq('another entity’s bills are excluded', ag.rows.find((r) => r.id === 'b6'), undefined)
eq('deleted bills are excluded', ag.rows.find((r) => r.id === 'b7'), undefined)
eq('the rest are outstanding', ag.count, 4)
eq('the total is what is owed', ag.total, 26000)
eq('only the late part is overdue', ag.overdueTotal, 17000)
eq('and the count of it', ag.overdueCount, 2)
eq('the oldest is listed first', ag.rows[0].id, 'b2')
eq('an unnamed vendor is labelled', ag.rows.find((r) => r.id === 'b5').party, 'Unnamed')
const bucketIds = ag.buckets.map((b) => b.id)
ok('a not-yet-due bill is current', bucketIds.includes('current'))
ok('a 121-day-old bill is in the last bucket', bucketIds.includes('d90plus'))
ok('a bill with no date has its own bucket', bucketIds.includes('nodate'))
ok('empty buckets are not shown', !bucketIds.includes('d31_60'), bucketIds.join(','))
eq('every bucket total adds back to the whole',
  round(ag.buckets.reduce((t, b) => t + b.total, 0)), ag.total)

console.log('\n── WHO TO CHASE ──')
const parties = byParty(bills, { kind: 'payable', asOf: ASOF, entityId: 'e1' })
eq('vendors are grouped', parties.length, 3)
eq('the worst offender is first', parties[0].party, 'Adani')
eq('their total is summed', parties[0].total, 17000)
eq('their oldest debt is tracked', parties[0].oldest, 121)
eq('only the overdue part is flagged as such', parties[0].overdue, 17000)
const tata = parties.find((p) => p.party === 'Tata')
eq('a vendor with nothing overdue shows zero overdue', tata.overdue, 0)

console.log('\n── BOTH DIRECTIONS ──')
const owed = [
  { id: 'i1', entity_id: 'e1', payer: 'Client A', amount: 40000, status: 'pending', due_date: '2026-05-01' },
  { id: 'i2', entity_id: 'e1', payer: 'Client B', amount: 10000, status: 'received', due_date: '2026-05-01' },
]
const wc = workingCapital({ expenses: bills, income: owed, asOf: ASOF, entityId: 'e1' })
eq('received income is not still awaited', wc.receivable.count, 1)
eq('receivables total', wc.receivable.total, 40000)
eq('net position is what is owed to us less what we owe', wc.net, 14000)
ok('the overdue-only net is reported too', typeof wc.netOverdue === 'number')
ok('an empty ledger reads as nothing outstanding', /Nothing/.test(describeAgeing(ageing([], { kind: 'payable' }))))
ok('an all-current ledger says none overdue',
  /none overdue/.test(describeAgeing(ageing([{ amount: 1, status: 'unpaid', due_date: '2027-01-01' }], { kind: 'payable', asOf: ASOF }))))
ok('there is a bucket definition for every stage', AGE_BUCKETS.length === 5)

// ════════ ADVANCES ════════
console.log('\n── ADVANCES ──')
const adv = makeAdvance({ entityId: 'e1', partyType: 'contractor', party: 'Sharma Builders', amount: 50000, date: '2026-04-01', expectedBy: '2026-05-31' })
eq('an advance starts fully outstanding', balanceOf(adv, []).outstanding, 50000)
eq('and nothing used', balanceOf(adv, []).used, 0)
ok('a negative advance is refused at the door', makeAdvance({ amount: -100 }).amount === 0)
eq('an unknown party type falls back', makeAdvance({ partyType: 'alien' }).party_type, 'vendor')

const adj1 = makeAdjustment({ advanceId: adv.id, amount: 30000, against: 'exp-1', date: '2026-04-20' })
let bal = balanceOf(adv, [adj1])
eq('an adjustment reduces the balance', bal.outstanding, 20000)
eq('and records what was used', bal.used, 30000)
ok('it is not settled yet', !bal.settled)

ok('over-adjusting is refused', !canAdjust(adv, [adj1], 25000).ok)
ok('and says how much is left', /20000.00/.test(canAdjust(adv, [adj1], 25000).why), canAdjust(adv, [adj1], 25000).why)
ok('adjusting exactly the remainder is allowed', canAdjust(adv, [adj1], 20000).ok)
ok('a zero adjustment is refused', !canAdjust(adv, [adj1], 0).ok)
ok('a negative adjustment is refused', !canAdjust(adv, [adj1], -5).ok)

const adj2 = makeAdjustment({ advanceId: adv.id, amount: 20000, against: 'exp-2' })
bal = balanceOf(adv, [adj1, adj2])
eq('fully adjusted leaves nothing', bal.outstanding, 0)
ok('and is marked settled', bal.settled)
ok('a settled advance is not over-adjusted', !bal.overAdjusted)

// Over-adjustment can only arrive through bad data, and must be visible.
const bad = balanceOf(adv, [adj1, adj2, makeAdjustment({ advanceId: adv.id, amount: 5000 })])
ok('over-adjustment is detected', bad.overAdjusted)

console.log('\n── OUTSTANDING ADVANCES ──')
const advances = [
  adv,
  makeAdvance({ entityId: 'e1', partyType: 'employee', party: 'R. Mehta', amount: 15000, expectedBy: '2026-01-31' }),
  makeAdvance({ entityId: 'e1', partyType: 'vendor', party: 'Tata', amount: 8000, expectedBy: '2027-12-31' }),
  makeAdvance({ entityId: 'e2', partyType: 'vendor', party: 'Elsewhere', amount: 99999 }),
]
const out = outstandingAdvances(advances, [adj1, adj2], { entityId: 'e1', asOf: '2026-06-30' })
eq('settled advances drop off the list', out.count, 2)
eq('another entity’s advances are excluded', out.lines.find((l) => l.advance.party === 'Elsewhere'), undefined)
eq('the total is what is still out there', out.total, 23000)
ok('an advance past its expected date is overdue', out.lines[0].overdue)
eq('and the overdue total is tracked', out.overdueTotal, 15000)
eq('overdue advances are listed first', out.lines[0].advance.party, 'R. Mehta')
const grouped = advancesByParty(advances, [adj1, adj2], { entityId: 'e1', asOf: '2026-06-30' })
eq('advances group by party', grouped.length, 2)
eq('the overdue party leads', grouped[0].party, 'R. Mehta')
eq('the party type is kept', grouped[0].partyType, 'employee')

// ════════ PAYROLL ════════
console.log('\n── STATUTORY PIECES ──')
eq('PF is 12% of basic', providentFund(20000, { ...DEFAULT_PAYROLL_CONFIG.pf, applyCeiling: false }).employee, 2400)
eq('PF respects the wage ceiling', providentFund(50000).employee, 1800)
eq('the employer matches', providentFund(50000).employer, 1800)
eq('PF off means nothing deducted', providentFund(50000, { ...DEFAULT_PAYROLL_CONFIG.pf, enabled: false }).employee, 0)
eq('ESI applies below the ceiling', stateInsurance(18000).employee, 135)
eq('the employer pays more', stateInsurance(18000).employer, 585)
ok('ESI does not apply above the ceiling', !stateInsurance(25000).applicable)
eq('and deducts nothing', stateInsurance(25000).employee, 0)
eq('ESI at exactly the ceiling still applies', stateInsurance(21000).applicable, true)
eq('professional tax follows the slab', professionalTax(9000, 5), 175)
eq('a higher salary pays the top slab', professionalTax(50000, 5), 200)
eq('a low salary pays nothing', professionalTax(5000, 5), 0)
eq('February is higher where tax is due', professionalTax(50000, 2), 300)
eq('but not where none is due', professionalTax(5000, 2), 0)

console.log('\n── A PAYSLIP ──')
const emp = makeEmployee({ entityId: 'e1', name: 'R. Mehta', code: 'emp-1', departmentId: 'd1', basic: 30000, hra: 12000, conveyance: 2000, special: 6000 })
eq('the code is upper-cased', emp.code, 'EMP-1')
eq('gross is the sum of components', grossOf(emp), 50000)
const slip = payslipFor(emp, { period: '2026-05' })
eq('the payslip gross matches', slip.gross, 50000)
eq('PF is capped at the ceiling wage', slip.deductions.pf, 1800)
eq('ESI does not apply at this salary', slip.deductions.esi, 0)
eq('professional tax applies', slip.deductions.professionalTax, 200)
eq('deductions add up', slip.totalDeductions, 2000)
eq('net is gross less deductions', slip.net, 48000)
eq('employer cost includes their PF', slip.employerCost, 51800)
ok('nothing is over-deducted', !slip.overDeducted)

const withTds = payslipFor(emp, { period: '2026-05', tds: 5000, advanceRecovery: 2000 })
eq('TDS is deducted as given', withTds.deductions.tds, 5000)
eq('an advance recovery comes off pay', withTds.deductions.advanceRecovery, 2000)
eq('and the net reflects both', withTds.net, 41000)

const lop = payslipFor(emp, { period: '2026-05', lopDays: 3, monthDays: 30 })
eq('loss of pay pro-rates the gross', lop.gross, 45000)
eq('and the components with it', lop.components.basic, 27000)
eq('PF follows the reduced basic', lop.deductions.pf, 1800)
const fullLop = payslipFor(emp, { period: '2026-05', lopDays: 30, monthDays: 30 })
eq('a full month of LOP pays nothing', fullLop.gross, 0)
eq('and nets nothing', fullLop.net, 0)
eq('more LOP than days is clamped', payslipFor(emp, { period: '2026-05', lopDays: 99, monthDays: 30 }).gross, 0)

const low = makeEmployee({ entityId: 'e1', name: 'Junior', basic: 9000, hra: 3000 })
const lowSlip = payslipFor(low, { period: '2026-05' })
eq('ESI applies to a lower salary', lowSlip.deductions.esi, 90)
ok('and is marked applicable', lowSlip.esiApplicable)
eq('PF is on actual basic below the ceiling', lowSlip.deductions.pf, 1080)
// PT is charged on gross, not basic: 9,000 + 3,000 = 12,000, so the top slab.
eq('professional tax is charged on gross, not basic', lowSlip.deductions.professionalTax, 200)
eq('a gross inside the middle slab pays the middle rate',
  payslipFor(makeEmployee({ entityId: 'e1', name: 'Part timer', basic: 9000 }), { period: '2026-05' }).deductions.professionalTax, 175)

const drowning = payslipFor(low, { period: '2026-05', otherDeductions: 99999 })
eq('net never goes negative', drowning.net, 0)
ok('but over-deduction is flagged', drowning.overDeducted)

console.log('\n── A PAYROLL RUN ──')
const staff = [
  emp,
  low,
  makeEmployee({ entityId: 'e1', name: 'Left', basic: 10000, active: false }),
  makeEmployee({ entityId: 'e1', name: 'Ops person', departmentId: 'd2', basic: 20000, hra: 8000 }),
]
const run = runPayroll(staff, { period: '2026-05', perEmployee: { [emp.id]: { tds: 5000 } } })
eq('inactive employees are left out', run.headcount, 3)
eq('the gross is the sum of the slips', run.gross, round(run.slips.reduce((t, s) => t + s.gross, 0)))
eq('the net is the sum of the nets', run.net, round(run.slips.reduce((t, s) => t + s.net, 0)))
ok('per-employee TDS is applied', run.slips.find((s) => s.employee_id === emp.id).deductions.tds === 5000)
eq('PF payable combines both sides', run.statutory.pf, round(run.slips.reduce((t, s) => t + s.deductions.pf + s.employer.pf, 0)))
ok('the employer cost exceeds the gross', run.employerCost > run.gross)
eq('no problems in a clean run', run.problems, 0)
eq('an empty payroll runs to zero', runPayroll([], { period: '2026-05' }).net, 0)

const depts = [{ id: 'd1', name: 'Finance' }, { id: 'd2', name: 'Operations' }]
const byDept = payrollByDepartment(run, depts)
ok('payroll splits by department', byDept.length >= 2, JSON.stringify(byDept.map((d) => d.name)))
ok('the most expensive department leads', byDept[0].cost >= byDept[1].cost)
ok('an employee with no department is not lost',
  byDept.some((d) => d.name === 'Unassigned') || byDept.every((d) => d.departmentId))
eq('headcount adds back to the run', byDept.reduce((t, d) => t + d.headcount, 0), run.headcount)

console.log('\n── STOCK OVER A PERIOD ──')
// 100 bags in at 200 in April, 40 out in May, 50 more in at 300 in June.
const bag = makeItem({ entityId: 'e1', name: 'Cement', unit: 'bag' })
const flow = [
  makeMovement({ entityId: 'e1', itemId: bag.id, kind: 'receipt', qty: 100, unitCost: 200, date: '2026-04-10' }),
  makeMovement({ entityId: 'e1', itemId: bag.id, kind: 'issue', qty: 40, date: '2026-05-12' }),
  makeMovement({ entityId: 'e1', itemId: bag.id, kind: 'receipt', qty: 50, unitCost: 300, date: '2026-06-03' }),
]
const may = stockOverPeriod([bag], flow, { from: '2026-05-01', to: '2026-05-31' })
eq('the period opens at what was on hand before it', may.openingValue, 20000)
eq('and closes at what is left', may.closingValue, 12000)
eq('nothing was received in May', may.receivedValue, 0)
eq('so 8,000 of stock was consumed', may.consumedValue, 8000)
eq('and the change is the fall', may.change, -8000)

const june = stockOverPeriod([bag], flow, { from: '2026-06-01', to: '2026-06-30' })
eq('June opens where May closed', june.openingValue, may.closingValue)
eq('June receipts are counted at what was paid', june.receivedValue, 15000)
eq('June consumed nothing', june.consumedValue, 0)

const all = stockOverPeriod([bag], flow, {})
eq('with no range the opening is nothing', all.openingValue, 0)
eq('and the close is everything on hand', all.closingValue, 27000)
eq('a movement after the close is not counted',
  stockOverPeriod([bag], flow, { to: '2026-05-31' }).closingValue, 12000)
eq('an empty item list is zero, not a crash', stockOverPeriod([], flow, {}).closingValue, 0)

console.log('\n── PAYROLL OVER A PERIOD ──')
eq('a range covers the months it spans', periodsBetween('2026-04-05', '2026-06-20'), ['2026-04', '2026-05', '2026-06'])
eq('one month is one month', periodsBetween('2026-04-01', '2026-04-30'), ['2026-04'])
eq('a range crossing a year still counts', periodsBetween('2025-11-01', '2026-02-01').length, 4)
eq('no end means the month it starts in', periodsBetween('2026-04-05', ''), ['2026-04'])
eq('a backwards range is empty', periodsBetween('2026-06-01', '2026-04-01'), [])
eq('no range at all is empty', periodsBetween('', ''), [])
ok('an absurd range cannot spin', periodsBetween('1900-01-01', '2999-12-01').length <= 600)

const joiner = makeEmployee({ entityId: 'e1', name: 'New Start', basic: 20000, joinedOn: '2026-05-20' })
const oldHand = makeEmployee({ entityId: 'e1', name: 'Long Serving', basic: 20000, joinedOn: '2024-01-01' })
eq('someone hired in May was not on the payroll in April', onPayrollIn([joiner, oldHand], '2026-04').length, 1)
eq('and is from the month they joined', onPayrollIn([joiner, oldHand], '2026-05').length, 2)
eq('an employee with no join date is always counted', onPayrollIn([makeEmployee({ name: 'Unknown' })], '2020-01').length, 1)
eq('an inactive employee never is',
  onPayrollIn([makeEmployee({ name: 'Gone', active: false })], '2026-05').length, 0)
eq('a run for a month excludes those not yet hired', runPayroll([joiner, oldHand], { period: '2026-04' }).headcount, 1)

const quarter = payrollOverPeriods([joiner, oldHand], periodsBetween('2026-04-01', '2026-06-30'))
eq('three months are run', quarter.months.length, 3)
eq('the gross adds the months up', quarter.gross, round(quarter.months.reduce((t, r) => t + r.gross, 0)))
eq('headcount is the most anyone was paying, not the sum', quarter.headcount, 2)
ok('the employer cost exceeds the gross over the period', quarter.employerCost > quarter.gross)
eq('April is the cheaper month', quarter.months[0].gross < quarter.months[1].gross, true)
eq('an empty range runs to zero', payrollOverPeriods([oldHand], []).gross, 0)
eq('and so does an empty payroll', payrollOverPeriods([], periodsBetween('2026-04-01', '2026-06-30')).gross, 0)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
