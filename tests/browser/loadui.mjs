// A company with a real year behind it.
//
// `pressureui` leans on an empty install and on nonsense input. This one leans
// on volume, which is the other way a construction app falls over: a mid-size
// builder a year in has thousands of stock movements, a muster line for every
// trade on every working day, and a measurement for every pour. Every figure on
// the Operations page and the whole attention surface are recomputed from those
// rows on each render.
//
// Nothing here asserts a pretty number. It asserts that the pages still arrive,
// still carry their totals, and do it inside a budget a person would sit
// through — and that no page throws on the way.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 }, serviceWorkers: 'block' })
const p = await ctx.newPage(); p.setDefaultTimeout(60000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 200)) })
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('ERR_FAILED') && !t.includes('404')) errs.push('CONSOLE ' + t.slice(0, 200)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
p.on('dialog', (d) => d.accept())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + String(e).replace(/\n+/g, ' | ').slice(0, 200)}`) }
const main = () => p.locator('#main-content').innerText()

// A page is only "arrived" when its own content is there, not when the router
// has swapped a spinner in.
//
// The marker being absent is reported as absent rather than swallowed. The
// first version caught the timeout and returned it as the elapsed time, which
// made a page with a mistyped marker look identical to a page that had gone
// quadratic — /bills spent sixty seconds waiting for a word that was never on
// it, and the failure read as if the page were broken.
const open = async (path, marker) => {
  const started = Date.now()
  await p.goto(`${B}${path}`, { waitUntil: 'domcontentloaded' })
  let found = true
  await p.locator('#main-content').getByText(marker, { exact: false }).first()
    .waitFor({ state: 'visible', timeout: 30000 }).catch(() => { found = false })
  // Every Operations tab is its own chunk, so the marker can be on screen while
  // the panel under it is still a loading card. The time a page takes to arrive
  // is the time until there is something to read, which means waiting for the
  // Suspense fallback's live region to go as well.
  await p.waitForFunction(() => !document.querySelector('#main-content [role="status"]'), null, { timeout: 30000 })
    .catch(() => { found = false })
  return { ms: Date.now() - started, found }
}

const ENT = 'ent-load'
console.log('\n── A YEAR OF A BUILDER ──')
await p.goto(B, { waitUntil: 'domcontentloaded' })
const seeded = await p.evaluate((ent) => {
  localStorage.clear()
  const born = new Date(); born.setFullYear(born.getFullYear() - 1)
  const iso = (d) => d.toISOString().slice(0, 10)
  const back = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d) }
  const put = (k, v) => localStorage.setItem(k, JSON.stringify(v))

  put('pl_corp_entities', [{ id: ent, name: 'Navi Builders Pvt Ltd', currency: 'INR', fy_start_month: 4, created_at: born.toISOString() }])
  put('pl_corp_members', [{ id: 'm1', entity_id: ent, user_id: 'local-user', email: '', role: 'owner', department_id: null, created_at: born.toISOString() }])
  put('pl_corp_departments', [
    { id: 'dp-1', entity_id: ent, name: 'Construction', code: 'CON', budget_monthly: 4000000, parent_id: null, created_at: born.toISOString() },
    { id: 'dp-2', entity_id: ent, name: 'Site A', code: '', budget_monthly: 2000000, parent_id: 'dp-1', created_at: born.toISOString() },
  ])

  const sites = [0, 1, 2, 3].map((i) => ({
    id: `s${i}`, entity_id: ent, name: `Tower ${'ABCD'[i]}`, code: `T${i}`, client: 'Navi Realty',
    site_address: '', contract_value: 90000000, estimate: 72000000, started_on: iso(born),
    due_on: '', status: 'active', department_id: 'dp-2', notes: '', created_at: born.toISOString(),
  }))
  put('pl_corp_projects', sites)

  const items = []
  const movements = []
  for (let i = 0; i < 40; i++) {
    const id = `it${i}`
    items.push({ id, entity_id: ent, name: `Material ${i}`, sku: `SKU${i}`, unit: 'kg', reorder_level: 100,
      department_id: null, hsn: '', category: 'steel', brand: '', spec: '', created_at: born.toISOString() })
    // Receive into the yard, move to a site, issue on the job. 50 a material.
    for (let j = 0; j < 16; j++) {
      const d = back(340 - j * 20)
      movements.push({ id: `mv${i}-${j}r`, item_id: id, entity_id: ent, kind: 'receipt', qty: 1000, unit_cost: 60 + (j % 7),
        date: d, store_id: null, to_store_id: null, project_id: null, vendor: 'V', reason: '', other_cost: 500, note: '', ref: '', created_at: d })
      movements.push({ id: `mv${i}-${j}t`, item_id: id, entity_id: ent, kind: 'transfer', qty: 600, unit_cost: 0,
        date: d, store_id: null, to_store_id: `s${j % 4}`, project_id: null, vendor: '', reason: '', other_cost: 0, note: '', ref: '', created_at: d })
      movements.push({ id: `mv${i}-${j}i`, item_id: id, entity_id: ent, kind: 'issue', qty: 500, unit_cost: 0,
        date: d, store_id: `s${j % 4}`, to_store_id: null, project_id: `s${j % 4}`, vendor: '', reason: '', other_cost: 0, note: '', ref: '', created_at: d })
    }
  }
  put('pl_corp_items', items)
  put('pl_corp_movements', movements)

  const trades = ['mason', 'helper', 'carpenter', 'barBender', 'tiler']
  const muster = []
  for (let d = 1; d <= 260; d++) {
    for (const t of trades) {
      muster.push({ id: `mu${d}-${t}`, entity_id: ent, project_id: `s${d % 4}`, date: back(d), trade: t,
        headcount: 6 + (d % 9), rate: 550 + (d % 5) * 60, overtime_hours: d % 11 === 0 ? 3 : 0,
        overtime_rate: 120, contractor: 'Deepak', note: '', created_at: back(d) })
    }
  }
  put('pl_corp_muster', muster)

  const workItems = []
  const measurements = []
  for (let i = 0; i < 60; i++) {
    workItems.push({ id: `wi${i}`, entity_id: ent, project_id: `s${i % 4}`, code: `W/${i}`,
      description: `Work item ${i}`, stage: ['earthwork', 'structure', 'masonry', 'plaster', 'finishes'][i % 5],
      unit: 'cum', planned_qty: 1000, rate: 4000, note: '', created_at: born.toISOString() })
    for (let j = 0; j < 8; j++) {
      measurements.push({ id: `me${i}-${j}`, work_item_id: `wi${i}`, entity_id: ent, project_id: `s${i % 4}`,
        date: back(300 - j * 30), qty: 60, note: '', recorded_by: null, created_at: born.toISOString() })
    }
  }
  put('pl_corp_work_items', workItems)
  put('pl_corp_measurements', measurements)

  const plant = []
  const plantLogs = []
  for (let i = 0; i < 12; i++) {
    plant.push({ id: `pl${i}`, entity_id: ent, project_id: `s${i % 4}`, name: `Machine ${i}`, kind: 'excavator',
      ownership: i % 3 === 0 ? 'owned' : 'hired', registration: `MH${i}`, vendor: 'Hire Co', hire_rate: 8500,
      hire_basis: 'daily', minimum_hours: 8, hired_from: iso(born), hired_to: '', fuel_included: i % 4 === 0,
      operator_included: false, purchase_value: 500000, purchased_on: iso(born), useful_life_years: 8,
      salvage_value: 0, status: 'active', note: '', created_at: born.toISOString() })
    for (let j = 0; j < 40; j++) {
      plantLogs.push({ id: `plg${i}-${j}`, plant_id: `pl${i}`, entity_id: ent, project_id: `s${i % 4}`,
        date: back(j * 6 + 1), working_hours: 6, idle_hours: 2, breakdown_hours: j % 9 === 0 ? 3 : 0,
        trips: 0, fuel_litres: 40, fuel_cost: 3800, operator: 'Op', note: '', created_at: born.toISOString() })
    }
  }
  put('pl_corp_plant', plant)
  put('pl_corp_plant_logs', plantLogs)

  const units = []
  const stages = []
  const receipts = []
  for (let i = 0; i < 120; i++) {
    const id = `u${i}`
    const status = ['available', 'booked', 'agreement', 'registered'][i % 4]
    units.push({ id, entity_id: ent, project_id: `s${i % 4}`, name: `A-${100 + i}`, kind: 'flat', tower: 'A',
      floor: i % 12, configuration: '2 BHK', carpet_area: 650, built_up_area: 0, super_built_up_area: 0,
      area_basis: 'carpet', rate_per_area: 21500, agreed_price: 13975000, other_charges: 400000,
      status, note: '', created_at: born.toISOString() })
    if (status !== 'available') {
      for (let k = 0; k < 4; k++) {
        stages.push({ id: `st${i}-${k}`, unit_id: id, entity_id: ent, label: `Instalment ${k + 1}`,
          percent: 25, amount: 0, work_stage: 'structure', trigger_at: 25 * (k + 1), due_on: '', sequence: k })
      }
      receipts.push({ id: `rc${i}`, unit_id: id, entity_id: ent, project_id: `s${i % 4}`, date: back(120),
        amount: 3400000, mode: 'bank', reference: 'NEFT', towards: '', note: '', created_at: born.toISOString() })
    }
  }
  put('pl_corp_units', units)
  put('pl_corp_plan_stages', stages)
  put('pl_corp_receipts', receipts)

  const expenses = []
  const income = []
  for (let i = 0; i < 400; i++) {
    expenses.push({ id: `ex${i}`, entity_id: ent, property_id: null, project_id: `s${i % 4}`,
      department_id: i % 3 === 0 ? 'dp-2' : null, date: back(i), amount: 40000 + (i % 30) * 900,
      category: 'Materials', vendor: `Vendor ${i % 25}`, payment_method: 'Bank Transfer',
      status: i % 12 === 0 ? 'unpaid' : 'paid', description: '', receipt_url: null })
    if (i % 5 === 0) {
      income.push({ id: `in${i}`, entity_id: ent, property_id: null, project_id: `s${i % 4}`,
        department_id: null, date: back(i), amount: 800000, source: 'Running account', payer: 'Navi Realty',
        payment_method: 'Bank Transfer', status: 'received', description: '', receipt_url: null })
    }
  }
  put('pl_expenses', expenses)
  put('pl_income', income)
  put('pl_properties', [])
  put('pl_documents', [])
  localStorage.setItem('pl_corp_active', ent)

  return {
    movements: movements.length, muster: muster.length, measurements: measurements.length,
    plantLogs: plantLogs.length, units: units.length, expenses: expenses.length,
    bytes: Object.keys(localStorage).reduce((t, k) => t + (localStorage.getItem(k) || '').length, 0),
  }
}, ENT)

console.log(`  seeded: ${seeded.movements} movements, ${seeded.muster} muster, ${seeded.measurements} measurements, ${seeded.plantLogs} log sheets, ${seeded.units} units, ${seeded.expenses} entries (${Math.round(seeded.bytes / 1024)} KB)`)
ok('the year actually fits in storage', seeded.bytes > 0 && seeded.movements >= 1500, JSON.stringify(seeded))

console.log('\n── EVERY PAGE STILL ARRIVES ──')
// Generous, because this runs on whatever the CI box is. The point is not
// milliseconds; it is that nothing has become quadratic and silently stopped
// finishing.
const BUDGET = 25000
const pages = [
  ['/', 'Dashboard'],
  ['/operations', 'Tower A'],
  // Not 'Material': that matches the Materials tab button, which is on screen
  // before the panel is, so it proved nothing about the panel.
  ['/operations?tab=materials', 'Stock value'],
  ['/operations?tab=labour', 'muster'],
  ['/operations?tab=plant', 'Machine'],
  ['/operations?tab=sales', 'A-1'],
  ['/operations?tab=payroll', 'Payslips'],
  ['/expenses', 'Vendor'],
  ['/income', 'Running account'],
  ['/reports', 'Cost centres'],
  ['/bills', 'Bills'],
  ['/day', 'Day sheet'],
]
for (const [path, marker] of pages) {
  const { ms, found } = await open(path, marker)
  const body = await main()
  ok(`${path} arrives (${ms}ms)`, found && ms < BUDGET && body.length > 40,
    found ? `${ms}ms, ${body.length} chars` : `never showed "${marker}" — ${body.slice(0, 120).replace(/\n/g, ' | ')}`)
}

console.log('\n── AND THE FIGURES ARE REALLY THERE ──')
await open('/operations', 'Tower A')
let t = await main()
ok('the sites are listed', (t.match(/Tower [ABCD]/g) || []).length >= 4, t.slice(0, 300).replace(/\n/g, ' | '))
await open('/operations?tab=materials', 'Stock value')
t = await main()
ok('stock is valued rather than blank', /₹[\d,]{4,}/.test(t), t.slice(0, 400).replace(/\n/g, ' | '))
await open('/reports', 'Cost centres')
t = await main()
ok('the cost centre table survives the volume', /Construction/.test(t) && /Site A/.test(t))
await open('/', 'Dashboard')
t = await main()
ok('the dashboard computes its attention list', /needs attention|nothing looks wrong/i.test(t),
  t.slice(0, 400).replace(/\n/g, ' | '))

console.log('\n── A PHONE, ON THE SAME YEAR ──')
await p.setViewportSize({ width: 390, height: 780 })
for (const [path, marker] of [['/operations', 'Tower A'], ['/day', 'Day sheet'], ['/', 'Dashboard']]) {
  const { ms, found } = await open(path, marker)
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ok(`${path} on a phone (${ms}ms), no sideways scroll`, found && ms < BUDGET && overflow <= 2,
    `${ms}ms, ${overflow}px, marker ${found ? 'seen' : 'absent'}`)
}
await p.setViewportSize({ width: 1440, height: 1100 })

console.log('\n── AND NOTHING THREW ON THE WAY ──')
ok('no page errors under load', errs.length === 0, errs.slice(0, 4).join(' ;; '))

console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
