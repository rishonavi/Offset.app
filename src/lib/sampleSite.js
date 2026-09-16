// A builder's books to look at before you have your own.
//
// The portfolio in `sampleData.js` is a landlord's: two flats, a car, and a
// year of rent. Loading it into a construction company's ledger would put
// assets a builder does not own into totals that are supposed to be about
// jobs — the invented-asset problem with a button on it. So a company gets
// this instead, and gets offered nothing at all until it existed.
//
// What it is for is showing the distinctions the app is built around, because
// an empty screen shows none of them:
//
//   · a yard and a store on every site, with material moving between them
//   · rejected material leaving the job's cost rather than sitting in it
//   · a running account stated to date, not bill by bill
//   · progress weighted by value, so a cheap stage finishing is not "half done"
//   · a machine idle because the slab was not ready, told apart from one broken
//   · what a flat has been sold for against what has actually been banked
//   · a job over its costing and still making money, which is not a paradox
//   · a cost booked to nothing at all, which is what an overhead is
//
// Same two rules as the landlord's portfolio. Every row is tagged, so removing
// it takes out exactly what it put in. And it refuses to run where there is
// anything real, because merging demo rows into somebody's books is the one
// outcome nobody would forgive.

import { subDays, format } from 'date-fns'
import { makeProject } from './projects'
import { makeItem, makeMovement } from './inventory'
import { makeMuster } from './labour'
import { makeWorkOrder, makeRaBill } from './subcontract'
import { makeQuote, makeQuoteLine } from './quotes'
import { makeWorkItem, makeMeasurement } from './progress'
import { makePlant, makePlantLog } from './plant'
import { makeUnit, makePlanStage, makeReceipt } from './sales'
import { isSampleRow, tag as tagEntry } from './sampleData'

export { isSampleRow }

// Corporate rows live in localStorage and are read back by this app only, so
// the flag alone is enough and the notes field stays free for the text a demo
// is actually meant to show. Entries go to the personal backend and keep the
// belt-and-braces tag `sampleData.js` gives them.
const tag = (row) => ({ ...row, is_sample: true })

const day = (n) => format(subDays(new Date(), n), 'yyyy-MM-dd')
const ahead = (n) => format(subDays(new Date(), -n), 'yyyy-MM-dd')

// ── The jobs ────────────────────────────────────────────────────────
// Three, because one site cannot show the two things a second site is for:
// material moving between stores, and a job that finished over its costing
// sitting next to ones that have not finished at all.
function sites(entityId) {
  return [
    makeProject({
      entityId,
      id: 'sample-site-md',
      name: 'Marine Drive Tower',
      code: 'MD-1',
      client: 'Navi Realty LLP',
      siteAddress: 'Plot 14, Sector 30A, Vashi, Navi Mumbai',
      contractValue: 120000000,
      estimate: 96000000,
      startedOn: day(300),
      dueOn: ahead(120),
      status: 'active',
      notes: 'G+12 residential, two shops at podium level.',
    }),
    makeProject({
      entityId,
      id: 'sample-site-pg',
      name: 'Palm Grove Villas',
      code: 'PG-2',
      client: 'Palm Grove Developers',
      siteAddress: 'Survey 88, Kamothe, Panvel',
      contractValue: 45000000,
      estimate: 38000000,
      startedOn: day(150),
      dueOn: ahead(60),
      status: 'active',
      notes: 'Eight row houses, structure done, finishing under way.',
    }),
    // Finished, and finished over what it was costed at — while still paying.
    // The contract and the estimate answer different questions, and a screen
    // showing one figure answers neither.
    makeProject({
      entityId,
      id: 'sample-site-hv',
      name: 'Hill View Bungalow',
      code: 'HV-3',
      client: 'Dr. A. Kulkarni',
      siteAddress: 'Lonavala',
      contractValue: 8500000,
      estimate: 6500000,
      startedOn: day(520),
      dueOn: day(60),
      status: 'completed',
      notes: 'Handed over. Ran past its costing on stone and joinery.',
    }),
  ]
}

// ── What is in stock, and where ─────────────────────────────────────
const MATERIALS = [
  { id: 'sample-item-steel',  name: 'TMT bars 12mm',              category: 'steel',       unit: 'kg',    reorderLevel: 2000, brand: 'Tata Tiscon', sku: 'TMT-12', hsn: '7214' },
  { id: 'sample-item-cement', name: 'OPC 53 grade cement',        category: 'cement',      unit: 'bag',   reorderLevel: 200,  brand: 'UltraTech',   sku: 'CEM-53', hsn: '2523' },
  { id: 'sample-item-sand',   name: 'River sand',                 category: 'aggregate',   unit: 'brass', reorderLevel: 5,    brand: '',            sku: 'SND-R',  hsn: '2505' },
  { id: 'sample-item-block',  name: 'AAC blocks 600×200×150',     category: 'masonry',     unit: 'nos',   reorderLevel: 500,  brand: 'Biltech',     sku: 'AAC-150', hsn: '6810' },
  { id: 'sample-item-tile',   name: 'Vitrified tiles 600×600',    category: 'finishes',    unit: 'sqft',  reorderLevel: 400,  brand: 'Kajaria',     sku: 'VIT-600', hsn: '6907' },
  { id: 'sample-item-door',   name: 'Flush door 32mm with frame', category: 'joinery',     unit: 'nos',   reorderLevel: 10,   brand: 'Greenply',    sku: 'DR-32',  hsn: '4418' },
  { id: 'sample-item-cp',     name: 'CP fittings set — bathroom', category: 'plumbing',    unit: 'nos',   reorderLevel: 4,    brand: 'Jaquar',      sku: 'CP-SET', hsn: '3922' },
  { id: 'sample-item-lift',   name: 'Passenger lift — 8 person',  category: 'equipment',   unit: 'nos',   reorderLevel: 0,    brand: 'Johnson',     sku: 'LFT-8',  hsn: '8428' },
]

