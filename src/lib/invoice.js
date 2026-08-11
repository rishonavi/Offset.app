// Invoices: turning what's already in the ledger into a document someone can
// send. The numbers are the part that has to be right, so they live here,
// separate from the template that decides how they look.
//
// India-shaped by default, because that's what the rest of Offset assumes: GST
// splits into CGST+SGST within a state and IGST across state lines, the split
// decided by the two-digit state code at the front of a GSTIN. Leave the GSTINs
// blank and it's an ordinary invoice with no tax lines.

import { formatCurrency, formatDate } from './format'

// ── Money ──────────────────────────────────────────────────────────
// Invoice arithmetic is done in paise. 0.1 + 0.2 is a rounding curiosity in a
// chart and a wrong total on a tax document.
const paise = (rupees) => Math.round(Number(rupees || 0) * 100)
const rupees = (p) => p / 100
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// ── GST ────────────────────────────────────────────────────────────
// A GSTIN starts with the state code: 27AAAPA1234A1Z5 is Maharashtra (27).
export function stateCode(gstin) {
  const m = String(gstin || '').trim().match(/^(\d{2})/)
  return m ? m[1] : ''
}

export function isValidGSTIN(gstin) {
  return /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/i.test(String(gstin || '').trim())
}

// Same state → the tax is split half to the centre and half to the state.
// Different states, or an unknown pair → one integrated line.
export function taxKind(issuerGstin, clientGstin, placeOfSupply = '') {
  const from = stateCode(issuerGstin)
  const to = stateCode(placeOfSupply) || stateCode(clientGstin)
  if (!from || !to) return 'none'
  return from === to ? 'intra' : 'inter'
}

// ── Lines ──────────────────────────────────────────────────────────
export function lineAmount(line) {
  const qty = Number(line.qty ?? 1)
  const rate = paise(line.rate)
  return rupees(Math.round(qty * rate))
}

// The whole document: line amounts, the tax split, and a grand total that is
// the sum of what's printed rather than a separately-computed number that can
// disagree with it.
export function buildInvoice({
  number = '',
  date = new Date().toISOString().slice(0, 10),
  dueDate = '',
  period = '',
  notes = '',
  issuer = {},
  client = {},
  asset = null,
  lines = [],
  taxRate = 18,
  placeOfSupply = '',
} = {}) {
  const kind = taxKind(issuer.gstin, client.gstin, placeOfSupply)
  const rate = kind === 'none' ? 0 : Number(taxRate) || 0

  const priced = lines.map((l) => {
    const amount = lineAmount(l)
    // A line may set its own rate — a rent line at 18% and a maintenance line
    // at 5% are one invoice, not two.
    const lineRate = l.taxRate == null ? rate : Number(l.taxRate) || 0
    return {
      description: l.description || '',
      hsn: l.hsn || '',
      qty: Number(l.qty ?? 1),
      rate: round2(l.rate),
      taxRate: kind === 'none' ? 0 : lineRate,
      amount,
      tax: kind === 'none' ? 0 : rupees(Math.round(paise(amount) * lineRate) / 100),
    }
  })

  const subtotalP = priced.reduce((s, l) => s + paise(l.amount), 0)
  const taxP = priced.reduce((s, l) => s + paise(l.tax), 0)
  const totalP = subtotalP + taxP

  const half = Math.round(taxP / 2)
  const tax =
    kind === 'intra'
      ? { cgst: rupees(half), sgst: rupees(taxP - half), igst: 0 }
      : kind === 'inter'
        ? { cgst: 0, sgst: 0, igst: rupees(taxP) }
        : { cgst: 0, sgst: 0, igst: 0 }

  return {
    number,
    date,
    dueDate,
    period,
    notes,
    issuer,
    client,
    asset,
    lines: priced,
    taxKind: kind,
    taxRate: rate,
    placeOfSupply: placeOfSupply || stateCode(client.gstin),
    subtotal: rupees(subtotalP),
    ...tax,
    taxTotal: rupees(taxP),
    total: rupees(totalP),
  }
}

// ── Amount in words ────────────────────────────────────────────────
// Indian grouping — thousand, lakh, crore — because "one lakh twenty thousand"
// is what a cheque and a tax officer expect, not "one hundred twenty thousand".
const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

function underThousand(n) {
  if (n === 0) return ''
  if (n < 20) return ONES[n]
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '')
  return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' and ' + underThousand(n % 100) : '')
}

