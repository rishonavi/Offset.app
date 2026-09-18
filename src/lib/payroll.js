// Payroll, Indian statutory shape.
//
// Gross is built from components; deductions come off it; what's left is take-
// home. The statutory pieces — provident fund, employee state insurance,
// professional tax — have rules that are stable enough to encode and thresholds
// that change often enough to keep configurable. TDS is not computed here: it
// depends on the employee's declared investments and projected annual income,
// and guessing it wrong is worse than asking for it.
//
// Every rate below is a default, not a constant. A company on a different PF
// arrangement changes the config; it does not edit this file.

import { ptaxFor, workStateOf, STATES } from './ptax'

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const rupee = (n) => Math.round(Number(n) || 0) // statutory amounts are whole rupees

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)

// ── Configuration ──────────────────────────────────────────────────
export const DEFAULT_PAYROLL_CONFIG = {
  pf: {
    // Whether the company is registered under the EPF Act.
    //
    // `null` is not "no". It means nobody has said, and the two are different
    // answers: a payroll that deducted nothing because a flag was never set is
    // as wrong as one that deducted because a flag defaulted to true. It used
    // to default to true, so every company — including a builder with four men
    // and no registration — had twelve per cent taken off every payslip with
    // nowhere to turn it off.
    registered: null,
    employeeRate: 12,
    employerRate: 12,
    // PF is statutorily calculated on basic up to ₹15,000/month. Many employers
    // pay on actual basic instead; both are legitimate, so it is a switch.
    wageCeiling: 15000,
    applyCeiling: true,
  },
  esi: {
    registered: null,
    employeeRate: 0.75,
    employerRate: 3.25,
    // ESI applies only below a gross ceiling, and once someone is in a
    // contribution period they stay in it — that subtlety is left to the user.
    grossCeiling: 21000,
  },
  // Professional tax is a state subject, and until now Maharashtra's slabs were
  // the default for everybody — so a company in Delhi, which levies no
  // professional tax at all, had ₹200 a month taken off every payslip. The
  // state is the question; `ptax.js` holds all of them.
  // Both apply on a headcount and neither is deducted from anybody, so the only
  // thing to configure is the voluntary case and, for bonus, the rate and the
  // minimum wage.
  gratuity: { voluntary: false },
  leave: { policy: 'factories' },
  bonus: { voluntary: false, rate: null, minimumWage: 0 },
  professionalTax: {
    // Null means nobody has said. It is filled in from the company's GSTIN
    // where there is one, because the first two digits of a GSTIN are the
    // state and asking a second time only invites the two to disagree.
    state: null,
    // A company that has entered its own slabs — because its state revised
    // them, or because `ptax.js` does not carry that state — overrides the
    // table. Null means use the table.
    slabs: null,
  },
}

// Dearness allowance sits beside basic rather than among the allowances,
// because two Acts define wages as basic *plus DA* and nothing else: gratuity
// is 15/26ths of it, and bonus is a percentage of it. Folding DA into "special"
// would understate both for every company that pays one.
export const PAY_COMPONENTS = ['basic', 'da', 'hra', 'conveyance', 'medical', 'special', 'other']

// What the Gratuity and Bonus Acts mean by wages, which is not gross and not
// basic either. HRA, conveyance and the rest are outside it.
export const wagesOf = (employee) =>
  round2((Number(employee?.pay?.basic) || 0) + (Number(employee?.pay?.da) || 0))

