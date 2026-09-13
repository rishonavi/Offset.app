// The papers that get signed.
//
// The assertions worth reading are about the payment certificate, which is the
// one document here with legal weight: it says what has been measured, what was
// certified before, and therefore what is payable now. Getting that subtraction
// wrong pays a contractor twice for the same work.
import {
  rupeesInWords, paymentCertificate, demandLetter, measurementSheet,
  stockStatement, musterSheet, materialIndent, DOCUMENTS,
} from '../../src/lib/siteDocs.js'
import { makeWorkOrder, makeRaBill } from '../../src/lib/subcontract.js'
import { makeUnit, makePlanStage, makeReceipt } from '../../src/lib/sales.js'
import { makeWorkItem, makeMeasurement, siteProgress } from '../../src/lib/progress.js'
import { makeProject } from '../../src/lib/projects.js'
import { makeItem, makeMovement } from '../../src/lib/inventory.js'
import { makeMuster } from '../../src/lib/labour.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${e ? '  — ' + e : ''}`) }
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)
const row = (d, label) => d.sections.flatMap((s) => s.rows).find((r) => String(r[0]).startsWith(label))
const notes = (d) => d.notes.join(' | ')

const CO = { name: 'Navi Builders Pvt Ltd', gstin: '27AAAPA1234A1Z5' }
const E = 'e1'

console.log('\n── RUPEES IN WORDS ──')
// Not decoration: every payment document in India carries the amount twice, and
// the words are what a bank reads when the two disagree.
eq('nothing is nothing', rupeesInWords(0), 'Rupees Zero Only')
eq('a small figure', rupeesInWords(45), 'Rupees Forty Five Only')
eq('a hundred and one', rupeesInWords(101), 'Rupees One Hundred One Only')
eq('a thousand', rupeesInWords(1500), 'Rupees One Thousand Five Hundred Only')
// Indian grouping, not international: after the first thousand the groups are
// two digits, so this is seventeen lakh and never one point seven five million.
eq('a lakh is a lakh', rupeesInWords(1750000), 'Rupees Seventeen Lakh Fifty Thousand Only')
eq('and a crore is a crore', rupeesInWords(11500000), 'Rupees One Crore Fifteen Lakh Only')
eq('the awkward teens', rupeesInWords(19), 'Rupees Nineteen Only')
eq('and the round tens', rupeesInWords(90000), 'Rupees Ninety Thousand Only')
// A certificate rounded to the rupee is a certificate that does not tie to the
// bill it is paying.
eq('paise are named, not dropped', rupeesInWords(1234.50), 'Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only')
eq('a recovery reads as one', rupeesInWords(-5000), 'Minus Rupees Five Thousand Only')
eq('every document kind has a label', Object.values(DOCUMENTS).filter((d) => !d.label).length, 0)

console.log('\n── THE PAYMENT CERTIFICATE ──')
const order = makeWorkOrder({
  entityId: E, contractor: 'Sharma Plastering', scope: 'Internal plaster, all floors',
  orderValue: 2000000, retentionPercent: 5, tdsPercent: 1, ref: 'WO/2026/014',
})
const bills = [
  makeRaBill({ workOrderId: order.id, entityId: E, number: 1, date: '2026-03-31', claimedToDate: 500000, certifiedToDate: 500000 }),
  makeRaBill({ workOrderId: order.id, entityId: E, number: 2, date: '2026-04-30', claimedToDate: 1300000, certifiedToDate: 1200000 }),
  makeRaBill({ workOrderId: order.id, entityId: E, number: 3, date: '2026-05-31', claimedToDate: 1800000, certifiedToDate: 1750000, advanceRecovered: 100000 }),
]
const cert = paymentCertificate(order, bills, { company: CO })
eq('it is the latest bill by default', cert.title, 'Payment certificate — RA 3')
eq('addressed to the contractor', cert.to.name, 'Sharma Plastering')
eq('carrying the work order reference', cert.reference, 'WO/2026/014')
// The subtraction the document exists for. 17,50,000 to date less 12,00,000
// already certified.
eq('work certified to date', row(cert, 'Work certified to date')[1], 1750000)
eq('less what was certified before', row(cert, 'Less previously certified')[1], 1200000)
eq('gives the value of this bill', row(cert, 'Value of this bill')[1], 550000)
ok('which is not the cumulative figure', row(cert, 'Value of this bill')[1] !== 1750000)
eq('retention comes off at the order’s rate', row(cert, 'Less retention')[1], 27500)
eq('and TDS', row(cert, 'Less TDS')[1], 5500)
eq('the advance is recovered', row(cert, 'Less advance recovered')[1], 100000)
eq('leaving the net payable', cert.sections[0].totals[0][1], 417000)
eq('and the total on the document agrees', cert.total, 417000)
// The words are the authoritative half.
ok('the net is written out in words', /Four Lakh Seventeen Thousand/.test(notes(cert)), notes(cert))
eq('a bill can be named rather than taken as the last',
  paymentCertificate(order, bills, { company: CO, billId: bills[0].id }).total, 470000)
