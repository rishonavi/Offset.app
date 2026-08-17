// What is owed, and to whom — in both directions.
//
// Offset already knows an expense can be unpaid and can have a due date. What a
// finance team needs on top of that is the ageing: not "₹4,00,000 outstanding"
// but "₹40,000 of it is 90 days late and it is all with one vendor". That is
// the report that gets acted on, so it is the one built here.
//
// The same machinery serves receivables — income recorded but not yet received —
// because "who owes us" is the same question pointed the other way.

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const DAY = 86400000
const toDate = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`) : null)

// The standard ageing ladder. "Current" means not yet due, which is different
// from "0 days late" — a bill due tomorrow is not a problem.
export const AGE_BUCKETS = [
  { id: 'current', label: 'Not yet due', from: -Infinity, to: 0 },
  { id: 'd1_30', label: '1–30 days', from: 1, to: 30 },
  { id: 'd31_60', label: '31–60 days', from: 31, to: 60 },
  { id: 'd61_90', label: '61–90 days', from: 61, to: 90 },
  { id: 'd90plus', label: 'Over 90 days', from: 91, to: Infinity },
]

export function daysOverdue(dueISO, asOfISO) {
  const due = toDate(dueISO)
  if (!due) return null
  const asOf = toDate(asOfISO) || new Date()
  return Math.floor((asOf - due) / DAY)
}

export function bucketFor(days) {
  if (days == null) return 'nodate'
  for (const b of AGE_BUCKETS) if (days >= b.from && days <= b.to) return b.id
  return 'current'
}

const isOutstanding = (row, settledStatus) =>
  !row.deleted_at && (row.status || '') !== settledStatus

// One side of the ledger. `kind` decides the wording and which status counts as
// settled: an expense is settled when paid, income when received.
export function ageing(rows, { kind = 'payable', asOf, entityId = null } = {}) {
  const settled = kind === 'payable' ? 'paid' : 'received'
  const partyKey = kind === 'payable' ? 'vendor' : 'payer'

  const open = rows
    .filter((r) => isOutstanding(r, settled))
    .filter((r) => !entityId || r.entity_id === entityId)
    .map((r) => {
      const days = daysOverdue(r.due_date, asOf)
      return {
        ...r,
        party: (r[partyKey] || '').trim() || 'Unnamed',
        days,
        bucket: bucketFor(days),
        overdue: days != null && days > 0,
      }
    })

  const buckets = {}
  for (const b of AGE_BUCKETS) buckets[b.id] = { ...b, total: 0, count: 0 }
  // Bills with no due date can't be aged, but they are still owed — they get
  // their own line rather than being dropped or counted as current.
  buckets.nodate = { id: 'nodate', label: 'No due date', total: 0, count: 0 }

  for (const r of open) {
    const b = buckets[r.bucket]
    b.total = round2(b.total + (Number(r.amount) || 0))
    b.count += 1
  }

  const total = round2(open.reduce((t, r) => t + (Number(r.amount) || 0), 0))
  const overdue = open.filter((r) => r.overdue)

  return {
    kind,
    rows: open.sort((a, b) => (b.days ?? -1e9) - (a.days ?? -1e9)),
    buckets: [...AGE_BUCKETS.map((b) => buckets[b.id]), buckets.nodate].filter((b) => b.count > 0),
    total,
    overdueTotal: round2(overdue.reduce((t, r) => t + (Number(r.amount) || 0), 0)),
    overdueCount: overdue.length,
    count: open.length,
  }
}

// Who to chase, worst first. A finance team works this list top-down, so it is
// ordered by how late the money is rather than by how much of it there is.
export function byParty(rows, opts = {}) {
  const { rows: open } = ageing(rows, opts)
  const map = new Map()
  for (const r of open) {
    const cur = map.get(r.party) || { party: r.party, total: 0, count: 0, oldest: null, overdue: 0 }
    cur.total = round2(cur.total + (Number(r.amount) || 0))
    cur.count += 1
    if (r.days != null && (cur.oldest == null || r.days > cur.oldest)) cur.oldest = r.days
    if (r.overdue) cur.overdue = round2(cur.overdue + (Number(r.amount) || 0))
    map.set(r.party, cur)
  }
  return [...map.values()].sort((a, b) => (b.oldest ?? -1e9) - (a.oldest ?? -1e9) || b.total - a.total)
}

// Both sides at once, plus the number a director actually asks for: if
// everything owed came in and everything due went out, where would we be.
export function workingCapital({ expenses, income, asOf, entityId = null }) {
  const payable = ageing(expenses, { kind: 'payable', asOf, entityId })
  const receivable = ageing(income, { kind: 'receivable', asOf, entityId })
  return {
    payable,
    receivable,
    net: round2(receivable.total - payable.total),
    // Money that is late in both directions is the part under someone's control.
    netOverdue: round2(receivable.overdueTotal - payable.overdueTotal),
  }
}

// A short, plain sentence for a dashboard card.
export function describeAgeing(report) {
  if (!report.count) return report.kind === 'payable' ? 'Nothing outstanding.' : 'Nothing awaited.'
  if (!report.overdueCount) {
    return `${report.count} ${report.count === 1 ? 'item' : 'items'} outstanding, none overdue yet.`
  }
  return `${report.overdueCount} of ${report.count} overdue.`
}
