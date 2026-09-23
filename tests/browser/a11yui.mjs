// The accessibility panel, measured against the document rather than against
// itself.
//
// An accessibility widget that renders twelve handsome tiles and changes
// nothing is worse than no widget: it tells somebody the app has been made
// usable for them when it has not, and they stop looking for another way. So
// every tile here is clicked and then the *page* is asked what changed, and
// the ones that make a visual difference are checked against pixels as well as
// against computed style — a `filter` can be set on an element that is not
// painting.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })

const SEED = () => {
  localStorage.clear()
  const now = new Date().toISOString()
  const put = (k, v) => localStorage.setItem(k, JSON.stringify(v))
  put('pl_properties', [{ id: 'p1', name: 'Sea View Villa', type: 'Real Estate — Villa / House', value: 8500000, created_at: now }])
  put('pl_expenses', Array.from({ length: 30 }, (_, i) => ({ id: 'e' + i, property_id: 'p1', category: 'Repairs', amount: 1000 + i, date: '2026-09-04', status: 'paid', vendor: 'Vendor ' + i, created_at: now })))
  put('pl_income', []); put('pl_documents', [])
}

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const ctx = await b.newContext({ viewport: { width: 1280, height: 950 }, serviceWorkers: 'block' })
const p = await ctx.newPage(); p.setDefaultTimeout(20000)
await p.route('**/fonts.g**/**', (r) => r.abort())
const errors = []
p.on('pageerror', (e) => errors.push(e.message))
await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(SEED)

const open = async () => {
  if (await p.locator('[role=dialog][aria-labelledby=a11y-title]').count()) return
  await p.locator('[aria-label="Accessibility tools"]:visible').first().click()
  await p.waitForSelector('[role=dialog][aria-labelledby=a11y-title]')
  await p.waitForTimeout(150)
}
const close = async () => {
  if (!(await p.locator('[role=dialog][aria-labelledby=a11y-title]').count())) return
  await p.keyboard.press('Escape')
  await p.waitForTimeout(200)
}
// Tiles are addressed by their visible label, which is what a person clicks.
const tap = async (label, times = 1) => {
  await open()
  for (let i = 0; i < times; i++) {
    await p.locator(`[role=dialog] button[aria-pressed]`, { hasText: label }).first().click()
    await p.waitForTimeout(120)
  }
}
// What the document says about itself, after the panel is out of the way so
// nothing measured is the panel's own styling.
// One named element, not "a paragraph if there is one".
//
// The first version measured `#main-content p`, fell back to any <p> on the
// page when there wasn't one — and on /expenses there isn't — and then
// compared two empty strings, which are equal. Line height read as unchanged
// while it was working perfectly, and letter spacing read as 2px from an
// unrelated eyebrow in the banner. A probe that cannot find its subject has to
// say so, not return "".
const read = async () => {
  await close()
  const s = await p.evaluate(() => {
    const html = getComputedStyle(document.documentElement)
    const body = getComputedStyle(document.body)
    // The page heading: always present via PageHeader, always carries a
    // Tailwind type class that sets its own line-height — which is exactly the
    // thing these rules have to beat.
    const probe = document.querySelector('#main-content h1')
    const link = document.querySelector('#main-content a')
    const ps = probe && getComputedStyle(probe)
    return {
      probeFound: Boolean(probe),
      linkFound: Boolean(link),
      filter: html.filter,
      rootFontPx: parseFloat(html.fontSize),
      linkDecoration: link ? getComputedStyle(link).textDecorationLine : '',
      linkWeight: link ? getComputedStyle(link).fontWeight : '',
      lineHeight: ps ? ps.lineHeight : '',
      spacing: ps ? ps.letterSpacing : '',
      align: ps ? ps.textAlign : '',
      bodyFont: body.fontFamily,
      cursor: body.cursor,
      transition: link ? getComputedStyle(link).transitionDuration : '',
      stored: localStorage.getItem('pl_a11y'),
      attrs: [...document.documentElement.attributes].map((a) => a.name).filter((n) => n.startsWith('data-a11y')),
    }
  })
  if (!s.probeFound || !s.linkFound) {
    console.log(`**FAIL**  the probe cannot find what it measures  — h1:${s.probeFound} a:${s.linkFound}`)
    fail++
  }
  return s
}
const reset = async () => {
  await open()
  const button = p.locator('[role=dialog] button', { hasText: 'Reset all settings' }).first()
  // Disabled when there is nothing to reset, which is correct and which the
  // first version of this helper walked straight into by clicking it before
  // every case.
  if (await button.isEnabled()) {
    await button.click()
    await p.waitForTimeout(200)
  }
  await close()
}

