// Money paid before the bill arrives.
//
// An advance is not an expense — it is an asset until it is used up. A ₹50,000
// advance to a contractor who then invoices ₹30,000 leaves ₹20,000 still owed
// *to the company*. Booking the advance as a cost double-counts it when the
// invoice lands, which is the single most common way small books go wrong.
//
// So an advance is recorded once, then adjusted against bills as they come in,
// and what remains is a balance the company can see and chase.

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
