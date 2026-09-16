// What is already promised, on the page people actually open.
//
// The three figures on this card must never merge. Committed is agreed and not
// yet incurred; owed is incurred and not settled. A screen that adds them
// reports a company with a healthy order book as one about to fail, and the
// person reading it acts on that.
//
// So the assertions are about separation as much as arithmetic: three columns
// with three different totals, and a card that stays away entirely when there
// is nothing agreed and nothing owed — because an empty panel of zeroes reads
// as a loading failure.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1400 }, serviceWorkers: 'block' })
const p = await ctx.newPage(); p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 160)) })
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('ERR_FAILED') && !t.includes('404')) errs.push('CONSOLE ' + t.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
p.on('dialog', (d) => d.accept())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const main = () => p.locator('#main-content').innerText()
// Just the card. The dashboard carries several totals of its own and a check
// that reads the whole page can be satisfied by one of those instead.
const card = async () => {
  const t = await main()
  const i = t.search(/ALREADY PROMISED/i)
  if (i < 0) return ''
  const rest = t.slice(i)
  // The dashboard's own blocks follow immediately. Without an end marker the
  // slice runs on into them and a check for a figure can be satisfied by a
  // different figure entirely.
  const end = rest.search(/\n(Dashboard|Getting started|SPEND BY|WHAT IS OWED|RECENT|TRENDS|BUDGETS)\b/)
  return end > 0 ? rest.slice(0, end) : rest
}
const ENT = 'ent-com-1'

await p.goto(B, { waitUntil: 'domcontentloaded' })
const seed = (rows) => p.evaluate(({ ent, rows }) => {
  localStorage.clear()
  const now = new Date().toISOString()
  for (const k of ['pl_expenses', 'pl_income', 'pl_documents']) localStorage.setItem(k, '[]')
  // The dashboard shows a first-run screen with no assets at all, and a card
  // that never renders passes every assertion about what it must not say.
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'a1', name: 'Yard', type: 'Real Estate — Villa / House', entity_id: ent, created_at: now },
  ]))
  localStorage.setItem('pl_corp_entities', JSON.stringify([
    { id: ent, name: 'Navi Builders Pvt Ltd', currency: 'INR', fy_start_month: 4, created_at: now },
  ]))
  localStorage.setItem('pl_corp_members', JSON.stringify([
    { id: 'm1', entity_id: ent, user_id: 'local-user', email: '', role: 'owner', department_id: null, created_at: now },
  ]))
  localStorage.setItem('pl_corp_active', ent)
  for (const [key, value] of Object.entries(rows)) localStorage.setItem(key, JSON.stringify(value))
}, { ent: ENT, rows })

