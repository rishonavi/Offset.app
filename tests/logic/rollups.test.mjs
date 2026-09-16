// The parts have to add up to the whole, and the leftovers have to be visible.
//
// Almost every screen in this app shows a total and a breakdown of it. Two
// things go wrong with that arrangement and neither shows up as an error:
//
//   **The parts stop adding to the whole.** A filter added to the breakdown and
//   not to the total, a rounding applied twice, a category quietly dropped.
//   Every figure still looks like a figure and the column no longer sums.
//
//   **The leftovers get absorbed.** Costs booked to no site, stock at the yard
//   rather than a store, a team in no department. The tidy thing is to leave
//   them out of the breakdown; the honest thing is to show them, because they
//   are exactly the rows nobody is looking after.
//
// This asks the same two questions of every hierarchy in the app at once,
// against the sample rather than a fixture — real quantities, real rates, real
// rounding. A suite of per-module tests can each be right about its own numbers
// while the family drifts.
import { buildSample } from '../../src/lib/sampleSite.js'
import { stockReport, usageBySite } from '../../src/lib/inventory.js'
import { subcontractReport, retentionSchedule, billLadder } from '../../src/lib/subcontract.js'
import { salesReport, unitLedger } from '../../src/lib/sales.js'
import { labourReport } from '../../src/lib/labour.js'
import { plantReport } from '../../src/lib/plant.js'
import { siteProgress } from '../../src/lib/progress.js'
import { runPayroll, makeEmployee } from '../../src/lib/payroll.js'
import { costCentreReport, UNASSIGNED } from '../../src/lib/costcentres.js'
import { makeDepartment } from '../../src/lib/corporate.js'
import { tdsLedger } from '../../src/lib/tds.js'
import { commitments } from '../../src/lib/commitments.js'
import { sheetResult, makeStockCount } from '../../src/lib/stockcount.js'
import { totalsByPlace } from '../../src/lib/stats.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
// Exact to the paisa. A tolerance here would hide the very drift this file
// exists to find — a rounding applied twice is worth a paisa per row and a
// fortune across a year.
const adds = (name, parts, whole) => {
  const sum = r2(parts.reduce((t, n) => t + (Number(n) || 0), 0))
  ok(name, sum === r2(whole), `parts come to ${sum}, the whole says ${r2(whole)}`)
}

const E = 'e1'
const b = buildSample(E)

console.log('\n── STOCK ──')
const stock = stockReport(b.items, b.movements)
ok('there is stock to check', stock.totalValue > 0, String(stock.totalValue))
adds('the yard and the sites make the company', [stock.centralValue, stock.onSitesValue], stock.totalValue)
adds('and so does every store added up', stock.byLocation.map((l) => l.value), stock.totalValue)
adds('and every material', stock.lines.map((l) => l.value), stock.totalValue)
// The leftovers, which here are the yard: it has no id, and a breakdown keyed
// on site id is exactly the sort that drops it.
ok('the yard is a store like any other', stock.byLocation.some((l) => !l.locationId),
  stock.byLocation.map((l) => l.locationId).join(','))
ok('and it is not empty', (stock.byLocation.find((l) => !l.locationId)?.value || 0) > 0)

console.log('\n── WHAT EACH SITE BURNED ──')
const used = usageBySite(b.items, b.movements, { projects: b.projects })
adds('the sites account for everything issued',
  used.map((u) => u.value), r2(used.reduce((t, u) => t + u.value, 0)))
// Material issued from the yard with no job named is a real state, and a report
// that only lists sites loses it silently.
ok('a group for material booked to no site exists when there is any',
  used.every((u) => 'projectId' in u), JSON.stringify(used.map((u) => u.projectId)))

console.log('\n── SUBCONTRACTS ──')
const subs = subcontractReport(b.workOrders, b.raBills, { entityId: E })
adds('the orders add to the certified total', subs.lines.map((l) => l.certifiedToDate), subs.certified)
adds('and the retention held', subs.lines.map((l) => l.retentionHeld), subs.retentionHeld)
for (const line of subs.lines) {
  adds(`${line.order.contractor}: the bills add to what is certified`,
    line.lines.map((r) => r.gross), line.certifiedToDate)
  // Every bill: gross out, less what was held back, is what was paid.
  for (const r of line.lines) {
    adds(`RA ${r.bill.number} for ${line.order.contractor}: net is gross less the deductions`,
      [r.net, r.retention, r.tds, r.recovered], r.gross)
  }
  const sched = retentionSchedule(line.order, line)
  adds(`${line.order.contractor}: the two tranches are the whole accrual`,
    sched.tranches.map((t) => t.amount), sched.accrued)
}

