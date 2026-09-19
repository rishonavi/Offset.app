// What materials cost, who quoted it, and whether the company is still paying
// last year's price.
//
// On a construction job the rate is not a detail of the purchase — it *is* the
// job. Steel moving from ₹52 to ₹61 a kilo turns a 9% margin into a loss on a
// tower costed eight months earlier, and the loss is invisible until the last
// invoice lands. So two records are kept and compared:
//
//   **What was paid.** Every stock receipt carries the rate it came in at. That
//   is a fact, not an intention, and it is the honest price history.
//
//   **What is quoted.** Vendors quote before they deliver. A quotation is worth
//   keeping even when it is declined, because three quotes for the same material
//   are how anyone knows the accepted one was reasonable.
//
// A quote expires by the calendar, not by anyone marking it so. `quoteState`
// derives that, because a stored "expired" flag is wrong the morning after
// nobody ran the job that sets it.

import { round2, UNITS } from './inventory'
import { todayISO } from './today'

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)

// Where a quotation stands. `expired` is absent on purpose — it is derived.
export const QUOTE_STATUS = {
  draft: { id: 'draft', label: 'Draft', live: false },
  sent: { id: 'sent', label: 'Awaiting', live: true },
  accepted: { id: 'accepted', label: 'Accepted', live: true },
  declined: { id: 'declined', label: 'Declined', live: false },
}
export const QUOTE_STATUS_IDS = Object.keys(QUOTE_STATUS)

// GST as the trade charges it. Cement at 28% and sand at 5% are not a rounding
// difference on a ₹2 crore job, and a comparison that ignores tax can rank the
// dearer quote first.
export const GST_RATES = [0, 5, 12, 18, 28]
export const DEFAULT_GST = 18

// Accepts both shapes: what a form hands in (`itemId`, `gstPercent`) and what a
// stored quote reads back as (`item_id`, `gst_percent`). Without that, re-making
// a saved quote would quietly drop every line's material and reset its tax rate
// to the default — the line would still be there, still look right, and be for
// nothing at 18%.
export function makeQuoteLine(input = {}) {
  const {
    id, itemId = input.item_id ?? null, name = '', qty = 1, rate = 0, unit = 'pcs',
    gstPercent = input.gst_percent ?? DEFAULT_GST, note = '',
  } = input
  return {
    id: id || newId(),
    item_id: itemId,
    // The name is kept alongside the id because a vendor quotes for things the
    // company has never stocked, and refusing those would make the quote
    // useless exactly when it is most useful.
    name: String(name || '').trim().slice(0, 120),
    qty: Math.max(0, round2(qty)),
    rate: Math.max(0, round2(rate)),
    unit: UNITS.includes(unit) ? unit : 'pcs',
    gst_percent: GST_RATES.includes(Number(gstPercent)) ? Number(gstPercent) : DEFAULT_GST,
    note: String(note).trim().slice(0, 160),
  }
}

// Tolerant of a stored row for the same reason `makeQuoteLine` is.
export function makeQuote(input = {}) {
  const {
    id, entityId = input.entity_id, vendor = '', contact = '', date,
    validUntil = input.valid_until ?? '', projectId = input.project_id ?? null,
    lines = [], status = 'draft', notes = '', ref = '', createdBy = input.created_by ?? null,
    receivedAt = input.received_at ?? '',
  } = input
  return {
    id: id || newId(),
    entity_id: entityId,
    vendor: String(vendor || '').trim().slice(0, 120) || 'Unnamed vendor',
    contact: String(contact).trim().slice(0, 80),
    date: date || todayISO(),
    // A quote with no validity never expires, which is how vendors write them
    // and is not this module's problem to invent.
    valid_until: validUntil || null,
    project_id: projectId || null,
    lines: lines.map((l) => makeQuoteLine(l)),
    status: QUOTE_STATUS[status] ? status : 'draft',
    // When the delivery was taken against this quotation, and the reason it is
    // on the maker rather than only on the update that sets it: a reader that
    // re-makes a stored quote would otherwise hand back a row with the stamp
    // missing, and the guard against receiving the same delivery twice would
    // come undone the moment anything round-tripped it.
    received_at: receivedAt || null,
    notes: String(notes).trim().slice(0, 500),
    ref: String(ref).trim().slice(0, 60),
    created_by: createdBy,
    created_at: new Date().toISOString(),
  }
}