// ── Who has to run these schemes at all ─────────────────────────────
//
// Neither scheme is something an employer opts into on a whim, and neither is
// something every employer has. Both turn on a headcount, and the headcount is
// of the establishment rather than of whoever happens to be on this month's
// payroll.
//
//   **Provident fund** — the EPF & MP Act bites at twenty employees. Below
//   that an employer may register voluntarily and many do, so being under the
//   threshold is not an answer on its own.
//
//   **State insurance** — the ESI Act bites at ten in most states and twenty in
//   a few, which is why the number is configurable rather than written into a
//   comparison. On top of that it covers only employees drawing up to the gross
//   ceiling, and that part is per person rather than per company.
//
// So there are two separate questions and this app had been answering neither:
// is the company registered, and is it over the threshold. A company can be
// registered and under the threshold (voluntary), or over the threshold and not
// registered — which is not a payroll setting, it is a compliance problem, and
// it is the one worth saying out loud.
export const SCHEMES = {
  pf: {
    id: 'pf',
    label: 'Provident fund',
    short: 'PF',
    // Employees, not employees on this month's slips.
    threshold: 20,
    act: 'EPF & MP Act',
    note: 'Mandatory at twenty employees. Voluntary registration below that is common.',
  },
  esi: {
    id: 'esi',
    label: 'Employee state insurance',
    short: 'ESI',
    threshold: 10,
    act: 'ESI Act',
    note: 'Mandatory at ten employees in most states — twenty in a few — and only for those drawing up to the gross ceiling.',
  },
}
export const SCHEME_IDS = Object.keys(SCHEMES)

// Whether a scheme runs, and why. Read this before computing anything.
export function schemeStatus(id, { headcount = 0, config = DEFAULT_PAYROLL_CONFIG } = {}) {
  const scheme = SCHEMES[id]
  const own = config?.[id] || {}
  // `enabled` is the older spelling and still honoured: a config that says so
  // explicitly means it, and silently ignoring it would turn somebody's
  // deliberate setting into a default.
  const registered = own.registered === undefined
    ? (own.enabled === true ? true : own.enabled === false ? false : null)
    : own.registered
  const threshold = Number(own.threshold ?? scheme.threshold)
  const over = (Number(headcount) || 0) >= threshold

  if (registered === true) {
    return {
      ...scheme, threshold, headcount, over, registered: true, runs: true, answered: true,
      why: over
        ? `Registered, and at ${headcount} ${headcount === 1 ? 'employee' : 'employees'} it is required.`
        : `Registered voluntarily — under ${threshold} employees it is not required.`,
    }
  }
  if (registered === false) {
    return {
      ...scheme, threshold, headcount, over, registered: false, runs: false, answered: true,
      // Over the threshold and not registered is not a payroll setting. It is a
      // thing somebody needs to do something about.
      mustRegister: over,
      why: over
        ? `Not registered, but at ${headcount} employees ${scheme.act} requires it.`
        : `Not registered, and under ${threshold} employees it is not required.`,
    }
  }
  return {
    ...scheme, threshold, headcount, over, registered: null, runs: false, answered: false,
    mustRegister: over,
    why: over
      ? `Nobody has said whether the company is registered, and at ${headcount} employees ${scheme.act} requires it.`
      : 'Nobody has said whether the company is registered, so nothing is being deducted.',
  }
}

export function statutoryStatus({ headcount = 0, config = DEFAULT_PAYROLL_CONFIG } = {}) {
  const out = {}
  for (const id of SCHEME_IDS) out[id] = schemeStatus(id, { headcount, config })
  return {
    ...out,
    unanswered: SCHEME_IDS.filter((id) => !out[id].answered),
    // Over a threshold with no registration, whether that was said or never
    // asked. The only one of these that costs money to ignore.
    mustRegister: SCHEME_IDS.filter((id) => out[id].mustRegister),
  }
}

