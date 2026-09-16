// What each part of the company spent, against what it was given to spend.
//
// Two things were dead before this: `department_id` on an entry, which no form
// ever filled in, and `budget_monthly` on a department, which no screen ever
// compared to anything. You could set a cost centre's budget and nothing in the
// app would ever tell you that you were over it.
//
// The assertion that matters most is the dull one about totals. A parent's
// figure includes its children, so adding every department's rolled-up number
// counts each cost once per ancestor — and a report whose parts exceed the
// whole is one nobody trusts twice.
import { costCentreReport, departmentOptions, UNASSIGNED } from '../../src/lib/costcentres.js'
import { makeDepartment } from '../../src/lib/corporate.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

const E = 'e1'
// Construction ─ Site A
//              └ Site B
// Head office
const build = makeDepartment({ entityId: E, id: 'd-build', name: 'Construction', code: 'CON', budgetMonthly: 800000 })
const siteA = makeDepartment({ entityId: E, id: 'd-a', name: 'Site A', parentId: 'd-build', budgetMonthly: 400000 })
const siteB = makeDepartment({ entityId: E, id: 'd-b', name: 'Site B', parentId: 'd-build', budgetMonthly: 300000 })
const office = makeDepartment({ entityId: E, id: 'd-office', name: 'Head office', code: 'HO', budgetMonthly: 200000 })
const depts = [build, siteA, siteB, office]

const exp = (department_id, amount, date = '2026-03-10') => ({ id: `x${Math.random()}`, entity_id: E, department_id, amount, date })
const spend = [
  exp('d-a', 250000), exp('d-a', 150000),   // Site A: 400,000 — exactly its budget
  exp('d-b', 380000),                        // Site B: 380,000 — over its 300,000
  exp('d-build', 90000),                     // booked to the division itself
  exp('d-office', 60000),
  exp(null, 120000),                         // nobody booked it
]
const earn = [
  { id: 'i1', entity_id: E, department_id: 'd-a', amount: 900000, date: '2026-03-20' },
  { id: 'i2', entity_id: E, department_id: null, amount: 50000, date: '2026-03-20' },
]
const r = costCentreReport(depts, spend, earn, { entityId: E, months: ['2026-03'] })
const at = (id) => r.lines.find((l) => l.id === id)

console.log('\n── WHAT EACH ONE SPENT ──')
eq('a team spends its own', at('d-a').own, 400000)
eq('and that is all it rolls up', at('d-a').spent, 400000)
eq('a division spends its own too', at('d-build').own, 90000)
// The rule that makes a divisional report add up.
eq('but rolls up everything beneath it', at('d-build').spent, 400000 + 380000 + 90000)
eq('it knows how many teams are inside it', at('d-build').children, 2)
eq('and a leaf has none', at('d-a').children, 0)
eq('an unrelated department is not swept in', at('d-office').spent, 60000)

console.log('\n── AGAINST WHAT THEY WERE GIVEN ──')
eq('a team exactly on budget is not over', at('d-a').over, false)
eq('and has nothing left', at('d-a').left, 0)
eq('at a hundred percent', at('d-a').usedPercent, 100)
ok('a team past its budget is flagged', at('d-b').over)
eq('by how much', at('d-b').overBy, 80000)
// The division is over because the teams inside it are, which is the whole
// point of rolling up: its own spend of 90,000 is nowhere near its budget.
ok('and so is the division above them, on their spending', at('d-build').over)
eq('though its own costs would not have been', at('d-build').own < at('d-build').budget, true)
eq('two departments are over', r.overspent, 2)
// Site B by 80,000 and the division by 70,000 — 870,000 rolled against 800,000.
eq('by this much between them', r.overBy, 80000 + 70000)
ok('one under budget is not flagged', !at('d-office').over)

console.log('\n── A DEPARTMENT WITH NO BUDGET IS NOT A DEPARTMENT IN BUDGET ──')
const noBudget = makeDepartment({ entityId: E, id: 'd-x', name: 'Legal' })
const rb = costCentreReport([noBudget], [exp('d-x', 99999)], [], { entityId: E, months: ['2026-03'] })
eq('there is no percentage to report', rb.lines[0].usedPercent, null)
eq('nor anything left', rb.lines[0].left, null)
ok('and it is not called over budget', !rb.lines[0].over)
eq('it counts as unbudgeted', rb.budgeted, 0)

console.log('\n── THE PARTS DO NOT EXCEED THE WHOLE ──')
// The bug this is really guarding. Rolled figures count a cost once for its own
// department and again for every ancestor; the company total must not.
const rolledSum = r.lines.reduce((t, l) => t + l.spent, 0)
ok('adding the rolled figures over-counts', rolledSum > r.spent, `${rolledSum} vs ${r.spent}`)
eq('the total is every department’s own spend plus what nobody booked',
  r.spent, 400000 + 380000 + 90000 + 60000 + 120000)