export function quoteTotals(quote) {
  const lines = quote?.lines || []
  let subtotal = 0
  let tax = 0
  for (const l of lines) {
    const base = (Number(l.qty) || 0) * (Number(l.rate) || 0)
    subtotal += base
    tax += base * ((Number(l.gst_percent) || 0) / 100)
  }
  return {
    lines: lines.length,
    subtotal: round2(subtotal),
    tax: round2(tax),
    total: round2(subtotal + tax),
  }
}

// Where a quote stands today. Expiry beats everything except a decision already
// taken: an accepted quote that has since run out of validity is still the one
// the company accepted, and showing it as "expired" would erase that.
export function quoteState(quote, asOf = null) {
  const status = QUOTE_STATUS[quote?.status] ? quote.status : 'draft'
  if (status === 'accepted' || status === 'declined') return status
  const day = asOf || todayISO()
  if (quote?.valid_until && quote.valid_until < day) return 'expired'
  return status
}

export const QUOTE_STATE_LABELS = { ...Object.fromEntries(QUOTE_STATUS_IDS.map((k) => [k, QUOTE_STATUS[k].label])), expired: 'Expired' }

// A quote still worth acting on: sent or accepted, and not out of date.
export const isLiveQuote = (quote, asOf = null) => ['sent', 'accepted'].includes(quoteState(quote, asOf))

// Three quotes for the same material, side by side — the single thing a
// purchase file exists for. Rates are compared inclusive of tax, because a
// vendor quoting 5% against one quoting 18% on the same material is quoting a
// different price however similar the rate looks.
export function compareQuotes(itemId, quotes = [], { asOf = null, liveOnly = true } = {}) {
  const offers = []
  for (const q of quotes) {
    if (q?.deleted_at) continue
    if (liveOnly && !isLiveQuote(q, asOf)) continue
    for (const l of q.lines || []) {
      if (l.item_id !== itemId) continue
      const rate = Number(l.rate) || 0
      offers.push({
        quote: q,
        line: l,
        vendor: q.vendor,
        date: q.date,
        rate: round2(rate),
        landedRate: round2(rate * (1 + (Number(l.gst_percent) || 0) / 100)),
        unit: l.unit,
        accepted: q.status === 'accepted',
      })
    }
  }
  offers.sort((a, b) => a.landedRate - b.landedRate || (b.date || '').localeCompare(a.date || ''))

  const best = offers[0] || null
  const worst = offers[offers.length - 1] || null
  const spread = best && worst ? round2(worst.landedRate - best.landedRate) : 0
  return {
    offers,
    count: offers.length,
    best,
    worst,
    spread,
    // What taking the cheapest saves against the dearest, as a share. The number
    // that justifies the half hour spent collecting the other two quotes.
    spreadPercent: best && worst && worst.landedRate > 0 ? Math.round((spread / worst.landedRate) * 1000) / 10 : 0,
    // Someone accepted a quote that was not the cheapest on the table. It is
    // often defensible — delivery, credit, quality — and it should never pass
    // unnoticed.
    acceptedNotCheapest: Boolean(best && offers.some((o) => o.accepted) && !offers.find((o) => o.accepted && o.landedRate <= best.landedRate + 0.001)),
  }
}

// What the company actually paid, in order. Receipts only: an issue has no
// rate of its own, and an adjustment's rate is a valuation, not a price.
export function paidHistory(itemId, movements = []) {
  return movements
    .filter((m) => m.item_id === itemId && m.kind === 'receipt' && (Number(m.unit_cost) || 0) > 0)
    .map((m) => ({ date: m.date || '', rate: round2(m.unit_cost), qty: round2(m.qty), vendor: m.vendor || '', ref: m.ref || '' }))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
}

