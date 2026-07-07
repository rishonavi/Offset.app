import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTableImport from 'jspdf-autotable'
import { format, parseISO, isValid } from 'date-fns'

// jspdf-autotable ships as CJS; under Vite's interop the default import can be
// the module wrapper rather than the function itself, so unwrap defensively.
const autoTable = autoTableImport?.default || autoTableImport
import { formatCurrency, formatDate } from './format'

// Convert expense rows (joined with a property-name lookup) into the
// flat, human-friendly shape used for every export format.
export function toExportRows(expenses, propertyNameById) {
  return expenses.map((e) => ({
    Date: e.date,
    Property: propertyNameById(e.property_id) || '—',
    Category: e.category || '',
    Vendor: e.vendor || '',
    'Payment Method': e.payment_method || '',
    Description: e.description || '',
    Amount: Number(e.amount) || 0,
    'Tax / GST': Number(e.tax) || 0,
  }))
}

// Same idea for income rows.
export function toIncomeRows(income, propertyNameById) {
  return income.map((e) => ({
    Date: e.date,
    Property: propertyNameById(e.property_id) || '—',
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
export async function parseSpreadsheet(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json(ws, { defval: '' })
}

// Normalise an arbitrary cell value into a yyyy-MM-dd string.
export function normalizeDate(value) {
  if (!value) return ''
  if (value instanceof Date) return isValid(value) ? format(value, 'yyyy-MM-dd') : ''
  const s = String(value).trim()
  // Excel serial number
  if (/^\d{5}$/.test(s)) {
    const d = new Date(Math.round((Number(s) - 25569) * 86400 * 1000))
    return isValid(d) ? format(d, 'yyyy-MM-dd') : ''
  }
  const iso = parseISO(s)
  if (isValid(iso)) return format(iso, 'yyyy-MM-dd')
  const fallback = new Date(s)
  return isValid(fallback) ? format(fallback, 'yyyy-MM-dd') : ''
}

// Case-insensitive header lookup helper.
function pick(row, ...names) {
  const keys = Object.keys(row)
  for (const name of names) {
    const hit = keys.find((k) => k.trim().toLowerCase() === name.toLowerCase())
    if (hit != null) return row[hit]
  }
  return ''
}

// Map a parsed spreadsheet row to our expense field shape.
export function rowToExpenseInput(row) {
  const amountRaw = pick(row, 'Amount', 'Cost', 'Value', 'Total')
  return {
    date: normalizeDate(pick(row, 'Date', 'Expense Date', 'Paid On')),
    property: String(pick(row, 'Property', 'Property Name', 'Project') || '').trim(),
    category: String(pick(row, 'Category', 'Type') || '').trim(),
    vendor: String(pick(row, 'Vendor', 'Payee', 'Supplier') || '').trim(),
    payment_method: String(pick(row, 'Payment Method', 'Payment', 'Mode') || '').trim(),
    description: String(pick(row, 'Description', 'Notes', 'Note', 'Details') || '').trim(),
    amount: Number(String(amountRaw).replace(/[^0-9.-]/g, '')) || 0,
  }
}
