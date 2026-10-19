import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTableImport from 'jspdf-autotable'
import { format } from 'date-fns'

// jspdf-autotable ships as CJS; under Vite's interop the default import can be
// the module wrapper rather than the function itself, so unwrap defensively.
const autoTable = autoTableImport?.default || autoTableImport
import { formatCurrency, formatDate } from './format'

// Convert expense rows (joined with a place lookup) into the flat,
// human-friendly shape used for every export format.
//
// `placeName` takes the whole row rather than an id: in a company's books a
// cost can belong to a job instead of to something the company owns, and a
// column that only knew about assets exported a dash for most of a builder's
// ledger. The column keeps its name so a spreadsheet built on last month's
// export still opens.
export function toExportRows(expenses, placeName) {
  return expenses.map((e) => ({
    Date: e.date,
    Property: placeName(e) || '—',
    Category: e.category || '',
    Vendor: e.vendor || '',
    'Payment Method': e.payment_method || '',
    Description: e.description || '',
    Amount: Number(e.amount) || 0,
    'Tax / GST': Number(e.tax) || 0,
  }))
}

// Same idea for income rows.
export function toIncomeRows(income, placeName) {
  return income.map((e) => ({
    Date: e.date,
    Property: placeName(e) || '—',
    Source: e.source || '',
    'From (payer)': e.payer || '',
    'Payment Method': e.payment_method || '',
    Description: e.description || '',
    Amount: Number(e.amount) || 0,
    'Tax / GST': Number(e.tax) || 0,
  }))
}

