// Two things that made these screens read as "uneven and ugly", both measured.
//
// 1. Depth. The five dark surfaces sat inside 1.13:1 of each other — a card
//    against its own input fields was 1.03:1, which is no difference at all. So
//    a form was a dark rectangle on a dark rectangle on a dark page and the
//    only thing telling them apart was a hairline border, every one the same
//    weight. A shadow cannot fix that: shadows work on light grounds by
//    simulating blocked light, and on a dark ground there is nothing for a dark
//    shadow to contrast against. Depth in a dark theme is luminance.
//
// 2. Width and height. A field whose size matches what goes in it is read
//    faster, and two related fields at two different sizes send a signal there
//    is no difference to send. Date was capped at 15rem inside a full-width row
//    while Amount filled a column nearly twice that, and Amount was 52px tall
//    beside a 44px Date because its larger type grew the line box.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, serviceWorkers: 'block' })
const p = await ctx.newPage(); p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

// How light a painted colour is, whatever notation it is written in.
//
// Two wrong turns before this worked, both worth writing down. The first parsed
// the numbers out of the string and treated them as r,g,b — but this app's
// surfaces are authored `oklch(0.245 0.052 260)`, so a lightness of 0.245 was
// read as a red channel of 0.245/255 and every surface came back the same
// near-black. The second asked the browser to resolve the colour by assigning
// it to a probe element and reading it back; Chromium keeps `oklch()` in
// computed style rather than converting, so that returned the same string it
// was given.
//
// A canvas does convert, because it has to rasterise. Painting the colour and
// reading the pixel back is the one way to get real channels out of any CSS
// colour the app might use next.
const LIGHTNESS = `(colour) => {
  const c = document.createElement('canvas')
  c.width = 1; c.height = 1
  const g = c.getContext('2d')
  g.fillStyle = colour
  g.fillRect(0, 0, 1, 1)
  const [r, gg, bb] = g.getImageData(0, 0, 1, 1).data
  const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
  return 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(bb)
}`

await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(() => {
  localStorage.clear()
  const now = new Date().toISOString()
  for (const k of ['pl_expenses', 'pl_income', 'pl_documents']) localStorage.setItem(k, '[]')
  localStorage.setItem('pl_properties', JSON.stringify([{ id: 'p1', name: 'Sea View Villa', type: 'Real Estate — Villa / House', value: 8500000, created_at: now }]))
  localStorage.setItem('pl_theme', 'dark')
  document.documentElement.classList.add('dark')
})
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(1100)

console.log('\n── THE PAGE, THE CARD AND THE FIELD ARE THREE PLANES ──')
const depth = await p.evaluate(`(() => {
  const lum = ${LIGHTNESS}
  const paintedBg = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor
      if (c && c !== 'transparent' && !/rgba\\(0, 0, 0, 0\\)/.test(c)) return c
    }
    return 'rgb(0,0,0)'
  }
  const field = document.querySelector('#main-content input[type="date"]')
  const card = field.closest('form')
  const page = document.body
  const L = (el) => lum(paintedBg(el))
  const ratio = (a, b) => { const [x, y] = [a, b].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
  return {
    page: L(page), card: L(card), field: L(field),
    cardOverPage: ratio(L(card), L(page)),
    fieldUnderCard: ratio(L(card), L(field)),
  }
})()`)
// Each step has to be a step. 1.03:1 is what "no difference" measured as.
ok('the card is a visible plane above the page', depth.cardOverPage >= 1.05,
  depth.cardOverPage.toFixed(3) + ':1')
ok('and the field is a visible plane away from the card', depth.fieldUnderCard >= 1.05,
  depth.fieldUnderCard.toFixed(3) + ':1')
// Direction, not just distance: a card that came out *darker* than the page
// would pass a distance check and still be wrong.
ok('the card is lighter than the page, not darker', depth.card > depth.page,
  JSON.stringify({ page: depth.page.toFixed(4), card: depth.card.toFixed(4) }))
ok('and the field is sunk below the card it sits on', depth.field < depth.card,
  JSON.stringify({ card: depth.card.toFixed(4), field: depth.field.toFixed(4) }))

console.log('\n── AND THE FIELDS IN A ROW ARE THE SAME SIZE ──')
const sizes = await p.evaluate(() => {
  const out = {}
  for (const lbl of ['Date', 'Amount', 'Category', 'Vendor / Payee']) {
    const holder = [...document.querySelectorAll('#main-content label, #main-content .field')]
      .find((n) => n.innerText?.trim().startsWith(lbl))
    const input = holder?.querySelector('input, select')
    if (input) {
      const r = input.getBoundingClientRect()
      out[lbl] = { w: Math.round(r.width), h: Math.round(r.height) }
    }
  }
  return out
})
const found = Object.keys(sizes)
ok('all four fields are on screen', found.length === 4, found.join(', '))
const heights = found.map((k) => sizes[k].h)
const widths = found.map((k) => sizes[k].w)
ok('every input is the same height', new Set(heights).size === 1, JSON.stringify(sizes))
ok('and the ones sharing a row are the same width', new Set(widths).size === 1, JSON.stringify(sizes))
// The amount still leads — the point was to stop it being *taller*, not to
// flatten the hierarchy. Without this the fix could be "make everything plain".
const lead = await p.evaluate(() => {
  const amount = [...document.querySelectorAll('#main-content label, #main-content .field')]
    .find((n) => n.innerText?.trim().startsWith('Amount'))?.querySelector('input')
  const date = document.querySelector('#main-content input[type="date"]')
  const px = (el) => parseFloat(getComputedStyle(el).fontSize)
  const wt = (el) => Number(getComputedStyle(el).fontWeight)
  return { amount: px(amount), date: px(date), amountWeight: wt(amount), dateWeight: wt(date) }
})
ok('the amount is still set larger than its neighbour', lead.amount > lead.date, JSON.stringify(lead))
ok('and heavier', lead.amountWeight > lead.dateWeight, JSON.stringify(lead))

console.log('\n── THE SAME ROOM ON EVERY SIDE ──')
// Uneven gutters read as a mistake even when nobody can name what is wrong.
const gutters = await p.evaluate(() => {
  const form = document.querySelector('#main-content form')
  const card = form.getBoundingClientRect()
  const first = document.querySelector('#main-content input[type="date"]').getBoundingClientRect()
  const cs = getComputedStyle(form)
  return { left: Math.round(parseFloat(cs.paddingLeft)), right: Math.round(parseFloat(cs.paddingRight)), card: Math.round(card.width), first: Math.round(first.width) }
})
ok('the card is padded evenly left and right', gutters.left === gutters.right, JSON.stringify(gutters))

ok('and nothing threw', errs.length === 0, errs.join(' ; '))
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