await p.goto(B + '/expenses', { waitUntil: 'networkidle' })
await p.waitForTimeout(800)

// A comparison of two screenshots is only about the thing under test if
// everything else is the same in both. Playwright leaves its mouse wherever it
// last clicked, and a button under the cursor is a button with a hover style —
// which is what made the reset comparison fail after twelve cases of clicking
// and pass when run on its own.
const settle = async () => {
  await p.mouse.move(2, 940)
  await p.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0) })
  await p.waitForTimeout(350)
}

// ── The baseline everything else is compared against ────────────────────
const base = await read()
ok('nothing is adjusted to begin with', base.filter === 'none' && base.attrs.length === 0,
  `${base.filter} / ${base.attrs.join(',')}`)
ok('and nothing is stored', base.stored === null, String(base.stored))
await settle()
const basePixels = await p.screenshot()

// ── Each tool, against the document ─────────────────────────────────────
const CASES = [
  ['Invert colours', 1, (s) => s.filter.includes('invert('), 'filter'],
  ['Grayscale', 1, (s) => s.filter.includes('grayscale('), 'filter'],
  ['Low saturation', 1, (s) => s.filter.includes('saturate('), 'filter'],
  ['Contrast', 1, (s) => s.filter.includes('contrast('), 'filter'],
  ['Highlight links', 1, (s) => s.linkDecoration.includes('underline') && Number(s.linkWeight) >= 600, 'link'],
  ['Text size', 1, (s) => s.rootFontPx > base.rootFontPx + 1, 'root font size'],
  ['Line height', 1, (s) => parseFloat(s.lineHeight) > parseFloat(base.lineHeight) + 1, 'line height'],
  ['Letter spacing', 1, (s) => s.spacing !== base.spacing && parseFloat(s.spacing) > parseFloat(base.spacing || 0), 'letter spacing'],
  ['Text align', 2, (s) => s.align === 'center', 'alignment'],
  ['Dyslexia friendly', 1, (s) => s.bodyFont !== base.bodyFont && /Verdana|OpenDyslexic|Comic/i.test(s.bodyFont), 'font'],
  ['Bigger cursor', 1, (s) => s.cursor.startsWith('url('), 'cursor'],
  ['Reduce motion', 1, (s) => parseFloat(s.transition) < 0.01, 'transition'],
]

for (const [label, times, check, what] of CASES) {
  await reset()
  await tap(label, times)
  const s = await read()
  ok(`${label} changes the ${what}`, check(s), JSON.stringify(s).slice(0, 190))
  ok(`  and ${label} is remembered`, s.stored !== null && s.stored.length > 2, String(s.stored))
}

// ── A filter that is set but not painting is not a filter ───────────────
await reset()
await tap('Invert colours')
await close()
await settle()
const inverted = await p.screenshot()
ok('inverting actually repaints the page', !inverted.equals(basePixels))

