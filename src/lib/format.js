import { format, parseISO, isValid } from 'date-fns'
import { CURRENCY, LOCALE } from './constants'

// Today's date lives in its own module so leaf modules can read the clock
// without pulling a date library and two Intl formatters onto the page.
export { todayISO } from './today'

const currencyFmt = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

// A compact label must never claim a figure that has not been reached. ICU's
// default rounds to nearest, so **₹99,999 read "1L"** — the same label an actual
// lakh gets, on a chart axis, where the whole point of the tick is to tell you
// which order of magnitude you are looking at.
//
// `trunc` rather than `floor`, and the difference is only visible on a negative:
// flooring -99,999 gives **-1L**, because floor moves away from zero below it,
// which overstates the very thing this is meant to stop. `trunc` always moves
// toward zero, so neither sign is ever overstated. On a non-negative figure —
// which is all these axes plot today — the two are identical, so this costs
// nothing and is right if a negative ever reaches it.
const compactFmt = new Intl.NumberFormat(LOCALE, {
  notation: 'compact',
  maximumFractionDigits: 1,
  roundingMode: 'trunc',
})

// `Number(n) || 0` was not enough. It catches NaN, null, '' and a word, because
// all of those are falsy once coerced — but ±Infinity is a finite-looking truthy
// number to `||`, so it went straight through and ICU rendered it: a stat card
// reading **₹∞**. Nothing exotic is needed to produce one, only a division
// whose denominator happened to be zero — a yield on an asset that cost
// nothing, a per-unit rate on no units — and a figure like that has no business
// reaching a screen as a currency.
const finite = (n) => {
  const v = Number(n)
  return Number.isFinite(v) ? v : 0
}

export const formatCurrency = (n) => currencyFmt.format(finite(n))

export const formatCompact = (n) => compactFmt.format(finite(n))

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

export const monthKey = (d) => {
  const dt = toDate(d)
  return isValid(dt) ? format(dt, 'yyyy-MM') : ''
}
