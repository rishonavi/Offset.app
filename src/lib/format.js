import { format, parseISO, isValid } from 'date-fns'
import { CURRENCY, LOCALE } from './constants'

const currencyFmt = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const compactFmt = new Intl.NumberFormat(LOCALE, {
  notation: 'compact',
  maximumFractionDigits: 1,
})

export const formatCurrency = (n) => currencyFmt.format(Number(n) || 0)

export const formatCompact = (n) => compactFmt.format(Number(n) || 0)

export const currencySymbol = (() => {
  try {
    return (0)
      .toLocaleString(LOCALE, { style: 'currency', currency: CURRENCY })
      .replace(/[\d.,\s ]/g, '')
      .trim()
  } catch {
    return CURRENCY
  }
})()

const toDate = (d) => (typeof d === 'string' ? parseISO(d) : d)

export const formatDate = (d) => {
  if (!d) return ''
  const dt = toDate(d)
  return isValid(dt) ? format(dt, 'dd MMM yyyy') : String(d)
}

export const todayISO = () => format(new Date(), 'yyyy-MM-dd')

export const monthKey = (d) => {
  const dt = toDate(d)
  return isValid(dt) ? format(dt, 'yyyy-MM') : ''
}
