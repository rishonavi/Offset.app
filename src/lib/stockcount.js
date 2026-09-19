// What is actually on the shelf.
//
// Every movement in this app is a claim. A receipt says a lorry arrived, an
// issue says a bag went to the slab, and the balance that falls out of them is
// what the paperwork believes. Nobody has ever gone and looked.
//
// On an Indian site that gap is the single largest silent leak there is.
// Material does not vanish in one dramatic event; it goes a few bags at a time,
// through issues nobody wrote down and lorries that were a little short, and
// the books stay perfectly consistent the whole way. The only thing that finds
// it is somebody walking into the store with a clipboard.
//
// Three decisions worth stating:
//
//   **The count is evidence; the adjustment is the consequence.** Storing only
//   the correction loses which corrections were verified and which were
//   somebody fixing a typo — and loses the counts that found nothing, which are
//   the ones that prove a store is sound.
//
//   **A sheet is a store and a date**, not an id of its own. That is how the
//   muster roll works and how a stores clerk thinks: "the yard, on the 12th".
//
//   **The book figure is frozen into the row.** A count compared against
//   today's balance would change its own answer every time a later lorry
//   arrived, and a verification that moves is not a verification.
import { round2, stockAt, stockReport, CENTRAL, makeMovement } from './inventory'
import { todayISO } from './today'

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)

// How far out a store may be before it is worth a conversation, as a share of
// what the books say should be there.
export const DEFAULT_TOLERANCE = 2
// A store nobody has looked at in this long is a store nobody is checking.
export const STALE_DAYS = 120

export function makeStockCount({
  id, entityId, itemId, storeId = CENTRAL, date, countedQty = 0, bookQty = 0,
  avgCost = 0, note = '', countedBy = null,
} = {}) {
  const counted = Math.max(0, round2(countedQty))
  const book = round2(bookQty)
  return {
    id: id || newId(),
    entity_id: entityId,
    item_id: itemId,
    // Null is the yard, exactly as it is on a movement. A count sheet for "the
    // central store" and one for "no store" are the same sheet.
    store_id: storeId || null,
    date: date || todayISO(),
    counted_qty: counted,
    // Frozen, not derived. See the header.
    book_qty: book,
    // What the difference is worth, at what the shelf was carrying it at.
    avg_cost: Math.max(0, round2(avgCost)),
    note: String(note).trim().slice(0, 200),
    counted_by: countedBy,
    created_at: new Date().toISOString(),
  }
}

// The sheet to walk the store with: every material, what the books say is
// there, and a box to write what is. Materials the books say are absent are
// included on purpose — a bag found in a store the books say has none is the
// most interesting line on the sheet.
export function countSheet(items = [], movements = [], { storeId = CENTRAL, asOf = null, entityId = null } = {}) {
  const day = asOf || todayISO()
  const upto = movements.filter((m) => !m.deleted_at && String(m.date || '') <= day)
  return items
    .filter((i) => !i.deleted_at)
    .filter((i) => !entityId || i.entity_id === entityId)
    .map((item) => {
      const at = stockAt(item, upto, storeId || CENTRAL)
      return {
        item,
        storeId: storeId || null,
        bookQty: round2(at.qty),
        avgCost: round2(at.avgCost),
        value: round2(at.value),
        // A store the books say is empty of this. Kept rather than filtered,
        // because a shelf with twelve bags on it that the books do not know
        // about is the line worth walking over to.
        empty: Math.abs(at.qty) < 0.001,
      }
    })
    .sort((a, b) => Number(a.empty) - Number(b.empty) || b.value - a.value)
}

// One count, read back. The variance is counted less book: negative is a
// shortage, which is the direction that costs money.
export function countLine(count, item = null) {
  const counted = Number(count?.counted_qty) || 0
  const book = Number(count?.book_qty) || 0
  const variance = round2(counted - book)
  const rate = Number(count?.avg_cost) || 0
  return {
    count,
    item,
    counted,
    book,
    variance,
    // Against what the books said should be there. A store holding nothing that
    // turns out to hold twelve bags is not "infinitely over" — there is no
    // percentage, and saying so beats printing one.
    variancePercent: Math.abs(book) > 0.001 ? Math.round((variance / book) * 1000) / 10 : null,
    value: round2(variance * rate),
    short: variance < -0.001,
    over: variance > 0.001,
    square: Math.abs(variance) <= 0.001,
  }
}

// Every count on one sheet — one store, one day.
export function sheetResult(counts = [], items = [], { entityId = null, storeId = undefined, date = null } = {}) {
  const byId = new Map(items.map((i) => [i.id, i]))
  const rows = counts
    .filter((c) => !c.deleted_at)
    .filter((c) => !entityId || c.entity_id === entityId)
    .filter((c) => storeId === undefined || (c.store_id ?? null) === (storeId || null))
    .filter((c) => !date || c.date === date)
    .map((c) => countLine(c, byId.get(c.item_id) || null))

  const sum = (pick, only = () => true) => round2(rows.filter(only).reduce((t, r) => t + (pick(r) || 0), 0))
  return {
    // Short first: it is the direction that costs money, and a sheet is read
    // top down.
    lines: rows.sort((a, b) => a.value - b.value),
    count: rows.length,
    short: rows.filter((r) => r.short).length,
    over: rows.filter((r) => r.over).length,
    square: rows.filter((r) => r.square).length,
    // Kept apart rather than netted. A store twelve bags short of cement and
    // twelve bags over on sand has two problems, and a net of zero reports
    // none.
    shortValue: round2(-sum((r) => r.value, (r) => r.short)),
    overValue: sum((r) => r.value, (r) => r.over),
    netValue: sum((r) => r.value),
  }
}

