// Retention with a date on it, and the side of the contract it is held from.
//
// The screen could hold retention and release it, and that was all: one button
// that gave back the whole accrual at once, with nothing anywhere saying when
// any of it was due. A builder's money comes back in two pieces months apart,
// so the release had to become a schedule — and the schedule had to say
// "undated" out loud, because retention on a job whose completion nobody
// recorded can never fall due and would otherwise sit for years looking
// settled.
//
// The other half is the toggle. A construction company holds retention from its
// subcontractors and has it held from it by its client. The assertion that
// matters is not that both lists render; it is that the client contract is
// nowhere in the subcontract list, because the same rows read as cost on one
// side and revenue on the other.
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

const ls = (k) => p.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), k)
const main = () => p.locator('#main-content').innerText()
const ENT = 'ent-ret-1'
const back = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }

await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(({ ent, longAgo, recently }) => {
  localStorage.clear()
  const now = new Date().toISOString()
  for (const k of ['pl_properties', 'pl_expenses', 'pl_income', 'pl_documents']) localStorage.setItem(k, '[]')
  localStorage.setItem('pl_corp_entities', JSON.stringify([
    { id: ent, name: 'Navi Builders Pvt Ltd', currency: 'INR', fy_start_month: 4, created_at: now },
  ]))
  localStorage.setItem('pl_corp_members', JSON.stringify([
    { id: 'm1', entity_id: ent, user_id: 'local-user', email: '', role: 'owner', department_id: null, created_at: now },
  ]))
  localStorage.setItem('pl_corp_active', ent)
  const order = (over) => ({
    id: over.id, entity_id: ent, project_id: null, contractor: over.contractor, scope: '',
    order_value: 1000000, pricing: 'lumpSum', retention_percent: 5, tds_percent: 1,
    started_on: '', due_on: '', status: 'running', ref: '', notes: '', retention_released: 0,
    side: 'sub', completed_on: '', dlp_months: 12, release_split_percent: 50,
    created_at: now, updated_at: now, ...over,
  })
  localStorage.setItem('pl_corp_work_orders', JSON.stringify([
    // Finished two hundred days ago: past the completion tranche, and still
    // five months short of the twelve-month defect liability period. Both of
    // those states have to be on the screen at once or the test cannot tell
    // "due" from "dated".
    order({ id: 'wo-done', contractor: 'Kadappa Stone', completed_on: longAgo, status: 'closed' }),
    // Running, so nothing says when its retention comes back.
    order({ id: 'wo-open', contractor: 'Sharma Plastering' }),
    // The other side entirely.
    order({ id: 'wo-client', contractor: 'Metro Development Authority', side: 'client', completed_on: recently }),
  ]))
  const bill = (id, workOrderId, certified) => ({
    id, entity_id: ent, work_order_id: workOrderId, project_id: null, number: 1,
    date: recently, claimed_to_date: certified, certified_to_date: certified,
    advance_recovered: 0, material_recovered: 0, penalty: 0, other_deduction: 0,
    status: 'certified', note: '', created_at: now, updated_at: now,
  })
  localStorage.setItem('pl_corp_ra_bills', JSON.stringify([
    bill('ra-done', 'wo-done', 400000),
    bill('ra-open', 'wo-open', 600000),
    bill('ra-client', 'wo-client', 2000000),
  ]))
}, { ent: ENT, longAgo: back(200), recently: back(30) })

