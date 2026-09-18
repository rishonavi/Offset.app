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
import { subcontractReport, subcontractCostsBySite, retentionBook, clientContracts, measurementCheck } from './subcontract'
import { plantReport, plantCostsBySite } from './plant'
import { salesReport } from './sales'
import { outstandingAdvances } from './advances'
import { approvalQueue } from './corporate'
import { costCentreReport } from './costcentres'
import { materialVariance, labourRateSpread } from './rates'
import { shrinkage } from './stockcount'
import { tdsLedger } from './tds'
import { ptaxFor } from './ptax'
import { gratuityLiability, VESTING_YEARS } from './gratuity'
import { bonusRegister } from './bonus'
import { leaveLiability } from './leave'
import { statutoryStatus, SCHEMES, DEFAULT_PAYROLL_CONFIG } from './payroll'

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
    stockCounts = [],
    entityId = null, departments = [], payrollRuns = [], employees = [],
    fyStartMonth = 4, payrollConfig = null,
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
  // The same orders read from the other end. A company that only ever looked
  // at what it holds from its subcontractors never sees what its own client is
  // holding from it, which is the larger of the two numbers on most jobs.
  const clients = clientContracts(workOrders, raBills, { entityId })
  const heldBySub = retentionBook(workOrders, raBills, { entityId, side: 'sub', asOf })
  const heldByClient = retentionBook(workOrders, raBills, { entityId, side: 'client', asOf })
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
  const billProblems = contracts.problems + clients.problems
  if (billProblems > 0) {
    out.push(finding('rabill.problems', 'error',
      `${plural(billProblems, 'running account bill needs', 'running account bills need')} a second look`,
      'Certified above what was claimed, certifying less than the bill before it, or past the order value. All three are legitimate sometimes and none should pass unseen.',
      { count: billProblems, where: OPS('labour') }))
  }
  const overReleased = round2(heldBySub.overReleased + heldByClient.overReleased)
  if (overReleased > 0) {
    out.push(finding('retention.over', 'error',
      'More retention has been given back than was ever held',
      'The releases recorded against an order exceed what its bills ever withheld, so either a release was entered twice or it was entered against the wrong contractor. Until it is squared the balance held is wrong by the difference.',
      { amount: overReleased, where: OPS('labour') }))
  }
  // Certification problems are certification problems whichever side of the
  // contract they are on.
  // What was certified against what was measured. Two screens that have never
  // been compared, and a bill can certify more plaster than the engineer has
  // recorded with every total in the app still adding up.
  const measured = measurementCheck(workOrders, raBills, workItems, measurements, { entityId })
  if (measured.ahead > 0) {
    out.push(finding('bill.aheadOfWork', 'error',
      `${plural(measured.ahead, 'contractor has', 'contractors have')} certified more than has been measured`,
      'The measurement book always lags the bill by a few days, so a small gap is ordinary. This is not a small gap, and it is the only comparison that turns a payment back into work in the ground.',
      { amount: measured.aheadBy, count: measured.ahead, where: OPS('labour') }))
  }
  // What the law requires deducting, against what the orders actually said to.
  // The law asks about one deductee across one year; every screen in this app
  // asks about one order, so a contractor paid three times under the limit has
  // crossed the aggregate and every order still looks right.
  const tax = tdsLedger(workOrders, raBills, { entityId, fyStartMonth, asOf })
  if (tax.shortfall > 0) {
    out.push(finding('tds.short', 'error',
      `${plural(tax.short, 'contractor has', 'contractors have')} had too little deducted this year`,
      'Under 194C the year is counted per contractor, not per order — and the payment that crosses ₹1,00,000 makes everything paid that year liable, not the excess. Three orders each under the limit is the ordinary way to get this wrong.',
      { amount: tax.shortfall, count: tax.short, where: OPS('labour') }))
  }
  // Over the headcount an Act names, and not registered for it. Not a payroll
  // setting — a thing somebody has to do something about, and the app knows the
  // headcount so it is the one placed to notice.
  const onBooks = employees.filter((e) => e.active !== false).length
  const schemes = statutoryStatus({ headcount: onBooks, config: payrollConfig || DEFAULT_PAYROLL_CONFIG })
  if (schemes.mustRegister.length) {
    const names = schemes.mustRegister.map((id) => SCHEMES[id].label)
    out.push(finding('payroll.notRegistered', 'error',
      `${names.join(' and ')} ${names.length === 1 ? 'is' : 'are'} required at this headcount`,
      `${onBooks} people are on the books. ${schemes.mustRegister.map((id) => schemes[id].why).join(' ')}`,
      { count: names.length, where: OPS('payroll') }))
  }
  // A state that does levy professional tax whose slabs nobody has entered.
  // Money owed and not deducted, every month, on a payslip that looks finished
  // — which is what makes it worth shouting about rather than filing under
  // risk. Nothing in the shipped table of states trips this; it is here so that
  // a state added later without slabs is loud rather than quietly nil.
  if (onBooks > 0) {
    const pt = ptaxFor({ state: (payrollConfig || DEFAULT_PAYROLL_CONFIG).professionalTax?.state || '', monthlyGross: 0 })
    if (pt.needsSlabs) {
      out.push(finding('ptax.needsSlabs', 'error',
        `${pt.name}’s professional tax slabs are not entered`,
        `${pt.name} levies professional tax and this does not carry its slabs, so nothing is coming off any payslip and something is owed on every one. Enter them from the state’s own notification.`,
        { count: onBooks, where: OPS('payroll') }))
    }
  }
  // Bonus that should already have been paid. Eight months after the year
  // closes is not a soft date, and the money is owed to the people least able
  // to wait for it.
  const bonusBook = onBooks > 0
    ? bonusRegister(employees, { fyStartMonth, rate: payrollConfig?.bonus?.rate ?? null,
        minimumWage: payrollConfig?.bonus?.minimumWage || 0, config: payrollConfig?.bonus || {} })
    : null
  if (bonusBook?.applies && bonusBook.year.overdue && bonusBook.total > 0) {
    out.push(finding('bonus.overdue', 'error',
      `Bonus for ${bonusBook.year.label} is past its date`,
      `The Act gives eight months from the close of the year and that ran out ${plural(Math.abs(bonusBook.year.daysToDue), 'day', 'days')} ago. ${plural(bonusBook.eligible, 'person is', 'people are')} owed it.`,
      { amount: bonusBook.total, count: bonusBook.eligible, where: OPS('payroll') }))
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
  // What the shelf held against what the books believed. Material does not
  // vanish in one event; it goes a few bags at a time and the books stay
  // perfectly consistent the whole way.
  const counted = shrinkage(stockCounts, items, movements, { entityId, asOf, stores: projects })
  if (counted.shortValue > 0) {
    out.push(finding('stock.short', 'money',
      `A count found ${plural(counted.out || counted.count, 'store', 'stores')} short of what the books say`,
      'Shortages and overages are not netted against each other: a godown twelve bags down on cement and twelve up on sand has two problems, and the difference of nothing reports neither.',
      { amount: counted.shortValue, count: counted.out || counted.count, where: OPS('materials') }))
  }
  if (heldByClient.due > 0) {
    out.push(finding('retention.owed', 'money',
      'Retention the client owes back has fallen due',
      'The work was finished and the defect liability ran out, so this stopped being security and became a receivable. It is the one debt nobody sends an invoice for, which is why it sits for years.',
      { amount: heldByClient.due, count: heldByClient.dueCount, where: OPS('labour') }))
  }
  // What the same material normally costs here, against what it cost that
  // time. Nobody reads a column of forty receipts, so nobody has ever noticed
  // the one lorry bought at a Saturday rate.
  const paidRates = materialVariance(items, movements, { entityId })
  if (paidRates.overpaid > 0) {
    out.push(finding('rate.dear', 'money',
      `${plural(paidRates.dear, 'delivery came', 'deliveries came')} in well above the going rate`,
      'Measured against the median of the few purchases before each one, so a rising market does not set this off — only a jump does. Above the norm is not always a mistake, but it is always worth knowing which lorry it was.',
      { amount: paidRates.overpaid, count: paidRates.dear, where: OPS('materials') }))
  }
  // The opposite, and money rather than an error: work in the ground that
  // nobody has billed for.
  if (measured.behind > 0) {
    out.push(finding('work.unbilled', 'money',
      `${plural(measured.behind, 'contract has', 'contracts have')} measured work nobody has billed`,
      'The engineer has recorded more than the running account claims. On a client contract that is the company\u2019s own money it has not asked for.',
      { amount: measured.behindBy, count: measured.behind, where: OPS('labour') }))
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
  // Retention that fell due and was not paid. Not a loss and not an error —
  // the money is the contractor's and the company still has it, which is a
  // cheap way to lose the only mason who turns up on time.
  if (heldBySub.due > 0) {
    out.push(finding('retention.due', 'risk',
      `Retention on ${plural(heldBySub.dueCount, 'contract is', 'contracts are')} due for release`,
      heldBySub.lines.some((l) => l.overdueDays > 90)
        ? 'One of these passed its release date over three months ago. A contractor who has to ask twice prices the asking into his next quotation.'
        : 'The completion or the defect liability date has passed, so this is no longer security against anything.',
      { amount: heldBySub.due, count: heldBySub.dueCount, where: OPS('labour') }))
  }
  // The state that needs a date typed in rather than a cheque written. Worth
  // its own finding because the money is invisible to every other one: an
  // order with no completion date can never become due, so retention on it
  // would sit held for ever without anything ever saying so.
  // A store nobody has walked into. Not wrong, and not owed — the state where
  // nothing in the books can be trusted more than the last time somebody
  // looked, which on most of these is never.
  if (counted.unverifiedCount > 0) {
    out.push(finding('stock.unverified', 'risk',
      counted.neverCounted === counted.unverifiedCount
        ? `${plural(counted.unverifiedCount, 'store has', 'stores have')} never been counted`
        : `${plural(counted.unverifiedCount, 'store has', 'stores have')} not been counted in ${counted.staleDays} days`,
      'Every balance in the stores ledger is what the paperwork believes. Until somebody walks in with a clipboard it is the only evidence there is, and it has never once been checked against a shelf.',
      { count: counted.unverifiedCount, where: OPS('materials') }))
  }
  // Money withheld from a contractor that the law did not ask for. His problem
  // to reclaim and the company's to have caused.
  if (tax.excess > 0) {
    out.push(finding('tds.over', 'risk',
      `${plural(tax.over, 'contractor has', 'contractors have')} had tax deducted they did not owe`,
      'Below both the single-payment and the yearly limit there is nothing to deduct. Getting it back is their problem and a year of their paperwork.',
      { amount: tax.excess, count: tax.over, where: OPS('labour') }))
  }
  if (tax.conflicts > 0) {
    out.push(finding('tds.pan', 'error',
      `${plural(tax.conflicts, 'contractor is', 'contractors are')} on file under two different PANs`,
      'One name, two tax identities — so the year has been added up for a party that does not exist, and both returns are wrong.',
      { count: tax.conflicts, where: OPS('labour') }))
  }
  // Nobody has said either way, and nothing is being deducted on that basis.
  // A quiet zero is as wrong as a deduction nobody asked for.
  if (onBooks > 0 && schemes.unanswered.length && !schemes.mustRegister.length) {
    out.push(finding('payroll.unanswered', 'risk',
      `Nobody has said whether this company runs ${schemes.unanswered.map((id) => SCHEMES[id].short).join(' or ')}`,
      'Neither is deducted until somebody says, which is right — and a payslip that quietly deducts nothing because a question was never asked is not right either.',
      { count: schemes.unanswered.length, where: OPS('payroll') }))
  }
  // Nobody has said which state the work is in, so no professional tax is being
  // worked out for anybody. The same quiet zero as an unanswered scheme.
  if (onBooks > 0) {
    const ptState = (payrollConfig || DEFAULT_PAYROLL_CONFIG).professionalTax?.state || ''
    if (!ptState) {
      out.push(finding('ptax.noState', 'risk',
        'Nobody has said which state the professional tax is for',
        'It is a state levy with different slabs in every state and none at all in fourteen of them, so nothing is deducted until somebody says which. Entering the company’s GSTIN answers it too.',
        { count: onBooks, where: OPS('payroll') }))
    }
  }
  // Deducting, but from slabs worth checking. Not an error — money is coming off
  // and the figure is this app's best reading — but a return filed on it is
  // being filed on somebody else's homework, and the person filing should know
  // that before they sign it rather than after.
  if (onBooks > 0) {
    const pt = ptaxFor({ state: (payrollConfig || DEFAULT_PAYROLL_CONFIG).professionalTax?.state || '', monthlyGross: 0 })
    if (pt.verify) {
      out.push(finding('ptax.verify', 'risk',
        `${pt.name}’s professional tax slabs are worth checking`,
        `They are this app’s best reading of the state’s notification rather than something to file on unchecked — the smaller states revise theirs quietly. Check them once and, if they differ, enter your own.`,
        { count: onBooks, where: OPS('payroll') }))
    }
  }
  // The money the company already owes and has never added up. Not a deduction,
  // never on a payslip, and it falls due all at once when a site finishes.
  const owed = onBooks > 0
    ? gratuityLiability(employees, { config: payrollConfig?.gratuity || {} })
    : null
  if (owed?.applies && owed.vestedTotal > 0) {
    out.push(finding('gratuity.accrued', 'money',
      `Gratuity is owed and nothing is set aside for it`,
      `${plural(owed.vestedPeople, 'person has', 'people have')} passed ${VESTING_YEARS} years, so this is payable the day they leave. It is not a deduction and reaches no payslip, which is why it has never been added up.`,
      { amount: owed.vestedTotal, count: owed.vestedPeople, where: OPS('payroll') }))
  }
  // A person with no joining date is quietly worth nothing, which is the
  // cheapest kind of wrong and the hardest to notice in a total.
  if (owed?.applies && owed.undated > 0) {
    out.push(finding('gratuity.undated', 'risk',
      `${plural(owed.undated, 'person has', 'people have')} no joining date`,
      'Gratuity is fifteen days’ wages for every year worked, so without a joining date there is no number — and they are counted as nil in a total that looks complete.',
      { count: owed.undated, where: OPS('payroll') }))
  }
  // Bonus at the minimum because nobody chose, which is a decision not taken
  // rather than a decision to pay the least.
  if (bonusBook?.applies && !bonusBook.rateChosen && bonusBook.total > 0) {
    out.push(finding('bonus.noRate', 'risk',
      'Nobody has set a bonus rate',
      `Bonus is being worked out at the ${bonusBook.rate}% the Act imposes rather than at a figure this company chose. It allows anything up to 20%, and the amount beside this is what the difference would cost.`,
      { amount: bonusBook.atMaximum - bonusBook.total, count: bonusBook.eligible, where: OPS('payroll') }))
  }
  // Leave about to lapse. The one finding on this list where the money is the
  // worker's rather than the company's, and it is always avoidable: the days
  // could be encashed before the year turns for exactly the same cost.
  const standing = onBooks > 0 ? leaveLiability(employees, { policy: payrollConfig?.leave || {} }) : null
  if (standing?.lapsingDays > 0) {
    out.push(finding('leave.lapsing', 'money',
      `${plural(standing.lapsingDays, 'day', 'days')} of earned leave will lapse at the year end`,
      `${plural(standing.lapsingPeople, 'person is', 'people are')} over the ${standing.policy.carryCap}-day carry-forward cap, and anything above it is simply lost. Encashing the excess before the year turns costs the same and keeps it theirs.`,
      { amount: standing.lapsingValue, count: standing.lapsingPeople, where: OPS('payroll') }))
  }
  const undated = round2(heldBySub.undated + heldByClient.undated)
  if (undated > 0) {
    out.push(finding('retention.undated', 'risk',
      `Retention on ${plural(heldBySub.undatedCount + heldByClient.undatedCount, 'contract has', 'contracts have')} no release date`,
      'Nobody recorded when the work was finished, so nothing can work out when the money comes back. It will not appear as due on any date, because there is no date.',
      { amount: undated, count: heldBySub.undatedCount + heldByClient.undatedCount, where: OPS('labour') }))
  }
  // The same trade, the same fortnight, two different rates. Each site is
  // perfectly consistent with itself, which is exactly why no report has ever
  // shown this.
  const spread = labourRateSpread(muster, { entityId, projects, asOf })
  if (spread.count > 0) {
    const worst = spread.lines[0]
    out.push(finding('labour.spread', 'risk',
      `${worst.label}s are paid ${worst.spreadPercent}% more on one site than another`,
      `${worst.high.name} is paying ₹${worst.high.rate} a day and ${worst.low.name} ₹${worst.low.rate}, in the same fortnight. Either one site knows something about the labour market or somebody is charging what he can get.`,
      { amount: spread.atStake, count: spread.count, where: OPS('labour') }))
  }
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