const MD = 'sample-site-md'
const PG = 'sample-site-pg'
const HV = 'sample-site-hv'

// Receipts land in the yard. Transfers move stock to a site's own store at the
// yard's average cost. Issues charge the job. Rejections leave again at what
// they came in at, and wastage does not.
//
// The quantities are chosen so that no store is ever short — a negative
// balance is a thing the app reports, and a demo that arrives already
// reporting it teaches the wrong lesson.
const MOVES = [
  // Steel
  ['sample-item-steel',  'receipt',  25000, 62,  120, null, null, 'Shakti Steel & Alloys', '', 8000],
  ['sample-item-steel',  'transfer', 15000, 0,   118, null, MD],
  ['sample-item-steel',  'issue',     9000, 0,   100, MD,   null, '', '', 0, MD],
  ['sample-item-steel',  'receipt',  10000, 65,   60, null, null, 'Shakti Steel & Alloys', '', 3500],
  ['sample-item-steel',  'rejected',   800, 65,   58, null, null, 'Shakti Steel & Alloys', 'Surface rust on two bundles — returned'],
  ['sample-item-steel',  'transfer',  6000, 0,    55, null, MD],
  ['sample-item-steel',  'issue',     7000, 0,    40, MD,   null, '', '', 0, MD],
  // The emergency lorry. Ordered on a Saturday when the 9th slab could not
  // wait, at a rate nobody would have agreed to on a Monday — and the only
  // place it shows is in a column of receipts nobody reads down.
  ['sample-item-steel',  'receipt',   4000, 74,   30, null, null, 'Mahalaxmi Iron & Steel', 'Slab could not wait — spot purchase', 2000],
  ['sample-item-steel',  'receipt',   8000, 66,   12, null, null, 'Shakti Steel & Alloys', '', 3000],
  // Cement
  ['sample-item-cement', 'receipt',   4000, 385, 110, null, null, 'UltraTech — Vashi dealer', '', 6000],
  ['sample-item-cement', 'transfer',  2500, 0,   108, null, MD],
  ['sample-item-cement', 'issue',     2200, 0,    90, MD,   null, '', '', 0, MD],
  ['sample-item-cement', 'receipt',   3000, 398,  50, null, null, 'UltraTech — Vashi dealer', '', 5200],
  ['sample-item-cement', 'transfer',   900, 0,    48, null, PG],
  ['sample-item-cement', 'transfer',  2000, 0,    46, null, MD],
  ['sample-item-cement', 'issue',     1900, 0,    30, MD,   null, '', '', 0, MD],
  ['sample-item-cement', 'wastage',     40, 0,    29, MD,   null, '', 'Bags set hard — godown leaked in the rain', 0, MD],
  ['sample-item-cement', 'issue',      700, 0,    20, PG,   null, '', '', 0, PG],
  // Dearer than the last, and not by enough to be a spike. A rising market
  // moves the norm with it, and a check that shouted about this would teach
  // people to stop reading it.
  ['sample-item-cement', 'receipt',   2500, 412,  18, null, null, 'UltraTech — Vashi dealer', '', 4400],
  // Sand
  ['sample-item-sand',   'receipt',    120, 4200, 100, null, null, 'Konkan Aggregates', '', 14000],
  ['sample-item-sand',   'transfer',    70, 0,     98, null, MD],
  ['sample-item-sand',   'issue',       55, 0,     70, MD,  null, '', '', 0, MD],
  ['sample-item-sand',   'transfer',    30, 0,     60, null, PG],
  ['sample-item-sand',   'issue',       22, 0,     40, PG,  null, '', '', 0, PG],
  // Blocks
  ['sample-item-block',  'receipt',  12000, 48,    80, null, null, 'Biltech Building Elements', '', 22000],
  ['sample-item-block',  'transfer',  7000, 0,     78, null, MD],
  ['sample-item-block',  'issue',     6200, 0,     50, MD,  null, '', '', 0, MD],
  ['sample-item-block',  'wastage',    150, 0,     49, MD,  null, '', 'Broken unloading at the hoist', 0, MD],
  ['sample-item-block',  'transfer',  3000, 0,     40, null, PG],
  ['sample-item-block',  'issue',     2400, 0,     25, PG,  null, '', '', 0, PG],
  // Tiles — the rejection worth looking at: a whole lot sent back on shade.
  ['sample-item-tile',   'receipt',   9000, 68,    70, null, null, 'Kajaria — Turbhe', '', 9000],
  ['sample-item-tile',   'rejected',   400, 68,    66, null, null, 'Kajaria — Turbhe', 'Shade variation between boxes'],
  ['sample-item-tile',   'transfer',  5000, 0,     64, null, MD],
  ['sample-item-tile',   'issue',     4600, 0,     35, MD,  null, '', '', 0, MD],
  // Doors — deliberately run down below the reorder level.
  ['sample-item-door',   'receipt',     90, 3200,  55, null, null, 'Greenply Distributors', '', 4000],
  ['sample-item-door',   'transfer',    60, 0,     53, null, MD],
  ['sample-item-door',   'transfer',    26, 0,     50, null, PG],
  ['sample-item-door',   'issue',       58, 0,     18, MD,  null, '', '', 0, MD],
  ['sample-item-door',   'issue',       24, 0,     12, PG,  null, '', '', 0, PG],
  // CP fittings
  ['sample-item-cp',     'receipt',     60, 4800,  60, null, null, 'Jaquar — authorised dealer', '', 2500],
  ['sample-item-cp',     'transfer',    40, 0,     58, null, MD],
  ['sample-item-cp',     'issue',       38, 0,     20, MD,  null, '', '', 0, MD],
  // Lift
  ['sample-item-lift',   'receipt',      2, 1450000, 40, null, null, 'Johnson Lifts Pvt Ltd', '', 60000],
  ['sample-item-lift',   'transfer',     2, 0,       20, null, MD],
  ['sample-item-lift',   'issue',        1, 0,        5, MD, null, '', '', 0, MD],
]

