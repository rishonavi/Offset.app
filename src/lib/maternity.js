// Maternity benefit, and the question that decides who writes the cheque.
//
// The Maternity Benefit Act, 1961 — rewritten in 2017 — gives a woman twenty-six
// weeks of paid leave for her first two children and twelve for the third, at
// her average daily wage, in an establishment with ten or more employees.
//
// But an employer covered by state insurance usually pays none of it. Where the
// woman is within ESI — the establishment registered, and her gross inside the
// ceiling — ESIC pays her maternity benefit and the employer pays nothing. The
// employer's liability is for the women ESI does not reach: the ones drawing
// over the ceiling, or everybody if the company never registered.
//
// That is the whole difficulty, and it is a question this app is unusually well
// placed to answer, because it already knows both halves: whether the company
// is registered for state insurance, and what each person draws. Getting it
// wrong in either direction is expensive — a company that budgets for leave ESI
// is paying wastes the money, and one that assumes ESI covers everybody finds
// out when a manager goes on leave and nothing arrives.
//
// The rest is thresholds and durations, and the one that catches people is
// eighty days: a woman must have worked eighty days in the twelve months before
// her expected date to qualify at all, which on a site with seasonal work is a
// real test and not a formality.

import { round2, grossOf } from './payroll'

// Maternity is the odd one of the three liabilities, and it matters.
//
// Gratuity and bonus are computed on basic plus dearness allowance. Section
// 3(n) of this Act defines wages as all cash remuneration *including* house
// rent allowance and every other cash allowance — excluding only overtime, the
// employer's provident fund contribution, gratuity and any bonus other than an
// incentive one. So it is the gross, and using basic plus DA here would
// understate a benefit by the whole of somebody's HRA.
//
// The same figure decides whether ESI reaches her, because the state-insurance
// ceiling is on gross too. Reading it off basic plus DA put a woman on ₹15,000
// basic and ₹8,000 HRA inside the ceiling when her gross of ₹23,000 is outside
// it — and that is not a rounding error, it is the wrong answer to the only
// question this module exists to settle.

const rupees = (n) => Math.round(Number(n) || 0)
const DAY = 86400000

export const THRESHOLD = 10
export const ACT = 'Maternity Benefit Act, 1961'
// Eighty days in the twelve months before the expected date.
export const QUALIFYING_DAYS = 80
// At fifty employees a creche is compulsory, with four visits a day.
export const CRECHE_THRESHOLD = 50
export const CRECHE_VISITS = 4
// Where the employer provides no free pre-natal and post-natal care.
export const MEDICAL_BONUS = 3500
// At most eight of the twenty-six weeks may be taken before the date.
export const MAX_PRENATAL_WEEKS = 8
// Nursing breaks, twice a day, until the child is fifteen months old.
export const NURSING_MONTHS = 15

// What each situation is worth, in weeks. The 2017 amendment tripled the first
// of these and left the third child where it was.
export const ENTITLEMENT = {
  first: { id: 'first', weeks: 26, label: 'First or second child', note: 'Twenty-six weeks, of which at most eight may be taken before the date.' },
  third: { id: 'third', weeks: 12, label: 'Third or later child', note: 'Twelve weeks. The 2017 amendment left this where it was.' },
  adoption: { id: 'adoption', weeks: 12, label: 'Adopting a child under three months', note: 'Twelve weeks from the day the child is handed over, not from a delivery date.' },
  commissioning: { id: 'commissioning', weeks: 12, label: 'Commissioning mother', note: 'Twelve weeks from the day the child is handed over.' },
  miscarriage: { id: 'miscarriage', weeks: 6, label: 'Miscarriage or medical termination', note: 'Six weeks from the day it happens.' },
  tubectomy: { id: 'tubectomy', weeks: 2, label: 'Tubectomy', note: 'Two weeks from the day of the operation.' },
}
export const ENTITLEMENT_IDS = Object.keys(ENTITLEMENT)
// Illness arising out of pregnancy, delivery or miscarriage adds a month.
export const ILLNESS_WEEKS = 4

// Whether the Act applies, and what else the headcount brings with it.
export function maternityStatus({ headcount = 0, config = {} } = {}) {
  const threshold = Number(config.threshold ?? THRESHOLD)
  const creche = Number(config.crecheThreshold ?? CRECHE_THRESHOLD)
  const n = Number(headcount) || 0
  return {
    threshold, headcount: n, act: ACT,
    applies: n >= threshold,
    crecheThreshold: creche,
    // A separate duty with a separate threshold, and one nobody hears about
    // until an inspector asks.
    crecheRequired: n >= creche,
    crecheVisits: CRECHE_VISITS,
    why: n >= threshold
      ? `At ${n} ${n === 1 ? 'employee' : 'employees'} the ${ACT} applies.`
      : `Under ${threshold} employees the Act does not apply.`,
  }
}

