// The construction sample, checked for being a believable set of books.
//
// "It loads" is not the assertion worth making. A demo whose stock goes
// negative, whose running-account bills go backwards, or whose flats are all
// sold and fully paid teaches the app's own warnings as the normal state of
// the world — and the warnings are most of what the app is for. So these read
// the sample back through the same report functions the screens use.
import { buildSample } from '../../src/lib/sampleSite.js'
import { stockOf, stockReport, usageBySite } from '../../src/lib/inventory.js'
import { billLadder, subcontractReport } from '../../src/lib/subcontract.js'
import { siteProgress } from '../../src/lib/progress.js'
import { plantReport } from '../../src/lib/plant.js'
import { salesReport } from '../../src/lib/sales.js'
import { labourReport } from '../../src/lib/labour.js'
import { projectSummary } from '../../src/lib/projects.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

const E = 'ent-sample'
const s = buildSample(E)
const MD = 'sample-site-md', PG = 'sample-site-pg', HV = 'sample-site-hv'
const LEDGERS = ['projects', 'items', 'movements', 'muster', 'workOrders', 'raBills',
  'workItems', 'measurements', 'plant', 'plantLogs', 'units', 'planStages', 'receipts']

console.log('\n── IT IS ONE COMPANY, AND EVERY ROW SAYS SO ──')
for (const key of LEDGERS) ok(`${key} is not empty`, s[key].length > 0, `${s[key].length}`)
ok('every corporate row carries the company', LEDGERS.every((k) => s[k].every((r) => r.entity_id === E)))
ok('and no two rows in a ledger share an id',
  LEDGERS.every((k) => new Set(s[k].map((r) => r.id)).size === s[k].length))
// A demo that writes into the wrong company's books is worse than no demo.
ok('a different company gets its own rows', buildSample('other').projects.every((p) => p.entity_id === 'other'))

console.log('\n── THE STOCK BOOK BALANCES ──')
// The thing that must not happen. `negative` is true when any one store is
// short, not just when the company total is — a yard in credit hiding a site
// in deficit is exactly the error this reports.
for (const item of s.items) {
  const at = stockOf(item, s.movements)
  ok(`${item.name} is never short at any store`, !at.negative,
    JSON.stringify(at.byLocation))
}
const book = stockReport(s.items, s.movements)
ok('the stock is worth something', book.totalValue > 0, String(book.totalValue))
ok('some of it is in the yard and some on the sites',
  book.centralValue > 0 && book.onSitesValue > 0, `${book.centralValue} / ${book.onSitesValue}`)
// One item deliberately run down, so the reorder warning is a thing you can
// see rather than a thing described in a tooltip.
ok('exactly one material is below its reorder level', book.itemsBelowReorder === 1,
  String(book.itemsBelowReorder))
eq('and it is the doors',
  book.lines.filter((l) => l.belowReorder).map((l) => l.item.name), ['Flush door 32mm with frame'])

console.log('\n── REJECTED MATERIAL IS NOT THE JOB’S COST ──')
const tiles = stockOf(s.items.find((i) => i.id === 'sample-item-tile'), s.movements)
ok('a lot was sent back', tiles.rejected > 0, String(tiles.rejected))
ok('and it left at what it came in at', tiles.rejectedValue > 0, String(tiles.rejectedValue))
ok('some was wasted too, which is a different thing',
  stockOf(s.items.find((i) => i.id === 'sample-item-cement'), s.movements).wasted > 0)
// Issues are what a site is charged. A rejection is a return to the vendor and
// never reaches a job at all.
// What each job was actually charged, valued at the running average when the
// material left the shelf — not at today's average, which is zero once an item
// is fully issued.
const used = usageBySite(s.items, s.movements, { projects: s.projects })
const charged = (id) => used.find((g) => g.projectId === id)
ok('the tower has been charged for material', (charged(MD)?.value || 0) > 0, JSON.stringify(charged(MD)?.value))
ok('so have the villas', (charged(PG)?.value || 0) > 0, JSON.stringify(charged(PG)?.value))
ok('and the tower, being the bigger job, for more',
  charged(MD).value > charged(PG).value, `${charged(MD).value} vs ${charged(PG).value}`)
// Wastage is charged to the job that wasted it; a rejection never reaches one.
ok('wastage lands on a job', used.some((g) => g.wastedValue > 0))
ok('no material is charged to no job at all', !used.some((g) => !g.projectId),
  JSON.stringify(used.map((g) => g.projectId)))
ok('and each charged job names itself', used.every((g) => g.project?.name),
  JSON.stringify(used.map((g) => g.project?.name)))

console.log('\n── THE RUNNING ACCOUNT RUNS FORWARD ──')
for (const order of s.workOrders) {
  const ladder = billLadder(order, s.raBills)
  const certified = ladder.lines.map((l) => Number(l.bill.certified_to_date))
  ok(`${order.contractor} states each bill to date, higher than the last`,
    certified.every((v, i) => i === 0 || v > certified[i - 1]), JSON.stringify(certified))
  ok(`${order.contractor} never certifies more than was claimed`,
    ladder.lines.every((l) => Number(l.bill.certified_to_date) <= Number(l.bill.claimed_to_date)))
  // The line the module exists for: payable now is certified-to-date less
  // everything certified before it.
  ok(`${order.contractor}'s bills are differences, not repeats`,
    ladder.lines.every((l, i) => l.gross === (i === 0 ? certified[0] : certified[i] - certified[i - 1])),
    JSON.stringify(ladder.lines.map((l) => l.gross)))
  ok(`${order.contractor} has not over-claimed the order`, !ladder.overOrder)
}
const subs = subcontractReport(s.workOrders, s.raBills, { entityId: E })
ok('retention is being held', subs.retentionHeld > 0, String(subs.retentionHeld))
ok('and nothing is flagged as over-claimed', subs.problems === 0, String(subs.problems))

