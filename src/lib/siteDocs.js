// The papers that get signed.
//
// Everything else in this app is a screen. These are documents: a payment
// certificate an engineer signs and hands to accounts, a demand letter that
// actually collects money from a flat buyer, a measurement sheet a contractor
// argues with, a stock statement somebody carries round a yard with a pen.
// They leave the building, and a screenshot of a table is not one of them.
//
// The content and the arithmetic live here and are pure, because that is where
// a mistake costs something — a certificate that demands the wrong figure is a
// payment made twice. Rendering is a thin shell over this, and one shape covers
// every document so there is one renderer rather than six.

import { billLadder } from './subcontract'
import { unitLedger } from './sales'
import { stockReport, reorderList } from './inventory'
import { siteProgress } from './progress'
import { labourReport, TRADES } from './labour'

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// ── Rupees in words ──────────────────────────────────────────────
//
// Every payment document in India carries the amount twice, once in figures and
// once in words, and the words are what a bank reads when the two disagree. So
// this is not decoration — it is the authoritative half.
//
// Indian grouping, not international: after the first thousand the groups are
// two digits, so 1,750,000 is seventeen lakh fifty thousand and never one
// million seven hundred and fifty thousand.
const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

const under100 = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`)
const under1000 = (n) =>
  n < 100 ? under100(n) : `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${under100(n % 100)}` : ''}`

export function rupeesInWords(amount) {
  const value = Math.abs(round2(amount))
  const whole = Math.floor(value)
  const paise = Math.round((value - whole) * 100)
  if (whole === 0 && paise === 0) return 'Rupees Zero Only'

  const parts = []
  const crore = Math.floor(whole / 10000000)
  const lakh = Math.floor((whole % 10000000) / 100000)
  const thousand = Math.floor((whole % 100000) / 1000)
  const rest = whole % 1000
  if (crore) parts.push(`${under1000(crore)} Crore`)
  if (lakh) parts.push(`${under1000(lakh)} Lakh`)
  if (thousand) parts.push(`${under1000(thousand)} Thousand`)
  if (rest) parts.push(under1000(rest))

  const sign = amount < 0 ? 'Minus ' : ''
  const rupees = parts.length ? parts.join(' ') : 'Zero'
  // Paise are named and not dropped. A certificate rounded to the rupee is a
  // certificate that does not tie to the bill it is paying.
  return paise
    ? `${sign}Rupees ${rupees} and ${under100(paise)} Paise Only`
    : `${sign}Rupees ${rupees} Only`
}

// ── The shape every document takes ───────────────────────────────
const doc = ({ kind, title, reference = '', date, company = {}, to = null, meta = [], sections = [], notes = [], signatures = [], total = null }) => ({
  kind,
  title,
  reference,
  date: date || new Date().toISOString().slice(0, 10),
  company: { name: company.name || 'Company', gstin: company.gstin || '', address: company.address || '' },
  to,
  meta: meta.filter((m) => m && m.value !== '' && m.value !== null && m.value !== undefined),
  sections,
  notes: notes.filter(Boolean),
  // Who puts their name to it. A document that leaves the building without a
  // line for a signature is a document somebody has to re-make by hand.
  signatures,
  total,
})

const money = (n) => round2(n)

