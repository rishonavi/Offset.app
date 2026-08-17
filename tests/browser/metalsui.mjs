// Metal holdings in the browser: the fields appear for the right asset types,
// the arithmetic on screen matches the model, and it all persists.
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
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('pl_properties', '[]'); localStorage.setItem('pl_expenses', '[]'); localStorage.setItem('pl_income', '[]'); localStorage.setItem('pl_documents', '[]') })
await p.goto(`${B}/assets/new`, { waitUntil: 'networkidle' }).catch(() => {})
// Find the asset form wherever it lives.
if (!(await p.locator('form').count())) {
  await p.goto(`${B}/properties`, { waitUntil: 'networkidle' })
  await p.locator('a,button').filter({ hasText: /add asset|new asset|add property/i }).first().click()
  await p.waitForTimeout(700)
}
ok('the asset form is reachable', (await p.locator('form').count()) > 0)

const typeSel = p.locator('form select').first()
const metalBlock = () => p.locator('text=The metal itself')

console.log('\n── THE FIELDS APPEAR ONLY WHERE THEY BELONG ──')
await typeSel.selectOption('Real Estate — Villa / House')
await p.waitForTimeout(250)
ok('a villa has no metal section', (await metalBlock().count()) === 0)
await typeSel.selectOption('Jewellery')
await p.waitForTimeout(300)
ok('jewellery does', (await metalBlock().count()) === 1)
await typeSel.selectOption('Precious Metals — Gold / Silver')
await p.waitForTimeout(300)
ok('so does the precious-metals type', (await metalBlock().count()) === 1)
const metalPick = p.locator('form select').filter({ has: p.locator('option[value="gold"]') }).first()
ok('and it defaults to gold, not silver', (await metalPick.inputValue()) === 'gold', await metalPick.inputValue())

console.log('\n── THE ARITHMETIC ON SCREEN ──')
await p.locator('input[placeholder="e.g. 22.5"]').fill('20')
await p.waitForTimeout(300)
let panel = await p.locator('#main-content').innerText()
ok('the fine weight is shown before any rate', /18.32 g fine/.test(panel), panel.match(/[\d.]+ g fine/)?.[0] || 'absent')
ok('and it admits it cannot value it yet', /Add a rate/.test(panel))

// Purity picker: 22K is the default for gold.
const purity = p.locator('form select').filter({ has: p.locator('option[value="916"]') }).first()
ok('purity defaults to 22K, the common Indian purity', (await purity.inputValue()) === '916', await purity.inputValue())

// Now a rate. Gold is quoted per 10 g, so ₹75,000 is ₹7,500/g.
// Scope to the metal section — the form has several ₹ inputs.
const metalSection = p.locator('form > div').filter({ hasText: 'The metal itself' })
const rate = metalSection.locator('input[placeholder="0"]').first()
await rate.fill('75000')
await p.waitForTimeout(350)
panel = await p.locator('#main-content').innerText()
ok('the quote is labelled per 10 g, not per gram', /per 10 g/.test(panel), panel.match(/per [^\n·]+/)?.[0] || 'absent')
// 20g at 916 = 18.32g fine × 7500 = 137,400
ok('20 g of 22K at ₹75,000/10g is ₹1,37,400', /1,37,400/.test(panel), panel.match(/Metal value[^\n]*/)?.[0] || 'absent')
ok('the making-charge caveat is stated', /making charges/i.test(panel))

console.log('\n── SILVER IS QUOTED DIFFERENTLY ──')
await metalPick.selectOption('silver')
await p.waitForTimeout(350)
panel = await p.locator('#main-content').innerText()
ok('silver is quoted per kg', /per kg/.test(panel), panel.match(/per [^\n·]+/)?.[0] || 'absent')
ok('and the purity list switches to sterling',
  (await p.locator('form option').allInnerTexts()).some((t) => /sterling/i.test(t)))

