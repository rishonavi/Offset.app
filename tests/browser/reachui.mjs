// Every page, at a phone and at a desk: does anything overflow sideways, and
// can every control and field be reached by name?
//
// Both faults are invisible to somebody building with a mouse on a wide screen.
// An extra table column pushed the stock table past what its scroll container
// was absorbing and the whole page scrolled sideways on a phone — nobody who
// added the column would have seen it. And nine file inputs across five screens
// had no accessible name at all: a screen reader announced "button" and nothing
// about what it took, which on the import page is most of the page's purpose.
//
// This walks the routes rather than asserting about one screen, because both
// faults arrive by accident, in a file nobody was thinking about.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
const p = await ctx.newPage(); p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
p.on('dialog', (d) => d.accept())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const ROUTES = ['/', '/personal', '/properties', '/expenses', '/income', '/bills', '/invoices',
  '/reports', '/import', '/exports', '/settings', '/operations?tab=materials',
  '/operations?tab=labour', '/operations?tab=payroll', '/operations?tab=advances',
  '/operations?tab=plant', '/operations?tab=sales', '/operations?tab=projects']

await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(() => {
  localStorage.clear()
  const now = new Date().toISOString()
  const born = new Date(); born.setFullYear(born.getFullYear() - 2)
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'p1', name: 'Sea View Villa', type: 'Real Estate — Villa / House', value: 8500000, created_at: now },
  ]))
  for (const k of ['pl_expenses', 'pl_income', 'pl_documents']) localStorage.setItem(k, '[]')
  const ent = 'ent-reach'
  localStorage.setItem('pl_corp_entities', JSON.stringify([
    { id: ent, name: 'Navi Builders Pvt Ltd', gstin: '27AAAPA1234A1Z5', currency: 'INR', fy_start_month: 4, created_at: born.toISOString() },
  ]))
  localStorage.setItem('pl_corp_members', JSON.stringify([
    { id: 'm1', entity_id: ent, user_id: 'local-user', email: '', role: 'owner', created_at: now },
  ]))
  localStorage.setItem('pl_corp_active', ent)

  // With rows in them, because a table nobody filled cannot overflow. The
  // first version of this seeded an empty company, so every "fits" below
  // passed on an empty state — and a widened stock table, which is the exact
  // fault this is here to catch, went straight through it.
  const row = (o) => ({ entity_id: ent, created_at: now, ...o })
  localStorage.setItem('pl_corp_projects', JSON.stringify([
    row({ id: 'pr1', name: 'Marine Drive Tower', contract_value: 90000000, estimate: 70000000, status: 'running', started_on: '2026-01-01' }),
  ]))
  localStorage.setItem('pl_corp_items', JSON.stringify([
    row({ id: 'it1', name: 'Cement OPC 53 grade', brand: 'UltraTech', spec: '53 grade', sku: 'CEM53', unit: 'bag', category: 'cement', hsn: '2523', reorder_level: 40 }),
    row({ id: 'it2', name: 'TMT bar 12mm Fe500', brand: 'Tata', spec: '12mm', sku: 'TMT12', unit: 'kg', category: 'steel', hsn: '7214', reorder_level: 500 }),
  ]))
  localStorage.setItem('pl_corp_movements', JSON.stringify([
    row({ id: 'mv1', item_id: 'it1', kind: 'receipt', qty: 500, unit_cost: 400, other_cost: 1200, store_id: null, to_store_id: null, project_id: null, vendor: 'Shah Traders', reason: '', note: '', ref: 'INV-114', date: '2026-01-05' }),
    row({ id: 'mv2', item_id: 'it1', kind: 'issue', qty: 320, unit_cost: 0, other_cost: 0, store_id: 'pr1', to_store_id: null, project_id: 'pr1', vendor: '', reason: '', note: '', ref: '', date: '2026-02-11' }),
    row({ id: 'mv3', item_id: 'it2', kind: 'receipt', qty: 8000, unit_cost: 62, other_cost: 0, store_id: null, to_store_id: null, project_id: null, vendor: 'Metal Mart', reason: '', note: '', ref: '', date: '2026-01-20' }),
  ]))
  localStorage.setItem('pl_corp_muster', JSON.stringify([
    row({ id: 'mu1', project_id: 'pr1', date: '2026-03-02', trade: 'mason', headcount: 12, rate: 950, overtime_hours: 4, overtime_rate: 140, contractor: 'Mestri Ravi', note: '' }),
  ]))
  localStorage.setItem('pl_corp_work_orders', JSON.stringify([
    row({ id: 'wo1', project_id: 'pr1', side: 'sub', party: 'Ravi Contractors', contractor: 'Ravi Contractors', scope: 'Blockwork', order_value: 1000000, retention_percent: 5, tds_percent: 1, pricing: 'item_rate', status: 'running', started_on: '2026-01-01', completed_on: '', retention_released: 0 }),
  ]))
  localStorage.setItem('pl_corp_ra_bills', JSON.stringify([
    row({ id: 'rb1', work_order_id: 'wo1', project_id: 'pr1', number: 1, date: '2026-02-15', claimed_to_date: 300000, certified_to_date: 250000, advance_recovered: 0, material_recovered: 0, penalty: 0, other_deduction: 0, status: 'certified', note: '' }),
  ]))
  localStorage.setItem('pl_corp_employees', JSON.stringify([
    row({ id: 'em1', name: 'A. Manager', code: 'E01', email: '', department_id: null, pay: { basic: 40000, da: 5000, hra: 16000, conveyance: 0, medical: 0, special: 0, other: 0 }, pan: '', uan: '', joined_on: '2018-04-01', work_state: '', female: null, leave_balance: 41, active: true }),
    row({ id: 'em2', name: 'S. Worker', code: 'E02', email: '', department_id: null, pay: { basic: 12000, da: 2000, hra: 4000, conveyance: 0, medical: 0, special: 0, other: 0 }, pan: '', uan: '', joined_on: '2024-06-01', work_state: '', female: null, leave_balance: 6, active: true }),
  ]))
  localStorage.setItem('pl_corp_advances', JSON.stringify([
    row({ id: 'ad1', party: 'Ravi Contractors', party_type: 'vendor', amount: 50000, purpose: 'Steel', date: '2026-04-01', expected_by: '2026-06-01' }),
  ]))
  localStorage.setItem('pl_corp_adjustments', JSON.stringify([
    row({ id: 'aj1', advance_id: 'ad1', amount: 30000, note: 'Invoice 114', date: '2026-04-20' }),
  ]))
  localStorage.setItem('pl_corp_plant', JSON.stringify([
    row({ id: 'pl1', name: 'JCB 3DX', kind: 'excavator', ownership: 'hired', hire_rate: 1200, rate_basis: 'hour', operator: 'Shankar', status: 'working' }),
  ]))
  localStorage.setItem('pl_corp_units', JSON.stringify([
    row({ id: 'un1', project_id: 'pr1', name: 'A-1201', kind: 'flat', carpet_area: 980, saleable_area: 1240, rate: 9500, status: 'available' }),
  ]))
})

