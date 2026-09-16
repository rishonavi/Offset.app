// What is actually on the shelf.
//
// Every movement in this app is a claim. A receipt says a lorry arrived, an
// issue says a bag went to the slab, and the balance that falls out of them is
// what the paperwork believes — consistent to the paisa and never once checked
// against a godown.
//
// Three things are worth breaking deliberately here:
//
//   **The book figure is frozen into the count.** A verification compared
//   against today's balance changes its own answer every time a later lorry
//   arrives, and a verification that moves is not one.
//
//   **Short and over are never netted.** A store twelve bags down on cement and
//   twelve up on sand has two problems; the difference of nothing reports
//   neither.
//
//   **A store holding nothing is not overdue a count.** Seeding the unverified
//   list with the yard told a company that has never bought a bag of cement to
//   go and count an empty godown, which is the sort of nag that teaches people
//   to ignore the whole list.
import {
  makeStockCount, countSheet, countLine, sheetResult, adjustmentsFrom, shrinkage,
  DEFAULT_TOLERANCE, STALE_DAYS,
} from '../../src/lib/stockcount.js'
import { makeItem, makeMovement, stockAt } from '../../src/lib/inventory.js'
import { makeProject } from '../../src/lib/projects.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, got, want) => ok(n, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const E = 'e1'
const cement = makeItem({ entityId: E, id: 'cement', name: 'OPC 53', unit: 'bag' })
const steel = makeItem({ entityId: E, id: 'steel', name: 'TMT 12mm', unit: 'kg' })
const items = [cement, steel]
const move = (over) => makeMovement({ entityId: E, ...over })
const moves = [
  move({ itemId: 'cement', kind: 'receipt', qty: 1000, unitCost: 400, date: '2026-01-10' }),
  move({ itemId: 'cement', kind: 'issue', qty: 200, date: '2026-02-10' }),
  move({ itemId: 'steel', kind: 'receipt', qty: 5000, unitCost: 60, date: '2026-01-15' }),
]

console.log('\n── THE SHEET TO WALK THE STORE WITH ──')
const sheet = countSheet(items, moves, { entityId: E, asOf: '2026-03-01' })
eq('every material is on it', sheet.length, 2)
const bagRow = sheet.find((r) => r.item.id === 'cement')
eq('the books say eight hundred bags', bagRow.bookQty, 800)
eq('at what the shelf is carrying them at', bagRow.avgCost, 400)
eq('which is worth this much', bagRow.value, 320000)
// As at the date, not as at today. A count on the 1st of February cannot know
// about the issue on the 10th.
eq('a sheet dated earlier knows less',
  countSheet(items, moves, { entityId: E, asOf: '2026-02-01' }).find((r) => r.item.id === 'cement').bookQty, 1000)
// A material the books say is absent is still on the sheet: twelve bags on a
// shelf the books know nothing about is the most interesting line there is.
const emptyStore = countSheet(items, moves, { entityId: E, storeId: 'site', asOf: '2026-03-01' })
eq('a store the books think is empty still gets a sheet', emptyStore.length, 2)
eq('with nothing on it', emptyStore[0].bookQty, 0)
ok('and it says so', emptyStore.every((r) => r.empty))
eq('another company’s materials are not on it', countSheet(items, moves, { entityId: 'e2' }).length, 0)

console.log('\n── ONE COUNT ──')
const short = makeStockCount({ entityId: E, itemId: 'cement', date: '2026-03-01', countedQty: 760, bookQty: 800, avgCost: 400 })
const line = countLine(short, cement)
eq('counted less than the books say is a shortage', line.short, true)
eq('by forty bags', line.variance, -40)
eq('which is five per cent of the shelf', line.variancePercent, -5)
eq('and sixteen thousand rupees', line.value, -16000)
eq('it is not an overage', line.over, false)
eq('and not square', line.square, false)
const square = countLine(makeStockCount({ entityId: E, itemId: 'cement', date: '2026-03-01', countedQty: 800, bookQty: 800, avgCost: 400 }))
eq('counting exactly what the books say is square', square.square, true)
eq('with nothing to correct', square.variance, 0)
// A store the books think is empty that turns out to hold something has no
// percentage. Saying "infinitely over" beats nothing; saying nothing beats both.
const found = countLine(makeStockCount({ entityId: E, itemId: 'cement', date: '2026-03-01', countedQty: 12, bookQty: 0, avgCost: 400 }))
eq('finding stock the books do not know about is an overage', found.over, true)
eq('with no percentage, because there is nothing to divide by', found.variancePercent, null)
eq('though the rupees are still known', found.value, 4800)

console.log('\n── THE BOOK FIGURE IS FROZEN ──')
// The whole point. The count above was taken against 800 bags; a lorry
// afterwards must not change what that count found.
const later = [...moves, move({ itemId: 'cement', kind: 'receipt', qty: 500, unitCost: 410, date: '2026-04-01' })]
eq('a later delivery does not move the books the count was taken against', countLine(short).book, 800)
eq('nor what it found', countLine(short).variance, -40)
// Control: the live balance did move, so the frozen figure is a decision and
// not an accident of the fixture.
ok('though the live balance did move', stockAt(cement, later).qty === 1300, String(stockAt(cement, later).qty))