console.log('\n── FLATS AND SHOPS ──')
const book = salesReport(b.units, b.planStages, b.receipts, { entityId: E })
ok('there are units to check', book.count > 0)
for (const line of book.lines) {
  adds(`${line.unit.name}: the price and the charges are what was agreed`,
    [line.price, line.otherCharges], line.agreed)
  adds(`${line.unit.name}: the plan and the gap are what was agreed`,
    [line.planned, line.planGap], line.agreed)
  adds(`${line.unit.name}: the instalments are the plan`,
    line.lines.map((s) => s.amount), line.planned)
  // A plan that does not add to the price is ordinary and is shown as a gap
  // rather than being quietly stretched to fit.
  adds(`${line.unit.name}: what is left is the price less what came in`,
    [line.received, line.balance], line.agreed)
}
adds('and the sold units add to the book', book.lines.filter((l) => l.sold).map((l) => l.agreed), book.agreed)

console.log('\n── THE MUSTER ──')
const lab = labourReport(b.muster, { entityId: E })
adds('the day rate and the overtime are the wage bill', [lab.base, lab.overtime], lab.total)
// `cost` on a trade is already the day rate *and* the overtime — adding the
// overtime column to it double-counts, which the first version of this file did
// and got away with because the sample had no overtime at all.
ok('there is overtime to check', lab.overtime > 0, String(lab.overtime))
adds('every trade adds to the wage bill', lab.byTrade.map((t) => t.cost), lab.total)
adds('and so does every site', lab.bySite.map((s) => s.cost), lab.total)
adds('the overtime by trade is the overtime', lab.byTrade.map((t) => t.overtime), lab.overtime)
adds('and by site', lab.bySite.map((s) => s.overtime), lab.overtime)
adds('and every day adds up too', lab.days.map((d) => d.cost), lab.total)
// The same money three ways. A breakdown that agrees with the total but not
// with another breakdown is the drift this catches.
ok('so the breakdowns agree with each other',
  r2(lab.byTrade.reduce((t, x) => t + x.cost, 0)) === r2(lab.bySite.reduce((t, x) => t + x.cost, 0)))

console.log('\n── THE YARD ──')
const yard = plantReport(b.plant, b.plantLogs, { entityId: E })
adds('every machine adds to what the plant cost', yard.lines.map((l) => l.total), yard.total)
adds('and hire, fuel and depreciation are that cost',
  [yard.hireCost, yard.fuelCost, yard.depreciation], yard.total)
adds('the hours are working, idle and broken down',
  [yard.workingHours, yard.idleHours, yard.breakdownHours], yard.availableHours)

console.log('\n── THE SCHEDULE OF WORK ──')
const prog = siteProgress(b.workItems, b.measurements)
adds('every item adds to the schedule value', prog.lines.map((l) => l.value), prog.value)
adds('and to what has been earned', prog.lines.map((l) => l.earned), prog.earned)
adds('and every stage adds to the same value', prog.stages.map((s) => s.value), prog.value)
adds('and to the same earned', prog.stages.map((s) => s.earned), prog.earned)

console.log('\n── A PAYROLL ──')
const staff = [
  makeEmployee({ entityId: E, name: 'A', basic: 30000, hra: 12000 }),
  makeEmployee({ entityId: E, name: 'B', basic: 18000 }),
  makeEmployee({ entityId: E, name: 'C', basic: 9000 }),
]
const run = runPayroll(staff, { period: '2026-03' })
adds('every slip adds to the gross', run.slips.map((s) => s.gross), run.gross)
// `deductions` on a slip is the breakdown; `totalDeductions` is the figure.
// Adding up the wrong one comes to nothing at all, which is how a total that
// silently reads zero gets written.
adds('and to the deductions', run.slips.map((s) => s.totalDeductions), run.deductions)
for (const slip of run.slips) {
  adds(`${slip.employee_id}: the components are the gross`, Object.values(slip.components), slip.gross)
  adds(`${slip.employee_id}: take-home is the gross less the deductions`,
    [slip.net, slip.totalDeductions], slip.gross)
}
adds('and take-home is the gross less them', [run.net, run.deductions], run.gross)
adds('every slip adds to the take-home', run.slips.map((s) => s.net), run.net)

