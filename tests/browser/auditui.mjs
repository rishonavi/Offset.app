// A sweep of every page, in both themes, looking for the classes of defect that
// do not announce themselves.
//
// The one that prompted it: a near-white divider across the top row of every
// table on the dark theme. Nothing failed, nothing logged, and the only way to
// find it was to look. So it is measured now, everywhere, rather than looked at
// on the pages someone happens to open.
import { chromium } from './_playwright.mjs'
import { installColour } from './_colour.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const ROUTES = ['/', '/personal', '/properties', '/income', '/expenses', '/bills',
                '/import', '/invoices', '/reports', '/bin', '/settings']


const seed = async (p) => {
  await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
  await p.locator('#main-content input').first().fill('Sea View Villa')
  await p.locator('form button[type="submit"], button:has-text("Save")').first().click()
  await p.waitForTimeout(700)
  for (const amt of ['16360', '8430']) {
    await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
    await p.locator('#main-content input[type=number]').first().fill(amt)
    await p.locator('form button[type="submit"]').first().click()
    await p.waitForTimeout(500)
  }
  await p.goto(`${B}/income/new`, { waitUntil: 'networkidle' })
  await p.locator('#main-content input[type=number]').first().fill('150000')
  await p.locator('form button[type="submit"]').first().click()
  await p.waitForTimeout(500)
}

const borders = new Map()
for (const theme of ['light', 'dark']) {
  console.log(`\n── ${theme.toUpperCase()}: EVERY PAGE ──`)
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
  const p = await ctx.newPage(); p.setDefaultTimeout(30000)
  await p.route('**/fonts.g**/**', (r) => r.abort())
  const errors = []
  // serviceWorkers:'block' makes the sandbox throw on navigator.serviceWorker.
  // That is the harness, not the app, and every other suite filters it too.
  p.on('pageerror', (e) => {
    const s = String(e)
    if (s.includes('serviceWorker')) return
    errors.push(`${p.url().replace(B, '')}: ${s.slice(0, 120)}`)
  })
  await seed(p)
  await p.evaluate((t) => localStorage.setItem('pl_theme', t), theme)

  const borderSeen = new Map()
  const strayFills = []
  const unnamed = []
  for (const route of ROUTES) {
    await p.goto(B + route, { waitUntil: 'networkidle' })
    await p.waitForTimeout(600)
    await p.evaluate(installColour)
    await p.evaluate(() => {
      const paper = getComputedStyle(document.documentElement).getPropertyValue('--color-paper').trim()
      const probe = document.createElement('div')
      probe.style.backgroundColor = paper
      document.body.append(probe)
      window.__paper = getComputedStyle(probe).backgroundColor
      probe.remove()
    })
    const found = await p.evaluate((isDark) => {
      const out = { borders: [], fills: [], unnamed: [] }
      const seen = new Set()
      for (const el of document.querySelectorAll('#main-content *')) {
        const cs = getComputedStyle(el)
        if (el.getBoundingClientRect().width === 0) continue
        // A swatch is a picture of a colour, not a surface painted in it. The
        // tone chips show the light ground beside the dark one on purpose, so
        // you can see what a tone does to both themes without switching.
        if (el.closest('[data-preview]')) continue
        // Every border is recorded in both themes; which of them is a defect is
        // decided afterwards, because a colour on its own cannot say. A light
        // border on a dark ground is correct when it was chosen for the dark
        // theme — a selection ring has to be light to be seen — and wrong when
        // it is a light-theme colour that never got a dark variant. What tells
        // them apart is whether the colour changed with the theme at all.
        for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
          if (parseFloat(cs[`border${side}Width`]) < 0.5) continue
          const c = cs[`border${side}Color`]
          if (!c || c === 'rgba(0, 0, 0, 0)') continue
          const key = `${String(el.className).slice(0, 46)} ${side.toLowerCase()}`
          if (!seen.has('b' + key)) {
            seen.add('b' + key)
            // A hairline of white at a tenth of an opacity is how a dark panel
            // gets an edge at all, so the alpha question is asked here as it is
            // for the fills below.
            out.borders.push({ key, light: window.__lum(c) > 0.6 && window.__alpha(c) > 0.5 })
          }
        }
        const bg = cs.backgroundColor
        // One colour is light on the dark ground on purpose: `--color-paper`,
        // the sheet an invoice preview or a scanned receipt is drawn on. The
        // design system says so in one place, and this reads that rather than
        // carrying a list of blessed elements.
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== window.__paper) {
          const l = window.__lum(bg)
          const alpha = window.__alpha(bg)
          if (isDark && l > 0.75 && alpha > 0.5) {
            const key = 'bg' + el.className
            if (!seen.has(key)) { seen.add(key); out.fills.push(String(el.className).slice(0, 50)) }
          }
        }
        // An icon-only control with nothing to announce.
        if ((el.tagName === 'BUTTON' || el.tagName === 'A') && !el.innerText.trim()) {
          if (!el.getAttribute('aria-label') && !el.getAttribute('title')) {
            out.unnamed.push(`${el.tagName} ${String(el.className).slice(0, 40)}`)
          }
        }
      }
      return out
    }, theme === 'dark')
    for (const x of found.borders) borderSeen.set(`${route} ${x.key}`, x.light)
    for (const x of found.fills) strayFills.push(`${route} ${x}`)
    for (const x of found.unnamed) unnamed.push(`${route} ${x}`)
  }
  borders.set(theme, borderSeen)
  ok(`no panel keeps a light fill`, strayFills.length === 0, strayFills.slice(0, 5).join(' | '))
  ok(`every icon-only control has a name`, unnamed.length === 0, [...new Set(unnamed)].slice(0, 5).join(' | '))
  ok(`no page threw`, errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
}