// ── Payment certificate ──────────────────────────────────────────
//
// The one document here with legal weight. It says what has been measured, what
// was certified before, and therefore what is payable now — and getting that
// subtraction wrong pays a contractor for the same work twice.
export function paymentCertificate(order, bills, { company = {}, billId = null, asOf = null } = {}) {
  const ladder = billLadder(order, bills)
  const line = billId ? ladder.lines.find((l) => l.bill.id === billId) : ladder.lines[ladder.lines.length - 1]
  if (!line) return null
  const previous = round2(line.certifiedToDate - line.gross)

  return doc({
    kind: 'certificate',
    title: `Payment certificate — RA ${line.bill.number}`,
    reference: order.ref || `${order.contractor} / RA ${line.bill.number}`,
    date: line.bill.date,
    company,
    to: { name: order.contractor, address: order.scope || '' },
    meta: [
      { label: 'Work order value', value: money(order.order_value) },
      { label: 'Scope', value: order.scope },
      { label: 'Bill number', value: `RA ${line.bill.number}` },
      { label: 'Certified to date', value: money(line.certifiedToDate) },
      { label: 'Previously certified', value: money(previous) },
    ],
    sections: [{
      title: 'This certificate',
      columns: ['', 'Amount'],
      rows: [
        ['Work certified to date', money(line.certifiedToDate)],
        ['Less previously certified', money(previous)],
        ['Value of this bill', money(line.gross)],
        [`Less retention at ${order.retention_percent}%`, money(line.retention)],
        [`Less TDS at ${order.tds_percent}%`, money(line.tds)],
        ...(line.bill.advance_recovered ? [['Less advance recovered', money(line.bill.advance_recovered)]] : []),
        ...(line.bill.material_recovered ? [['Less material issued', money(line.bill.material_recovered)]] : []),
        ...(line.bill.penalty ? [['Less penalty', money(line.bill.penalty)]] : []),
      ],
      totals: [['Net payable', money(line.net)]],
    }],
    notes: [
      `Net payable: ${rupeesInWords(line.net)}`,
      line.overClaimed ? 'This bill certifies more than was claimed. It should not be paid until that is explained.' : '',
      line.negative ? 'This bill certifies less than the one before it. The net payable is negative — it is a recovery, not a payment.' : '',
      line.overOrder ? 'Work certified to date is past the order value. Extra work needs approving separately.' : '',
      ladder.retentionHeld > 0 ? `Retention held to date: ${money(ladder.retentionHeld)}. Due for release on completion of the defect liability period.` : '',
    ],
    signatures: [{ label: 'Measured by' }, { label: 'Certified by' }, { label: 'Approved by' }],
    total: money(line.net),
  })
}

// ── Demand letter ────────────────────────────────────────────────
//
// What actually collects money. A construction-linked instalment falls due
// because the building reached a stage, so the letter says which stage — that
// sentence is the difference between a demand a buyer pays and one they query.
export function demandLetter(unit, stages, receipts, { company = {}, progressStages = [], asOf = null, dueInDays = 15 } = {}) {
  const ledger = unitLedger(unit, stages, receipts, { progressStages, asOf })
  const outstanding = ledger.lines.filter((l) => l.due && l.outstanding > 0)
  if (!outstanding.length) return null

  const payBy = new Date(Date.parse(`${asOf || new Date().toISOString().slice(0, 10)}T00:00:00Z`) + dueInDays * 86400000)
    .toISOString().slice(0, 10)

  return doc({
    kind: 'demand',
    title: `Demand for payment — ${unit.name}`,
    reference: `${unit.tower ? `${unit.tower}/` : ''}${unit.name}`,
    date: asOf || undefined,
    company,
    to: { name: unit.buyer || 'The Allottee', address: `${unit.name}${unit.tower ? `, Tower ${unit.tower}` : ''}${unit.floor !== null && unit.floor !== undefined ? `, Floor ${unit.floor}` : ''}` },
    meta: [
      { label: 'Unit', value: unit.name },
      { label: 'Configuration', value: unit.configuration },
      { label: 'Carpet area', value: unit.carpet_area || '' },
      { label: 'Agreed consideration', value: money(ledger.agreed) },
      { label: 'Received to date', value: money(ledger.received) },
    ],
    sections: [{
      title: 'Now due',
      columns: ['Instalment', 'Falls due on', 'Amount', 'Outstanding'],
      rows: outstanding.map((l) => [
        l.stage.label,
        l.stage.work_stage ? `completion of ${l.stage.work_stage}` : l.stage.due_on || 'on demand',
        money(l.amount),
        money(l.outstanding),
      ]),
      totals: [['Total now payable', money(ledger.dueNow)]],
    }],
    notes: [
      `Total now payable: ${rupeesInWords(ledger.dueNow)}`,
      `Kindly remit by ${payBy}.`,
      ledger.overdue > 0 ? `Of this, ${money(ledger.overdue)} was already past its date.` : '',
      // Said plainly, because a buyer asked for money reads this line first.
      ledger.notYetDue > 0 ? `A further ${money(ledger.notYetDue)} remains under the payment plan and is not demanded here.` : '',
    ],
    signatures: [{ label: 'For ' + (company.name || 'the company') }],
    total: money(ledger.dueNow),
  })
}