function stock(entityId) {
  const items = MATERIALS.map((m) => makeItem({ entityId, ...m }))
  const movements = MOVES.map(
    ([itemId, kind, qty, unitCost, back, storeId, toStoreId, vendor = '', reason = '', otherCost = 0, projectId = null]) =>
      makeMovement({
        entityId, itemId, kind, qty, unitCost, date: day(back),
        storeId, toStoreId, projectId, vendor, reason, otherCost,
      }),
  )
  return { items, movements }
}

// ── The muster roll ─────────────────────────────────────────────────
// Headcount-days, which is how a site is actually counted: nobody is named,
// because nobody is named on the sheet the supervisor fills in either.
const CREW = [
  [MD, 'mason', 14, 850], [MD, 'helper', 22, 550], [MD, 'carpenter', 9, 900],
  [MD, 'barBender', 6, 880], [MD, 'supervisor', 2, 1400],
  [PG, 'mason', 6, 820], [PG, 'helper', 9, 540], [PG, 'tiler', 4, 800],
  // The same trade, the same fortnight, a hundred and fifty rupees apart. The
  // tower's finishing contractor is short of tilers and is paying to get them;
  // the villas are not. Both sites are perfectly consistent with themselves,
  // which is why nothing in the app could see it.
  [MD, 'tiler', 5, 950],
]

function musterRoll(entityId) {
  const rows = []
  // Three weeks of working days, Sundays skipped the way a site skips them.
  const days = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20]
  for (const back of days) {
    for (const [projectId, trade, headcount, rate] of CREW) {
      // Numbers move about. A flat line for three weeks is not a muster roll,
      // it is a placeholder.
      const n = Math.max(1, headcount - (back % 4) + (back % 3))
      // Every seventh day back, except the list of working days has no
      // multiple of seven in it — so this was false on every row ever built and
      // the overtime column of the demo was flat zero. Found by writing a
      // roll-up assertion about overtime and noticing it could not fail.
      const overtime = back % 6 === 0 && trade === 'mason'
      rows.push(makeMuster({
        entityId, projectId, date: day(back), trade, headcount: n, rate,
        overtimeHours: overtime ? 3 : 0,
        overtimeRate: overtime ? Math.round(rate / 8 * 1.5) : 0,
        contractor: projectId === MD ? 'Deepak Labour Contractor' : 'Sai Labour Supply',
      }))
    }
  }
  return rows
}

