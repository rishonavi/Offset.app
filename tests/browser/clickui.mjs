// Press everything, on every page, and see whether anything breaks.
//
// This exists because splitting the reports page left `baseName` behind in the
// other half, so the year-end PDF button threw ReferenceError. Nothing rendered
// wrong — the page looked perfect and the whole suite passed — because the
// reference was only reached on the click. Every other suite here asks whether
// the app looks right or whether one flow works end to end; none of them
// pressed every button and watched.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const ROUTES = ['/', '/personal', '/properties', '/properties/new', '/income', '/income/new',
  '/expenses', '/expenses/new', '/bills', '/import', '/invoices', '/reports', '/exports',
  '/bin', '/settings', '/companies']
// Anything that destroys data or ends the session. Skipped by name, since the
// point is to exercise the app rather than to empty it.
const DESTRUCTIVE = /delete|remove|sign out|log out|clear|discard|purge|reset|danger|restore/i

const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
let pass = 0, fail = 0, clicked = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const SEED = () => {
  try { if (localStorage.getItem('pl_properties')) return } catch { return }
  const now = new Date().toISOString()
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'a1', name: 'Sea View Villa', type: 'Real Estate — Apartment / Flat', value: 9000000, created_at: now }]))
  localStorage.setItem('pl_expenses', JSON.stringify(Array.from({ length: 8 }, (_, i) => ({
    id: `e${i}`, property_id: 'a1', date: `2026-0${(i % 9) + 1}-10`, amount: 1000 + i,
    category: 'Utilities', vendor: 'Ravi', tax: 90,
    status: i < 2 ? 'unpaid' : 'paid', created_at: now }))))
  localStorage.setItem('pl_income', JSON.stringify([{ id: 'i1', property_id: 'a1', date: '2026-01-05',
    amount: 50000, source: 'Rent', tax: 500, status: 'received', created_at: now }]))
}

for (const route of ROUTES) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
  const p = await ctx.newPage()
  p.setDefaultTimeout(15000)
  const errs = []
  // The invoice preview is a sandbox="" iframe: Playwright's own instrumentation
  // throws in there by design, and that is the harness, not the app.
  p.on('pageerror', (e) => { const s = String(e); if (!/serviceWorker|sandboxed/.test(s)) errs.push(s.slice(0, 100)) })
  p.on('dialog', (d) => d.dismiss())
  await p.route('**/fonts.g**/**', (r) => r.abort())
  await p.addInitScript(SEED)
  await p.goto(B + route, { waitUntil: 'networkidle' })
  await p.waitForTimeout(500)

  const labels = await p.evaluate(() =>
    [...document.querySelectorAll('#main-content button')].map((el, i) => ({
      i, label: (el.getAttribute('aria-label') || el.innerText || el.title || '').trim().slice(0, 30),
    })))
  let pressedHere = 0
  for (const { i, label } of labels) {
    if (DESTRUCTIVE.test(label)) continue
    const btn = p.locator('#main-content button').nth(i)
    if (!(await btn.isVisible().catch(() => false))) continue
    await btn.click({ timeout: 3000 }).catch(() => {})
    pressedHere += 1
    clicked += 1
    await p.waitForTimeout(120)
    // Close whatever opened, so the next button is still reachable.
    await p.keyboard.press('Escape').catch(() => {})
  }
  await p.waitForTimeout(400)
  ok(`${route} survives ${pressedHere} presses`, errs.length === 0, errs.slice(0, 2).join(' | '))
  await ctx.close()
}

ok('and something was actually pressed', clicked > 40, `${clicked} presses`)
console.log(`\n${pass} passed, ${fail} failed · ${clicked} controls pressed`)
await b.close()
process.exit(fail ? 1 : 0)