// The company's answers as a payroll config.
//
// Three screens need this — the payroll tab, the report and the attention list
// — and each of them built it inline, which is three chances to forget. The
// report did forget: it called `payrollOverPeriods` with no config at all, so a
// company that had said it was registered for provident fund saw the deduction
// on its payslips and a cost-to-company in its report that did not include it.
export function configForEntity(entity, base = DEFAULT_PAYROLL_CONFIG) {
  const out = { ...base }
  for (const id of SCHEME_IDS) {
    out[id] = { ...(base[id] || {}), registered: entity?.[`${id}_registered`] ?? null }
  }
  // Gratuity and bonus, which apply by operation of law rather than by
  // registering — so there is no yes/no to ask, only a threshold and, under it,
  // whether the company pays anyway.
  out.gratuity = { voluntary: entity?.gratuity_voluntary === true }
  // Earned leave: no single Act, so the policy is the company's to state. The
  // Factories Act shape is the default because it is the one a site is most
  // likely under.
  out.leave = {
    policy: entity?.leave_policy || 'factories',
    carryCap: entity?.leave_carry_cap ?? undefined,
    daysPerYear: entity?.leave_days_per_year ?? undefined,
    divisor: entity?.leave_divisor ?? undefined,
  }
  out.bonus = {
    voluntary: entity?.bonus_voluntary === true,
    rate: entity?.bonus_rate ?? null,
    minimumWage: Number(entity?.minimum_wage) || 0,
  }
  // The professional-tax state, chosen if somebody chose one and otherwise read
  // off the GSTIN, whose first two digits are the state. A company that has
  // entered its own slabs keeps them.
  out.professionalTax = {
    ...(base.professionalTax || {}),
    state: workStateOf(null, entity) || null,
    slabs: entity?.pt_slabs?.length ? entity.pt_slabs : (base.professionalTax?.slabs || null),
  }
  return out
}

// The config a run should actually use, once the company's own answers and its
// headcount have been taken into account. Everything downstream computes from
// this rather than from the raw config, so a scheme cannot run by accident.
export function resolveConfig(config = DEFAULT_PAYROLL_CONFIG, headcount = 0) {
  const out = { ...config }
  for (const id of SCHEME_IDS) {
    out[id] = { ...(config[id] || {}), enabled: schemeStatus(id, { headcount, config }).runs }
  }
  return out
}

export function makeEmployee({
  id, entityId, name, code = '', email = '', departmentId = null,
  basic = 0, da = 0, hra = 0, conveyance = 0, medical = 0, special = 0, other = 0,
  pan = '', uan = '', joinedOn = '', active = true, workState = '', female = null, leaveBalance = 0,
} = {}) {
  return {
    id: id || newId(),
    entity_id: entityId,
    name: (name || 'Unnamed').trim().slice(0, 120),
    code: code.trim().toUpperCase().slice(0, 20),
    email: email.trim().toLowerCase(),
    department_id: departmentId,
    pay: {
      basic: Math.max(0, round2(basic)),
      da: Math.max(0, round2(da)),
      hra: Math.max(0, round2(hra)),
      conveyance: Math.max(0, round2(conveyance)),
      medical: Math.max(0, round2(medical)),
      special: Math.max(0, round2(special)),
      other: Math.max(0, round2(other)),
    },
    pan: pan.trim().toUpperCase().slice(0, 10),
    uan: uan.trim().slice(0, 12),
    joined_on: joinedOn,
    // Where this person works, as a GST state code, when that is not where the
    // company keeps its books. Professional tax follows the work: a Mumbai
    // builder's men on a Bengaluru site owe Karnataka, not Maharashtra.
    work_state: STATES[String(workState || '').trim()] ? String(workState).trim() : '',
    // Whether this person is a woman, which Maharashtra needs and nowhere else
    // does — it exempts women drawing up to ₹25,000 a month. Three-valued for
    // the same reason registration is: nobody having recorded it is not the
    // same as everybody being a man, and an exemption going unclaimed because a
    // field was never filled in costs somebody ₹2,400 a year.
    female: female === true ? true : female === false ? false : null,
    // Days of earned leave standing. It is a liability like gratuity — payable
    // in cash on the way out — and a cap that lapses at the year end, which is
    // the worker's money rather than the company's.
    leave_balance: Math.max(0, round2(leaveBalance)),
    active: Boolean(active),
    created_at: new Date().toISOString(),
  }
}