// ── Subcontractors, billed to date ──────────────────────────────────
// The bills are cumulative: each states the total certified so far, and what
// is payable is the difference from the last one. Entering them as separate
// amounts is the single most common way a builder pays twice.
function contracts(entityId) {
  const orders = [
    makeWorkOrder({
      entityId, id: 'sample-wo-rcc', projectId: MD,
      contractor: 'Ganesh Construction Co.',
      // A partnership firm, so two per cent is what 194C asks for — and the
      // order says one. Deducting the individual rate from a firm is the
      // commonest way this goes wrong, and no screen has ever compared the two.
      pan: 'AAGFG1234K', deducteeType: 'other',
      scope: 'RCC shuttering, reinforcement and casting — podium to 8th slab',
      orderValue: 18500000, pricing: 'rate', retentionPercent: 5, tdsPercent: 1,
      startedOn: day(260), dueOn: ahead(90), status: 'running', ref: 'WO/MD/01',
    }),
    makeWorkOrder({
      entityId, id: 'sample-wo-plaster', projectId: PG,
      contractor: 'Shree Plaster Works',
      pan: 'AHZPS4321M', deducteeType: 'individual',
      scope: 'Internal and external cement plaster, all floors',
      orderValue: 4200000, pricing: 'rate', retentionPercent: 5, tdsPercent: 1,
      startedOn: day(120), dueOn: ahead(30), status: 'running', ref: 'WO/PG/03',
    }),
    // Priced against the same schedule the engineer measures, which is what
    // makes the comparison mean anything: this contractor is paid per square
    // metre of the same plaster item the measurement book records. He has
    // certified a little ahead of the tape, which is ordinary — and worth
    // seeing, because nothing in this app could see it before.
    makeWorkOrder({
      entityId, id: 'sample-wo-mdplaster', projectId: MD,
      contractor: 'Sai Plastering Works',
      pan: 'BKLPS7788Q', deducteeType: 'individual',
      scope: 'Internal cement plaster 12mm, two coats — against MD/04',
      orderValue: 3000000, pricing: 'rate', retentionPercent: 5, tdsPercent: 1,
      startedOn: day(95), dueOn: ahead(60), status: 'running', ref: 'WO/MD/04',
    }),
    // Finished, paid, and still holding the contractor's money. The completion
    // half of his retention fell due two and a half months ago and nothing in
    // the app could say so until a release had a date attached to it.
    makeWorkOrder({
      entityId, id: 'sample-wo-stone', projectId: HV,
      contractor: 'Kadappa Stone & Joinery',
      pan: 'CDXPK2211R', deducteeType: 'individual',
      scope: 'Stone flooring, staircase cladding and all joinery',
      orderValue: 950000, pricing: 'rate', retentionPercent: 5, tdsPercent: 1,
      startedOn: day(240), dueOn: day(90), status: 'closed', ref: 'WO/HV/02',
      completedOn: day(75), dlpMonths: 12, releaseSplitPercent: 50,
    }),
    // The other side of the same trade. The company built this bungalow, so
    // here it is the one whose money is being held — and the completion half
    // of it became a debt the day the liability clock started.
    makeWorkOrder({
      entityId, id: 'sample-wo-hv-client', projectId: HV, side: 'client',
      contractor: 'Dr. A. Kulkarni',
      scope: 'Construction of residence at Lonavala, turnkey',
      orderValue: 8500000, pricing: 'lumpSum', retentionPercent: 5, tdsPercent: 1,
      startedOn: day(520), dueOn: day(60), status: 'closed', ref: 'HV/AGR/01',
      completedOn: day(60), dlpMonths: 12, releaseSplitPercent: 50,
    }),
  ]
  const bills = [
    makeRaBill({ entityId, id: 'sample-ra-1', workOrderId: 'sample-wo-rcc', projectId: MD, number: 1, date: day(180), claimedToDate: 5200000, certifiedToDate: 5000000, status: 'paid', note: 'Podium and first two slabs.' }),
    makeRaBill({ entityId, id: 'sample-ra-2', workOrderId: 'sample-wo-rcc', projectId: MD, number: 2, date: day(110), claimedToDate: 10500000, certifiedToDate: 10200000, status: 'paid', materialRecovered: 180000, note: 'Up to 5th slab. Cement issued from our yard recovered.' }),
    makeRaBill({ entityId, id: 'sample-ra-3', workOrderId: 'sample-wo-rcc', projectId: MD, number: 3, date: day(38), claimedToDate: 15000000, certifiedToDate: 14600000, status: 'certified', penalty: 50000, note: 'Up to 8th slab. Penalty for the delayed 7th.' }),
    makeRaBill({ entityId, id: 'sample-ra-4', workOrderId: 'sample-wo-plaster', projectId: PG, number: 1, date: day(70), claimedToDate: 1500000, certifiedToDate: 1450000, status: 'paid' }),
    makeRaBill({ entityId, id: 'sample-ra-5', workOrderId: 'sample-wo-plaster', projectId: PG, number: 2, date: day(16), claimedToDate: 3100000, certifiedToDate: 2950000, status: 'certified', note: 'External plaster still to start on the north face.' }),
    makeRaBill({ entityId, id: 'sample-ra-11', workOrderId: 'sample-wo-mdplaster', projectId: MD, number: 1, date: day(12), claimedToDate: 1050000, certifiedToDate: 980000, status: 'certified', note: 'Floors 1 to 4, internal faces.' }),
    makeRaBill({ entityId, id: 'sample-ra-6', workOrderId: 'sample-wo-stone', projectId: HV, number: 1, date: day(150), claimedToDate: 600000, certifiedToDate: 600000, status: 'paid' }),
    makeRaBill({ entityId, id: 'sample-ra-7', workOrderId: 'sample-wo-stone', projectId: HV, number: 2, date: day(80), claimedToDate: 940000, certifiedToDate: 920000, status: 'paid', note: 'Final. Two risers remeasured.' }),
    makeRaBill({ entityId, id: 'sample-ra-8', workOrderId: 'sample-wo-hv-client', projectId: HV, number: 1, date: day(400), claimedToDate: 3000000, certifiedToDate: 3000000, status: 'paid' }),
    makeRaBill({ entityId, id: 'sample-ra-9', workOrderId: 'sample-wo-hv-client', projectId: HV, number: 2, date: day(200), claimedToDate: 6000000, certifiedToDate: 6000000, status: 'paid' }),
    makeRaBill({ entityId, id: 'sample-ra-10', workOrderId: 'sample-wo-hv-client', projectId: HV, number: 3, date: day(65), claimedToDate: 8500000, certifiedToDate: 8500000, status: 'paid', note: 'Final bill on handover.' }),
  ]
  return { orders, bills }
}

