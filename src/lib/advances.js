// Money paid before the bill arrives.
//
// An advance is not an expense — it is an asset until it is used up. A ₹50,000
// advance to a contractor who then invoices ₹30,000 leaves ₹20,000 still owed
// *to the company*. Booking the advance as a cost double-counts it when the
// invoice lands, which is the single most common way small books go wrong.
//
// So an advance is recorded once, then adjusted against bills as they come in,
// and what remains is a balance the company can see and chase.

import { ageing } from './payables.js'

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)

// Who the money went to. An employee advance behaves the same as a vendor one
// but is recovered from payroll rather than from an invoice.
export const ADVANCE_PARTIES = {
  vendor: { id: 'vendor', label: 'Vendor / supplier', recoveredBy: 'a bill' },
  employee: { id: 'employee', label: 'Employee', recoveredBy: 'payroll' },
  contractor: { id: 'contractor', label: 'Contractor', recoveredBy: 'a bill' },
  other: { id: 'other', label: 'Other', recoveredBy: 'an adjustment' },
}

export function makeAdvance({
  id, entityId, partyType = 'vendor', party = '', amount = 0, date,
  purpose = '', departmentId = null, expectedBy = '', createdBy = null,
} = {}) {
  return {
    id: id || newId(),
    entity_id: entityId,
    party_type: ADVANCE_PARTIES[partyType] ? partyType : 'vendor',
    party: party.trim().slice(0, 120),
    amount: Math.max(0, round2(amount)),
    date: date || new Date().toISOString().slice(0, 10),
    purpose: purpose.trim().slice(0, 200),
    department_id: departmentId,
    // When the company expects this to be settled — what makes an advance
    // chaseable rather than forgotten.
    expected_by: expectedBy || '',
    created_by: createdBy,
    created_at: new Date().toISOString(),
  }
}

export function makeAdjustment({ id, advanceId, amount = 0, against = null, date, note = '' } = {}) {
  return {
    id: id || newId(),
    advance_id: advanceId,
    amount: Math.max(0, round2(amount)),
    // The expense (or payroll run) this advance was set against.
    against,
    date: date || new Date().toISOString().slice(0, 10),
    note: note.trim().slice(0, 200),
    created_at: new Date().toISOString(),
  }
}

export function balanceOf(advance, adjustments) {
  const used = adjustments
    .filter((a) => a.advance_id === advance.id)
    .reduce((t, a) => t + (Number(a.amount) || 0), 0)
  const outstanding = round2(advance.amount - used)
  return {
    advance,
    used: round2(used),
    outstanding: Math.max(0, outstanding),
    // Over-adjustment means someone set more against the advance than was ever
    // paid — a real bookkeeping error, worth surfacing rather than clamping away.
    overAdjusted: outstanding < -0.001,
    settled: Math.abs(outstanding) < 0.01,
  }
}

// An adjustment cannot take more out of an advance than is left in it.
export function canAdjust(advance, adjustments, amount) {
  const amt = round2(amount)
  if (!(amt > 0)) return { ok: false, why: 'Enter an amount to set against this advance.' }
  const { outstanding } = balanceOf(advance, adjustments)
  if (amt > outstanding + 0.001) {
    return { ok: false, why: `Only ${outstanding.toFixed(2)} is left on this advance.` }
  }
  return { ok: true, why: '' }
}

export function outstandingAdvances(advances, adjustments, { entityId = null, asOf = null } = {}) {
  const lines = advances
    .filter((a) => !a.deleted_at)
    .filter((a) => !entityId || a.entity_id === entityId)
    .map((a) => {
      const b = balanceOf(a, adjustments)
      const overdue = Boolean(a.expected_by) && (asOf || new Date().toISOString().slice(0, 10)) > a.expected_by
      return { ...b, overdue: overdue && !b.settled }
    })
    .filter((l) => !l.settled || l.overAdjusted)

  return {
    lines: lines.sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.outstanding - a.outstanding),
    total: round2(lines.reduce((t, l) => t + l.outstanding, 0)),
    overdueTotal: round2(lines.filter((l) => l.overdue).reduce((t, l) => t + l.outstanding, 0)),
    count: lines.length,
    errors: lines.filter((l) => l.overAdjusted).length,
  }
}

