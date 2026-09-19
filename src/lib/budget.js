import { startOfMonth, format } from 'date-fns'

// Map of property_id -> amount spent in the current calendar month.
export function monthSpendByProperty(expenses, ref = new Date()) {
  const start = format(startOfMonth(ref), 'yyyy-MM-dd')
  const map = new Map()
  for (const e of expenses) {
    if ((e.date || '') >= start) {
      map.set(e.property_id, (map.get(e.property_id) || 0) + (Number(e.amount) || 0))
    }
  }
  return map
}

// Returns null when no budget is set, otherwise progress + alert level.
//
// Spending exactly the budget is its own state. It used to fall into `over`,
// which put a red bar and "Over budget by ₹0" against somebody who had hit
// their number precisely — the one outcome a budget is aimed at, reported as a
// failure. `spent` is the level for that, and `over` now means genuinely over.
export function budgetStatus(spent, budget) {
  const b = Number(budget) || 0
  if (b <= 0) return null
  const used = Number(spent) || 0
  const pct = (used / b) * 100
  const remaining = b - used
  // A rupee of float either way is not a real overspend.
  const level = remaining < -0.005 ? 'over'
    : Math.abs(remaining) <= 0.005 ? 'spent'
      : pct >= 80 ? 'warn' : 'ok'
  return { spent: used, budget: b, pct, level, remaining, over: Math.max(0, -remaining) }
}

// `spent` is amber rather than red: the budget is used up, which is worth
// noticing, but nothing has gone wrong.
export const BUDGET_COLORS = { ok: '#10b981', warn: '#f59e0b', spent: '#f59e0b', over: '#ef4444' }
