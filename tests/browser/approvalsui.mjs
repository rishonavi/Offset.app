// A second pair of eyes, end to end.
//
// The machinery for this existed from the start — needsApproval, canApprove,
// splitByApproval, a policy with a threshold and a switch on the Companies page
// — and nothing anywhere in the app read any of it. The switch was decorative
// and nothing had ever been approved. These assertions are mostly about that:
// that turning it on now changes what happens.
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
const ls = (k) => p.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), k)
const main = () => p.locator('#main-content').innerText()
const policy = () => p.evaluate(() => JSON.parse(localStorage.getItem('pl_corp_policy') || '{}'))
const OUTER = ['Projects', 'Materials', 'Labour', 'Plant', 'Sales', 'Advances', 'Payroll']
const outerTab = async (name) => {
  await p.locator('#main-content button[aria-pressed]').nth(OUTER.indexOf(name)).click()
  await p.waitForTimeout(450)
}

const seed = (opts = {}) => p.evaluate((o) => {
  localStorage.clear()
  const id = 'ent-appr-1'
  const now = new Date().toISOString()
  const born = new Date(); born.setFullYear(born.getFullYear() - 1)
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'a1', name: 'Depot', type: 'Real Estate — Villa / House', entity_id: id, created_at: born.toISOString() },
  ]))
  for (const k of ['pl_expenses', 'pl_income', 'pl_documents']) localStorage.setItem(k, '[]')
  localStorage.setItem('pl_corp_entities', JSON.stringify([
    { id, name: 'Navi Builders Pvt Ltd', registration: '', gstin: '', currency: 'INR', fyStartMonth: 4, created_at: born.toISOString() },
  ]))
  localStorage.setItem('pl_corp_members', JSON.stringify([
    { id: 'm1', entity_id: id, user_id: 'local-user', email: 'owner@test.invalid', role: 'owner', department_id: null, created_at: now },
  ]))
  if (o.policy) localStorage.setItem('pl_corp_policy', JSON.stringify({ [id]: o.policy }))
  localStorage.setItem('pl_corp_active', id)
}, opts)

