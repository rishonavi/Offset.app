// Construction materials: the catalogue, the three ways stock leaves a site,
// and what any of it costs.
//
// The assertions worth reading are the ones that separate things a generic
// stock system runs together — issued from wasted from rejected, and the rate
// on a quote from the landed price of it.
import {
  MATERIAL_CATEGORIES, MATERIAL_CATEGORY_IDS, CATALOGUE, UNCATEGORISED,
  categoryOf, isBulk, isFitted, unitFor, fromCatalogue, catalogueFor, byCategory,
} from '../../src/lib/materials.js'
import {
  makeItem, makeMovement, stockOf, stockAt, stockReport, stockOverPeriod,
  usageBySite, movementLog, UNITS, MOVEMENT_KINDS, CENTRAL, isCentral,
  canAmendItem, canRemoveItem, stockAfter,
} from '../../src/lib/inventory.js'
import {
  makeQuote, makeQuoteLine, quoteTotals, quoteState, isLiveQuote,
  compareQuotes, paidHistory, priceList, quoteBook, receiptsFromQuote,
  QUOTE_STATUS_IDS, GST_RATES,
} from '../../src/lib/quotes.js'

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${e ? '  — ' + e : ''}`) }
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

console.log('\n── THE CATALOGUE ──')
eq('every trade is covered', MATERIAL_CATEGORY_IDS.length, 11)
ok('each has a label and a unit', MATERIAL_CATEGORY_IDS.every((k) => MATERIAL_CATEGORIES[k].label && MATERIAL_CATEGORIES[k].unit))
// A category quoting in a unit the stock module will not accept would silently
// fall back to `pcs`, and cement would be counted in pieces.
ok('every category quotes in a unit stock understands',
  MATERIAL_CATEGORY_IDS.every((k) => UNITS.includes(MATERIAL_CATEGORIES[k].unit)),
  MATERIAL_CATEGORY_IDS.filter((k) => !UNITS.includes(MATERIAL_CATEGORIES[k].unit)).join(', '))
ok('and every catalogue entry does too',
  CATALOGUE.every((c) => UNITS.includes(c.unit)),
  CATALOGUE.filter((c) => !UNITS.includes(c.unit)).map((c) => `${c.name}:${c.unit}`).join(', '))
ok('every entry belongs to a real trade',
  CATALOGUE.every((c) => MATERIAL_CATEGORIES[c.category]),
  CATALOGUE.filter((c) => !MATERIAL_CATEGORIES[c.category]).map((c) => c.name).join(', '))
ok('no two entries share a name', new Set(CATALOGUE.map((c) => c.name)).size === CATALOGUE.length)
ok('the materials a builder names first are all there',
  ['cement', 'steel', 'aggregate', 'joinery', 'plumbing', 'kitchen', 'equipment', 'finishes']
    .every((c) => catalogueFor(c).length > 0))
ok('a lift is in the catalogue', CATALOGUE.some((c) => /lift/i.test(c.name)))
ok('so are windows, doors, tiles and bathroom fittings',
  ['window', 'door', 'tile', 'basin'].every((w) => CATALOGUE.some((c) => new RegExp(w, 'i').test(c.name))))

console.log('\n── BULK AND FITTED ──')
// The distinction the whole module hangs off: sand is measured and some of it
// is lost; a lift is counted and either accepted or sent back.
ok('sand is bulk', isBulk({ category: 'aggregate' }))
ok('cement is bulk', isBulk({ category: 'cement' }))
ok('a door is fitted', isFitted({ category: 'joinery' }))
ok('a lift is fitted', isFitted({ category: 'equipment' }))
eq('an item from before categories existed still has one', categoryOf({}).id, UNCATEGORISED.id)
ok('and it is not dropped from the app', categoryOf({ category: 'nonsense' }).label === 'Uncategorised')

console.log('\n── PRE-FILLING FROM THE CATALOGUE ──')
eq('cement comes in bags', unitFor('cement'), 'bag')
eq('sand comes by the brass', unitFor('aggregate'), 'brass')
eq('steel by the kilo', unitFor('steel'), 'kg')
eq('an unknown trade falls back rather than breaking', unitFor('nonsense'), 'pcs')
const pre = fromCatalogue('Cement OPC 53 grade')
eq('picking a catalogue name fills the trade', pre.category, 'cement')
eq('and the unit', pre.unit, 'bag')
eq('and the HSN chapter, so nobody looks it up', pre.hsn, '2523')
eq('the name is matched however it was typed', fromCatalogue('  cement opc 53 GRADE ').category, 'cement')
eq('something not in the list is not invented', fromCatalogue('Unobtainium'), null)
// The catalogue is a convenience, not a constraint: an item made from it must
// survive the stock module unchanged.
const fromCat = makeItem({ entityId: 'e1', ...fromCatalogue('TMT bar 12mm Fe500') })
eq('an item built from a catalogue entry keeps its unit', fromCat.unit, 'kg')
eq('and its trade', fromCat.category, 'steel')

console.log('\n── OUT IS THREE THINGS, NOT ONE ──')
const cement = makeItem({ entityId: 'e1', name: 'Cement OPC 53', category: 'cement', unit: 'bag', reorderLevel: 20 })
const mv = []
const add = (o) => { const m = makeMovement({ itemId: cement.id, entityId: 'e1', ...o }); mv.push(m); return m }
add({ kind: 'receipt', qty: 100, unitCost: 350, date: '2026-01-05', vendor: 'Shree Traders' })
add({ kind: 'receipt', qty: 100, unitCost: 450, date: '2026-02-05', vendor: 'Shree Traders' })
let s = stockOf(cement, mv)
eq('two receipts, weighted average', s.avgCost, 400)

// A rejection reverses the delivery it came from. It comes off at the invoiced
// rate, not the blended average, because the credit note has to match the bill.
add({ kind: 'rejected', qty: 10, unitCost: 450, date: '2026-02-06', reason: 'set hard in transit', vendor: 'Shree Traders' })
s = stockOf(cement, mv)
eq('rejected material leaves the shelf', s.qty, 190)
eq('at the rate it was invoiced at', s.value, 75500)
eq('and the claim against the vendor is that same figure', s.rejectedValue, 4500)
eq('rejections are counted apart from everything else', s.rejected, 10)
eq('as a share of what was delivered', s.rejectionPercent, 5)
// The distinction that costs money if it is missed.
eq('and a rejection is not wastage', s.wasted, 0)
eq('nor an issue', s.issued, 0)
eq('so nothing has been charged to the job yet', s.consumed, 0)

add({ kind: 'issue', qty: 60, date: '2026-03-01' })
add({ kind: 'wastage', qty: 6, date: '2026-03-04', note: 'burst bags' })
s = stockOf(cement, mv)
eq('issues are what went into the building', s.issued, 60)
eq('wastage is what did not', s.wasted, 6)
eq('together they are what the job consumed', s.consumed, 66)
eq('and the wastage rate follows', s.wastagePercent, 9.1)
eq('what was received is still the gross figure', s.received, 200)
eq('and what it cost', s.receivedValue, 80000)

// Rejected with no rate: the average is all there is, and the claim is
// approximate rather than absent.
const noRate = [
  makeMovement({ itemId: 'x', entityId: 'e1', kind: 'receipt', qty: 10, unitCost: 100, date: '2026-01-01' }),
  makeMovement({ itemId: 'x', entityId: 'e1', kind: 'rejected', qty: 2, date: '2026-01-02' }),
]
const nr = stockOf({ id: 'x', reorder_level: 0 }, noRate)
eq('a rejection with no rate falls back to the average', nr.rejectedValue, 200)
eq('and the stock follows it down', nr.value, 800)
eq('nothing went out with no movements at all', stockOf({ id: 'zz', reorder_level: 0 }, []).consumed, 0)
eq('and there is no percentage to invent', stockOf({ id: 'zz', reorder_level: 0 }, []).wastagePercent, null)
ok('rejected is one of the kinds a form can offer', Boolean(MOVEMENT_KINDS.rejected))
ok('and it is marked as claimable', MOVEMENT_KINDS.rejected.returnable === true)

console.log('\n── WHAT IT COST TO GET IT HERE ──')
// A lorry of sand is two bills: the sand and the trip. On bulk materials the
// trip can be a fifth of it, and a stock value built from the invoice rate
// alone understates the job by exactly that much.
const sand = makeItem({ entityId: 'e1', name: 'River sand', category: 'aggregate', unit: 'brass' })
const load = [makeMovement({
  itemId: sand.id, entityId: 'e1', kind: 'receipt', qty: 10, unitCost: 4500,
  otherCost: 9000, date: '2026-01-10', vendor: 'Kokan Sand',
})]
const ls = stockOf(sand, load)
eq('freight lands in the value of the stock', ls.value, 54000)
eq('so the average cost is what it really cost', ls.avgCost, 5400)
eq('and what of it was carriage is still visible', ls.carriage, 9000)
eq('a delivery with no freight is unchanged', stockOf(sand, [makeMovement({
  itemId: sand.id, entityId: 'e1', kind: 'receipt', qty: 10, unitCost: 4500, date: '2026-01-10',
})]).value, 45000)
// The identity closing = opening + in − out only holds if a period values a
// receipt the same way the shelf does.
const sandPeriod = stockOverPeriod([sand], load, { from: '2026-01-01', to: '2026-01-31' })
eq('a period counts the landed figure too', sandPeriod.receivedValue, 54000)
eq('so nothing is reported as consumed that was not', sandPeriod.consumedValue, 0)
// Freight is not refunded when the material goes back — the lorry came either
// way — so a rejection reverses the rate and leaves the trip on the job.
const partlyBack = stockOf(sand, [...load, makeMovement({
  itemId: sand.id, entityId: 'e1', kind: 'rejected', qty: 2, unitCost: 4500, date: '2026-01-12',
})])
eq('a rejection claims back the material', partlyBack.rejectedValue, 9000)
eq('and the freight stays on the job', partlyBack.value, 45000)

console.log('\n── THE REPORT ──')
const steel = makeItem({ entityId: 'e1', name: 'TMT 12mm', category: 'steel', unit: 'kg' })
const smv = [
  makeMovement({ itemId: steel.id, entityId: 'e1', kind: 'receipt', qty: 1000, unitCost: 60, date: '2026-01-10' }),
  makeMovement({ itemId: steel.id, entityId: 'e1', kind: 'issue', qty: 400, date: '2026-02-10', projectId: 'site-a' }),
]
const rep = stockReport([cement, steel], [...mv, ...smv])
eq('the stock value is the shelf', rep.totalValue, stockOf(cement, mv).value + stockOf(steel, smv).value)
// Kept out of the stock value on purpose: this is a receivable from a supplier,
// not an asset on the shelf.
eq('what suppliers owe back is its own figure', rep.rejectedValue, 4500)
eq('and how many materials have a rejection at all', rep.itemsRejected, 1)

console.log('\n── GROUPED BY TRADE ──')
const groups = byCategory(rep.lines)
eq('two trades are in play', groups.length, 2)
// Ordered as a job consumes them: structure before finishes, not alphabetically.
eq('cement comes before steel, as a job does them', groups.map((g) => g.category.id), ['cement', 'steel'])
eq('each trade carries its own value', groups[0].value, stockOf(cement, mv).value)
eq('and its own claim against suppliers', groups[0].rejectedValue, 4500)
eq('an empty shelf groups into nothing', byCategory([]).length, 0)
eq('uncategorised stock still gets a heading',
  byCategory([{ item: { id: 'q' }, value: 10, rejectedValue: 0 }])[0].category.label, 'Uncategorised')

console.log('\n── A YARD AND A STORE ON EVERY SITE ──')
// Two different questions, and folding them into one field is a mistake that
// looks harmless until a site issues material out of the yard:
//   where the material physically is, and which job is paying for it.
const rebar = makeItem({ entityId: 'e1', name: 'TMT 16mm', category: 'steel', unit: 'kg' })
const yard = [
  makeMovement({ itemId: rebar.id, entityId: 'e1', kind: 'receipt', qty: 1000, unitCost: 60, date: '2026-01-01' }),
]
eq('a delivery with no store named lands in the yard', stockAt(rebar, yard, CENTRAL).qty, 1000)
ok('which is what every movement written before there were stores says', isCentral(null) && isCentral(CENTRAL))
eq('and the company total is the same figure', stockOf(rebar, yard).qty, 1000)
eq('with nothing on any site', stockOf(rebar, yard).onSites, 0)

// Delivered direct to site: the lorry never sees the yard.
const direct = [...yard, makeMovement({
  itemId: rebar.id, entityId: 'e1', kind: 'receipt', qty: 500, unitCost: 64, date: '2026-01-05', storeId: 'site-a',
})]
eq('a delivery to a site lands there', stockAt(rebar, direct, 'site-a').qty, 500)
eq('and not in the yard', stockAt(rebar, direct, CENTRAL).qty, 1000)
eq('the company holds both', stockOf(rebar, direct).qty, 1500)
eq('each store keeps its own average', stockAt(rebar, direct, 'site-a').avgCost, 64)
eq('and the yard keeps its own', stockAt(rebar, direct, CENTRAL).avgCost, 60)
// One company-wide average would move a site's stock value every time an
// unrelated delivery landed somewhere else.
ok('which are not the same number', stockAt(rebar, direct, 'site-a').avgCost !== stockAt(rebar, direct, CENTRAL).avgCost)

console.log('\n── MOVING IT ──')
const moved = [...direct, makeMovement({
  itemId: rebar.id, entityId: 'e1', kind: 'transfer', qty: 400, date: '2026-01-10',
  storeId: CENTRAL, toStoreId: 'site-b',
})]
const afterMove = stockOf(rebar, moved)
eq('the yard is lighter', stockAt(rebar, moved, CENTRAL).qty, 600)
eq('the site is heavier', stockAt(rebar, moved, 'site-b').qty, 400)
// The company did not buy anything, so the company did not gain anything.
eq('and the company total has not moved', afterMove.qty, 1500)
eq('nor its value', afterMove.value, stockOf(rebar, direct).value)
// The transfer note says what the yard's stock was worth, and that is what the
// receiving site is now holding.
eq('the value travels at the sending store’s average', stockAt(rebar, moved, 'site-b').value, 24000)
eq('a transfer is not consumption', afterMove.consumed, 0)
eq('nor is it a receipt', afterMove.received, 1500)
eq('it is counted as what it is', afterMove.transferred, 400)

console.log('\n── WHERE IT ALL IS ──')
const placed = stockOf(rebar, moved)
eq('every store with something in it is listed', placed.byLocation.filter((l) => l.qty !== 0).length, 3)
// The line everyone reads first, so it does not move around.
eq('the yard leads whatever it holds', placed.byLocation[0].locationId, null)
eq('the yard holds this much', placed.central.qty, 600)
eq('the sites between them hold the rest', placed.onSites, 900)
eq('and that is worth this much', placed.onSitesValue, round2(placed.value - placed.central.value))
eq('two sites are holding stock', placed.sites, 2)
eq('a store nobody used is not invented', stockAt(rebar, moved, 'site-zzz').qty, 0)

console.log('\n── ISSUING FROM WHEREVER IT IS ──')
// The case the two fields exist for: material issued straight out of the yard
// to a job. The yard loses it and the job is charged for it, and both are true
// at once.
const issuedFromYard = [...moved, makeMovement({
  itemId: rebar.id, entityId: 'e1', kind: 'issue', qty: 100, date: '2026-01-20',
  storeId: CENTRAL, projectId: 'site-a',
})]
eq('the yard loses it', stockAt(rebar, issuedFromYard, CENTRAL).qty, 500)
eq('site A’s own store is untouched', stockAt(rebar, issuedFromYard, 'site-a').qty, 500)
eq('and site A is charged for it', usageBySite([rebar], issuedFromYard, { projects: [] })
  .find((u) => u.projectId === 'site-a').value, 6000)

// And the other way: a site issuing from its own store.
const issuedOnSite = [...moved, makeMovement({
  itemId: rebar.id, entityId: 'e1', kind: 'issue', qty: 100, date: '2026-01-20',
  storeId: 'site-a', projectId: 'site-a',
})]
eq('the site’s own store falls', stockAt(rebar, issuedOnSite, 'site-a').qty, 400)
eq('the yard is untouched', stockAt(rebar, issuedOnSite, CENTRAL).qty, 600)
// At 64, not 60: it is charged what that store paid.
eq('and it is charged at its own store’s rate',
  usageBySite([rebar], issuedOnSite, { projects: [] }).find((u) => u.projectId === 'site-a').value, 6400)

console.log('\n── A SITE THAT ISSUED WHAT IT NEVER RECEIVED ──')
// A stores control finding, not an error to swallow. The company can be square
// overall and still have a site short, and that is exactly worth seeing.
const short = [...yard, makeMovement({
  itemId: rebar.id, entityId: 'e1', kind: 'issue', qty: 50, date: '2026-02-01',
  storeId: 'site-c', projectId: 'site-c',
})]
const shortLine = stockOf(rebar, short)
eq('the site goes short', stockAt(rebar, short, 'site-c').qty, -50)
ok('and is flagged', stockAt(rebar, short, 'site-c').negative)
ok('the item is flagged even though the company has plenty', shortLine.negative && shortLine.qty > 0,
  `${shortLine.qty}`)
eq('the value of a store cannot go below nothing', stockAt(rebar, short, 'site-c').value, 0)
// Transferring out more than a store holds cannot invent value at the far end.
const overMove = [...yard, makeMovement({
  itemId: rebar.id, entityId: 'e1', kind: 'transfer', qty: 200, date: '2026-02-01',
  storeId: 'site-d', toStoreId: 'site-e',
})]
eq('a transfer out of an empty store moves no value', stockAt(rebar, overMove, 'site-e').value, 0)
ok('and the empty store is flagged', stockAt(rebar, overMove, 'site-d').negative)

console.log('\n── THE REPORT, BY STORE ──')
const storeRep = stockReport([rebar], moved)
eq('the company total is the yard plus the sites', storeRep.totalValue, round2(storeRep.centralValue + storeRep.onSitesValue))
eq('and the yard leads', storeRep.byLocation[0].locationId, null)
eq('three stores hold something', storeRep.byLocation.filter((l) => l.value > 0).length, 3)
eq('an empty company has a yard all the same', stockReport([], []).byLocation.length, 0)
ok('a transfer is one row, not two',
  MOVEMENT_KINDS.transfer.direction === 'move' && MOVEMENT_KINDS.transfer.sign === 0)

console.log('\n── WHICH SITE BURNED IT ──')
const sites = [{ id: 'site-a', name: 'Marine Drive' }, { id: 'site-b', name: 'Powai Annexe' }]
const used = [
  ...smv,
  makeMovement({ itemId: steel.id, entityId: 'e1', kind: 'issue', qty: 200, date: '2026-02-11', projectId: 'site-b' }),
  makeMovement({ itemId: steel.id, entityId: 'e1', kind: 'wastage', qty: 50, date: '2026-02-12', projectId: 'site-a' }),
  makeMovement({ itemId: steel.id, entityId: 'e1', kind: 'issue', qty: 30, date: '2026-02-13' }),
  makeMovement({ itemId: steel.id, entityId: 'e1', kind: 'receipt', qty: 100, unitCost: 60, date: '2026-02-01' }),
  makeMovement({ itemId: steel.id, entityId: 'e1', kind: 'rejected', qty: 10, unitCost: 60, date: '2026-02-02', projectId: 'site-a' }),
]
const usage = usageBySite([steel], used, { projects: sites })
eq('three places consumed steel', usage.length, 3)
eq('the biggest consumer leads', usage[0].projectId, 'site-a')
eq('its issues are counted', usage[0].issued, 400)
eq('and its wastage separately', usage[0].wasted, 50)
// A receipt is not consumption and neither is a rejection — one arrived and the
// other went back. Only what was issued or lost belongs to a site.
eq('a rejection is not charged to the site', usage[0].issued + usage[0].wasted, 450)
ok('material nobody booked to a site is still shown',
  usage.some((u) => u.projectId === null), usage.map((u) => u.projectId).join(','))
eq('the site name is resolved for the report', usage[0].project.name, 'Marine Drive')
eq('nothing issued is no rows at all', usageBySite([steel], [], { projects: sites }).length, 0)

// The case a current-average shortcut gets wrong, and the one that matters
// most: a material issued down to nothing has no stock left, so its average is
// zero. Valued that way, the job that consumed every last kilo is reported as
// having consumed nothing — and a site that used the whole lot is exactly the
// site you are looking for.
const gone = makeItem({ entityId: 'e1', name: 'Cement, all of it', category: 'cement', unit: 'bag' })
const emptied = [
  makeMovement({ itemId: gone.id, entityId: 'e1', kind: 'receipt', qty: 500, unitCost: 400, date: '2026-01-01' }),
  makeMovement({ itemId: gone.id, entityId: 'e1', kind: 'issue', qty: 500, date: '2026-01-15', projectId: 'site-a' }),
]
eq('there is none left on the shelf', stockOf(gone, emptied).qty, 0)
eq('and no average cost to multiply by', stockOf(gone, emptied).avgCost, 0)
const spentIt = usageBySite([gone], emptied, { projects: sites })
eq('yet the site is charged what it actually used', spentIt[0].value, 200000)

// Two deliveries at different rates: what the site is charged depends on when
// it drew the material, not on where the average ended up.
const moving = makeItem({ entityId: 'e1', name: 'Steel, two rates', category: 'steel', unit: 'kg' })
const drawn = [
  makeMovement({ itemId: moving.id, entityId: 'e1', kind: 'receipt', qty: 100, unitCost: 50, date: '2026-01-01' }),
  makeMovement({ itemId: moving.id, entityId: 'e1', kind: 'issue', qty: 100, date: '2026-01-05', projectId: 'site-a' }),
  makeMovement({ itemId: moving.id, entityId: 'e1', kind: 'receipt', qty: 100, unitCost: 90, date: '2026-02-01' }),
  makeMovement({ itemId: moving.id, entityId: 'e1', kind: 'issue', qty: 100, date: '2026-02-05', projectId: 'site-b' }),
]
const twoRates = usageBySite([moving], drawn, { projects: sites })
eq('the site that drew early pays the early rate',
  twoRates.find((u) => u.projectId === 'site-a').value, 5000)
eq('and the one that drew later pays the later one',
  twoRates.find((u) => u.projectId === 'site-b').value, 9000)
// Freight is part of what the material cost, so it is part of what the job is
// charged.
const carried = usageBySite([sand], [
  ...load,
  makeMovement({ itemId: sand.id, entityId: 'e1', kind: 'issue', qty: 10, date: '2026-01-20', projectId: 'site-a' }),
], { projects: sites })
eq('a site is charged the landed cost, freight included', carried[0].value, 54000)

console.log('\n── THE MOVEMENT LOG ──')
const log = movementLog([cement, steel], [...mv, ...used])
ok('the newest movement is first', log[0].movement.date >= log[log.length - 1].movement.date)
ok('every row knows its material', log.every((l) => l.item))
ok('and how the kind should read', log.every((l) => l.kind.label))
eq('it can be narrowed to one kind', movementLog([cement, steel], [...mv, ...used], { kind: 'rejected' }).length, 2)
eq('or to one site', movementLog([steel], used, { projectId: 'site-b' }).length, 1)
eq('or to one material', movementLog([cement, steel], [...mv, ...used], { itemId: cement.id }).length, mv.length)
eq('and it is capped', movementLog([cement, steel], [...mv, ...used], { limit: 3 }).length, 3)

console.log('\n── A PERIOD ──')
const period = stockOverPeriod([cement], mv, { from: '2026-02-01', to: '2026-03-31' })
// Without taking rejections out, returned material is charged to the job as if
// it had been built into the building.
eq('what went back to the supplier is its own line', period.rejectedValue, 4500)
ok('and is not counted as consumed',
  period.consumedValue === Math.round((period.openingValue + period.receivedValue - period.rejectedValue - period.closingValue) * 100) / 100,
  String(period.consumedValue))

console.log('\n── QUOTES ──')
const q1 = makeQuote({
  entityId: 'e1', vendor: 'Shree Traders', date: '2026-04-01', validUntil: '2026-04-30', status: 'sent',
  lines: [makeQuoteLine({ itemId: cement.id, name: 'Cement OPC 53', qty: 100, rate: 380, unit: 'bag', gstPercent: 28 })],
})
const q2 = makeQuote({
  entityId: 'e1', vendor: 'Konkan Cement', date: '2026-04-02', validUntil: '2026-05-31', status: 'sent',
  lines: [makeQuoteLine({ itemId: cement.id, name: 'Cement OPC 53', qty: 100, rate: 400, unit: 'bag', gstPercent: 18 })],
})
const t1 = quoteTotals(q1)
eq('a quote adds up', t1.subtotal, 38000)
eq('with tax at the rate the trade charges', t1.tax, 10640)
eq('and a total', t1.total, 48640)
eq('an empty quote is zero, not a crash', quoteTotals({}).total, 0)
eq('a vendor with no name still has one', makeQuote({}).vendor, 'Unnamed vendor')
eq('a nonsense GST rate falls back', makeQuoteLine({ gstPercent: 37 }).gst_percent, 18)
ok('and every offered rate is one the tax law has', GST_RATES.every((r) => Number.isFinite(r)))
ok('every status has a label', QUOTE_STATUS_IDS.every((k) => k))
// A saved quote is read back as `item_id` and `gst_percent`, not as the names
// the form used. Re-making one must not quietly drop the material and reset the
// tax rate — the line would still be there, still look right, and be for
// nothing at the default rate.
const round = makeQuote(JSON.parse(JSON.stringify(q1)))
eq('a stored quote keeps its material when re-made', round.lines[0].item_id, cement.id)
eq('and its tax rate', round.lines[0].gst_percent, 28)
eq('and still adds up to the same money', quoteTotals(round).total, t1.total)

console.log('\n── THE CHEAPEST RATE IS NOT THE CHEAPEST QUOTE ──')
// ₹380 at 28% lands at ₹486.40; ₹400 at 18% lands at ₹472. Comparing the rate
// column alone picks the dearer vendor, which is how it is usually done.
const cmp = compareQuotes(cement.id, [q1, q2], { asOf: '2026-04-10' })
eq('both vendors are on the table', cmp.count, 2)
eq('the cheaper landed price wins', cmp.best.vendor, 'Konkan Cement')
ok('even though its rate is the higher one', cmp.best.rate > cmp.worst.rate, `${cmp.best.rate} vs ${cmp.worst.rate}`)
eq('the spread is what the choice is worth', cmp.spread, 14.4)
eq('as a percentage', cmp.spreadPercent, 3)
eq('a material nobody quoted for compares to nothing', compareQuotes('nope', [q1, q2]).count, 0)

console.log('\n── A QUOTE GOES OFF BY THE CALENDAR ──')
eq('inside its validity it stands', quoteState(q1, '2026-04-30'), 'sent')
eq('the day after, it has expired', quoteState(q1, '2026-05-01'), 'expired')
// Nobody marked it expired. A stored flag would be wrong every morning until
// somebody ran the job that sets it.
ok('and nothing was stored to say so', q1.status === 'sent')
eq('a quote with no validity never expires', quoteState(makeQuote({ status: 'sent' }), '2099-01-01'), 'sent')
eq('an accepted quote stays accepted past its date',
  quoteState({ ...q1, status: 'accepted' }, '2030-01-01'), 'accepted')
ok('an expired quote is not live', !isLiveQuote(q1, '2026-05-01'))
eq('and it drops out of the comparison',
  compareQuotes(cement.id, [q1, q2], { asOf: '2026-05-01' }).count, 1)
eq('unless the comparison is asked for everything',
  compareQuotes(cement.id, [q1, q2], { asOf: '2026-05-01', liveOnly: false }).count, 2)

console.log('\n── SOMEBODY TOOK THE DEARER ONE ──')
const chosen = compareQuotes(cement.id, [{ ...q1, status: 'accepted' }, q2], { asOf: '2026-04-10' })
ok('accepting the dearer quote is flagged', chosen.acceptedNotCheapest)
ok('accepting the cheapest is not',
  !compareQuotes(cement.id, [q1, { ...q2, status: 'accepted' }], { asOf: '2026-04-10' }).acceptedNotCheapest)
ok('and with nothing accepted there is nothing to flag', !cmp.acceptedNotCheapest)

console.log('\n── WHAT WAS ACTUALLY PAID ──')
const hist = paidHistory(cement.id, mv)
eq('only receipts carry a rate', hist.length, 2)
eq('oldest first', hist[0].rate, 350)
eq('and the vendor comes with it', hist[0].vendor, 'Shree Traders')
eq('an issue has no price of its own', paidHistory(steel.id, [smv[1]]).length, 0)

console.log('\n── THE PRICE LIST ──')
const prices = priceList([cement, steel], [...mv, ...smv], [q1, q2], { asOf: '2026-04-10' })
const line = prices.rows.find((r) => r.item.id === cement.id)
eq('what it last cost', line.lastRate, 450)
eq('from whom', line.lastVendor, 'Shree Traders')
// The number that explains why a job costed last year no longer adds up.
eq('and how far the rate has drifted since the first purchase', line.driftPercent, 28.6)
eq('the best live quote is on the same row', line.bestRate, 400)
eq('from the vendor offering it', line.bestVendor, 'Konkan Cement')
ok('so the company can see it is overpaying', line.cheaperAvailable)
eq('by this much', line.savingPercent, 11.1)
eq('the rows where that is true are counted', prices.cheaperAvailable, 1)
ok('and they sort to the top', prices.rows[0].item.id === cement.id)
const never = prices.rows.find((r) => r.item.id === steel.id)
ok('a material nobody quoted for is not called overpriced', !never.cheaperAvailable)
eq('material with neither a purchase nor a quote is counted as unpriced',
  priceList([makeItem({ name: 'Never bought' })], [], []).unpriced, 1)
eq('an empty price list is empty, not broken', priceList([], [], []).count, 0)

console.log('\n── THE QUOTE BOOK ──')
const stale = makeQuote({ vendor: 'Old', date: '2025-12-01', validUntil: '2026-01-01', status: 'sent' })
const book = quoteBook([q1, q2, stale], { asOf: '2026-04-10' })
eq('every quote is listed', book.count, 3)
eq('newest first', book.lines[0].quote.vendor, 'Konkan Cement')
eq('two are still awaiting a decision', book.awaiting, 2)
// Each one is a purchase that now has to be re-quoted — the cost of not having
// looked.
eq('and one ran out while nobody decided', book.expired, 1)
eq('what is on the table is totalled', book.awaitingValue, quoteTotals(q1).total + quoteTotals(q2).total)
eq('filtering by vendor works', quoteBook([q1, q2], { vendor: 'Konkan Cement' }).count, 1)
eq('an empty book is zero', quoteBook([]).count, 0)

console.log('\n── ACCEPTING A QUOTE ──')
// Accepting does not move stock: the material has not arrived. What it produces
// is the receipt the delivery will be booked against, at the agreed rate.
const recs = receiptsFromQuote({ ...q2, status: 'accepted' }, { entityId: 'e1', date: '2026-04-15' })
eq('one receipt per line', recs.length, 1)
eq('at the rate that was agreed', recs[0].unitCost, 400)
eq('for the quantity quoted', recs[0].qty, 100)
eq('against the vendor who quoted it', recs[0].vendor, 'Konkan Cement')
const built = makeMovement(recs[0])
eq('and it is a movement the stock module accepts', built.kind, 'receipt')
eq('carrying the vendor through', built.vendor, 'Konkan Cement')
eq('a line for something not stocked produces no receipt',
  receiptsFromQuote(makeQuote({ lines: [makeQuoteLine({ name: 'Loose item', qty: 1, rate: 5 })] })).length, 0)

console.log('\n── CORRECTING WHAT IS ALREADY RECORDED ──')
// None of this could be touched once entered, and a receipt booked at the wrong
// rate is worse here than a wrong figure elsewhere: stock is valued at a moving
// average, so one bad rate quietly reprices every issue after it and the job
// costs that follow are all a little wrong with nothing to point at.
const fix = makeItem({ entityId: 'e1', name: 'Cement', unit: 'bag' })
const fixMoves = [
  makeMovement({ entityId: 'e1', itemId: fix.id, kind: 'receipt', qty: 500, unitCost: 400, date: '2026-01-01', storeId: 'site-a', projectId: 'site-a' }),
  makeMovement({ entityId: 'e1', itemId: fix.id, kind: 'issue', qty: 300, date: '2026-02-01', storeId: 'site-a', projectId: 'site-a' }),
]
// The name and the reorder level are free. The unit is not, once anything has
// moved: a hundred bags that become a hundred kilos are still a hundred, and
// every quantity in the history silently changes meaning. There is no
// conversion to do, because none of the numbers are wrong — only what they
// count.
ok('a material can be renamed whatever has moved', canAmendItem(fix, fixMoves, { name: 'Cement OPC 53' }).ok)
ok('but its unit cannot, once it has moved', !canAmendItem(fix, fixMoves, { unit: 'kg' }).ok)
ok('and says how many movements count on it', /2 movements/.test(canAmendItem(fix, fixMoves, { unit: 'kg' }).why),
  canAmendItem(fix, fixMoves, { unit: 'kg' }).why)
ok('and why it is not a conversion', /change what every quantity in the history means/.test(canAmendItem(fix, fixMoves, { unit: 'kg' }).why), '')
// The control: the guard is on the movements, not on the field.
ok('a material nobody has moved can change unit freely', canAmendItem(fix, [], { unit: 'kg' }).ok)
ok('and keeping the same unit is never refused', canAmendItem(fix, fixMoves, { unit: 'bag' }).ok)
// Deleting: a movement pointing at a material that is not there is a quantity
// of nothing that still carries value into the stock total.
ok('a material with movements cannot be deleted', !canRemoveItem(fix, fixMoves).ok)
ok('which says to delete those first', /Delete those first/.test(canRemoveItem(fix, fixMoves).why), canRemoveItem(fix, fixMoves).why)
ok('an unused one can be', canRemoveItem(fix, []).ok)
ok('and movements on a different material do not count',
  canRemoveItem(makeItem({ entityId: 'e1', name: 'Sand', unit: 'cft' }), fixMoves).ok)

console.log('\n── AND WHAT A CORRECTION DOES TO THE BALANCE ──')
// Negative stock is not forbidden — a store that has issued more than it was
// sent is a real thing and the attention list says so rather than the app
// refusing an entry and losing it. But somebody about to make one should hear
// it before rather than after.
const now = stockOf(fix, fixMoves)
eq('two hundred bags on hand', now.qty, 200)
const pull = stockAfter(fix, fixMoves, { remove: fixMoves[0].id })
eq('deleting the receipt leaves minus three hundred', pull.after.qty, -300)
eq('a store goes short that was not', pull.newlyShort.length, 1)
eq('and it was not short before', pull.wasShort.length, 0)
// The control: deleting the issue instead takes stock up, not down.
const undo = stockAfter(fix, fixMoves, { remove: fixMoves[1].id })
eq('deleting the issue leaves the full five hundred', undo.after.qty, 500)
eq('and nothing goes short', undo.newlyShort.length, 0)
// The bad rate, which is the case this is really for — and the arithmetic that
// makes it so hard to spot. Repricing a 500-bag receipt by ₹50 moves the books
// by ₹25,000, but only ₹10,000 of that is still on the shelf: the other
// ₹15,000 went out with the 300 bags already issued and is sitting in a job
// cost nobody is looking at.
const repriced = stockAfter(fix, fixMoves, { replace: { ...fixMoves[0], unit_cost: 450 } })
eq('repricing the receipt moves what is on hand by the bags still there', repriced.value, 200 * 50)
ok('which is less than the receipt moved by', repriced.value < 500 * 50, String(repriced.value))
eq('and not the quantity at all', repriced.qty, 0)
// Already short stays already short: telling somebody they caused it would be
// wrong, and is the kind of noise that teaches people to click through
// warnings.
const alreadyShort = [
  makeMovement({ entityId: 'e1', itemId: fix.id, kind: 'receipt', qty: 100, unitCost: 400, date: '2026-01-01' }),
  makeMovement({ entityId: 'e1', itemId: fix.id, kind: 'issue', qty: 50, date: '2026-02-01', storeId: 'site-b', projectId: 'site-b' }),
]
ok('a store already short is not blamed on the change',
  stockAfter(fix, alreadyShort, { remove: alreadyShort[0].id }).newlyShort.length === 0,
  JSON.stringify(stockAfter(fix, alreadyShort, { remove: alreadyShort[0].id })))
ok('though it is still reported as short', stockAfter(fix, alreadyShort, { remove: alreadyShort[0].id }).goesShort.length > 0, '')

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