// ── Measurement sheet ────────────────────────────────────────────
// What a contractor's bill is checked against, and what they argue with.
export function measurementSheet(project, items, measurements, { company = {}, asOf = null } = {}) {
  const progress = siteProgress(items.filter((i) => i.project_id === project.id), measurements)
  if (!progress.count) return null

  return doc({
    kind: 'measurement',
    title: `Measurement sheet — ${project.name}`,
    reference: project.code || project.name,
    date: asOf || undefined,
    company,
    to: { name: project.client || '', address: project.site_address || '' },
    meta: [
      { label: 'Site', value: project.name },
      { label: 'Schedule value', value: money(progress.value) },
      { label: 'Value of work done', value: money(progress.earned) },
      { label: 'Progress by value', value: progress.percent === null ? '' : `${progress.percent}%` },
    ],
    sections: progress.stages.map((stage) => ({
      title: stage.stage.label,
      columns: ['Item', 'Unit', 'Planned', 'Done', 'Rate', 'Value done'],
      rows: progress.lines
        .filter((l) => l.item.stage === stage.stage.id)
        .map((l) => [
          `${l.item.code ? `${l.item.code} ` : ''}${l.item.description}`,
          l.item.unit, l.planned, l.done, money(l.item.rate), money(l.earned),
        ]),
      totals: [['', '', '', '', '', money(stage.earned)]],
    })),
    notes: [
      `Value of work done: ${rupeesInWords(progress.earned)}`,
      progress.over > 0 ? `${progress.over} item(s) measure more than was scheduled. Either the quantity was wrong or the work was.` : '',
    ],
    signatures: [{ label: 'Measured by' }, { label: 'Checked by' }, { label: 'Contractor' }],
    total: money(progress.earned),
  })
}

// ── Stock statement ──────────────────────────────────────────────
// Carried round a yard with a pen, which is why it has a column to write in.
export function stockStatement(items, movements, { company = {}, storeName = null, asOf = null } = {}) {
  const report = stockReport(items, movements)
  if (!report.lines.length) return null
  const name = (id) => (storeName ? storeName(id) : id ? id : 'Central store')

  return doc({
    kind: 'stock',
    title: 'Stock statement',
    date: asOf || undefined,
    company,
    meta: [
      { label: 'Materials', value: report.lines.length },
      { label: 'Value in the yard', value: money(report.centralValue) },
      { label: 'Value out on sites', value: money(report.onSitesValue) },
      { label: 'Total', value: money(report.totalValue) },
    ],
    sections: report.byLocation
      .filter((loc) => loc.value !== 0 || loc.items > 0)
      .map((loc) => ({
        title: name(loc.locationId),
        // The last column is empty on purpose: whoever counts writes in it.
        columns: ['Material', 'Unit', 'On hand', 'Rate', 'Value', 'Counted'],
        rows: report.lines
          .map((line) => ({ line, at: line.byLocation.find((b) => b.locationId === loc.locationId) }))
          .filter(({ at }) => at && (at.qty !== 0 || at.value !== 0))
          .map(({ line, at }) => [line.item.name, line.item.unit, at.qty, money(at.avgCost), money(at.value), '']),
        totals: [['', '', '', '', money(loc.value), '']],
      })),
    notes: [
      `Total stock value: ${rupeesInWords(report.totalValue)}`,
      report.itemsNegative > 0 ? `${report.itemsNegative} material(s) show less than nothing somewhere. The books and a shelf disagree.` : '',
      report.rejectedValue > 0 ? `${money(report.rejectedValue)} was rejected and returned to suppliers. It is a claim, not stock.` : '',
    ],
    signatures: [{ label: 'Counted by' }, { label: 'Verified by' }],
    total: money(report.totalValue),
  })
}

