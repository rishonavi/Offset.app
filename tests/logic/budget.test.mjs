// A budget, and the arithmetic it has to get right to be worth keeping.
//
// The three figures at the top of the Personal page compared a budget covering
// two categories against spending across all of them. Somebody who had budgeted
// groceries and nothing else, and who spent normally everywhere else, was shown
// "Remaining −₹48,700" — a frightening number that meant nothing, because
// almost none of that spending was ever inside the plan it was being measured
// against. It was also unreachable from a test, because it lived in the page.
//
// Two apps worth copying here — EveryDollar and DollarWise — build their whole
// interface on one spine: a single figure at the top answering "am I all
// right?", and planned, spent and left stated per category over the same set.
// Everything below is that spine, made checkable.
import { monthPlan, PERSONAL_CATEGORIES, colorForPersonal } from '../../src/lib/personal.js'
import { budgetStatus, BUDGET_COLORS } from '../../src/lib/budget.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, got, want) => ok(n, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const spend = (category, amount) => ({ id: `${category}-${amount}`, category, amount, date: '2026-09-05' })
const limit = (category, monthly_limit) => ({ id: `b-${category}`, category, monthly_limit })

console.log('\n── PLANNED AGAINST SPENT, OVER THE SAME CATEGORIES ──')
// The exact shape that produced the nonsense: one budgeted category, five not.
const lopsided = monthPlan(
  [spend('Groceries', 12400), spend('Rent', 35000), spend('Transport', 4200),
    spend('Eating out', 6800), spend('Utilities', 3100), spend('Health', 2200)],
  [limit('Groceries', 10000)],
)
eq('the plan is what was budgeted', lopsided.planned, 10000)
eq('spent of that is only what fell inside it', lopsided.budgetedSpent, 12400)
// The old figure was 10,000 − 63,700 = −53,700, which described nothing.
eq('so the shortfall is what was overspent on the plan', lopsided.left, -2400)
eq('and not the whole month against one budget', lopsided.left === 10000 - lopsided.spent, false)
// What falls outside is real money and gets said, not folded in.
eq('everything else is reported separately', lopsided.unbudgetedSpent, 51300)
eq('and the two halves are the whole month', lopsided.budgetedSpent + lopsided.unbudgetedSpent, lopsided.spent)
eq('which is what was actually spent', lopsided.spent, 63700)

console.log('\n── AND WHEN EVERYTHING IS BUDGETED ──')
const full = monthPlan(
  [spend('Groceries', 12400), spend('Rent', 35000), spend('Transport', 4200)],
  [limit('Groceries', 10000), limit('Rent', 35000), limit('Transport', 5000)],
)
eq('the plan adds up', full.planned, 50000)
eq('spent of it is the whole month', full.budgetedSpent, 51600)
eq('nothing falls outside', full.unbudgetedSpent, 0)
eq('and the shortfall is small and true', full.left, -1600)
eq('with the overspend stated the positive way round', full.over, 1600)
// Under budget is the ordinary case and must not report an overspend.
const under = monthPlan([spend('Groceries', 8000)], [limit('Groceries', 10000)])
eq('money left is money left', under.left, 2000)
eq('and nothing is over', under.over, 0)

console.log('\n── A BUDGET NOBODY SET, AND A CATEGORY NOBODY BUDGETED ──')
eq('no budgets at all plans nothing', monthPlan([spend('Groceries', 500)], []).planned, 0)
eq('and nothing of it is spent', monthPlan([spend('Groceries', 500)], []).budgetedSpent, 0)
eq('while the spending is still counted', monthPlan([spend('Groceries', 500)], []).spent, 500)
eq('all of it outside the plan', monthPlan([spend('Groceries', 500)], []).unbudgetedSpent, 500)
// A zero limit is not a budget. It is the absence of one, and treating it as a
// budget of zero would report every rupee as an overspend.
eq('a zero limit is not a budget', monthPlan([spend('Groceries', 500)], [limit('Groceries', 0)]).planned, 0)
eq('so its spending is outside the plan', monthPlan([spend('Groceries', 500)], [limit('Groceries', 0)]).unbudgetedSpent, 500)
// An empty month is not an error.
eq('an empty month plans nothing', monthPlan([], []).planned, 0)
eq('spends nothing', monthPlan([], []).spent, 0)
eq('and has nothing left over', monthPlan([], []).left, 0)
eq('nor any rows', monthPlan([], []).rows.length, 0)
// A budget with no spending against it is still a plan.
const untouched = monthPlan([], [limit('Travel', 20000)])
eq('a budget nobody spent against still plans', untouched.planned, 20000)
eq('and all of it is left', untouched.left, 20000)
eq('with a row of its own', untouched.rows.length, 1)

