// Was that lorry in line with the others?
//
// The price screen answered the question before buying — last paid against the
// best quote today. This is the one after, and nobody has ever asked it,
// because asking it by hand means reading down a column of forty receipts
// holding an average in your head.
//
// Two things have to be on screen together for this to be worth anything: the
// one delivery that jumped, and the material that merely got dearer. A check
// that cannot tell those apart shouts at an ordinary market and gets switched
// off in a week, so the second is as much the subject of this file as the
// first.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1200 }, serviceWorkers: 'block' })
const p = await ctx.newPage(); p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 160)) })
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('ERR_FAILED') && !t.includes('404')) errs.push('CONSOLE ' + t.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
p.on('dialog', (d) => d.accept())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const main = () => p.locator('#main-content').innerText()
const view = async (label) => {
  await p.locator('#main-content [role="tab"]', { hasText: label }).first().click()
  await p.waitForTimeout(500)
}
const ENT = 'ent-rate-1'
const back = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }

await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(({ ent, dates }) => {
  localStorage.clear()
  const now = new Date().toISOString()
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
  localStorage.setItem('pl_corp_items', JSON.stringify([
    { id: 'steel', entity_id: ent, name: 'TMT bars 12mm', category: 'steel', unit: 'kg', reorder_level: 0, created_at: now, updated_at: now },
    { id: 'cement', entity_id: ent, name: 'OPC 53 grade cement', category: 'cement', unit: 'bag', reorder_level: 0, created_at: now, updated_at: now },
  ]))
  const receipt = (id, itemId, qty, rate, date) => ({
    id, entity_id: ent, item_id: itemId, kind: 'receipt', qty, unit_cost: rate, other_cost: 0,
    date, store_id: null, to_store_id: null, project_id: null, vendor: 'Shakti Steel', reason: '', note: '', ref: '',
    created_at: now, updated_at: now,
  })
  localStorage.setItem('pl_corp_movements', JSON.stringify([
    // Steel: three at sixty, then a Saturday lorry at ninety.
    receipt('m1', 'steel', 1000, 60, dates[0]),
    receipt('m2', 'steel', 1000, 60, dates[1]),
    receipt('m3', 'steel', 1000, 60, dates[2]),
    receipt('m4', 'steel', 1000, 90, dates[3]),
    // Cement: a steady climb, every step inside the tolerance.
    receipt('m5', 'cement', 500, 380, dates[0]),
    receipt('m6', 'cement', 500, 396, dates[1]),
    receipt('m7', 'cement', 500, 412, dates[2]),
    receipt('m8', 'cement', 500, 428, dates[3]),
  ]))
  localStorage.setItem('pl_corp_muster', JSON.stringify([
    { id: 'mu1', entity_id: ent, project_id: 'tower', date: dates[3], trade: 'tiler', headcount: 10, rate: 950, overtime_hours: 0, overtime_rate: 0, contractor: '', created_at: now, updated_at: now },
    { id: 'mu2', entity_id: ent, project_id: 'villas', date: dates[3], trade: 'tiler', headcount: 8, rate: 800, overtime_hours: 0, overtime_rate: 0, contractor: '', created_at: now, updated_at: now },
  ]))
  localStorage.setItem('pl_corp_projects', JSON.stringify([
    { id: 'tower', entity_id: ent, name: 'Marine Drive Tower', status: 'active', contract_value: 0, estimate: 0, created_at: now, updated_at: now },
    { id: 'villas', entity_id: ent, name: 'Palm Grove Villas', status: 'active', contract_value: 0, estimate: 0, created_at: now, updated_at: now },
  ]))
}, { ent: ENT, dates: [back(60), back(45), back(30), back(5)] })

console.log('\n── THE ONE THAT JUMPED ──')
await p.goto(`${B}/operations?tab=materials`, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
await view('Prices')
let t = await main()
ok('the prices screen opens', /what it costs/i.test(t), t.slice(0, 200))
ok('a delivery above the going rate is named', /1 delivery came in above the going rate/i.test(t), t.slice(0, 500))
ok('and it is the steel', /TMT bars 12mm/.test(t))
// ₹90 on the day against ₹60 normal, 1,000 kg — ₹30,000 above.
ok('the rate that was paid is shown', /₹90/.test(t), t.slice(0, 700))
ok('against what is normal', /₹60 normal/.test(t), t.slice(0, 700))
ok('and what the difference came to', /\+₹30,000/.test(t), t.slice(0, 700))
ok('the total is on a stat card', /paid above the norm/i.test(t))

console.log('\n── AND THE ONE THAT MERELY GOT DEARER ──')
// Cement rose from 380 to 428 — more than twelve per cent overall, in four per
// cent steps. It must not appear, or the check is worthless.
ok('the steady climb is not called out', !/OPC 53 grade cement.*above the going rate/is.test(t))
ok('only one delivery is flagged in all', (t.match(/delivery came in above/gi) || []).length === 1, t.slice(0, 500))
// Control: the cement is on the page, so its absence from the panel is the
// check working rather than the material missing.
ok('though the cement is in the table', /OPC 53 grade cement/.test(t))
ok('with a drift shown against it', /\+12\.6%/.test(t), t.slice(t.search(/OPC 53/), t.search(/OPC 53/) + 200))

console.log('\n── WHAT THE NEXT LORRY OUGHT TO COST ──')
ok('the table has a normal column', /normal/i.test(t))
ok('and says how many came in above it', /1 above it/i.test(t), t.slice(0, 900))

console.log('\n── AND THE SAME TRADE, TWO SITES, TWO RATES ──')
await p.goto(`${B}/`, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
t = await main()
ok('the dashboard says tilers are paid differently', /tile layers are paid .*% more on one site/i.test(t), t.slice(0, 900))
ok('naming the dearer site and its rate', /Marine Drive Tower is paying ₹950/.test(t), t.slice(0, 1200))
ok('and the cheaper one', /Palm Grove Villas ₹800/.test(t), t.slice(0, 1200))
ok('the steel is on the dashboard too', /above the going rate/i.test(t), t.slice(0, 1200))

ok('no page errors', errs.length === 0, errs.join(' | '))
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
