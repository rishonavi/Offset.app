// Tax deducted at source on what the company pays out.
//
// A work order already carries a `tds_percent` and the bill ladder already
// applies it. What nothing has ever done is check that figure against what the
// law actually requires — and the law does not ask about one order, it asks
// about one **deductee** across one financial year.
//
// That is the whole point of this module, and the mistake it exists to catch:
// a contractor paid ₹28,000 on one order, ₹34,000 on another and ₹41,000 on a
// third has crossed the ₹1,00,000 aggregate under 194C. Every order is
// individually under the single-payment limit, every order looks fine on its
// own screen, and the company is short of its deduction on all three. Nobody
// finds this until a notice arrives, because finding it means adding up a
// vendor's name across a year.
//
// Three things stated plainly, because a tax module that overstates its
// confidence is worse than none:
//
//   **This is the contractor sections, not a tax engine.** 194C on work and
//   194Q on goods. Salary TDS is deliberately absent here for the same reason
//   `payroll.js` refuses it: it depends on declared investments and projected
//   annual income, and guessing is worse than asking.
//
//   **The deductee's status changes the rate**, not the threshold. One per cent
//   for an individual or HUF and two for anybody else, and twenty where there
//   is no PAN — which is a penalty rate, not a bracket.
//
//   **Crossing the annual limit is retrospective.** The payment that crosses it
//   carries deduction on *everything paid that year*, not on the excess. A
//   module that deducted on the excess would be short by the first ninety-nine
//   thousand, which is the sort of arithmetic a notice is made of.
import { round2, billLadder, sideOf } from './subcontract'
import { madeOf } from './certainty'
import { todayISO } from './today'

// The sections this covers, with the limits as they stand.
export const SECTIONS = {
  '194C': {
    id: '194C',
    label: 'Payments to contractors',
    // A single credit at or above this attracts deduction on its own.
    singleLimit: 30000,
    // And the year's total at or above this attracts it on everything.
    annualLimit: 100000,
    rates: { individual: 1, other: 2 },
    noPanRate: 20,
  },
  '194Q': {
    id: '194Q',
    label: 'Purchase of goods',
    singleLimit: null,
    annualLimit: 5000000,
    // On the amount above the limit, not on the whole — which is the opposite
    // of 194C, and the reason `onExcess` is a property rather than an
    // assumption.
    onExcess: true,
    rates: { individual: 0.1, other: 0.1 },
    noPanRate: 5,
  },
}
export const SECTION_IDS = Object.keys(SECTIONS)

// Who is being paid. It decides the rate and nothing else.
export const DEDUCTEE = {
  individual: { id: 'individual', label: 'Individual / HUF' },
  other: { id: 'other', label: 'Company / firm / other' },
}
export const DEDUCTEE_IDS = Object.keys(DEDUCTEE)
export const deducteeOf = (order) => (DEDUCTEE[order?.deductee_type] ? order.deductee_type : 'other')

// A PAN is ten characters: five letters, four digits, a letter. Checked because
// a blank and a typo have the same consequence here — deduction at twenty per
// cent — and only one of them is a decision.
export const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/
export const hasPan = (order) => PAN.test(String(order?.pan || '').trim().toUpperCase())

// The financial year a date falls in, for a company whose year starts in
// `fyStartMonth`. April by default, which is what every Indian company uses and
// what `makeEntity` already defaults to.
export function fyOf(dateISO, fyStartMonth = 4) {
  const m = /^(\d{4})-(\d{2})/.exec(String(dateISO || ''))
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const start = month >= fyStartMonth ? year : year - 1
  return { start, end: start + 1, label: `${String(start).slice(2)}-${String(start + 1).slice(2)}` }
}

export function fyRange(fy, fyStartMonth = 4) {
  const pad = (n) => String(n).padStart(2, '0')
  const from = `${fy.start}-${pad(fyStartMonth)}-01`
  // The day before the same date a year later, so a year that starts in April
  // ends on the 31st of March however the months are counted.
  const endMonth = fyStartMonth === 1 ? 12 : fyStartMonth - 1
  const endYear = fyStartMonth === 1 ? fy.start : fy.end
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate()
  return { from, to: `${endYear}-${pad(endMonth)}-${pad(lastDay)}` }
}

