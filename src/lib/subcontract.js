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
//   And a release date is a date. Retention comes back in two pieces by
//   convention — half when the work is finished, half when the defect liability
//   period runs out a year later — so a single cumulative figure of what has
//   been given back cannot say what is due now and what is not due until next
//   March. `retentionSchedule` says it. What was released fills the earlier
//   tranche first, because that is the only honest reading of one running
//   total.
//
//   **A builder is on both sides of this.** He holds retention from the
//   subcontractors he engages, and his client holds retention from him. Same
//   ladder, same arithmetic, opposite sign — so an order carries a `side`, and
//   the one thing that must never blur is cost: work certified to a client is
//   revenue, and a client order that leaked into `subcontractCostsBySite`
//   would book the company's own income as money it spent.
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

// Which way the money goes. A construction company is a subcontractor's client
// and its own client's contractor, and the paperwork is identical either way —
// a cumulative bill, a percentage held back, tax deducted at source. What is
// not identical is what the certified figure means, so it is recorded once
// here rather than guessed at by every reader.
export const SIDE = {
  sub: { id: 'sub', label: 'We engaged them', noun: 'Subcontract', party: 'Contractor', cost: true },
  client: { id: 'client', label: 'They engaged us', noun: 'Client contract', party: 'Client', cost: false },
}
export const SIDE_IDS = Object.keys(SIDE)
// Orders written before there were two sides are subcontracts, because that is
// the only thing they could have been.
export const sideOf = (order) => (SIDE[order?.side] ? order.side : 'sub')

// Retention comes back in two pieces, and the second one is a year away.
export const TRANCHES = {
  completion: { id: 'completion', label: 'On completion' },
  defects: { id: 'defects', label: 'After defect liability' },
}

