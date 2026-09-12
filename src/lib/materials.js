// What a builder actually buys.
//
// The stock module underneath this one is generic: an item, a unit, a quantity.
// That is the right foundation and the wrong vocabulary. A site does not order
// "items" — it orders cement by the bag, steel by the kilo, sand by the brass,
// doors and lifts by the number, and the difference between those matters for
// more than the label.
//
// Two kinds, and they behave differently:
//
//   **Bulk** — cement, steel, sand, aggregate, bricks. Delivered continuously,
//   consumed continuously, and some of it is lost. Wastage is a real percentage
//   a builder watches, a reorder level is meaningful, and the rate moves month
//   to month in a way that can quietly eat a job costed six months ago.
//
//   **Fitted** — doors, windows, tiles, bathroom and kitchen fittings, lifts.
//   Counted, not measured. Bought against a schedule of quantities, delivered in
//   lots, and the number that matters is not wastage but *rejection*: how much
//   arrived damaged or off-spec and went back. Rejected material is not a cost —
//   it is a credit owed by the vendor — and booking it as wastage both overstates
//   what the job cost and lets the supplier off.
//
// The categories below carry the unit a trade actually quotes in and the HSN
// chapter it invoices under, so adding cement does not mean looking either up.

import { UNITS } from './inventory'

// Ordered as a job consumes them: earthwork and structure first, finishes last.
export const MATERIAL_CATEGORIES = {
  aggregate: { id: 'aggregate', label: 'Sand & aggregate', unit: 'brass', kind: 'bulk', hsn: '2505' },
  cement: { id: 'cement', label: 'Cement & concrete', unit: 'bag', kind: 'bulk', hsn: '2523' },
  steel: { id: 'steel', label: 'Steel & reinforcement', unit: 'kg', kind: 'bulk', hsn: '7214' },
  masonry: { id: 'masonry', label: 'Bricks & blocks', unit: 'nos', kind: 'bulk', hsn: '6810' },
  consumables: { id: 'consumables', label: 'Shuttering & consumables', unit: 'nos', kind: 'bulk', hsn: '' },
  finishes: { id: 'finishes', label: 'Tiles, stone & paint', unit: 'sqft', kind: 'fitted', hsn: '6907' },
  joinery: { id: 'joinery', label: 'Doors & windows', unit: 'nos', kind: 'fitted', hsn: '4418' },
  plumbing: { id: 'plumbing', label: 'Plumbing & bathroom', unit: 'nos', kind: 'fitted', hsn: '3922' },
  electrical: { id: 'electrical', label: 'Electrical', unit: 'nos', kind: 'fitted', hsn: '8536' },
  kitchen: { id: 'kitchen', label: 'Kitchen fittings', unit: 'nos', kind: 'fitted', hsn: '9403' },
  equipment: { id: 'equipment', label: 'Lifts & equipment', unit: 'nos', kind: 'fitted', hsn: '8428' },
}

export const MATERIAL_CATEGORY_IDS = Object.keys(MATERIAL_CATEGORIES)

// An item with no category is not an error — the generic stock module predates
// this one and its rows are still valid. They group under "Uncategorised".
export const UNCATEGORISED = { id: '', label: 'Uncategorised', unit: 'pcs', kind: 'bulk', hsn: '' }

export const categoryOf = (item) => MATERIAL_CATEGORIES[item?.category] || UNCATEGORISED
export const isBulk = (item) => categoryOf(item).kind === 'bulk'
export const isFitted = (item) => categoryOf(item).kind === 'fitted'

// The unit a trade quotes in, used to pre-fill the form rather than to constrain
// it: cement is usually bags but somebody buying bulk RMC works in cubic metres,
// and refusing that would be wrong.
export const unitFor = (categoryId) => {
  const u = MATERIAL_CATEGORIES[categoryId]?.unit
  return u && UNITS.includes(u) ? u : 'pcs'
}