// Which quarter of the return a date belongs to. Q1 is the first three months
// of the company's year, whenever that starts.
export function quarterOf(dateISO, fyStartMonth = 4) {
  const m = /^(\d{4})-(\d{2})/.exec(String(dateISO || ''))
  if (!m) return null
  const month = Number(m[2])
  const offset = (month - fyStartMonth + 12) % 12
  return Math.floor(offset / 3) + 1
}

// What one deductee's year requires.
//
// `payments` are the amounts credited, each with a date. The order matters:
// the payment that crosses the annual limit is the one that carries deduction
// on everything before it, and a reader has to be able to see which one it was.
export function required(payments = [], {
  section = '194C', status = 'other', pan = true, fyStartMonth = 4,
} = {}) {
  const rule = SECTIONS[section] || SECTIONS['194C']
  const rate = pan ? (rule.rates[status] ?? rule.rates.other) : rule.noPanRate
  const rows = payments
    .filter((p) => Number(p.amount) > 0)
    .slice()
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))

  let running = 0
  let crossedOn = null
  let liableTotal = 0
  const lines = rows.map((p) => {
    const amount = round2(p.amount)
    const before = running
    running = round2(running + amount)

    // Liable on its own, because a single credit at the limit does not need the
    // year's total to reach anything.
    const single = rule.singleLimit !== null && amount >= rule.singleLimit
    // Or because the year has now reached the aggregate.
    const crossesNow = rule.annualLimit !== null && running >= rule.annualLimit && before < rule.annualLimit
    const alreadyOver = rule.annualLimit !== null && before >= rule.annualLimit
    if (crossesNow && !crossedOn) crossedOn = p.date || null

    let liable = 0
    if (rule.onExcess) {
      // 194Q: on the amount above the limit only.
      liable = round2(Math.max(0, running - (rule.annualLimit || 0)) - Math.max(0, before - (rule.annualLimit || 0)))
    } else if (crossesNow) {
      // The retrospective bit: everything paid this year becomes liable, not
      // the excess. Less whatever was already liable on its own — a payment
      // over the single-payment limit earlier in the year has been deducted
      // from once already, and charging it again made the liable total larger
      // than the amount paid, which is not a number that can exist.
      liable = round2(running - liableTotal)
    } else if (alreadyOver || single) {
      liable = amount
    }
    liableTotal = round2(liableTotal + liable)

    return {
      ...p,
      amount,
      runningTotal: running,
      // Why this payment is liable, or why it is not. A figure with no reason
      // beside it is a figure somebody argues with.
      reason: liable <= 0 ? 'under the limits'
        : rule.onExcess ? 'above the yearly limit'
        : crossesNow ? 'crossed the yearly limit — the whole year becomes liable'
        : alreadyOver ? 'the yearly limit was already crossed'
        : 'at or above the single-payment limit',
      liable: round2(liable),
      tds: round2(liable * (rate / 100)),
      quarter: quarterOf(p.date, fyStartMonth),
    }
  })

  return {
    section: rule.id,
    rate,
    status,
    pan,
    lines,
    paid: round2(rows.reduce((t, p) => t + round2(p.amount), 0)),
    liable: liableTotal,
    tds: round2(lines.reduce((t, l) => t + l.tds, 0)),
    crossedOn,
    // True where nothing is liable at all, which is a real answer and not an
    // error — most small suppliers never reach either limit.
    below: liableTotal <= 0,
  }
}

