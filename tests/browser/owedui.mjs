// What is owed, in both directions, and how old it is.
//
// The ageing ladder in payables.js had been written and tested and reached no
// screen: the dashboard showed two totals and nothing said how late they were.
// The interesting case is the oldest bill, so the seed is built around dates
// rather than amounts.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
const p = await ctx.newPage()
p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 160)) })
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('ERR_FAILED') && !t.includes('404')) errs.push('CONSOLE ' + t.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
p.on('dialog', (d) => d.accept())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${e ? '  — ' + e : ''}`) }
const main = () => p.locator('#main-content').innerText()
// Assertions have to be about the card, not the page: the preview table below
// lists every row, so a bare "is 9,000 absent" would be asking the wrong text.
const card = async () => {
  const t = await main()
  const at = t.indexOf('What is owed')
  if (at < 0) return ''
  const end = [t.indexOf('What the company', at), t.indexOf('Preview', at), t.length].filter((i) => i > 0)
  return t.slice(at, Math.min(...end))
}

// Dates relative to today, so the buckets mean the same thing next month.
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(([long, mid, soon, old]) => {
  localStorage.clear()
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'p1', name: 'Sea View Villa', type: 'Real Estate — Villa / House', value: 4200000 },
    { id: 'p2', name: 'Hill Cottage', type: 'Real Estate — Villa / House', value: 900000 },
  ]))
  localStorage.setItem('pl_expenses', JSON.stringify([
    // 120 days late — the row the whole card exists for.
    { id: 'e1', property_id: 'p1', category: 'Materials', vendor: 'Ashok Steel', amount: 120000, date: old, status: 'unpaid', due_date: long },
    // 20 days late.
    { id: 'e2', property_id: 'p1', category: 'Utilities', vendor: 'Adani', amount: 4000, date: old, status: 'unpaid', due_date: mid },
    // Not due yet, so not a problem.
    { id: 'e3', property_id: 'p1', category: 'Utilities', vendor: 'Adani', amount: 1000, date: old, status: 'unpaid', due_date: soon },
    // Settled, and on another property.
    { id: 'e4', property_id: 'p1', category: 'Insurance', vendor: 'HDFC', amount: 9000, date: old, status: 'paid', due_date: long },
    { id: 'e5', property_id: 'p2', category: 'Materials', vendor: 'Other', amount: 50000, date: old, status: 'unpaid', due_date: long },
    // No status at all: an older row from before the app tracked payment. The
    // dashboard has always read these as settled.
    { id: 'e6', property_id: 'p1', category: 'Other', vendor: 'Ancient', amount: 777, date: old, due_date: long },
    // Unpaid with no due date: owed, but not ageable.
    { id: 'e7', property_id: 'p1', category: 'Other', vendor: 'Undated', amount: 2500, date: old, status: 'unpaid' },
  ]))
  localStorage.setItem('pl_income', JSON.stringify([
    { id: 'i1', property_id: 'p1', source: 'Rent', payer: 'Mr Sharma', amount: 45000, date: old, status: 'pending', due_date: mid },
    { id: 'i2', property_id: 'p1', source: 'Rent', payer: 'Mr Sharma', amount: 45000, date: old, status: 'received', due_date: mid },
  ]))
  localStorage.setItem('pl_documents', '[]')
}, [day(-120), day(-20), day(20), day(-200)])

console.log('\n── THE CARD ──')
await p.goto(`${B}/reports`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
ok('the report says what is owed', /What is owed, and how late/.test(await main()))
let r = await card()
// 120,000 + 4,000 + 1,000 + 2,500 on Sea View, plus 50,000 on Hill Cottage.
ok('everything unpaid is counted', /1,77,500/.test(r), r.slice(-900))
ok('and everything awaited', /45,000/.test(r))
// Stated as totals rather than as absent substrings: 1,77,500 would read
// 1,86,500 with the paid bill in it, and the awaited side 90,000 with the
// received one. A bare "9,000 does not appear" would fail on ₹1,29,000.
ok('a settled bill is left out', !/1,86,500/.test(r), r)
ok('and so is income already received', /OWED TO YOU\n₹45,000/.test(r), r)
// The rule payments.js has always used, now used here too. 1,77,500 is the
// total with the statusless row left out; including it would read 1,78,277.
ok('a row with no status at all reads as settled, as it does everywhere else',
  !/777/.test(r) && !/1,78,277/.test(r), r)

console.log('\n── HOW LATE ──')
ok('the oldest bill is aged past ninety days', /Over 90 days\t2\t₹1,70,000/.test(r), r)
ok('a recent one lands in its own bucket', /1–30 days/.test(r))
ok('one not yet due is not a problem', /Not yet due/.test(r))
ok('and one with no date to age against says so', /No due date/.test(r))
// Five bills open; three of them past their date.
ok('what is late is counted', /3 of 5 overdue/.test(r), r)
ok('both sides are laddered', /BILLS YOU HAVE NOT PAID/i.test(r) && /MONEY NOT YET RECEIVED/i.test(r), r)

console.log('\n── THE NET ──')
// 45,000 awaited less 1,77,500 owed.
ok('the net of both is shown', /-₹1,32,500/.test(r), r)
ok('and which way the late money runs', /₹1,29,000 more is late from you than to you/.test(r), r)

console.log('\n── WHAT THE FILTER DOES, AND DOES NOT ──')
// A property narrows which bills are being asked about.
await p.goto(`${B}/reports?propertyId=p2`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
r = await card()
ok('a property filter narrows it', /₹50,000/.test(r) && !/1,77,500/.test(r), r)

// A start date must not: the whole point is the bill nobody has paid for
// months, and a range starting this year would hide it.
await p.goto(`${B}/reports?from=${day(-5)}`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
r = await card()
ok('a start date does not hide the oldest bill', /1,77,500/.test(r), r)
ok('which the card says out loud', /not just what falls inside the period above/.test(r))

// An end date does, because "still open as at" is a real question.
await p.goto(`${B}/reports?to=${day(-150)}`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
r = await card()
// 150 days ago every one of these bills was still ahead of its due date.
ok('an end date ages everything as at that day', /Not yet due\t4/.test(r), r)
ok('and none of it reads as late', /none overdue yet/.test(r), r)
ok('the date is named on the card', /as at /.test(r), r.slice(0, 300))

console.log('\n── NOTHING OWED ──')
await p.evaluate(() => {
  const rows = JSON.parse(localStorage.getItem('pl_expenses')).map((e) => ({ ...e, status: 'paid' }))
  localStorage.setItem('pl_expenses', JSON.stringify(rows))
  localStorage.setItem('pl_income', JSON.stringify(
    JSON.parse(localStorage.getItem('pl_income')).map((e) => ({ ...e, status: 'received' })),
  ))
})
await p.goto(`${B}/reports`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
ok('with nothing owed the card stays away', !/What is owed, and how late/.test(await main()))

console.log('\n── LAYOUT ──')
await p.setViewportSize({ width: 390, height: 800 })
await p.goto(`${B}/reports?propertyId=p1`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
ok('no sideways scroll on a phone', overflow <= 2, `${overflow}px`)

console.log(`\n${pass} passed, ${fail} failed`)
console.log('errors:', errs.length ? errs.slice(0, 4) : 'none')
await b.close()
if (fail) process.exitCode = 1
