// What is going wrong, on the page people actually open.
//
// Every module in this app works out something nobody will go looking for, and
// until now all of it sat three clicks deep in a sub-tab. The assertions worth
// reading are the two that decide whether this is useful or noise: that a wrong
// number is shown above a large one, and that a company with nothing wrong is
// told so rather than shown an empty box.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 }, serviceWorkers: 'block' })
const p = await ctx.newPage()
p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 160)) })
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('ERR_FAILED') && !t.includes('404')) errs.push('CONSOLE ' + t.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
p.on('dialog', (d) => d.accept())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${e ? '  — ' + e : ''}`) }
const main = () => p.locator('#main-content').innerText()
const card = async () => {
  const t = await main()
  const i = t.indexOf('Needs attention')
  return i < 0 ? '' : t.slice(i, i + 1800)
}

const ID = 'ent-att-1'
const seed = (extra = {}) => p.evaluate(([id, more]) => {
  localStorage.clear()
  const now = new Date().toISOString()
  const born = new Date(); born.setFullYear(born.getFullYear() - 1)
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'a1', name: 'Depot', type: 'Real Estate — Villa / House', entity_id: id, created_at: now },
  ]))
  for (const k of ['pl_expenses', 'pl_income', 'pl_documents']) localStorage.setItem(k, '[]')
  localStorage.setItem('pl_corp_entities', JSON.stringify([
    { id, name: 'Navi Builders Pvt Ltd', currency: 'INR', fyStartMonth: 4, created_at: born.toISOString() },
  ]))
  localStorage.setItem('pl_corp_members', JSON.stringify([
    { id: 'm1', entity_id: id, user_id: 'local-user', email: 'owner@test.invalid', role: 'owner', created_at: now },
  ]))
  for (const [k, v] of Object.entries(more)) localStorage.setItem(k, JSON.stringify(v))
  localStorage.setItem('pl_corp_active', id)
}, [ID, extra])

const now = new Date().toISOString()

console.log('\n── NOTHING WRONG IS SAID, NOT SHOWN EMPTY ──')
await p.goto(B, { waitUntil: 'domcontentloaded' })
await seed()
await p.goto(B, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
const clear = await main()
// An empty box reads like something failed to load.
ok('a company with nothing wrong is told so', /Nothing needs attention/.test(clear), clear.slice(0, 400))
ok('and told what was checked', /short stores|unclaimed rejections|past its costing/.test(clear))

console.log('\n── MONEY NOBODY IS CHASING ──')
await p.goto(B, { waitUntil: 'domcontentloaded' })
await seed({
  pl_corp_items: [{ id: 'i1', entity_id: ID, name: 'Cement OPC 53', unit: 'bag', reorder_level: 0, created_at: now }],
  pl_corp_movements: [
    { id: 'v1', entity_id: ID, item_id: 'i1', kind: 'receipt', qty: 200, unit_cost: 400, other_cost: 0, store_id: null, project_id: null, date: '2026-01-01', created_at: now },
    { id: 'v2', entity_id: ID, item_id: 'i1', kind: 'rejected', qty: 10, unit_cost: 400, store_id: null, project_id: null, date: '2026-01-02', reason: 'set hard in transit', created_at: now },
  ],
})
await p.goto(B, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
let shown = await card()
ok('the rejected delivery is surfaced', /went back to suppliers/.test(shown), shown.slice(0, 500))
ok('with the figure', /4,000/.test(shown))
// A finding that makes you hunt through seven tabs is a finding people stop
// reading.
ok('and a link straight to it',
  (await p.locator('#main-content a[href="/operations?tab=materials"]').count()) >= 1)
ok('the total says what is at stake', /wrong, owed or at risk/.test(shown), shown.slice(0, 300))

console.log('\n── WRONG COMES ABOVE LARGE ──')
// A site holding less than nothing has issued material it was never sent. The
// company can be square overall and still have a store short, which is exactly
// what a single total hides.
await p.goto(B, { waitUntil: 'domcontentloaded' })
await seed({
  pl_corp_items: [{ id: 'i1', entity_id: ID, name: 'Cement OPC 53', unit: 'bag', reorder_level: 0, created_at: now }],
  pl_corp_movements: [
    { id: 'v1', entity_id: ID, item_id: 'i1', kind: 'receipt', qty: 500, unit_cost: 400, other_cost: 0, store_id: null, project_id: null, date: '2026-01-01', created_at: now },
    { id: 'v2', entity_id: ID, item_id: 'i1', kind: 'issue', qty: 50, store_id: 'site-x', project_id: 'site-x', date: '2026-02-01', created_at: now },
  ],
  // Two crore of saleable stock: a much bigger number, and not a problem.
  pl_corp_units: [{ id: 'u1', entity_id: ID, project_id: null, name: 'A-1204', kind: 'flat', carpet_area: 2000, area_basis: 'carpet', rate_per_area: 10000, agreed_price: 20000000, other_charges: 0, status: 'available', created_at: now }],
})
await p.goto(B, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
shown = await card()
ok('the short store is reported', /never received/.test(shown), shown.slice(0, 600))
ok('and the saleable stock is on the list too', /still available to sell/.test(shown), shown.slice(0, 900))
// Every total downstream of a wrong number is also suspect, which is why.
ok('but the wrong number is above the bigger one',
  shown.indexOf('never received') < shown.indexOf('still available to sell'),
  `${shown.indexOf('never received')} vs ${shown.indexOf('still available to sell')}`)
ok('and the page says why that is the order', /downstream of a wrong number/.test(shown), shown.slice(-400))
// Money you might make is not money you have lost.
ok('what is at stake does not include the two crore', !/2,00,00,000 wrong, owed or at risk/.test(shown))

console.log('\n── THE LINK GOES SOMEWHERE ──')
await p.locator('#main-content a[href^="/operations?tab="]').first().click()
await p.waitForTimeout(900)
ok('a finding opens the tab it is about', /tab=/.test(p.url()), p.url())
const landed = await main()
ok('and lands on that tab rather than the first one',
  /Add a material|Add a machine|Add a unit|Record a day/.test(landed), landed.slice(0, 300))
// A tab in the URL is a tab somebody can send to somebody else.
await p.goto(`${B}/operations?tab=plant`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
ok('and a tab can be linked to directly', /Add a machine/.test(await main()), (await main()).slice(0, 300))

console.log('\n── THE QUIETEST MONEY THERE IS ──')
await p.goto(B, { waitUntil: 'domcontentloaded' })
await seed({
  pl_corp_plant: [{ id: 'p1', entity_id: ID, project_id: null, name: 'JCB 3DX', kind: 'excavator', ownership: 'hired', registration: 'MH-04', vendor: 'Konkan', hire_rate: 12000, hire_basis: 'daily', minimum_hours: 0, hired_from: '2026-03-01', hired_to: '2026-03-10', fuel_included: false, operator_included: false, purchase_value: 0, useful_life_years: 8, salvage_value: 0, status: 'active', created_at: now }],
  pl_corp_plant_logs: [{ id: 'l1', entity_id: ID, plant_id: 'p1', project_id: null, date: '2026-03-01', working_hours: 8, idle_hours: 0, breakdown_hours: 0, trips: 0, fuel_litres: 0, fuel_cost: 0, created_at: now }],
})
await p.goto(B, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
shown = await card()
ok('plant billed with no log sheet is surfaced', /no log sheet/.test(shown), shown.slice(0, 600))
ok('with what it cost', /1,08,000/.test(shown), shown.slice(0, 600))
ok('and why it is the quietest money there is', /turned a wheel/.test(shown))

console.log('\n── PERSONAL BOOKS HAVE NONE OF THIS ──')
await p.evaluate(() => localStorage.setItem('pl_corp_active', '__personal__'))
await p.goto(B, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
const personal = await main()
ok('no attention card in personal books', !/Needs attention/.test(personal) && !/Nothing needs attention/.test(personal),
  personal.slice(0, 300))

console.log('\n── NOTHING BROKE ──')
ok('no page errors anywhere in the run', errs.length === 0, errs.slice(0, 3).join(' / '))

console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
if (fail) process.exitCode = 1
