// Every route, measured, at a desk and on a phone.
//
// Two faults that arrive by accident and are invisible to whoever added them.
//
// A control too small to hit. WCAG 2.2 puts the floor at 24x24 CSS pixels
// (2.5.8, AA) and the enhanced bar at 44x44 (2.5.5, AAA). This app is used on
// a site, one-thumbed, sometimes through a glove, so standalone controls aim
// at 44 — but the number this asserts is the floor, because that is the line
// below which something is broken rather than merely tight. Twenty-eight icon
// buttons sat at 32px, native checkboxes painted at 13, and an invoice line on
// a 390px screen gave the quantity field 30px and its remove button 19.
//
// A row of controls that do not agree on a height. A `min-height` is a floor,
// and a <select> lands 2px above where a text input lands, so a filter bar
// read as two different kinds of thing for no reason anybody could name.
//
// Both are measured rather than eyeballed, because both are the kind of thing
// that looks fine until somebody tries to use it.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })

const SEED = () => {
  localStorage.clear()
  const now = new Date().toISOString()
  const born = new Date(); born.setFullYear(born.getFullYear() - 1)
  const put = (k, v) => localStorage.setItem(k, JSON.stringify(v))
  put('pl_properties', [{ id: 'p1', name: 'Sea View Villa', type: 'Real Estate — Villa / House', value: 8500000, created_at: now }])
  put('pl_expenses', [{ id: 'e1', property_id: 'p1', category: 'Repairs', amount: 18400, date: '2026-09-04', status: 'paid', vendor: 'Kadam Hardware', created_at: now }])
  put('pl_income', [{ id: 'i1', property_id: 'p1', source: 'Rent', amount: 42000, date: '2026-09-01', status: 'received', created_at: now }])
  put('pl_documents', [])
  const ent = 'ent-a'
  put('pl_corp_entities', [{ id: ent, name: 'Navi Builders Pvt Ltd', currency: 'INR', gstin: '27AAAPA1234A1Z5', fy_start_month: 4, created_at: born.toISOString() }])
  put('pl_corp_members', [{ id: 'm1', entity_id: ent, user_id: 'local-user', email: 'you@navi.example', role: 'owner', department_id: null, created_at: born.toISOString() }])
  localStorage.setItem('pl_corp_active', ent)
  put('pl_corp_projects', [{ id: 's1', entity_id: ent, name: 'Tower A', code: 'TA', client: 'Navi Realty', contract_value: 90000000, estimate: 72000000, started_on: born.toISOString().slice(0, 10), due_on: '', status: 'active', created_at: born.toISOString() }])
}

const ROUTES = ['/', '/personal', '/properties', '/expenses', '/expenses/new', '/income', '/income/new',
  '/bills', '/invoices', '/reports', '/import', '/exports', '/settings', '/companies', '/activity',
  '/operations?tab=projects', '/operations?tab=materials', '/operations?tab=labour',
  '/operations?tab=plant', '/operations?tab=sales', '/operations?tab=advances',
  '/operations?tab=payroll', '/day', '/bin']