// ── Quotations, including one the company is committed to ───────────
// Three quotes for the same steel is what a purchase file is for, and the
// accepted one that has not arrived is the money this demo could not show
// before: agreed, not delivered, not in the books, and entirely spent.
function quotations(entityId) {
  const line = (itemId, name, qty, rate, unit, gst) =>
    makeQuoteLine({ itemId, name, qty, rate, unit, gstPercent: gst })
  return [
    makeQuote({
      entityId, id: 'sample-q-steel-a', vendor: 'Shakti Steel Traders', contact: '98200 41122',
      projectId: MD, date: day(22), validUntil: ahead(8), status: 'accepted', ref: 'Q/ST/118',
      notes: 'Rate held to the 8th. Delivery in two lorries.',
      lines: [line('sample-item-steel', 'TMT bars 12mm', 24000, 61.4, 'kg', 18)],
    }),
    makeQuote({
      entityId, id: 'sample-q-steel-b', vendor: 'Mahalaxmi Iron & Steel', contact: '98330 77410',
      projectId: MD, date: day(23), validUntil: ahead(5), status: 'declined', ref: 'Q/MI/64',
      notes: 'Dearer, and thirty days credit against fifteen.',
      lines: [line('sample-item-steel', 'TMT bars 12mm', 24000, 63.8, 'kg', 18)],
    }),
    makeQuote({
      entityId, id: 'sample-q-cement', vendor: 'Vardhaman Cement Agency', contact: '98195 30077',
      projectId: PG, date: day(6), validUntil: ahead(14), status: 'sent', ref: 'Q/VC/09',
      lines: [line('sample-item-cement', 'OPC 53 grade cement', 1800, 392, 'bag', 28)],
    }),
  ]
}

// ── What has actually been built ────────────────────────────────────
// Weighted by value, not by how many lines are ticked: finishing the
// excavation is not the same share of a tower as finishing the RCC.
const SCHEDULE = [
  ['sample-wi-1', 'MD/01', 'Excavation in ordinary soil, including disposal',      'earthwork', 'cum', 4200,  180,  [[4200, 280]]],
  ['sample-wi-2', 'MD/02', 'RCC M30 in columns, beams and slabs',                  'structure', 'cum', 3100,  7400, [[900, 220], [700, 150], [500, 60]]],
  ['sample-wi-3', 'MD/03', 'AAC block masonry 150mm in cement mortar',             'masonry',   'sqm', 9800,  720,  [[2600, 120], [2800, 55], [-200, 50]]],
  ['sample-wi-4', 'MD/04', 'Internal cement plaster 12mm, two coats',              'plaster',   'sqm', 14500, 210,  [[2400, 70], [1700, 22]], 'sample-wo-mdplaster'],
  ['sample-wi-5', 'MD/05', 'Vitrified tile flooring 600×600 including skirting',   'finishes',  'sqm', 6200,  860,  [[900, 18]]],
  ['sample-wi-6', 'MD/06', 'Flush door with frame, hardware and polish',           'joinery',   'nos', 240,   9800, [[30, 14]]],
]

function schedule(entityId) {
  const workItems = []
  const measurements = []
  for (const [id, code, description, stage, unit, plannedQty, rate, takes, workOrderId = null] of SCHEDULE) {
    workItems.push(makeWorkItem({ entityId, id, projectId: MD, code, description, stage, unit, plannedQty, rate, workOrderId }))
    for (const [qty, back] of takes) {
      measurements.push(makeMeasurement({
        entityId, workItemId: id, projectId: MD, date: day(back), qty,
        // A re-measurement that found less is a correction, not a deletion.
        note: qty < 0 ? 'Re-measured — earlier entry counted the shaft wall twice' : '',
      }))
    }
  }
  return { workItems, measurements }
}

