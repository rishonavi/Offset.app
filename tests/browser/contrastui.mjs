// Whether the interface can actually be read, in both themes.
//
// Colours are normalised through a canvas fillStyle before anything is measured.
// Tailwind v4 emits oklch(), and a checker that pulls the digits out of a colour
// string produces confident nonsense — it once scored slate-900 on cream at
// 1.89:1 when it is really about 15:1.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const MEASURE = () => {
  const cv = document.createElement('canvas').getContext('2d')
  const rgb = (c) => {
    cv.fillStyle = '#000'
    cv.fillStyle = c
    const h = cv.fillStyle
    if (h.startsWith('#')) return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
    const m = h.match(/[\d.]+/g)
    return m ? m.slice(0, 3).map(Number) : [0, 0, 0]
  }
  const lum = (c) =>
    rgb(c)
      .map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
      .reduce((a, v, i) => a + [0.2126, 0.7152, 0.0722][i] * v, 0)
  const ratio = (fg, bg) => { const a = lum(fg), c = lum(bg); const [hi, lo] = a > c ? [a, c] : [c, a]; return (hi + 0.05) / (lo + 0.05) }
  // A gradient cannot be measured, so the nearest painted ancestor is used —
  // and anything still transparent is skipped rather than guessed at.
  const bgOf = (el) => {
    let n = el
    while (n) {
      const c = getComputedStyle(n).backgroundColor
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c
      n = n.parentElement
    }
    return null
  }
  const out = []
  const add = (sel, name, pseudo) => {
    const el = document.querySelector(sel)
    if (!el) return
    const bg = bgOf(el)
    if (!bg) return
    const cs = getComputedStyle(el, pseudo)
    const px = parseFloat(getComputedStyle(el).fontSize)
    const bold = Number(getComputedStyle(el).fontWeight) >= 700
    out.push({ name, ratio: +ratio(cs.color, bg).toFixed(2), need: px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5 })
  }
  add('.field-label', 'a field label')
  add('.field-input', 'text typed into a field')
  add('.field-input', 'a field placeholder', '::placeholder')
  add('.form-section-title', 'a section heading')
  add('#main-content .btn-primary', 'the primary button')
  add('#main-content .btn-ghost', 'a secondary button')
  add('#main-content h1', 'the page heading')
  return out
}

for (const theme of ['light', 'dark']) {
  console.log(`\n── ${theme.toUpperCase()} ──`)
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
  const p = await ctx.newPage(); p.setDefaultTimeout(30000)
  await p.route('**/fonts.g**/**', (r) => r.abort())
  await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
  await p.locator('#main-content input').first().fill('Sea View Villa')
  await p.locator('form button[type="submit"], button:has-text("Save")').first().click()
  await p.waitForTimeout(800)
  await p.evaluate((t) => localStorage.setItem('pl_theme', t), theme)
  await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(700)
  for (const r of await p.evaluate(MEASURE)) {
    ok(`${r.name} is readable`, r.ratio >= r.need, `${r.ratio}:1, needs ${r.need}:1`)
  }
  await ctx.close()
}

console.log('\n── THE FORM ON A PHONE ──')
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 850 }, serviceWorkers: 'block' })
  const p = await ctx.newPage()
  await p.route('**/fonts.g**/**', (r) => r.abort())
  await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
  await p.locator('#main-content input').first().fill('Villa')
  await p.locator('form button[type="submit"], button:has-text("Save")').first().click()
  await p.waitForTimeout(800)
  await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(600)
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ok('no sideways scroll', overflow <= 2, `${overflow}px`)
  // The two-column grid is a sm: breakpoint, so a phone gets one column and the
  // fields keep their full width rather than being squeezed into halves.
  const stacked = await p.evaluate(() => {
    const boxes = [...document.querySelectorAll('#main-content label.block')].map((l) => l.getBoundingClientRect())
    return boxes.every((r) => r.width > 250)
  })
  ok('fields are full width rather than squeezed into columns', stacked)
  // A control small enough to miss is a control that gets mistyped.
  const tooShort = await p.evaluate(() =>
    [...document.querySelectorAll('#main-content input:not([type=hidden]):not([type=file]), #main-content select')]
      .filter((el) => el.getBoundingClientRect().height < 40).length)
  ok('every control is a comfortable size to tap', tooShort === 0, `${tooShort} under 40px tall`)
  await ctx.close()
}

console.log('\n── TARGETS BIG ENOUGH TO HIT ──')
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 850 }, serviceWorkers: 'block' })
  const p = await ctx.newPage()
  await p.route('**/fonts.g**/**', (r) => r.abort())
  await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
  await p.locator('#main-content input').first().fill('Villa')
  await p.locator('form button[type="submit"], button:has-text("Save")').first().click()
  await p.waitForTimeout(800)
  await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(600)
  // Apple's HIG says 44pt, Material says 48dp. 44 is the floor either way.
  const small = await p.evaluate(() =>
    [...document.querySelectorAll('#main-content button, #main-content input:not([type=hidden]):not([type=file]), #main-content select')]
      .map((el) => ({ r: el.getBoundingClientRect(), label: (el.innerText || el.type || el.tagName).slice(0, 22) }))
      .filter((x) => x.r.height > 0 && x.r.height < 44)
      .map((x) => `${x.label} ${Math.round(x.r.height)}px`))
  ok('every control clears 44px', small.length === 0, small.join(', '))
  await ctx.close()
}

console.log('\n── WHEN SOMEONE ASKS FOR LESS MOTION ──')
{
  // Animation that cannot be turned off is a barrier for vestibular disorders,
  // and every operating system has had the setting to say so for years.
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', reducedMotion: 'reduce' })
  const p = await ctx.newPage()
  await p.route('**/fonts.g**/**', (r) => r.abort())
  await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(500)
  const moving = await p.evaluate(() =>
    [...document.querySelectorAll('#main-content *')]
      .filter((el) => {
        const cs = getComputedStyle(el)
        const dur = (v) => Math.max(...String(v).split(',').map((x) => parseFloat(x) || 0))
        return dur(cs.transitionDuration) > 0.05 || dur(cs.animationDuration) > 0.05
      }).length)
  ok('nothing animates', moving === 0, `${moving} elements still animating`)
  await ctx.close()
}

console.log('\n── ASYNC RESULTS ARE ANNOUNCED ──')
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
  const p = await ctx.newPage()
  await p.route('**/fonts.g**/**', (r) => r.abort())
  // A fresh context has no asset, and the expense form does not render without
  // one — so there would be no form to submit.
  await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
  await p.locator('#main-content input').first().fill('Villa')
  await p.locator('form button[type="submit"], button:has-text("Save")').first().click()
  await p.waitForTimeout(800)
  await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
  // Submitting with no amount is the quickest way to a message.
  await p.locator('form button[type="submit"]').first().click()
  await p.waitForTimeout(700)
  const announced = await p.evaluate(() =>
    Boolean(document.querySelector('#main-content [role="alert"], #main-content [aria-live]')))
  ok('a validation failure is announced, not only shown', announced)
  await ctx.close()
}

console.log(`\n${pass} passed, ${fail} failed`)
await b.close(); if (fail) process.exitCode = 1
