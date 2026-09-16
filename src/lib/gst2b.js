// The input credit a vendor has not filed for.
//
// A builder pays 18% on steel and 28% on cement and gets it back as input
// credit — but only if the vendor actually files. When he does not, the money
// is simply gone, and there is nothing in the books to say so: the purchase is
// recorded, the tax is recorded, and the credit that never arrived leaves no
// row anywhere. It is the largest recurring leak for a small Indian company and
// the only way to find it is to compare the books against GSTR-2B, line by
// line, every month, by hand.
//
// Two honest limits, because a reconciliation that overstates its precision is
// worse than none:
//
//   **This matches on the vendor's name and the tax amount, not on a GSTIN and
//   an invoice number**, because an expense in this app carries a vendor and a
//   tax figure and nothing else. That is enough to find the vendor who filed
//   nothing at all, which is the case worth money. It is not enough to settle
//   an argument about one invoice, and it does not pretend to be.
//
//   **Unmatched in either direction is a question, not a verdict.** A purchase
//   with no 2B row might be a vendor who has not filed, or one whose name is
//   spelt differently in two places. A 2B row with no purchase might be a bill
//   nobody entered, or somebody else's invoice raised against your GSTIN, which
//   is worth knowing for an entirely different reason.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// How far two tax figures may differ and still be the same invoice. A rupee,
// because rounding between a portal and a ledger is real and a hundred rupees
// is a different invoice.
export const TOLERANCE = 1

