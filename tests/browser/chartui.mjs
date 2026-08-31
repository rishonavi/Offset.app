// Whether a chart says what it means, or only shows it in colour.
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

const CATS = ['Utilities', 'Maintenance & Repairs', 'Property Tax', 'Insurance', 'Materials']
await p.goto(`${B}/`, { waitUntil: 'networkidle' })
await p.evaluate((cats) => {
  const now = new Date().toISOString()
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'a1', name: 'Sea View Villa', type: 'Real Estate — Apartment / Flat', created_at: now }]))
  localStorage.setItem('pl_expenses', JSON.stringify(cats.flatMap((c, i) =>
    Array.from({ length: 3 }, (_, j) => ({
      id: `e${i}${j}`, property_id: 'a1', date: new Date().toISOString().slice(0, 10),
      amount: 1000 * (i + 1) + j * 50, category: c, status: 'paid', created_at: now })))))
}, CATS)
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)

const key = () => p.evaluate(() =>
  [...document.querySelectorAll('dl')].map((d) => d.innerText).find((t) => /Utilities/.test(t)) || '')

console.log('── THE DONUT SAYS WHAT IT SHOWS ──')
{
  const text = await key()
  ok('there is a written key, not just a ring', text.length > 0, 'no dl found')
  // Every category has to be named. Colour alone is unusable to anyone on a
  // keyboard, on a phone, or who cannot separate two of the hues.
  const missing = CATS.filter((c) => !text.includes(c))
  ok('every slice is named in words', missing.length === 0, missing.join(', '))
  ok('with its amount', /₹[\d,]+/.test(text), text.slice(0, 60))
  ok('and its share', /\d+%/.test(text), text.slice(0, 60))
  const pcts = [...text.matchAll(/(\d+)%/g)].map((m) => Number(m[1]))
  ok('the shares add up', Math.abs(pcts.reduce((a, n) => a + n, 0) - 100) <= 2, `${pcts.join('+')} = ${pcts.reduce((a, n) => a + n, 0)}`)
}

console.log('\n── NONE OF IT NEEDS A POINTER ──')
{
  // The tooltip was the only place these numbers lived. A tooltip needs a mouse
  // hovering a slice — which rules out touch, keyboard and screen readers.
  const withoutHover = await key()
  ok('the figures are present with nothing hovered', /₹/.test(withoutHover))
  const readable = await p.evaluate(() => {
    const dl = [...document.querySelectorAll('dl')].find((d) => /Utilities/.test(d.innerText))
    if (!dl) return null
    // A screen reader walks the text; the swatches must not be part of it.
    const swatches = [...dl.querySelectorAll('span[aria-hidden="true"]')].length
    const rows = dl.children.length
    return { swatches, rows, tag: dl.tagName }
  })
  ok('the key is a definition list, not a pile of divs', readable?.tag === 'DL')
  ok('and the colour swatches are hidden from screen readers',
    readable && readable.swatches === readable.rows, JSON.stringify(readable))
}

console.log('\n── THE RING ITSELF IS DECORATION ──')
{
  // Recharts renders an SVG full of unlabelled paths. With the key carrying the
  // content, the picture should be skipped rather than read out as noise.
  const hidden = await p.evaluate(() => {
    const svgs = [...document.querySelectorAll('.recharts-wrapper')]
    const pies = svgs.filter((s) => s.querySelector('.recharts-pie'))
    return pies.map((s) => s.querySelector('[aria-hidden="true"], [role="presentation"]') !== null
      || s.closest('[aria-hidden="true"]') !== null)
  })
  ok('the donut is marked presentational', hidden.length > 0 && hidden.every(Boolean), JSON.stringify(hidden))
}

console.log('\n── AND ON THE PERSONAL PAGE TOO ──')
{
  await p.evaluate(() => {
    const now = new Date().toISOString()
    const cats = ['Groceries', 'Transport', 'Rent']
    localStorage.setItem('pl_personal_expenses', JSON.stringify(cats.map((c, i) => ({
      id: `p${i}`, date: new Date().toISOString().slice(0, 10), amount: 1000 * (i + 1),
      category: c, created_at: now }))))
  })
  await p.goto(`${B}/personal`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(900)
  const has = await p.evaluate(() =>
    [...document.querySelectorAll('dl')].some((d) => /%/.test(d.innerText) && /₹/.test(d.innerText)))
  const empty = await p.evaluate(() => /No spending this month/.test(document.body.innerText))
  // Either it has spending and a key, or it says there is none — never a
  // coloured ring with nothing to read.
  ok('the personal donut is keyed too, or says it is empty', has || empty, 'neither key nor empty state')
}

ok('nothing threw', errs.length === 0, errs.slice(0, 2).join(' | '))
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
