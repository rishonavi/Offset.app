import { subMonths, format } from 'date-fns'
import { loanSummary } from './loan'
import { leaseStatus } from './lease'

// ── Investment performance metrics ──────────────────────────────────────────
// Everything is derived client-side from data already stored on the asset
// (value, loan terms, lease) plus its income & expense rows. Figures use a
// trailing-12-month (TTM) window so they read as an annualised run-rate.

const num = (v) => Number(v) || 0
const sum = (rows) => rows.reduce((s, r) => s + num(r.amount), 0)

// Operating expenses exclude debt service — NOI reflects how the asset performs,
// not how it's financed. Loan repayments are handled separately as cash flow.
const DEBT_CATEGORY = 'Loan / EMI'
const isOperating = (e) => e.category !== DEBT_CATEGORY

const ttmStart = (today) => format(subMonths(today, 12), 'yyyy-MM-dd')
const since = (rows, start) => rows.filter((r) => (r.date || '') >= start)

// Occupancy only counts assets that actually carry lease data; equities, gold,
// etc. are excluded from the ratio (returns null for them).
export function occupancy(property, today = new Date()) {
  const lease = leaseStatus(property, today)
  if (!lease) return null
  return lease.state === 'active' || lease.state === 'ending' ? 'occupied' : 'vacant'
}

// Per-asset metrics. `expenses` / `income` should already be scoped to the asset.
export function assetMetrics(property, expenses, income, today = new Date()) {
  const start = ttmStart(today)
  const value = num(property?.value)

  const ttmIncome = sum(since(income, start))
  const ttmExpenseAll = sum(since(expenses, start))
  const ttmOperating = sum(since(expenses, start).filter(isOperating))

  const noi = ttmIncome - ttmOperating // annual net operating income
  const loan = loanSummary(property, today)
  const emiAnnual = loan ? loan.emi * 12 : 0

  return {
    value,
    ttmIncome,
    ttmExpense: ttmExpenseAll,
    ttmOperating,
    noi,
    // Yields / ratios need an asset value to be meaningful.
    capRate: value ? (noi / value) * 100 : null,
    grossYield: value ? (ttmIncome / value) * 100 : null,
    netYield: value ? ((ttmIncome - ttmExpenseAll) / value) * 100 : null,
    expenseRatio: ttmIncome ? (ttmOperating / ttmIncome) * 100 : null,
    // Cash flow after debt service, per month.
    monthlyCashFlow: Math.round((noi - emiAnnual) / 12),
    annualCashFlow: Math.round(noi - emiAnnual),
    hasLoan: !!loan,
    emi: loan ? loan.emi : 0,
    occupancy: occupancy(property, today),
  }
}

// Portfolio roll-up across the given assets. Cap rate and yields are computed on
// the aggregate (sum of NOI / sum of value) so a big asset weighs more than a
// small one, which is how investors read a portfolio.
export function portfolioMetrics(properties, expenses, income, today = new Date()) {
  const byProp = (rows, id) => rows.filter((r) => r.property_id === id)
  let totalValue = 0
  let ttmIncome = 0
  let ttmOperating = 0
  let ttmExpense = 0
  let annualDebt = 0
  let lettable = 0
  let occupied = 0

  for (const p of properties) {
    const m = assetMetrics(p, byProp(expenses, p.id), byProp(income, p.id), today)
    totalValue += m.value
    ttmIncome += m.ttmIncome
    ttmOperating += m.ttmOperating
    ttmExpense += m.ttmExpense
    annualDebt += m.emi * 12
    if (m.occupancy) {
      lettable += 1
      if (m.occupancy === 'occupied') occupied += 1
    }
  }

  const noi = ttmIncome - ttmOperating
  return {
    assets: properties.length,
    totalValue,
    ttmIncome,
    ttmOperating,
    ttmExpense,
    noi,
    capRate: totalValue ? (noi / totalValue) * 100 : null,
    grossYield: totalValue ? (ttmIncome / totalValue) * 100 : null,
    expenseRatio: ttmIncome ? (ttmOperating / ttmIncome) * 100 : null,
    monthlyCashFlow: Math.round((noi - annualDebt) / 12),
    annualCashFlow: Math.round(noi - annualDebt),
    lettable,
    occupied,
    occupancyPct: lettable ? Math.round((occupied / lettable) * 100) : null,
  }
}