// ── Plant, and the hours nobody worked ──────────────────────────────
function machines(entityId) {
  const plant = [
    makePlant({
      entityId, id: 'sample-plant-crane', projectId: MD, name: 'Tower crane — Potain MC 85',
      kind: 'crane', ownership: 'hired', registration: 'TC-MD-01', vendor: 'Mumbai Crane Hire',
      hireRate: 285000, hireBasis: 'monthly', hiredFrom: day(200), operatorIncluded: true,
    }),
    makePlant({
      entityId, id: 'sample-plant-jcb', projectId: MD, name: 'JCB 3DX backhoe',
      kind: 'excavator', ownership: 'hired', registration: 'MH43 AQ 8812', vendor: 'Balaji Earthmovers',
      hireRate: 8500, hireBasis: 'daily', minimumHours: 8, hiredFrom: day(300), hiredTo: day(30),
    }),
    makePlant({
      entityId, id: 'sample-plant-mixer', projectId: PG, name: 'Concrete mixer 10/7',
      kind: 'mixer', ownership: 'owned', registration: 'MX-02',
      purchaseValue: 480000, purchasedOn: day(900), usefulLifeYears: 8, salvageValue: 40000,
    }),
  ]
  // Working, idle and broken are three different answers and only one of them
  // is the machine's fault. Some days have no sheet at all, which is the state
  // a hire bill arrives in and nobody can check.
  const logs = []
  const sheets = [
    ['sample-plant-crane', 2, 7.5, 0.5, 0, 'Ravi Yadav', ''],
    ['sample-plant-crane', 3, 8, 0, 0, 'Ravi Yadav', ''],
    ['sample-plant-crane', 4, 3, 5, 0, 'Ravi Yadav', 'Slab not ready — waiting on the shuttering gang'],
    ['sample-plant-crane', 5, 7, 0, 1, 'Ravi Yadav', 'Hoist rope inspection'],
    ['sample-plant-crane', 8, 8, 0, 0, 'Ravi Yadav', ''],
    ['sample-plant-crane', 9, 0, 0, 8, 'Ravi Yadav', 'Slew motor failed — vendor engineer came next morning'],
    ['sample-plant-crane', 10, 6.5, 1.5, 0, 'Ravi Yadav', ''],
    ['sample-plant-jcb', 32, 6, 2, 0, 'Salim Shaikh', ''],
    ['sample-plant-jcb', 33, 8, 0, 0, 'Salim Shaikh', ''],
    ['sample-plant-jcb', 35, 2, 6, 0, 'Salim Shaikh', 'Drawings for the ramp were late'],
    ['sample-plant-mixer', 3, 5, 1, 0, 'Ganpat More', ''],
    ['sample-plant-mixer', 4, 6, 0, 0, 'Ganpat More', ''],
    ['sample-plant-mixer', 6, 4, 0, 2, 'Ganpat More', 'Drum bearing'],
  ]
  for (const [plantId, back, workingHours, idleHours, breakdownHours, operator, note] of sheets) {
    logs.push(makePlantLog({
      entityId, plantId, projectId: plantId === 'sample-plant-mixer' ? PG : MD,
      date: day(back), workingHours, idleHours, breakdownHours, operator, note,
      fuelLitres: plantId === 'sample-plant-jcb' ? 42 : 0,
      fuelCost: plantId === 'sample-plant-jcb' ? 3990 : 0,
    }))
  }
  return { plant, logs }
}

// ── The flats the tower is built to sell ────────────────────────────
const UNITS = [
  ['sample-unit-701', 'A-701', 'flat', 'A', 7, '2 BHK',          640, 21500, 450000, 'registered'],
  ['sample-unit-702', 'A-702', 'flat', 'A', 7, '2 BHK',          655, 21500, 450000, 'agreement'],
  ['sample-unit-801', 'A-801', 'flat', 'A', 8, '3 BHK',          910, 22000, 620000, 'booked'],
  ['sample-unit-802', 'A-802', 'flat', 'A', 8, '3 BHK',          905, 22000, 620000, 'available'],
  ['sample-unit-901', 'A-901', 'flat', 'A', 9, '3 BHK + study',  910, 22500, 640000, 'available'],
  ['sample-unit-902', 'A-902', 'flat', 'A', 9, '3 BHK + study',  905, 22500, 640000, 'held'],
  ['sample-unit-s01', 'S-01',  'shop', 'Podium', 0, 'Corner shop', 420, 34000, 200000, 'registered'],
  ['sample-unit-s02', 'S-02',  'shop', 'Podium', 0, 'Shop',        385, 34000, 200000, 'available'],
]

// A construction-linked payment plan: the instalment falls due when the
// building reaches the stage, not when a date in a spreadsheet passes.
const PLAN = [
  ['Booking amount',        0,  500000, '',          0,   1],
  ['On agreement',          20, 0,      'structure', 30,  2],
  ['On 8th slab',           25, 0,      'structure', 100, 3],
  ['On internal plaster',   20, 0,      'plaster',   60,  4],
  ['On flooring',           15, 0,      'finishes',  60,  5],
  ['On possession',         10, 0,      '',          0,   6],
]

const RECEIPTS = [
  // A-701: registered and nearly paid up.
  ['sample-unit-701', 500000,  300, 'cheque', 'CHQ 448120', 'Booking amount'],
  ['sample-unit-701', 2752000, 250, 'bank',   'NEFT/8823',  'On agreement'],
  ['sample-unit-701', 3440000, 120, 'loan',   'HDFC Ltd disbursement 1', 'On 8th slab'],
  ['sample-unit-701', 2752000, 40,  'loan',   'HDFC Ltd disbursement 2', 'On internal plaster'],
  // A-702: agreement done, two instalments in.
  ['sample-unit-702', 500000,  260, 'upi',    'UPI/9921',   'Booking amount'],
  ['sample-unit-702', 2816500, 210, 'bank',   'NEFT/9044',  'On agreement'],
  // A-801: booked last month, booking amount only. The gap is the point.
  ['sample-unit-801', 500000,  45,  'cheque', 'CHQ 552001', 'Booking amount'],
  // S-01: registered, paid in full.
  ['sample-unit-s01', 500000,  400, 'cheque', 'CHQ 331207', 'Booking amount'],
  ['sample-unit-s01', 6856000, 330, 'bank',   'RTGS/5521',  'On agreement'],
  ['sample-unit-s01', 7124000, 150, 'bank',   'RTGS/6640',  'Balance on registration'],
]

