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

// The same four questions asked of a builder's books, which answer them
// differently. A construction company's costs sit against jobs rather than
// against things it owns — lib/place.js says why — so the list starts with a
// site, not an asset, and ends with the estimate rather than a monthly budget:
// both are the number that turns "spent so far" into "running over".
//
// Sites, not assets, is also the honest first instruction. Telling a builder
// that everything hangs off an asset is how four of this repo's own fixtures
// ended up with an invented one called "Company Depot".
export const COMPANY_STEPS = [
  {
    id: 'site',
    title: 'Add your first site',
    why: 'Every bag of cement, every day of the muster and every bill belongs to a job.',
    to: '/operations',
    cta: 'Add a site',
    done: ({ projects }) => projects.length > 0,
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
    title: 'Record what the client has paid',
    why: 'What a job has earned and what it has been paid are two numbers, and only one of them is in the bank.',
    to: '/income/new',
    cta: 'Add a receipt',
    done: ({ income }) => income.length > 0,
  },
  {
    id: 'estimate',
    title: 'Cost one of your jobs',
    why: 'Until a site has an estimate, Offset can say what it has cost but not whether that is too much.',
    to: '/operations',
    cta: 'Set an estimate',
    done: ({ projects }) => projects.some((p) => Number(p.estimate) > 0),
  },
]

const state = ({ properties = [], expenses = [], income = [], projects = [], corporate = false, entityId = '' } = {}) =>
  ({ properties, expenses, income, projects, corporate, entityId })

const listFor = (s) => (s.corporate ? COMPANY_STEPS : STEPS)

export function steps(data) {
  const s = state(data)
  return listFor(s).map((step) => ({ ...step, done: Boolean(step.done(s)) }))
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

// Dismissed per set of books. Waving away the checklist in your own books says
// nothing about a company you have just been added to, where the list is a
// different list and none of it is done. Personal keeps the original key, so
// nobody who has already dismissed it sees it again.
const keyFor = (entityId) => (entityId ? `${KEY}_${entityId}` : KEY)

export function isDismissed(entityId = '') {
  try {
    return localStorage.getItem(keyFor(entityId)) === '1'
  } catch {
    return false
  }
}

export function dismiss(entityId = '') {
  try {
    localStorage.setItem(keyFor(entityId), '1')
  } catch {
    /* storage unavailable — the card simply reappears next time */
  }
}

export function undismiss(entityId = '') {
  try {
    localStorage.removeItem(keyFor(entityId))
  } catch {
    /* nothing to undo */
  }
}

// Show it while there is something left to do and it hasn't been waved away.
// Once every step is done it goes for good, without needing to be dismissed —
// finishing the list is the same as not wanting to see it.
export function shouldShow(data) {
  return !progress(data).complete && !isDismissed(state(data).entityId)
}
