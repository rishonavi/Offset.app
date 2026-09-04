// The things a user actually does: create, edit, delete, filter, restore,
// export, and the keyboard. Static sweeps miss all of it.
import { chromium } from './_playwright.mjs'
import { installColour, backdrops } from './_colour.mjs'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const TMP = mkdtempSync(`${tmpdir()}/offset-flows-`)
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true, serviceWorkers: 'block' })
const p = await ctx.newPage()
p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e).slice(0, 140)))
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('ERR_FAILED') && !t.includes('404')) errs.push('CONSOLE ' + t.slice(0, 140)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${e ? '  — ' + e : ''}`) }
const rows = (k) => p.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), k)

await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(() => {
  localStorage.clear()
  localStorage.setItem('pl_properties', '[]'); localStorage.setItem('pl_expenses', '[]')
  localStorage.setItem('pl_income', '[]'); localStorage.setItem('pl_documents', '[]')
})

// ── 1. Create an asset from nothing ──
console.log('\n── CREATING AN ASSET ──')
await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
await p.locator('input').first().fill('Sea View Villa')
// The type is a grid of radio cards rather than a dropdown; the card is
// labelled with the tail of the type, so "Real Estate — Villa / House" reads
// as "Villa / House" under a Property heading.
await p.getByRole('radio', { name: 'Villa / House', exact: true }).check()
const valueField = p.locator('input[type=number]').first()
if (await valueField.count()) await valueField.fill('4200000')
await p.locator('form button[type="submit"], button:has-text("Save")').first().click()
await p.waitForTimeout(900)
let props = await rows('pl_properties')
ok('the asset is saved', props.length === 1, `${props.length}`)
ok('with the name typed', props[0]?.name === 'Sea View Villa', props[0]?.name)
ok('and the app navigates away from the form', !p.url().includes('/new'), p.url())

// ── 2. An expense against it ──
console.log('\n── LOGGING AN EXPENSE ──')
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.locator('#main-content input[type=number]').first().fill('4200')
await p.locator('form button[type="submit"]').first().click()
await p.waitForTimeout(900)
let exps = await rows('pl_expenses')
ok('the expense is saved', exps.length === 1, `${exps.length}`)
ok('with the amount typed', Number(exps[0]?.amount) === 4200, String(exps[0]?.amount))
ok('and it is attached to the asset', exps[0]?.property_id === props[0].id)

// Empty form must be refused, not silently saved.
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.locator('form button[type="submit"]').first().click()
await p.waitForTimeout(600)
ok('an empty expense is refused', (await rows('pl_expenses')).length === 1, `${(await rows('pl_expenses')).length}`)

// ── 3. Income ──
console.log('\n── LOGGING INCOME ──')
await p.goto(`${B}/income/new`, { waitUntil: 'networkidle' })
await p.locator('#main-content input[type=number]').first().fill('55000')
await p.locator('form button[type="submit"]').first().click()
await p.waitForTimeout(900)
ok('the income is saved', (await rows('pl_income')).length === 1)

// ── 4. The dashboard reflects it ──
console.log('\n── THE DASHBOARD ──')
await p.goto(B, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
const dash = await p.locator('#main-content').innerText()
ok('income appears on the dashboard', /55,000/.test(dash), dash.slice(0, 200).replace(/\n/g, ' | '))
ok('the expense appears too', /4,200/.test(dash))
ok('no placeholder maths leaked', !/NaN|undefined/.test(dash))

// ── 5. Editing ──
console.log('\n── EDITING ──')
const eid = (await rows('pl_expenses'))[0].id
await p.goto(`${B}/expenses/${eid}/edit`, { waitUntil: 'networkidle' })
const amount = p.locator('#main-content input[type=number]').first()
ok('the form opens with the saved amount', (await amount.inputValue()) === '4200', await amount.inputValue())
await amount.fill('5100')
await p.locator('form button[type="submit"]').first().click()
await p.waitForTimeout(900)
exps = await rows('pl_expenses')
ok('the edit is saved', Number(exps[0].amount) === 5100, String(exps[0].amount))
ok('and no duplicate row was created', exps.length === 1, `${exps.length}`)

// ── 6. Filtering and search ──
console.log('\n── FILTERS ──')
await p.evaluate(() => {
  const list = JSON.parse(localStorage.getItem('pl_expenses'))
  const pid = list[0].property_id
  for (let i = 0; i < 12; i++) {
    list.push({ id: 'x' + i, property_id: pid, category: i % 2 ? 'Utilities' : 'Insurance', vendor: i % 2 ? 'Adani' : 'Bajaj', amount: 1000 + i, date: `2026-0${(i % 8) + 1}-05`, status: 'paid' })
  }
  localStorage.setItem('pl_expenses', JSON.stringify(list))
})
await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' })
await p.waitForTimeout(400)
const allRows = await p.locator('tbody tr').count()
await p.locator('input[aria-label="Search expenses"]').fill('Adani')
await p.waitForTimeout(500)
const searched = await p.locator('tbody tr').count()
ok('search narrows the list', searched > 0 && searched < allRows, `${allRows} → ${searched}`)
const shown = await p.locator('tbody').innerText()
ok('and only matching rows remain', !/Bajaj/.test(shown))
await p.locator('input[aria-label="Search expenses"]').fill('')
await p.waitForTimeout(400)
await p.locator('select[aria-label="Filter by category"]').selectOption('Insurance')
await p.waitForTimeout(500)
ok('the category filter works', !/Utilities/.test(await p.locator('tbody').innerText()))
await p.locator('select[aria-label="Filter by category"]').selectOption('')
await p.waitForTimeout(400)
ok('clearing it restores the list', (await p.locator('tbody tr').count()) === allRows, `${await p.locator('tbody tr').count()} vs ${allRows}`)
await p.locator('input[aria-label="Search expenses"]').fill('zzzznothing')
await p.waitForTimeout(500)
ok('a search with no matches says so, rather than showing a blank table',
  /no expenses|nothing|no match/i.test(await p.locator('#main-content').innerText()))

// ── 7. Delete and restore ──
console.log('\n── DELETE AND RESTORE ──')
await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' })
const before = (await rows('pl_expenses')).filter((r) => !r.deleted_at).length
await p.locator('tbody tr').first().hover()
const del = p.locator('tbody tr').first().locator('button[title="Delete"], button[aria-label*="Delete"]').first()
if (await del.count()) {
  await del.click()
  await p.waitForTimeout(400)
  const confirmBtn = p.locator('[role="alertdialog"] button', { hasText: /Delete|Confirm/ })
  if (await confirmBtn.count()) await confirmBtn.last().click()
  await p.waitForTimeout(700)
  const after = (await rows('pl_expenses')).filter((r) => !r.deleted_at).length
  ok('deleting removes one row', after === before - 1, `${before} → ${after}`)
  await p.goto(`${B}/bin`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(400)
  const binText = await p.locator('#main-content').innerText()
  ok('the deleted row is in the bin', !/bin is empty/i.test(binText), binText.slice(0, 80).replace(/\n/g, ' '))
  const restore = p.locator('button[aria-label="Restore this item"], button[title="Restore"]').first()
  if (await restore.count()) {
    await restore.click()
    await p.waitForTimeout(800)
    const back = (await rows('pl_expenses')).filter((r) => !r.deleted_at).length
    ok('restoring brings it back', back === before, `${back} vs ${before}`)
  } else ok('the bin offers a restore', false, 'no restore button')
} else ok('a row can be deleted', false, 'no delete control found')

// ── 8. Exports ──
console.log('\n── EXPORTS ──')
// Exporting moved off /reports when that page was split in two: reading what
// the year came to is one errand, taking the rows somewhere else is another.
await p.goto(`${B}/exports`, { waitUntil: 'networkidle' })
await p.locator('#main-content button:has-text("Excel")').first().waitFor({ state: 'visible' })
for (const [label, ext] of [[/CSV/i, 'csv'], [/Excel/i, 'xlsx'], [/PDF/i, 'pdf']]) {
  const btn = p.locator('#main-content button', { hasText: label }).first()
  if (!(await btn.count())) { ok(`${ext} export exists`, false, 'button not found'); continue }
  try {
    const dl = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), btn.click()]).then(([d]) => d)
    const path = `${TMP}/out.${ext}`
    await dl.saveAs(path)
    const bytes = readFileSync(path)
    ok(`${ext} export produces a real file`, bytes.length > 200, `${bytes.length} bytes`)
    if (ext === 'pdf') ok('the PDF is a valid PDF', bytes.subarray(0, 5).toString() === '%PDF-')
    if (ext === 'csv') ok('the CSV has the data in it', bytes.toString().includes('Adani') || bytes.toString().split('\n').length > 2)
  } catch (e) {
    ok(`${ext} export downloads`, false, String(e.message).slice(0, 60))
  }
}

// ── 9. Keyboard and palette ──
console.log('\n── KEYBOARD ──')
await p.goto(B, { waitUntil: 'networkidle' })
await p.keyboard.press('Control+k')
await p.waitForTimeout(400)
ok('⌘K opens the palette', await p.locator('[aria-label="Command palette"]').isVisible())
await p.locator('input[aria-label="Command palette search"]').fill('expenses')
await p.waitForTimeout(300)
await p.keyboard.press('Enter')
await p.waitForTimeout(700)
ok('the palette navigates', p.url().includes('/expenses'), p.url())
await p.keyboard.press('n')
await p.waitForTimeout(500)
ok('"n" opens quick-add', (await p.locator('[role="dialog"]').count()) > 0)
await p.keyboard.press('Escape')
await p.waitForTimeout(300)
ok('Escape closes it', (await p.locator('[role="dialog"]').count()) === 0)
await p.keyboard.press('?')
await p.waitForTimeout(400)
ok('"?" opens the shortcuts sheet', await p.locator('[aria-label="Keyboard shortcuts"]').isVisible())
await p.keyboard.press('Escape')

// ── 10. Theme ──
console.log('\n── THEME ──')
await p.goto(B, { waitUntil: 'networkidle' })
const themeBtn = p.locator('button[aria-label="Toggle theme"]').first()
const wasDark = await p.evaluate(() => document.documentElement.classList.contains('dark'))
await themeBtn.click()
await p.waitForTimeout(400)
ok('the theme toggles', (await p.evaluate(() => document.documentElement.classList.contains('dark'))) !== wasDark)
await p.reload({ waitUntil: 'networkidle' })
ok('and is remembered', (await p.evaluate(() => document.documentElement.classList.contains('dark'))) !== wasDark)

// Dark-mode readability, measured from pixels rather than assumed. The colour
// work lives in _colour.mjs — it is not the two lines it looks like it is.
await p.evaluate(installColour)
const spots = await p.evaluate(() =>
  [...document.querySelectorAll('#main-content h1,#main-content h2,#main-content p,#main-content td,#main-content th')]
    .slice(0, 40)
    .flatMap((el) => {
      const text = el.innerText?.trim()
      if (!text || el.classList.contains('sr-only')) return []
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) return []
      const cs = getComputedStyle(el)
      const size = parseFloat(cs.fontSize)
      return [{
        label: `${el.tagName} "${text.slice(0, 24)}"`,
        colour: cs.color,
        point: [r.left + scrollX + r.width / 2, r.top + scrollY + r.height / 2],
        need: size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700) ? 3 : 4.5,
      }]
    }))
const grounds = await backdrops(p, spots.map((s) => s.point))
const contrast = await p.evaluate(({ spots, grounds }) => spots.flatMap((s, i) => {
  const bg = grounds[i]
  const fg = window.__colour.srgb([`rgb(${bg.join(',')})`, s.colour])
  const ratio = window.__colour.ratio(fg, bg)
  return ratio < s.need ? [`${s.label} ${ratio.toFixed(2)}:1`] : []
}), { spots, grounds })
ok('dark-mode text meets 4.5:1', contrast.length === 0, contrast.slice(0, 3).join(' · '))
await themeBtn.click()

console.log(`\n${pass} passed, ${fail} failed`)
console.log('errors:', errs.length ? errs.slice(0, 5) : 'none')
await b.close()
