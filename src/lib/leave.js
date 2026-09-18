// Earned leave, and the two ways it quietly costs money.
//
// Leave is a liability like gratuity — days somebody has earned and not taken,
// payable in cash when they leave — and like gratuity nothing monthly mentions
// it, so nobody adds it up until a site finishes and forty men are paid off in
// the same week.
//
// The second cost is worse because it falls on the worker rather than the
// company. Leave carries forward only up to a cap, and anything over it lapses
// at the year end unless it is encashed. A mason with forty-one days standing
// against a thirty-day cap loses eleven days of pay on the 31st of March, and
// nothing anywhere says so until it has happened. That is what `carryForward`
// is for, and it is the reason this module exists at all.
//
// There is no single Act. The Factories Act, 1948 gives one day of leave for
// every twenty days worked with thirty days carried forward; the state Shops
// and Establishments Acts mostly give a flat fifteen to twenty-one days a year;
// construction sites are under the Building and Other Construction Workers Act
// as well. So the policy is the company's to state, with the Factories Act as
// the default because it is the one a site is most likely under — and both
// shapes are supported rather than one being bent into the other.

import { round2, wagesOf } from './payroll'

const rupees = (n) => Math.round(Number(n) || 0)

// One day for every twenty worked, thirty carried forward. Section 79.
export const FACTORIES_ACT = {
  id: 'factories',
  label: 'Factories Act — one day for every twenty worked',
  basis: 'worked',
  perDays: 20,
  carryCap: 30,
  act: 'Factories Act, 1948',
}

// The other common shape: a flat entitlement for the year, which is what most
// state Shops and Establishments Acts give.
export const ANNUAL = {
  id: 'annual',
  label: 'A flat number of days a year',
  basis: 'annual',
  daysPerYear: 18,
  carryCap: 30,
  act: 'state Shops and Establishments Act',
}

export const POLICIES = { factories: FACTORIES_ACT, annual: ANNUAL }
export const POLICY_IDS = Object.keys(POLICIES)

// A day's leave wages. Twenty-six working days to the month, the same divisor
// gratuity uses, because both are paying for a day somebody would have worked.
// Companies that use thirty can say so; nothing else changes.
export const DEFAULT_DIVISOR = 26

export const policyOf = (config = {}) => {
  const base = POLICIES[config.policy] || FACTORIES_ACT
  return {
    ...base,
    carryCap: Number(config.carryCap ?? base.carryCap),
    daysPerYear: Number(config.daysPerYear ?? base.daysPerYear ?? 0),
    perDays: Number(config.perDays ?? base.perDays ?? 0),
    divisor: Number(config.divisor ?? DEFAULT_DIVISOR),
  }
}

// What a year earns somebody. Under the Factories Act that depends on how much
// they worked, which on a site is the difference between a full year and a
// monsoon — so days worked is asked for and a full year stands in where nobody
// has counted, marked as the assumption it is.
export function earnedIn({ daysWorked = null, policy = FACTORIES_ACT } = {}) {
  const p = policyOf(policy.id ? { ...policy, policy: policy.id } : policy)
  if (p.basis === 'annual') {
    return { days: p.daysPerYear, assumed: false, why: `${p.daysPerYear} days a year, whatever the attendance.` }
  }
  const worked = daysWorked == null ? 240 : Math.max(0, Number(daysWorked) || 0)
  return {
    days: Math.floor(worked / p.perDays),
    assumed: daysWorked == null,
    why: `One day for every ${p.perDays} worked. ${daysWorked == null ? 'Nobody has counted the days, so a full working year is assumed.' : `${worked} days worked.`}`,
  }
}

// What survives the year end, and what does not.
//
// The lapsed figure is the point. It is a number nobody is ever shown, it is
// always somebody's pay, and it is always avoidable — the days could have been
// encashed before the year turned.
export function carryForward(balance, policy = FACTORIES_ACT) {
  const p = policyOf(policy.id ? { ...policy, policy: policy.id } : policy)
  const days = Math.max(0, Number(balance) || 0)
  const carried = Math.min(days, p.carryCap)
  return {
    balance: days,
    carried,
    lapsed: round2(days - carried),
    cap: p.carryCap,
    // Over the cap and the clock is running.
    willLapse: days > p.carryCap,
  }
}

// What one person's standing leave is worth in cash.
export function encashmentFor(employee, { policy = FACTORIES_ACT, days = null } = {}) {
  const p = policyOf(policy.id ? { ...policy, policy: policy.id } : policy)
  const balance = days == null ? Math.max(0, Number(employee?.leave_balance) || 0) : Math.max(0, Number(days) || 0)
  const wages = wagesOf(employee)
  const perDay = wages / p.divisor
  const forward = carryForward(balance, p)
  return {
    employee_id: employee?.id,
    name: employee?.name || '',
    balance,
    wages,
    perDay: round2(perDay),
    divisor: p.divisor,
    // Everything standing, which is what is paid on the way out.
    value: rupees(perDay * balance),
    // What is about to be lost if nobody encashes it before the year turns.
    lapsing: forward.lapsed,
    lapsingValue: rupees(perDay * forward.lapsed),
    ...forward,
    why: wages <= 0
      ? 'No basic or dearness allowance is recorded, so a day of leave is worth nothing.'
      : balance <= 0
        ? 'No leave standing.'
        : `${balance} ${balance === 1 ? 'day' : 'days'} at ₹${round2(perDay).toLocaleString('en-IN')} a day — ${wages.toLocaleString('en-IN')} divided by ${p.divisor}.`,
  }
}

// The whole payroll: what is owed, and what is about to be lost.
export function leaveLiability(employees = [], { policy = FACTORIES_ACT } = {}) {
  const p = policyOf(policy.id ? { ...policy, policy: policy.id } : policy)
  const active = employees.filter((e) => e.active !== false)
  const lines = active.map((e) => encashmentFor(e, { policy: p }))
  const withLeave = lines.filter((l) => l.balance > 0)
  const lapsing = lines.filter((l) => l.willLapse)
  return {
    policy: p,
    lines,
    people: lines.length,
    // Nobody has entered a balance for anybody, which is a different state from
    // everybody having taken all their leave — and a zero that means "not
    // recorded" is the one this app keeps trying to stop showing.
    recorded: withLeave.length,
    unrecorded: lines.length - withLeave.length,
    value: lines.reduce((t, l) => t + l.value, 0),
    days: round2(lines.reduce((t, l) => t + l.balance, 0)),
    // The number worth shouting about.
    lapsingPeople: lapsing.length,
    lapsingDays: round2(lapsing.reduce((t, l) => t + l.lapsing, 0)),
    lapsingValue: lapsing.reduce((t, l) => t + l.lapsingValue, 0),
    over: lapsing.sort((a, b) => b.lapsing - a.lapsing),
  }
}