export const grossOf = (employee) =>
  round2(PAY_COMPONENTS.reduce((t, k) => t + (Number(employee.pay?.[k]) || 0), 0))

// ── Statutory pieces ───────────────────────────────────────────────
//
// A scheme runs when the company says it is registered for it, and `enabled` is
// the older spelling of the same switch — `resolveConfig` writes it, and a
// config somebody set by hand may use it. Neither is a default: with neither
// said, nothing is deducted.
const schemeOn = (own = {}) => own.enabled === true || own.registered === true

export function providentFund(basic, config = DEFAULT_PAYROLL_CONFIG.pf) {
  if (!schemeOn(config)) return { employee: 0, employer: 0, wage: 0 }
  const wage = config.applyCeiling ? Math.min(Number(basic) || 0, config.wageCeiling) : Number(basic) || 0
  return {
    wage: round2(wage),
    employee: rupee((wage * config.employeeRate) / 100),
    employer: rupee((wage * config.employerRate) / 100),
  }
}

export function stateInsurance(gross, config = DEFAULT_PAYROLL_CONFIG.esi) {
  if (!schemeOn(config) || (Number(gross) || 0) > config.grossCeiling) {
    return { employee: 0, employer: 0, applicable: false }
  }
  return {
    applicable: true,
    // ESI rounds up to the next rupee, by rule.
    employee: Math.ceil((gross * config.employeeRate) / 100),
    employer: Math.ceil((gross * config.employerRate) / 100),
  }
}

// Professional tax against a set of slabs given by hand. There is no default:
// there used to be, it was Maharashtra's, and every company in the country got
// it. A caller with no slabs is a caller who has not said which state.
export function professionalTax(gross, month, config = null) {
  if (!config || config.enabled === false || !config.slabs?.length) return 0
  const slab = config.slabs.find((s) => (Number(gross) || 0) <= s.upTo)
  const base = slab ? slab.amount : 0
  // A state's odd month only applies where tax is due at all.
  if (base > 0 && config.februaryAmount && Number(month) === Number(config.extra?.month ?? 2)) return config.februaryAmount
  return base
}

// Professional tax for one person for one month, which needs to know three
// things a gross figure does not carry: which state the work is in, which month
// of the state's year it is, and — in Maharashtra — whether the person is a
// woman. Returns the whole answer rather than a number, because a zero here has
// four meanings and a payslip has to be able to tell them apart.
export function professionalTaxFor(employee, { period = '', gross = 0, config = DEFAULT_PAYROLL_CONFIG, entity = null } = {}) {
  const own = config?.professionalTax || {}
  return ptaxFor({
    // The employee's own work state wins. Professional tax follows where the
    // work is done, so a Mumbai company's men on a Bengaluru site owe Karnataka.
    state: workStateOf(employee, entity || { pt_state: own.state }),
    monthlyGross: gross,
    period,
    female: employee?.female ?? null,
    override: own.slabs?.length ? own : null,
  })
}