function sales(entityId) {
  const units = UNITS.map(([id, name, kind, tower, floor, configuration, carpetArea, ratePerArea, otherCharges, status]) =>
    makeUnit({
      entityId, id, projectId: MD, name, kind, tower, floor, configuration,
      carpetArea, areaBasis: 'carpet', ratePerArea, otherCharges, status,
      note: status === 'held' ? 'Kept back for the landowner under the development agreement.' : '',
    }),
  )
  const planStages = []
  for (const u of units) {
    // Only the units somebody is buying have a payment plan. An unsold flat
    // has a price, not a schedule.
    if (!['booked', 'agreement', 'registered', 'possession'].includes(u.status)) continue
    for (const [label, percent, amount, workStage, triggerAt, sequence] of PLAN) {
      planStages.push(makePlanStage({ entityId, unitId: u.id, label, percent, amount, workStage, triggerAt, sequence }))
    }
  }
  const receipts = RECEIPTS.map(([unitId, amount, back, mode, reference, towards]) =>
    makeReceipt({ entityId, unitId, projectId: MD, date: day(back), amount, mode, reference, towards }),
  )
  return { units, planStages, receipts }
}

// ── The ledger itself ───────────────────────────────────────────────
// Booked to the job, which is the whole point — and one row booked to nothing
// at all, because that is what an overhead is and the app now takes it.
function ledger() {
  const expenses = [
    { project_id: MD, category: 'Materials', vendor: 'Shakti Steel & Alloys', amount: 1558000, date: day(120), status: 'paid', payment_method: 'Bank Transfer', description: 'TMT bars — 25 MT' },
    { project_id: MD, category: 'Materials', vendor: 'UltraTech — Vashi dealer', amount: 1546000, date: day(110), status: 'paid', payment_method: 'Bank Transfer', description: 'Cement — 4000 bags' },
    { project_id: MD, category: 'Labor / Contractors', vendor: 'Ganesh Construction Co.', amount: 4802000, date: day(175), status: 'paid', payment_method: 'Bank Transfer', description: 'RA bill 1 — net of retention and TDS' },
    { project_id: MD, category: 'Labor / Contractors', vendor: 'Deepak Labour Contractor', amount: 892000, date: day(28), status: 'paid', payment_method: 'Cash', description: 'Muster — fortnight to date' },
    { project_id: MD, category: 'Maintenance & Repairs', vendor: 'Mumbai Crane Hire', amount: 285000, date: day(22), status: 'unpaid', due_date: ahead(6), payment_method: 'Bank Transfer', description: 'Tower crane — monthly hire' },
    { project_id: MD, category: 'Permits & Legal', vendor: 'NMMC', amount: 640000, date: day(280), status: 'paid', payment_method: 'Bank Transfer', description: 'Commencement certificate and scrutiny fees' },
    { project_id: MD, category: 'Utilities', vendor: 'MSEDCL', amount: 74000, date: day(18), status: 'paid', payment_method: 'UPI', description: 'Site power' },
    { project_id: PG, category: 'Labor / Contractors', vendor: 'Shree Plaster Works', amount: 1363700, date: day(64), status: 'paid', payment_method: 'Bank Transfer', description: 'RA bill 1 — net' },
    { project_id: PG, category: 'Materials', vendor: 'Konkan Aggregates', amount: 504000, date: day(100), status: 'paid', payment_method: 'Cheque', description: 'River sand — 120 brass' },
    { project_id: PG, category: 'Utilities', vendor: 'MSEDCL', amount: 31000, date: day(15), status: 'unpaid', due_date: ahead(9), payment_method: 'UPI', description: 'Site power' },
    // The job that went over. Stone and joinery, which is where it went.
    { project_id: 'sample-site-hv', category: 'Materials', vendor: 'Rajasthan Stone Depot', amount: 2180000, date: day(300), status: 'paid', payment_method: 'Bank Transfer', description: 'Kota and granite — revised selection' },
    { project_id: 'sample-site-hv', category: 'Materials', vendor: 'Wood Craft Interiors', amount: 1940000, date: day(210), status: 'paid', payment_method: 'Bank Transfer', description: 'Teak joinery, site-made' },
    { project_id: 'sample-site-hv', category: 'Labor / Contractors', vendor: 'Lonavala Builders Group', amount: 2860000, date: day(180), status: 'paid', payment_method: 'Bank Transfer', description: 'Civil and finishing, full scope' },
    // Booked to nothing at all. Not a mistake, and the dashboard says so.
    { category: 'Other', vendor: 'Sai Corporate Park', amount: 85000, date: day(12), status: 'paid', payment_method: 'Bank Transfer', description: 'Head office rent' },
    { category: 'Permits & Legal', vendor: 'M. Joshi & Co.', amount: 125000, date: day(60), status: 'paid', payment_method: 'Bank Transfer', description: 'Statutory audit fee' },
  ]
  const income = [
    { project_id: MD, source: 'Running account', payer: 'Navi Realty LLP', amount: 18000000, date: day(240), status: 'received', payment_method: 'Bank Transfer', description: 'RA 1 against certified work' },
    { project_id: MD, source: 'Running account', payer: 'Navi Realty LLP', amount: 22500000, date: day(150), status: 'received', payment_method: 'Bank Transfer', description: 'RA 2' },
    { project_id: MD, source: 'Running account', payer: 'Navi Realty LLP', amount: 16800000, date: day(50), status: 'received', payment_method: 'Bank Transfer', description: 'RA 3' },
    { project_id: MD, source: 'Running account', payer: 'Navi Realty LLP', amount: 9400000, date: day(10), status: 'unpaid', due_date: ahead(20), payment_method: 'Bank Transfer', description: 'RA 4 — certified, not yet released' },
    { project_id: PG, source: 'Running account', payer: 'Palm Grove Developers', amount: 12000000, date: day(120), status: 'received', payment_method: 'Bank Transfer', description: 'First running bill' },
    { project_id: PG, source: 'Running account', payer: 'Palm Grove Developers', amount: 7500000, date: day(35), status: 'received', payment_method: 'Bank Transfer', description: 'Second running bill' },
    { project_id: 'sample-site-hv', source: 'Final bill', payer: 'Dr. A. Kulkarni', amount: 8500000, date: day(70), status: 'received', payment_method: 'Bank Transfer', description: 'Full contract value, settled on handover' },
  ]
  return { expenses, income }
}

