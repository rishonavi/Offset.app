// Reading what the year came to, and moving the rows somewhere else: two
// errands that used to share one page, one heading and one filter.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const open = async () => {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' })
  const p = await ctx.newPage(); p.setDefaultTimeout(30000)
  const errs = []
  p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push(s.slice(0, 120)) })
  await p.route('**/fonts.g**/**', (r) => r.abort())
  await p.addInitScript(() => {
    const now = new Date().toISOString()
    localStorage.setItem('pl_properties', JSON.stringify([
      { id: 'a1', name: 'Sea View Villa', type: 'Real Estate — Apartment / Flat', created_at: now },
      { id: 'a2', name: 'Hill Cottage', type: 'Real Estate — Apartment / Flat', created_at: now }]))
    localStorage.setItem('pl_expenses', JSON.stringify(Array.from({ length: 6 }, (_, i) => ({
      id: 'e' + i, property_id: i < 4 ? 'a1' : 'a2', date: '2026-0' + (i + 1) + '-10',
      amount: 1000 * (i + 1), category: 'Utilities', tax: 100, status: 'paid', created_at: now }))))
    localStorage.setItem('pl_income', JSON.stringify([{ id: 'i1', property_id: 'a1',
      date: '2026-01-05', amount: 50000, source: 'Rent', tax: 500, status: 'received', created_at: now }]))
  })
  return { ctx, p, errs }
}
const body = (p) => p.locator('#main-content').innerText()

console.log('── EACH PAGE DOES ONE THING ──')
{
  const { ctx, p, errs } = await open()
  await p.goto(`${B}/reports`, { waitUntil: 'networkidle' })
  await p.locator('#main-content').getByText(/year-end summary/i).first().waitFor({ state: 'visible' })
  const r = await body(p)
  ok('reports shows the year-end summary', /Tax .* year-end summary/i.test(r))
  ok('and the preview of what matched', /Preview/.test(r))
  ok('but not the export buttons', !/excel \(\.xlsx\)/i.test(r))
  ok('nor backup and restore', !/Backup & restore/i.test(r))

  await p.goto(`${B}/exports`, { waitUntil: 'networkidle' })
  // Both pages are lazy chunks, so wait for something on them rather than for
  // a guessed number of milliseconds.
  await p.locator('#main-content button:has-text("Excel")').first().waitFor({ state: 'visible' })
  const e = await body(p)
  ok('exports shows the export buttons', /excel \(\.xlsx\)/i.test(e), e.replace(/\n/g, ' | ').slice(0, 140))
  ok('and spreadsheet import', /Import from spreadsheet/i.test(e))
  ok('and backup and restore', /Backup & restore/i.test(e))
  ok('but not the year-end summary', !/year-end summary/i.test(e))
  ok('neither page threw', errs.length === 0, errs.join(' | '))
  await ctx.close()
}

console.log('\n── THE FILTER IS IN THE ADDRESS BAR ──')
{
  const { ctx, p } = await open()
  await p.goto(`${B}/reports`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(600)
  ok('a plain visit leaves a plain URL', !p.url().includes('?'), p.url())
  await p.locator('#main-content select').first().selectOption('a1')
  await p.waitForTimeout(400)
  ok('choosing an asset writes it to the URL', p.url().includes('propertyId=a1'), p.url())
  // The point of putting it there: the same view can be sent to somebody else.
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(600)
  ok('and it survives a reload', (await p.locator('#main-content select').first().inputValue()) === 'a1')
  await ctx.close()
}

console.log('\n── AND IT FOLLOWS YOU BETWEEN THE TWO ──')
{
  // Splitting the page would otherwise mean building the same filter twice —
  // which is the reason to leave two errands sharing one door in the first
  // place, and the reason not to.
  const { ctx, p } = await open()
  await p.goto(`${B}/reports?propertyId=a2&from=2026-05-01`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(600)
  const before = await body(p)
  // The href now carries the query, which is the whole point — so match on the
  // path rather than the exact string.
  await p.locator('nav a[href^="/exports"]').first().click()
  await p.waitForTimeout(800)
  ok('the asset comes with you', p.url().includes('propertyId=a2'), p.url())
  ok('and so does the date', p.url().includes('from=2026-05-01'), p.url())
  ok('the export page is filtered to it',
    (await p.locator('#main-content select').first().inputValue()) === 'a2')
  ok('and it counts only what matched', /2 expenses/.test(await body(p)),
    (await body(p)).replace(/\n/g, ' | ').slice(0, 140))
  ok('the report it came from was showing those same two', /Preview/.test(before))
  await ctx.close()
}

console.log('\n── BOTH ARE FINDABLE ──')
{
  const { ctx, p } = await open()
  await p.goto(`${B}/`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(500)
  ok('the side bar lists reports', (await p.locator('nav a[href="/reports"]').count()) === 1)
  ok('and lists export separately', (await p.locator('nav a[href="/exports"]').count()) === 1)
  // The palette has to answer the word someone actually types.
  for (const [term, href] of [['export', '/exports'], ['backup', '/exports'], ['reports', '/reports']]) {
    await p.locator('body').click({ position: { x: 5, y: 5 } })
    await p.keyboard.press('Control+k')
    await p.locator('[role="dialog"] input').first().waitFor({ state: 'visible' })
    await p.locator('[role="dialog"] input').first().fill(term)
    await p.waitForTimeout(350)
    const hit = await p.evaluate((h) => {
      const rows = [...document.querySelectorAll('[role="dialog"] [data-idx]')]
      return rows.length > 0
    }, href)
    ok(`"${term}" finds something`, hit)
    await p.keyboard.press('Escape')
    await p.waitForTimeout(250)
  }
  await ctx.close()
}

console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