const openContractors = async () => {
  await p.goto(`${B}/operations?tab=labour`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(900)
  await p.locator('#main-content [role="tab"]', { hasText: 'Contractors' }).first().click()
  await p.waitForTimeout(700)
}
await openContractors()

console.log('\n── THE SUBCONTRACT SIDE ──')
let text = await main()
ok('the contractors screen opens', /Kadappa Stone/i.test(text), text.slice(0, 200))
ok('and the running order is there too', /Sharma Plastering/i.test(text))
// The assertion this file exists for. The client contract is in the same store
// and must not be in this list.
ok('the client contract is not in the subcontract list', !/Metro Development Authority/i.test(text), text.slice(0, 400))
// Control: it is in the store, so its absence is a filter and not an empty database.
ok('though it is in the books', (await ls('pl_corp_work_orders')).some((o) => o.side === 'client'))

console.log('\n── WHEN IT COMES BACK ──')
ok('the release schedule is shown', /retention release/i.test(text), text.slice(0, 300))
ok('in two tranches', /on completion/i.test(text) && /after defect liability/i.test(text))
// A finished job: the completion half has fallen due and says by how long.
ok('the finished order says how far past due it is', /days over/i.test(text), text.slice(0, 600))
ok('and the second half is not yet', /not yet/i.test(text))
// The state that hides money. Not "waiting" — there is no date to wait for.
ok('the running order says it has no release date', /undated/i.test(text))
ok('and says so in words as well', /no date until the work is marked finished/i.test(text))

console.log('\n── A DATE MAKES IT DUE ──')
const completion = p.locator('#main-content input[aria-label="Completion date for Sharma Plastering"]')
ok('the running order offers a completion date', await completion.count() === 1)
ok('which is empty', (await completion.inputValue()) === '', await completion.inputValue())
await completion.fill(back(500))
await p.waitForTimeout(1000)
ok('it is stored on the order',
  (await ls('pl_corp_work_orders')).find((o) => o.id === 'wo-open')?.completed_on === back(500),
  String((await ls('pl_corp_work_orders')).find((o) => o.id === 'wo-open')?.completed_on))
text = await main()
ok('and undated is gone from that order', (text.match(/undated/gi) || []).length === 0, text.slice(0, 500))

console.log('\n── RELEASING ONE HALF IS NOT RELEASING BOTH ──')
// 5% of 400,000 is 20,000 accrued, so the completion tranche is 10,000.
await p.getByRole('button', { name: /Release on completion retention for Kadappa Stone/i }).first().click()
await p.waitForTimeout(1000)
let stored = (await ls('pl_corp_work_orders')).find((o) => o.id === 'wo-done')
ok('half the accrual is recorded as released', Number(stored?.retention_released) === 10000, String(stored?.retention_released))
ok('and not the whole of it', Number(stored?.retention_released) !== 20000)
text = await main()
ok('the first tranche now reads as released', /released/i.test(text))
// And the button for it is gone, because there is nothing left in it.
ok('with nothing left to release on it',
  await p.getByRole('button', { name: /Release on completion retention for Kadappa Stone/i }).count() === 0)

console.log('\n── AND THEN THE SECOND ──')
await p.getByRole('button', { name: /Release after defect liability retention for Kadappa Stone/i }).first().click()
await p.waitForTimeout(1000)
stored = (await ls('pl_corp_work_orders')).find((o) => o.id === 'wo-done')
ok('the whole accrual is released', Number(stored?.retention_released) === 20000, String(stored?.retention_released))

console.log('\n── THE CLIENT SIDE ──')
await p.locator('#main-content [role="tab"]', { hasText: 'Client contract' }).first().click()
await p.waitForTimeout(800)
text = await main()
ok('the client contract appears', /Metro Development Authority/i.test(text), text.slice(0, 300))
// And the mirror of the first assertion: the subcontracts are not here.
ok('and the subcontractors are not', !/Kadappa Stone/i.test(text) && !/Sharma Plastering/i.test(text), text.slice(0, 400))
ok('the certified figure is labelled as billing, not certifying', /billed to client/i.test(text), text.slice(0, 400))
ok('and the retention as withheld from the company', /retention withheld/i.test(text))
// Money the company is owed rather than money it owes: no Release button, but
// the sentence that makes somebody chase it.
ok('nothing here is the company’s to release',
  await p.getByRole('button', { name: /Release .* retention for Metro/i }).count() === 0)
ok('it is named as a debt instead', /became a debt/i.test(text), text.slice(0, 800))

console.log('\n── AND THE FORM ASKS FOR THE CONTRACT TERMS ──')
ok('the defect liability period is asked for',
  await p.locator('#main-content input[aria-label="Defect liability months"]').count() === 1)
ok('and how the release splits',
  await p.locator('#main-content input[aria-label="Released at completion percent"]').count() === 1)
// The party is named for the side you are on.
ok('the client side asks for a client, not a contractor', /they engaged us|new client contract/i.test(text), text.slice(0, 600))

ok('no page errors', errs.length === 0, errs.join(' | '))
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
