// The papers that get signed, actually produced.
//
// What the documents say and add up to is tested in `tests/logic/sitedocs`.
// What is asserted here is the half that cannot be: that the buttons exist
// where the thing they print lives, that pressing one produces a file rather
// than an error, and that the file is a PDF with something in it.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 }, serviceWorkers: 'block', acceptDownloads: true })
const p = await ctx.newPage()
p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 160)) })
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('ERR_FAILED') && !t.includes('404')) errs.push('CONSOLE ' + t.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
p.on('dialog', (d) => d.accept())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${e ? '  — ' + e : ''}`) }
// Clicking a tab is a network fetch now, and React commits the switch
// asynchronously. So "no loading card on screen" is true for a moment *before*
// the new panel starts loading, and a check made in that moment passes while
// still reading the tab you just left — which is how four assertions came to
// read the demo-mode banner off a page that was perfectly correct.
//
// The control reports itself chosen in the same commit that mounts the loading
// card, so waiting for that first closes the gap. Then wait for the card to go.
const chose = async (locator) => {
  await locator.click()
  const handle = await locator.elementHandle()
  await p.waitForFunction(
    (el) => el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true',
    handle, { timeout: 30000 })
  await p.waitForFunction(() => !document.querySelector('#main-content [role="status"]'), null, { timeout: 30000 })
  await p.waitForTimeout(150)
}
const main = () => p.locator('#main-content').innerText()
const OUTER = ['Projects', 'Materials', 'Labour', 'Plant', 'Sales', 'Advances', 'Payroll']
const outerTab = async (name) => {
  await chose(p.locator('#main-content button[aria-pressed]').nth(OUTER.indexOf(name)))
}
const view = async (label) => {
  await chose(p.locator('#main-content [role="tab"]', { hasText: label }).first())
}
// A download is the only proof that the whole chain ran: the builder, the
// renderer, and the library underneath both.
const prints = async (label, clicker) => {
  const wait = p.waitForEvent('download', { timeout: 25000 })
  await clicker()
  try {
    const file = await wait
    const name = file.suggestedFilename()
    const stream = await file.createReadStream()
    let size = 0
    let head = ''
    for await (const chunk of stream) { if (!head) head = chunk.toString('latin1', 0, 5); size += chunk.length }
    ok(`${label} produces a file`, name.endsWith('.pdf'), name)
    ok(`${label} is a real PDF with something in it`, head === '%PDF-' && size > 1000, `${head} ${size} bytes`)
  } catch (e) {
    ok(`${label} produces a file`, false, e?.message || String(e))
  }
}

const ID = 'ent-doc-1'
const now = new Date().toISOString()
await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(([id, stamp]) => {
  localStorage.clear()
  const born = new Date(); born.setFullYear(born.getFullYear() - 1)
  localStorage.setItem('pl_properties', '[]')
  for (const k of ['pl_expenses', 'pl_income', 'pl_documents']) localStorage.setItem(k, '[]')
  localStorage.setItem('pl_corp_entities', JSON.stringify([
    { id, name: 'Navi Builders Pvt Ltd', gstin: '27AAAPA1234A1Z5', currency: 'INR', fyStartMonth: 4, created_at: born.toISOString() },
  ]))
  localStorage.setItem('pl_corp_members', JSON.stringify([
    { id: 'm1', entity_id: id, user_id: 'local-user', email: 'owner@test.invalid', role: 'owner', created_at: stamp },
  ]))
  localStorage.setItem('pl_corp_projects', JSON.stringify([
    { id: 'site-md', entity_id: id, name: 'Marine Drive Tower', code: 'MD-1', client: 'Navi Realty', contract_value: 10000000, estimate: 8000000, status: 'active', created_at: stamp },
  ]))
  localStorage.setItem('pl_corp_work_orders', JSON.stringify([
    { id: 'wo1', entity_id: id, project_id: 'site-md', contractor: 'Sharma Plastering', scope: 'Internal plaster', order_value: 2000000, pricing: 'lumpSum', retention_percent: 5, tds_percent: 1, status: 'running', retention_released: 0, ref: 'WO/2026/014', created_at: stamp },
  ]))
  localStorage.setItem('pl_corp_ra_bills', JSON.stringify([
    { id: 'rb1', entity_id: id, work_order_id: 'wo1', number: 1, date: '2026-03-31', claimed_to_date: 500000, certified_to_date: 500000, advance_recovered: 0, material_recovered: 0, penalty: 0, other_deduction: 0, status: 'certified', created_at: stamp },
    { id: 'rb2', entity_id: id, work_order_id: 'wo1', number: 2, date: '2026-04-30', claimed_to_date: 1300000, certified_to_date: 1200000, advance_recovered: 0, material_recovered: 0, penalty: 0, other_deduction: 0, status: 'certified', created_at: stamp },
  ]))
  localStorage.setItem('pl_corp_items', JSON.stringify([
    { id: 'i1', entity_id: id, name: 'Cement OPC 53', unit: 'bag', reorder_level: 500, category: 'cement', created_at: stamp },
  ]))
  localStorage.setItem('pl_corp_movements', JSON.stringify([
    { id: 'v1', entity_id: id, item_id: 'i1', kind: 'receipt', qty: 200, unit_cost: 400, other_cost: 0, store_id: null, project_id: null, date: '2026-01-01', created_at: stamp },
  ]))
  localStorage.setItem('pl_corp_muster', JSON.stringify([
    { id: 'mu1', entity_id: id, project_id: 'site-md', date: '2026-03-03', trade: 'mason', headcount: 14, rate: 800, overtime_hours: 0, overtime_rate: 0, created_at: stamp },
  ]))
  localStorage.setItem('pl_corp_work_items', JSON.stringify([
    { id: 'w1', entity_id: id, project_id: 'site-md', code: 'S-1', description: 'RCC framed structure', stage: 'structure', unit: 'cum', planned_qty: 600, rate: 6500, created_at: stamp },
  ]))
  localStorage.setItem('pl_corp_measurements', JSON.stringify([
    { id: 'me1', entity_id: id, work_item_id: 'w1', project_id: 'site-md', date: '2026-05-01', qty: 300, created_at: stamp },
  ]))
  localStorage.setItem('pl_corp_units', JSON.stringify([
    { id: 'u1', entity_id: id, project_id: 'site-md', name: 'A-1204', kind: 'flat', tower: 'A', floor: 12, configuration: '3BHK', carpet_area: 1100, area_basis: 'carpet', rate_per_area: 10000, agreed_price: 11000000, other_charges: 500000, status: 'booked', created_at: stamp },
  ]))
  localStorage.setItem('pl_corp_plan_stages', JSON.stringify([
    { id: 'ps1', unit_id: 'u1', entity_id: id, label: 'On booking', percent: 0, amount: 1000000, work_stage: '', trigger_at: 100, due_on: '2026-01-01', sequence: 1 },
  ]))
  localStorage.setItem('pl_corp_receipts', '[]')
  localStorage.setItem('pl_corp_active', id)
}, [ID, now])

console.log('\n── THE PAYMENT CERTIFICATE ──')
await p.goto(`${B}/operations?tab=labour`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
await view('Contractors')
const labour = await main()
ok('the certificate is offered on the bill itself', /Certificate/.test(labour), labour.slice(0, 800))
ok('one per running account bill',
  (await p.locator('#main-content button[aria-label^="Payment certificate"]').count()) === 2)
await prints('the certificate', () => p.locator('#main-content button[aria-label="Payment certificate for RA 2"]').click())

console.log('\n── THE DEMAND LETTER ──')
await p.goto(`${B}/operations?tab=sales`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
await view('Collections')
ok('a demand letter is offered where the money is owed',
  (await p.locator('#main-content button[aria-label^="Demand letter"]').count()) === 1,
  (await main()).slice(0, 600))
await prints('the demand letter', () => p.locator('#main-content button[aria-label^="Demand letter"]').click())

console.log('\n── THE MEASUREMENT SHEET ──')
await p.goto(`${B}/operations?tab=projects`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
await view('Progress')
ok('the sheet is offered where the measuring happens',
  (await p.locator('#main-content button[aria-label="Print measurement sheet"]').count()) === 1)
await prints('the measurement sheet', () => p.locator('#main-content button[aria-label="Print measurement sheet"]').click())

console.log('\n── THE STOCK STATEMENT AND THE INDENT ──')
await p.goto(`${B}/operations?tab=materials`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
ok('a stock statement is offered in the yard',
  (await p.locator('#main-content button[aria-label="Print stock statement"]').count()) === 1)
// 200 bags against a reorder level of 500, so there is something to indent for.
ok('and an indent, because something is below its level',
  (await p.locator('#main-content button[aria-label="Print material indent"]').count()) === 1)
await prints('the stock statement', () => p.locator('#main-content button[aria-label="Print stock statement"]').click())
await prints('the indent', () => p.locator('#main-content button[aria-label="Print material indent"]').click())

console.log('\n── THE MUSTER ROLL ──')
await p.goto(`${B}/operations?tab=labour`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
ok('the muster roll is offered on the register',
  (await p.locator('#main-content button[aria-label="Print muster roll"]').count()) === 1)
await prints('the muster roll', () => p.locator('#main-content button[aria-label="Print muster roll"]').click())

console.log('\n── AND NOT OFFERED WHERE THERE IS NOTHING TO PRINT ──')
// A button that produces an error is worse than no button.
await p.evaluate(() => {
  localStorage.setItem('pl_corp_items', '[]')
  localStorage.setItem('pl_corp_movements', '[]')
  localStorage.setItem('pl_corp_muster', '[]')
})
await p.goto(`${B}/operations?tab=materials`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
ok('an empty yard offers no stock statement',
  (await p.locator('#main-content button[aria-label="Print stock statement"]').count()) === 0)
await p.goto(`${B}/operations?tab=labour`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
ok('and an empty register offers no muster roll',
  (await p.locator('#main-content button[aria-label="Print muster roll"]').count()) === 0)

console.log('\n── NOTHING BROKE ──')
ok('no page errors anywhere in the run', errs.length === 0, errs.slice(0, 3).join(' / '))

console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
if (fail) process.exitCode = 1