// ── The trap this was built around ──────────────────────────────────────
// A filter makes an element the containing block for its fixed descendants.
// On <body> that tears every fixed thing in the app off the viewport; measured
// on a phone, the floating quick-add fell from y=768 to y=-132 as the page
// scrolled. The root element is the exception, and this is the check that it
// stays the exception.
{
  const phone = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' })
  const q = await phone.newPage(); q.setDefaultTimeout(20000)
  await q.route('**/fonts.g**/**', (r) => r.abort())
  await q.goto(B, { waitUntil: 'domcontentloaded' })
  await q.evaluate(SEED)
  await q.goto(B + '/expenses', { waitUntil: 'networkidle' })
  await q.waitForTimeout(700)

  const fabAfterScroll = async () => {
    await q.evaluate(() => window.scrollTo(0, 0))
    await q.waitForTimeout(150)
    const before = await q.evaluate(() => document.querySelector('[data-fab]')?.getBoundingClientRect().top ?? null)
    await q.evaluate(() => window.scrollTo(0, 900))
    await q.waitForTimeout(250)
    const after = await q.evaluate(() => document.querySelector('[data-fab]')?.getBoundingClientRect().top ?? null)
    return { before, after }
  }

  const plain = await fabAfterScroll()
  ok('the floating quick-add is fixed to begin with', plain.before !== null && plain.before === plain.after,
    JSON.stringify(plain))

  await q.evaluate(() => {
    localStorage.setItem('pl_a11y', JSON.stringify({ invert: true, contrast: 2 }))
  })
  await q.reload({ waitUntil: 'networkidle' })
  await q.waitForTimeout(700)
  const withFilter = await q.evaluate(() => getComputedStyle(document.documentElement).filter)
  ok('the filter survives a reload', withFilter.includes('invert('), withFilter)
  const filtered = await fabAfterScroll()
  ok('and the filter does not tear fixed chrome off the viewport',
    filtered.before !== null && filtered.before === filtered.after, JSON.stringify(filtered))

  // The control for that check: the same filter on <body> is the thing that
  // breaks, so if this does not break, the check above proves nothing.
  await q.evaluate(() => {
    document.documentElement.style.filter = ''
    document.body.style.filter = 'invert(1)'
  })
  const onBody = await fabAfterScroll()
  ok('  (control: the same filter on <body> does tear it off)',
    onBody.before !== onBody.after, JSON.stringify(onBody))
  await phone.close()
}

// ── Applied before the app exists ───────────────────────────────────────
//
// The settings are written to the document by an inline script in index.html,
// ahead of any module. Proved by blocking the app bundle entirely: if the
// filter is still on the root with no React on the page, the inline script did
// it. Without this, a person who inverted the page is shown a bright one for
// the length of a page load, every load — which is the exact thing they turned
// the setting on to avoid.
{
  const blank = await b.newContext({ viewport: { width: 900, height: 700 }, serviceWorkers: 'block' })
  const q = await blank.newPage(); q.setDefaultTimeout(20000)
  await q.route('**/fonts.g**/**', (r) => r.abort())
  await q.goto(B, { waitUntil: 'domcontentloaded' })
  await q.evaluate(() => localStorage.setItem('pl_a11y', JSON.stringify({ invert: true, contrast: 2, lineHeight: 3, cursor: true })))
  // Every module blocked: nothing but index.html and the stylesheet.
  await q.route('**/assets/*.js', (r) => r.abort())
  await q.goto(B + '/expenses', { waitUntil: 'domcontentloaded' })
  await q.waitForTimeout(400)
  const early = await q.evaluate(() => ({
    mounted: document.getElementById('root')?.childElementCount ?? 0,
    filter: document.documentElement.style.filter,
    lh: document.documentElement.style.getPropertyValue('--a11y-line-height'),
    attrs: [...document.documentElement.attributes].map((a) => a.name).filter((n) => n.startsWith('data-a11y')).sort(),
  }))
  ok('the app really is absent for this check', early.mounted === 0, `root has ${early.mounted} children`)
  ok('the filter is on the document before any module runs', early.filter.includes('invert(') && early.filter.includes('contrast('), early.filter)
  ok('  so are the custom properties', early.lh === '2.2', early.lh)
  ok('  and the flags', early.attrs.join(',') === 'data-a11y-cursor,data-a11y-invert,data-a11y-lh', early.attrs.join(','))
  await blank.close()
}

