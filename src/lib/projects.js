// A site, and what it has cost against what it was meant to.
//
// Everything else in this app attributes a cost to an *asset* — a flat, a car,
// a holding of gold. A builder does not think that way. The thing money is
// spent on is a job: a site with a client, a contract value, a start and an
// end, which runs for eighteen months and then closes. The flat being built is
// not an asset the builder owns; it is what the job produces.
//
// So a project is its own thing, and the question it exists to answer is the
// only one that matters on site: is this job making money, and did anyone
// notice before it stopped.
//
// Two numbers are kept apart on purpose. The **contract value** is what the
// client agreed to pay. The **estimate** is what the work was costed at. They
// are not the same number and confusing them is how a job looks profitable
// right up until it isn't — margin is measured against the contract, overrun
// against the estimate, and a job can be over its estimate and still make money
// or under it and still lose.

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)

// Where a job is in its life. `onHold` is deliberately not `completed`: a
// stalled site still has money in it and still has to appear in the totals,
// which is exactly what makes it worth a status of its own.
export const PROJECT_STATUS = {
  planned: { id: 'planned', label: 'Planned', open: true },
  active: { id: 'active', label: 'On site', open: true },
  onHold: { id: 'onHold', label: 'On hold', open: true },
  completed: { id: 'completed', label: 'Completed', open: false },
}
export const PROJECT_STATUS_IDS = Object.keys(PROJECT_STATUS)
export const isOpen = (status) => PROJECT_STATUS[status]?.open ?? true

export function makeProject({
  id, entityId, name = '', code = '', client = '', siteAddress = '',
  contractValue = 0, estimate = 0, startedOn = '', dueOn = '',
  status = 'planned', departmentId = null, notes = '',
} = {}) {
  return {
    id: id || newId(),
    entity_id: entityId,
    name: (name || 'Untitled site').trim().slice(0, 120),
    // A short code is what goes on a delivery note and a labour sheet, so it is
    // upper-cased the way an SKU is — SITE-1 and site-1 are one job.
    code: String(code).trim().toUpperCase().slice(0, 24),
    client: String(client).trim().slice(0, 120),
    site_address: String(siteAddress).trim().slice(0, 240),
    contract_value: Math.max(0, round2(contractValue)),
    estimate: Math.max(0, round2(estimate)),
    started_on: startedOn || '',
    due_on: dueOn || '',
    status: PROJECT_STATUS[status] ? status : 'planned',
    department_id: departmentId,
    notes: String(notes).trim().slice(0, 500),
    created_at: new Date().toISOString(),
  }
}

const amountOf = (r) => {
  const n = Number(r?.amount)
  return Number.isFinite(n) && n >= 0 ? n : 0
}
const belongs = (row, projectId) => row?.project_id === projectId

// What one job has cost, billed and made.
//
// `spent` is every expense booked to the site, whether or not it has been paid:
// an unpaid bill is money committed, and a cost report that only counts what
// has left the bank tells you the job is cheaper than it is.
export function projectSummary(project, expenses = [], income = []) {
  const mine = expenses.filter((e) => belongs(e, project.id) && !e.deleted_at)
  const earned = income.filter((e) => belongs(e, project.id) && !e.deleted_at)

  const spent = round2(mine.reduce((t, e) => t + amountOf(e), 0))
  const paid = round2(mine.filter((e) => e.status === 'paid').reduce((t, e) => t + amountOf(e), 0))
  const billed = round2(earned.reduce((t, e) => t + amountOf(e), 0))
  const received = round2(earned.filter((e) => e.status === 'received').reduce((t, e) => t + amountOf(e), 0))

  const estimate = Number(project.estimate) || 0
  const contract = Number(project.contract_value) || 0

  return {
    project,
    spent,
    // Committed but not yet out of the bank. The number a site manager is
    // asked for and the one nobody can ever find.
    unpaid: round2(spent - paid),
    billed,
    // Work done and invoiced that the client has not paid for. On a running
    // account this is most of the money on the job.
    outstanding: round2(billed - received),
    received,
    entries: mine.length + earned.length,

    estimate,
    contract,
    // Against the estimate: is the work costing what it was costed at.
    overrun: estimate > 0 ? round2(spent - estimate) : 0,
    usedPercent: estimate > 0 ? Math.round((spent / estimate) * 100) : null,
    overEstimate: estimate > 0 && spent > estimate,
    // Against the contract: is the job making money. A different question, and
    // the answer can go the other way.
    margin: contract > 0 ? round2(contract - spent) : null,
    marginPercent: contract > 0 ? Math.round(((contract - spent) / contract) * 100) : null,
    losing: contract > 0 && spent > contract,
    // Nothing costed means nothing to compare against, which is worth saying
    // rather than showing 0% and letting it read as "on budget".
    uncosted: estimate === 0 && contract === 0,
  }
}

// Every job at once, worst first. A portfolio report is read to find the one
// that is going wrong, so the one going wrong is at the top.
export function projectReport(projects = [], expenses = [], income = [], { openOnly = false } = {}) {
  const lines = projects
    .filter((p) => !p.deleted_at)
    .filter((p) => !openOnly || isOpen(p.status))
    .map((p) => projectSummary(p, expenses, income))

  const sum = (pick) => round2(lines.reduce((t, l) => t + (pick(l) || 0), 0))
  const overrunning = lines.filter((l) => l.overEstimate)

  return {
    lines: lines.sort((a, b) => {
      // Over the estimate first, then by how far over. A job with no estimate
      // sorts below both, because there is nothing to say about it.
      if (a.overEstimate !== b.overEstimate) return a.overEstimate ? -1 : 1
      if (a.overEstimate) return b.overrun - a.overrun
      return b.spent - a.spent
    }),
    count: lines.length,
    spent: sum((l) => l.spent),
    billed: sum((l) => l.billed),
    outstanding: sum((l) => l.outstanding),
    unpaid: sum((l) => l.unpaid),
    contract: sum((l) => l.contract),
    estimate: sum((l) => l.estimate),
    overrunning: overrunning.length,
    // What it would take to bring every overrunning job back to its estimate.
    // Summing the negatives in as well would net a disaster against a saving
    // and report neither.
    overrunTotal: round2(overrunning.reduce((t, l) => t + l.overrun, 0)),
    uncosted: lines.filter((l) => l.uncosted).length,
  }
}

// Costs that were never booked to a site. On a builder's ledger this is the
// number that quietly grows: overheads are real, but a site's true cost is
// wrong by whatever sits in here, and nobody looks for a total nobody prints.
export function unattributed(expenses = [], income = []) {
  const loose = (rows) => rows.filter((r) => !r.deleted_at && !r.project_id)
  const spent = round2(loose(expenses).reduce((t, e) => t + amountOf(e), 0))
  const billed = round2(loose(income).reduce((t, e) => t + amountOf(e), 0))
  return { spent, billed, count: loose(expenses).length + loose(income).length }
}

// A job that has run past the day it was due and has not been closed. Said in
// days rather than as a flag, because "four days over" and "eight months over"
// are not the same conversation.
export function daysLate(project, today = new Date()) {
  if (!project?.due_on || !isOpen(project.status)) return null
  const due = new Date(`${String(project.due_on).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(due.getTime())) return null
  const now = new Date(`${today.toISOString().slice(0, 10)}T00:00:00Z`)
  const days = Math.floor((now - due) / 86400000)
  return days > 0 ? days : null
}
