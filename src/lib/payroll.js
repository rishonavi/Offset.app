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

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const rupee = (n) => Math.round(Number(n) || 0) // statutory amounts are whole rupees

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)

// ── Configuration ──────────────────────────────────────────────────
export const DEFAULT_PAYROLL_CONFIG = {
  pf: {
    enabled: true,
    employeeRate: 12,
    employerRate: 12,
    // PF is statutorily calculated on basic up to ₹15,000/month. Many employers
    // pay on actual basic instead; both are legitimate, so it is a switch.
    wageCeiling: 15000,
    applyCeiling: true,
  },
  esi: {
    enabled: true,
    employeeRate: 0.75,
    employerRate: 3.25,
    // ESI applies only below a gross ceiling, and once someone is in a
    // contribution period they stay in it — that subtlety is left to the user.
    grossCeiling: 21000,
  },
  // Professional tax is a state subject. Maharashtra's slab is the default.
  professionalTax: {
    enabled: true,
    slabs: [
      { upTo: 7500, amount: 0 },
      { upTo: 10000, amount: 175 },
      { upTo: Infinity, amount: 200 },
    ],
    // Maharashtra collects ₹300 in February instead of ₹200.
    februaryAmount: 300,
  },
}

export const PAY_COMPONENTS = ['basic', 'hra', 'conveyance', 'medical', 'special', 'other']

export function makeEmployee({
  id, entityId, name, code = '', email = '', departmentId = null,
  basic = 0, hra = 0, conveyance = 0, medical = 0, special = 0, other = 0,
  pan = '', uan = '', joinedOn = '', active = true,
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
      hra: Math.max(0, round2(hra)),
      conveyance: Math.max(0, round2(conveyance)),
      medical: Math.max(0, round2(medical)),
      special: Math.max(0, round2(special)),
      other: Math.max(0, round2(other)),
    },
    pan: pan.trim().toUpperCase().slice(0, 10),
    uan: uan.trim().slice(0, 12),
    joined_on: joinedOn,
    active: Boolean(active),
    created_at: new Date().toISOString(),
  }
}

export const grossOf = (employee) =>
  round2(PAY_COMPONENTS.reduce((t, k) => t + (Number(employee.pay?.[k]) || 0), 0))

// ── Statutory pieces ───────────────────────────────────────────────
export function providentFund(basic, config = DEFAULT_PAYROLL_CONFIG.pf) {
  if (!config.enabled) return { employee: 0, employer: 0, wage: 0 }
  const wage = config.applyCeiling ? Math.min(Number(basic) || 0, config.wageCeiling) : Number(basic) || 0
  return {
    wage: round2(wage),
    employee: rupee((wage * config.employeeRate) / 100),
    employer: rupee((wage * config.employerRate) / 100),
  }
}

export function stateInsurance(gross, config = DEFAULT_PAYROLL_CONFIG.esi) {
  if (!config.enabled || (Number(gross) || 0) > config.grossCeiling) {
    return { employee: 0, employer: 0, applicable: false }
  }
  return {
    applicable: true,
    // ESI rounds up to the next rupee, by rule.
    employee: Math.ceil((gross * config.employeeRate) / 100),
    employer: Math.ceil((gross * config.employerRate) / 100),
  }
}

export function professionalTax(gross, month, config = DEFAULT_PAYROLL_CONFIG.professionalTax) {
  if (!config.enabled) return 0
  const slab = config.slabs.find((s) => (Number(gross) || 0) <= s.upTo)
  const base = slab ? slab.amount : 0
  // February's higher amount only applies where tax is due at all.
  if (base > 0 && Number(month) === 2 && config.februaryAmount) return config.februaryAmount
  return base
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
  const pt = professionalTax(gross, month, config.professionalTax)

  const deductions = {
    pf: pf.employee,
    esi: esi.employee,
    professionalTax: pt,
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
  const slips = active.map((e) => payslipFor(e, { period, config, ...(perEmployee[e.id] || {}) }))
  return {
    period,
    slips,
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
    problems: slips.filter((s) => s.overDeducted).length,
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
