// The ⌘K palette: what it finds, and what it remembers about finding it.
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

// Group headings are uppercased in CSS, so innerText gives "RECENT SEARCHES".
// Matching case-insensitively keeps the test about the words, not the styling.
const openPalette = async () => {
  // Close whatever is open and put focus somewhere the shortcut will reach,
  // rather than wherever the last click left it.
  if (await p.locator('[role="dialog"]').count()) {
    await p.keyboard.press('Escape')
    await p.waitForTimeout(250)
  }
  await p.locator('body').click({ position: { x: 5, y: 5 } })
  await p.keyboard.press('Control+k')
  await p.locator('[role="dialog"] input').first().waitFor({ state: 'visible' })
  await p.waitForTimeout(200)
}
const box = () => p.locator('[role="dialog"] input').first()
const panel = () => p.locator('[role="dialog"]').innerText()
const history = () => p.evaluate(() => {
  try { return (JSON.parse(localStorage.getItem('pl_search_history')) || []).map((r) => r.q) } catch { return [] }
})

await p.goto(`${B}/`, { waitUntil: 'networkidle' })
await p.evaluate(() => {
  const now = new Date().toISOString()
  localStorage.removeItem('pl_search_history')
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'a1', name: 'Sea View Villa', type: 'Real Estate — Apartment / Flat', address: 'Marine Drive', created_at: now },
    { id: 'a2', name: 'Café Corner', type: 'Commercial — Shop', address: 'Linking Road', created_at: now },
  ]))
  localStorage.setItem('pl_expenses', JSON.stringify([
    { id: 'e1', property_id: 'a1', date: '2026-03-01', amount: 4200, category: 'Maintenance & Repairs', vendor: 'Ravi Plumbing', status: 'paid', created_at: now },
  ]))
})
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(500)

console.log('── WORDS IN ANY ORDER ──')
await openPalette()
await box().fill('sea view')
await p.waitForTimeout(300)
ok('the words as written find the asset', /Sea View Villa/.test(await panel()))
await box().fill('villa sea')
await p.waitForTimeout(300)
ok('and so do the words reversed', /Sea View Villa/.test(await panel()))
await box().fill('villa plumbing')
await p.waitForTimeout(300)
// No single field holds both words — the asset name is on the expense's asset,
// the vendor on the expense itself.
ok('words from different records find the bill', /Ravi Plumbing/.test(await panel()))

console.log('\n── ACCENTS ARE NOT A BARRIER ──')
await box().fill('cafe')
await p.waitForTimeout(300)
ok('an unaccented query finds the accented name', /Café Corner/.test(await panel()))

console.log('\n── NOTHING IS REMEMBERED UNTIL SOMETHING IS PICKED ──')
// Saving on every keystroke would fill the list with "s", "se", "sea".
ok('typing alone records nothing', (await history()).length === 0, JSON.stringify(await history()))
await box().fill('villa')
await p.waitForTimeout(300)
await p.keyboard.press('Enter')
await p.waitForTimeout(600)
ok('acting on a result records the search', (await history()).includes('villa'), JSON.stringify(await history()))
ok('and only the whole search, not its prefixes', (await history()).length === 1, JSON.stringify(await history()))

console.log('\n── AND OFFERED BACK NEXT TIME ──')
await openPalette()
ok('an empty palette shows what was searched before', /recent searches/i.test(await panel()))
ok('with the search in it', /villa/i.test(await panel()))
ok('and says how long it is kept', /7 days/.test(await panel()))

console.log('\n── PICKING ONE PUTS IT BACK IN THE BOX ──')
await p.locator('[role="dialog"] [data-idx="0"]').click()
await p.waitForTimeout(400)
ok('the query is filled in', (await box().inputValue()) === 'villa')
ok('and it is not recorded a second time', (await history()).length === 1, JSON.stringify(await history()))

console.log('\n── A WEEK OLD IS TOO OLD ──')
await p.evaluate(() => {
  const old = Date.now() - 8 * 24 * 60 * 60 * 1000
  localStorage.setItem('pl_search_history', JSON.stringify([{ q: 'last month', at: old }]))
})
await openPalette()
ok('an expired search is not offered', !/last month/.test(await panel()))

console.log('\n── AND IT CAN BE CLEARED ──')
await openPalette()
await box().fill('plumbing')
await p.waitForTimeout(300)
await p.keyboard.press('Enter')
await p.waitForTimeout(600)
ok('there is something to clear', (await history()).length > 0)
await openPalette()
await p.locator('[role="dialog"] button:has-text("Clear recent searches")').click()
await p.waitForTimeout(400)
ok('clearing empties the list', (await history()).length === 0, JSON.stringify(await history()))
ok('and the group goes with it', !/recent searches/i.test(await panel()))

console.log('\n── DELETING EVERYTHING DELETES THIS TOO ──')
// "All your data" has to mean all of it.
await openPalette()
await box().fill('villa')
await p.waitForTimeout(300)
await p.keyboard.press('Enter')
await p.waitForTimeout(600)
ok('a search is stored again', (await history()).length === 1)
p.on('dialog', (d) => d.accept())
await p.goto(`${B}/settings`, { waitUntil: 'networkidle' })
await p.locator('button:has-text("Delete all my data")').click()
await p.waitForTimeout(1500)
ok('delete-all takes the search history with it', (await history()).length === 0, JSON.stringify(await history()))

ok('nothing threw', errs.length === 0, errs.slice(0, 2).join(' | '))
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
