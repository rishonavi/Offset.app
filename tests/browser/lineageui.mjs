// What was certified, against what was measured.
//
// Two screens that had nothing between them. The engineer's measurement book
// lived under Progress and the contractor's running account under Labour, and
// no number in the app had ever compared them — so a bill could certify nine
// lakh eighty of plaster against eight lakh sixty-one measured and every total
// still added up.
//
// The honest limit is as much the subject here as the check. A contract nobody
// has linked to a scheduled item must read as *not compared*, not as a gap of
// everything against nothing, and the screen has to say how much of the book it
// actually covered.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1300 }, serviceWorkers: 'block' })
const p = await ctx.newPage(); p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 160)) })
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('ERR_FAILED') && !t.includes('404')) errs.push('CONSOLE ' + t.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
p.on('dialog', (d) => d.accept())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
// Every Operations tab and every Materials view is its own chunk, so a click
// is a network fetch. The fixed wait that used to follow one was long enough
// until it was not: under eight browsers at once the chunk took longer than
// the sleep and the assertion read the loading card. Wait for the thing itself
// — the Suspense fallback's live region — not for a number of milliseconds.
const loaded = async (page) => {
  await page.waitForFunction(() => !document.querySelector('#main-content [role="status"]'), null, { timeout: 30000 })
  await page.waitForTimeout(150)
}

const ls = (k) => p.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), k)
const main = () => p.locator('#main-content').innerText()
const view = async (label) => {
  await p.locator('#main-content [role="tab"]', { hasText: label }).first().click()
  await loaded(p)
}
// Just the comparison block: the Progress view carries several totals of its
// own and a check that reads the whole page can be satisfied by one of those.
const panel = async () => {
  const t = await main()
  const i = t.search(/CERTIFIED AGAINST MEASURED/i)
  if (i < 0) return ''
  const rest = t.slice(i)
  const end = rest.search(/\n(Record a measurement|Add to the schedule|The schedule)\b/i)
  return end > 0 ? rest.slice(0, end) : rest
}
const ENT = 'ent-lin-1'

await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(({ ent }) => {
  localStorage.clear()
  const now = new Date().toISOString()
  const day = new Date().toISOString().slice(0, 10)
  for (const k of ['pl_expenses', 'pl_income', 'pl_documents']) localStorage.setItem(k, '[]')
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'a1', name: 'Yard', type: 'Real Estate — Villa / House', entity_id: ent, created_at: now },
  ]))
  localStorage.setItem('pl_corp_entities', JSON.stringify([
    { id: ent, name: 'Navi Builders Pvt Ltd', currency: 'INR', fy_start_month: 4, created_at: now },
  ]))
  localStorage.setItem('pl_corp_members', JSON.stringify([
    { id: 'm1', entity_id: ent, user_id: 'local-user', email: '', role: 'owner', created_at: now },
  ]))
  localStorage.setItem('pl_corp_active', ent)
  localStorage.setItem('pl_corp_projects', JSON.stringify([
    { id: 'site', entity_id: ent, name: 'Marine Drive Tower', code: 'MD-1', client: '', status: 'active', contract_value: 50000000, estimate: 40000000, started_on: null, due_on: null, created_at: now, updated_at: now },
  ]))
  const order = (id, contractor, ref) => ({
    id, entity_id: ent, project_id: 'site', contractor, scope: '', order_value: 3000000,
    pricing: 'rate', retention_percent: 5, tds_percent: 1, started_on: null, due_on: null,
    status: 'running', ref, notes: '', retention_released: 0, side: 'sub',
    completed_on: null, dlp_months: 12, release_split_percent: 50, created_at: now, updated_at: now,
  })
  localStorage.setItem('pl_corp_work_orders', JSON.stringify([
    order('wo-plaster', 'Sai Plastering Works', 'WO/MD/04'),
    order('wo-rcc', 'Ganesh Construction', 'WO/MD/01'),
  ]))
  localStorage.setItem('pl_corp_ra_bills', JSON.stringify([
    { id: 'ra1', entity_id: ent, work_order_id: 'wo-plaster', project_id: 'site', number: 1, date: day, claimed_to_date: 1050000, certified_to_date: 980000, advance_recovered: 0, material_recovered: 0, penalty: 0, other_deduction: 0, status: 'certified', note: '', created_at: now, updated_at: now },
    { id: 'ra2', entity_id: ent, work_order_id: 'wo-rcc', project_id: 'site', number: 1, date: day, claimed_to_date: 2000000, certified_to_date: 2000000, advance_recovered: 0, material_recovered: 0, penalty: 0, other_deduction: 0, status: 'certified', note: '', created_at: now, updated_at: now },
  ]))
  // The schedule item the plastering contract is priced against, and 4,100 sqm
  // measured at ₹210 — ₹8,61,000 in the ground.
  localStorage.setItem('pl_corp_work_items', JSON.stringify([
    { id: 'wi1', entity_id: ent, project_id: 'site', code: 'MD/04', description: 'Internal cement plaster 12mm', stage: 'plaster', unit: 'sqm', planned_qty: 14500, rate: 210, note: '', work_order_id: 'wo-plaster', created_at: now, updated_at: now },
  ]))
  localStorage.setItem('pl_corp_measurements', JSON.stringify([
    { id: 'me1', entity_id: ent, work_item_id: 'wi1', project_id: 'site', date: day, qty: 2400, note: '', created_at: now, updated_at: now },
    { id: 'me2', entity_id: ent, work_item_id: 'wi1', project_id: 'site', date: day, qty: 1700, note: '', created_at: now, updated_at: now },
  ]))
}, { ent: ENT })