console.log('\n── THE SWITCH USED TO CHANGE NOTHING ──')
await p.goto(B, { waitUntil: 'domcontentloaded' })
await seed({})
await p.goto(`${B}/companies`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
ok('approvals start off', !(await policy())['ent-appr-1']?.enabled)
await p.locator('#main-content input[type="checkbox"]').first().check()
await p.waitForTimeout(600)
ok('turning it on is stored', (await policy())['ent-appr-1']?.enabled === true, JSON.stringify(await policy()))
// Per document, because a ₹50,000 expense is unusual and a ₹50,000 running
// account bill is a Tuesday.
await p.locator('input[aria-label="Approval threshold"]').fill('50000')
await p.waitForTimeout(500)
for (const label of ['Bills and expenses', 'Advances', 'Work orders', 'Running account bills']) {
  ok(`there is a threshold for ${label.toLowerCase()}`,
    (await p.locator(`input[aria-label="${label} threshold"]`).count()) === 1)
}
await p.locator('input[aria-label="Running account bills threshold"]').fill('1000000')
await p.waitForTimeout(600)
ok('a per-document threshold is stored',
  Number((await policy())['ent-appr-1']?.thresholds?.rabill) === 1000000,
  JSON.stringify((await policy())['ent-appr-1']?.thresholds))
// Unset stays unset. Writing the base figure into all four looks equivalent
// and freezes them at whatever it was when the policy was first saved.
ok('and the ones nobody set are not invented',
  (await policy())['ent-appr-1']?.thresholds?.advance === undefined,
  JSON.stringify((await policy())['ent-appr-1']?.thresholds))

console.log('\n── A BILL OVER THE LINE WAITS ──')
const spend = async (amount) => {
  await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(650)
  await p.locator('#main-content input[type="number"]').first().fill(String(amount))
  await p.locator('button[type="submit"]').first().click()
  await p.waitForTimeout(900)
}
await spend(60000)
await spend(1000)
const spent = await ls('pl_expenses')
ok('two bills were logged', spent.length === 2, String(spent.length))
// Gated on the way in, so it is pending from the moment it exists rather than
// from whenever somebody remembers.
ok('the one over the threshold is pending',
  spent.some((e) => Number(e.amount) === 60000 && e.approval_status === 'pending'),
  JSON.stringify(spent.map((e) => [e.amount, e.approval_status])))
ok('and the small one is not', spent.some((e) => Number(e.amount) === 1000 && e.approval_status === 'none'))
ok('the bill records who raised it', spent.every((e) => e.created_by !== undefined))

console.log('\n── ONE QUEUE, WHEREVER IT WAS RAISED ──')
await p.goto(`${B}/companies`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
let page = await main()
ok('the queue shows it', /Waiting for approval/.test(page), page.slice(0, 400))
ok('with what it is holding up', /60,000/.test(page), page.slice(page.indexOf('Waiting for approval'), page.indexOf('Waiting for approval') + 300))
// Nobody signs their own, however senior — which is the whole point.
ok('and says the owner raised it herself',
  /you raised yourself/.test(page) || /your own/i.test(page), page.slice(page.indexOf('Waiting for approval'), page.indexOf('Waiting for approval') + 400))
ok('so there is nothing for her to press',
  (await p.locator('#main-content button[aria-label^="Approve"]').count()) === 0)

// Somebody else raised the next one.
await p.evaluate(() => {
  const list = JSON.parse(localStorage.getItem('pl_expenses'))
  const big = list.find((e) => Number(e.amount) === 60000)
  big.created_by = 'somebody-else'
  localStorage.setItem('pl_expenses', JSON.stringify(list))
})
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(800)
ok('now it can be signed', (await p.locator('#main-content button[aria-label^="Approve"]').count()) === 1)
await p.locator('#main-content button[aria-label^="Approve"]').first().click()
await p.waitForTimeout(900)
ok('approving it sticks',
  (await ls('pl_expenses')).some((e) => Number(e.amount) === 60000 && e.approval_status === 'approved'),
  JSON.stringify((await ls('pl_expenses')).map((e) => [e.amount, e.approval_status])))
ok('and the queue empties', /Nothing is waiting/.test(await main()), (await main()).slice(0, 400))

console.log('\n── THE CONSTRUCTION DOCUMENTS TOO ──')
await p.evaluate(() => {
  const now = new Date().toISOString()
  localStorage.setItem('pl_corp_work_orders', JSON.stringify([{
    id: 'wo1', entity_id: 'ent-appr-1', project_id: null, contractor: 'Sharma Plastering',
    scope: 'Plaster', order_value: 900000, pricing: 'lumpSum', retention_percent: 5, tds_percent: 1,
    status: 'running', retention_released: 0, approval_status: 'pending', created_by: 'somebody-else', created_at: now,
  }]))
  localStorage.setItem('pl_corp_ra_bills', JSON.stringify([{
    id: 'rb1', entity_id: 'ent-appr-1', work_order_id: 'wo1', number: 1, date: '2026-03-31',
    claimed_to_date: 1750000, certified_to_date: 1750000, advance_recovered: 0, material_recovered: 0,
    penalty: 0, other_deduction: 0, status: 'certified', approval_status: 'pending',
    created_by: 'somebody-else', created_at: now,
  }]))
})
await p.goto(`${B}/companies`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
page = await main()
ok('a work order and a certification queue up beside a bill',
  /Sharma Plastering/.test(page) && /Running account bills/.test(page), page.slice(page.indexOf('Waiting for approval'), page.indexOf('Waiting for approval') + 500))
// Biggest first, because that is what actually gets looked at.
ok('the biggest is first', page.indexOf('17,50,000') < page.indexOf('9,00,000'), page.slice(0, 600))
await p.locator('#main-content button[aria-label^="Refuse"]').first().click()
await p.waitForTimeout(900)
ok('refusing a certification sticks',
  (await ls('pl_corp_ra_bills'))[0]?.approval_status === 'rejected',
  (await ls('pl_corp_ra_bills'))[0]?.approval_status)
// The one thing an approval has to leave behind.
const trail = await ls('pl_corp_audit')
ok('and it is audited', trail.some((a) => a.action === 'rabill.reject'),
  [...new Set(trail.map((a) => a.action))].join(', '))
ok('naming who signed', (await ls('pl_corp_ra_bills'))[0]?.approved_by !== undefined)

console.log('\n── A REFUSAL IS NOT A CERTIFICATION ──')
await p.goto(`${B}/operations`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
await outerTab('Labour')
await p.locator('#main-content [role="tab"]', { hasText: 'Contractors' }).first().click()
await p.waitForTimeout(600)
const labour = await main()
// The bill was refused, so it certified nothing and the contractor is owed
// nothing for it.
ok('the refused bill certifies nothing', !/17,50,000/.test(labour), labour.slice(0, 900))
ok('and the work order still says it is waiting',
  /waiting for approval/i.test(labour), labour.slice(0, 900))

console.log('\n── THE PAGE WHERE WORK HAPPENS SAYS SO ──')
// A control nobody finds gets switched off, and the queue lives elsewhere.
await p.goto(`${B}/operations`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
const ops = await main()
ok('Operations says something is held up', /waiting for approval/i.test(ops), ops.slice(0, 400))
ok('with what it is worth', /9,00,000/.test(ops), ops.slice(0, 400))
ok('and a way to get to it', (await p.locator('#main-content a[href="/companies"]').count()) >= 1)

console.log('\n── OFF MEANS OFF ──')
await seed({ policy: { enabled: false, threshold: 50000, thresholds: {}, alwaysCategories: [] } })
await spend(9999999)
ok('with approvals off nothing waits for anybody',
  (await ls('pl_expenses')).every((e) => e.approval_status !== 'pending'),
  JSON.stringify((await ls('pl_expenses')).map((e) => e.approval_status)))
await p.goto(`${B}/operations`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
ok('and no banner appears', !/waiting for approval/i.test(await main()))

console.log('\n── PERSONAL BOOKS HAVE NOBODY TO APPROVE ──')
// The company's asset belongs to the company, so personal books need one of
// their own before there is a form to fill in at all.
await p.evaluate(() => {
  const list = JSON.parse(localStorage.getItem('pl_properties'))
  list.push({ id: 'own1', name: 'Sea View Villa', type: 'Real Estate — Villa / House', created_at: new Date().toISOString() })
  localStorage.setItem('pl_properties', JSON.stringify(list))
  localStorage.setItem('pl_corp_active', '__personal__')
})
await spend(9999999)
const personalRows = (await ls('pl_expenses')).filter((e) => !e.entity_id)
ok('a personal bill was logged', personalRows.length === 1, String(personalRows.length))
// There is nobody else to approve it, which is why the gate is empty here.
ok('and is never gated', personalRows.every((e) => !e.approval_status || e.approval_status === 'none'),
  JSON.stringify(personalRows.map((e) => e.approval_status)))
ok('nor does it carry an approver', personalRows.every((e) => !e.approved_by))

console.log('\n── NOTHING BROKE ──')
ok('no page errors anywhere in the run', errs.length === 0, errs.slice(0, 3).join(' / '))

console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
if (fail) process.exitCode = 1
