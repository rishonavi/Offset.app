// Work orders and running account bills.
//
// A subcontractor does not send an invoice for what he did this month. He
// sends a bill for everything he has done **to date**, and the amount payable
// is that figure less what he has already been paid. Every RA bill in India is
// written this way, and a system that records each bill as an independent
// amount will pay the whole job twice by the fourth one — the arithmetic still
// adds up, which is what makes it dangerous.
//
// So bills here are cumulative by construction. `certified_to_date` is the
// only quantity entered, and what is payable now is derived.
//
// Three more distinctions the paperwork depends on:
//
//   **Claimed is not certified.** The contractor claims a figure; the engineer
//   measures the work and certifies one. Paying the claim is the mistake this
//   trade is built on, so both are recorded and a certification above the
//   claim is flagged rather than quietly accepted.
//
//   **Retention is held, not saved.** Five per cent withheld against defects is
//   money the company still owes — a liability with a release date, not a
//   discount. It reduces what is paid now and nothing else.
//
//   **Certified value is the cost; net paid is the cash.** The job cost what
//   was certified. Retention and TDS change when the money leaves, not whether
//   it was spent, and a job costed on net payments is understated by both.

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)

const today = () => new Date().toISOString().slice(0, 10)

export const ORDER_STATUS = {
  draft: { id: 'draft', label: 'Draft', open: true },
  running: { id: 'running', label: 'Running', open: true },
  held: { id: 'held', label: 'On hold', open: true },
  closed: { id: 'closed', label: 'Closed', open: false },
}
export const ORDER_STATUS_IDS = Object.keys(ORDER_STATUS)
export const isOrderOpen = (status) => ORDER_STATUS[status]?.open ?? true

// How the work was priced. It changes nothing in the arithmetic and everything
// in what a certification means: a lump sum is certified as a percentage, a
// rate contract against measured quantity.
export const PRICING = {
  lumpSum: { id: 'lumpSum', label: 'Lump sum' },
  rate: { id: 'rate', label: 'Per unit / rate' },
  dayWork: { id: 'dayWork', label: 'Day work' },
}
export const PRICING_IDS = Object.keys(PRICING)

export function makeWorkOrder({
  id, entityId, projectId = null, contractor = '', scope = '', orderValue = 0,
  pricing = 'lumpSum', retentionPercent = 5, tdsPercent = 1,
  startedOn = '', dueOn = '', status = 'running', ref = '', notes = '',
  retentionReleased = 0, createdBy = null,
} = {}) {
  return {
    id: id || newId(),
    entity_id: entityId,
    project_id: projectId || null,
    contractor: String(contractor).trim().slice(0, 120) || 'Unnamed contractor',
    scope: String(scope).trim().slice(0, 240),
    order_value: Math.max(0, round2(orderValue)),
    pricing: PRICING[pricing] ? pricing : 'lumpSum',
    // Capped at 100: a retention above the whole bill is a typo, and letting it
    // through produces a negative payment nobody can explain.
    retention_percent: Math.min(100, Math.max(0, round2(retentionPercent))),
    tds_percent: Math.min(100, Math.max(0, round2(tdsPercent))),
    started_on: startedOn || '',
    due_on: dueOn || '',
    status: ORDER_STATUS[status] ? status : 'running',
    ref: String(ref).trim().slice(0, 60),
    notes: String(notes).trim().slice(0, 500),
    // Retention given back, usually half at completion and half after the
    // defect liability period. Held separately so the balance still owed is a
    // figure rather than a memory.
    retention_released: Math.max(0, round2(retentionReleased)),
    created_by: createdBy,
    created_at: new Date().toISOString(),
  }
}

export function makeRaBill({
  id, workOrderId, entityId, projectId = null, number = 1, date,
  claimedToDate = 0, certifiedToDate = 0,
  advanceRecovered = 0, materialRecovered = 0, penalty = 0, otherDeduction = 0,
  status = 'certified', note = '', createdBy = null,
} = {}) {
  return {
    id: id || newId(),
    work_order_id: workOrderId,
    entity_id: entityId,
    project_id: projectId || null,
    // Bills are numbered, and the number is what orders them. Two bills dated
    // the same day is ordinary; two bills numbered the same is a mistake.
    number: Math.max(1, Math.round(Number(number) || 1)),
    date: date || today(),
    claimed_to_date: Math.max(0, round2(claimedToDate)),
    certified_to_date: Math.max(0, round2(certifiedToDate)),
    // Recovered from this bill. An advance paid earlier and material issued
    // from the company's stores are both the contractor's debt, not the
    // company's cost twice over.
    advance_recovered: Math.max(0, round2(advanceRecovered)),
    material_recovered: Math.max(0, round2(materialRecovered)),
    penalty: Math.max(0, round2(penalty)),
    other_deduction: Math.max(0, round2(otherDeduction)),
    status: ['draft', 'certified', 'paid'].includes(status) ? status : 'certified',
    note: String(note).trim().slice(0, 200),
    created_by: createdBy,
    created_at: new Date().toISOString(),
  }
}

const deductionsOf = (b) =>
  round2((Number(b.advance_recovered) || 0) + (Number(b.material_recovered) || 0)
    + (Number(b.penalty) || 0) + (Number(b.other_deduction) || 0))

