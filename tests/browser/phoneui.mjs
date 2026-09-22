// Every route on a 390px phone: can you actually tap the controls, and does
// the page fit.
//
// Two faults this exists for, both found by looking at screenshots rather than
// at code, which is why they had survived every other suite:
//
//   /day   the floating quick-add sat on top of "Save the day" — same corner,
//          same z-index, and the chrome renders after the outlet, so it won.
//          The label was clipped to "SAVE TH" and the button was dead under
//          the FAB's 56 square. The one screen built to be used standing on a
//          site, with its one control covered.
//
//   /day   two rows of one list laid out two different ways: "Mason" kept its
//          counter beside it and "Helper / unskilled" dropped it to a second
//          line, because a wrapping flex row breaks on each child's *natural*
//          width before anything shrinks.
//
// The occlusion check is the general form of the first: hit-test the centre of
// every visible control and see whether the browser hands back that control.
// It does not care what covered it or why, so it catches the next fixed thing
// somebody pins to a corner as well as this one.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })

const SEED = () => {
  localStorage.clear()
  const now = new Date().toISOString()
  const born = new Date(); born.setFullYear(born.getFullYear() - 1)
  const put = (k, v) => localStorage.setItem(k, JSON.stringify(v))
  put('pl_properties', [{ id: 'p1', name: 'Sea View Villa', type: 'Real Estate — Villa / House', value: 8500000, created_at: now }])
  put('pl_expenses', [{ id: 'e1', property_id: 'p1', category: 'Repairs', amount: 18400, date: '2026-09-04', status: 'unpaid', vendor: 'Kadam Hardware', created_at: now }])
  put('pl_income', [{ id: 'i1', property_id: 'p1', source: 'Rent', amount: 42000, date: '2026-09-01', status: 'pending', created_at: now }])
  put('pl_documents', [])
  const ent = 'ent-c'
  put('pl_corp_entities', [{ id: ent, name: 'Navi Builders Pvt Ltd', currency: 'INR', fy_start_month: 4, created_at: born.toISOString() }])
  put('pl_corp_members', [{ id: 'm1', entity_id: ent, user_id: 'local-user', email: 'you@navi.example', role: 'owner', department_id: null, created_at: born.toISOString() }])
  localStorage.setItem('pl_corp_active', ent)
  put('pl_corp_projects', [{ id: 's1', entity_id: ent, name: 'Tower A', code: 'TA', client: 'C', contract_value: 9e7, estimate: 7e7, started_on: born.toISOString().slice(0, 10), due_on: '', status: 'active', created_at: born.toISOString() }])
}

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const ROUTES = ['/', '/expenses', '/expenses/new', '/income', '/personal', '/properties', '/properties/p1',
  '/reports', '/settings', '/companies', '/activity', '/bills', '/invoices', '/exports', '/import',
  '/operations?tab=projects', '/operations?tab=materials', '/operations?tab=labour', '/day']

// A short name for a control, for the failure line. `aria-label` first because
// an icon button has no text at all and "" names nothing.
const NAME = `(el) => (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 30) || el.tagName.toLowerCase()`

// One pass of the hit test, at whatever the page is scrolled to. Returns a
// verdict per control — `seen` for on screen, `covered` for something else
// answering at its centre — keyed by position in the document so two passes at
// two scroll offsets can be compared.
const PROBE_COVER = new Function(`
  const name = ${NAME}
  const out = []
  const sel = 'button, a[href], select, textarea, input:not([type=hidden]), [role=button]'
  const all = document.querySelectorAll(sel)
  for (let i = 0; i < all.length; i++) {
    const el = all[i]
    if (el.closest('[aria-hidden="true"], [hidden], [inert]')) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') continue
    // The first line box, not the bounding box: a link that wraps onto two
    // lines has a rect spanning both, and points sampled inside it land in the
    // gutter between them and hit the paragraph.
    const r = el.getClientRects()[0] || el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) continue
    // Five points, not one. The centre alone said the day sheet's Save button
    // was fine while its right-hand third sat under the floating quick-add —
    // the label was clipped to "SAVE TH" and that part of the target was dead,
    // and the probe written to find exactly that could not see it. Sampled on
    // the axes rather than at the corners, which on anything rounded fall
    // outside the shape and hit whatever is behind it.
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const points = [[cx, cy], [r.left + r.width * 0.25, cy], [r.right - r.width * 0.25, cy],
      [cx, r.top + r.height * 0.25], [cx, r.bottom - r.height * 0.25]]
    let covered = false, by = ''
    let onScreen = false
    for (const [x, y] of points) {
      // Only what is on screen at this offset: a point past the fold
      // hit-tests to null, which is not the same thing as being covered.
      if (x < 1 || y < 1 || x > innerWidth - 1 || y > innerHeight - 1) continue
      const hit = document.elementFromPoint(x, y)
      if (!hit) continue
      onScreen = true
      // Reachable if the browser hands back this control, something inside it
      // (an icon), or something it sits inside (a label wrapping an input).
      if (hit === el || el.contains(hit) || hit.contains(el)) continue
      covered = true; by = name(hit); break
    }
    if (!onScreen) continue
    out.push({ i, seen: true, covered, what: name(el), by })
  }
  return out
`)