eq('which is simply what was spent', r.spent, spend.reduce((t, e) => t + e.amount, 0))
eq('and income adds up the same way', r.earned, 950000)

console.log('\n── WHAT NOBODY BOOKED ──')
// A cost centre report that quietly omits half the spend is worse than none.
eq('the unassigned spend is reported', r.unassigned, 120000)
eq('with a count', r.unassignedEntries, 2)
eq('and as a share, which says whether the rest is worth reading',
  r.unassignedPercent, Math.round((120000 / r.spent) * 1000) / 10)
eq('unassigned income too', r.unassignedEarned, 50000)
ok('it is not a department', !r.lines.some((l) => l.id === UNASSIGNED))

console.log('\n── A MONTHLY BUDGET OVER SEVERAL MONTHS ──')
// A quarter's spend against one month's budget would flag every department in
// the company, which is a report that gets switched off.
const q = ['2026-01', '2026-02', '2026-03']
const spread = [exp('d-office', 180000, '2026-01'), exp('d-office', 190000, '2026-02'), exp('d-office', 170000, '2026-03')]
const rq = costCentreReport([office], spread, [], { entityId: E, months: q })
eq('the budget is three months of it', rq.lines[0].budget, 600000)
eq('against three months of spend', rq.lines[0].spent, 540000)
ok('which is inside it', !rq.lines[0].over)
// The control for the scaling itself: three months of spend is more than one
// month's budget, and it is only not flagged because the budget scaled too.
ok('even though it is more than a single month\u2019s budget',
  rq.lines[0].spent > office.budget_monthly, `${rq.lines[0].spent} vs ${office.budget_monthly}`)
eq('and one month on its own is judged against one month',
  costCentreReport([office], spread, [], { entityId: E, months: ['2026-01'] }).lines[0].budget, 200000)

console.log('\n── ONLY THE MONTHS ASKED FOR ──')
const rm = costCentreReport(depts, [...spend, exp('d-office', 500000, '2026-04')], [], { entityId: E, months: ['2026-03'] })
eq('a cost in another month is not counted', rm.lines.find((l) => l.id === 'd-office').spent, 60000)
eq('with no months given, everything counts',
  costCentreReport(depts, [...spend, exp('d-office', 500000, '2026-04')], [], { entityId: E })
    .lines.find((l) => l.id === 'd-office').spent, 560000)

console.log('\n── OTHER COMPANIES, AND ROWS THAT ARE GONE ──')
const mixed = [...depts, makeDepartment({ entityId: 'other', id: 'd-z', name: 'Theirs' })]
ok('another company’s department is not on the report',
  !costCentreReport(mixed, spend, [], { entityId: E }).lines.some((l) => l.id === 'd-z'))
eq('and their spend is not either',
  costCentreReport(mixed, [...spend, { id: 'z', entity_id: 'other', department_id: 'd-z', amount: 999, date: '2026-03-01' }], [], { entityId: E }).spent,
  r.spent)
eq('a deleted entry does not count',
  costCentreReport(depts, [...spend, { ...exp('d-a', 5000), deleted_at: '2026-03-11' }], [], { entityId: E, months: ['2026-03'] })
    .lines.find((l) => l.id === 'd-a').spent, 400000)
eq('nor does a deleted department appear',
  costCentreReport([...depts, { ...noBudget, deleted_at: 'x' }], spend, [], { entityId: E }).lines.length, 4)

console.log('\n── WHAT A PICKER SHOULD OFFER ──')
const opts = departmentOptions(depts, { entityId: E })
eq('every department', opts.length, 4)
// Two teams called "Site" in different divisions have to be told apart.
eq('each labelled with its path', opts.find((o) => o.id === 'd-a').label, 'Construction › Site A')
eq('a top-level one is just itself', opts.find((o) => o.id === 'd-office').label, 'Head office')
eq('and depth says how far to indent', [opts.find((o) => o.id === 'd-a').depth, opts.find((o) => o.id === 'd-office').depth], [1, 0])
eq('a parent sorts immediately above the teams inside it',
  opts.map((o) => o.name), ['Construction', 'Site A', 'Site B', 'Head office'])
eq('another company’s is not offered', departmentOptions(mixed, { entityId: E }).length, 4)

console.log('\n── NOTHING AT ALL ──')
const none = costCentreReport([], [], [])
eq('no departments, no lines', none.lines.length, 0)
eq('nothing spent', none.spent, 0)
eq('and no share of nothing', none.unassignedPercent, 0)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