// ── A payslip ──────────────────────────────────────────────────────
// `period` is YYYY-MM. Extra deductions (TDS, a loan instalment, an advance
// being recovered) are passed in rather than invented.
export function payslipFor(employee, { period, config = DEFAULT_PAYROLL_CONFIG, tds = 0, advanceRecovery = 0, otherDeductions = 0, lopDays = 0, monthDays = 30 } = {}) {
  const month = Number(String(period || '').slice(5, 7)) || 1
  const full = grossOf(employee)

  // Loss of pay reduces every component proportionally, which is how a
  // pro-rated month is actually run.
  const workedRatio = monthDays > 0 ? Math.max(0, Math.min(1, (monthDays - (Number(lopDays) || 0)) / monthDays)) : 1
  const gross = round2(full * workedRatio)
  const basic = round2((Number(employee.pay?.basic) || 0) * workedRatio)

  const pf = providentFund(basic, config.pf)
  const esi = stateInsurance(gross, config.esi)
  const pt = professionalTaxFor(employee, { period, gross, config })

  const deductions = {
    pf: pf.employee,
    esi: esi.employee,
    professionalTax: pt.amount,
    tds: Math.max(0, round2(tds)),
    advanceRecovery: Math.max(0, round2(advanceRecovery)),
    other: Math.max(0, round2(otherDeductions)),
  }
  const totalDeductions = round2(Object.values(deductions).reduce((t, v) => t + v, 0))

  return {
    employee_id: employee.id,
    entity_id: employee.entity_id,
    department_id: employee.department_id,
    period,
    lopDays: Number(lopDays) || 0,
    components: PAY_COMPONENTS.reduce((acc, k) => {
      acc[k] = round2((Number(employee.pay?.[k]) || 0) * workedRatio)
      return acc
    }, {}),
    gross,
    deductions,
    totalDeductions,
    // Take-home can't go below zero: a deduction bigger than the pay is a data
    // error, and showing a negative payslip hides it.
    net: round2(Math.max(0, gross - totalDeductions)),
    // What the employee costs the company, which is not what they are paid.
    employerCost: round2(gross + pf.employer + esi.employer),
    employer: { pf: pf.employer, esi: esi.employer },
    esiApplicable: esi.applicable,
    // Why the professional tax is what it is. A zero means one of four
    // different things — no state named, a state that levies none, a state
    // whose slabs nobody has entered, or a person under the threshold — and
    // carrying only the number throws away which.
    ptax: { state: pt.code, stateName: pt.name, why: pt.why, amount: pt.amount,
      unanswered: Boolean(pt.unanswered), needsSlabs: Boolean(pt.needsSlabs),
      verify: Boolean(pt.verify),
      none: Boolean(pt.none), mayBeExempt: Boolean(pt.mayBeExempt), exempt: Boolean(pt.exempt) },
    // Flagged rather than silently clamped.
    overDeducted: totalDeductions > gross + 0.001,
  }
}

// ── A payroll run ──────────────────────────────────────────────────
// Three states, and the difference between them is whether the month is still
// a question. A draft can be run again — somebody's LOP was wrong, an advance
// was recovered twice. Approved and paid are history: the money has been
// committed, and a figure that changes after that is not a record of anything.
export const RUN_STATUS = { draft: 'draft', approved: 'approved', paid: 'paid' }
export const RUN_STATUS_IDS = Object.keys(RUN_STATUS)
export const RUN_STATUS_LABEL = { draft: 'Draft', approved: 'Approved', paid: 'Paid' }

// Once it is approved the month stops being recomputed and starts being read.
export const isLocked = (run) => run?.status === RUN_STATUS.approved || run?.status === RUN_STATUS.paid

// Who was drawing a salary in a given month. Someone hired in March cost
// nothing in January, and a report over a year that says otherwise is simply
// wrong. Compared as YYYY-MM so there is no date arithmetic to get wrong.
export function onPayrollIn(employees, period) {
  return employees.filter(
    (e) => e.active !== false && (!e.joined_on || String(e.joined_on).slice(0, 7) <= String(period || '')),
  )
}