console.log('\n── BORDERS THAT NEVER HEARD ABOUT THE DARK THEME ──')
{
  // A border is only a defect when it is light on the dark ground *and* is the
  // very same colour it was in the light theme — that is what "nobody wrote a
  // dark variant" looks like. A light border that changed between the themes was
  // chosen for the dark one, and a selection ring has to be light to be seen.
  const dark = borders.get('dark') || new Map()
  const light = borders.get('light') || new Map()
  const stray = [...dark].filter(([key, isLight]) => isLight && light.get(key) === true).map(([key]) => key)
  ok('no border is the wrong side of the ground it sits on', stray.length === 0, stray.slice(0, 5).join(' | '))
  ok('and the sweep actually saw some borders', dark.size > 20, `${dark.size} seen`)
}

console.log('\n── ON A PHONE, EVERY PAGE ──')
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
  const p = await ctx.newPage(); p.setDefaultTimeout(30000)
  await p.route('**/fonts.g**/**', (r) => r.abort())
  await seed(p)
  const wide = []
  for (const route of ROUTES) {
    await p.goto(B + route, { waitUntil: 'networkidle' })
    await p.waitForTimeout(500)
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (over > 2) wide.push(`${route} +${over}px`)
  }
  ok('nothing scrolls sideways', wide.length === 0, wide.join(' | '))
  await ctx.close()
}

console.log('\n── UNDER LOAD ──')
{
  // Written straight into storage rather than through the form: the point is
  // how the app copes with a ledger someone has actually used for years, not
  // how fast Playwright can type.
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
  const p = await ctx.newPage(); p.setDefaultTimeout(60000)
  await p.route('**/fonts.g**/**', (r) => r.abort())
  const errors = []
  p.on('pageerror', (e) => { if (!String(e).includes('serviceWorker')) errors.push(String(e).slice(0, 120)) })
  await p.goto(B, { waitUntil: 'networkidle' })
  const seeded = await p.evaluate(() => {
    const assets = Array.from({ length: 25 }, (_, i) => ({
      id: `a${i}`, name: `Asset ${i}`, type: 'Real Estate — Apartment / Flat',
      value: 1000000 + i * 5000, created_at: new Date().toISOString(),
    }))
    const cats = ['Utilities', 'Maintenance & Repairs', 'Property Tax', 'Insurance', 'Materials']
    const expenses = Array.from({ length: 2000 }, (_, i) => ({
      id: `e${i}`, property_id: `a${i % 25}`, date: `20${20 + (i % 6)}-${String((i % 12) + 1).padStart(2, '0')}-15`,
      amount: 500 + (i % 900) * 7, category: cats[i % cats.length], vendor: `Vendor ${i % 60}`,
      status: i % 4 === 0 ? 'unpaid' : 'paid', created_at: new Date().toISOString(),
    }))
    const income = Array.from({ length: 400 }, (_, i) => ({
      id: `i${i}`, property_id: `a${i % 25}`, date: `20${22 + (i % 4)}-${String((i % 12) + 1).padStart(2, '0')}-05`,
      amount: 20000 + i * 13, source: 'Rent', created_at: new Date().toISOString(),
    }))
    localStorage.setItem('pl_properties', JSON.stringify(assets))
    localStorage.setItem('pl_expenses', JSON.stringify(expenses))
    localStorage.setItem('pl_income', JSON.stringify(income))
    return { assets: assets.length, expenses: expenses.length, income: income.length }
  })
  console.log(`   seeded ${seeded.assets} assets, ${seeded.expenses} expenses, ${seeded.income} income entries`)

  for (const [route, label] of [['/', 'the dashboard'], ['/expenses', 'the expense list'],
                                ['/properties', 'the asset list'], ['/reports', 'reports'], ['/bills', 'bills']]) {
    const t0 = Date.now()
    await p.goto(B + route, { waitUntil: 'networkidle' })
    await p.waitForSelector('#main-content', { timeout: 60000 })
    await p.waitForTimeout(400)
    const ms = Date.now() - t0
    ok(`${label} still renders`, ms < 15000, `${ms}ms`)
  }

  // The claim in the README is that long lists render a page at a time. Two
  // thousand rows in the DOM at once is what that claim exists to prevent.
  await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(700)
  const rows = await p.evaluate(() => document.querySelectorAll('#main-content tbody tr').length)
  ok('the list pages rather than rendering everything', rows > 0 && rows < 300, `${rows} rows in the DOM`)

  // Typing into a filter over 2,000 rows is where a slow path shows up.
  const search = p.locator('input[aria-label="Search expenses"]')
  if (await search.count()) {
    const t0 = Date.now()
    await search.fill('Vendor 42')
    await p.waitForTimeout(600)
    ok('filtering stays responsive', Date.now() - t0 < 5000, `${Date.now() - t0}ms`)
  }
  ok('nothing threw under load', errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
}

console.log(`\n${pass} passed, ${fail} failed`)
await b.close(); if (fail) process.exitCode = 1