// A starter list, so setting up a site is picking from a list rather than typing
// forty rows. Names and units are what a Indian supplier's delivery challan
// says; grades are spelled out because "cement" alone cannot be priced — OPC 53
// and PPC are different materials at different rates.
export const CATALOGUE = [
  // Sand & aggregate — sold by the brass (100 cft) almost everywhere.
  { name: 'River sand', category: 'aggregate', unit: 'brass' },
  { name: 'M-sand (crushed)', category: 'aggregate', unit: 'brass' },
  { name: 'Aggregate 20mm', category: 'aggregate', unit: 'brass' },
  { name: 'Aggregate 10mm', category: 'aggregate', unit: 'brass' },
  { name: 'Stone dust', category: 'aggregate', unit: 'brass' },

  // Cement & concrete.
  { name: 'Cement OPC 53 grade', category: 'cement', unit: 'bag' },
  { name: 'Cement OPC 43 grade', category: 'cement', unit: 'bag' },
  { name: 'Cement PPC', category: 'cement', unit: 'bag' },
  { name: 'White cement', category: 'cement', unit: 'kg' },
  { name: 'Ready-mix concrete M25', category: 'cement', unit: 'cum' },
  { name: 'Ready-mix concrete M30', category: 'cement', unit: 'cum' },
  { name: 'Waterproofing admixture', category: 'cement', unit: 'litre' },

  // Steel — by the kilo on site, by the tonne on the invoice.
  { name: 'TMT bar 8mm Fe500', category: 'steel', unit: 'kg' },
  { name: 'TMT bar 10mm Fe500', category: 'steel', unit: 'kg' },
  { name: 'TMT bar 12mm Fe500', category: 'steel', unit: 'kg' },
  { name: 'TMT bar 16mm Fe500', category: 'steel', unit: 'kg' },
  { name: 'TMT bar 20mm Fe500', category: 'steel', unit: 'kg' },
  { name: 'Binding wire', category: 'steel', unit: 'kg' },
  { name: 'Structural steel angle', category: 'steel', unit: 'kg' },
  { name: 'Welded wire mesh', category: 'steel', unit: 'sqm' },

  // Bricks & blocks.
  { name: 'Red clay brick', category: 'masonry', unit: 'nos' },
  { name: 'Fly ash brick', category: 'masonry', unit: 'nos' },
  { name: 'AAC block 600x200x200', category: 'masonry', unit: 'nos' },
  { name: 'Solid concrete block 6"', category: 'masonry', unit: 'nos' },

  // Shuttering & consumables.
  { name: 'Shuttering ply 12mm', category: 'consumables', unit: 'sheet' },
  { name: 'Scaffolding pipe', category: 'consumables', unit: 'metre' },
  { name: 'Shuttering oil', category: 'consumables', unit: 'litre' },
  { name: 'Safety helmet', category: 'consumables', unit: 'nos' },

  // Tiles, stone & paint.
  { name: 'Vitrified tile 600x600', category: 'finishes', unit: 'sqft' },
  { name: 'Ceramic wall tile', category: 'finishes', unit: 'sqft' },
  { name: 'Granite slab', category: 'finishes', unit: 'sqft' },
  { name: 'Italian marble', category: 'finishes', unit: 'sqft' },
  { name: 'Wall putty', category: 'finishes', unit: 'bag' },
  { name: 'Emulsion paint (interior)', category: 'finishes', unit: 'litre' },
  { name: 'Exterior weatherproof paint', category: 'finishes', unit: 'litre' },
  { name: 'Tile adhesive', category: 'finishes', unit: 'bag' },

  // Doors & windows.
  { name: 'Flush door shutter 32mm', category: 'joinery', unit: 'nos' },
  { name: 'Teak door frame', category: 'joinery', unit: 'nos' },
  { name: 'UPVC sliding window', category: 'joinery', unit: 'sqft' },
  { name: 'Aluminium openable window', category: 'joinery', unit: 'sqft' },
  { name: 'Main door (designer)', category: 'joinery', unit: 'nos' },
  { name: 'Door hardware set', category: 'joinery', unit: 'set' },

  // Plumbing & bathroom.
  { name: 'CPVC pipe 1"', category: 'plumbing', unit: 'metre' },
  { name: 'PVC drainage pipe 4"', category: 'plumbing', unit: 'metre' },
  { name: 'Wall-hung WC', category: 'plumbing', unit: 'nos' },
  { name: 'Wash basin with pedestal', category: 'plumbing', unit: 'nos' },
  { name: 'CP fitting set (bath)', category: 'plumbing', unit: 'set' },
  { name: 'Overhead water tank 1000L', category: 'plumbing', unit: 'nos' },

  // Electrical.
  { name: 'Copper wire 1.5 sqmm', category: 'electrical', unit: 'coil' },
  { name: 'Copper wire 2.5 sqmm', category: 'electrical', unit: 'coil' },
  { name: 'Modular switch', category: 'electrical', unit: 'nos' },
  { name: 'Distribution board 8-way', category: 'electrical', unit: 'nos' },
  { name: 'LED panel light', category: 'electrical', unit: 'nos' },
  { name: 'PVC conduit pipe', category: 'electrical', unit: 'metre' },

  // Kitchen fittings.
  { name: 'Modular kitchen unit', category: 'kitchen', unit: 'rft' },
  { name: 'Granite kitchen counter', category: 'kitchen', unit: 'sqft' },
  { name: 'Kitchen sink (steel)', category: 'kitchen', unit: 'nos' },
  { name: 'Chimney & hob set', category: 'kitchen', unit: 'set' },

  // Lifts & equipment.
  { name: 'Passenger lift 6-person', category: 'equipment', unit: 'nos' },
  { name: 'Water pump 1HP', category: 'equipment', unit: 'nos' },
  { name: 'DG set 25kVA', category: 'equipment', unit: 'nos' },
  { name: 'STP unit', category: 'equipment', unit: 'nos' },
]