console.log('\n── THE TOWER IS PART BUILT ──')
const built = siteProgress(s.workItems, s.measurements, { projectId: MD })
ok('progress is a real number', typeof built.percent === 'number', String(built.percent))
ok('and it is part way, not nothing and not finished',
  built.percent > 15 && built.percent < 85, String(built.percent))
// Weighted by value: four of six lines are barely started, so counting lines
// would report a much higher figure than the money does.
const done = built.lines.filter((l) => l.percent >= 99).length
ok('counting finished lines would say something different',
  Math.round((done / built.lines.length) * 100) !== Math.round(built.percent),
  `${done}/${built.lines.length} lines vs ${built.percent}%`)
ok('one re-measurement found less than the last one did',
  s.measurements.some((m) => m.qty < 0))
ok('and no line is measured past what was planned',
  built.lines.every((l) => l.percent <= 100), JSON.stringify(built.lines.map((l) => l.percent)))

console.log('\n── MACHINES, AND THE HOURS NOBODY WORKED ──')
const yard = plantReport(s.plant, s.plantLogs, { entityId: E })
ok('something was idle', yard.idleCost > 0, String(yard.idleCost))
ok('something else was broken, which is not the same', yard.breakdownCost > 0, String(yard.breakdownCost))
ok('and there are days with no sheet at all', yard.unloggedDays > 0, String(yard.unloggedDays))
ok('one machine is owned rather than hired',
  s.plant.some((p) => p.ownership === 'owned') && s.plant.some((p) => p.ownership === 'hired'))

console.log('\n── FLATS: SOLD, UNSOLD, AND PAID FOR ──')
const sold = salesReport(s.units, s.planStages, s.receipts, { entityId: E, projectId: MD })
ok('some are sold', sold.sold > 0, String(sold.sold))
ok('some are still available', sold.available > 0, String(sold.available))
ok('and one is held back, which is not the same as available', sold.heldBack > 0, String(sold.heldBack))
// The number a builder actually wants: agreed is not banked.
ok('what has been received is less than what was agreed',
  sold.received > 0 && sold.received < sold.agreed, `${sold.received} of ${sold.agreed}`)
ok('so there is a balance still to come', sold.balance > 0, String(sold.balance))
ok('nobody has overpaid', sold.overpaid === 0, String(sold.overpaid))
ok('and no receipt is against a flat nobody bought',
  s.receipts.every((r) => {
    const u = s.units.find((x) => x.id === r.unit_id)
    return ['booked', 'agreement', 'registered', 'possession'].includes(u?.status)
  }))
ok('only the units being bought have a payment plan',
  new Set(s.planStages.map((p) => p.unit_id)).size === sold.sold, String(sold.sold))

console.log('\n── THREE JOBS, AND ONE OF THEM WENT OVER ──')
const labour = labourReport(s.muster, { entityId: E })
ok('the muster roll costs something', labour.total > 0, String(labour.total))
const at = (id) => {
  const p = s.projects.find((x) => x.id === id)
  return projectSummary(p, s.expenses, s.income, {
    subcontractCost: subcontractReport(s.workOrders, s.raBills, { entityId: E, projectId: id }).certified,
    labourCost: labourReport(s.muster, { entityId: E, projectId: id }).total,
  })
}
const hv = at(HV), md = at(MD), pg = at(PG)
ok('the finished bungalow is over what it was costed at', hv.overEstimate,
  `${hv.spent} against ${s.projects.find((p) => p.id === HV).estimate}`)
// The distinction the projects screen exists to make: over the costing and
// still making money is not a contradiction, it is most jobs.
ok('and is still not losing money', !hv.losing, JSON.stringify({ spent: hv.spent, billed: hv.billed }))
ok('the two live jobs are inside their costing', !md.overEstimate && !pg.overEstimate,
  JSON.stringify({ md: md.spent, pg: pg.spent }))
ok('the tower has money still to come in', md.outstanding > 0, String(md.outstanding))

console.log('\n── AND A COST BOOKED TO NOTHING AT ALL ──')
// The point of the whole preceding change: an overhead is a real entry with no
// asset and no job, and a sample that never shows one is hiding it.
const loose = s.expenses.filter((e) => !e.project_id && !e.property_id)
ok('there are overheads', loose.length >= 2, String(loose.length))
ok('and they are not booked to a site by accident', loose.every((e) => !e.project_id))
ok('no entry in the sample names an asset, because the company owns none',
  [...s.expenses, ...s.income].every((e) => !e.property_id))
ok('every other entry names one of the three jobs',
  s.expenses.filter((e) => e.project_id).every((e) => [MD, PG, HV].includes(e.project_id)))
ok('and there is an unpaid bill and an unreceived invoice, so both states show',
  s.expenses.some((e) => e.status === 'unpaid') && s.income.some((e) => e.status === 'unpaid'))

console.log('\n── NOTHING IS DATED IN THE FUTURE ──')
const today = new Date().toISOString().slice(0, 10)
const dated = [...s.movements, ...s.muster, ...s.raBills, ...s.measurements, ...s.plantLogs,
  ...s.receipts, ...s.expenses, ...s.income]
ok('every event already happened', dated.every((r) => r.date <= today),
  JSON.stringify(dated.filter((r) => r.date > today).slice(0, 3)))
ok('but two of the three jobs are still due to finish',
  s.projects.filter((p) => p.due_on > today).length === 2,
  JSON.stringify(s.projects.map((p) => p.due_on)))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
