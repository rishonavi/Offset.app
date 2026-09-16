// The input credit a vendor never filed for, on screen.
//
// You pay the tax on a purchase and get it back — but only if the vendor files.
// When he does not the money is gone, and there is nothing in the books to say
// so. The 2B is read in the browser and never stored, because it is somebody's
// tax filing and keeping a copy is a liability nobody asked for.
//
// Two things have to be on screen beyond the arithmetic: the limits of the
// match, said plainly rather than buried, and the fact that loading nothing is
// not a clean bill of health.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1300 }, serviceWorkers: 'block' })
const p = await ctx.newPage(); p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 160)) })
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('ERR_FAILED') && !t.includes('404')) errs.push('CONSOLE ' + t.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const main = () => p.locator('#main-content').innerText()
// Just the panel: the Reports page carries several totals of its own and a
// check reading the whole page can be satisfied by one of those.
const panel = async () => {
  const t = await main()
  const i = t.search(/INPUT CREDIT AGAINST GSTR-2B/i)
  if (i < 0) return ''
  const rest = t.slice(i)
  const end = rest.search(/\n(WHAT IS OWED|WORKING CAPITAL|OPERATIONS|Preview|COST CENTRES)\b/i)
  return end > 0 ? rest.slice(0, end) : rest
}
const MONTH = '2026-06'

await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(({ month }) => {
  localStorage.clear()
  const now = new Date().toISOString()
  for (const k of ['pl_income', 'pl_documents']) localStorage.setItem(k, '[]')
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'a1', name: 'Yard', type: 'Real Estate — Villa / House', created_at: now },
  ]))
  const bill = (id, vendor, day, tax) => ({
    id, property_id: 'a1', vendor, date: `${month}-${day}`, amount: tax * 6, tax,
    category: 'Materials', payment_method: 'Bank Transfer', status: 'paid', created_at: now,
  })
  localStorage.setItem('pl_expenses', JSON.stringify([
    bill('e1', 'SHAKTI STEEL AND ALLOYS PRIVATE LIMITED', '12', 18000),
    bill('e2', 'UltraTech Cement', '18', 14000),
    // The one nobody filed for.
    bill('e3', 'Konkan Aggregates', '20', 2500),
  ]))
}, { month: MONTH })

console.log('\n── NOTHING LOADED IS NOT A CLEAN BILL OF HEALTH ──')
await p.goto(`${B}/reports`, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
let t = await panel()
ok('the panel is on the reports page', t.length > 40, (await main()).slice(0, 300))
ok('and says nothing has been checked', /nothing has been checked/i.test(t), t)
// Not "everything matched", which is what a zeroed table would look like.
ok('rather than showing everything as filed', !/every purchase on file appears/i.test(t), t)
ok('the file is read here and not kept', /never stored/i.test(t), t)

console.log('\n── LOADING THE PORTAL’S DOWNLOAD ──')
await p.locator('#main-content input[aria-label="Reconciliation month"]').fill(MONTH)
await p.waitForTimeout(300)
// The real shape: a title row above the headers, a column called "GSTIN of
// supplier" that also matches the vendor pattern, and day-first dates.
const csv = [
  'GSTR-2B for the period June 2026',
  'GSTIN of supplier,Trade Name,Invoice number,Invoice Date,Taxable Value,IGST,CGST,SGST',
  '27AAAPZ1234A1Z5,Shakti Steel & Alloys Pvt. Ltd.,INV-114,12-06-2026,100000,0,9000,9000',
  '27BBBPZ4321B1Z9,UltraTech Cement,C-889,18-06-2026,50000,0,7000,7000',
].join('\n')
await p.locator('#main-content input[aria-label="GSTR-2B file"]').setInputFiles({
  name: '2B-June-2026.csv', mimeType: 'text/csv', buffer: Buffer.from(csv),
})
await p.waitForTimeout(900)
t = await panel()
ok('it says what was read', /2 lines read from 2B-June-2026\.csv/i.test(t), t)
// Anchored to its own cell. The fallback this replaced matched a bare "3"
// anywhere on the card, which is an assertion that cannot fail.
ok('three purchases carried tax', /PURCHASES WITH TAX\n\n3\n/.test(t), t.slice(0, 600))
// ₹18,000 + ₹14,000 filed, ₹2,500 not.
ok('the filed credit is matched', /₹32,000/.test(t), t)
ok('and the rest is named as at risk', /₹2,500/.test(t), t)
ok('with the vendor who did not file', /Konkan Aggregates/.test(t), t)
ok('said as credit at risk', /credit at risk/i.test(t), t)
// The name-matching is the whole trick: two spellings of one vendor.
ok('the two spellings of one supplier were treated as one',
  !/SHAKTI STEEL/i.test(t.slice(t.search(/at risk/i))), t.slice(-500))

console.log('\n── AND THE LIMITS ARE ON THE SCREEN ──')
// A reconciliation that overstates its precision is worse than none.
ok('it says what it matched on', /supplier.s name and the tax amount/i.test(t), t.slice(-600))
ok('and what it cannot do', /will not settle an argument about one invoice/i.test(t), t.slice(-600))

console.log('\n── A FILE THAT IS NOT A 2B ──')
await p.locator('#main-content input[aria-label="GSTR-2B file"]').setInputFiles({
  name: 'holiday-photos.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b,c\n1,2,3'),
})
await p.waitForTimeout(800)
t = await panel()
ok('it says so rather than reporting nothing filed',
  /nothing in holiday-photos\.csv looked like a 2B/i.test(t), t)
ok('and says what it needs', /supplier, an invoice date and a tax figure/i.test(t), t)

ok('no page errors', errs.length === 0, errs.join(' | '))
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