// Grouped by who is holding the company's money.
export function advancesByParty(advances, adjustments, opts = {}) {
  const { lines } = outstandingAdvances(advances, adjustments, opts)
  const map = new Map()
  for (const l of lines) {
    const key = `${l.advance.party_type}:${l.advance.party || 'Unnamed'}`
    const cur = map.get(key) || {
      party: l.advance.party || 'Unnamed',
      partyType: l.advance.party_type,
      outstanding: 0,
      count: 0,
      overdue: false,
    }
    cur.outstanding = round2(cur.outstanding + l.outstanding)
    cur.count += 1
    cur.overdue = cur.overdue || l.overdue
    map.set(key, cur)
  }
  return [...map.values()].sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.outstanding - a.outstanding)
}

// Advances as a period statement, which is what a report asks for and the
// Operations page does not: what was still out when the period opened, what
// went out during it, what came back, and what is still out at the close.
//
// Everything here is dated — an advance carries the day it was paid and an
// adjustment the day it was set against a bill — so unlike payroll this is a
// record rather than a projection. The four figures tie together by
// construction: opening + paid out − recovered = closing.
//
// The ageing ladder is the one from payables rather than a second one written
// here. An advance with money still on it is the same question as an unpaid
// bill turned around — how long has this been outstanding — so the buckets,
// the day counting and the no-due-date line are all already tested.
export function advancesOverPeriod(advances, adjustments, { entityId = null, from = null, to = null } = {}) {
  const mine = advances.filter((a) => !a.deleted_at && (!entityId || a.entity_id === entityId))
  const ids = new Set(mine.map((a) => a.id))
  const theirs = adjustments.filter((x) => ids.has(x.advance_id))

  const on = (rows, d) => (d ? rows.filter((r) => (r.date || '') <= d) : rows)
  const before = (rows, d) => (d ? rows.filter((r) => (r.date || '') < d) : [])
  const within = (rows) =>
    rows.filter((r) => (!from || (r.date || '') >= from) && (!to || (r.date || '') <= to))

  const closing = on(mine, to).map((a) => balanceOf(a, on(theirs, to)))
  const opening = before(mine, from).map((a) => balanceOf(a, before(theirs, from)))
  const sum = (lines) => round2(lines.reduce((t, l) => t + l.outstanding, 0))

  // Still owed at the close. An over-adjusted advance is kept because it is a
  // bookkeeping error someone has to see, not a balance of zero.
  const open = closing.filter((l) => !l.settled || l.overAdjusted)

  // Reshaped into what the ageing ladder reads: the amount is what is left,
  // not what was paid, and the due date is when it was expected back.
  const aged = ageing(
    open.map((l) => ({
      id: l.advance.id,
      entity_id: l.advance.entity_id,
      amount: l.outstanding,
      due_date: l.advance.expected_by || '',
      vendor: l.advance.party || 'Unnamed',
      status: 'unpaid',
    })),
    { kind: 'payable', asOf: to || undefined },
  )

  return {
    lines: open,
    openingOutstanding: sum(opening),
    paidOut: round2(within(mine).reduce((t, a) => t + (Number(a.amount) || 0), 0)),
    recovered: round2(within(theirs).reduce((t, x) => t + (Number(x.amount) || 0), 0)),
    closingOutstanding: sum(closing),
    overdue: aged.overdueTotal,
    overdueCount: aged.overdueCount,
    count: open.length,
    buckets: aged.buckets,
    // Advances adjusted for more than was ever paid into them. Worth its own
    // number: it is the only figure here that means someone made a mistake.
    errors: closing.filter((l) => l.overAdjusted).length,
  }
}
