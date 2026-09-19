// The muster roll: who was on site, and what the day cost.
//
// This is not payroll and must not be built like it. Payroll is a named person
// on a monthly salary with PF, ESI and a payslip. Site labour is "fourteen
// masons and twenty-two helpers on Tuesday", hired through a mestri, paid
// weekly in cash, and different people on Wednesday. Asking for names and
// joining dates would be false precision — nobody would fill it in, and a
// register nobody fills in is worse than none, because the totals look real.
//
// So the unit here is the **headcount-day**: a trade, a date, a site, how many
// turned up, and the rate. That is what a site diary already records and what
// a contractor's bill is checked against.
//
// Overtime is kept separate rather than folded into the rate, because on a
// running site it is the number that quietly doubles: eight hours at ₹700 and
// four hours of overtime are not twelve hours at ₹700, and a register that
// blends them cannot tell you which site is burning its budget on evenings.

import { todayISO } from './today'

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)

// The trades an Indian site actually musters, with whether the work is skilled.
// The split matters because the two move at different rates and a site running
// heavy on unskilled labour is usually a site waiting for something.
export const TRADES = {
  mason: { id: 'mason', label: 'Mason', skilled: true },
  helper: { id: 'helper', label: 'Helper / unskilled', skilled: false },
  carpenter: { id: 'carpenter', label: 'Carpenter / shuttering', skilled: true },
  barBender: { id: 'barBender', label: 'Bar bender', skilled: true },
  painter: { id: 'painter', label: 'Painter', skilled: true },
  plumber: { id: 'plumber', label: 'Plumber', skilled: true },
  electrician: { id: 'electrician', label: 'Electrician', skilled: true },
  tiler: { id: 'tiler', label: 'Tile layer', skilled: true },
  welder: { id: 'welder', label: 'Welder / fabricator', skilled: true },
  operator: { id: 'operator', label: 'Machine operator', skilled: true },
  supervisor: { id: 'supervisor', label: 'Supervisor', skilled: true },
}
export const TRADE_IDS = Object.keys(TRADES)
export const tradeOf = (id) => TRADES[id] || { id: id || 'other', label: 'Other', skilled: false }

// A day's muster for one trade on one site.
export function makeMuster({
  id, entityId, projectId = null, date, trade = 'helper', headcount = 0, rate = 0,
  overtimeHours = 0, overtimeRate = 0, contractor = '', note = '', createdBy = null,
} = {}) {
  return {
    id: id || newId(),
    entity_id: entityId,
    project_id: projectId || null,
    date: date || todayISO(),
    trade: TRADES[trade] ? trade : 'helper',
    // Whole people. Half a mason is a data entry error, not a half day — a
    // half day is recorded as a lower rate, which is how it is paid.
    headcount: Math.max(0, Math.round(Number(headcount) || 0)),
    rate: Math.max(0, round2(rate)),
    overtime_hours: Math.max(0, round2(overtimeHours)),
    overtime_rate: Math.max(0, round2(overtimeRate)),
    // The mestri or labour contractor who supplied them. Not a subcontractor
    // with a work order — this is day labour, billed by the head.
    contractor: String(contractor).trim().slice(0, 120),
    note: String(note).trim().slice(0, 200),
    created_by: createdBy,
    created_at: new Date().toISOString(),
  }
}

// What one line of the muster cost, with the two halves kept apart.
export function musterCost(entry) {
  const base = round2((Number(entry?.headcount) || 0) * (Number(entry?.rate) || 0))
  const overtime = round2((Number(entry?.overtime_hours) || 0) * (Number(entry?.overtime_rate) || 0))
  return { base, overtime, total: round2(base + overtime) }
}

const within = (row, from, to) =>
  (!from || (row.date || '') >= from) && (!to || (row.date || '') <= to)

// The register, totalled the three ways anyone asks for it: what it cost, how
// many days of whose labour that bought, and where the overtime went.
export function labourReport(entries = [], { entityId = null, projectId = undefined, from = null, to = null } = {}) {
  const rows = entries
    .filter((e) => !e.deleted_at)
    .filter((e) => !entityId || e.entity_id === entityId)
    // `undefined` means every site; `null` means the ones booked to none, which
    // is a question worth being able to ask.
    .filter((e) => projectId === undefined || (projectId === null ? !e.project_id : e.project_id === projectId))
    .filter((e) => within(e, from, to))

  let base = 0
  let overtime = 0
  let headDays = 0
  let skilledDays = 0
  const byTrade = new Map()
  const bySite = new Map()
  const byDay = new Map()

  for (const e of rows) {
    const c = musterCost(e)
    base += c.base
    overtime += c.overtime
    headDays += e.headcount
    if (tradeOf(e.trade).skilled) skilledDays += e.headcount

    const t = byTrade.get(e.trade) || { trade: tradeOf(e.trade), headDays: 0, cost: 0, overtime: 0 }
    t.headDays += e.headcount
    t.cost = round2(t.cost + c.total)
    t.overtime = round2(t.overtime + c.overtime)
    byTrade.set(e.trade, t)

    const key = e.project_id || ''
    const s = bySite.get(key) || { projectId: e.project_id || null, headDays: 0, cost: 0, overtime: 0, entries: 0 }
    s.headDays += e.headcount
    s.cost = round2(s.cost + c.total)
    s.overtime = round2(s.overtime + c.overtime)
    s.entries += 1
    bySite.set(key, s)

    const d = byDay.get(e.date) || { date: e.date, headDays: 0, cost: 0 }
    d.headDays += e.headcount
    d.cost = round2(d.cost + c.total)
    byDay.set(e.date, d)
  }

  const total = round2(base + overtime)
  return {
    entries: rows.length,
    base: round2(base),
    overtime: round2(overtime),
    total,
    headDays,
    skilledDays,
    unskilledDays: headDays - skilledDays,
    // The average cost of a head-day. A site whose average is climbing is
    // either using more skilled trades or paying more for the same ones, and
    // either way somebody should know which.
    averageDayRate: headDays > 0 ? round2(total / headDays) : 0,
    // Overtime as a share of the wage bill. On a running site this is the
    // figure that quietly doubles while everyone watches the material rates.
    overtimePercent: total > 0 ? Math.round((overtime / total) * 1000) / 10 : 0,
    byTrade: [...byTrade.values()].sort((a, b) => b.cost - a.cost),
    bySite: [...bySite.values()].sort((a, b) => b.cost - a.cost),
    days: [...byDay.values()].sort((a, b) => (a.date || '').localeCompare(b.date || '')),
  }
}

// What each site's labour cost, as a map, for the project report to add in
// alongside its bills and its material.
export function labourCostsBySite(entries = [], opts = {}) {
  const out = {}
  for (const s of labourReport(entries, opts).bySite) {
    if (s.projectId) out[s.projectId] = s.cost
  }
  return out
}