// ── The largest text still fits the smallest screen ─────────────────────
//
// Text size works by scaling the root font size, and everything in this app is
// sized in rem — which is the point, and also the risk: at 150% the chrome
// grows too. Adding one button to the mobile top bar was enough to push the
// row past 390px, and the whole page then scrolled sideways on every route.
// The dashboard's stat cards went the same way for a different reason, a flex
// child with no `min-w-0` shoving its icon out through the side of the card.
//
// Neither was visible at the default size. Both are what this check exists for.
{
  const phone = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' })
  const q = await phone.newPage(); q.setDefaultTimeout(20000)
  await q.route('**/fonts.g**/**', (r) => r.abort())
  await q.goto(B, { waitUntil: 'domcontentloaded' })
  await q.evaluate(SEED)
  await q.evaluate(() => localStorage.setItem('pl_a11y', JSON.stringify({ fontSize: 3, lineHeight: 3, letterSpacing: 3 })))
  for (const route of ['/', '/expenses', '/day', '/reports', '/settings', '/companies']) {
    await q.goto(B + route, { waitUntil: 'networkidle' })
    await q.waitForFunction(() => !document.querySelector('#main-content [role="status"]'), null, { timeout: 12000 }).catch(() => {})
    await q.waitForTimeout(400)
    const over = await q.evaluate(() => {
      const w = document.documentElement.clientWidth
      if (document.documentElement.scrollWidth <= w + 1) return []
      const out = []
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.width < 4 || r.right <= w + 1) continue
        // A fixed, full-bleed overlay stretches to the widened viewport rather
        // than causing it — the noise texture and the toast rail both report
        // the new width and neither is the fault. Skipping `position: fixed`
        // and anything that fits inside its own parent leaves the element that
        // is actually too wide for the box it sits in.
        if (getComputedStyle(el).position === 'fixed') continue
        const parent = el.parentElement?.getBoundingClientRect()
        if (!parent || r.right <= parent.right + 1) continue
        out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} right=${Math.round(r.right)} parent=${Math.round(parent.right)}`)
      }
      return out.slice(0, 3)
    })
    ok(`${route} at 150% text does not scroll sideways on a phone`, over.length === 0, over.join(' | '))
  }
  await phone.close()
}

// ── Off means off ───────────────────────────────────────────────────────
await reset()
const after = await read()
ok('reset clears the filter', after.filter === 'none', after.filter)
ok('  and every attribute', after.attrs.length === 0, after.attrs.join(','))
ok('  and the stored blob', after.stored === null, String(after.stored))
ok('  and the root font size returns', Math.abs(after.rootFontPx - base.rootFontPx) < 0.5,
  `${after.rootFontPx} vs ${base.rootFontPx}`)
// Every reading back to what it was, rather than every pixel.
//
// This was a screenshot comparison, and it kept failing on 0.8% of pixels
// whose largest difference was between alpha 1 and alpha 2 — anti-aliasing of
// text re-rendered at a slightly different subpixel offset, which is not a
// setting left behind. Comparing the computed styles is both stricter about
// the thing that matters and immune to the thing that does not: if any tool
// had failed to switch off, one of these readings would differ.
{
  const drift = Object.keys(base).filter((k) => k !== 'stored' && JSON.stringify(after[k]) !== JSON.stringify(base[k]))
  ok('  and every computed style is back where it started', drift.length === 0,
    drift.map((k) => `${k}: ${JSON.stringify(base[k])} -> ${JSON.stringify(after[k])}`).join(' | '))
}

// ── Everything at once, then a reload ───────────────────────────────────
await open()
for (const [label] of CASES) await tap(label)
await close()
const all = await read()
ok('twelve tools at once still leaves a usable filter', all.filter !== 'none' && !all.filter.includes('NaN'), all.filter)
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(700)
const reloaded = await read()
ok('and all of it survives a reload', reloaded.filter === all.filter && reloaded.attrs.length === all.attrs.length,
  `${reloaded.filter} vs ${all.filter}`)
ok('the launcher shows something is on',
  await p.locator('[aria-label="Accessibility tools"]:visible span[aria-hidden]').first().count() > 0)
await reset()

ok('no page errors throughout', errors.length === 0, errors.slice(0, 2).join(' | '))

await ctx.close()
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