// The corrections a sheet implies, ready to post. Returned as maker input
// rather than written here, so the same store, stamping and audit trail every
// other movement goes through carries these too.
export function adjustmentsFrom(counts = [], { entityId = null, actorId = null } = {}) {
  return counts
    .filter((c) => !c.deleted_at)
    .filter((c) => !entityId || c.entity_id === entityId)
    .map((c) => ({ c, line: countLine(c) }))
    .filter(({ line }) => !line.square)
    .map(({ c, line }) => makeMovement({
      entityId: c.entity_id,
      itemId: c.item_id,
      kind: 'adjustment',
      // Negative where the shelf held less than the books. `makeMovement` keeps
      // the sign for an adjustment and for nothing else.
      qty: line.variance,
      unitCost: Number(c.avg_cost) || 0,
      storeId: c.store_id,
      date: c.date,
      createdBy: actorId,
      ref: 'Stock count',
      note: `Physical verification on ${c.date}${c.note ? ` — ${c.note}` : ''}`,
    }))
}

// Every verification the company has done, and every store it has not.
export function shrinkage(counts = [], items = [], movements = [], {
  entityId = null, asOf = null, tolerance = DEFAULT_TOLERANCE, staleDays = STALE_DAYS, stores = [],
} = {}) {
  const day = asOf || todayISO()
  const mine = counts.filter((c) => !c.deleted_at).filter((c) => !entityId || c.entity_id === entityId)

  // A sheet is a store and a date.
  const sheets = new Map()
  for (const c of mine) {
    const key = `${c.store_id ?? ''}|${c.date}`
    if (!sheets.has(key)) sheets.set(key, { storeId: c.store_id ?? null, date: c.date, counts: [] })
    sheets.get(key).counts.push(c)
  }

  const lines = [...sheets.values()].map((s) => {
    const result = sheetResult(s.counts, items)
    const booked = round2(s.counts.reduce((t, c) => t + Math.abs((Number(c.book_qty) || 0) * (Number(c.avg_cost) || 0)), 0))
    return {
      ...s,
      ...result,
      bookValue: booked,
      // Out by more than the tolerance allows, measured on the shortage rather
      // than the net — see `sheetResult`.
      out: booked > 0 && result.shortValue / booked * 100 > tolerance,
      shortPercent: booked > 0 ? Math.round((result.shortValue / booked) * 1000) / 10 : null,
    }
  }).sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  // Stores holding something, and no recent count.
  //
  // Holding something, not merely mentioned: seeding this with the yard made a
  // company that has never bought a bag of cement get told to go and count an
  // empty godown, which is the sort of nag that teaches people to ignore the
  // list. A store emptied to nothing is in the same position — there is nothing
  // on the shelf to disagree with.
  const mineItems = items.filter((i) => !i.deleted_at).filter((i) => !entityId || i.entity_id === entityId)
  const mineMoves = movements.filter((m) => !m.deleted_at).filter((m) => !entityId || m.entity_id === entityId)
  const held = new Set(
    stockReport(mineItems, mineMoves).byLocation
      .filter((l) => Math.abs(l.value) > 0.001 || l.items > 0)
      .map((l) => l.locationId || CENTRAL),
  )
  const cutoff = new Date(`${day}T00:00:00Z`)
  cutoff.setUTCDate(cutoff.getUTCDate() - staleDays)
  const since = cutoff.toISOString().slice(0, 10)
  const lastCount = new Map()
  for (const s of lines) {
    const key = s.storeId || CENTRAL
    if (!lastCount.has(key) || s.date > lastCount.get(key)) lastCount.set(key, s.date)
  }
  const nameOf = (id) => (!id ? 'The yard' : stores.find((p) => p.id === id)?.name || 'A site store')
  const unverified = [...held]
    .filter((id) => !lastCount.has(id) || lastCount.get(id) < since)
    .map((id) => ({ storeId: id || null, name: nameOf(id), lastCounted: lastCount.get(id) || null }))

  return {
    sheets: lines,
    count: lines.length,
    // Only the shortages: see `sheetResult` on why these are never netted.
    shortValue: round2(lines.reduce((t, l) => t + l.shortValue, 0)),
    overValue: round2(lines.reduce((t, l) => t + l.overValue, 0)),
    out: lines.filter((l) => l.out).length,
    lastCounted: lines[0]?.date || null,
    unverified,
    unverifiedCount: unverified.length,
    // Never counted at all is a different state from counted and long ago, and
    // the first is the one that means nobody has ever looked.
    neverCounted: unverified.filter((u) => !u.lastCounted).length,
    staleDays,
  }
}
