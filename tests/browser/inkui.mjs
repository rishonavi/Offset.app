// Every run of text on every route, in both themes, against what is actually
// painted behind it.
//
// `contrastui` checks a handful of known pairs. This walks the text nodes, so
// it finds the ones nobody thought to name — and it found that the app's most
// common muted ink was below the line everywhere it was used.
//
// What it turned up, all measured:
//
//   ink-6, on 221 elements and most of the form hints   2.62:1 light
//   the sidebar's group headings                        3.20:1
//   emerald-600 / red-600 / amber-600, 147 usages       fails one theme each
//   the accent as link text                             2.49:1 light
//
// WCAG asks 4.5:1 of body text and 3:1 of large text (24px, or 18.66px bold).
// Decoration is exempt and this honours that: an avatar's initials sit inside
// `aria-hidden` and repeat the name printed beside them.
// actually painted behind it.
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
  put('pl_corp_projects', [{ id: 's1', entity_id: ent, name: 'Tower A', code: 'TA', client: 'C', contract_value: 9e7, estimate: 7e7, started_on: born.toISOString().slice(0,10), due_on: '', status: 'active', created_at: born.toISOString() }])
}
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const ROUTES = ['/', '/expenses', '/expenses/new', '/income', '/personal', '/properties', '/reports',
  '/settings', '/companies', '/activity', '/bills', '/invoices', '/exports', '/import',
  '/operations?tab=projects', '/operations?tab=materials', '/operations?tab=payroll', '/day']

const PROBE = () => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1
  const g = cv.getContext('2d')
  const rgb = (c) => { g.fillStyle = '#000'; g.clearRect(0,0,1,1); g.fillStyle = c; g.fillRect(0,0,1,1); return [...g.getImageData(0,0,1,1).data] }
  const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
  const L = ([r, gg, bb]) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(bb)
  // Composite a translucent colour over what is behind it.
  const over = (fg, bg) => { const a = fg[3] / 255; return [0,1,2].map((i) => fg[i] * a + bg[i] * (1 - a)) }
  // Collect every translucent layer from the element up to the first opaque
  // one, then paint them back to front. The first version accumulated forwards
  // and re-applied each layer's own alpha to the result of the layer before
  // it, which reported a legible key-hint as 1.00:1 — the text and its ground
  // came out the same colour because both had been composited twice.
  const bgOf = (el) => {
    const stack = []
    let base = [255, 255, 255]
    for (let n = el; n; n = n.parentElement) {
      const c = rgb(getComputedStyle(n).backgroundColor)
      if (c[3] === 0) continue
      if (c[3] === 255) { base = c.slice(0, 3); break }
      stack.push(c)
    }
    let acc = base
    for (let i = stack.length - 1; i >= 0; i--) acc = over(stack[i], acc)
    return acc
  }
  const out = []
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Set()
  let node
  while ((node = walk.nextNode())) {
    const t = node.textContent.trim()
    if (t.length < 2) continue
    const el = node.parentElement
    if (!el || seen.has(el)) continue
    seen.add(el)
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.opacity === '0') continue
    // WCAG exempts incidental and decorative text. An avatar's initials sit
    // inside `aria-hidden` and repeat the name printed beside them at full
    // contrast, so they are an ornament rather than information.
    if (el.closest('[aria-hidden="true"]')) continue
    const fg = rgb(cs.color)
    const bg = bgOf(el)
    const composited = fg[3] < 255 ? over(fg, bg) : fg.slice(0, 3)
    const [x, y] = [L(composited), L(bg)].sort((m, n) => n - m)
    const ratio = (x + 0.05) / (y + 0.05)
    const px = parseFloat(cs.fontSize)
    const bold = Number(cs.fontWeight) >= 700
    const large = px >= 24 || (px >= 18.66 && bold)
    const need = large ? 3 : 4.5
    if (ratio < need) out.push(`${ratio.toFixed(2)}:1 need ${need} ${Math.round(px)}px "${t.slice(0, 32)}"`)
  }
  return out
}

for (const theme of ['light', 'dark']) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' })
  const p = await ctx.newPage(); p.setDefaultTimeout(20000)
  await p.route('**/fonts.g**/**', (r) => r.abort())
  await p.goto(B, { waitUntil: 'domcontentloaded' })
  await p.evaluate(SEED)
  await p.evaluate((t) => localStorage.setItem('pl_theme', t), theme)
  for (const r of ROUTES) {
    await p.goto(B + r, { waitUntil: 'networkidle' })
    await p.waitForFunction(() => !document.querySelector('#main-content [role="status"]'), null, { timeout: 12000 }).catch(() => {})
    await p.waitForTimeout(300)
    const res = await p.evaluate(PROBE)
    ok(`${theme} ${r}`, res.length === 0, `${res.length} under the line — ` + res.slice(0, 3).join(' | '))
  }
  await ctx.close()
}
// The control: the probe has to be able to see a failure, or a clean run means
// only that it looked and understood nothing.
{
  const ctx = await b.newContext({ serviceWorkers: 'block' })
  const q = await ctx.newPage()
  await q.setContent('<body style="background:#fff"><p style="color:#cfcfcf;font-size:13px">barely there</p></body>')
  ok('the probe can see text that is too faint', (await q.evaluate(PROBE)).length > 0)
  await q.setContent('<body style="background:#fff"><p style="color:#111;font-size:13px">plain black</p></body>')
  ok('and passes text that is not', (await q.evaluate(PROBE)).length === 0)
  await ctx.close()
}
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