export function runPayroll(employees, { period, config = DEFAULT_PAYROLL_CONFIG, perEmployee = {} } = {}) {
  const active = period ? onPayrollIn(employees, period) : employees.filter((e) => e.active !== false)
  // The headcount for *this* month, which is the set that gets slips.
  //
  // An earlier version counted every active employee instead, on the reasoning
  // that a scheme applies to the establishment rather than to one month's
  // payroll. That is true of the Act and false of this data: the only way the
  // two sets differ here is somebody hired after the period, and a person who
  // has not started is not employed. Counting them would put a company over a
  // threshold a month before it got there.
  const employed = active.length
  const statutory = statutoryStatus({ headcount: employed, config })
  // Resolved rather than raw, so a scheme the company has not said it is
  // registered for cannot run because a default said so.
  const settled = resolveConfig(config, employed)
  const slips = active.map((e) => payslipFor(e, { period, config: settled, ...(perEmployee[e.id] || {}) }))
  return {
    period,
    slips,
    employed,
    // What applies, and why. Carried on the run so a slip can be explained
    // months later without re-deriving it from a headcount that has changed.
    schemes: statutory,
    config: settled,
    headcount: slips.length,
    gross: round2(slips.reduce((t, s) => t + s.gross, 0)),
    deductions: round2(slips.reduce((t, s) => t + s.totalDeductions, 0)),
    net: round2(slips.reduce((t, s) => t + s.net, 0)),
    employerCost: round2(slips.reduce((t, s) => t + s.employerCost, 0)),
    // What has to be deposited with the government for this month.
    statutory: {
      pf: round2(slips.reduce((t, s) => t + s.deductions.pf + s.employer.pf, 0)),
      esi: round2(slips.reduce((t, s) => t + s.deductions.esi + s.employer.esi, 0)),
      professionalTax: round2(slips.reduce((t, s) => t + s.deductions.professionalTax, 0)),
      tds: round2(slips.reduce((t, s) => t + s.deductions.tds, 0)),
    },
    // Professional tax across the run, which is the only place the state
    // question shows up as a number. A run can span several states — a builder
    // with a site over a border is the ordinary case — so this counts them
    // rather than assuming one.
    ptax: ptaxSummary(slips),
    problems: slips.filter((s) => s.overDeducted).length,
    // A scheme nobody has answered for is not a quiet zero. It is a question,
    // and the run says so rather than producing a payslip that looks complete.
    unanswered: statutory.unanswered,
    mustRegister: statutory.mustRegister,
  }
}

// What the professional tax on a run adds up to, and what is unresolved about
// it. Four kinds of zero, counted separately, because "nothing is due" and
// "nobody has said which state" look identical inside a total.
export function ptaxSummary(slips = []) {
  const byState = new Map()
  for (const s of slips) {
    const code = s.ptax?.state || ''
    const cur = byState.get(code) || { code, name: s.ptax?.stateName || '', people: 0, amount: 0 }
    cur.people += 1
    cur.amount = round2(cur.amount + (s.deductions?.professionalTax || 0))
    byState.set(code, cur)
  }
  const count = (k) => slips.filter((s) => s.ptax?.[k]).length
  return {
    total: round2(slips.reduce((t, s) => t + (s.deductions?.professionalTax || 0), 0)),
    states: [...byState.values()].sort((a, b) => b.people - a.people),
    // Nobody has named a state for these people at all.
    unanswered: count('unanswered'),
    // The state levies professional tax and its slabs are not built in, so this
    // is deducting nothing where something is owed. A guard: nothing in the
    // shipped table trips it, and a test asserts as much.
    needsSlabs: count('needsSlabs'),
    // Deducting, but from slabs that are this app's best reading of a
    // notification rather than something to file a return on unchecked.
    verify: count('verify'),
    // Maharashtra exempts women up to a ceiling and nobody recorded who is a
    // woman, so this may be deducting from somebody who owes nothing.
    mayBeExempt: count('mayBeExempt'),
    exempt: count('exempt'),
  }
}

