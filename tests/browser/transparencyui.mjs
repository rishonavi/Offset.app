// Whether the app admits, on screen, when a value is its guess rather than
// something the person typed.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' })
const p = await ctx.newPage(); p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push(s.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const text = () => p.locator('#main-content').innerText()
const more = () => p.locator('#main-content button[aria-expanded]').first()

// A one-sided history, so the app has something to fill in.
await p.goto(`${B}/`, { waitUntil: 'networkidle' })
await p.evaluate(() => {
  const now = new Date().toISOString()
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'a1', name: 'Sea View Villa', type: 'Real Estate — Apartment / Flat', created_at: now },
  ]))
  localStorage.setItem('pl_expenses', JSON.stringify(
    Array.from({ length: 6 }, (_, i) => ({
      id: `e${i}`, property_id: 'a1', date: `2026-0${i + 1}-10`, amount: 100 + i,
      category: 'Utilities', payment_method: 'UPI', status: 'paid', created_at: now,
    }))))
})

console.log('── A GUESS SAYS IT IS A GUESS ──')
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
const body = await text()
ok('the form says some fields were filled in', /filled in for you/i.test(body), body.slice(0, 120).replace(/\n/g, ' | '))
ok('and the asset field says where its value came from', /from your last entry/i.test(body))
await more().click()
await p.waitForTimeout(300)
ok('so does the payment method, behind the fold', /what you usually pick/i.test(await text()))

console.log('\n── AND STOPS SAYING SO ONCE IT IS THEIRS ──')
// The note is a claim about who chose the value. The moment someone edits the
// field, it would be false.
await p.locator('#main-content select').first().selectOption({ index: 0 })
await p.evaluate(() => {
  const sel = document.querySelector('#main-content select')
  sel.value = sel.options[0].value
  sel.dispatchEvent(new Event('change', { bubbles: true }))
})
await p.waitForTimeout(400)
ok('editing the asset drops its note', !/from your last entry/i.test(await text()))
ok('but the payment method keeps its own', /what you usually pick/i.test(await text()))

console.log('\n── NOTHING FILLED IN, NOTHING CLAIMED ──')
// An entry that already exists is the person's own work, start to finish.
await p.evaluate(() => {
  const now = new Date().toISOString()
  localStorage.setItem('pl_expenses', JSON.stringify([{
    id: 'kept', property_id: 'a1', date: '2026-03-01', amount: 5000,
    category: 'Utilities', payment_method: 'UPI', status: 'paid', created_at: now,
  }]))
})
await p.goto(`${B}/expenses/kept/edit`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
const editing = await text()
ok('editing marks nothing as guessed', !/filled in for you/i.test(editing))
ok('and no field claims a source', !/from your last entry|what you usually pick/i.test(editing))

console.log('\n── A SPLIT HISTORY IS NOT DRESSED UP AS A HABIT ──')
await p.evaluate(() => {
  const now = new Date().toISOString()
  localStorage.setItem('pl_expenses', JSON.stringify(
    ['UPI', 'Cash', 'Card', 'UPI', 'Cash', 'Card'].map((m, i) => ({
      id: `x${i}`, property_id: 'a1', date: `2026-0${i + 1}-10`, amount: 100,
      category: 'Utilities', payment_method: m, status: 'paid', created_at: now,
    }))))
})
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
await more().click()
await p.waitForTimeout(300)
ok('no payment method is offered, so none is explained', !/what you usually pick/i.test(await text()))

console.log('\n── WHAT LEAVES THE DEVICE IS SAID BEFORE IT GOES ──')
// Scanning uploads the photo. Someone deciding whether to photograph a bill
// should be told first, not after it has already been sent.
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(500)
await p.setInputFiles('#main-content input[type=file]', {
  name: 'bill.png', mimeType: 'image/png',
  // A 1x1 PNG — enough to be a scannable file without being a real receipt.
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
})
await p.waitForTimeout(700)
const withFile = await text()
ok('it says the photo is uploaded', /uploads your photo/i.test(withFile), withFile.slice(0, 200).replace(/\n/g, ' | '))
ok('and that Offset does not keep it', /does not keep it/i.test(withFile))

ok('nothing threw', errs.length === 0, errs.slice(0, 2).join(' | '))
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