// A document that leaves the building without a line for a signature is one
// somebody re-makes by hand.
eq('three people put their name to it', cert.signatures.length, 3)
ok('including whoever measured it', cert.signatures.some((s) => /Measured/.test(s.label)))
ok('retention held so far is stated', /Retention held to date/.test(notes(cert)))
eq('an order with no bills produces no certificate', paymentCertificate(order, [], { company: CO }), null)

console.log('\n── AND IT SAYS WHEN NOT TO PAY ──')
const typo = [makeRaBill({ workOrderId: order.id, entityId: E, number: 1, claimedToDate: 500000, certifiedToDate: 5000000 })]
const bad = paymentCertificate(order, typo, { company: CO })
ok('certifying above the claim is on the face of it', /should not be paid/.test(notes(bad)), notes(bad))
ok('and running past the order value too', /past the order value/.test(notes(bad)))
const backwards = paymentCertificate(order, [
  makeRaBill({ workOrderId: order.id, entityId: E, number: 1, claimedToDate: 900000, certifiedToDate: 900000 }),
  makeRaBill({ workOrderId: order.id, entityId: E, number: 2, claimedToDate: 700000, certifiedToDate: 700000 }),
], { company: CO })
ok('a negative certificate says it is a recovery', /a recovery, not a payment/.test(notes(backwards)), notes(backwards))
ok('and the figure reads as a minus', /Minus Rupees/.test(backwards.notes[0]), backwards.notes[0])

console.log('\n── THE DEMAND LETTER ──')
const flat = makeUnit({
  entityId: E, name: 'A-1204', tower: 'A', floor: 12, configuration: '3BHK',
  carpetArea: 1100, areaBasis: 'carpet', ratePerArea: 10000, otherCharges: 500000, status: 'booked',
})
const plan = [
  makePlanStage({ unitId: flat.id, entityId: E, label: 'On booking', amount: 1000000, dueOn: '2026-01-01', sequence: 1 }),
  makePlanStage({ unitId: flat.id, entityId: E, label: 'On foundation', percent: 15, workStage: 'earthwork', triggerAt: 100, sequence: 2 }),
  makePlanStage({ unitId: flat.id, entityId: E, label: 'On structure', percent: 40, workStage: 'structure', triggerAt: 100, sequence: 3 }),
]
const items = [
  makeWorkItem({ entityId: E, projectId: 's1', stage: 'earthwork', description: 'Excavation', plannedQty: 800, rate: 250 }),
  makeWorkItem({ entityId: E, projectId: 's1', stage: 'structure', description: 'RCC', plannedQty: 600, rate: 6500 }),
]
const half = siteProgress(items, [makeMeasurement({ workItemId: items[0].id, entityId: E, date: '2026-02-01', qty: 800 })])
const letter = demandLetter(flat, plan, [makeReceipt({ unitId: flat.id, entityId: E, amount: 1000000 })],
  { company: CO, progressStages: half.stages, asOf: '2026-06-01' })
eq('it names the unit', letter.reference, 'A/A-1204')
// Only what the building has earned. The structure money is not demanded at
// half a structure.
eq('only what has fallen due is demanded', letter.total, 1650000)
eq('one instalment is listed', letter.sections[0].rows.length, 1)
// The sentence that makes a buyer pay rather than query.
ok('and it says which stage of work made it due',
  /completion of earthwork/.test(letter.sections[0].rows[0][1]), JSON.stringify(letter.sections[0].rows[0]))
ok('the amount is written out', /Sixteen Lakh Fifty Thousand/.test(notes(letter)), notes(letter))
ok('a date to pay by is given', /Kindly remit by 2026-06-16/.test(notes(letter)), notes(letter))
// Said plainly, because a buyer asked for money reads this line first.
ok('and what is not being demanded is said plainly',
  /remains under the payment plan and is not demanded here/.test(notes(letter)))
eq('a unit with nothing outstanding gets no letter',
  demandLetter(flat, plan, [makeReceipt({ unitId: flat.id, entityId: E, amount: 99000000 })],
    { company: CO, progressStages: half.stages, asOf: '2026-06-01' }), null)