const PROBE = () => {
  const vis = (el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
  }
  const main = document.querySelector('#main-content')
  if (!main) return null
  // Controls too small for a finger.
  const small = []
  for (const el of main.querySelectorAll('button, a[href], input, select, textarea, [role="tab"]')) {
    if (!vis(el)) continue
    const r = el.getBoundingClientRect()
    // Inline links inside a sentence are not tap targets in the same sense.
    const inline = el.tagName === 'A' && getComputedStyle(el).display.includes('inline') && el.closest('p, li, td')
    if (inline) continue
    // A file input styled away and driven by its own label or button: the
    // visible control is the target, and WCAG exempts the hidden one.
    if (el.tagName === 'INPUT' && el.type === 'file' && r.width < 4) continue
    // A control wrapped in a label is tapped through the label, so the label
    // is the target. Measure that instead of the box inside it.
    const owner = el.closest('label')
    if (owner && owner !== el) {
      const lr = owner.getBoundingClientRect()
      if (lr.height >= 40 && lr.width >= 40) continue
    }
    if (r.height < 24 || r.width < 24) {
      small.push(`${el.tagName}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.innerText || el.placeholder || '').trim().slice(0, 24)}"`)
    }
  }
  // Inputs that share a row but not a height.
  const rows = new Map()
  for (const el of main.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), select, textarea')) {
    if (!vis(el)) continue
    // Where a label carries the border and ground and the input just fills it,
    // the label *is* the control. Comparing the inner input against a sibling
    // <select> compares a child to its neighbours' parents, which reported a
    // perfectly even row as 44 against 46.
    const owner = el.closest('label')
    const styled = owner && /field-input/.test(owner.className || '')
    const box = styled ? owner : el
    const r = box.getBoundingClientRect()
    const key = Math.round(r.top / 8) * 8
    if (!rows.has(key)) rows.set(key, [])
    const seen = rows.get(key)
    if (seen.some((x) => x.box === box)) continue
    seen.push({ box, h: Math.round(r.height), w: Math.round(r.width), tag: el.tagName, label: (el.getAttribute('aria-label') || el.name || '').slice(0, 20) })
  }
  const uneven = []
  for (const [top, list] of rows) {
    if (list.length < 2) continue
    const hs = new Set(list.map((x) => x.h))
    if (hs.size > 1) uneven.push(`y=${top} heights ${list.map((x) => `${x.label || x.tag}:${x.h}`).join(' ')}`)
  }
  return { small, uneven }
}

const out = []
for (const w of [1280, 390]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, serviceWorkers: 'block' })
  const p = await ctx.newPage(); p.setDefaultTimeout(25000)
  await p.route('**/fonts.g**/**', (r) => r.abort())
  await p.goto(B, { waitUntil: 'domcontentloaded' })
  await p.evaluate(SEED)
  for (const r of ROUTES) {
    try {
      await p.goto(B + r, { waitUntil: 'networkidle' })
      await p.waitForFunction(() => !document.querySelector('#main-content [role="status"]'), null, { timeout: 15000 }).catch(() => {})
      await p.waitForTimeout(350)
      const res = await p.evaluate(PROBE)
      if (!res) continue
      const overflow = await p.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth))
      if (res.small.length || res.uneven.length || overflow > 2) {
        out.push({ w, r, small: res.small.slice(0, 5), uneven: res.uneven.slice(0, 3), overflow })
      }
    } catch (e) { out.push({ w, r, error: String(e).slice(0, 90) }) }
  }
  await ctx.close()
}
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
console.log('\n── NOTHING TOO SMALL TO HIT, NOTHING UNEVEN IN A ROW ──')
ok('every control on every route clears the 24px floor',
  out.every((o) => !(o.small || []).length),
  out.flatMap((o) => (o.small || []).map((s) => `${o.w}px ${o.r}: ${s}`)).slice(0, 6).join(' | '))
ok('and controls sharing a row share a height',
  out.every((o) => !(o.uneven || []).length),
  out.flatMap((o) => (o.uneven || []).map((u) => `${o.w}px ${o.r}: ${u}`)).slice(0, 4).join(' | '))
ok('nothing scrolls sideways', out.every((o) => !(o.overflow > 2)),
  out.filter((o) => o.overflow > 2).map((o) => `${o.w}px ${o.r} +${o.overflow}px`).join(' | '))
ok('and every route rendered', out.every((o) => !o.error),
  out.filter((o) => o.error).map((o) => `${o.r}: ${o.error}`).join(' | '))
// The control: the probe has to be able to see a fault, or a green run means
// only that it looked in the wrong place.
ok('the probe can see a control that is too small', await (async () => {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
  const q = await ctx.newPage()
  await q.setContent('<div id="main-content"><button style="width:10px;height:10px">x</button></div>')
  const res = await q.evaluate(PROBE)
  await ctx.close()
  return res.small.length > 0
})())
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