console.log('\n── WITH NOTHING AGREED, THE CARD IS NOT THERE ──')
// An empty panel of zeroes reads as something that failed to load.
await seed({})
await p.goto(`${B}/`, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
ok('the dashboard loads', (await main()).length > 200)
ok('and says nothing about promises', !/already promised/i.test(await main()))

console.log('\n── A WORK ORDER HALF CERTIFIED ──')
const now = new Date().toISOString()
const order = {
  id: 'wo1', entity_id: ENT, project_id: null, contractor: 'Ganesh Construction', scope: '',
  order_value: 1000000, pricing: 'lumpSum', retention_percent: 5, tds_percent: 1,
  started_on: null, due_on: null, status: 'running', ref: '', notes: '', retention_released: 0,
  side: 'sub', completed_on: null, dlp_months: 12, release_split_percent: 50,
  created_at: now, updated_at: now,
}
const bill = {
  id: 'ra1', entity_id: ENT, work_order_id: 'wo1', project_id: null, number: 1,
  date: now.slice(0, 10), claimed_to_date: 400000, certified_to_date: 400000,
  advance_recovered: 0, material_recovered: 0, penalty: 0, other_deduction: 0,
  status: 'certified', note: '', created_at: now, updated_at: now,
}
await seed({ pl_corp_work_orders: [order], pl_corp_ra_bills: [bill] })
await p.goto(`${B}/`, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
let t = await card()
ok('the card appears', t.length > 50, (await main()).slice(0, 200))
// ₹10,00,000 agreed less ₹4,00,000 certified.
ok('the unspent part of the order is committed', /6,00,000/.test(t), t)
// ₹4,00,000 less 5% retention and 1% TDS.
ok('the certified bill is owed now', /3,76,000/.test(t), t)
// The separation this card exists for: the two are different figures and the
// screen never adds them.
ok('and the two are not the same number', !/9,76,000/.test(t), t)
ok('the three headings are all there',
  /agreed, not yet spent/i.test(t) && /owed now/i.test(t) && /due in/i.test(t), t)

console.log('\n── AN ACCEPTED QUOTATION IS A COMMITMENT ──')
const quote = {
  id: 'q1', entity_id: ENT, project_id: null, vendor: 'Shakti Steel', contact: '',
  date: now.slice(0, 10), valid_until: null, status: 'accepted', ref: '', notes: '',
  received_at: null, created_at: now, updated_at: now,
  lines: [{ id: 'l1', item_id: 'i1', name: 'TMT 12mm', qty: 1000, rate: 60, unit: 'kg', gst_percent: 18 }],
}
await seed({ pl_corp_work_orders: [order], pl_corp_ra_bills: [bill], pl_corp_quotes: [quote] })
await p.goto(`${B}/`, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
t = await card()
// 1,000 × ₹60 plus 18% = ₹70,800, so committed becomes ₹6,70,800.
ok('the delivery is added to what is committed', /6,70,800/.test(t), t)
ok('and the quotation is counted', /1 quotation/i.test(t), t)
ok('what is owed now did not move', /3,76,000/.test(t), t)

console.log('\n── AND A DELIVERY ALREADY TAKEN IS NOT ──')
await seed({
  pl_corp_work_orders: [order], pl_corp_ra_bills: [bill],
  pl_corp_quotes: [{ ...quote, received_at: now }],
})
await p.goto(`${B}/`, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
t = await card()
ok('the same quotation, stamped, drops out', !/6,70,800/.test(t), t)
ok('leaving the order on its own', /6,00,000/.test(t), t)

console.log('\n── THE GAP, AND WHAT COVERS IT ──')
t = await card()
ok('the gap is stated', /if everything due came in/i.test(t), t)
ok('as a shortfall here', /−₹3,76,000/.test(t), t)
// Nothing is due in against something owed, so the ratio is zero — which is an
// answer, and a stark one. It is only absent when there is nothing on either
// side to divide.
ok('and cover is nothing rather than missing', /0× cover/.test(t), t)

console.log('\n── AND THE OTHER SIDE FILLS IT ──')
const clientOrder = { ...order, id: 'wo-c', contractor: 'Metro Development Authority', side: 'client', order_value: 5000000 }
const clientBill = { ...bill, id: 'ra-c', work_order_id: 'wo-c', claimed_to_date: 1000000, certified_to_date: 1000000 }
await seed({ pl_corp_work_orders: [order, clientOrder], pl_corp_ra_bills: [bill, clientBill] })
await p.goto(`${B}/`, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
t = await card()
// ₹10,00,000 certified less 5% and 1% is ₹9,40,000 coming in.
ok('what the client owes is due in', /9,40,000/.test(t), t)
ok('the gap turns positive', /\+₹5,64,000/.test(t), t)
ok('and cover is shown now there is something to divide by', /2\.5× cover/.test(t), t)

console.log('\n── A CONTRACT WITH NO VALUE MAKES THE TOTAL A FLOOR ──')
await seed({
  pl_corp_work_orders: [order, { ...order, id: 'wo-rate', contractor: 'Daily gang', order_value: 0, pricing: 'rate' }],
  pl_corp_ra_bills: [bill],
})
await p.goto(`${B}/`, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
t = await card()
ok('the reader is told it is a floor', /this is a floor/i.test(t), t)
ok('and how many contracts carry no value', /1 contract carries no/i.test(t), t)

ok('no page errors', errs.length === 0, errs.join(' | '))
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