// Walks one order's bills in number order and works out what each was actually
// worth. The whole module exists for the first line of this loop.
export function billLadder(order, bills = []) {
  const rows = bills
    .filter((b) => b.work_order_id === order?.id && !b.deleted_at)
    .slice()
    .sort((a, b) => a.number - b.number || (a.date || '').localeCompare(b.date || ''))

  const retentionPct = Number(order?.retention_percent) || 0
  const tdsPct = Number(order?.tds_percent) || 0
  const orderValue = Number(order?.order_value) || 0

  let previous = 0
  let retentionAccrued = 0
  let tdsTotal = 0
  let recoveredTotal = 0
  let netTotal = 0

  const lines = rows.map((bill) => {
    // The one line this module is for: what is payable now is the work
    // certified to date less everything certified before it.
    const gross = round2((Number(bill.certified_to_date) || 0) - previous)
    const retention = round2(gross * (retentionPct / 100))
    const tds = round2(gross * (tdsPct / 100))
    const recovered = deductionsOf(bill)
    const net = round2(gross - retention - tds - recovered)

    previous = Number(bill.certified_to_date) || 0
    retentionAccrued = round2(retentionAccrued + retention)
    tdsTotal = round2(tdsTotal + tds)
    recoveredTotal = round2(recoveredTotal + recovered)
    netTotal = round2(netTotal + net)

    return {
      bill,
      gross,
      retention,
      tds,
      recovered,
      net,
      certifiedToDate: previous,
      // A certification above what was even claimed. Almost always a typo, and
      // the one kind of typo that pays a contractor for work nobody claims to
      // have done.
      overClaimed: (Number(bill.certified_to_date) || 0) > (Number(bill.claimed_to_date) || 0) + 0.001,
      // A bill that certifies less than the one before it. Legitimate as a
      // correction, and worth seeing, because the net payable goes negative.
      negative: gross < -0.001,
      // Past the order value. Extra work happens; unapproved extra work is how
      // a fixed-price subcontract stops being fixed.
      overOrder: orderValue > 0 && previous > orderValue + 0.001,
    }
  })

  const certified = previous
  const released = Number(order?.retention_released) || 0

  return {
    lines,
    count: lines.length,
    claimedToDate: rows.length ? round2(Number(rows[rows.length - 1].claimed_to_date) || 0) : 0,
    certifiedToDate: round2(certified),
    // What the job cost. Retention and TDS change when money leaves, not
    // whether it was spent.
    cost: round2(certified),
    grossCertified: round2(certified),
    retentionAccrued,
    retentionReleased: released,
    // Still owed to the contractor and sitting in the company's bank. A
    // liability, not a saving.
    retentionHeld: round2(Math.max(0, retentionAccrued - released)),
    tds: tdsTotal,
    recovered: recoveredTotal,
    netPayable: netTotal,
    orderValue,
    balance: orderValue > 0 ? round2(orderValue - certified) : null,
    percentComplete: orderValue > 0 ? Math.round((certified / orderValue) * 1000) / 10 : null,
    overOrder: orderValue > 0 && certified > orderValue + 0.001,
    // The gap between what was asked for and what was measured. On a healthy
    // job it is small and positive; a large one means the claims and the site
    // do not agree.
    unCertified: rows.length ? round2(Math.max(0, (Number(rows[rows.length - 1].claimed_to_date) || 0) - certified)) : 0,
    problems: lines.filter((l) => l.overClaimed || l.negative || l.overOrder).length,
  }
}

// Every order at once, the ones in trouble first.
export function subcontractReport(orders = [], bills = [], { entityId = null, projectId = undefined, openOnly = false } = {}) {
  const lines = orders
    .filter((o) => !o.deleted_at)
    .filter((o) => !entityId || o.entity_id === entityId)
    .filter((o) => projectId === undefined || (projectId === null ? !o.project_id : o.project_id === projectId))
    .filter((o) => !openOnly || isOrderOpen(o.status))
    .map((o) => ({ order: o, ...billLadder(o, bills) }))

  const sum = (pick) => round2(lines.reduce((t, l) => t + (pick(l) || 0), 0))
  return {
    lines: lines.sort((a, b) =>
      Number(b.overOrder) - Number(a.overOrder) ||
      b.problems - a.problems ||
      b.certifiedToDate - a.certifiedToDate),
    count: lines.length,
    orderValue: sum((l) => l.orderValue),
    certified: sum((l) => l.certifiedToDate),
    netPayable: sum((l) => l.netPayable),
    retentionHeld: sum((l) => l.retentionHeld),
    tds: sum((l) => l.tds),
    recovered: sum((l) => l.recovered),
    unCertified: sum((l) => l.unCertified),
    overOrder: lines.filter((l) => l.overOrder).length,
    problems: lines.reduce((t, l) => t + l.problems, 0),
  }
}

// What each site owes its subcontractors, for the project report to add
// alongside its bills, its material and its labour. Certified value, because
// that is what the work cost.
export function subcontractCostsBySite(orders = [], bills = [], opts = {}) {
  const out = {}
  for (const l of subcontractReport(orders, bills, opts).lines) {
    if (!l.order.project_id) continue
    out[l.order.project_id] = round2((out[l.order.project_id] || 0) + l.certifiedToDate)
  }
  return out
}