// Everything in one category, for the picker.
export const catalogueFor = (categoryId) =>
  CATALOGUE.filter((c) => c.category === categoryId)

// A catalogue entry's suggested defaults, filled in from its category where the
// entry itself says nothing. Returns the shape `makeItem` takes, not an item —
// the caller still owns the entity and whatever the user edited.
export function fromCatalogue(name) {
  const entry = CATALOGUE.find((c) => c.name.toLowerCase() === String(name).trim().toLowerCase())
  if (!entry) return null
  const cat = MATERIAL_CATEGORIES[entry.category] || UNCATEGORISED
  return {
    name: entry.name,
    category: entry.category,
    unit: UNITS.includes(entry.unit) ? entry.unit : cat.unit,
    hsn: entry.hsn || cat.hsn,
  }
}

// Stock lines grouped the way a site engineer reads them: by trade, each with
// its own value, and the empty trades left out rather than printed as zeroes.
export function byCategory(lines = []) {
  const groups = new Map()
  for (const line of lines) {
    const cat = categoryOf(line.item)
    const cur = groups.get(cat.id) || { category: cat, lines: [], value: 0, rejectedValue: 0, low: 0 }
    cur.lines.push(line)
    cur.value = Math.round((cur.value + (line.value || 0)) * 100) / 100
    cur.rejectedValue = Math.round((cur.rejectedValue + (line.rejectedValue || 0)) * 100) / 100
    cur.low += line.belowReorder || line.negative ? 1 : 0
    groups.set(cat.id, cur)
  }
  // Catalogue order, with uncategorised last wherever it falls.
  const order = [...MATERIAL_CATEGORY_IDS, '']
  return [...groups.values()].sort((a, b) => order.indexOf(a.category.id) - order.indexOf(b.category.id))
}
