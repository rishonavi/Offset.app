import { format } from 'date-fns'
import { CHART_PALETTE } from './constants'

// Everyday personal-life categories (distinct from the asset/property ones).
export const PERSONAL_CATEGORIES = [
  'Groceries',
  'Dining & Takeout',
  'Transport',
  'Housing / Rent',
  'Utilities & Bills',
  'Health & Fitness',
  'Shopping',
  'Entertainment',
  'Subscriptions',
  'Education',
  'Travel',
  'Other',
]

const COLORS = {}
PERSONAL_CATEGORIES.forEach((c, i) => {
  COLORS[c] = CHART_PALETTE[i % CHART_PALETTE.length]
})
export const colorForPersonal = (c, i = 0) => COLORS[c] || CHART_PALETTE[i % CHART_PALETTE.length]

export const monthKey = (d = new Date()) => format(d, 'yyyy-MM')

// Human label for a YYYY-MM key.
export const monthLabel = (ym) => {
  const [y, m] = ym.split('-')
  return format(new Date(Number(y), Number(m) - 1, 1), 'MMMM yyyy')
}

// Shift a YYYY-MM key by n months.
export const shiftMonth = (ym, n) => {
  const [y, m] = ym.split('-').map(Number)
  return format(new Date(y, m - 1 + n, 1), 'yyyy-MM')
}

export const inMonth = (rows, ym) => rows.filter((e) => (e.date || '').slice(0, 7) === ym)