// ── Muster sheet ─────────────────────────────────────────────────
// The day's labour, for signing at the gate.
export function musterSheet(muster, { company = {}, date = null, entityId = null, siteName = null } = {}) {
  const day = date || new Date().toISOString().slice(0, 10)
  const rows = muster.filter((m) => m.date === day && (!entityId || m.entity_id === entityId) && !m.deleted_at)
  if (!rows.length) return null
  const report = labourReport(rows, { entityId })
  const name = (id) => (siteName ? siteName(id) : id || 'Not booked to a site')

  return doc({
    kind: 'muster',
    title: `Muster roll — ${day}`,
    date: day,
    company,
    meta: [
      { label: 'Head-days', value: report.headDays },
      { label: 'Skilled', value: report.skilledDays },
      { label: 'Unskilled', value: report.unskilledDays },
      { label: 'Wage bill', value: money(report.total) },
    ],
    sections: [{
      title: 'Attendance',
      columns: ['Trade', 'Site', 'Heads', 'Rate', 'Overtime', 'Amount', 'Signature'],
      rows: rows.map((m) => [
        TRADES[m.trade]?.label || m.trade,
        name(m.project_id),
        m.headcount,
        money(m.rate),
        money((Number(m.overtime_hours) || 0) * (Number(m.overtime_rate) || 0)),
        money(m.headcount * m.rate + (Number(m.overtime_hours) || 0) * (Number(m.overtime_rate) || 0)),
        '',
      ]),
      totals: [['', '', report.headDays, '', money(report.overtime), money(report.total), '']],
    }],
    notes: [`Wage bill for the day: ${rupeesInWords(report.total)}`],
    signatures: [{ label: 'Mestri' }, { label: 'Site engineer' }],
    total: money(report.total),
  })
}

// ── Material indent ──────────────────────────────────────────────
// What the site needs, which is the reorder list with a signature on it.
export function materialIndent(items, movements, { company = {}, site = null, asOf = null } = {}) {
  const low = reorderList(items, movements)
  if (!low.length) return null

  return doc({
    kind: 'indent',
    title: `Material indent${site ? ` — ${site}` : ''}`,
    date: asOf || undefined,
    company,
    meta: [{ label: 'Materials below their level', value: low.length }],
    sections: [{
      title: 'Required',
      // Two empty columns: whoever raises the indent writes what they want, and
      // a list that only says what is low is a list somebody has to copy out.
      columns: ['Material', 'Unit', 'On hand', 'Reorder at', 'Required', 'Remarks'],
      rows: low.map((l) => [l.item.name, l.item.unit, l.qty, l.item.reorder_level, '', l.negative ? 'Stock shows negative' : '']),
    }],
    notes: [
      low.some((l) => l.negative)
        ? 'Some of these show less than nothing on the books. Count them before ordering.'
        : '',
    ],
    signatures: [{ label: 'Raised by' }, { label: 'Approved by' }],
  })
}

export const DOCUMENTS = {
  certificate: { id: 'certificate', label: 'Payment certificate' },
  demand: { id: 'demand', label: 'Demand letter' },
  measurement: { id: 'measurement', label: 'Measurement sheet' },
  stock: { id: 'stock', label: 'Stock statement' },
  muster: { id: 'muster', label: 'Muster roll' },
  indent: { id: 'indent', label: 'Material indent' },
}