// Who pays. The question the whole module turns on.
//
// `esi` is the company's state-insurance config, the same object payroll reads,
// so the two cannot disagree about whether the company is registered.
export function whoPays(employee, { esi = {}, gross = null } = {}) {
  const registered = esi.registered === true || esi.enabled === true
  const ceiling = Number(esi.grossCeiling ?? 21000)
  const pay = gross == null ? grossOf(employee) : Number(gross) || 0
  if (!registered) {
    return { payer: 'employer', covered: false, ceiling,
      why: 'The company is not registered for state insurance, so the employer pays the whole benefit.' }
  }
  if (pay > ceiling) {
    return { payer: 'employer', covered: false, ceiling,
      why: `Drawing more than the ₹${ceiling.toLocaleString('en-IN')} state-insurance ceiling, so ESI does not cover her and the employer pays.` }
  }
  return { payer: 'esic', covered: true, ceiling,
    why: `Within the ₹${ceiling.toLocaleString('en-IN')} state-insurance ceiling, so ESIC pays the benefit and the employer pays nothing.` }
}

const addDays = (iso, n) => new Date(new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).getTime() + n * DAY)
  .toISOString().slice(0, 10)

// One woman's entitlement, priced, with the dates and the payer.
export function maternityFor(employee, {
  kind = 'first', expectedOn = '', daysWorked = null, preNatalWeeks = MAX_PRENATAL_WEEKS,
  illness = false, medicalCareProvided = false, esi = {}, config = {},
} = {}) {
  const ent = ENTITLEMENT[kind] || ENTITLEMENT.first
  const weeks = ent.weeks + (illness ? ILLNESS_WEEKS : 0)
  const days = weeks * 7
  const wages = grossOf(employee)
  // Average daily wage over the three months before. Where nobody has worked
  // out an average, this month's wages stand in.
  const perDay = wages / 30
  const payer = whoPays(employee, { esi })

  // Eighty days in the twelve months before the expected date. A real test on a
  // site with seasonal work, and one nobody remembers until it bites.
  const worked = daysWorked == null ? null : Math.max(0, Number(daysWorked) || 0)
  const qualifies = worked == null ? null : worked >= QUALIFYING_DAYS

  // Adoption and the rest run from the day it happens, not from a date eight
  // weeks earlier — there is nothing to take before the fact.
  const prenatal = ['first', 'third'].includes(ent.id)
    ? Math.max(0, Math.min(MAX_PRENATAL_WEEKS, Number(preNatalWeeks) || 0))
    : 0
  const from = expectedOn ? addDays(expectedOn, -prenatal * 7) : ''
  const to = from ? addDays(from, days - 1) : ''

  return {
    employee_id: employee?.id,
    name: employee?.name || '',
    kind: ent.id,
    label: ent.label,
    note: ent.note,
    weeks,
    days,
    illness,
    preNatalWeeks: prenatal,
    from,
    to,
    expectedOn: String(expectedOn || '').slice(0, 10),
    wages,
    perDay: round2(perDay),
    // What the leave is worth. Whoever pays it, it is the same money — but only
    // one of them is this company.
    //
    // Eighty days short and it is nobody's money: she does not qualify, and a
    // figure shown beside "does not qualify" is a figure somebody will budget
    // for. `null` days worked is unknown rather than disqualifying, so it keeps
    // its number.
    amount: qualifies === false ? 0 : rupees(perDay * days),
    // ₹3,500 on top, and only where the employer gave no free pre-natal and
    // post-natal care. Under ESI, confinement expenses come from ESIC instead.
    medicalBonus: qualifies !== false && payer.payer === 'employer' && !medicalCareProvided
      ? Number(config.medicalBonus ?? MEDICAL_BONUS) : 0,
    ...payer,
    // What this company actually has to find.
    employerCost: qualifies !== false && payer.payer === 'employer'
      ? rupees(perDay * days) + (medicalCareProvided ? 0 : Number(config.medicalBonus ?? MEDICAL_BONUS))
      : 0,
    daysWorked: worked,
    qualifies,
    why: qualifies === false
      ? `Worked ${worked} days in the year before, and the Act asks for ${QUALIFYING_DAYS}.`
      : `${weeks} weeks${illness ? ', including a month for illness arising out of it' : ''}. ${payer.why}`,
  }
}

// The company's exposure: who on the payroll the Act could reach, and which of
// them ESI would not cover.
//
// It is deliberately not a prediction about anybody. It is the two counts a
// company needs to know it has a liability at all — and the third, which is the
// people whose sex nobody recorded, because a register that quietly counts them
// as men is the same failure as every other unfilled field in this app.
export function maternityExposure(employees = [], { esi = {}, config = {} } = {}) {
  const active = employees.filter((e) => e.active !== false)
  const status = maternityStatus({ headcount: active.length, config })
  const women = active.filter((e) => e.female === true)
  const unrecorded = active.filter((e) => e.female == null)
  const outside = women.filter((e) => whoPays(e, { esi }).payer === 'employer')
  return {
    ...status,
    people: active.length,
    women: women.length,
    // Nobody recorded whether these people are women, so nobody knows whether
    // they are in this number.
    unrecorded: unrecorded.length,
    // The ones this company would pay for itself.
    employerPays: outside.length,
    esicPays: women.length - outside.length,
    lines: outside.map((e) => maternityFor(e, { esi, config })),
    // What twenty-six weeks for the women ESI does not reach would cost.
    exposure: outside.reduce((t, e) => t + maternityFor(e, { esi, config }).employerCost, 0),
  }
}
