// A site, and whether anyone can tell it is losing money.
//
// The arithmetic here is small; the distinctions are not. Contract value and
// estimate are different numbers answering different questions, spent counts
// bills that have not been paid, and a job with nothing costed must not report
// as being on budget.
import {
  makeProject, projectSummary, projectReport, unattributed, daysLate,
  PROJECT_STATUS, PROJECT_STATUS_IDS, isOpen,
} from '../../src/lib/projects.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${e ? '  — ' + e : ''}`) }
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

console.log('\n── A SITE ──')
const site = makeProject({
  entityId: 'e1', name: '  Marine Drive Tower  ', code: 'md-1', client: 'Navi Realty',
  contractValue: 10000000, estimate: 8000000, startedOn: '2026-01-10', dueOn: '2026-12-31', status: 'active',
})
ok('a site gets an id', Boolean(site.id))
eq('its name is trimmed', site.name, 'Marine Drive Tower')
eq('its code is upper-cased, the way a delivery note writes it', site.code, 'MD-1')
eq('the contract value is kept', site.contract_value, 10000000)
eq('and the estimate separately', site.estimate, 8000000)
eq('a nameless site still has a name', makeProject({}).name, 'Untitled site')
eq('an unknown status falls back to planned', makeProject({ status: 'nonsense' }).status, 'planned')
eq('a negative contract is floored', makeProject({ contractValue: -5 }).contract_value, 0)
ok('two sites never share an id', makeProject({}).id !== makeProject({}).id)

console.log('\n── WHAT IT HAS COST ──')
const expenses = [
  { id: 'x1', project_id: site.id, amount: 3000000, status: 'paid' },
  { id: 'x2', project_id: site.id, amount: 2000000, status: 'unpaid' },
  { id: 'x3', project_id: 'other', amount: 500000, status: 'paid' },
  { id: 'x4', project_id: site.id, amount: 999, status: 'paid', deleted_at: '2026-05-01' },
  { id: 'x5', amount: 400000, status: 'paid' },
]
const income = [
  { id: 'i1', project_id: site.id, amount: 4000000, status: 'received' },
  { id: 'i2', project_id: site.id, amount: 1500000, status: 'pending' },
  { id: 'i3', project_id: 'other', amount: 90000, status: 'received' },
]
const s = projectSummary(site, expenses, income)
// An unpaid bill is money committed. A cost report that counts only what has
// left the bank tells you the job is cheaper than it is.
eq('spent counts unpaid bills too', s.spent, 5000000)
eq('and says how much has not gone out yet', s.unpaid, 2000000)
eq('billed is everything invoiced', s.billed, 5500000)
eq('outstanding is what the client has not paid', s.outstanding, 1500000)
eq('another site’s costs are not counted', s.entries, 4)
eq('nor a deleted row', s.spent, 5000000)

console.log('\n── TWO QUESTIONS, TWO ANSWERS ──')
eq('against the estimate it is under', s.overrun, -3000000)
eq('which is 63% of what was costed', s.usedPercent, 63)
ok('so it is not overrunning', !s.overEstimate)
eq('against the contract the margin is 5,000,000', s.margin, 5000000)
eq('or 50%', s.marginPercent, 50)
ok('and it is not losing', !s.losing)

// The case the two numbers exist to tell apart: over the costing, still making
// money. One report would call this a failure and the other a success.
const tight = makeProject({ entityId: 'e1', name: 'Tight', contractValue: 1000000, estimate: 500000 })
const over = projectSummary(tight, [{ project_id: tight.id, amount: 700000, status: 'paid' }], [])
ok('a job can be over its estimate', over.overEstimate)
ok('and still be making money', !over.losing && over.margin === 300000, String(over.margin))

const bad = makeProject({ entityId: 'e1', name: 'Bad', contractValue: 1000000, estimate: 1200000 })
const losing = projectSummary(bad, [{ project_id: bad.id, amount: 1100000, status: 'paid' }], [])
ok('and it can be inside its estimate', !losing.overEstimate)
ok('while still losing money', losing.losing, `margin ${losing.margin}`)

console.log('\n── NOTHING COSTED IS NOT ON BUDGET ──')
const blank = makeProject({ entityId: 'e1', name: 'No figures' })
const none = projectSummary(blank, [{ project_id: blank.id, amount: 50000, status: 'paid' }], [])
ok('a site with no estimate says so', none.uncosted)
eq('rather than reporting a percentage', none.usedPercent, null)
eq('and margin is not invented', none.margin, null)
ok('but what it cost is still known', none.spent === 50000)

console.log('\n── EVERY SITE AT ONCE ──')
const sites = [site, tight, bad, blank, makeProject({ entityId: 'e1', name: 'Done', status: 'completed' })]
const all = [
  ...expenses,
  { project_id: tight.id, amount: 700000, status: 'paid' },
  { project_id: bad.id, amount: 1100000, status: 'paid' },
  { project_id: blank.id, amount: 50000, status: 'paid' },
]
const report = projectReport(sites, all, income)
eq('every site is a line', report.count, 5)
// One, not two: `bad` is losing money while still inside its estimate, which
// is the whole reason the two numbers are kept apart. A report that counted it
// as overrunning would be answering the other question.
eq('one is over its estimate', report.overrunning, 1)
ok('and the one losing money is not the one overrunning',
  report.lines.find((l) => l.project.name === 'Bad').losing &&
  !report.lines.find((l) => l.project.name === 'Bad').overEstimate)
