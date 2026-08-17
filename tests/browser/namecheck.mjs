// Asset names still resolve on every row after the lookup became a Map.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
const p = await ctx.newPage(); p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push(String(e).slice(0,140)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
let pass = 0, fail = 0
const ok = (n, c, e='') => { c ? pass++ : fail++; console.log(`${c?'PASS':'**FAIL**'}  ${n}${c?'':'  — '+e}`) }

await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(() => {
  localStorage.clear()
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'p1', name: 'Sea View Villa', type: 'Real Estate — Villa / House', value: 4200000 },
    { id: 'p2', name: 'Bandra Office', type: 'Real Estate — Commercial', value: 9100000 },
  ]))
  localStorage.setItem('pl_expenses', JSON.stringify([
    { id: 'e1', property_id: 'p1', category: 'Utilities', vendor: 'Adani', amount: 4200, date: '2026-05-02', status: 'paid' },
    { id: 'e2', property_id: 'p2', category: 'Insurance', vendor: 'ICICI', amount: 18000, date: '2026-05-06', status: 'paid' },
    { id: 'e3', property_id: 'zz-gone', category: 'Other', vendor: 'Ghost', amount: 100, date: '2026-05-07', status: 'paid' },
  ]))
  localStorage.setItem('pl_income', JSON.stringify([
    { id: 'i1', property_id: 'p2', source: 'Rent', amount: 90000, date: '2026-05-01' },
  ]))
  localStorage.setItem('pl_documents', '[]')
})
await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
let t = await p.locator('#main-content').innerText()
ok('the first asset name resolves', /Sea View Villa/.test(t))
ok('the second asset name resolves', /Bandra Office/.test(t))
ok('a row pointing at a missing asset still renders', /Ghost/.test(t))
ok('and does not print "undefined"', !/undefined/i.test(t), t.match(/.{0,40}undefined.{0,40}/i)?.[0] || '')
await p.goto(`${B}/income`, { waitUntil: 'networkidle' })
await p.waitForTimeout(500)
t = await p.locator('#main-content').innerText()
ok('income rows resolve names too', /Bandra Office/.test(t))
await p.goto(B, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
ok('the dashboard still renders', (await p.locator('#main-content').innerText()).length > 100)
console.log(`\n${pass} passed, ${fail} failed`); console.log('errors:', errs.length ? errs.slice(0,3) : 'none')
await b.close(); if (fail) process.exitCode = 1
