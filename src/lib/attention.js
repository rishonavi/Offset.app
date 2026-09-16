// What is going wrong, in one place, ranked.
//
// Every module in this app works out something nobody will go looking for. The
// stock report knows a site has issued material it never received. The plant
// report knows sixty thousand rupees of hire was billed with no log sheet
// against it. The sales ledger knows an instalment will never fall due because
// it names no stage of work and carries no date. All of it is correct, all of
// it is three clicks deep in a sub-tab, and none of it is why anybody opens
// the app.
//
// So this asks every module the same question and puts the answers in one list,
// worst first. It computes nothing new: every number here already existed and
// was already right. What was missing was somebody to read it.
//
// Four levels, in the order they are worth acting on:
//
//   `error`   a number is wrong. The books and the world disagree — negative
//             stock, a bill certified above what was claimed, an advance
//             adjusted for more than was ever paid into it. These come first
//             whatever they are worth, because every total downstream of a
//             wrong number is also suspect.
//   `money`   money sitting somewhere nobody is chasing. Correct, and gone.
//   `risk`    not wrong yet. A job spending faster than it is building.
//   `chance`  a saving that is there for the taking.

import { stockReport, usageBySite } from './inventory'
import { priceList, quoteBook } from './quotes'
import { projectReport, unattributed, daysLate } from './projects'
import { siteProgress, progressAgainstSpend } from './progress'
import { labourReport, labourCostsBySite } from './labour'
import { subcontractReport, subcontractCostsBySite } from './subcontract'
import { plantReport, plantCostsBySite } from './plant'
import { salesReport } from './sales'
import { outstandingAdvances } from './advances'
import { approvalQueue } from './corporate'
import { costCentreReport } from './costcentres'

export const LEVELS = {
  error: { id: 'error', label: 'Wrong', rank: 0, tone: 'bad' },
  money: { id: 'money', label: 'Owed', rank: 1, tone: 'warn' },
  risk: { id: 'risk', label: 'Watch', rank: 2, tone: 'warn' },
  chance: { id: 'chance', label: 'Worth doing', rank: 3, tone: 'good' },
}
export const LEVEL_IDS = Object.keys(LEVELS)

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// A finding has to say what to do about it, or it is just a number in a
// different place. `where` is a link and `detail` is the sentence that makes
// somebody act rather than nod.
const finding = (id, level, title, detail, { amount = 0, count = 1, where = null } = {}) =>
  ({ id, level, title, detail, amount: round2(amount), count, where })

const OPS = (tab) => ({ to: `/operations?tab=${tab}`, label: 'Open' })

const thisMonth = (asOf) => (asOf ? new Date(asOf) : new Date()).toISOString().slice(0, 7)

// The months that have closed and could have been run: the three before this
// one, from no earlier than the oldest joining date on the payroll. Three,
// because a company six months behind does not need six separate naggings —
// it needs to know it is behind.
function closedMonths(asOf, employees) {
  const now = thisMonth(asOf)
  const earliest = employees
    .map((e) => String(e.joined_on || '').slice(0, 7))
    .filter(Boolean)
    .sort()[0] || ''
  const out = []
  let [y, m] = now.split('-').map(Number)
  for (let i = 0; i < 3; i += 1) {
    m -= 1
    if (m < 1) { m = 12; y -= 1 }
    const period = `${y}-${String(m).padStart(2, '0')}`
    if (earliest && period < earliest) break
    out.push(period)
  }
  return out
}

