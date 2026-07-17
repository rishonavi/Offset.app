import { startOfMonth, subMonths, format } from 'date-fns'

// Flag expense categories whose current-month total is notably above their
// recent monthly average. Pure computation over existing data — no config.
//   lookback   how many prior months to average over
//   threshold  how far above average counts as unusual (0.4 = +40%)
//   minAmount  ignore trivially small current-month totals
//   minMonths  require at least this many prior months of the category
export function spendingAnomalies(expenses, opts = {}, today = new Date()) {
  const { lookback = 6, threshold = 0.4, minAmount = 1000, minMonths = 2 } = opts
  const curStart = format(startOfMonth(today), 'yyyy-MM-dd')
  const histStart = format(startOfMonth(subMonths(today, lookback)), 'yyyy-MM-dd')

  const current = new Map() // category -> current-month total
  const hist = new Map() // category -> Map(month -> total)
  for (const e of expenses) {
    const d = e.date || ''
    if (!d) continue
    const cat = e.category || 'Other'
    const amt = Number(e.amount) || 0
    if (d >= curStart) {
      current.set(cat, (current.get(cat) || 0) + amt)
    } else if (d >= histStart) {
      const m = hist.get(cat) || new Map()
      const key = d.slice(0, 7)
      m.set(key, (m.get(key) || 0) + amt)
      hist.set(cat, m)
    }
  }

  const out = []
  for (const [cat, cur] of current) {
    if (cur < minAmount) continue
    const m = hist.get(cat)
    if (!m || m.size < minMonths) continue
    const avg = [...m.values()].reduce((s, v) => s + v, 0) / m.size
    if (avg <= 0) continue
    const change = (cur - avg) / avg
    if (change >= threshold) {
      out.push({ category: cat, current: cur, average: avg, changePct: Math.round(change * 100) })
    }
  }
  return out.sort((a, b) => b.changePct - a.changePct)
}