// What the page can say about itself. Run in the page because that is where the
// layout actually is: a width computed from the source is a guess.
const inspect = () => p.evaluate(() => {
  const doc = document.documentElement
  const named = (el) =>
    (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || '').trim().length > 0
  const labelled = (el) => {
    if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title')) return true
    if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return true
    return Boolean(el.closest('label'))
  }
  return {
    overflow: doc.scrollWidth - doc.clientWidth,
    unnamed: [...document.querySelectorAll('#main-content button')]
      .filter((el) => !named(el) && !el.querySelector('img[alt]'))
      .map((el) => String(el.className).slice(0, 40)),
    unlabelled: [...document.querySelectorAll('#main-content input, #main-content select, #main-content textarea')]
      .filter((el) => el.type !== 'hidden' && !labelled(el))
      .map((el) => `${el.tagName.toLowerCase()}[${el.type || ''}] ${el.placeholder || el.name || ''}`.trim()),
  }
})

console.log('\n── NOTHING SCROLLS SIDEWAYS ON A PHONE ──')
// A page that scrolls sideways is a page where the right-hand column of every
// table is off the edge with nothing saying so.
await p.setViewportSize({ width: 390, height: 844 })
for (const r of ROUTES) {
  await p.goto(B + r, { waitUntil: 'networkidle' })
  await p.waitForTimeout(400)
  const { overflow } = await inspect()
  ok(`${r} fits`, overflow <= 2, `${overflow}px over`)
}
// The control: the check can see an overflow when there is one, or all of the
// above passes on a page that never rendered.
await p.evaluate(() => {
  const d = document.createElement('div')
  d.id = 'too-wide'; d.style.cssText = 'width:3000px;height:4px'
  document.querySelector('#main-content')?.appendChild(d)
})
await p.waitForTimeout(200)
ok('and the check would notice if one did', (await inspect()).overflow > 2, String((await inspect()).overflow))
await p.evaluate(() => document.querySelector('#too-wide')?.remove())

console.log('\n── AND EVERY CONTROL HAS A NAME ──')
await p.setViewportSize({ width: 1280, height: 900 })
for (const r of ROUTES) {
  await p.goto(B + r, { waitUntil: 'networkidle' })
  await p.waitForTimeout(400)
  const { unnamed, unlabelled } = await inspect()
  ok(`${r}: every button says what it does`, unnamed.length === 0, unnamed.slice(0, 2).join(' / '))
  ok(`${r}: every field has a label`, unlabelled.length === 0, unlabelled.slice(0, 3).join(' / '))
}
// The control again, and for the other half. A hidden file input with no
// `aria-label` is exactly what nine of these were.
await p.evaluate(() => {
  const i = document.createElement('input')
  i.type = 'file'; i.id = 'nameless'
  document.querySelector('#main-content')?.appendChild(i)
})
await p.waitForTimeout(200)
ok('and the check would notice a field without one', (await inspect()).unlabelled.length > 0,
  JSON.stringify((await inspect()).unlabelled))
await p.evaluate(() => document.querySelector('#nameless')?.remove())

for (const e of errs) ok(e, false)
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
