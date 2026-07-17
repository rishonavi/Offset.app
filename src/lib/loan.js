import { addMonths, differenceInCalendarMonths, format, parseISO, isValid } from 'date-fns'

// Standard reducing-balance (EMI) amortization for a loan/mortgage held
// against an asset. All computed client-side from four inputs stored on the
// property: principal, annual interest rate %, tenure in months, start date.

// EMI = P·r·(1+r)^n / ((1+r)^n − 1),  r = monthly rate.
export function monthlyPayment(principal, annualRatePct, months) {
  const P = Number(principal) || 0
  const n = Number(months) || 0
  const r = (Number(annualRatePct) || 0) / 100 / 12
  if (P <= 0 || n <= 0) return 0
  if (r === 0) return P / n
  const f = Math.pow(1 + r, n)
  return (P * r * f) / (f - 1)
}

// Outstanding balance after `paid` monthly payments.
export function balanceAfter(principal, annualRatePct, months, paid) {
  const P = Number(principal) || 0
  const n = Number(months) || 0
  const r = (Number(annualRatePct) || 0) / 100 / 12
  const k = Math.max(0, Math.min(Number(paid) || 0, n))
  if (P <= 0 || n <= 0) return 0
  if (r === 0) return Math.max(0, P * (1 - k / n))
  const emi = monthlyPayment(P, annualRatePct, n)
  const fk = Math.pow(1 + r, k)
  return Math.max(0, P * fk - (emi * (fk - 1)) / r)
}

// Full summary for the UI, or null when the loan isn't fully specified.
export function loanSummary(property, today = new Date()) {
  const principal = Number(property?.loan_principal) || 0
  const rate = Number(property?.loan_rate) || 0
  const months = Number(property?.loan_tenure_months) || 0
  const start = property?.loan_start ? parseISO(property.loan_start) : null
  if (!principal || !months || !start || !isValid(start)) return null

  const emi = monthlyPayment(principal, rate, months)
  const elapsed = Math.max(0, differenceInCalendarMonths(today, start))
  const paid = Math.min(elapsed, months)
  const outstanding = balanceAfter(principal, rate, months, paid)
  const totalPayable = emi * months
  const totalInterest = Math.max(0, totalPayable - principal)

  return {
    principal,
    rate,
    months,
    emi,
    paid,
    remaining: Math.max(0, months - paid),
    outstanding,
    totalPayable,
    totalInterest,
    payoffDate: format(addMonths(start, months), 'yyyy-MM-dd'),
    progressPct: months ? Math.min(100, Math.round((paid / months) * 100)) : 0,
  }
}
