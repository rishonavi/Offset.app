// What a thing normally costs here, and what it cost this time.
//
// The question nobody asks, because answering it by hand means reading down a
// column of forty receipts holding an average in your head. Three decisions in
// this module are worth breaking deliberately:
//
//   The norm is a **median**, not a mean. One emergency lorry at double rate
//   drags a mean up far enough to make the next three purchases look like
//   bargains — the mean is the one statistic a bad purchase must not move.
//
//   The norm is built **from the purchases before**, walking forward. Comparing
//   everything to one overall average judges a purchase against information
//   that did not exist when it was made, and makes the first lorry of a rising
//   year look like theft.
//
//   A rising market moves the norm **with** it. Only a jump stands out, and a
//   check that shouted at every increase would be switched off in a week.
import {
  median, priceVariance, materialVariance, labourRateSpread,
  DEFAULT_TOLERANCE, DEFAULT_WINDOW, MIN_HISTORY,
} from '../../src/lib/rates.js'
import { makeItem, makeMovement } from '../../src/lib/inventory.js'
import { makeMuster } from '../../src/lib/labour.js'
import { makeProject } from '../../src/lib/projects.js'
import { buildSample } from '../../src/lib/sampleSite.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, got, want) => ok(n, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const E = 'e1'
const day = (n) => { const d = new Date('2026-06-01T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }
const buy = (rate, back, qty = 100, vendor = 'Shakti Steel') =>
  makeMovement({ entityId: E, itemId: 'steel', kind: 'receipt', qty, unitCost: rate, date: day(back), vendor })

console.log('\n── THE MIDDLE ONE, NOT THE AVERAGE ──')
eq('an odd list has a middle', median([3, 1, 2]), 2)
eq('an even one takes the two in the middle', median([1, 2, 3, 4]), 2.5)
eq('nothing has no middle', median([]), null)
eq('one thing is its own middle', median([7]), 7)
eq('order does not matter', median([9, 1, 5]), 5)
// The whole reason it is a median. One outlier moves a mean by a third and the
// middle value not at all.
eq('an outlier does not move it', median([100, 100, 100, 400]), 100)
ok('where a mean would have moved a long way', (100 + 100 + 100 + 400) / 4 === 175)

console.log('\n── A PURCHASE IS JUDGED ON WHAT CAME BEFORE IT ──')
// 60, 60, 60, then a lorry at 90.
const spike = [buy(60, 50), buy(60, 40), buy(60, 30), buy(90, 20)]
const v = priceVariance('steel', spike)
eq('every purchase is a point', v.count, 4)
eq('the first cannot be judged', v.points[0].baseline, null)
eq('and says so rather than reading as in line', v.points[0].unjudged, true)
// MIN_HISTORY is two, so the second has one prior purchase and still cannot be
// judged. A norm of one number is not a norm.
eq('nor the second, on one prior purchase', v.points[1].baseline, null)
eq('the third is the first that can be', v.points[2].baseline, 60)
eq('and it is in line', v.points[2].dear, false)
eq('the lorry at ninety is not', v.points[3].dear, true)
eq('measured against sixty', v.points[3].baseline, 60)
eq('which is fifty per cent over', v.points[3].variancePercent, 50)
eq('and cost this much more than it should have', v.points[3].value, 3000)
eq('one delivery out of line', v.dear, 1)
eq('none of them cheap', v.cheap, 0)
eq('and the overpayment is that one delivery', v.overpaid, 3000)
eq('the worst is named', v.worst?.rate, 90)

console.log('\n── A SECOND LORRY AT THE SPIKE RATE IS NOT NEWS ──')
// By then the rate is the rate. It is out of line with the window and in line
// with the purchase before it, which is what "the market moved" looks like.
const twice = priceVariance('steel', [buy(60, 50), buy(60, 40), buy(60, 30), buy(90, 20), buy(90, 10)])
eq('the first ninety is flagged', twice.points[3].dear, true)
eq('the second is not', twice.points[4].dear, false)
eq('so one delivery is reported, not two', twice.dear, 1)

console.log('\n── AND THE ONE AFTER IT IS JUDGED ON THE SPIKE TOO ──')
// This is the honest consequence of a walking norm: the lorry after the spike
// is measured against a median that now includes it. With a median rather than
// a mean, one spike among three cannot move the middle.
const after = priceVariance('steel', [...spike, buy(62, 10)])
eq('the next purchase is measured against the middle of the four', after.points[4].baseline, 60)
eq('so a return to normal reads as normal', after.points[4].dear, false)

console.log('\n── A RISING MARKET IS NOT A SPIKE ──')
// Five per cent a month, every month. This is the case that found the flaw: on
// the median alone, four of the six were flagged, because a median over five
// purchases lags a steady climb by about two steps. A purchase now has to be
// out of line with the window *and* with the lorry before it, and a climb is
// always in line with the lorry before it.
const rising = [60, 63, 66, 69, 73, 76].map((r, i) => buy(r, 60 - i * 10))
const climb = priceVariance('steel', rising)
eq('every step is in line', climb.dear, 0)
ok('though the rate rose by a quarter', rising[5].unit_cost / rising[0].unit_cost > 1.25)
eq('and the norm has risen with it', climb.norm, 69)
// The evidence that the median alone would not have done: by the last purchase
// the rate is fifteen per cent above the middle of the window, and four per
// cent above the one before it. Only the second of those is the market.
eq('the last purchase is well above the window', climb.points[5].variancePercent, 15.2)
eq('and barely above the one before it', climb.points[5].stepPercent, 4.1)
eq('so it is not flagged', climb.points[5].dear, false)

console.log('\n── CHEAP IS REPORTED AS WELL AS DEAR ──')
// A per-kilo rate keyed against a tonne looks like the buy of the year.
const cheap = priceVariance('steel', [buy(60, 50), buy(60, 40), buy(60, 30), buy(6, 20)])
eq('a rate far below the norm is noticed', cheap.cheap, 1)
eq('and is not counted as an overpayment', cheap.overpaid, 0)
eq('nor as a dear delivery', cheap.dear, 0)

console.log('\n── THE TOLERANCE ──')
eq('the default is seven per cent', DEFAULT_TOLERANCE, 7)
eq('five purchases make the norm', DEFAULT_WINDOW, 5)
eq('and two is the least that can be a norm', MIN_HISTORY, 2)
const near = [buy(100, 40), buy(100, 30), buy(106, 20)]
eq('six per cent over passes', priceVariance('steel', near).dear, 0)
eq('and eight per cent does not', priceVariance('steel', [buy(100, 40), buy(100, 30), buy(108, 20)]).dear, 1)
eq('a stricter tolerance catches the six',
  priceVariance('steel', near, { tolerance: 5 }).dear, 1)

console.log('\n── ONLY A RECEIPT HAS A RATE ──')
// An issue carries no rate of its own and an adjustment's is a valuation. Both
// would drag the norm somewhere it has no business being.
const mixed = [
  buy(60, 50), buy(60, 40), buy(60, 30),
  makeMovement({ entityId: E, itemId: 'steel', kind: 'issue', qty: 50, unitCost: 0, date: day(25) }),
  makeMovement({ entityId: E, itemId: 'steel', kind: 'wastage', qty: 5, unitCost: 900, date: day(24) }),
  buy(62, 20),
]
eq('four purchases, not six', priceVariance('steel', mixed).count, 4)
eq('and the last one is in line', priceVariance('steel', mixed).points[3].dear, false)

console.log('\n── EVERY MATERIAL AT ONCE ──')
const items = [makeItem({ entityId: E, id: 'steel', name: 'TMT 12mm' }), makeItem({ entityId: E, id: 'cement', name: 'OPC 53' })]
const cementMoves = [1, 2, 3].map((i) => makeMovement({ entityId: E, itemId: 'cement', kind: 'receipt', qty: 100, unitCost: 380, date: day(50 - i * 10) }))
const all = materialVariance(items, [...spike, ...cementMoves], { entityId: E })
eq('both materials are listed', all.count, 2)
eq('the one that overpaid is first', all.rows[0].item.id, 'steel')
eq('with the whole overpayment', all.overpaid, 3000)
eq('and one dear delivery in all', all.dear, 1)
// Three purchases means the third is judged, so cement is not "unjudged".
eq('nothing is left unjudgeable here', all.unjudged, 0)
// A material bought once cannot be judged at all, and the total says so.
const once = materialVariance(
  [...items, makeItem({ entityId: E, id: 'lift', name: 'Lift' })],
  [...spike, ...cementMoves, makeMovement({ entityId: E, itemId: 'lift', kind: 'receipt', qty: 1, unitCost: 1450000, date: day(30) })],
  { entityId: E })
eq('a material bought once is counted as unjudged', once.unjudged, 1)
eq('and adds nothing to the overpayment', once.overpaid, 3000)
eq('another company’s materials are not these', materialVariance(items, spike, { entityId: 'e2' }).count, 0)

console.log('\n── THE SAME TRADE, THE SAME FORTNIGHT, TWO RATES ──')
const sites = [
  makeProject({ entityId: E, id: 'tower', name: 'Marine Drive Tower' }),
  makeProject({ entityId: E, id: 'villas', name: 'Palm Grove Villas' }),
]
const shift = (projectId, trade, rate, back, headcount = 10) =>
  makeMuster({ entityId: E, projectId, trade, rate, headcount, date: day(back) })
const gang = [
  shift('tower', 'tiler', 950, 5), shift('tower', 'tiler', 950, 4),
  shift('villas', 'tiler', 800, 5), shift('villas', 'tiler', 800, 4),
]
const spread = labourRateSpread(gang, { entityId: E, projects: sites, asOf: day(0) })
eq('one trade is out of line across sites', spread.count, 1)
eq('and it is named', spread.lines[0].label, 'Tile layer')
eq('the dearer site is first', spread.lines[0].high.name, 'Marine Drive Tower')
eq('and the cheaper one last', spread.lines[0].low.name, 'Palm Grove Villas')
eq('the gap is in rupees', spread.lines[0].spread, 150)
eq('and in per cent', spread.lines[0].spreadPercent, 18.8)
// 150 a day over 20 head-days on the dear site.
eq('what is at stake is the gap times the people', spread.lines[0].atStake, 3000)

console.log('\n── AND THE CASES THAT ARE NOT A SPREAD ──')
// One site cannot disagree with itself about what it pays.
eq('a trade on one site only is not a spread',
  labourRateSpread([shift('tower', 'tiler', 950, 5), shift('tower', 'tiler', 800, 4)], { entityId: E, projects: sites, asOf: day(0) }).count, 0)
// Inside the tolerance.
eq('a small difference is not one either',
  labourRateSpread([shift('tower', 'mason', 850, 5), shift('villas', 'mason', 820, 5)], { entityId: E, projects: sites, asOf: day(0) }).count, 0)
// Outside the window: last year's rate is not this fortnight's.
eq('and neither is a rate from six months ago',
  labourRateSpread([shift('tower', 'tiler', 950, 5), shift('villas', 'tiler', 800, 180)], { entityId: E, projects: sites, asOf: day(0) }).count, 0)
eq('though widening the window finds it',
  labourRateSpread([shift('tower', 'tiler', 950, 5), shift('villas', 'tiler', 800, 180)], { entityId: E, projects: sites, asOf: day(0), days: 365 }).count, 1)
// A day booked to no site at all is its own group, and comparing it with a
// named site is a real comparison rather than a bug.
eq('a shift booked to no site still names itself',
  labourRateSpread([shift('tower', 'tiler', 950, 5), shift(null, 'tiler', 800, 5)], { entityId: E, projects: sites, asOf: day(0) }).lines[0].low.name,
  'No site')

console.log('\n── AND THE SAMPLE SHOWS BOTH ──')
const s = buildSample(E)
const sm = materialVariance(s.items, s.movements, { entityId: E })
eq('one delivery in the demo came in high', sm.dear, 1)
eq('the steel bought on a Saturday', sm.rows[0].item.name, 'TMT bars 12mm')
ok('and it cost real money', sm.overpaid > 0, String(sm.overpaid))
// The control beside it: cement rose too, and is not flagged, because a rising
// market is not a spike.
const cement = sm.rows.find((r) => r.item.id === 'sample-item-cement')
ok('cement rose as well', cement.last > cement.points[0].rate, `${cement.points[0].rate} → ${cement.last}`)
eq('and is not flagged for it', cement.dear, 0)
const sl = labourRateSpread(s.muster, { entityId: E, projects: s.projects })
eq('one trade is paid differently across the demo sites', sl.count, 1)
eq('and it is the tilers', sl.lines[0].trade, 'tiler')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
