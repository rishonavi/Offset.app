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
  // Between two of the company's own stores. One row and not two, because a
  // transfer is a single event: recorded as a pair, one half can be entered
  // and the other forgotten, and the company's total silently changes.
  transfer: { id: 'transfer', label: 'Transferred', sign: 0, needsCost: false, direction: 'move' },
  issue: { id: 'issue', label: 'Issued to work', sign: -1, needsCost: false, direction: 'out' },
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
  note = '', ref = '', createdBy = null, projectId = null,
  storeId = null, toStoreId = null, vendor = '', reason = '', otherCost = 0,
} = {}) {
  return {
    id: id || newId(),
    item_id: itemId,
    entity_id: entityId,
    // Two different questions, and folding them into one field is a mistake
    // that looks harmless until a site issues material from the yard.
    //
    //   `store_id`   which shelf this moved. Null is the central store — the
    //                yard — and a site's id is that site's own store.
    //   `project_id` which job is charged. On an issue from the yard straight
    //                to a job these differ, and both are true.
    //
    // Null is deliberately the default for the store, and it is what every
    // movement recorded before site stores existed already says: they were all
    // at the yard, so they stay right without anybody touching them.
    store_id: storeId || null,
    // Where it went, on a transfer. Meaningless on every other kind.
    to_store_id: kind === 'transfer' ? (toStoreId || null) : null,
    // The job charged. Unchanged in meaning from before there were stores.
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

// The central store is the absence of a site. Every movement written before
// there were site stores has no site on it, so they are all at the yard, which
// is where they were.
export const CENTRAL = ''
export const isCentral = (locationId) => !locationId
export const locationOf = (movement) => movement?.store_id || CENTRAL

// Walks one item's movements oldest-first, keeping a separate running balance
// for every store, and hands each movement to `visit` along with the state at
// that moment.
//
// Per store, not per company, because that is what a stores ledger is. A
// transfer out of the yard carries value at **the yard's** average, which is
// what the transfer note says and what the receiving site is then holding. One
// company-wide average would move a site's stock value every time an unrelated
// delivery landed somewhere else.
function walkStock(item, movements, visit) {
  const rows = movements
    .filter((m) => m.item_id === item.id && !m.deleted_at)
    .slice()
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.created_at || '').localeCompare(b.created_at || ''))

  const stores = new Map()
  const at = (id) => {
    const key = id || CENTRAL
    if (!stores.has(key)) stores.set(key, { id: key, qty: 0, valuePaise: 0 })
    return stores.get(key)
  }
  // The yard always exists, even empty: a company with stock only on its sites
  // still has a yard, and a report that omits it reads as though it does not.
  at(CENTRAL)

  for (const m of rows) {
    const here = at(m.store_id)
    const avg = here.qty > 0 ? here.valuePaise / here.qty : 0

    if (m.kind === 'receipt') {
      // Landed cost: the rate on the invoice plus what it took to get it here.
      const landed = Math.round(m.qty * paise(m.unit_cost)) + paise(m.other_cost || 0)
      here.qty += m.qty
      here.valuePaise += landed
      visit?.(m, { store: here, avg, landed, stores })
    } else if (m.kind === 'transfer') {
      const there = at(m.to_store_id)
      // Capped at what is actually on the shelf, the same way an over-issue is:
      // moving value that was never there would invent it at the far end.
      const moved = Math.min(m.qty, Math.max(0, here.qty))
      const value = Math.round(moved * avg)
      here.qty -= m.qty
      here.valuePaise -= value
      there.qty += m.qty
      there.valuePaise += value
      visit?.(m, { store: here, to: there, avg, moved: value, stores })
    } else if (m.kind === 'rejected') {
      // Comes off at the rate it was invoiced at, not the blended average: a
      // return to the supplier reverses that delivery and the credit note has
      // to match the bill.
      const rate = m.unit_cost ? paise(m.unit_cost) : avg
      const off = Math.min(m.qty, Math.max(0, here.qty))
      here.qty -= m.qty
      here.valuePaise -= Math.round(off * rate)
      visit?.(m, { store: here, avg, rate, off, stores })
    } else if (m.kind === 'issue' || m.kind === 'wastage') {
      const out = Math.min(m.qty, Math.max(0, here.qty))
      const cost = Math.round(out * avg)
      here.qty -= m.qty
      here.valuePaise -= cost
      visit?.(m, { store: here, avg, cost, stores })
    } else if (m.kind === 'adjustment') {
      here.qty += m.qty
      // A positive adjustment with no cost is valued at the current average —
      // there is nothing better to value it at.
      here.valuePaise += Math.round(m.qty * (m.unit_cost ? paise(m.unit_cost) : avg))
      visit?.(m, { store: here, avg, stores })
    }
  }

  return { rows, stores }
}

const settle = (store) => {
  // Stock cannot be worth less than nothing, whatever the movements say.
  const paiseValue = store.qty <= 0 ? Math.max(0, store.qty === 0 ? 0 : store.valuePaise) : store.valuePaise
  const value = round2(Math.max(0, rupees(Math.round(paiseValue))))
  return {
    qty: round2(store.qty),
    value,
    avgCost: store.qty > 0 ? round2(value / store.qty) : 0,
    negative: store.qty < 0,
  }
}