// Everything the sample is, built but not written. Separated from the writing
// so it can be checked: a demo whose stock goes negative or whose bills run
// backwards teaches the app's own warnings as normal.
export function buildSample(entityId) {
  const { items, movements } = stock(entityId)
  const { orders, bills } = contracts(entityId)
  const { workItems, measurements } = schedule(entityId)
  const { plant, logs } = machines(entityId)
  const { units, planStages, receipts } = sales(entityId)
  const { expenses, income } = ledger()
  return {
    projects: sites(entityId),
    items,
    movements,
    quotes: quotations(entityId),
    muster: musterRoll(entityId),
    workOrders: orders,
    raBills: bills,
    workItems,
    measurements,
    plant,
    plantLogs: logs,
    units,
    planStages,
    receipts,
    expenses,
    income,
  }
}

// The order matters: a movement points at an item, a bill at a work order, a
// receipt at a unit. Parents first, so nothing is ever written pointing at
// something that is not there yet.
const ORDER = [
  'projects', 'items', 'quotes', 'movements', 'muster', 'workOrders', 'raBills',
  'workItems', 'measurements', 'plant', 'plantLogs', 'units', 'planStages', 'receipts',
]

export function hasSampleSite(collections, entityId) {
  return ORDER.some((k) => collections[k]?.list(entityId).some(isSampleRow))
}

export function hasRealSite(collections, entityId) {
  return ORDER.some((k) => collections[k]?.list(entityId).some((r) => !isSampleRow(r)))
}

// Written through the same store the app writes through, so sample rows are
// stamped, versioned and audited exactly like real ones — including appearing
// in the audit trail, which is itself worth seeing on a demo.
export async function installSampleSite({ collections, entityId, actor, addExpense, addIncome, expenses = [], income = [] }) {
  if (hasRealSite(collections, entityId) || expenses.some((r) => !isSampleRow(r)) || income.some((r) => !isSampleRow(r))) {
    throw new Error('There are already entries here. Sample data is only for an empty set of books.')
  }
  if (hasSampleSite(collections, entityId)) throw new Error('The sample site is already loaded.')

  const built = buildSample(entityId)
  const counts = {}
  for (const key of ORDER) {
    for (const row of built[key]) collections[key].add(tag(row), actor, entityId)
    counts[key] = built[key].length
  }
  for (const r of built.expenses) await addExpense(tagEntry(r))
  for (const r of built.income) await addIncome(tagEntry(r))

  return {
    sites: counts.projects,
    materials: counts.items,
    movements: counts.movements,
    entries: built.expenses.length + built.income.length,
    units: counts.units,
  }
}

// Takes out exactly what was put in, and nothing anybody has typed since.
export async function removeSampleSite({ collections, entityId, actor, expenses = [], income = [], deleteExpense, deleteIncome }) {
  let removed = 0
  // Children before parents, which is the install order read backwards.
  for (const key of [...ORDER].reverse()) {
    for (const row of collections[key].list(entityId).filter(isSampleRow)) {
      collections[key].remove(row.id, actor)
      removed++
    }
  }
  for (const e of expenses.filter(isSampleRow)) { await deleteExpense(e.id); removed++ }
  for (const i of income.filter(isSampleRow)) { await deleteIncome(i.id); removed++ }
  return removed
}