// Summing the negatives in would net a disaster against a saving and report
// neither, so only the overruns are added up.
eq('and the overrun total counts only those', report.overrunTotal, 200000)
ok('the worst is first', report.lines[0].overEstimate, report.lines[0].project.name)
ok('and the deeper overrun leads', report.lines[0].overrun >= report.lines[1].overrun)
eq('open-only leaves the finished one out', projectReport(sites, all, income, { openOnly: true }).count, 4)
eq('a site with nothing costed is counted as such', report.uncosted, 2)
eq('and none of these is past its date', report.late, 0)
eq('one that is, is counted',
  projectReport([makeProject({ name: 'Overdue', dueOn: '2020-01-01', status: 'active' })], [], []).late, 1)
eq('an empty portfolio is zero, not a crash', projectReport([], [], []).spent, 0)

console.log('\n── STOCK OFF THE SHELF IS A COST OF THE JOB ──')
// A builder with a central store who counts only the bills finds every job
// profitable and the company losing money. The material was paid for when it
// was bought; it becomes a cost of *this* job when it leaves the shelf for it.
const store = makeProject({ entityId: 'e1', name: 'Store-fed', contractValue: 1000000, estimate: 800000 })
const bills = [{ project_id: store.id, amount: 300000, status: 'paid' }]
const withStock = projectSummary(store, bills, [], { materialCost: 600000 })
eq('bills alone would say three lakh', projectSummary(store, bills, []).spent, 300000)
eq('with the stores it is nine', withStock.spent, 900000)
eq('and the two are still told apart', [withStock.directCost, withStock.materialCost], [300000, 600000])
ok('which turns an apparent profit into an overrun', withStock.overEstimate && !projectSummary(store, bills, []).overEstimate)
// Material off the shelf was paid for at purchase. Counting it as unpaid would
// report a debt to nobody.
eq('nothing is owed for material already bought', withStock.unpaid, 0)
const halfBilled = projectSummary(store, [...bills, { project_id: store.id, amount: 200000, status: 'unpaid' }], [], { materialCost: 600000 })
eq('an unpaid bill still is owed', halfBilled.unpaid, 200000)
eq('and does not drag the stores in with it', halfBilled.spent, 1100000)
eq('a negative material cost cannot flatter a job', projectSummary(store, bills, [], { materialCost: -999 }).spent, 300000)

const storeReport = projectReport([store], bills, [], { materialCosts: { [store.id]: 600000 } })
eq('the portfolio counts the stores too', storeReport.spent, 900000)
eq('and keeps the split', [storeReport.directCost, storeReport.materialCost], [300000, 600000])
eq('a site with no material costed is unaffected', projectReport([store], bills, []).spent, 300000)

console.log('\n── FOUR KINDS OF COST, ONE JOB ──')
// A job is not its bills. It is its bills, the material off the shelf, the
// muster roll, and what the subcontractors were certified for — and any one of
// those left out makes the job look cheaper than it is.
const four = makeProject({ entityId: 'e1', name: 'All four', contractValue: 5000000, estimate: 4000000 })
const fourBills = [{ project_id: four.id, amount: 500000, status: 'paid' }]
const all4 = projectSummary(four, fourBills, [], { materialCost: 1200000, labourCost: 900000, subcontractCost: 1600000 })
eq('each kind is kept separate',
  [all4.directCost, all4.materialCost, all4.labourCost, all4.subcontractCost],
  [500000, 1200000, 900000, 1600000])
eq('and they add to what the job cost', all4.spent, 4200000)
ok('which is over the estimate the bills alone were nowhere near',
  all4.overEstimate && !projectSummary(four, fourBills, []).overEstimate)
// Retention and TDS change when money leaves, not whether the work was done,
// so the subcontractor figure here is what was certified.
eq('nothing is owed on labour or material already spent', all4.unpaid, 0)
eq('a negative cost cannot flatter a job',
  projectSummary(four, fourBills, [], { labourCost: -1, subcontractCost: -1 }).spent, 500000)

const fourReport = projectReport([four], fourBills, [], {
  materialCosts: { [four.id]: 1200000 },
  labourCosts: { [four.id]: 900000 },
  subcontractCosts: { [four.id]: 1600000 },
})
eq('the portfolio totals each kind',
  [fourReport.directCost, fourReport.materialCost, fourReport.labourCost, fourReport.subcontractCost],
  [500000, 1200000, 900000, 1600000])
eq('and the whole', fourReport.spent, 4200000)

console.log('\n── WHAT WAS NEVER BOOKED TO A SITE ──')
// The number that quietly grows. A site's true cost is wrong by whatever sits
// in here, and nobody looks for a total nobody prints.
const loose = unattributed(expenses, income)
eq('costs with no site are totalled', loose.spent, 400000)
eq('and counted', loose.count, 1)
eq('nothing loose is zero', unattributed([], []).spent, 0)

console.log('\n── LATE ──')
const late = makeProject({ entityId: 'e1', name: 'Late', dueOn: '2026-01-01', status: 'active' })
eq('a live job past its date is late, in days', daysLate(late, new Date('2026-01-11T00:00:00Z')), 10)
eq('before the date it is not', daysLate(late, new Date('2025-12-01T00:00:00Z')), null)
eq('a completed job is never late', daysLate({ ...late, status: 'completed' }, new Date('2027-01-01T00:00:00Z')), null)
eq('one with no date cannot be', daysLate(makeProject({ name: 'x', status: 'active' })), null)
eq('and a nonsense date does not crash', daysLate({ due_on: 'rubbish', status: 'active' }), null)

console.log('\n── STATUSES ──')
eq('there are four', PROJECT_STATUS_IDS.length, 4)
ok('every one has a label', PROJECT_STATUS_IDS.every((k) => PROJECT_STATUS[k].label))
// A stalled site still has money in it and still has to appear in the totals,
// which is what makes it worth a status of its own rather than "completed".
ok('on hold is still open', isOpen('onHold'))
ok('completed is not', !isOpen('completed'))
ok('and an unknown status is treated as open rather than hidden', isOpen('nonsense'))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
