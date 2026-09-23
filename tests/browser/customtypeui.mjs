// Saying what an "Other" asset actually is.
//
// "Other" is a bin: a telescope, a racehorse and a share of a fishing boat all
// land in it and come out of every table, chart and report as the same word.
// The picker now lets you write what the thing is, and what you write is
// stored as the type itself rather than beside it — so it has to survive a
// save, come back selected when you reopen the asset, and keep the optional
// blocks that "Other" was deliberately given.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' })
const p = await ctx.newPage(); p.setDefaultTimeout(20000)
await p.route('**/fonts.g**/**', (r) => r.abort())
const errors = []
p.on('pageerror', (e) => errors.push(e.message))
await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(() => {
  localStorage.clear()
  const put = (k, v) => localStorage.setItem(k, JSON.stringify(v))
  put('pl_properties', []); put('pl_expenses', []); put('pl_income', []); put('pl_documents', [])
})

const box = () => p.locator('label:has-text("What is it?") input')
const other = () => p.locator('label:has-text("Other")').first()

await p.goto(B + '/properties/new', { waitUntil: 'networkidle' })
await p.waitForTimeout(700)

// ── Hidden until it is wanted ───────────────────────────────────────────
ok('the write-in box is absent until Other is chosen', (await box().count()) === 0)

await other().click()
await p.waitForTimeout(250)
ok('choosing Other reveals it', (await box().count()) === 1)
ok('  and puts the cursor in it, because that is why you chose Other',
  await box().evaluate((el) => el === document.activeElement))
ok('  and it starts empty rather than showing the word "Other"',
  (await box().inputValue()) === '', await box().inputValue())

// The blocks "Other" is deliberately given must not vanish when it is named.
const addressShown = () => p.locator('label:has-text("Address")').count()
ok('Other offers an address', (await addressShown()) === 1)
await box().fill('Racehorse')
await p.waitForTimeout(250)
ok('  and naming it keeps the address', (await addressShown()) === 1,
  'naming an asset must not take its fields away')
ok('  the Other tile stays selected while typing',
  await other().evaluate((el) => el.querySelector('input').checked))

// ── Typing a space must not snap the field back ─────────────────────────
await box().fill('')
await p.waitForTimeout(150)
ok('clearing it falls back to Other rather than to nothing',
  await other().evaluate((el) => el.querySelector('input').checked))
await box().type('Share of a fishing boat', { delay: 12 })
await p.waitForTimeout(200)
ok('  and a type with spaces can actually be typed',
  (await box().inputValue()) === 'Share of a fishing boat', await box().inputValue())

// ── It survives the save ────────────────────────────────────────────────
await p.locator('input[placeholder^="e.g."]').first().fill('Kaveri II')
await p.locator('button[type=submit]').first().click()
await p.waitForURL('**/properties', { timeout: 15000 })
await p.waitForTimeout(600)
const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('pl_properties') || '[]')[0] || {})
ok('the typed type is what gets stored', stored.type === 'Share of a fishing boat', JSON.stringify(stored.type))
ok('  not the word Other', stored.type !== 'Other')
ok('the list shows it rather than "Other"',
  (await p.locator('#main-content').innerText()).includes('Share of a fishing boat'))

// ── And comes back on the way in ────────────────────────────────────────
await p.goto(B + `/properties/${stored.id}/edit`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
ok('reopening it shows the Other tile selected',
  await other().evaluate((el) => el.querySelector('input').checked))
ok('  with the typed type back in the box',
  (await box().inputValue()) === 'Share of a fishing boat', await box().inputValue())
ok('  and the cursor left alone, not dragged down the form',
  !(await box().evaluate((el) => el === document.activeElement)))

// ── Picking a real type again clears it ─────────────────────────────────
await p.locator('label:has-text("Vehicle / Car")').first().click()
await p.waitForTimeout(250)
ok('choosing a listed type hides the box', (await box().count()) === 0)
await p.locator('button[type=submit]').first().click()
await p.waitForURL('**/properties', { timeout: 15000 })
await p.waitForTimeout(500)
const after = await p.evaluate(() => JSON.parse(localStorage.getItem('pl_properties') || '[]')[0] || {})
ok('  and the stored type is the listed one', after.type === 'Vehicle / Car', String(after.type))

// ── The control: a plain "Other" still works as it always did ───────────
await p.goto(B + '/properties/new', { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
await other().click()
await p.waitForTimeout(200)
await p.locator('input[placeholder^="e.g."]').first().fill('Unnamed thing')
await p.locator('button[type=submit]').first().click()
await p.waitForURL('**/properties', { timeout: 15000 })
await p.waitForTimeout(500)
const plain = await p.evaluate(() => JSON.parse(localStorage.getItem('pl_properties') || '[]').find((x) => x.name === 'Unnamed thing') || {})
ok('leaving the box empty still stores plain "Other"', plain.type === 'Other', String(plain.type))

ok('no page errors throughout', errors.length === 0, errors.slice(0, 2).join(' | '))

await ctx.close()
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