// Excel workbook with an Expenses sheet and (when present) an Income sheet.
export function exportWorkbook({ expenses = [], income = [] }, filename = 'offset') {
  const cols = [{ wch: 12 }, { wch: 22 }, { wch: 20 }, { wch: 18 }, { wch: 16 }, { wch: 30 }, { wch: 14 }, { wch: 12 }]
  const wb = XLSX.utils.book_new()
  const expWs = XLSX.utils.json_to_sheet(expenses)
  expWs['!cols'] = cols
  XLSX.utils.book_append_sheet(wb, expWs, 'Expenses')
  if (income.length) {
    const incWs = XLSX.utils.json_to_sheet(income)
    incWs['!cols'] = cols
    XLSX.utils.book_append_sheet(wb, incWs, 'Income')
  }
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

function sheetFromRows(rows) {
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [
    { wch: 12 }, { wch: 22 }, { wch: 20 }, { wch: 18 },
    { wch: 16 }, { wch: 30 }, { wch: 14 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Expenses')
  return wb
}

export function exportCSV(rows, filename = 'expenses') {
  XLSX.writeFile(sheetFromRows(rows), `${filename}.csv`, { bookType: 'csv' })
}

export function exportPDF(rows, { title = 'Expense Report', subtitle = '' } = {}) {
  const doc = new jsPDF()
  doc.setFontSize(16)
  doc.setTextColor(15, 23, 42)
  doc.text(title, 14, 18)
  if (subtitle) {
    doc.setFontSize(10)
    doc.setTextColor(100, 116, 139)
    doc.text(subtitle, 14, 25)
  }
  const total = rows.reduce((s, r) => s + (Number(r.Amount) || 0), 0)
  autoTable(doc, {
    startY: subtitle ? 31 : 24,
    head: [['Date', 'Property', 'Category', 'Vendor', 'Payment', 'Amount']],
    body: rows.map((r) => [
      formatDate(r.Date),
      r.Property,
      r.Category,
      r.Vendor,
      r['Payment Method'],
      formatCurrency(r.Amount),
    ]),
    styles: { fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: [79, 70, 229], halign: 'left' },
    columnStyles: { 5: { halign: 'right' } },
    foot: [['', '', '', '', 'Total', formatCurrency(total)]],
    footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', halign: 'right' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  })
  doc.save(`${title.replace(/\s+/g, '-').toLowerCase()}.pdf`)
}

// ── Import (.xlsx / .csv) ──────────────────────────────────────────
// Returns an array of raw row objects keyed by their header cells.
// `keepBlanks` matters more than it looks. Without it the reader drops empty
// rows before anything else sees them, so a row reported as "line 5" is at line
// 5 of what survived rather than line 5 of the file — and the whole use of
// printing a line number is that somebody can open the sheet and go to it.
// Defaulted off, because the importers written before this counted on rows
// being dropped for them.
export async function parseSpreadsheet(file, { keepBlanks = false } = {}) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json(ws, { defval: '', blankrows: keepBlanks })
}

import { normalizeDate } from './readDate'
export { normalizeDate }

// Case-insensitive header lookup helper.
function pick(row, ...names) {
  const keys = Object.keys(row)
  for (const name of names) {
    const hit = keys.find((k) => k.trim().toLowerCase() === name.toLowerCase())
    if (hit != null) return row[hit]
  }
  return ''
}

// What a number looks like on a ledger line somebody else wrote.
//
// This used to be `Number(String(raw).replace(/[^0-9.-]/g, '')) || 0`, which
// keeps digits, dots and minus signs and throws the rest away. Measured against
// the shapes a real export actually contains:
//
//   "1,234"          -> 1234      correct
//   "₹1,23,456.78"   -> 123456.78 correct
//   "Rs. 1,234/-"    -> 0         .1234- is not a number, and this is how half
//                                 of Indian ledgers write money
//   "(1,234)"        -> 1234      a parenthesised credit, imported as a debit
//   "1e3"            -> 13        the e is stripped and 1000 becomes 13
//   "1.234,56"       -> 1.23456   a European decimal, out by a thousand
//
// And every one of those failures was silent: `ImportBills` keeps rows with
// `amount > 0`, so an unreadable figure did not import as ₹0, it vanished. Two
// hundred rows in, a hundred and ninety-five out, nothing said.
//
// So the noise is removed deliberately rather than by subtraction, the sign is
// read before it is discarded, and anything still not a plain decimal comes
// back as null — which is a thing the caller can report, unlike a zero.
const CURRENCY_NOISE = /(?:₹|rs\.?|inr|dr\.?|cr\.?|\/-)/gi

export function parseAmount(raw) {
  if (raw == null) return null
  let text = String(raw).trim()
  if (!text) return null

  // An accounting negative is written in brackets, and dropping them turned a
  // credit into a debit.
  let sign = 1
  if (/^\(.*\)$/.test(text)) {
    sign = -1
    text = text.slice(1, -1).trim()
  }
  text = text.replace(CURRENCY_NOISE, '').trim()
  if (text.startsWith('-')) {
    sign = -sign
    text = text.slice(1).trim()
  }
  // Every kind of space, including the non-breaking and thin ones a
  // spreadsheet exports.
  text = text.replace(/[\s\u00a0\u202f\u2009]/g, '')

  // Whichever separator comes last is the decimal one: that reads both
  // "1,234.56" and "1.234,56" correctly without having to know the locale.
  const lastComma = text.lastIndexOf(',')
  const lastDot = text.lastIndexOf('.')
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? ',' : '.'
    const thousands = decimal === ',' ? '.' : ','
    text = text.split(thousands).join('')
    text = text.replace(decimal, '.')
  } else if (lastComma >= 0) {
    // Commas alone are read as thousands, which is the Indian convention and
    // the one this app is for. "1,23" is genuinely ambiguous and goes the same
    // way; a European sheet with no decimal part reads a little large rather
    // than silently vanishing.
    text = text.split(',').join('')
  }

  // Strict, because this is the point of the whole function: what is left must
  // be a number and nothing else. "1.2.3", "--5" and "1e3" are not, and saying
  // so is more use than guessing.
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null
  const value = Number(text)
  return Number.isFinite(value) ? sign * value : null
}

// Map a parsed spreadsheet row to our expense field shape. `amount` is null
// where the figure could not be read, which the caller reports rather than
// dropping in silence.
export function rowToExpenseInput(row) {
  const amountRaw = pick(row, 'Amount', 'Cost', 'Value', 'Total')
  return {
    date: normalizeDate(pick(row, 'Date', 'Expense Date', 'Paid On')),
    property: String(pick(row, 'Property', 'Property Name', 'Project') || '').trim(),
    category: String(pick(row, 'Category', 'Type') || '').trim(),
    vendor: String(pick(row, 'Vendor', 'Payee', 'Supplier') || '').trim(),
    payment_method: String(pick(row, 'Payment Method', 'Payment', 'Mode') || '').trim(),
    description: String(pick(row, 'Description', 'Notes', 'Note', 'Details') || '').trim(),
    amount: parseAmount(amountRaw),
    amount_text: String(amountRaw ?? '').trim(),
  }
}
