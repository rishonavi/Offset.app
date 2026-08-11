// Read a broker's holdings export and turn it into assets.
//
// Every Indian broker exports holdings, and every one of them uses different
// column names for the same four numbers: what you hold, how much, what you
// paid, what it's worth now. Zerodha says "Avg. cost", Groww says "Average
// buy price", Upstox says "Buy Avg", ICICI Direct says "Average Cost Price".
// None of them agree, and all of them mean the same thing.
//
// So this matches on aliases rather than on a fixed layout, and refuses a file
// it can't read instead of importing half of it. A partial holdings import is
// worse than none: the missing rows don't announce themselves, they just make
// the portfolio quietly too small.

import { parseCSV } from './statement'

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[._]+/g, ' ').replace(/\s+/g, ' ')

// Indian exports use lakh/crore grouping and sometimes a leading ₹.
export function toNumber(v) {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const cleaned = String(v).replace(/[₹,\s]/g, '').replace(/^\((.*)\)$/, '-$1')
  if (cleaned === '' || cleaned === '-') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

const SYMBOL_ALIASES = ['symbol', 'instrument', 'tradingsymbol', 'scrip', 'scrip name', 'stock name', 'security', 'isin', 'company name', 'name', 'scheme name', 'fund name']
const QTY_ALIASES = ['quantity', 'qty', 'qty.', 'holding qty', 'net quantity', 'units', 'balance quantity', 'free qty']
const AVG_ALIASES = ['avg cost', 'average cost', 'average cost price', 'average buy price', 'buy avg', 'buy average', 'avg price', 'average price', 'cost price', 'nav at purchase']
const LTP_ALIASES = ['ltp', 'last price', 'closing price', 'current price', 'market price', 'cmp', 'nav', 'current nav']
const VALUE_ALIASES = ['current value', 'market value', 'present value', 'value', 'holding value', 'valuation']
const PNL_ALIASES = ['p&l', 'pnl', 'profit/loss', 'unrealised p&l', 'unrealized p&l', 'net p&l', 'gain/loss']

// A broker is recognised by the columns it exports, not by the filename —
// people rename downloads.
export const BROKERS = [
  { id: 'zerodha', label: 'Zerodha (Console)', hints: ['instrument', 'avg cost'] },
  { id: 'groww', label: 'Groww', hints: ['average buy price'] },
  { id: 'upstox', label: 'Upstox', hints: ['buy avg'] },
  { id: 'icici', label: 'ICICI Direct', hints: ['average cost price'] },
  { id: 'mf', label: 'Mutual fund statement', hints: ['scheme name'] },
]

function pick(headers, aliases) {
  const normalised = headers.map(norm)
  for (const alias of aliases) {
    const i = normalised.indexOf(alias)
    if (i !== -1) return headers[i]
  }
  // Fall back to a contains match — "Avg. cost (₹)" should still find "avg cost".
  for (const alias of aliases) {
    const i = normalised.findIndex((h) => h.includes(alias))
    if (i !== -1) return headers[i]
  }
  return null
}

export function detectBroker(headers = []) {
  const normalised = headers.map(norm)
  const has = (h) => normalised.some((x) => x.includes(h))
  for (const b of BROKERS) if (b.hints.every(has)) return b
  return null
}

// What every broker's file reduces to. `value` is taken from the file when it
// is there and derived from quantity × price when it is not — never invented
// from a price we don't have.
export function normaliseHoldings(rows = []) {
  if (!rows.length) return { holdings: [], columns: null, error: 'That file has no rows in it.' }

  const headers = Object.keys(rows[0] || {})
  const columns = {
    symbol: pick(headers, SYMBOL_ALIASES),
    qty: pick(headers, QTY_ALIASES),
    avg: pick(headers, AVG_ALIASES),
    ltp: pick(headers, LTP_ALIASES),
    value: pick(headers, VALUE_ALIASES),
    pnl: pick(headers, PNL_ALIASES),
  }

  // Without a name and a quantity there is nothing to import. Say which is
  // missing rather than "invalid file".
  const missing = ['symbol', 'qty'].filter((k) => !columns[k])
  if (missing.length) {
    return {
      holdings: [],
      columns,
      error: `Couldn't find a ${missing.map((m) => (m === 'symbol' ? 'name or symbol' : 'quantity')).join(' or ')} column. Columns found: ${headers.join(', ')}.`,
    }
  }

  const holdings = []
  const skipped = []
  for (const row of rows) {
    const symbol = String(row[columns.symbol] ?? '').trim()
    const qty = toNumber(row[columns.qty])
    if (!symbol) continue
    // A totals row at the foot of the file has no quantity — drop it silently.
    if (qty == null) {
      if (!/^(total|grand total|sum)\b/i.test(symbol)) skipped.push(symbol)
      continue
    }
    if (qty === 0) continue // sold out; nothing held

    const avg = columns.avg ? toNumber(row[columns.avg]) : null
    const ltp = columns.ltp ? toNumber(row[columns.ltp]) : null
    const stated = columns.value ? toNumber(row[columns.value]) : null
    const value = stated != null ? stated : ltp != null ? round2(qty * ltp) : null
    const cost = avg != null ? round2(qty * avg) : null

    holdings.push({
      symbol,
      quantity: qty,
      avgCost: avg,
      price: ltp,
      cost,
      value,
      // Only when both ends are known. A gain computed against a missing cost
      // is just the value again, wearing a different label.
      gain: value != null && cost != null ? round2(value - cost) : null,
      pnl: columns.pnl ? toNumber(row[columns.pnl]) : null,
    })
  }

  return { holdings, columns, skipped, error: holdings.length ? null : 'No holdings were found in that file.' }
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export function parseHoldingsFile(text) {
  const rows = parseCSV(String(text || ''))
  const broker = detectBroker(Object.keys(rows[0] || {}))
  return { broker, ...normaliseHoldings(rows) }
}

export function portfolioTotals(holdings = []) {
  let value = 0
  let cost = 0
  let unpriced = 0
  for (const h of holdings) {
    if (h.value == null) unpriced++
    else value += h.value
    if (h.cost != null) cost += h.cost
  }
  return {
    count: holdings.length,
    value: round2(value),
    cost: round2(cost),
    // Unpriced rows are named rather than counted as zero, for the same reason
    // an unpriced gold holding is.
    unpriced,
    gain: cost > 0 && unpriced === 0 ? round2(value - cost) : null,
  }
}

// One asset per holding is unusable — nobody wants forty rows in a portfolio
// that also has three flats in it. A broker account is one asset whose value
// is the sum of what's in it.
export function asAsset(holdings, { name = 'Broker account', broker = null } = {}) {
  const totals = portfolioTotals(holdings)
  return {
    name,
    type: 'Stocks / Equity',
    value: totals.value,
    notes: [
      `${totals.count} holdings imported${broker ? ` from ${broker.label}` : ''}.`,
      totals.cost > 0 ? `Cost ₹${totals.cost.toLocaleString('en-IN')}.` : '',
      totals.unpriced ? `${totals.unpriced} without a price, not counted in the value.` : '',
    ].filter(Boolean).join(' '),
  }
}
