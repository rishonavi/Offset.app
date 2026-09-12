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

// Site units as well as shop units. A builder orders sand by the brass (100
// cubic feet), concrete by the cubic metre, steel by the kilo and tonne, and
// counts doors in `nos` — the word that appears on every delivery challan in
// India. Leaving those out meant every construction quantity had to be
// converted by hand into `pcs` before it could be entered.
export const UNITS = [
  'pcs', 'nos', 'set', 'box', 'bundle', 'coil', 'roll', 'sheet', 'tin',
  'kg', 'g', 'tonne', 'quintal',
  'litre', 'ml',
  'metre', 'rft', 'sqft', 'sqm', 'cft', 'cum', 'brass',
  'bag', 'truck',
]

// What happened to the material. The three that reduce stock are deliberately
// three and not one:
//
//   `issue`     went to the site and became part of the building. A cost.
//   `wastage`   was ours and was lost — broken tiles, set cement, offcuts. Also
//               a cost, but one worth measuring separately, because wastage as a
//               percentage of what was issued is the number that tells a builder
//               whether the site is being run properly.
//   `rejected`  arrived damaged or off-spec and went back to the supplier. NOT a
//               cost: it is a credit the vendor owes. Booking a rejection as
//               wastage overstates what the job cost and quietly lets the
//               supplier keep money that was never earned.
export const MOVEMENT_KINDS = {
  receipt: { id: 'receipt', label: 'Received', sign: 1, needsCost: true, direction: 'in' },
  issue: { id: 'issue', label: 'Issued to site', sign: -1, needsCost: false, direction: 'out' },
  rejected: { id: 'rejected', label: 'Rejected — returned', sign: -1, needsCost: true, direction: 'out', returnable: true },
  wastage: { id: 'wastage', label: 'Wastage', sign: -1, needsCost: false, direction: 'out' },
  adjustment: { id: 'adjustment', label: 'Adjusted', sign: 1, needsCost: false, direction: 'in' },
}
export const MOVEMENT_KIND_IDS = Object.keys(MOVEMENT_KINDS)

export function makeItem({
  id, entityId, name, sku = '', unit = 'pcs', reorderLevel = 0,
  departmentId = null, hsn = '', category = '', brand = '', spec = '',
} = {}) {
  return {
    id: id || newId(),
    entity_id: entityId,
    name: (name || 'Untitled item').trim().slice(0, 120),
    sku: sku.trim().toUpperCase().slice(0, 32),
    unit: UNITS.includes(unit) ? unit : 'pcs',
    reorder_level: Math.max(0, Number(reorderLevel) || 0),
    department_id: departmentId,
    hsn: String(hsn).trim().slice(0, 12),
    // The trade this belongs to, from `materials.js`. Blank is allowed and
    // means uncategorised: stock kept before there were categories is still
    // stock, and rewriting it would be worse than grouping it under a heading.
    category: String(category).trim().slice(0, 32),
    // Two materials with the same name and different makers are not the same
    // material at the same price, which is the whole difficulty of pricing a
    // construction job.
    brand: String(brand).trim().slice(0, 80),
    spec: String(spec).trim().slice(0, 120),
    created_at: new Date().toISOString(),
  }
}

