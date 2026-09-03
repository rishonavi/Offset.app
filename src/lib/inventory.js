// Stock: what a company holds, what it is worth, and when to reorder.
//
// Valued at weighted average cost, which is what Indian companies overwhelmingly
// use and what Ind AS 2 permits. The alternative, FIFO, needs every receipt kept
// as a separate layer; average cost needs one number per item and gives the same
// answer often enough that the extra machinery isn't worth it here.
//
// Quantities are kept in whole units of the item's own unit of measure, and
// money in paise, because a stock valuation that is out by a rounding error is
// a stock valuation nobody trusts.

const paise = (n) => Math.round((Number(n) || 0) * 100)
const rupees = (p) => p / 100
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)

export const UNITS = ['pcs', 'box', 'kg', 'g', 'litre', 'ml', 'metre', 'sqft', 'bag', 'roll', 'set']

export const MOVEMENT_KINDS = {
  receipt: { id: 'receipt', label: 'Received', sign: 1, needsCost: true },
  issue: { id: 'issue', label: 'Issued', sign: -1, needsCost: false },
  adjustment: { id: 'adjustment', label: 'Adjusted', sign: 1, needsCost: false },
  wastage: { id: 'wastage', label: 'Wastage', sign: -1, needsCost: false },
}

export function makeItem({ id, entityId, name, sku = '', unit = 'pcs', reorderLevel = 0, departmentId = null, hsn = '' } = {}) {
  return {
    id: id || newId(),
    entity_id: entityId,
    name: (name || 'Untitled item').trim().slice(0, 120),
    sku: sku.trim().toUpperCase().slice(0, 32),
    unit: UNITS.includes(unit) ? unit : 'pcs',
    reorder_level: Math.max(0, Number(reorderLevel) || 0),
    department_id: departmentId,
    hsn: String(hsn).trim().slice(0, 12),
    created_at: new Date().toISOString(),
  }
}

export function makeMovement({ id, itemId, entityId, kind = 'receipt', qty = 0, unitCost = 0, date, note = '', ref = '', createdBy = null } = {}) {
  return {
    id: id || newId(),
    item_id: itemId,
    entity_id: entityId,
    kind: MOVEMENT_KINDS[kind] ? kind : 'receipt',
    // An adjustment may legitimately be negative (a stock-take found less);
    // every other kind carries its direction in the kind itself.
    qty: kind === 'adjustment' ? Number(qty) || 0 : Math.abs(Number(qty) || 0),
    unit_cost: Math.max(0, round2(unitCost)),
    date: date || new Date().toISOString().slice(0, 10),
    note: note.trim().slice(0, 200),
    ref: ref.trim().slice(0, 60),
    created_by: createdBy,
    created_at: new Date().toISOString(),
  }
}

// Walks an item's movements oldest-first and returns where it ended up.
// Receipts move the average; issues leave it alone and consume at it.
export function stockOf(item, movements) {
  const rows = movements
    .filter((m) => m.item_id === item.id)
    .slice()
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.created_at || '').localeCompare(b.created_at || ''))

  let qty = 0
  let valuePaise = 0
  let received = 0
  let issued = 0
  let lastMovement = null

  for (const m of rows) {
    lastMovement = m.date || lastMovement
    if (m.kind === 'receipt') {
      qty += m.qty
      valuePaise += Math.round(m.qty * paise(m.unit_cost))
      received += m.qty
    } else if (m.kind === 'issue' || m.kind === 'wastage') {
      // Issue at the average cost prevailing right now.
      const avg = qty > 0 ? valuePaise / qty : 0
      const out = Math.min(m.qty, Math.max(0, qty))
      qty -= m.qty
      valuePaise -= Math.round(out * avg)
      issued += m.qty
    } else if (m.kind === 'adjustment') {
      const avg = qty > 0 ? valuePaise / qty : 0
      qty += m.qty
      // A positive adjustment with no cost is valued at the current average —
      // there is nothing better to value it at.
      valuePaise += Math.round(m.qty * (m.unit_cost ? paise(m.unit_cost) : avg))
    }
  }

  // Stock cannot be worth less than nothing, whatever the movements say.
  if (qty <= 0) valuePaise = Math.max(0, qty === 0 ? 0 : valuePaise)
  const value = rupees(Math.round(valuePaise))

  return {
    item,
    qty: round2(qty),
    value: round2(Math.max(0, value)),
    avgCost: qty > 0 ? round2(value / qty) : 0,
    received: round2(received),
    issued: round2(issued),
    lastMovement,
    // Negative stock means the books and the shelf disagree — worth saying so
    // rather than displaying a minus sign and hoping someone notices.
    negative: qty < 0,
    belowReorder: item.reorder_level > 0 && qty <= item.reorder_level,
  }
}

export function stockReport(items, movements) {
  const lines = items.map((item) => stockOf(item, movements))
  return {
    lines,
    totalValue: round2(lines.reduce((t, l) => t + l.value, 0)),
    itemsBelowReorder: lines.filter((l) => l.belowReorder).length,
    itemsNegative: lines.filter((l) => l.negative).length,
  }
}

// What to reorder, most urgent first: negative stock before merely low stock.
export function reorderList(items, movements) {
  return stockReport(items, movements).lines
    .filter((l) => l.belowReorder || l.negative)
    .sort((a, b) => (a.negative === b.negative ? a.qty - b.qty : a.negative ? -1 : 1))
}

// Stock as a period statement rather than a snapshot, which is what a report
// needs: what it was worth when the period opened, what it is worth at the
// close, and what moved in between. Movements are dated, so both ends are real
// figures rather than a projection.
export function stockOverPeriod(items, movements, { from = null, to = null } = {}) {
  const before = from ? movements.filter((m) => (m.date || '') < from) : []
  const through = to ? movements.filter((m) => (m.date || '') <= to) : movements
  const opening = stockReport(items, before)
  const closing = stockReport(items, through)
  const receivedValue = round2(
    through
      .filter((m) => m.kind === 'receipt' && (!from || (m.date || '') >= from))
      .reduce((t, m) => t + m.qty * (Number(m.unit_cost) || 0), 0),
  )
  return {
    opening,
    closing,
    openingValue: opening.totalValue,
    closingValue: closing.totalValue,
    receivedValue,
    // What left the shelf, by the identity closing = opening + in − out. A
    // stock-take that found less lands here too, which is the honest place for
    // it: unexplained shrinkage is a cost, not a mystery to be filed separately.
    consumedValue: round2(opening.totalValue + receivedValue - closing.totalValue),
    change: round2(closing.totalValue - opening.totalValue),
  }
}

// Consumption over a window, which is what tells you whether the reorder level
// is set anywhere near reality.
export function consumption(item, movements, fromISO, toISO) {
  const out = movements.filter(
    (m) => m.item_id === item.id &&
      (m.kind === 'issue' || m.kind === 'wastage') &&
      (!fromISO || m.date >= fromISO) &&
      (!toISO || m.date <= toISO),
  )
  return round2(out.reduce((t, m) => t + m.qty, 0))
}