console.log('\n── A SHEET IS A STORE AND A DAY ──')
const sheetCounts = [
  short,
  makeStockCount({ entityId: E, itemId: 'steel', date: '2026-03-01', countedQty: 5040, bookQty: 5000, avgCost: 60 }),
]
const result = sheetResult(sheetCounts, items, { entityId: E })
eq('two materials counted', result.count, 2)
eq('one short', result.short, 1)
eq('one over', result.over, 1)
eq('none square', result.square, 0)
// The assertion this file exists for. Sixteen thousand short and two thousand
// four hundred over is two problems.
eq('the shortage is its own figure', result.shortValue, 16000)
eq('and the overage is its own', result.overValue, 2400)
ok('which are not the same number', result.shortValue !== result.overValue)
// The net is still available for anybody who wants it, and is not what the
// findings are built on.
eq('the net is reported as well, and is neither', result.netValue, -13600)
eq('a different day is a different sheet',
  sheetResult(sheetCounts, items, { entityId: E, date: '2026-04-01' }).count, 0)
eq('and a different store',
  sheetResult(sheetCounts, items, { entityId: E, storeId: 'site' }).count, 0)
eq('the yard is asked for as nothing, which is what a movement says too',
  sheetResult(sheetCounts, items, { entityId: E, storeId: null }).count, 2)

console.log('\n── THE CORRECTIONS IT IMPLIES ──')
const posts = adjustmentsFrom(sheetCounts, { entityId: E })
eq('two corrections, one each way', posts.length, 2)
const down = posts.find((m) => m.item_id === 'cement')
eq('a shortage posts a negative adjustment', down.qty, -40)
eq('as an adjustment, which is the one kind that may be negative', down.kind, 'adjustment')
eq('dated the day of the count, not today', down.date, '2026-03-01')
eq('at what the shelf was carrying it at', down.unit_cost, 400)
ok('and it says where it came from', /Physical verification/.test(down.note), down.note)
const up = posts.find((m) => m.item_id === 'steel')
eq('an overage posts a positive one', up.qty, 40)
// A square count corrects nothing — and is still stored, which is the point of
// storing counts at all.
eq('a count that found nothing posts no correction',
  adjustmentsFrom([makeStockCount({ entityId: E, itemId: 'cement', countedQty: 800, bookQty: 800 })], { entityId: E }).length, 0)

console.log('\n── WHAT HAS BEEN CHECKED, AND WHAT HAS NOT ──')
const sites = [makeProject({ entityId: E, id: 'site', name: 'Marine Drive Tower' })]
const withSite = [...moves, move({ itemId: 'cement', kind: 'transfer', qty: 300, date: '2026-02-15', toStoreId: 'site' })]
const s = shrinkage(sheetCounts, items, withSite, { entityId: E, asOf: '2026-03-10', stores: sites })
eq('one sheet on file', s.count, 1)
eq('with its shortage', s.shortValue, 16000)
eq('and its overage kept apart', s.overValue, 2400)
eq('the last count is dated', s.lastCounted, '2026-03-01')
// The yard was counted; the site store was not.
eq('one store has not been checked', s.unverifiedCount, 1)
eq('and it is the site', s.unverified[0].name, 'Marine Drive Tower')
eq('which has never been counted at all', s.unverified[0].lastCounted, null)
eq('counted as such', s.neverCounted, 1)

console.log('\n── AND A STORE WITH NOTHING IN IT IS NOT OVERDUE ──')
// The nag that taught people to ignore the list. A company that has never
// bought anything has nothing to count.
const nothing = shrinkage([], items, [], { entityId: E })
eq('no stores to verify', nothing.unverifiedCount, 0)
eq('and nothing never counted', nothing.neverCounted, 0)
// Control: give it stock and the yard appears.
eq('once there is stock, the yard is on the list',
  shrinkage([], items, moves, { entityId: E }).unverifiedCount, 1)
eq('and it is the yard', shrinkage([], items, moves, { entityId: E }).unverified[0].name, 'The yard')

console.log('\n── A COUNT LONG AGO IS NOT A COUNT ──')
eq('the staleness window is four months', STALE_DAYS, 120)
eq('a count inside it counts',
  shrinkage(sheetCounts, items, moves, { entityId: E, asOf: '2026-04-01' }).unverifiedCount, 0)
const stale = shrinkage(sheetCounts, items, moves, { entityId: E, asOf: '2026-09-01' })
eq('and one outside it does not', stale.unverifiedCount, 1)
// But it is not "never counted" — those are different states and only one of
// them means nobody has ever looked.
eq('though it is not the same as never', stale.neverCounted, 0)
eq('and the screen can say when it last was', stale.unverified[0].lastCounted, '2026-03-01')

console.log('\n── OUT BY MORE THAN A ROUNDING ──')
eq('two per cent is the default tolerance', DEFAULT_TOLERANCE, 2)
// 16,000 short against a book value of 320,000 + 300,000 is about 2.6%.
eq('this sheet is out', s.sheets[0].out, true)
eq('by this much of what it held', s.sheets[0].shortPercent, 2.6)
const tiny = shrinkage(
  [makeStockCount({ entityId: E, itemId: 'cement', date: '2026-03-01', countedQty: 799, bookQty: 800, avgCost: 400 })],
  items, moves, { entityId: E, asOf: '2026-03-10' })
eq('one bag out of eight hundred is not', tiny.sheets[0].out, false)
eq('though it is still reported', tiny.shortValue, 400)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
