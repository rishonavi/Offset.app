// Statutory bonus, and the two ceilings everybody runs together.
//
// The Payment of Bonus Act, 1965 makes an employer with twenty or more
// employees pay every eligible person between 8.33% and 20% of a year's wages,
// within eight months of the year closing. It is an annual liability that
// nothing monthly ever mentions, so like gratuity it accrues in silence and
// falls due in one lump — usually around Diwali, usually on a site that is also
// paying for materials.
//
// The part that gets computed wrong is that there are **two** ceilings and they
// are different numbers doing different jobs:
//
//   **₹21,000 a month decides who is eligible.** Above it the Act does not
//   cover the person at all.
//
//   **₹7,000 a month — or the minimum wage for the work, whichever is higher —
//   decides what the bonus is computed on.** Somebody on ₹18,000 is eligible,
//   and their bonus is 8.33% of ₹7,000 a month rather than of ₹18,000.
//
// Run the two together and a company pays somebody on ₹18,000 about two and a
// half times what it owes them. Leave the second out and it does the same. This
// module keeps them apart and says which one bit.
//
// The minimum wage is the company's to supply. It is fixed per state and per
// scheduled employment, revised twice a year in most states, and construction
// has its own schedule — so a number built in here would be wrong within six
// months and wrong quietly. Unset, ₹7,000 applies and the app says so.

import { round2, wagesOf } from './payroll'
import { todayISO } from './today'

// Paid in whole rupees, and totalled over what each person gets rather than
// rounded at the end, so the register adds up to the cheque.
const rupees = (n) => Math.round(Number(n) || 0)

export const THRESHOLD = 20
export const ACT = 'Payment of Bonus Act, 1965'

// Who the Act covers.
export const ELIGIBILITY_CEILING = 21000
// What it is computed on, unless a minimum wage is higher.
export const CALCULATION_CEILING = 7000
// Thirty days worked in the year, which on a site is a real filter.
export const MIN_DAYS = 30

export const MIN_RATE = 8.33
export const MAX_RATE = 20
// Eight months after the accounting year closes.
export const DUE_MONTHS = 8
// A new establishment is outside the Act for its first five years except in a
// year it makes a profit. Whether it did is not a thing this app knows.
export const INFANCY_YEARS = 5

// What bonus is actually computed on: wages, held down to the calculation
// ceiling. The ceiling is the higher of ₹7,000 and the minimum wage, which is
// the clause most often dropped.
export function bonusWages(wages, { minimumWage = 0, calculationCeiling = CALCULATION_CEILING } = {}) {
  const ceiling = Math.max(Number(calculationCeiling) || 0, Number(minimumWage) || 0)
  return { ceiling, wages: Math.min(round2(wages), ceiling), held: round2(wages) > ceiling }
}

