// Gratuity: the money a company already owes and has never added up.
//
// Under the Payment of Gratuity Act, 1972 an employer with ten or more
// employees owes fifteen days' wages for every year somebody has worked, paid
// when they leave. It is not a deduction and never appears on a payslip, which
// is exactly why it goes unnoticed: nothing in a month's accounts moves, and
// the liability grows anyway. A builder with forty men, a dozen of them there
// since the first site, is carrying a number nobody has written down — and it
// falls due all at once when a job ends and the men are paid off.
//
// So the thing worth computing is not what one man gets on his last day. It is
// what the whole payroll has accrued as of today, split by whether it has
// vested, because the unvested part is a liability that may never fall due and
// the vested part is money the company owes whatever happens next.
//
// Three rules do most of the work and each is a place to get it wrong:
//
//   **Wages means basic plus dearness allowance.** Not gross. Computing on
//   gross overstates the liability by half for most payrolls.
//
//   **Fifteen days out of twenty-six**, not out of thirty. The Act divides a
//   month's wages by twenty-six working days, so the multiplier is 15/26 and
//   not a half.
//
//   **A part-year over six months counts as a year.** Five years and seven
//   months is six years' gratuity, and the jump is a month's wages wide.

import { round2, wagesOf } from './payroll'

// Gratuity is paid in whole rupees. Keeping paise would make a total that no
// cheque ever matches, and the total is the number this exists to produce.
const rupees = (n) => Math.round(Number(n) || 0)

// The Act bites here, and the number is the same ten that brings in state
// insurance — one more reason a company crossing ten is a moment worth saying
// something about.
export const THRESHOLD = 10
export const ACT = 'Payment of Gratuity Act, 1972'

// Vesting. Five years of continuous service, waived where somebody dies or is
// disabled — the one exception the Act makes, and the one a payroll screen will
// never be the place to apply.
export const VESTING_YEARS = 5

// The statutory ceiling on a single gratuity, raised from ten lakh in 2018.
export const CEILING = 2000000

// Fifteen days' wages, where a month is twenty-six working days.
export const DAYS_PER_YEAR = 15
export const DAYS_PER_MONTH = 26

