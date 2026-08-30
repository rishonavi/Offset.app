// Whether the interface can actually be read, in both themes.
//
// Colour measurement lives in _colour.mjs, which explains why it is not the
// two lines it looks like it should be.
import { chromium } from './_playwright.mjs'
import { installColour, backdrops } from './_colour.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

// Each entry is a selector, what to call it, and optionally the pseudo-element
// carrying the colour.
const TARGETS = [
  ['.field-label', 'a field label'],
  ['.field-input', 'text typed into a field'],
  ['.field-input', 'a field placeholder', '::placeholder'],
  ['.form-section-title', 'a section heading'],
  ['#main-content .btn-primary', 'the primary button'],
  ['#main-content .btn-ghost', 'a secondary button'],
  ['#main-content h1', 'the page heading'],
]

const measure = async (p) => {
  await p.evaluate(installColour)
  // The centre of each element, in document coordinates, plus the colour of the
  // text sitting there. A missing element is dropped rather than guessed at.
  const found = await p.evaluate((targets) => targets.flatMap(([sel, name, pseudo]) => {
    const el = document.querySelector(sel)
    if (!el) return []
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return []
    const base = getComputedStyle(el)
    const px = parseFloat(base.fontSize)
    return [{
      name,
      colour: getComputedStyle(el, pseudo || null).color,
      point: [r.left + scrollX + r.width / 2, r.top + scrollY + r.height / 2],
      // WCAG lets large text sit at 3:1 — 24px, or 18.66px when bold.
      need: px >= 24 || (px >= 18.66 && Number(base.fontWeight) >= 700) ? 3 : 4.5,
    }]
  }), TARGETS)
  const bgs = await backdrops(p, found.map((f) => f.point))
  // Text colour can itself be translucent, so it is painted over the backdrop
  // that was measured rather than being read on its own.
  return p.evaluate(({ found, bgs }) => found.map((f, i) => {
    const bg = bgs[i]
    const fg = window.__colour.srgb([`rgb(${bg.join(',')})`, f.colour])
    return { name: f.name, need: f.need, ratio: +window.__colour.ratio(fg, bg).toFixed(2) }
  }), { found, bgs })
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
  for (const r of await measure(p)) {
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