// Covered where you cannot scroll out of it.
//
// A sticky bar is *meant* to sit over the content behind it — that is what
// sticky is — and the field under it comes free the moment you scroll. Asking
// the question at one offset called the new-expense form broken because its
// Cancel button happened to be over a text box at the top of the page. A fixed
// overlay is the opposite: it holds that patch of the viewport at every offset,
// so the control under it can never be reached. That was the day sheet's Save
// button under the floating quick-add.
//
// So ask twice, at both ends of the scroll, and believe it only when both
// agree. No need to reason about `position` at all — the difference between
// the two kinds shows up in the measurement.
const coveredBoth = async (page) => {
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(120)
  const top = await page.evaluate(PROBE_COVER)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(220)
  const bottom = await page.evaluate(PROBE_COVER)
  await page.evaluate(() => window.scrollTo(0, 0))
  const byIndex = new Map(bottom.map((r) => [r.i, r]))
  return top
    .filter((r) => r.covered && byIndex.get(r.i)?.covered)
    .map((r) => r.what + ' <- ' + r.by)
}

// Anything sticking out past the right edge. A phone has no horizontal scroll
// bar to tell you, so a table or a long unbroken string just quietly makes the
// whole page draggable sideways.
const OVERFLOW = new Function(`
  const name = ${NAME}
  const w = document.documentElement.clientWidth
  if (document.documentElement.scrollWidth <= w + 1) return []
  const out = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.right <= w + 1) continue
    // Report the outermost offender, not every descendant it drags with it.
    if (el.parentElement && el.parentElement.getBoundingClientRect().right > w + 1) continue
    out.push(Math.round(r.right) + 'px ' + el.tagName.toLowerCase() + ' "' + name(el) + '"')
  }
  return out.slice(0, 4)
`)

const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' })
const p = await ctx.newPage(); p.setDefaultTimeout(20000)
await p.route('**/fonts.g**/**', (r) => r.abort())
await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(SEED)

for (const r of ROUTES) {
  await p.goto(B + r, { waitUntil: 'networkidle' })
  await p.waitForFunction(() => !document.querySelector('#main-content [role="status"]'), null, { timeout: 12000 }).catch(() => {})
  await p.waitForTimeout(350)
  const covered = await coveredBoth(p)
  ok(`${r} — every control can be tapped`, covered.length === 0, `${covered.length} covered: ` + covered.slice(0, 3).join(' | '))
  const over = await p.evaluate(OVERFLOW)
  ok(`${r} — nothing runs off the side`, over.length === 0, `viewport 390, ` + over.join(' | '))
}

// The rule behind the fix, stated directly. The two-pass check above can only
// see a collision that is happening; this says who is supposed to yield, so a
// future page that pins a bar without marking it is caught by name rather than
// by whether its button happens to land under a 56px square.
{
  for (const [route, want] of [['/day', true], ['/expenses', false]]) {
    await p.goto(B + route, { waitUntil: 'networkidle' })
    await p.waitForTimeout(400)
    const state = await p.evaluate(() => {
      const f = document.querySelector('[data-fab]')
      return {
        fab: !f ? 'absent' : getComputedStyle(f).display === 'none' ? 'hidden' : 'shown',
        pinned: Boolean(document.querySelector('#main-content [data-page-action]')),
      }
    })
    ok(`${route} — ${want ? 'pins its own bar, so the quick-add yields' : 'pins nothing, so the quick-add stays'}`,
      want ? state.pinned && state.fab === 'hidden' : !state.pinned && state.fab === 'shown',
      JSON.stringify(state))
  }
}

// The Operations tab bar: one row, whatever the screen.
//
// Eight tabs in a wrapping row, each `flex-1`, means each takes an equal share
// *of its own row* — so on a phone it came out 3/3/2 with every cell a
// different width and the last two stranded in the middle of a line. It scrolls
// now instead. A tab bar that changes shape with the viewport is the whole
// "uneven" complaint in one control, so the shape is the assertion.
{
  await p.goto(B + '/operations?tab=projects', { waitUntil: 'networkidle' })
  await p.waitForTimeout(600)
  const bar = await p.evaluate(() => {
    // Found through the tabs, not through the class that makes it scroll —
    // otherwise renaming the class reports "null" and reads like the bug
    // rather than like a moved selector.
    const first = document.querySelector('#main-content [aria-pressed]')
    const el = first?.parentElement
    if (!el) return null
    const kids = [...el.children].map((k) => k.getBoundingClientRect())
    return { n: kids.length, rows: new Set(kids.map((r) => Math.round(r.top))).size,
      scrolls: el.scrollWidth > el.clientWidth + 1 }
  })
  ok('/operations — the tab bar is one row that scrolls, not a ragged grid',
    Boolean(bar) && bar.n >= 6 && bar.rows === 1 && bar.scrolls, JSON.stringify(bar))
}