const DAY = 86400000
const parse = (iso) => {
  const d = new Date(`${String(iso || '').slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

// How long somebody has been here, in the terms the Act uses.
//
// `counted` is the figure gratuity is actually paid on: completed years, plus
// one more where the remainder is over six months. Six months exactly does not
// round up — the Act says "in excess of six months" — and the boundary is worth
// a rupee or two thousand to somebody, so it is written down rather than left
// to a comparison somebody will flip later.
export function serviceOn(joinedOn, asOf = new Date().toISOString()) {
  const from = parse(joinedOn)
  const to = parse(asOf)
  if (!from || !to || to < from) {
    return { known: false, days: 0, years: 0, months: 0, counted: 0, vested: false }
  }
  const days = Math.floor((to - from) / DAY)
  let years = to.getUTCFullYear() - from.getUTCFullYear()
  let months = to.getUTCMonth() - from.getUTCMonth()
  if (to.getUTCDate() < from.getUTCDate()) months -= 1
  if (months < 0) { years -= 1; months += 12 }
  // The days left over after the whole months, which decide the boundary. Six
  // months and one day is in excess of six months and six months exactly is
  // not, and whole-month arithmetic on its own cannot tell them apart — it
  // rounded a man at five years, six months and a day down to five years and
  // cost him a month's wages.
  const anchor = Date.UTC(from.getUTCFullYear() + years, from.getUTCMonth() + months, from.getUTCDate())
  const restDays = Math.max(0, Math.floor((to - anchor) / DAY))

  // Section 2A: two hundred and forty days in a year is a year of continuous
  // service, which a long line of cases has read as making four years and two
  // hundred and forty days enough to vest. It is contested, it turns on how
  // many days a week the establishment works, and it is not a thing a payroll
  // screen can decide — so somebody at four years and eight months is flagged
  // as arguable rather than told no.
  const arguable = years === VESTING_YEARS - 1 && days - (VESTING_YEARS - 1) * 365 >= 240
  return {
    known: true,
    days,
    years,
    months,
    restDays,
    // What gratuity is paid on. "In excess of six months", which is more than
    // six months and not six months or more.
    counted: years + (months > 6 || (months === 6 && restDays > 0) ? 1 : 0),
    vested: years >= VESTING_YEARS,
    arguable: arguable && years < VESTING_YEARS,
  }
}

// What one person has accrued, as of a date.
//
// Accrued, not payable: somebody three years in has a number here and would get
// nothing if they left tomorrow. Both facts matter and the caller gets both,
// because a liability nobody can see is the problem this exists to fix and a
// liability overstated as payable is a different one.
export function gratuityFor(employee, { asOf = new Date().toISOString(), config = {} } = {}) {
  const service = serviceOn(employee?.joined_on, asOf)
  const wages = wagesOf(employee)
  const perYear = (wages * DAYS_PER_YEAR) / DAYS_PER_MONTH
  const raw = rupees(perYear * service.counted)
  const ceiling = Number(config.ceiling ?? CEILING)
  const amount = Math.min(raw, ceiling)
  return {
    employee_id: employee?.id,
    name: employee?.name || '',
    joined_on: employee?.joined_on || '',
    wages,
    service,
    // Fifteen days' wages for each counted year, capped.
    //
    // A part-year over six months rounds up even before vesting, so somebody at
    // four years and eleven months accrues five years here and would get
    // nothing if they left tomorrow. That overstates rather than understates,
    // which is the safe direction for a liability and the wrong one for a
    // promise — hence `payable` beside it.
    accrued: amount,
    uncapped: raw,
    capped: raw > ceiling,
    // Owed if they walked out today.
    payable: service.vested ? amount : 0,
    vested: service.vested,
    why: describe(employee, service, wages, raw, ceiling),
  }
}

function describe(employee, service, wages, raw, ceiling) {
  if (!service.known) return `${employee?.name || 'This person'} has no joining date, so nothing can be worked out.`
  if (wages <= 0) return 'No basic or dearness allowance is recorded, so fifteen days of it is nothing.'
  const yrs = `${service.years} ${service.years === 1 ? 'year' : 'years'}${service.months ? ` and ${service.months} ${service.months === 1 ? 'month' : 'months'}` : ''}`
  const counted = `${service.counted} ${service.counted === 1 ? 'year' : 'years'}`
  const rounded = service.counted > service.years ? `, rounded up to ${counted} because the part-year is over six months` : ''
  if (!service.vested) {
    const arguable = service.arguable
      ? ' Two hundred and forty days in the fifth year may already be enough — that is contested and depends on the working week.'
      : ''
    return `${yrs} in${rounded}. Nothing is payable under five years, so this has accrued but not vested.${arguable}`
  }
  const capped = raw > ceiling ? ` The statutory ceiling of ₹${ceiling.toLocaleString('en-IN')} applies.` : ''
  return `${yrs} in${rounded}. Fifteen days of ₹${round2(wages).toLocaleString('en-IN')} for each of ${counted}.${capped}`
}

// Whether the Act applies at all. Ten employees, and under that a company may
// pay it anyway — many do, and a promise made is owed whatever the Act says.
export function gratuityStatus({ headcount = 0, config = {} } = {}) {
  const threshold = Number(config.threshold ?? THRESHOLD)
  const over = (Number(headcount) || 0) >= threshold
  const voluntary = config.voluntary === true
  return {
    threshold, headcount, over, act: ACT,
    applies: over || voluntary,
    voluntary: voluntary && !over,
    why: over
      ? `At ${headcount} ${headcount === 1 ? 'employee' : 'employees'} the ${ACT} applies.`
      : voluntary
        ? `Under ${threshold} employees the Act does not apply, and this company has said it pays gratuity anyway.`
        : `Under ${threshold} employees the Act does not apply. Many employers pay it regardless.`,
  }
}

// The whole payroll's liability, which is the number that has never been on a
// screen. Vested and unvested are kept apart on purpose: one is owed and the
// other is a bet on people staying.
export function gratuityLiability(employees = [], { asOf = new Date().toISOString(), config = {} } = {}) {
  const active = employees.filter((e) => e.active !== false)
  const status = gratuityStatus({ headcount: active.length, config })
  const lines = active.map((e) => gratuityFor(e, { asOf, config }))
  // Summed over what each person is actually paid, not rounded at the end: a
  // total nobody can reconcile to the lines under it is worse than no total.
  const sum = (pick, rows = lines) => rows.reduce((t, l) => t + pick(l), 0)
  const vested = lines.filter((l) => l.vested)

  // Who crosses five years within the year ahead. A cliff nobody can see coming
  // is the difference between a planned cost and a surprise, and on a site
  // where a dozen men started together it arrives for all of them at once.
  const soon = lines
    .filter((l) => !l.vested && l.service.known && l.service.years >= VESTING_YEARS - 1)
    .map((l) => ({
      ...l,
      monthsToVest: Math.max(0, (VESTING_YEARS - l.service.years) * 12 - l.service.months),
    }))
    .filter((l) => l.monthsToVest <= 12)
    .sort((a, b) => a.monthsToVest - b.monthsToVest)

  return {
    ...status,
    lines,
    people: lines.length,
    // Everything accrued, whether or not it has vested.
    accrued: sum((l) => l.accrued),
    // Owed if everybody left today.
    vestedTotal: sum((l) => l.payable),
    unvested: sum((l) => l.accrued) - sum((l) => l.payable),
    vestedPeople: vested.length,
    // Nobody can work out a liability for somebody with no joining date, and a
    // person quietly counted as zero is the cheapest kind of wrong.
    undated: lines.filter((l) => !l.service.known).length,
    capped: lines.filter((l) => l.capped).length,
    vestingSoon: soon,
  }
}