export function attention(books = {}, { asOf = null } = {}) {
  const {
    items = [], movements = [], quotes = [], projects = [], expenses = [], income = [],
    muster = [], workOrders = [], raBills = [], workItems = [], measurements = [],
    plant = [], plantLogs = [], units = [], planStages = [], receipts = [],
    advances = [], adjustments = [], policy = null, role = 'member', userId = null,
    entityId = null, departments = [], payrollRuns = [], employees = [],
  } = books

  const out = []
  const stock = stockReport(items, movements)
  const costs = {
    materialCosts: Object.fromEntries(
      usageBySite(items, movements, { projects }).filter((u) => u.projectId).map((u) => [u.projectId, u.value]),
    ),
    labourCosts: labourCostsBySite(muster, { entityId }),
    subcontractCosts: subcontractCostsBySite(workOrders, raBills, { entityId }),
    plantCosts: plantCostsBySite(plant, plantLogs, { entityId }),
  }
  const jobs = projectReport(projects, expenses, income, costs)
  const contracts = subcontractReport(workOrders, raBills, { entityId })
  const yard = plantReport(plant, plantLogs, { entityId })
  const book = salesReport(units, planStages, receipts, { entityId })
  const loose = unattributed(expenses, income)

  // ── Wrong ────────────────────────────────────────────────────────
  // A site holding less than nothing has issued material it was never sent.
  // The company can be square overall and still have a store that is short,
  // which is exactly the case a single total hides.
  const shortStores = stock.byLocation.filter((l) => l.negative > 0)
  if (shortStores.length) {
    out.push(finding('stock.negative', 'error',
      `${plural(shortStores.length, 'store has', 'stores have')} issued material they never received`,
      'Stock cannot go below nothing, so the books and a shelf somewhere disagree. Until it is squared, every cost that draws on that store is wrong.',
      { count: shortStores.length, where: OPS('materials') }))
  }
  if (contracts.problems > 0) {
    out.push(finding('rabill.problems', 'error',
      `${plural(contracts.problems, 'running account bill needs', 'running account bills need')} a second look`,
      'Certified above what was claimed, certifying less than the bill before it, or past the order value. All three are legitimate sometimes and none should pass unseen.',
      { count: contracts.problems, where: OPS('labour') }))
  }
  const advanceErrors = outstandingAdvances(advances, adjustments, { entityId }).errors
  if (advanceErrors > 0) {
    out.push(finding('advance.overadjusted', 'error',
      `${plural(advanceErrors, 'advance has', 'advances have')} more set against them than was ever paid`,
      'Somebody adjusted an advance past its balance. The amount recovered is overstated by the difference.',
      { count: advanceErrors, where: OPS('advances') }))
  }
  if (book.untriggered > 0) {
    out.push(finding('sales.untriggered', 'error',
      `${plural(book.untriggered, 'instalment', 'instalments')} will never fall due`,
      'They name no stage of work and carry no date, so nothing will ever make them payable. Every plan ends with one of these unless somebody finishes it.',
      { count: book.untriggered, where: OPS('sales') }))
  }

  // ── Owed ─────────────────────────────────────────────────────────
  if (stock.rejectedValue > 0) {
    out.push(finding('stock.rejected', 'money',
      'Material went back to suppliers and has not been claimed',
      'Rejected deliveries are a credit the supplier owes, not a cost of the job. Nobody chases a number nobody prints.',
      { amount: stock.rejectedValue, count: stock.itemsRejected, where: OPS('materials') }))
  }
  if (yard.unloggedCost > 0) {
    out.push(finding('plant.unlogged', 'money',
      `${plural(yard.unloggedDays, 'day', 'days')} of plant hire billed with no log sheet`,
      'The machine was on hire and nobody wrote down whether it turned a wheel. It is the quietest money there is.',
      { amount: yard.unloggedCost, count: yard.unloggedDays, where: OPS('plant') }))
  }
  if (book.overdue > 0) {
    out.push(finding('sales.overdue', 'money',
      `${plural(book.unitsOverdue, 'buyer is', 'buyers are')} past their date`,
      'Work they have been billed for, invoiced, and not paid. This is the oldest money in the business.',
      { amount: book.overdue, count: book.unitsOverdue, where: OPS('sales') }))
  }
  const advOverdue = outstandingAdvances(advances, adjustments, { entityId, asOf }).overdueTotal
  if (advOverdue > 0) {
    out.push(finding('advance.overdue', 'money',
      'Advances are past the date they were expected back',
      'Somebody is holding the company’s money longer than they said they would.',
      { amount: advOverdue, where: OPS('advances') }))
  }
  if (contracts.retentionHeld > 0) {
    out.push(finding('contract.retention', 'money',
      'Retention is being held against subcontractors',
      'It is a liability with a release date, not a saving. Holding it past the date it was due sours a relationship the company needs again.',
      { amount: contracts.retentionHeld, where: OPS('labour') }))
  }
  if (loose.spent > 0) {
    out.push(finding('cost.unattributed', 'money',
      'Bills are booked to no site at all',
      'Overheads are real, but every rupee here is missing from some job’s cost, and the jobs look cheaper than they are by exactly this much.',
      { amount: loose.spent, count: loose.count, where: OPS('projects') }))
  }

  // A budget that nothing checks is a number somebody typed once. This is the
  // check — and it is money already spent, not a risk of spending it.
  const centres = costCentreReport(departments, expenses, income, { entityId, months: [thisMonth(asOf)] })
  if (centres.overspent > 0) {
    out.push(finding('budget.over', 'money',
      `${plural(centres.overspent, 'cost centre is', 'cost centres are')} past this month\u2019s budget`,
      'A division counts what the teams inside it spent, which is what its budget was meant to cover.',
      { amount: centres.overBy, count: centres.overspent, where: { to: '/reports', label: 'Open' } }))
  }

  // ── Watch ────────────────────────────────────────────────────────
  if (jobs.overrunning > 0) {
    out.push(finding('job.overrun', 'risk',
      `${plural(jobs.overrunning, 'job is', 'jobs are')} over what they were costed at`,
      'Over the estimate is not the same as losing money, but it is the number the estimate exists to give you.',
      { amount: jobs.overrunTotal, count: jobs.overrunning, where: OPS('projects') }))
  }
  const losing = jobs.lines.filter((l) => l.losing)
  if (losing.length) {
    out.push(finding('job.losing', 'risk',
      `${plural(losing.length, 'job has', 'jobs have')} cost more than the client agreed to pay`,
      'Not an overrun — a loss. What has been spent is past the contract value, so finishing it costs money.',
      { amount: round2(losing.reduce((t, l) => t + (l.spent - l.contract), 0)), count: losing.length, where: OPS('projects') }))
  }
  // The earliest warning a builder gets, and it arrives months before the money
  // runs out.
  for (const line of jobs.lines) {
    const built = siteProgress(workItems.filter((i) => i.project_id === line.project.id), measurements)
    const pace = progressAgainstSpend({
      earned: built.earned, value: built.value, spent: line.spent, estimate: line.estimate,
    })
    if (pace.known && pace.behind) {
      out.push(finding(`job.pace.${line.project.id}`, 'risk',
        `${line.project.name} is spending faster than it is building`,
        `${pace.burnt}% of the budget is gone and ${pace.built}% of the work is done. Nothing in a ledger will tell you this.`,
        { amount: round2(line.estimate * (Math.abs(pace.gap) / 100)), where: OPS('projects') }))
    }
  }
  const late = jobs.lines.filter((l) => daysLate(l.project, asOf ? new Date(asOf) : undefined) !== null)
  if (late.length) {
    out.push(finding('job.late', 'risk',
      `${plural(late.length, 'job is', 'jobs are')} past the day they were due`,
      'Said in days rather than as a flag, because four days over and eight months over are not the same conversation.',
      { count: late.length, amount: 0, where: OPS('projects') }))
  }
  if (stock.itemsBelowReorder > 0) {
    out.push(finding('stock.reorder', 'risk',
      `${plural(stock.itemsBelowReorder, 'material is', 'materials are')} at or below their reorder level`,
      'A site that runs out waits, and a site that waits still pays its labour and its hire.',
      { count: stock.itemsBelowReorder, where: OPS('materials') }))
  }
  if (yard.idleMachines > 0) {
    out.push(finding('plant.idle', 'risk',
      `${plural(yard.idleMachines, 'machine is', 'machines are')} working under half the time they are on site`,
      'An hour of work off a machine at 40% utilisation costs two and a half times its nominal rate, and the hire bill never says so.',
      { amount: yard.idleCost, count: yard.idleMachines, where: OPS('plant') }))
  }
  // A month nobody ran is a month whose wage bill is arithmetic on today's
  // salaries. It reads fine until somebody gets a raise, and then last March
  // quietly gets more expensive.
  if (employees.some((e) => e.active !== false)) {
    const missed = closedMonths(asOf, employees).filter(
      (m) => !payrollRuns.some((r) => !r.deleted_at && r.period === m && (!entityId || r.entity_id === entityId)),
    )
    if (missed.length) {
      out.push(finding('payroll.unrecorded', 'risk',
        `${plural(missed.length, 'month has', 'months have')} gone by without payroll being run`,
        'Until a month is run it is worked out from today\u2019s salaries, so a raise changes what last month appears to have cost.',
        { count: missed.length, where: OPS('payroll') }))
    }
  }

  const labour = labourReport(muster, { entityId })
  if (labour.overtimePercent >= 15) {
    out.push(finding('labour.overtime', 'risk',
      `Overtime is ${labour.overtimePercent}% of the wage bill`,
      'The figure that quietly doubles while everyone watches the material rates.',
      { amount: labour.overtime, where: OPS('labour') }))
  }
  if (contracts.unCertified > 0) {
    out.push(finding('contract.uncertified', 'risk',
      'Contractors have claimed for work nobody has measured',
      'The gap between what was asked for and what was certified. A large one means the claims and the site do not agree.',
      { amount: contracts.unCertified, where: OPS('labour') }))
  }
  if (policy?.enabled) {
    const queue = approvalQueue([
      { kind: 'expense', rows: expenses },
      { kind: 'advance', rows: advances },
      { kind: 'workorder', rows: workOrders },
      { kind: 'rabill', rows: raBills },
    ], { role, userId })
    if (queue.mine > 0) {
      out.push(finding('approval.waiting', 'risk',
        `${plural(queue.mine, 'document is', 'documents are')} waiting for you to sign`,
        'Nobody else can clear these — the person who raised a document cannot approve it.',
        { amount: queue.total, count: queue.mine, where: { to: '/companies', label: 'Review' } }))
    }
  }

  // ── Worth doing ──────────────────────────────────────────────────
  const prices = priceList(items, movements, quotes, { asOf })
  if (prices.cheaperAvailable > 0) {
    const best = prices.rows.filter((r) => r.cheaperAvailable)
    out.push(finding('price.cheaper', 'chance',
      `${plural(prices.cheaperAvailable, 'material has', 'materials have')} a live quote below what you last paid`,
      `The best of them is ${best[0]?.savingPercent}% under, from ${best[0]?.bestVendor}. Acting on it is a decision for a person; noticing it is not.`,
      { count: prices.cheaperAvailable, where: OPS('materials') }))
  }
  const quoteState = quoteBook(quotes, { asOf })
  if (quoteState.expired > 0) {
    out.push(finding('quote.expired', 'chance',
      `${plural(quoteState.expired, 'quotation', 'quotations')} ran out while nobody decided`,
      'Each one is a purchase that now has to be re-quoted, which is the cost of not having looked.',
      { count: quoteState.expired, where: OPS('materials') }))
  }
  if (book.available > 0 && book.availableValue > 0) {
    out.push(finding('sales.available', 'chance',
      `${plural(book.available, 'unit is', 'units are')} still available to sell`,
      `Worth ${Math.round(book.availableValue).toLocaleString('en-IN')} at today's agreed prices. Held-back stock is counted separately, because it cannot be sold tomorrow.`,
      { amount: book.availableValue, count: book.available, where: OPS('sales') }))
  }

  const findings = out.sort((a, b) =>
    LEVELS[a.level].rank - LEVELS[b.level].rank || b.amount - a.amount)

  const byLevel = Object.fromEntries(LEVEL_IDS.map((id) => [id, findings.filter((f) => f.level === id).length]))
  return {
    findings,
    count: findings.length,
    byLevel,
    // What is wrong, owed or at risk, added up. Not the opportunities: money
    // you might save is not money you have lost, and adding them together
    // produces a figure that means nothing.
    atStake: round2(findings.filter((f) => f.level !== 'chance').reduce((t, f) => t + f.amount, 0)),
    worst: findings[0] || null,
    // Nothing wrong is worth saying plainly, rather than showing an empty list
    // that reads like something failed to load.
    clear: findings.length === 0,
  }
}