// One person's bonus for a year.
//
// `monthsWorked` is how much of the accounting year they were here for; a man
// who joined in December is owed four months of it and not twelve.
export function bonusFor(employee, {
  rate = MIN_RATE, minimumWage = 0, monthsWorked = 12, daysWorked = null,
  calculationCeiling = CALCULATION_CEILING, eligibilityCeiling = ELIGIBILITY_CEILING,
} = {}) {
  const wages = wagesOf(employee)
  const months = Math.max(0, Math.min(12, Number(monthsWorked) || 0))
  const pct = Math.min(MAX_RATE, Math.max(MIN_RATE, Number(rate) || MIN_RATE))
  const out = (amount, why, rest = {}) => ({
    employee_id: employee?.id, name: employee?.name || '', wages, rate: pct,
    monthsWorked: months, amount: rupees(amount), why, ...rest,
  })

  if (wages <= 0) return out(0, 'No basic or dearness allowance is recorded, so there is nothing to take a percentage of.', { eligible: false, noWages: true })
  if (wages > eligibilityCeiling) {
    return out(0, `Drawing ₹${round2(wages).toLocaleString('en-IN')} a month, which is over the ₹${eligibilityCeiling.toLocaleString('en-IN')} the Act covers.`,
      { eligible: false, overCeiling: true })
  }
  // Thirty days in the year. Counted where somebody has bothered to count;
  // where nobody has, a full month of service stands in and the caller is told
  // which it was rather than being handed a number that looks measured.
  const worked = daysWorked == null ? Math.round(months * 30) : Math.max(0, Number(daysWorked) || 0)
  if (worked < MIN_DAYS) {
    return out(0, `Worked ${worked} ${worked === 1 ? 'day' : 'days'} in the year, and the Act asks for ${MIN_DAYS}.`,
      { eligible: false, tooFewDays: true, daysWorked: worked, assumedDays: daysWorked == null })
  }

  const base = bonusWages(wages, { minimumWage, calculationCeiling })
  const amount = (base.wages * months * pct) / 100
  return out(amount,
    base.held
      ? `Eligible at ₹${round2(wages).toLocaleString('en-IN')} a month, but computed on ₹${base.ceiling.toLocaleString('en-IN')} — the Act caps the calculation there${minimumWage > CALCULATION_CEILING ? ', which here is the minimum wage' : ''}.`
      : `${pct}% of ₹${base.wages.toLocaleString('en-IN')} a month for ${months} ${months === 1 ? 'month' : 'months'}.`,
    { eligible: true, computedOn: base.wages, ceiling: base.ceiling, held: base.held, daysWorked: worked, assumedDays: daysWorked == null })
}

// Whether the Act applies, and the same voluntary case gratuity has: under
// twenty a company may pay a bonus anyway, and on a site most do.
export function bonusStatus({ headcount = 0, config = {}, born = '', asOf = todayISO() } = {}) {
  const threshold = Number(config.threshold ?? THRESHOLD)
  const over = (Number(headcount) || 0) >= threshold
  const voluntary = config.voluntary === true
  // Section 16: a new establishment is outside the Act for its first five
  // years, except in a year it makes a profit — and whether it did is not
  // something a payroll screen knows. So this is flagged and not applied: a
  // company told it owes nothing, wrongly, finds out eight months late.
  const age = ageInYears(born, asOf)
  const infancy = age != null && age < INFANCY_YEARS
  return {
    threshold, headcount, over, act: ACT,
    applies: over || voluntary,
    voluntary: voluntary && !over,
    infancy,
    infancyYears: INFANCY_YEARS,
    companyAge: age,
    why: over
      ? `At ${headcount} ${headcount === 1 ? 'employee' : 'employees'} the ${ACT} applies.`
      : voluntary
        ? `Under ${threshold} employees the Act does not apply, and this company has said it pays a bonus anyway.`
        : `Under ${threshold} employees the Act does not apply.`,
  }
}