console.log('\n── THE COMPARISON ──')
await p.goto(`${B}/operations?tab=projects`, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
await view('Progress')
let t = await panel()
ok('the panel is on the progress screen', t.length > 40, (await main()).slice(0, 300))
ok('the linked contractor is named', /Sai Plastering Works/.test(t), t)
ok('what he certified is shown', /₹9,80,000 certified/.test(t), t)
ok('against what was measured', /₹8,61,000 measured/.test(t), t)
ok('the gap is the difference', /\+₹1,19,000/.test(t), t)
ok('and said as a share of the work in the ground', /\+13\.8%/.test(t), t)

console.log('\n── AND THE CONTRACT NOBODY LINKED ──')
// It must not appear as a gap of everything against nothing.
ok('the unlinked contract is not compared', !/Ganesh Construction/.test(t), t)
// Control: it is in the books, so its absence is the check declining to guess
// rather than an empty database.
ok('though it is in the books', (await ls('pl_corp_work_orders')).some((o) => o.id === 'wo-rcc'))
ok('and the screen says how much it did not cover', /1 contract names no scheduled item/i.test(t), t)
ok('with the reason', /not compared/i.test(t), t)

console.log('\n── THE LINK IS SET ON THE FORM ──')
const billedUnder = p.locator('#main-content select[aria-label="Billed under"]')
ok('a schedule item can name its contract', await billedUnder.count() === 1)
const opts = await billedUnder.locator('option').allInnerTexts()
ok('with "none of them" as a real answer', /no subcontract/i.test(opts.join('|')), opts.join('|'))
ok('every subcontract on this site is offered',
  opts.join('|').includes('Sai Plastering Works') && opts.join('|').includes('Ganesh Construction'), opts.join('|'))
ok('nothing is pre-picked', (await billedUnder.inputValue()) === '')

console.log('\n── AND LINKING THE SECOND ONE CHANGES THE ANSWER ──')
await p.evaluate(() => {
  const items = JSON.parse(localStorage.getItem('pl_corp_work_items'))
  const now = new Date().toISOString()
  items.push({ id: 'wi2', entity_id: items[0].entity_id, project_id: 'site', code: 'MD/01', description: 'RCC M30', stage: 'structure', unit: 'cum', planned_qty: 3000, rate: 7400, note: '', work_order_id: 'wo-rcc', created_at: now, updated_at: now })
  localStorage.setItem('pl_corp_work_items', JSON.stringify(items))
  const takes = JSON.parse(localStorage.getItem('pl_corp_measurements'))
  takes.push({ id: 'me3', entity_id: items[0].entity_id, work_item_id: 'wi2', project_id: 'site', date: new Date().toISOString().slice(0, 10), qty: 300, note: '', created_at: now, updated_at: now })
  localStorage.setItem('pl_corp_measurements', JSON.stringify(takes))
})
await p.goto(`${B}/operations?tab=projects`, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
await view('Progress')
t = await panel()
ok('the second contract is compared now', /Ganesh Construction/.test(t), t)
// 300 cum at ₹7,400 is ₹22,20,000 measured against ₹20,00,000 certified — he
// has under-billed, which is the other direction and a different colour.
ok('and it has measured more than it billed', /−₹2,20,000|-₹2,20,000/.test(t), t)
ok('nothing is left uncompared', !/names no scheduled item/i.test(t), t)

console.log('\n── AND THE DASHBOARD SAYS IT TOO ──')
await p.goto(`${B}/`, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
t = await main()
ok('a contractor certified beyond the tape is named', /certified more than has been measured/i.test(t), t.slice(0, 900))
ok('and the work nobody billed for is money', /measured work nobody has billed/i.test(t), t.slice(0, 1400))

ok('no page errors', errs.length === 0, errs.join(' | '))
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