console.log('\n── A BUDGET SOMEBODY SET IS A BUDGET ──')
// This filtered through `PERSONAL_CATEGORIES`, so a budget against anything not
// on that fixed list stopped counting towards the totals while still drawing
// its own bar — six budgets on screen and two in the header. The list has been
// edited before and will be again.
const renamed = monthPlan([spend('Rent', 35000)], [limit('Rent', 30000)])
ok('“Rent” is not on the built-in list', !PERSONAL_CATEGORIES.includes('Rent'), PERSONAL_CATEGORIES.join(', '))
eq('but a budget against it counts', renamed.planned, 30000)
eq('and its spending counts with it', renamed.budgetedSpent, 35000)
eq('so it is not reported as unbudgeted', renamed.unbudgetedSpent, 0)
// The control: a category on the list behaves the same way, so the rule is
// "whatever was budgeted" rather than a second special case.
eq('and a listed category behaves the same', monthPlan([spend('Groceries', 100)], [limit('Groceries', 90)]).planned, 90)
// Two budgets for one category is a duplicate, not two budgets.
eq('a category budgeted twice is counted once',
  monthPlan([], [limit('Groceries', 100), { id: 'x', category: 'Groceries', monthly_limit: 100 }]).planned, 100)

console.log('\n── EVERY CATEGORY WITH A BUDGET OR MONEY AGAINST IT ──')
// Listing only the budgeted ones hid exactly the spending somebody would want
// to bring into the plan.
const rows = lopsided.rows
eq('all six categories are listed', rows.length, 6)
eq('budgeted ones lead', rows[0].name, 'Groceries')
ok('and the rest follow by size', rows[1].name === 'Rent' && rows[1].spent === 35000, JSON.stringify(rows[1]))
ok('each unbudgeted row carries no budget', rows.slice(1).every((r) => r.budget === 0), '')
ok('and its spending', rows.slice(1).every((r) => r.spent > 0), '')
// Spending with no category at all still has to appear somewhere.
eq('spending with no category is filed under Other', monthPlan([{ id: 'x', amount: 50 }], []).rows[0].name, 'Other')
ok('and every category has a colour', rows.every((r) => Boolean(colorForPersonal(r.name))), '')

console.log('\n── HITTING THE NUMBER EXACTLY IS NOT A FAILURE ──')
// Spending precisely the budget fell into `over`, which put a red bar and
// "Over budget by ₹0" against the one outcome a budget is aimed at.
eq('spending the budget exactly is its own state', budgetStatus(1000, 1000).level, 'spent')
eq('with nothing left', budgetStatus(1000, 1000).remaining, 0)
eq('and nothing over', budgetStatus(1000, 1000).over, 0)
ok('it is not red', BUDGET_COLORS.spent !== BUDGET_COLORS.over, '')
// A rupee either way is a rupee either way.
eq('a rupee over is over', budgetStatus(1001, 1000).level, 'over')
eq('by one rupee', budgetStatus(1001, 1000).over, 1)
eq('and a rupee under is not', budgetStatus(999, 1000).level, 'warn')
// The bands below it.
eq('eighty per cent starts the warning', budgetStatus(800, 1000).level, 'warn')
eq('seventy-nine is still fine', budgetStatus(790, 1000).level, 'ok')
eq('and nothing spent is fine', budgetStatus(0, 1000).level, 'ok')
// No budget is not a budget of zero.
eq('no budget has no status at all', budgetStatus(500, 0), null)
eq('nor a missing one', budgetStatus(500, null), null)
// Float noise must not read as an overspend.
eq('a hundredth of a rupee over is not an overspend', budgetStatus(1000.001, 1000).level, 'spent')
eq('every level has a colour', Object.keys(BUDGET_COLORS).length, 4)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