console.log('\n── COST CENTRES ──')
// The bug this family was named after: a division counts the teams inside it,
// so the column does not add to the total and must not — what has to add up is
// the roots plus whatever is booked to nothing at all.
const depts = [
  makeDepartment({ entityId: E, id: 'd-build', name: 'Construction', budgetMonthly: 800000 }),
  makeDepartment({ entityId: E, id: 'd-a', name: 'Site A', parentId: 'd-build', budgetMonthly: 400000 }),
  makeDepartment({ entityId: E, id: 'd-ho', name: 'Head office', budgetMonthly: 200000 }),
]
const month = '2026-06'
const spend = [
  { id: 'x1', entity_id: E, department_id: 'd-a', date: `${month}-04`, amount: 250000, category: 'Materials' },
  { id: 'x2', entity_id: E, department_id: 'd-build', date: `${month}-08`, amount: 120000, category: 'Materials' },
  { id: 'x3', entity_id: E, department_id: 'd-ho', date: `${month}-11`, amount: 90000, category: 'Other' },
  // Booked to nothing at all, which is the row that gets absorbed.
  { id: 'x4', entity_id: E, department_id: null, date: `${month}-15`, amount: 60000, category: 'Other' },
]
const centres = costCentreReport(depts, spend, [], { entityId: E, months: [month] })
const roots = centres.lines.filter((l) => l.depth === 0)
// Money booked to no cost centre is a figure of its own rather than a made-up
// department, which is the right call — a fake row in a list of real ones
// invites somebody to give it a budget. What matters is that it is on the
// object at all, and that it is what closes the gap.
adds('the top-level centres and the unassigned make the total',
  [...roots.map((l) => l.spent), centres.unassigned], centres.spent)
ok('the unassigned is reported rather than absorbed', centres.unassigned === 60000,
  String(centres.unassigned))
ok('with a count of the entries in it', centres.unassignedEntries === 1, String(centres.unassignedEntries))
ok('and a share of the whole', centres.unassignedPercent > 0, String(centres.unassignedPercent))
ok('and it is not a department anybody could budget for',
  !roots.some((l) => l.department.id === UNASSIGNED), roots.map((l) => l.department.id).join(','))
// And the thing that must NOT add up, asserted as such so nobody "fixes" it.
const flat = r2(centres.lines.reduce((t, l) => t + l.spent, 0))
ok('every line added up is more than the total, because a division counts its teams',
  flat > centres.spent, `${flat} against ${centres.spent}`)

console.log('\n── TAX DEDUCTED ──')
const tax = tdsLedger(b.workOrders, b.raBills, { entityId: E })
adds('every contractor adds to what was paid', tax.lines.map((l) => l.paid), tax.paid)
adds('and to what is required', tax.lines.map((l) => l.tds), tax.required)
adds('and to what was deducted', tax.lines.map((l) => l.deducted), tax.deducted)
adds('the quarters add to the year', tax.quarters.map((q) => q.paid), tax.paid)
adds('and so does the tax on them', tax.quarters.map((q) => q.tds), tax.required)
for (const line of tax.lines) {
  adds(`${line.party}: the payments add to the year`, line.lines.map((l) => l.amount), line.paid)
}

console.log('\n── WHAT IS PROMISED ──')
const c = commitments(b, { entityId: E })
adds('committed and owed are what has been agreed in all', [c.committed, c.dueOut], c.committedAndDue)
adds('and the gap is what comes in less what goes out', [c.gap, c.dueOut], c.dueIn)

console.log('\n── A COUNT SHEET ──')
const counts = [
  makeStockCount({ entityId: E, itemId: 'a', date: month, countedQty: 90, bookQty: 100, avgCost: 400 }),
  makeStockCount({ entityId: E, itemId: 'b', date: month, countedQty: 110, bookQty: 100, avgCost: 60 }),
  makeStockCount({ entityId: E, itemId: 'c', date: month, countedQty: 50, bookQty: 50, avgCost: 10 }),
]
const sheet = sheetResult(counts, [], { entityId: E })
adds('short, over and square are every line counted', [sheet.short, sheet.over, sheet.square], sheet.count)
// The two are kept apart on purpose, so what has to add up is the net.
adds('and the net is the overage less the shortage', [sheet.overValue, -sheet.shortValue], sheet.netValue)
ok('which is not the same as either', sheet.netValue !== sheet.shortValue && sheet.netValue !== sheet.overValue)

console.log('\n── AND WHAT IS BOOKED TO NOTHING ──')
// Every one of these is a row a tidy breakdown drops. They are the rows nobody
// is looking after, which is exactly why they have to be on the screen.
const place = totalsByPlace(b.expenses.map((e) => ({ ...e, entity_id: E })), (row) => ({
  kind: row.project_id ? 'site' : 'none',
  id: row.project_id || null,
  name: row.project_id ? (b.projects.find((p) => p.id === row.project_id)?.name || 'Unknown') : 'Not booked',
}))
adds('every place adds to what was spent',
  place.map((v) => v.value), r2(b.expenses.reduce((t, e) => t + e.amount, 0)))
ok('and the unbooked overheads are one of the places',
  place.some((v) => /Not booked/.test(v.name)), place.map((v) => v.name).join(','))
ok('carrying the head office rent and the audit fee',
  place.find((v) => /Not booked/.test(v.name))?.value === 210000,
  String(place.find((v) => /Not booked/.test(v.name))?.value))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