// Vendor names are typed by people. "Shakti Steel & Alloys Pvt. Ltd." and
// "SHAKTI STEEL AND ALLOYS PRIVATE LIMITED" are one vendor, and a match that
// insists they are two finds nothing.
const SUFFIXES = /\b(private|pvt|limited|ltd|llp|inc|co|company|corporation|corp|enterprises|traders|and)\b/g
export function vendorKey(name) {
  return String(name || '')
    .toLowerCase()
    // `&` goes with the punctuation, not the words: it is not a word character,
    // so `\band\b` never reached it and "Shakti Steel & Alloys" kept an
    // ampersand that "Shakti Steel and Alloys" did not — one vendor, two keys,
    // and nothing reconciled.
    .replace(/[.,'"()\-/&]/g, ' ')
    .replace(SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const monthOf = (d) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(d || ''))
  return m ? `${m[1]}-${m[2]}` : null
}

// The portal's download, in whatever shape it arrived.
//
// Accepts an array of objects already parsed from JSON, or CSV text. Headers
// are matched loosely because the portal's own column names change between
// downloads and every accountant's spreadsheet renames them again.
const HEADERS = {
  gstin: /gstin|supplier.*gst|ctin/i,
  vendor: /trade.?name|legal.?name|supplier|vendor|party/i,
  invoice: /invoice.?(no|number)|bill.?(no|number)|doc.*no/i,
  date: /invoice.?date|bill.?date|^date$|doc.*date/i,
  taxable: /taxable/i,
  igst: /igst/i,
  cgst: /cgst/i,
  sgst: /sgst|utgst/i,
  tax: /total.?tax|tax.?amount|^tax$/i,
}

const splitCsvLine = (line) => {
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1 }
      else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

export function parse2B(input) {
  const rows = Array.isArray(input) ? input : null
  let records = rows
  if (!records) {
    const lines = String(input || '').split(/\r?\n/).filter((l) => l.trim())
    if (lines.length < 2) return []
    // The portal puts a title row above the headers often enough that guessing
    // the first line is the header produces a file of nothing.
    let headerAt = 0
    for (let i = 0; i < Math.min(lines.length, 8); i += 1) {
      const cells = splitCsvLine(lines[i])
      if (cells.filter((c) => HEADERS.gstin.test(c) || HEADERS.taxable.test(c) || HEADERS.vendor.test(c)).length >= 2) {
        headerAt = i
        break
      }
    }
    const header = splitCsvLine(lines[headerAt])
    records = lines.slice(headerAt + 1).map((line) => {
      const cells = splitCsvLine(line)
      return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']))
    })
  }

  // "GSTIN of supplier" matches the vendor pattern as well as the GSTIN one,
  // and taking the first header that matches put the tax number in the name
  // column — so every vendor was unrecognisable and nothing reconciled. A
  // column that is already something more specific is not a candidate.
  const MORE_SPECIFIC = { vendor: ['gstin', 'invoice'], date: ['invoice'], tax: ['igst', 'cgst', 'sgst', 'taxable'] }
  const pick = (record, which) => {
    const others = (MORE_SPECIFIC[which] || []).map((o) => HEADERS[o])
    const key = Object.keys(record).find((k) => HEADERS[which].test(k) && !others.some((re) => re.test(k)))
    return key === undefined ? '' : record[key]
  }
  const num = (v) => {
    const n = Number(String(v ?? '').replace(/[₹,\s]/g, ''))
    return Number.isFinite(n) ? n : 0
  }

  return records
    .map((r) => {
      const igst = num(pick(r, 'igst'))
      const cgst = num(pick(r, 'cgst'))
      const sgst = num(pick(r, 'sgst'))
      const stated = num(pick(r, 'tax'))
      return {
        gstin: String(pick(r, 'gstin') || '').trim().toUpperCase(),
        vendor: String(pick(r, 'vendor') || '').trim(),
        invoice: String(pick(r, 'invoice') || '').trim(),
        date: normaliseDate(pick(r, 'date')),
        taxable: round2(num(pick(r, 'taxable'))),
        // The parts when they are given, the stated total when they are not.
        // Adding a stated total to its own components would double every row.
        tax: round2(igst + cgst + sgst > 0 ? igst + cgst + sgst : stated),
      }
    })
    .filter((r) => r.vendor || r.gstin)
    .filter((r) => r.tax > 0 || r.taxable > 0)
}

// The portal writes dates as DD-MM-YYYY; the app works in ISO throughout.
export function normaliseDate(value) {
  const s = String(value || '').trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s)
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`
  return ''
}

// The books against the portal.
export function reconcile2B(statement = [], expenses = [], {
  entityId = null, month = null, tolerance = TOLERANCE,
} = {}) {
  const mine = expenses
    .filter((e) => !e.deleted_at)
    .filter((e) => !entityId || e.entity_id === entityId)
    .filter((e) => (Number(e.tax) || 0) > 0)
    .filter((e) => !month || monthOf(e.date) === month)
    .map((e) => ({ expense: e, key: vendorKey(e.vendor), tax: round2(e.tax), month: monthOf(e.date) }))

  const filed = statement
    .filter((r) => !month || monthOf(r.date) === month)
    .map((r) => ({ row: r, key: vendorKey(r.vendor), tax: round2(r.tax) }))

  // Greedy, closest first. A vendor with three invoices in a month is the
  // ordinary case, and pairing them in file order would report two mismatches
  // where there are none.
  const takenBooks = new Set()
  const takenFiled = new Set()
  const matched = []
  const pairs = []
  for (let i = 0; i < mine.length; i += 1) {
    for (let j = 0; j < filed.length; j += 1) {
      if (mine[i].key !== filed[j].key || !mine[i].key) continue
      const gap = Math.abs(mine[i].tax - filed[j].tax)
      if (gap > tolerance) continue
      pairs.push({ i, j, gap })
    }
  }
  pairs.sort((a, b) => a.gap - b.gap)
  for (const { i, j, gap } of pairs) {
    if (takenBooks.has(i) || takenFiled.has(j)) continue
    takenBooks.add(i)
    takenFiled.add(j)
    matched.push({ expense: mine[i].expense, row: filed[j].row, gap: round2(gap) })
  }

  const missing = mine.filter((_, i) => !takenBooks.has(i))
  const extra = filed.filter((_, j) => !takenFiled.has(j))

  // Per vendor, because that is who gets the phone call.
  const vendors = new Map()
  const bump = (key, name, field, amount) => {
    if (!vendors.has(key)) vendors.set(key, { key, vendor: name, matched: 0, atRisk: 0, unrecorded: 0, invoices: 0 })
    const v = vendors.get(key)
    v[field] = round2(v[field] + amount)
    v.invoices += 1
    if (!v.vendor && name) v.vendor = name
  }
  for (const m of matched) bump(vendorKey(m.expense.vendor), m.expense.vendor, 'matched', round2(m.expense.tax))
  for (const m of missing) bump(m.key, m.expense.vendor, 'atRisk', m.tax)
  for (const e of extra) bump(e.key, e.row.vendor, 'unrecorded', e.tax)

  const sum = (rows, pick) => round2(rows.reduce((t, r) => t + (pick(r) || 0), 0))
  return {
    month,
    matched,
    // Recorded, taxed, and nowhere in the portal. This is the money.
    missing: missing.map((m) => ({ expense: m.expense, tax: m.tax })),
    // In the portal and not in the books: a bill nobody entered, or somebody
    // else's invoice raised against this GSTIN. Two very different problems and
    // both worth a look.
    extra: extra.map((e) => ({ row: e.row, tax: e.tax })),
    matchedTax: sum(matched, (m) => Number(m.expense.tax) || 0),
    atRisk: sum(missing, (m) => m.tax),
    unrecordedTax: sum(extra, (e) => e.tax),
    counts: { matched: matched.length, missing: missing.length, extra: extra.length, books: mine.length, filed: filed.length },
    vendors: [...vendors.values()].sort((a, b) => b.atRisk - a.atRisk || b.unrecorded - a.unrecorded),
    // Nothing to reconcile against is not a clean bill of health.
    empty: filed.length === 0,
  }
}

export function describe2B(result) {
  if (!result) return ''
  if (result.empty) return 'No 2B loaded, so nothing has been checked.'
  if (result.atRisk <= 0 && result.unrecordedTax <= 0) return 'Every purchase on file appears in 2B, and every 2B line is in the books.'
  const bits = []
  if (result.atRisk > 0) bits.push(`${result.counts.missing} purchase${result.counts.missing === 1 ? '' : 's'} with no 2B line`)
  if (result.unrecordedTax > 0) bits.push(`${result.counts.extra} 2B line${result.counts.extra === 1 ? '' : 's'} not in the books`)
  return `${bits.join(' and ')}.`
}
