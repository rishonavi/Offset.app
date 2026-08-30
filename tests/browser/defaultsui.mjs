// Fewer decisions per entry: the form folds what most entries never touch, and
// fills in what this person always does.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
const p = await ctx.newPage(); p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push(s.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const more = () => p.locator('#main-content button[aria-expanded]').first()
const visible = (sel) => p.locator(sel).first().isVisible().catch(() => false)
const fields = () => p.evaluate(() =>
  [...document.querySelectorAll('#main-content label.block')].filter((l) => l.offsetParent !== null).length)

// Two assets and a run of entries that all say the same thing, which is what
// makes a default safe to offer.
await p.goto(`${B}/`, { waitUntil: 'networkidle' })
await p.evaluate(() => {
  const now = new Date().toISOString()
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'a1', name: 'Sea View Villa', type: 'Real Estate — Apartment / Flat', created_at: now },
    { id: 'a2', name: 'Hill Cottage', type: 'Real Estate — Apartment / Flat', created_at: now },
  ]))
  localStorage.setItem('pl_expenses', JSON.stringify(
    Array.from({ length: 8 }, (_, i) => ({
      id: `e${i}`, property_id: i === 7 ? 'a2' : 'a1', date: `2026-0${(i % 8) + 1}-10`,
      amount: 100 + i, category: 'Utilities', payment_method: 'UPI', status: 'paid', created_at: now,
    }))))
})

console.log('── THE FORM OPENS SHORT ──')
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
const shown = await fields()
ok('only a handful of fields are on screen', shown > 0 && shown <= 7, `${shown} showing`)
ok('the rest are behind one control', await more().isVisible())
ok('which starts closed', (await more().getAttribute('aria-expanded')) === 'false')
// The fold has to actually hide things, not merely offer to.
ok('the notes field is not on screen yet', !(await visible('#main-content textarea')))

console.log('\n── AND OPENS UP WHEN ASKED ──')
await more().click()
await p.waitForTimeout(300)
const opened = await fields()
ok('more fields appear', opened > shown, `${shown} → ${opened}`)
ok('the control says it is open', (await more().getAttribute('aria-expanded')) === 'true')
ok('the notes field is one of them', await visible('#main-content textarea'))
await more().click()
await p.waitForTimeout(300)
ok('and folds away again', (await fields()) === shown)

console.log('\n── FILLED IN FROM WHAT THEY ALWAYS DO ──')
// Seven of the eight entries are on the first asset, but the newest is on the
// second — the one they touched last is the one they are working on.
const asset = await p.locator('#main-content select').first().inputValue()
ok('the asset is the one used most recently', asset === 'a2', asset)
await more().click()
await p.waitForTimeout(300)
const pm = await p.evaluate(() =>
  [...document.querySelectorAll('#main-content select')].map((s) => s.value).find((v) => v === 'UPI'))
ok('the payment method they always use is already chosen', pm === 'UPI', String(pm))

console.log('\n── BUT NEVER GUESSES ──')
// A scattered history is not a habit, and a wrong default is answered quietly.
await p.evaluate(() => {
  const now = new Date().toISOString()
  localStorage.setItem('pl_expenses', JSON.stringify(
    ['UPI', 'Cash', 'Card', 'UPI', 'Cash', 'Card'].map((m, i) => ({
      id: `x${i}`, property_id: 'a1', date: `2026-0${i + 1}-10`,
      amount: 100, category: 'Utilities', payment_method: m, status: 'paid', created_at: now,
    }))))
})
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
await more().click()
await p.waitForTimeout(300)
const guessed = await p.evaluate(() =>
  [...document.querySelectorAll('#main-content select')].map((s) => s.value))
ok('a split history leaves the field empty', !guessed.includes('UPI') && !guessed.includes('Cash'), guessed.join(','))

console.log('\n── EDITING NEVER HIDES WHAT IS RECORDED ──')
await p.evaluate(() => {
  const now = new Date().toISOString()
  localStorage.setItem('pl_expenses', JSON.stringify([{
    id: 'kept', property_id: 'a1', date: '2026-03-01', amount: 5000, category: 'Utilities',
    payment_method: 'Cash', status: 'unpaid', description: 'settle by Friday', created_at: now,
  }]))
})
await p.goto(`${B}/expenses/kept/edit`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
ok('the details are open from the start', (await more().getAttribute('aria-expanded')) === 'true')
ok('and the note is on screen', (await p.locator('#main-content textarea').first().inputValue()) === 'settle by Friday')

console.log('\n── WHAT IS FOLDED AWAY IS STILL NAMED ──')
// Out of sight must not mean out of mind: someone has to be able to see that a
// value is set without opening the fold to find out.
await more().click()
await p.waitForTimeout(300)
const summary = await more().innerText()
ok('the button lists what is inside', /cash/i.test(summary), summary)

console.log('\n── THE SAME ON THE INCOME FORM ──')
await p.goto(`${B}/income/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
ok('income folds its details too', await more().isVisible())
ok('and starts closed', (await more().getAttribute('aria-expanded')) === 'false')
await more().click()
await p.waitForTimeout(300)
ok('and opens', (await more().getAttribute('aria-expanded')) === 'true')

ok('nothing threw', errs.length === 0, errs.slice(0, 2).join(' | '))
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
