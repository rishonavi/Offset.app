// Parse a bank / UPI statement (already read into row objects by
// parseSpreadsheet) and reconcile it against outstanding bills — so importing
// your Google Pay / bank export shows which payments actually went through.

const norm = (s) => String(s ?? '').trim().toLowerCase()
const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.-]/g, ''))
  return Number.isNaN(n) ? 0 : n
}

// Month names → number, for "12 Jul 2026" style dates.
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

// Normalise a statement date to ISO (YYYY-MM-DD). Assumes day-first (dd/mm) as
// used by Indian banks & UPI apps.
export function toISO(v) {
  if (!v) return ''
  // Real .xlsx dates arrive as Date objects (unambiguous serials) — trust them.
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return ''
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/)
  if (m) {
    let [, d, mo, y] = m
    if (y.length === 2) y = '20' + y
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3,})[ -](\d{2,4})/)
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]
    if (mo) {
      let y = m[3]
      if (y.length === 2) y = '20' + y
      return `${y}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}`
    }
  }
  return ''
}

// Minimal CSV → row-objects parser. We parse bank CSVs as raw text (rather than
// via a spreadsheet lib) so day-first dates like 10/01/2026 stay strings and
// aren't silently coerced to Oct 1 by US-style date guessing.
export function parseCSV(text) {
  const rows = []
  let field = ''
  let row = []
  let inQuotes = false
  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    rows.push(row)
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') pushField()
    else if (c === '\r') {
      /* skip */
    } else if (c === '\n') {
      pushField()
      pushRow()
    } else field += c
  }
  if (field.length || row.length) {
    pushField()
    pushRow()
  }
  const header = (rows.shift() || []).map((h) => String(h).trim())
  return rows
    .filter((r) => r.some((c) => String(c).trim() !== ''))
    .map((r) => {
      const o = {}
      header.forEach((h, idx) => (o[h] = r[idx] ?? ''))
      return o
    })
}

const pickKey = (keys, aliases) => {
  for (const a of aliases) {
    const exact = keys.find((k) => norm(k) === a)
    if (exact) return exact
  }
  // Partial match only for longer aliases — short ones like "dr"/"cr" would
  // otherwise hit "description", "credit card", etc.
  for (const a of aliases) {
    if (a.length < 4) continue
    const partial = keys.find((k) => norm(k).includes(a))
    if (partial) return partial
  }
  return null
}

const DATE_ALIASES = ['txn date', 'transaction date', 'value date', 'posting date', 'date']
const DESC_ALIASES = ['narration', 'description', 'remarks', 'particulars', 'details', 'transaction remarks', 'to / from', 'payee', 'name']
const DEBIT_ALIASES = ['withdrawal amt', 'withdrawal', 'debit amount', 'debit', 'paid out', 'money out', 'dr']
const CREDIT_ALIASES = ['deposit amt', 'deposit', 'credit amount', 'credit', 'paid in', 'money in', 'cr']
const AMOUNT_ALIASES = ['amount (inr)', 'transaction amount', 'txn amount', 'amount']
const TYPE_ALIASES = ['dr / cr', 'dr/cr', 'cr/dr', 'transaction type', 'debit/credit', 'type']

// Turn raw spreadsheet rows into { date, amount, direction, description }.
export function parseStatement(rows) {
  if (!rows || rows.length === 0) return { transactions: [], columns: null }
  const keys = Object.keys(rows[0])
  const cols = {
    date: pickKey(keys, DATE_ALIASES),
    desc: pickKey(keys, DESC_ALIASES),
    debit: pickKey(keys, DEBIT_ALIASES),
    credit: pickKey(keys, CREDIT_ALIASES),
    amount: pickKey(keys, AMOUNT_ALIASES),
    type: pickKey(keys, TYPE_ALIASES),
  }

  const transactions = []
  for (const r of rows) {
    const date = toISO(r[cols.date])
    if (!date) continue
    let direction = null
    let amount = 0
    if (cols.debit || cols.credit) {
      const d = num(r[cols.debit])
      const c = num(r[cols.credit])
      if (d > 0) {
        direction = 'debit'
        amount = d
      } else if (c > 0) {
        direction = 'credit'
        amount = c
      }
    } else if (cols.amount) {
      const a = num(r[cols.amount])
      const t = norm(r[cols.type])
      amount = Math.abs(a)
      if (t.includes('cr') || t.includes('credit')) direction = 'credit'
      else if (t.includes('dr') || t.includes('debit')) direction = 'debit'
      else direction = a < 0 ? 'debit' : 'credit' // signed amount column
    }
    if (!direction || amount <= 0) continue
    transactions.push({ date, amount, direction, description: String(r[cols.desc] ?? '').trim() })
  }
  return { transactions, columns: cols }
}

const dayDiff = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000)

// Best unused candidate with the same amount and the closest date (within window).
function bestMatch(candidates, used, txn, windowDays) {
  let best = null
  let bestDelta = Infinity
  for (const c of candidates) {
    if (used.has(c.id)) continue
    if (Math.abs((Number(c.amount) || 0) - txn.amount) > 0.01) continue
    const delta = dayDiff(c.due_date || c.date, txn.date)
    if (delta <= windowDays && delta < bestDelta) {
      best = c
      bestDelta = delta
    }
  }
  return best
}

// Match statement debits to unpaid expenses and credits to pending income.
// Returns the reconciliation plan (matches + leftovers).
export function reconcile(transactions, expenses, income, { windowDays = 5 } = {}) {
  const unpaidExp = expenses.filter((e) => e.status === 'unpaid')
  const pendingInc = income.filter((e) => e.status && e.status !== 'received')
  const usedExp = new Set()
  const usedInc = new Set()
  const matchedPaid = []
  const matchedReceived = []
  const newExpenses = []
  const newIncome = []

  for (const t of transactions) {
    if (t.direction === 'debit') {
      const m = bestMatch(unpaidExp, usedExp, t, windowDays)
      if (m) {
        usedExp.add(m.id)
        matchedPaid.push({ entry: m, txn: t })
      } else newExpenses.push(t)
    } else {
      const m = bestMatch(pendingInc, usedInc, t, windowDays)
      if (m) {
        usedInc.add(m.id)
        matchedReceived.push({ entry: m, txn: t })
      } else newIncome.push(t)
    }
  }
  return { matchedPaid, matchedReceived, newExpenses, newIncome }
}