// Month arithmetic that does not invent the 31st of April. A defect liability
// period is counted in months from the completion date, and the day of the
// month is kept unless the target month is too short to have one.
export function addMonths(iso, months) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  if (!m) return ''
  const total = (Number(m[1]) * 12) + (Number(m[2]) - 1) + Math.round(Number(months) || 0)
  const y = Math.floor(total / 12)
  const mo = (total % 12) + 1
  if (y < 1 || y > 9999) return ''
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  const d = Math.min(Number(m[3]), last)
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const daysBetween = (from, to) => {
  const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${to}T00:00:00Z`)
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : 0
}

export function makeWorkOrder({
  id, entityId, projectId = null, contractor = '', scope = '', orderValue = 0,
  pricing = 'lumpSum', retentionPercent = 5, tdsPercent = 1,
  startedOn = '', dueOn = '', status = 'running', ref = '', notes = '',
  retentionReleased = 0, createdBy = null,
  side = 'sub', completedOn = '', dlpMonths = 12, releaseSplitPercent = 50,
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
    // Who is paying whom. Defaulted rather than required, because every order
    // that existed before this field is a subcontract.
    side: SIDE[side] ? side : 'sub',
    // When the work was finished, which is not when the order was closed and
    // not when the last bill was raised. Retention has no release date until
    // somebody writes this down, and a schedule that guessed one would be
    // telling a contractor his money is due on a day nobody agreed to.
    completed_on: completedOn || '',
    // The defect liability period, in months from completion. Twelve is the
    // ordinary term; a short fit-out might be six and a structure might be
    // twenty-four.
    dlp_months: Math.max(0, Math.min(120, Math.round(Number(dlpMonths) || 0))),
    // How much of the retention comes back at completion rather than at the
    // end of the defect liability period. Half and half is the convention.
    release_split_percent: Math.min(100, Math.max(0, round2(releaseSplitPercent))),
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
    // A refused certification did not certify anything, so it is not in the
    // ladder at all. A pending one is: the work was done and the company owes
    // for it whether or not finance has cleared the payment, and leaving it out
    // would report the job as costing less than it did.
    .filter((b) => b.work_order_id === order?.id && !b.deleted_at && b.approval_status !== 'rejected')
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

// When the retention comes back, and how much of it is already overdue.
//
// One order's held-back money, split into the two tranches the trade uses and
// dated. The subtlety is that `retention_released` is a single running total
// with no tranche attached to it, so the allocation has to be decided rather
// than read: money given back fills the completion tranche first and the
// defects tranche with whatever is left. Any other rule would let a company
// that released the first half look as though it still owed it.
export function retentionSchedule(order, ladder, { asOf = null } = {}) {
  const now = asOf || today()
  const accrued = round2(Number(ladder?.retentionAccrued) || 0)
  const releasedRaw = round2(Number(ladder?.retentionReleased) || 0)
  // More given back than was ever held. Not a tranche problem — an arithmetic
  // one — so it is reported rather than absorbed by capping in silence.
  const overReleased = round2(Math.max(0, releasedRaw - accrued))
  const released = Math.min(releasedRaw, accrued)

  const splitPct = Math.min(100, Math.max(0, Number(order?.release_split_percent) ?? 50))
  const first = round2(accrued * (splitPct / 100))
  // The remainder rather than the complementary percentage, so the two
  // tranches add to the accrual exactly however the rounding falls.
  const second = round2(accrued - first)

  const completedOn = String(order?.completed_on || '')
  const dlpMonths = Math.max(0, Math.round(Number(order?.dlp_months) ?? 12))
  const defectsOn = completedOn ? addMonths(completedOn, dlpMonths) : ''

  let left = released
  const tranche = (id, amount, dueOn) => {
    const paid = round2(Math.min(left, amount))
    left = round2(left - paid)
    const outstanding = round2(amount - paid)
    const state = amount <= 0 ? 'none'
      : outstanding <= 0.001 ? 'released'
      // Undated is its own answer, not a synonym for "not yet". A contractor
      // whose completion date nobody recorded has retention with no release
      // date at all, and saying "waiting" would imply a day is coming.
      : !dueOn ? 'undated'
      : dueOn <= now ? 'due'
      : 'waiting'
    return {
      id,
      label: TRANCHES[id].label,
      amount,
      released: paid,
      outstanding,
      dueOn,
      state,
      due: state === 'due',
      overdueDays: state === 'due' ? Math.max(0, daysBetween(dueOn, now)) : 0,
    }
  }

  const tranches = [
    tranche('completion', first, completedOn),
    tranche('defects', second, defectsOn),
  ]
  const sum = (pick) => round2(tranches.reduce((t, x) => t + pick(x), 0))
  return {
    order,
    accrued,
    released,
    overReleased,
    held: round2(accrued - released),
    tranches,
    due: sum((t) => (t.state === 'due' ? t.outstanding : 0)),
    waiting: sum((t) => (t.state === 'waiting' ? t.outstanding : 0)),
    // Money that is owed and cannot be scheduled, which is the state worth
    // acting on: it needs a completion date entered, not a payment.
    undated: sum((t) => (t.state === 'undated' ? t.outstanding : 0)),
    completedOn,
    defectsOn,
    overdueDays: Math.max(...tranches.map((t) => t.overdueDays), 0),
  }
}

// Every order's retention at once. `side` decides whose money it is: held from
// the subcontractors the company engaged, or held from the company by the
// client who engaged it.
export function retentionBook(orders = [], bills = [], { entityId = null, side = 'sub', asOf = null } = {}) {
  const lines = orders
    .filter((o) => !o.deleted_at && o.approval_status !== 'rejected')
    .filter((o) => !entityId || o.entity_id === entityId)
    .filter((o) => sideOf(o) === side)
    .map((o) => retentionSchedule(o, billLadder(o, bills), { asOf }))
    .filter((r) => r.accrued > 0 || r.overReleased > 0)

  const sum = (pick) => round2(lines.reduce((t, l) => t + (pick(l) || 0), 0))
  return {
    side,
    lines: lines.sort((a, b) => b.overdueDays - a.overdueDays || b.due - a.due || b.held - a.held),
    count: lines.length,
    accrued: sum((l) => l.accrued),
    released: sum((l) => l.released),
    held: sum((l) => l.held),
    due: sum((l) => l.due),
    waiting: sum((l) => l.waiting),
    undated: sum((l) => l.undated),
    overReleased: sum((l) => l.overReleased),
    dueCount: lines.filter((l) => l.due > 0).length,
    undatedCount: lines.filter((l) => l.undated > 0).length,
  }
}

// Every order at once, the ones in trouble first.
//
// `side` defaults to the subcontracts because that is what every caller written
// before there were two sides meant, and because the alternative — a default
// that includes both — would have added the company's own revenue to its cost
// on the day the field was introduced.
export function subcontractReport(orders = [], bills = [], { entityId = null, projectId = undefined, openOnly = false, side = 'sub' } = {}) {
  const lines = orders
    .filter((o) => !o.deleted_at && o.approval_status !== 'rejected')
    .filter((o) => !entityId || o.entity_id === entityId)
    .filter((o) => side === null || sideOf(o) === side)
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
  // `side` is forced rather than defaulted. A caller that passed the client
  // side through here would be asking what the company's own billing cost it,
  // and the only correct answer to that question is not to answer it.
  for (const l of subcontractReport(orders, bills, { ...opts, side: 'sub' }).lines) {
    if (!l.order.project_id) continue
    out[l.order.project_id] = round2((out[l.order.project_id] || 0) + l.certifiedToDate)
  }
  return out
}

// The same ladder read from the other end: what the company has certified to
// its client, what the client is holding back, and what is still to come. The
// figures are the ones `subcontractReport` already produces — `cost` is
// revenue here, `netPayable` is net receivable — which is why this is an
// argument rather than a second implementation that would drift.
export function clientContracts(orders = [], bills = [], opts = {}) {
  const report = subcontractReport(orders, bills, { ...opts, side: 'client' })
  return {
    ...report,
    // Named for what they are on this side, so a reader of the returned object
    // is not left translating. The originals stay for the shared table.
    revenue: report.certified,
    netReceivable: report.netPayable,
    retentionWithheld: report.retentionHeld,
    tdsDeducted: report.tds,
  }
}