// The accounting year, in the shape the rest of the app writes them, and when
// the money has to be out of the door.
// `back` steps to an earlier year. It is not decoration: on any day between
// April and November the year that matters is the one that closed in March,
// because that is the bonus coming due — the year in progress is not payable
// for another twenty months.
// How old the company is, in whole years, or null where nobody recorded when it
// started.
function ageInYears(born, asOf) {
  const b = String(born || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b)) return null
  const from = new Date(`${b}T00:00:00Z`)
  const to = new Date(`${String(asOf).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return null
  let years = to.getUTCFullYear() - from.getUTCFullYear()
  const m = to.getUTCMonth() - from.getUTCMonth()
  if (m < 0 || (m === 0 && to.getUTCDate() < from.getUTCDate())) years -= 1
  return Math.max(0, years)
}

export function bonusYear(fyStartMonth = 4, asOf = todayISO(), back = 0) {
  const d = new Date(`${String(asOf).slice(0, 10)}T00:00:00Z`)
  const m = d.getUTCMonth() + 1
  const start = (m >= fyStartMonth ? d.getUTCFullYear() : d.getUTCFullYear() - 1) - (Number(back) || 0)
  const endMonth = ((fyStartMonth - 2 + 12) % 12) + 1
  const endYear = fyStartMonth === 1 ? start : start + 1
  // Eight months after the close, which for an April year is the last day of
  // November — squarely on top of the season a builder is paying for materials.
  const dueMonth = ((endMonth - 1 + DUE_MONTHS) % 12) + 1
  const dueYear = endYear + (endMonth + DUE_MONTHS > 12 ? 1 : 0)
  const last = new Date(Date.UTC(dueYear, dueMonth, 0))
  const due = last.toISOString().slice(0, 10)
  const today = String(asOf).slice(0, 10)
  const to = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate()).padStart(2, '0')}`
  return {
    label: `${start}-${String(endYear % 100).padStart(2, '0')}`,
    from: `${start}-${String(fyStartMonth).padStart(2, '0')}-01`,
    to,
    due,
    // Three states, and they are not the same thing: a year still running is
    // not late, a year that closed is counting down, and a year past its due
    // date is money that should already have been paid.
    closed: today > to,
    overdue: today > due,
    daysToDue: Math.round((new Date(`${due}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000),
  }
}

// How much of the accounting year somebody was here for, which is what stops a
// man who joined in December being paid a year's bonus.
export function monthsInYear(joinedOn, { from, to }) {
  const j = String(joinedOn || '').slice(0, 10)
  if (!j) return { months: 12, known: false }
  if (j > to) return { months: 0, known: true }
  if (j <= from) return { months: 12, known: true }
  const start = new Date(`${from}T00:00:00Z`)
  const join = new Date(`${j}T00:00:00Z`)
  const whole = (join.getUTCFullYear() - start.getUTCFullYear()) * 12 + (join.getUTCMonth() - start.getUTCMonth())
  return { months: Math.max(0, 12 - whole), known: true }
}

// The register a company actually files, and the total it has to find.
export function bonusRegister(employees = [], {
  fyStartMonth = 4, asOf = todayISO(), rate = null, minimumWage = 0, config = {}, back = 1, born = '',
} = {}) {
  const active = employees.filter((e) => e.active !== false)
  const status = bonusStatus({ headcount: active.length, config, born, asOf })
  // The closed year by default, because that is the one with a due date on it.
  const year = bonusYear(fyStartMonth, asOf, back)
  // Null is not 8.33. Nobody having set a rate is a decision not taken, and the
  // minimum is what the law would impose rather than what the company chose.
  const chosen = rate == null ? null : Math.min(MAX_RATE, Math.max(MIN_RATE, Number(rate) || MIN_RATE))
  const applied = chosen ?? MIN_RATE

  const lines = active.map((e) => {
    const m = monthsInYear(e.joined_on, year)
    return { ...bonusFor(e, { rate: applied, minimumWage, monthsWorked: m.months }), datedJoin: m.known }
  })
  const paid = lines.filter((l) => l.eligible)
  return {
    ...status,
    year,
    rate: applied,
    rateChosen: chosen != null,
    minimumWage: Number(minimumWage) || 0,
    ceiling: Math.max(CALCULATION_CEILING, Number(minimumWage) || 0),
    lines,
    people: lines.length,
    eligible: paid.length,
    // Over the eligibility ceiling: not a mistake, just outside the Act.
    overCeiling: lines.filter((l) => l.overCeiling).length,
    // Eligible, but computed on the ceiling rather than on their pay. The
    // number this module exists to get right.
    held: lines.filter((l) => l.held).length,
    undated: lines.filter((l) => !l.datedJoin).length,
    total: paid.reduce((t, l) => t + l.amount, 0),
    // What the same people would cost at the maximum the Act allows, which is
    // the question every owner asks the moment they see the minimum.
    atMaximum: active.map((e) => {
      const m = monthsInYear(e.joined_on, year)
      return bonusFor(e, { rate: MAX_RATE, minimumWage, monthsWorked: m.months }).amount
    }).reduce((t, n) => t + n, 0),
  }
}