// What one item is holding, everywhere, and where.
//
// What goes out is counted in three separate buckets rather than one. They all
// reduce the quantity on the shelf and they mean entirely different things:
// issued material is in the building, wasted material is a cost with nothing to
// show for it, and rejected material was never really ours — it is money the
// supplier owes back. A single "out" figure hides all three. A transfer is in
// none of them: it changes which shelf, not how much there is.
export function stockOf(item, movements) {
  let received = 0
  let receivedPaise = 0
  let issued = 0
  let wasted = 0
  let rejected = 0
  let rejectedPaise = 0
  let carriage = 0
  let transferred = 0
  let lastMovement = null

  const { rows, stores } = walkStock(item, movements, (m, ctx) => {
    lastMovement = m.date || lastMovement
    if (m.kind === 'receipt') {
      received += m.qty
      receivedPaise += ctx.landed
      carriage += Number(m.other_cost) || 0
    } else if (m.kind === 'transfer') {
      transferred += m.qty
    } else if (m.kind === 'rejected') {
      rejected += m.qty
      rejectedPaise += Math.round(m.qty * ctx.rate)
    } else if (m.kind === 'wastage') {
      wasted += m.qty
    } else if (m.kind === 'issue') {
      issued += m.qty
    }
  })

  const byLocation = [...stores.values()]
    .map((store) => ({ locationId: store.id || null, ...settle(store) }))
    // Biggest holding first, but the yard leads whatever it holds: it is the
    // line everyone reads first and moving it around is disorienting.
    .sort((a, b) => Number(Boolean(a.locationId)) - Number(Boolean(b.locationId)) || b.value - a.value)

  const qty = round2(byLocation.reduce((t, l) => t + l.qty, 0))
  const value = round2(byLocation.reduce((t, l) => t + l.value, 0))
  const consumed = round2(issued + wasted)

  return {
    item,
    // The company's total, across the yard and every site. The figure the old
    // single-pool model gave, and still the one a balance sheet wants.
    qty,
    value,
    avgCost: qty > 0 ? round2(value / qty) : 0,
    // Where it is. A company holding forty tonnes of steel and not knowing
    // which site has it is a company that will buy forty more.
    byLocation,
    central: byLocation.find((l) => !l.locationId) || { locationId: null, qty: 0, value: 0, avgCost: 0, negative: false },
    onSites: round2(byLocation.filter((l) => l.locationId).reduce((t, l) => t + l.qty, 0)),
    onSitesValue: round2(byLocation.filter((l) => l.locationId).reduce((t, l) => t + l.value, 0)),
    sites: byLocation.filter((l) => l.locationId && (l.qty !== 0 || l.value !== 0)).length,

    received: round2(received),
    receivedValue: round2(rupees(receivedPaise)),
    // What of that was freight and handling rather than the material itself.
    carriage: round2(carriage),
    issued: round2(issued),
    wasted: round2(wasted),
    // Everything that genuinely left for the job: issued plus wasted. Rejected
    // material is not in here, because it never became part of the building,
    // and neither is a transfer, which only changed shelves.
    consumed,
    transferred: round2(transferred),
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
    movements: rows.length,
    // Negative stock means the books and a shelf disagree — worth saying so
    // rather than displaying a minus sign and hoping someone notices. True if
    // *any* store is short, because a company can be square overall and still
    // have a site that has issued what it never received.
    negative: byLocation.some((l) => l.negative),
    belowReorder: item.reorder_level > 0 && qty <= item.reorder_level,
  }
}

// One item at one store. The central store is `CENTRAL`, which is also what a
// movement with no site on it means.
export function stockAt(item, movements, locationId = CENTRAL) {
  const line = stockOf(item, movements)
  const key = locationId || null
  return line.byLocation.find((l) => l.locationId === key)
    || { locationId: key, qty: 0, value: 0, avgCost: 0, negative: false }
}

export function stockReport(items, movements) {
  const lines = items.map((item) => stockOf(item, movements))
  const sum = (pick) => round2(lines.reduce((t, l) => t + (pick(l) || 0), 0))

  // The same stock read the other way round: by store rather than by material.
  // A company holding forty tonnes of steel and not knowing which site has it
  // is a company that will buy forty more.
  const stores = new Map()
  for (const line of lines) {
    for (const loc of line.byLocation) {
      const key = loc.locationId || CENTRAL
      const cur = stores.get(key) || { locationId: loc.locationId, value: 0, items: 0, negative: 0 }
      cur.value = round2(cur.value + loc.value)
      cur.items += loc.qty !== 0 || loc.value !== 0 ? 1 : 0
      cur.negative += loc.negative ? 1 : 0
      stores.set(key, cur)
    }
  }
  const byLocation = [...stores.values()]
    .sort((a, b) => Number(Boolean(a.locationId)) - Number(Boolean(b.locationId)) || b.value - a.value)

  return {
    lines,
    // The company's total, which is the yard plus every site.
    totalValue: sum((l) => l.value),
    byLocation,
    centralValue: byLocation.find((l) => !l.locationId)?.value || 0,
    onSitesValue: round2(byLocation.filter((l) => l.locationId).reduce((t, l) => t + l.value, 0)),
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
  const groups = new Map()

  for (const item of items) {
    if (item?.deleted_at) continue
    walkStock(item, movements, (m, ctx) => {
      if (m.kind !== 'issue' && m.kind !== 'wastage') return
      // Charged at the average prevailing **at that store** at that moment.
      // A site that drew before a price rise pays the old rate, and a material
      // issued down to nothing is still charged what it cost — the shortcut of
      // multiplying by the item's closing average reports zero for exactly the
      // job that used the whole lot.
      // `ctx.avg` is the walk's internal unit, which is paise.
      const cost = round2(m.qty * rupees(ctx.avg))
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
    })
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