export function makeMovement({
  id, itemId, entityId, kind = 'receipt', qty = 0, unitCost = 0, date,
  note = '', ref = '', createdBy = null, projectId = null, vendor = '', reason = '',
  otherCost = 0,
} = {}) {
  return {
    id: id || newId(),
    item_id: itemId,
    entity_id: entityId,
    // The site it went to. Without this a company knows what it consumed and
    // not which job consumed it, which is the same as not knowing.
    project_id: projectId || null,
    vendor: String(vendor).trim().slice(0, 120),
    // Freight, loading, unloading, hamali. On a lorry of sand these can be a
    // fifth of the bill, and a stock value that counts only the rate on the
    // invoice understates what the material actually cost to have on site.
    // Charged whole against the delivery, not per unit, because that is how the
    // carrier bills it.
    other_cost: Math.max(0, round2(otherCost)),
    // Why it was rejected — "wrong shade", "12mm short", "cracked in transit".
    // A rejection nobody wrote a reason for is a rejection nobody can claim.
    reason: String(reason).trim().slice(0, 200),
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
//
// What goes out is counted in three separate buckets rather than one. They all
// reduce the quantity on the shelf and they mean entirely different things:
// issued material is in the building, wasted material is a cost with nothing to
// show for it, and rejected material was never really ours — it is money the
// supplier owes back. A single "out" figure hides all three.
export function stockOf(item, movements) {
  const rows = movements
    .filter((m) => m.item_id === item.id)
    .slice()
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.created_at || '').localeCompare(b.created_at || ''))

  let qty = 0
  let valuePaise = 0
  let received = 0
  let receivedPaise = 0
  let issued = 0
  let wasted = 0
  let rejected = 0
  let rejectedPaise = 0
  let carriage = 0
  let lastMovement = null

  for (const m of rows) {
    lastMovement = m.date || lastMovement
    if (m.kind === 'receipt') {
      // Landed cost: the rate on the invoice plus what it took to get it here.
      // Ind AS 2 says the same thing in longer words, and a site engineer who
      // has paid for two lorries knows it without being told.
      const landed = Math.round(m.qty * paise(m.unit_cost)) + paise(m.other_cost || 0)
      qty += m.qty
      valuePaise += landed
      receivedPaise += landed
      received += m.qty
      carriage += Number(m.other_cost) || 0
    } else if (m.kind === 'rejected') {
      // Comes off at the rate it was invoiced at, not at the blended average:
      // a return to the supplier is a reversal of that delivery, and the credit
      // note has to match the bill. With no rate given the average is the only
      // figure available, so it is used and the claim is approximate.
      //
      // Freight is deliberately not reversed with it. The lorry came either way
      // and no carrier refunds a trip because the cement was wet, so that cost
      // stays on the job — which is itself worth knowing about a bad supplier.
      const avg = qty > 0 ? valuePaise / qty : 0
      const rate = m.unit_cost ? paise(m.unit_cost) : avg
      const off = Math.min(m.qty, Math.max(0, qty))
      qty -= m.qty
      valuePaise -= Math.round(off * rate)
      rejected += m.qty
      rejectedPaise += Math.round(m.qty * rate)
    } else if (m.kind === 'issue' || m.kind === 'wastage') {
      // Issue at the average cost prevailing right now.
      const avg = qty > 0 ? valuePaise / qty : 0
      const out = Math.min(m.qty, Math.max(0, qty))
      qty -= m.qty
      valuePaise -= Math.round(out * avg)
      if (m.kind === 'wastage') wasted += m.qty
      else issued += m.qty
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
  const consumed = round2(issued + wasted)

  return {
    item,
    qty: round2(qty),
    value: round2(Math.max(0, value)),
    avgCost: qty > 0 ? round2(value / qty) : 0,
    received: round2(received),
    receivedValue: round2(rupees(receivedPaise)),
    // What of that was freight and handling rather than the material itself.
    carriage: round2(carriage),
    issued: round2(issued),
    wasted: round2(wasted),
    // Everything that genuinely left for the job: issued plus wasted. Rejected
    // material is not in here, because it never became part of the building.
    consumed,
    rejected: round2(rejected),
    // What the suppliers owe back for it. Nobody chases a number nobody prints.
    rejectedValue: round2(rupees(rejectedPaise)),
    // Wastage against what was actually put to use. A site running 2% on tiles
    // and one running 18% are not the same site, and the rupee figure alone
    // will not tell you which is which.
    wastagePercent: consumed > 0 ? Math.round((wasted / consumed) * 1000) / 10 : null,
    // Rejections against what was delivered — a supplier's quality record.
    rejectionPercent: received > 0 ? Math.round((rejected / received) * 1000) / 10 : null,
    lastMovement,
    // Negative stock means the books and the shelf disagree — worth saying so
    // rather than displaying a minus sign and hoping someone notices.
    negative: qty < 0,
    belowReorder: item.reorder_level > 0 && qty <= item.reorder_level,
  }
}

export function stockReport(items, movements) {
  const lines = items.map((item) => stockOf(item, movements))
  const sum = (pick) => round2(lines.reduce((t, l) => t + (pick(l) || 0), 0))
  return {
    lines,
    totalValue: sum((l) => l.value),
    receivedValue: sum((l) => l.receivedValue),
    carriage: sum((l) => l.carriage),
    // Held apart from the stock value on purpose: this is a receivable from
    // suppliers, not an asset on the shelf, and adding the two would inflate
    // both what the company holds and what the job cost.
    rejectedValue: sum((l) => l.rejectedValue),
    itemsBelowReorder: lines.filter((l) => l.belowReorder).length,
    itemsNegative: lines.filter((l) => l.negative).length,
    itemsRejected: lines.filter((l) => l.rejected > 0).length,
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
  // Landed, to match how `stockOf` values a receipt. Counting only the invoice
  // rate here would leave the freight inside the closing stock with nothing on
  // the "received" side to explain it, and the period would report consuming
  // less than it did.
  const receivedValue = round2(
    through
      .filter((m) => m.kind === 'receipt' && (!from || (m.date || '') >= from))
      .reduce((t, m) => t + m.qty * (Number(m.unit_cost) || 0) + (Number(m.other_cost) || 0), 0),
  )
  // Rejections also lower the closing stock, so without taking them out here
  // the identity below would charge returned material to the job as if it had
  // been consumed — the exact double-count the separate kind exists to prevent.
  const rejectedValue = round2(
    through
      .filter((m) => m.kind === 'rejected' && (!from || (m.date || '') >= from))
      .reduce((t, m) => t + m.qty * (Number(m.unit_cost) || 0), 0),
  )

  return {
    opening,
    closing,
    openingValue: opening.totalValue,
    closingValue: closing.totalValue,
    receivedValue,
    rejectedValue,
    // What left the shelf, by the identity closing = opening + in − out. A
    // stock-take that found less lands here too, which is the honest place for
    // it: unexplained shrinkage is a cost, not a mystery to be filed separately.
    consumedValue: round2(opening.totalValue + receivedValue - rejectedValue - closing.totalValue),
    change: round2(closing.totalValue - opening.totalValue),
  }
}

// What each site consumed, and what it is still holding.
//
// A company that knows it burned ₹40 lakh of steel and not which of its four
// towers burned it knows nothing useful. Material is booked to a job when it is
// issued, so this reads the issue and wastage movements rather than the stock
// balance — the shelf has no site on it.
export function usageBySite(items, movements, { projects = [] } = {}) {
  const byItem = new Map(items.map((i) => [i.id, i]))
  const groups = new Map()

  // Each issue is valued at the average prevailing *at that moment*, which
  // means walking the movements the same way `stockOf` does rather than asking
  // it for one number at the end.
  //
  // The shortcut — take the item's current average and multiply — reads fine
  // and is wrong in the case that matters most: once a material has been fully
  // issued there is none left, so its average is zero, and the job that
  // consumed every last kilo of it is reported as having consumed nothing. A
  // site that used the whole lot is exactly the site you are looking for.
  for (const item of byItem.values()) {
    const rows = movements
      .filter((m) => m.item_id === item.id)
      .slice()
      .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.created_at || '').localeCompare(b.created_at || ''))

    let qty = 0
    let value = 0

    for (const m of rows) {
      if (m.kind === 'receipt') {
        qty += m.qty
        value += m.qty * (Number(m.unit_cost) || 0) + (Number(m.other_cost) || 0)
        continue
      }
      const avg = qty > 0 ? value / qty : 0
      if (m.kind === 'rejected') {
        const rate = m.unit_cost ? Number(m.unit_cost) : avg
        qty -= m.qty
        value -= Math.min(m.qty, Math.max(0, qty + m.qty)) * rate
        continue
      }
      if (m.kind === 'adjustment') {
        qty += m.qty
        value += m.qty * (m.unit_cost ? Number(m.unit_cost) : avg)
        continue
      }
      // An issue or a wastage: this is the movement being attributed.
      const cost = round2(m.qty * avg)
      qty -= m.qty
      value -= Math.min(m.qty, Math.max(0, qty + m.qty)) * avg

      const key = m.project_id || ''
      const cur = groups.get(key) || {
        projectId: m.project_id || null,
        // Resolved here rather than at the call site so the "not booked to any
        // site" row reads as a finding instead of a blank.
        project: projects.find((p) => p.id === m.project_id) || null,
        issued: 0, wasted: 0, value: 0, wastedValue: 0, entries: 0, items: new Set(),
      }
      if (m.kind === 'wastage') {
        cur.wasted = round2(cur.wasted + m.qty)
        cur.wastedValue = round2(cur.wastedValue + cost)
      } else {
        cur.issued = round2(cur.issued + m.qty)
      }
      cur.value = round2(cur.value + cost)
      cur.entries += 1
      cur.items.add(m.item_id)
      groups.set(key, cur)
    }
  }

  return [...groups.values()]
    .map((g) => ({ ...g, items: g.items.size }))
    .sort((a, b) => b.value - a.value)
}

// The movement log, newest first — the screen that answers "what came in this
// week" and "who rejected what". Filterable because on a live site it is the
// longest list in the app.
export function movementLog(items, movements, { itemId = null, kind = null, projectId = null, limit = 200 } = {}) {
  const byItem = new Map(items.map((i) => [i.id, i]))
  return movements
    .filter((m) => (!itemId || m.item_id === itemId))
    .filter((m) => (!kind || m.kind === kind))
    .filter((m) => (!projectId || m.project_id === projectId))
    .map((m) => ({
      movement: m,
      item: byItem.get(m.item_id) || null,
      kind: MOVEMENT_KINDS[m.kind] || MOVEMENT_KINDS.adjustment,
      value: round2((Number(m.qty) || 0) * (Number(m.unit_cost) || 0)),
    }))
    .sort((a, b) =>
      (b.movement.date || '').localeCompare(a.movement.date || '') ||
      (b.movement.created_at || '').localeCompare(a.movement.created_at || ''))
    .slice(0, limit)
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
