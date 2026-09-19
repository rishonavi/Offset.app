import { format } from 'date-fns'
import { CHART_PALETTE } from './constants'

// Everyday personal-life categories (distinct from the asset/property ones).
export const PERSONAL_CATEGORIES = [
  'Groceries',
  'Dining & Takeout',
  'Transport',
  'Housing / Rent',
  'Utilities & Bills',
  'Health & Fitness',
  'Shopping',
  'Entertainment',
  'Subscriptions',
  'Education',
  'Travel',
  'Other',
]

const COLORS = {}
PERSONAL_CATEGORIES.forEach((c, i) => {
  COLORS[c] = CHART_PALETTE[i % CHART_PALETTE.length]
})
export const colorForPersonal = (c, i = 0) => COLORS[c] || CHART_PALETTE[i % CHART_PALETTE.length]

export const monthKey = (d = new Date()) => format(d, 'yyyy-MM')

// Human label for a YYYY-MM key.
export const monthLabel = (ym) => {
  const [y, m] = ym.split('-')
  return format(new Date(Number(y), Number(m) - 1, 1), 'MMMM yyyy')
}

// Shift a YYYY-MM key by n months.
export const shiftMonth = (ym, n) => {
  const [y, m] = ym.split('-').map(Number)
  return format(new Date(y, m - 1 + n, 1), 'yyyy-MM')
}

export const inMonth = (rows, ym) => rows.filter((e) => (e.date || '').slice(0, 7) === ym)

// ── A month's plan against what actually happened ──────────────────
//
// Planned, spent and left, over the same categories — which the page did not
// used to do. The three figures at the top compared a budget covering two
// categories against spending across all of them, so somebody who had budgeted
// groceries and nothing else was shown "Remaining −₹48,700": a frightening
// number that meant nothing, because almost none of that spending was ever
// inside the plan it was being measured against.
//
// It lived in the page, where none of it could be tested. A budget saying the
// wrong thing to somebody watching their money is not a rendering detail.
export function monthPlan(expenses = [], budgets = []) {
  const spentByCat = new Map()
  for (const e of expenses) {
    const c = e.category || 'Other'
    spentByCat.set(c, (spentByCat.get(c) || 0) + (Number(e.amount) || 0))
  }

  // Taken from the budgets themselves rather than from `PERSONAL_CATEGORIES`.
  // Filtering through that fixed list meant a budget against anything not on it
  // stopped counting towards the totals while still showing its own bar — six
  // budgets on screen and two in the header. The list has been edited before
  // and will be again; a budget somebody set is a budget whatever it says today.
  const limits = new Map()
  for (const b of budgets) {
    const limit = Number(b?.monthly_limit) || 0
    if (limit > 0 && b.category) limits.set(b.category, limit)
  }

  const planned = [...limits.values()].reduce((t, n) => t + n, 0)
  const budgetedSpent = [...limits.keys()].reduce((t, c) => t + (spentByCat.get(c) || 0), 0)
  const spent = [...spentByCat.values()].reduce((t, n) => t + n, 0)

  // Every category with a budget or with money against it. Listing only the
  // budgeted ones hid exactly the spending somebody would want to bring into
  // the plan, and made a month with six categories of spending look like a
  // month with two.
  const names = new Set([...limits.keys(), ...spentByCat.keys()])
  const rows = [...names]
    .map((name) => ({ name, budget: limits.get(name) || 0, spent: spentByCat.get(name) || 0 }))
    .sort((a, b) => (b.budget > 0) - (a.budget > 0) || b.spent - a.spent)

  return {
    planned,
    // What was spent inside the plan, which is the only figure `planned` can
    // meaningfully be compared with.
    budgetedSpent,
    // What was spent outside it. For most people this is the larger number, and
    // folding it into the shortfall is what made that shortfall meaningless.
    unbudgetedSpent: Math.max(0, spent - budgetedSpent),
    spent,
    left: planned - budgetedSpent,
    over: Math.max(0, budgetedSpent - planned),
    rows,
    spentByCat,
    budgetedCats: [...limits.keys()],
  }
}