console.log('\n── THE MEASUREMENT SHEET ──')
const site = makeProject({ entityId: E, id: 's1', name: 'Marine Drive Tower', code: 'MD-1', client: 'Navi Realty' })
const sheet = measurementSheet({ ...site, id: 's1' }, items,
  [makeMeasurement({ workItemId: items[0].id, entityId: E, date: '2026-02-01', qty: 800 }),
   makeMeasurement({ workItemId: items[1].id, entityId: E, date: '2026-05-01', qty: 300 })],
  { company: CO })
eq('it is headed with the site', sheet.title, 'Measurement sheet — Marine Drive Tower')
eq('grouped by stage, in build order', sheet.sections.map((s) => s.title), ['Earthwork & foundation', 'RCC & structure'])
eq('the value of work done is totalled', sheet.total, 2150000)
ok('the contractor signs it too', sheet.signatures.some((s) => /Contractor/.test(s.label)))
eq('a site with no schedule produces no sheet',
  measurementSheet({ ...site, id: 'other' }, items, [], { company: CO }), null)

console.log('\n── THE STOCK STATEMENT ──')
const cement = makeItem({ entityId: E, name: 'Cement OPC 53', unit: 'bag', reorderLevel: 20 })
const moves = [
  makeMovement({ itemId: cement.id, entityId: E, kind: 'receipt', qty: 200, unitCost: 400, date: '2026-01-01' }),
  makeMovement({ itemId: cement.id, entityId: E, kind: 'transfer', qty: 50, date: '2026-01-05', storeId: null, toStoreId: 'site-a' }),
]
const stock = stockStatement([cement], moves, { company: CO, storeName: (id) => (id ? 'Marine Drive Tower' : 'Central store') })
eq('one section per store', stock.sections.map((s) => s.title), ['Central store', 'Marine Drive Tower'])
eq('and the total is the company’s', stock.total, 80000)
// Carried round a yard with a pen, which is why the last column is empty.
eq('there is a column to write the count in', stock.sections[0].columns[5], 'Counted')
ok('and it is left blank', stock.sections[0].rows[0][5] === '')
eq('nothing in stock produces no statement', stockStatement([], [], { company: CO }), null)

console.log('\n── THE MUSTER SHEET ──')
const day = [
  makeMuster({ entityId: E, date: '2026-03-03', trade: 'mason', headcount: 14, rate: 800 }),
  makeMuster({ entityId: E, date: '2026-03-03', trade: 'helper', headcount: 22, rate: 500, overtimeHours: 40, overtimeRate: 90 }),
  makeMuster({ entityId: E, date: '2026-03-04', trade: 'mason', headcount: 12, rate: 800 }),
]
const roll = musterSheet(day, { company: CO, date: '2026-03-03', entityId: E })
eq('only that day is on it', roll.sections[0].rows.length, 2)
eq('with the wage bill for the day', roll.total, 25800)
// Signed at the gate, so there is a line to sign on.
eq('each line has somewhere to sign', roll.sections[0].columns[6], 'Signature')
eq('another day produces another sheet', musterSheet(day, { company: CO, date: '2026-03-04', entityId: E }).total, 9600)
eq('a day nobody worked produces none', musterSheet(day, { company: CO, date: '2026-03-05', entityId: E }), null)

console.log('\n── THE INDENT ──')
const short = makeItem({ entityId: E, name: 'Binding wire', unit: 'kg', reorderLevel: 100 })
const indent = materialIndent([short], [
  makeMovement({ itemId: short.id, entityId: E, kind: 'receipt', qty: 40, unitCost: 70, date: '2026-01-01' }),
], { company: CO, site: 'Marine Drive Tower' })
ok('what is below its level is listed', indent.sections[0].rows.length === 1)
// A list that only says what is low is a list somebody has to copy out.
eq('with a column to write what is wanted', indent.sections[0].columns[4], 'Required')
ok('left blank for whoever raises it', indent.sections[0].rows[0][4] === '')
ok('and somebody has to approve it', indent.signatures.some((s) => /Approved/.test(s.label)))
eq('a yard with nothing low produces no indent', materialIndent([], [], { company: CO }), null)

console.log('\n── EVERY DOCUMENT ──')
const all = [cert, letter, sheet, stock, roll, indent]
ok('carries the company', all.every((d) => d.company.name === CO.name))
ok('is dated', all.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date)))
ok('has a title', all.every((d) => d.title))
ok('has somewhere to sign', all.every((d) => d.signatures.length > 0))
ok('and drops meta lines that say nothing',
  all.every((d) => d.meta.every((m) => m.value !== '' && m.value !== null && m.value !== undefined)))
ok('every money figure is a number, not a formatted string',
  all.every((d) => d.total === null || typeof d.total === 'number'))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