// Stat cards two to a row. One number per full-width card turns four figures
// into four screens of scrolling, and every other stat row in the app — the
// dashboard's, the asset page's, materials', sites', plant's — is already two
// up. Payroll and advances were the two written after the convention and the
// only two that missed it.
{
  for (const route of ['/operations?tab=payroll', '/operations?tab=advances']) {
    await p.goto(B + route, { waitUntil: 'networkidle' })
    await p.waitForFunction(() => !document.querySelector('#main-content [role="status"]'), null, { timeout: 12000 }).catch(() => {})
    await p.waitForTimeout(500)
    const stacked = await p.evaluate(() => {
      const bad = []
      for (const g of document.querySelectorAll('[class*="grid-cols"]')) {
        const kids = [...g.children].filter((k) => k.getBoundingClientRect().width > 4)
        if (kids.length < 3) continue
        // A stat card holds a small-caps label and a figure, nothing else.
        if (!kids.every((k) => k.querySelector('.tabular, [class*="text-2xl"], [class*="text-xl"]') || /^[^a-z]*$/.test(k.textContent.slice(0, 12)))) continue
        const rows = new Set(kids.map((k) => Math.round(k.getBoundingClientRect().top))).size
        if (rows === kids.length) bad.push(kids.length + ' cards, ' + rows + ' rows: ' + kids[0].textContent.trim().slice(0, 24))
      }
      return bad
    })
    ok(`${route} — figures share a row rather than one per screen`, stacked.length === 0, stacked.join(' | '))
  }
}

// The day sheet's muster: one list, one layout. Each row is a label and a
// counter; if the counter drops below the label on the longer trade names the
// rows are different heights and the list reads as broken.
{
  await p.goto(B + '/day', { waitUntil: 'networkidle' })
  await p.waitForTimeout(500)
  const rows = await p.evaluate(() => {
    const steppers = [...document.querySelectorAll('[aria-label$="headcount"]')]
    return steppers.map((s) => {
      const row = s.closest('div').parentElement
      const label = row.querySelector('p')
      if (!label) return null
      // Same line means the label's box and the counter's box overlap
      // vertically. Wrapped means the counter starts below the label ends.
      return { label: label.textContent.trim(), wrapped: s.getBoundingClientRect().top >= label.getBoundingClientRect().bottom }
    }).filter(Boolean)
  })
  const wrapped = rows.filter((r) => r.wrapped)
  ok('/day — every muster row lays out the same way', rows.length >= 2 && wrapped.length === 0,
    `${rows.length} rows, ${wrapped.length} with the counter on its own line: ` + wrapped.map((r) => r.label).join(', '))
}

// The controls: both probes have to be able to see the faults they exist for,
// or a clean run means only that they looked and understood nothing.
{
  const q = await ctx.newPage()
  await q.setContent('<body style="margin:0"><button style="width:200px;height:44px">Save</button>'
    + '<div style="position:fixed;left:0;top:0;width:200px;height:44px;background:red"></div></body>')
  ok('the probe can see a button under a fixed overlay', (await coveredBoth(q)).length > 0)
  await q.setContent('<body style="margin:0"><button style="width:200px;height:44px">Save</button></body>')
  ok('and passes one that is not covered', (await coveredBoth(q)).length === 0)
  // And the distinction the two passes exist for: a sticky bar over a field is
  // not a covered field, because scrolling frees it.
  await q.setContent('<body style="margin:0;height:3000px"><div style="height:820px"></div>'
    + '<input style="width:200px;height:44px">'
    + '<div style="position:sticky;bottom:0;width:200px;height:44px;background:#ddd">Cancel</div></body>')
  ok('and does not call a sticky bar a covered control', (await coveredBoth(q)).length === 0)
  // The meta is not decoration here. Without it mobile Chromium lays a page
  // out at 980px regardless of the viewport it was given, so the 900px block
  // below fits and the control passes while proving nothing — which is what it
  // did, and is the whole reason a negative assertion gets a control.
  const META = '<head><meta name="viewport" content="width=device-width, initial-scale=1"></head>'
  await q.setContent(META + '<body style="margin:0"><div style="width:900px;height:40px;background:#eee">wide</div></body>')
  ok('the probe can see something wider than the screen', (await q.evaluate(OVERFLOW)).length > 0)
  await q.setContent(META + '<body style="margin:0"><div style="width:100px;height:40px;background:#eee">narrow</div></body>')
  ok('and passes a page that fits', (await q.evaluate(OVERFLOW)).length === 0)
  await q.close()
}

await ctx.close()
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