// Every contractor's year, against what the company actually deducted.
//
// Grouped by the contractor's name because that is the only identity a work
// order has. Named rather than silently assumed: two orders spelt differently
// are two deductees here, and that is a data problem the screen has to show
// rather than a rule this module can fix.
export function tdsLedger(orders = [], bills = [], {
  entityId = null, fyStartMonth = 4, asOf = null, section = '194C',
} = {}) {
  const day = asOf || todayISO()
  const fy = fyOf(day, fyStartMonth)
  const { from, to } = fyRange(fy, fyStartMonth)

  const mine = orders
    .filter((o) => !o.deleted_at && o.approval_status !== 'rejected')
    .filter((o) => !entityId || o.entity_id === entityId)
    // The company deducts when it pays. On a client contract it is the one
    // being deducted from, and that is somebody else's return.
    .filter((o) => sideOf(o) === 'sub')

  const byParty = new Map()
  for (const order of mine) {
    const key = String(order.contractor || '').trim().toLowerCase() || 'unnamed'
    const ladder = billLadder(order, bills)
    if (!byParty.has(key)) {
      byParty.set(key, {
        party: order.contractor, orders: [], payments: [], deducted: 0,
        status: deducteeOf(order), pan: hasPan(order),
        pans: new Set(), rates: new Set(),
      })
    }
    const row = byParty.get(key)
    row.orders.push(order)
    if (order.pan) row.pans.add(String(order.pan).trim().toUpperCase())
    row.rates.add(Number(order.tds_percent) || 0)
    // A deductee with no PAN on any one order is a deductee with no PAN.
    if (!hasPan(order)) row.pan = false
    for (const line of ladder.lines) {
      const date = line.bill.date || ''
      if (date < from || date > to) continue
      row.payments.push({ id: line.bill.id, date, amount: line.gross, order: order.id, ref: order.ref || '' })
      row.deducted = round2(row.deducted + line.tds)
    }
  }

  const lines = [...byParty.values()]
    .filter((r) => r.payments.length)
    .map((r) => {
      const need = required(r.payments, { section, status: r.status, pan: r.pan, fyStartMonth })
      const shortfall = round2(Math.max(0, need.tds - r.deducted))
      const excess = round2(Math.max(0, r.deducted - need.tds))
      const quarters = [1, 2, 3, 4].map((q) => ({
        quarter: q,
        paid: round2(need.lines.filter((l) => l.quarter === q).reduce((t, l) => t + l.amount, 0)),
        tds: round2(need.lines.filter((l) => l.quarter === q).reduce((t, l) => t + l.tds, 0)),
      }))
      return {
        party: r.party,
        orders: r.orders.length,
        status: r.status,
        pan: r.pan,
        // More than one PAN against one name is two companies filed as one, and
        // it makes every figure on the row wrong.
        panConflict: r.pans.size > 1,
        ...need,
        deducted: r.deducted,
        shortfall,
        excess,
        short: shortfall > 0.5,
        over: excess > 0.5,
        quarters,
      }
    })

  const sum = (pick, only = () => true) => round2(lines.filter(only).reduce((t, l) => t + (pick(l) || 0), 0))
  return {
    fy,
    from,
    to,
    section,
    lines: lines.sort((a, b) => b.shortfall - a.shortfall || b.paid - a.paid),
    count: lines.length,
    paid: sum((l) => l.paid),
    required: sum((l) => l.tds),
    deducted: sum((l) => l.deducted),
    // Never netted: a contractor under-deducted and another over-deducted are
    // two returns to correct, and the difference of nothing is neither.
    shortfall: sum((l) => l.shortfall),
    excess: sum((l) => l.excess),
    short: lines.filter((l) => l.short).length,
    over: lines.filter((l) => l.over).length,
    below: lines.filter((l) => l.below).length,
    noPan: lines.filter((l) => !l.pan).length,
    conflicts: lines.filter((l) => l.panConflict).length,
    // What was paid and what was deducted are facts. What is *required* is a
    // rule applied to a year that has not finished — one more bill can take a
    // contractor past the aggregate and make everything paid to him liable, so
    // the shortfall is a forecast about the return, not a debt already owed.
    certainty: madeOf({
      'what was paid': 'recorded',
      'what was deducted': 'recorded',
      'what the year will require': 'projected',
    }),
    quarters: [1, 2, 3, 4].map((q) => ({
      quarter: q,
      paid: sum((l) => l.quarters[q - 1].paid),
      tds: sum((l) => l.quarters[q - 1].tds),
    })),
  }
}