export function amountInWords(amount, currency = 'Rupees', subunit = 'paise') {
  const total = Math.abs(Math.round(Number(amount || 0) * 100))
  const whole = Math.floor(total / 100)
  const cents = total % 100

  const parts = []
  const chunks = [
    [Math.floor(whole / 10000000), 'crore'],
    [Math.floor((whole % 10000000) / 100000), 'lakh'],
    [Math.floor((whole % 100000) / 1000), 'thousand'],
    [whole % 1000, ''],
  ]
  for (const [n, label] of chunks) {
    if (!n) continue
    parts.push(underThousand(n) + (label ? ' ' + label : ''))
  }

  const head = parts.length ? parts.join(' ') : 'zero'
  const words = `${currency} ${head}` + (cents ? ` and ${underThousand(cents)} ${subunit}` : '') + ' only'
  // Sentence case: it heads a line on the document, it isn't prose.
  return (Number(amount) < 0 ? 'Minus ' : '') + words.charAt(0).toUpperCase() + words.slice(1)
}

// ── Numbering ──────────────────────────────────────────────────────
// A pattern rather than a counter, so an invoice number can carry the financial
// year the way Indian books usually want it: INV-{FY}-{0001}.
export function financialYear(dateISO) {
  const d = new Date(dateISO || Date.now())
  const y = d.getFullYear()
  // April to March.
  const start = d.getMonth() >= 3 ? y : y - 1
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`
}

export function nextNumber(pattern = 'INV-{FY}-{0001}', seq = 1, dateISO) {
  return String(pattern)
    .replace(/\{FY\}/gi, financialYear(dateISO))
    .replace(/\{YYYY\}/g, String(new Date(dateISO || Date.now()).getFullYear()))
    .replace(/\{MM\}/g, String(new Date(dateISO || Date.now()).getMonth() + 1).padStart(2, '0'))
    // {0001} sets both the counter and how many digits it is padded to.
    .replace(/\{(0+\d*)\}/g, (_, z) => String(seq).padStart(z.length, '0'))
}

// ── From the ledger ────────────────────────────────────────────────
// The point of invoicing from inside Offset rather than a separate app: the
// lines are entries that already exist.
export function linesFromIncome(rows, { propertyNameById } = {}) {
  return rows.map((r) => ({
    description: [r.source || 'Income', r.property_id && propertyNameById?.(r.property_id), r.date && formatDate(r.date)]
      .filter(Boolean)
      .join(' · '),
    qty: 1,
    rate: round2(r.amount),
    hsn: '',
  }))
}

// The flat, already-formatted view a template renders. Templates get strings,
// not maths — anything that needed deciding was decided above.
export function invoiceTokens(inv) {
  const money = (n) => formatCurrency(n)
  return {
    invoice: {
      number: inv.number || '',
      date: inv.date ? formatDate(inv.date) : '',
      due_date: inv.dueDate ? formatDate(inv.dueDate) : '',
      period: inv.period || '',
      notes: inv.notes || '',
      place_of_supply: inv.placeOfSupply || '',
    },
    issuer: {
      name: inv.issuer.name || '',
      address: inv.issuer.address || '',
      gstin: inv.issuer.gstin || '',
      pan: inv.issuer.pan || '',
      email: inv.issuer.email || '',
      phone: inv.issuer.phone || '',
      bank: inv.issuer.bank || '',
    },
    client: {
      name: inv.client.name || '',
      address: inv.client.address || '',
      gstin: inv.client.gstin || '',
      email: inv.client.email || '',
    },
    asset: { name: inv.asset?.name || '', address: inv.asset?.address || '' },
    lines: inv.lines.map((l, i) => ({
      n: String(i + 1),
      description: l.description,
      hsn: l.hsn,
      qty: String(l.qty),
      rate: money(l.rate),
      tax_rate: l.taxRate ? `${l.taxRate}%` : '',
      tax: money(l.tax),
      amount: money(l.amount),
    })),
    totals: {
      subtotal: money(inv.subtotal),
      cgst: money(inv.cgst),
      sgst: money(inv.sgst),
      igst: money(inv.igst),
      tax_total: money(inv.taxTotal),
      total: money(inv.total),
      in_words: amountInWords(inv.total),
    },
    // Flags a template can branch on, so one file covers both tax situations.
    is_intra_state: inv.taxKind === 'intra',
    is_inter_state: inv.taxKind === 'inter',
    has_tax: inv.taxKind !== 'none',
  }
}
