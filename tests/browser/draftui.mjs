// Keeping a half-typed entry when you leave the screen, and letting go of it
// when you should.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
const p = await ctx.newPage(); p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
p.on('dialog', (d) => d.accept())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const amount = () => p.locator('#main-content input[type=number]').first()
const drafts = () => p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('pl_draft_')))

await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
await p.locator('#main-content input').first().fill('Sea View Villa')
await p.locator('form button[type="submit"], button:has-text("Save")').first().click()
await p.waitForTimeout(800)

console.log('\n── WHAT YOU TYPED SURVIVES LEAVING THE SCREEN ──')
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await amount().fill('9999')
await p.locator('textarea').first().fill('half typed note')
await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' })   // wander off mid-entry
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
ok('the amount is still there', (await amount().inputValue()) === '9999', await amount().inputValue())
ok('and so is the note', (await p.locator('textarea').first().inputValue()) === 'half typed note')
const body = await p.locator('#main-content').innerText()
ok('and it says so rather than filling itself in silently', /already typed/i.test(body), body.slice(0, 160).replace(/\n/g, ' | '))

console.log('\n── AND A RELOAD, WHICH IS WHAT A PHONE DOES ──')
// Backgrounding a browser on a phone often reclaims the tab; coming back is a
// reload, and everything in memory has gone.
await amount().fill('7777')
await p.waitForTimeout(700)
await p.reload({ waitUntil: 'networkidle' })
ok('the entry is still half-written', (await amount().inputValue()) === '7777', await amount().inputValue())

console.log('\n── BUT NOT AFTER IT IS ACTUALLY SAVED ──')
// The dangerous failure: a draft outliving the entry it became, so the next
// new-expense form arrives pre-filled with a copy of the last one.
await amount().fill('4242')
await p.locator('form button[type="submit"]').first().click()
await p.waitForTimeout(1500)
ok('the expense saved', (await p.locator('#main-content').innerText()).includes('4,242'))
ok('and left no draft behind', (await drafts()).length === 0, JSON.stringify(await drafts()))
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
ok('so a new entry starts blank', (await amount().inputValue()) === '', await amount().inputValue())
ok('with no restored notice', !/already typed/i.test(await p.locator('#main-content').innerText()))

console.log('\n── NOR AFTER YOU DELIBERATELY WALK AWAY ──')
await amount().fill('1111')
await p.waitForTimeout(600)
await p.locator('button:has-text("Cancel")').first().click()
await p.waitForTimeout(900)
ok('cancelling throws the draft away', (await drafts()).length === 0, JSON.stringify(await drafts()))
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
ok('and the form is blank again', (await amount().inputValue()) === '', await amount().inputValue())

console.log('\n── AND YOU CAN ALWAYS ASK FOR A BLANK ONE ──')
await amount().fill('5555')
await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' })
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
ok('the draft came back', (await amount().inputValue()) === '5555')
await p.locator('button:has-text("Start fresh")').first().click()
await p.waitForTimeout(500)
ok('starting fresh empties the form', (await amount().inputValue()) === '', await amount().inputValue())
ok('and removes the draft', (await drafts()).length === 0, JSON.stringify(await drafts()))

console.log('\n── EDITING SOMETHING IS ITS OWN DRAFT ──')
// A draft of a new entry must never leak into the form for an existing one.
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await amount().fill('3333')
await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' })
const existingId = await p.evaluate(() =>
  (JSON.parse(localStorage.getItem('pl_expenses') || '[]').find((e) => !e.deleted_at) || {}).id)
ok('there is a saved entry to edit', Boolean(existingId), String(existingId))
await p.goto(`${B}/expenses/${existingId}/edit`, { waitUntil: 'networkidle' })
const editing = await amount().inputValue()
ok('editing shows the entry, not the unrelated draft', editing !== '3333' && editing !== '', editing)
ok('and no restored notice appears on it', !/already typed/i.test(await p.locator('#main-content').innerText()))
// The new-entry draft must still be waiting where it was left.
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
ok('while the new-entry draft is untouched', (await amount().inputValue()) === '3333', await amount().inputValue())

console.log(`\n${pass} passed, ${fail} failed`); console.log('errors:', errs.length ? errs.slice(0, 4) : 'none')
await b.close(); if (fail) process.exitCode = 1
