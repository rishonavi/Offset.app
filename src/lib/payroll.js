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
export const RUN_STATUS = { draft: 'draft', approved: 'approved', paid: 'paid' }

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
export function payrollOverPeriods(employees, periods, { config = DEFAULT_PAYROLL_CONFIG } = {}) {
  const months = periods.map((period) => runPayroll(employees, { period, config }))
  const sum = (pick) => round2(months.reduce((t, r) => t + pick(r), 0))
  return {
    months,
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