console.log('\n── USING IT AS THE ASSET VALUE ──')
await metalPick.selectOption('gold')
await p.waitForTimeout(300)
const useBtn = p.locator('button', { hasText: 'Use as asset value' })
ok('there is a one-click way to adopt the figure', await useBtn.isVisible())
await useBtn.click()
await p.waitForTimeout(300)
const valueInput = p.locator('form input[placeholder="0"]').first()
ok('the asset value picks up the metal value', (await valueInput.inputValue()) === '137400', await valueInput.inputValue())

console.log('\n── IT SAVES AND COMES BACK ──')
await p.locator('form input').first().fill('Wedding set')
await p.locator('button[type="submit"]').first().click()
await p.waitForTimeout(1200)
const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('pl_properties') || '[]'))
ok('the asset is saved', saved.length === 1, `${saved.length}`)
const row = saved[0] || {}
ok('with the metal', row.metal === 'gold', String(row.metal))
ok('the quantity', Number(row.metal_quantity) === 20, String(row.metal_quantity))
ok('the unit', row.metal_unit === 'g', String(row.metal_unit))
ok('the purity as millesimal fineness', Number(row.metal_fineness) === 916, String(row.metal_fineness))
ok('and the rate as quoted', Number(row.metal_rate) === 75000, String(row.metal_rate))

console.log('\n── AND DOES NOT LEAK ONTO OTHER ASSETS ──')
await p.goto(`${B}/properties`, { waitUntil: 'networkidle' })
await p.locator('a,button').filter({ hasText: /add asset|new asset|add property/i }).first().click()
await p.waitForTimeout(700)
await p.locator('form select').first().selectOption('Jewellery')
await p.waitForTimeout(250)
await p.locator('input[placeholder="e.g. 22.5"]').fill('5')
await p.waitForTimeout(200)
await p.locator('form select').first().selectOption('Aircraft')
await p.waitForTimeout(250)
ok('switching away hides the metal section', (await metalBlock().count()) === 0)
await p.locator('form input').first().fill('Cessna')
await p.locator('button[type="submit"]').first().click()
await p.waitForTimeout(1200)
const all = await p.evaluate(() => JSON.parse(localStorage.getItem('pl_properties') || '[]'))
const plane = all.find((r) => r.name === 'Cessna')
ok('a non-metal asset stores no gram count', plane && plane.metal_quantity == null, JSON.stringify(plane?.metal_quantity))
ok('and no metal', plane && plane.metal == null, String(plane?.metal))

console.log('\n── LAYOUT ──')
await p.setViewportSize({ width: 390, height: 800 })
await p.goto(`${B}/properties`, { waitUntil: 'networkidle' })
await p.locator('a,button').filter({ hasText: /add asset|new asset|add property/i }).first().click()
await p.waitForTimeout(700)
await p.locator('form select').first().selectOption('Jewellery')
await p.waitForTimeout(300)
const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
ok('no sideways scroll on a phone', overflow <= 2, `${overflow}px`)
const unlabelled = await p.evaluate(() =>
  [...document.querySelectorAll('form input,form select,form textarea')]
    .filter((el) => el.type !== 'hidden' && el.offsetParent !== null)
    .filter((el) => !(el.getAttribute('aria-label') || el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`))))
    .map((el) => el.outerHTML.slice(0, 70)))
ok('every metal control is labelled', unlabelled.length === 0, unlabelled.join(' | '))
const small = await p.evaluate(() =>
  [...document.querySelectorAll('form button')].filter((el) => el.offsetParent !== null)
    .map((el) => el.getBoundingClientRect()).filter((r) => r.height > 0 && r.height < 24).length)
ok('no tap target is under 24px', small === 0, `${small} too small`)

console.log(`\n${pass} passed, ${fail} failed`)
console.log('errors:', errs.length ? errs.slice(0, 4) : 'none')
await b.close()
if (fail) process.exitCode = 1