// The price list: for every material, what it last cost and what it would cost
// now. Two columns and one comparison, which is the entire question.
export function priceList(items = [], movements = [], quotes = [], { asOf = null } = {}) {
  const rows = items.map((item) => {
    const paid = paidHistory(item.id, movements)
    const last = paid[paid.length - 1] || null
    const first = paid[0] || null
    const cmp = compareQuotes(item.id, quotes, { asOf })

    // Against the last rate paid, not against the average: the average is a
    // valuation of the shelf and this is a question about the next purchase.
    const lastRate = last ? last.rate : null
    const bestRate = cmp.best ? cmp.best.rate : null
    const delta = lastRate !== null && bestRate !== null ? round2(bestRate - lastRate) : null

    return {
      item,
      lastRate,
      lastPaidOn: last ? last.date : null,
      lastVendor: last ? last.vendor : '',
      firstRate: first ? first.rate : null,
      // How far the rate has moved since the first time it was bought — the
      // number that explains why a job costed last year no longer adds up.
      driftPercent: first && last && first.rate > 0 ? Math.round(((last.rate - first.rate) / first.rate) * 1000) / 10 : null,
      quotes: cmp.count,
      bestRate,
      bestVendor: cmp.best ? cmp.best.vendor : '',
      spreadPercent: cmp.spreadPercent,
      delta,
      // A live quote below what was last paid. Acting on it is a decision for a
      // person; noticing it is not, and nobody notices by reading two lists.
      cheaperAvailable: delta !== null && delta < -0.001,
      savingPercent: delta !== null && lastRate > 0 ? Math.round((-delta / lastRate) * 1000) / 10 : null,
      purchases: paid.length,
    }
  })

  return {
    rows: rows.sort((a, b) => Number(b.cheaperAvailable) - Number(a.cheaperAvailable) || (b.savingPercent || 0) - (a.savingPercent || 0)),
    count: rows.length,
    cheaperAvailable: rows.filter((r) => r.cheaperAvailable).length,
    unpriced: rows.filter((r) => r.lastRate === null && r.bestRate === null).length,
    quoted: rows.filter((r) => r.quotes > 0).length,
  }
}

// Every quote on file, newest first, with its totals and its real state.
export function quoteBook(quotes = [], { asOf = null, projectId = null, vendor = null } = {}) {
  const lines = quotes
    .filter((q) => !q?.deleted_at)
    .filter((q) => !projectId || q.project_id === projectId)
    .filter((q) => !vendor || q.vendor === vendor)
    .map((q) => ({ quote: q, state: quoteState(q, asOf), totals: quoteTotals(q) }))
    .sort((a, b) => (b.quote.date || '').localeCompare(a.quote.date || ''))

  const of = (state) => lines.filter((l) => l.state === state)
  return {
    lines,
    count: lines.length,
    awaiting: of('sent').length,
    accepted: of('accepted').length,
    // Quotes that ran out while nobody decided. Each one is a purchase that now
    // has to be re-quoted, which is the cost of not having looked.
    expired: of('expired').length,
    acceptedValue: round2(of('accepted').reduce((t, l) => t + l.totals.total, 0)),
    awaitingValue: round2(of('sent').reduce((t, l) => t + l.totals.total, 0)),
  }
}

// Accepting a quote does not move stock — the material has not arrived. What it
// produces is the receipt each delivery will be booked against, pre-filled with
// the rate that was agreed, so nobody re-keys it and nobody re-keys it wrong.
export function receiptsFromQuote(quote, { entityId = null, date = null } = {}) {
  return (quote?.lines || [])
    .filter((l) => l.item_id)
    .map((l) => ({
      entityId: entityId || quote.entity_id,
      itemId: l.item_id,
      kind: 'receipt',
      qty: l.qty,
      unitCost: l.rate,
      vendor: quote.vendor,
      projectId: quote.project_id || null,
      date: date || todayISO(),
      ref: quote.ref || '',
      note: `From quote ${quote.ref || quote.vendor}`.slice(0, 200),
    }))
}
