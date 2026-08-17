// What's left to do before Offset is useful to you.
//
// Not a tour. A tour is a thing you click through and forget; this is a short
// list of the steps that actually change what the app can tell you, each one
// ticked by the state of the books rather than by having been shown a tooltip.
//
// It disappears on its own once the work is done, and can be dismissed at any
// point — an onboarding checklist you cannot get rid of is an advertisement.

const KEY = 'pl_onboarding_dismissed'

export const STEPS = [
  {
    id: 'asset',
    title: 'Add your first asset',
    why: 'Everything else hangs off an asset — a flat, a shop, a car.',
    to: '/properties/new',
    cta: 'Add an asset',
    done: ({ properties }) => properties.length > 0,
  },
  {
    id: 'expense',
    title: 'Log a cost against it',
    why: 'One entry is enough to start the running totals.',
    to: '/expenses/new',
    cta: 'Add a cost',
    done: ({ expenses }) => expenses.length > 0,
  },
  {
    id: 'income',
    title: 'Record what it earns',
    why: 'Rent, or anything the asset brings in. Without it, yield and net are guesses.',
    to: '/income/new',
    cta: 'Add income',
    done: ({ income }) => income.length > 0,
  },
  {
    id: 'budget',
    title: 'Set a monthly budget',
    why: 'Then Offset can tell you when a month is running hot, instead of only what it cost.',
    to: '/properties',
    cta: 'Set a budget',
    done: ({ properties }) => properties.some((p) => Number(p.monthly_budget) > 0),
  },
]

const state = ({ properties = [], expenses = [], income = [] } = {}) => ({ properties, expenses, income })

export function steps(data) {
  const s = state(data)
  return STEPS.map((step) => ({ ...step, done: Boolean(step.done(s)) }))
}

export function progress(data) {
  const list = steps(data)
  const done = list.filter((s) => s.done).length
  return { done, total: list.length, complete: done === list.length, percent: Math.round((done / list.length) * 100) }
}

// The first thing still outstanding — what the card points at.
export function nextStep(data) {
  return steps(data).find((s) => !s.done) || null
}

export function isDismissed() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function dismiss() {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* storage unavailable — the card simply reappears next time */
  }
}

export function undismiss() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to undo */
  }
}

// Show it while there is something left to do and it hasn't been waved away.
// Once every step is done it goes for good, without needing to be dismissed —
// finishing the list is the same as not wanting to see it.
export function shouldShow(data) {
  return !progress(data).complete && !isDismissed()
}