// The months a date range covers, as YYYY-MM. A range with no end runs to the
// month the range starts in rather than to the end of time.
export function periodsBetween(fromISO, toISO) {
  const first = String(fromISO || '').slice(0, 7)
  const last = String(toISO || '').slice(0, 7) || first
  if (!first || !last || last < first) return first && !toISO ? [first] : []
  const out = []
  let [y, m] = first.split('-').map(Number)
  // A year of months at most, so a filter set to 1900 cannot spin here.
  for (let guard = 0; guard < 600; guard += 1) {
    const period = `${y}-${String(m).padStart(2, '0')}`
    out.push(period)
    if (period >= last) break
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return out
}

// Payroll month by month across a range, which is what a report over a period
// asks for. Offset keeps no history of past runs — it holds today's employees
// and today's salaries — so every month here is computed from the payroll as it
// stands now. That is a projection backwards, and the screen says so.
export function payrollOverPeriods(employees, periods, { config = DEFAULT_PAYROLL_CONFIG, runs = [], entityId = null } = {}) {
  const months = periods.map((period) => payrollForPeriod(employees, period, { runs, entityId, config }))
  const sum = (pick) => round2(months.reduce((t, r) => t + pick(r), 0))
  return {
    months,
    // How much of the answer is a record and how much is arithmetic on today's
    // salaries. A year that is half-recorded is not a year of history, and the
    // screen has to be able to say so.
    recorded: months.filter((r) => r.recorded).length,
    projected: months.filter((r) => !r.recorded).length,
    headcount: months.length ? Math.max(...months.map((r) => r.headcount)) : 0,
    gross: sum((r) => r.gross),
    net: sum((r) => r.net),
    employerCost: sum((r) => r.employerCost),
    statutory: {
      pf: sum((r) => r.statutory.pf),
      esi: sum((r) => r.statutory.esi),
      professionalTax: sum((r) => r.statutory.professionalTax),
      tds: sum((r) => r.statutory.tds),
    },
  }
}

// ── A run that is kept, rather than worked out again ───────────────
//
// Everything above computes a month from the payroll as it stands now. That is
// right for this month and wrong for every month before it: give somebody a
// raise in June and March silently becomes more expensive, because March was
// never a record — it was an arithmetic done on today's numbers and presented
// as history. An auditor asking what was paid in March gets a different answer
// depending on when they ask.
//
// So a run, once approved, is frozen: the slips exactly as they were, with
// enough of the employee copied onto each one that the row can be deleted and
// the payslip still says who it was for. That last part is the whole of it. A
// slip carrying only an `employee_id` is a slip that stops meaning anything the
// day somebody leaves and is removed from the roster.

const stamp = (employee) => ({
  name: employee?.name || 'Unknown',
  code: employee?.code || '',
  department_id: employee?.department_id ?? null,
})

export function makePayrollRun({
  id, entityId, period, run, employees = [], actor = null,
  config = DEFAULT_PAYROLL_CONFIG, note = '', status = RUN_STATUS.draft,
} = {}) {
  const byId = new Map(employees.map((e) => [e.id, e]))
  const slips = (run?.slips || []).map((slip) => ({ ...slip, ...stamp(byId.get(slip.employee_id)) }))
  return {
    id: id || newId(),
    entity_id: entityId,
    period: String(period || '').slice(0, 7),
    status: RUN_STATUS[status] ? status : RUN_STATUS.draft,
    // The figures, copied rather than referenced. They are re-derived from the
    // frozen slips on the way in so a run whose totals disagree with its own
    // payslips cannot be written in the first place.
    slips,
    headcount: slips.length,
    gross: round2(slips.reduce((t, s) => t + s.gross, 0)),
    deductions: round2(slips.reduce((t, s) => t + s.totalDeductions, 0)),
    net: round2(slips.reduce((t, s) => t + s.net, 0)),
    employer_cost: round2(slips.reduce((t, s) => t + s.employerCost, 0)),
    statutory: {
      pf: round2(slips.reduce((t, s) => t + s.deductions.pf + s.employer.pf, 0)),
      esi: round2(slips.reduce((t, s) => t + s.deductions.esi + s.employer.esi, 0)),
      professionalTax: round2(slips.reduce((t, s) => t + s.deductions.professionalTax, 0)),
      tds: round2(slips.reduce((t, s) => t + s.deductions.tds, 0)),
    },
    // Professional tax across the run, which is the only place the state
    // question shows up as a number. A run can span several states — a builder
    // with a site over a border is the ordinary case — so this counts them
    // rather than assuming one.
    ptax: ptaxSummary(slips),
    problems: slips.filter((s) => s.overDeducted).length,
    // The rates it was run under. PF ceilings and ESI thresholds change between
    // financial years, and a run re-read under this year's rates would not be
    // the run that happened.
    config,
    note: String(note).trim().slice(0, 200),
    run_by: actor?.id || null,
    run_at: new Date().toISOString(),
    approved_by: null,
    approved_at: null,
    paid_at: null,
    created_at: new Date().toISOString(),
  }
}

// The run kept for a month, if there is one. Drafts count: a draft is still the
// month somebody has been working on, and showing a projection beside it would
// be two answers to one question.
export function recordedRun(runs = [], { entityId = null, period } = {}) {
  return runs.find(
    (r) => !r.deleted_at && r.period === String(period || '').slice(0, 7) && (!entityId || r.entity_id === entityId),
  ) || null
}

// What moving a run to a new state is allowed to do. Stated here rather than in
// the screen, because a rule enforced by a disabled button is not a rule.
export function canSetStatus(run, next) {
  if (!run) return { ok: false, why: 'There is no run to change.' }
  if (!RUN_STATUS[next]) return { ok: false, why: 'That is not a state a run can be in.' }
  if (run.status === next) return { ok: false, why: `This run is already ${RUN_STATUS_LABEL[next].toLowerCase()}.` }
  if (run.status === RUN_STATUS.paid) return { ok: false, why: 'This month has been paid. A paid run is a record, not a draft.' }
  if (next === RUN_STATUS.draft) return { ok: false, why: 'An approved run cannot be reopened. Run the next month instead, or correct it there.' }
  if (next === RUN_STATUS.paid && run.status !== RUN_STATUS.approved) {
    return { ok: false, why: 'A run has to be approved before it can be marked paid.' }
  }
  return { ok: true, why: '' }
}

// Whether this month can be computed again and written over what is there.
export function canRerun(run) {
  if (!run) return { ok: true, why: '' }
  if (isLocked(run)) {
    return { ok: false, why: `${run.period} is ${RUN_STATUS_LABEL[run.status].toLowerCase()} and no longer changes.` }
  }
  return { ok: true, why: '' }
}

// One month, answered from the record where there is one and from today's
// payroll where there is not — and saying which, because the two are not the
// same kind of number and a report that mixes them silently is worse than one
// that refuses.
export function payrollForPeriod(employees, period, { runs = [], entityId = null, config = DEFAULT_PAYROLL_CONFIG } = {}) {
  const kept = recordedRun(runs, { entityId, period })
  if (kept) {
    return {
      period,
      recorded: true,
      status: kept.status,
      runId: kept.id,
      slips: kept.slips,
      headcount: kept.headcount,
      gross: kept.gross,
      deductions: kept.deductions,
      net: kept.net,
      employerCost: kept.employer_cost,
      statutory: kept.statutory,
      problems: kept.problems,
    }
  }
  return { ...runPayroll(employees, { period, config }), recorded: false, status: null, runId: null }
}

// Payroll by department, so a cost centre report includes its people.
export function payrollByDepartment(run, departments) {
  const byId = new Map(departments.map((d) => [d.id, d]))
  const map = new Map()
  for (const s of run.slips) {
    const key = s.department_id || 'unassigned'
    const cur = map.get(key) || {
      departmentId: s.department_id,
      name: byId.get(s.department_id)?.name || 'Unassigned',
      headcount: 0,
      gross: 0,
      net: 0,
      cost: 0,
    }
    cur.headcount += 1
    cur.gross = round2(cur.gross + s.gross)
    cur.net = round2(cur.net + s.net)
    cur.cost = round2(cur.cost + s.employerCost)
    map.set(key, cur)
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost)
}
