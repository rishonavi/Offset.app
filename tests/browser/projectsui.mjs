// A builder's jobs on screen: what each is costing against what it was costed
// at, where the money went, and whether the client has paid.
//
// The assertions worth reading are the ones that keep two numbers apart. The
// contract is what the client agreed to pay; the estimate is what the work was
// costed at. A job can be over its estimate and profitable, or inside it and
// losing, and a screen that shows one figure answers neither question.
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
const OUTER = ['Projects', 'Materials', 'Advances', 'Payroll']
const outerTab = async (name) => {
  await p.locator('#main-content button[aria-pressed]').nth(OUTER.indexOf(name)).click()
  await p.waitForTimeout(450)
}
// The summary cards are headed "Over estimate", so a page-wide search for that
// phrase can never come back false. Every negative check reads the site's own
// row, which is where the badge lives.
const siteRow = (name) => p.locator('#main-content li', { hasText: name }).first().innerText()
const view = async (label) => {
  await p.locator('#main-content [role="tab"]', { hasText: label }).first().click()
  await p.waitForTimeout(450)
}

// ── One company, one asset to hang entries off, nothing else ──
await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(() => {
  localStorage.clear()
  const id = 'ent-proj-1'
  const born = new Date(); born.setFullYear(born.getFullYear() - 1)
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'a1', name: 'Company Depot', type: 'Real Estate — Villa / House', entity_id: id, created_at: born.toISOString() },
  ]))
  for (const k of ['pl_expenses', 'pl_income', 'pl_documents']) localStorage.setItem(k, '[]')
  localStorage.setItem('pl_corp_entities', JSON.stringify([
    { id, name: 'Navi Builders Pvt Ltd', registration: '', gstin: '27AAAPA1234A1Z5', currency: 'INR', fyStartMonth: 4, created_at: born.toISOString() },
  ]))
  localStorage.setItem('pl_corp_members', JSON.stringify([
    { id: 'm1', entity_id: id, user_id: 'local-user', email: '', role: 'owner', department_id: null, created_at: new Date().toISOString() },
  ]))
  localStorage.setItem('pl_corp_active', id)
})
await p.goto(`${B}/operations`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)

console.log('\n── THE PAGE OPENS ON THE JOBS ──')
// Everything else on this page is a cost, and a cost belongs to a job before it
// belongs to a ledger.
const opened = await main()
ok('Projects is the first tab', (await p.locator('#main-content button[aria-pressed]').first().innerText()).trim().toUpperCase().includes('PROJECTS'))
ok('and the page opens on it', /Add a site/.test(opened), opened.slice(0, 200))
for (const label of ['Sites', 'Costs', 'Billing']) {
  ok(`there is a view for ${label}`, (await p.locator('#main-content [role="tab"]', { hasText: label }).count()) > 0)
}
ok('with nothing in it yet', /No sites yet/.test(opened))
// The one thing worth saying on the form, because getting it wrong is how a job
// looks profitable right up until it isn't.
ok('the form says what the two numbers mean',
  /contract is what the client agreed to pay/i.test(opened) && /estimate is what the work was costed at/i.test(opened))

console.log('\n── ADDING A SITE ──')
const addSite = async (s) => {
  await p.locator('input[aria-label="Site name"]').fill(s.name)
  if (s.code) await p.locator('input[aria-label="Site code"]').fill(s.code)
  if (s.client) await p.locator('input[aria-label="Client"]').fill(s.client)
  if (s.contract) await p.locator('input[aria-label="Contract value"]').fill(String(s.contract))
  if (s.estimate) await p.locator('input[aria-label="Estimate"]').fill(String(s.estimate))
  if (s.due) await p.locator('input[aria-label="Due on"]').fill(s.due)
  await p.locator('select[aria-label="Site status"]').selectOption(s.status || 'active')
  await p.locator('button', { hasText: /add site/i }).click()
  await p.waitForTimeout(500)
}
await addSite({ name: 'Marine Drive Tower', code: 'md-1', client: 'Navi Realty', contract: 10000000, estimate: 8000000, due: '2027-12-31' })
const sites = await ls('pl_corp_projects')
ok('the site is stored', sites.length === 1, String(sites.length))
ok('scoped to the company', sites[0]?.entity_id === 'ent-proj-1')
ok('the code is upper-cased, the way a delivery note writes it', sites[0]?.code === 'MD-1', sites[0]?.code)
ok('the contract is kept', Number(sites[0]?.contract_value) === 10000000)
ok('and the estimate separately', Number(sites[0]?.estimate) === 8000000, String(sites[0]?.estimate))
let text = await main()
ok('it is listed', /Marine Drive Tower/.test(text))
ok('with its client', /Navi Realty/.test(text))
const md = await siteRow('Marine Drive Tower')
ok('and nothing spent, it is not over anything', !/over estimate/i.test(md) && !/losing money/i.test(md), md.slice(0, 300))

console.log('\n── NOTHING COSTED IS NOT ON BUDGET ──')
// A site with neither figure would otherwise show 0% and read as healthy.
await addSite({ name: 'Powai Annexe', status: 'planned' })
text = await main()
ok('a site with no figures says so rather than showing 0%',
  /Nothing costed on this site yet/.test(text), text.slice(0, 900))

console.log('\n── A BILL BOOKED TO A JOB ──')
// The site picker appears on the entry form only once a company has sites.
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
ok('the expense form now offers a site', (await p.locator('select[aria-label="Site"]').count()) === 1)
const bill = async (amount, site, status = 'paid') => {
  await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(600)
  if (site) await p.locator('select[aria-label="Site"]').selectOption({ label: site })
  await p.locator('#main-content input[type="number"]').first().fill(String(amount))
  if (status === 'unpaid') {
    const sel = p.locator('#main-content select').filter({ hasText: /Paid/i }).first()
    if (await sel.count()) await sel.selectOption('unpaid').catch(() => {})
  }
  await p.locator('button[type="submit"]').first().click()
  await p.waitForTimeout(900)
}
await bill(3000000, 'Marine Drive Tower')
const expenses = await ls('pl_expenses')
ok('the bill is stored against the site',
  expenses[0]?.project_id === sites[0].id, JSON.stringify(expenses[0] || {}).slice(0, 140))
ok('and still against the company', expenses[0]?.entity_id === 'ent-proj-1')
await bill(400000, null)
ok('a bill with no site is still a bill', (await ls('pl_expenses')).some((e) => !e.project_id))

await p.goto(`${B}/operations`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
text = await main()
ok('the job shows what it has cost', /30,00,000|3,000,000/.test(text), text.slice(0, 800))
ok('and how much of the estimate that is', /38% of the estimate used/.test(text), text.slice(0, 900))
ok('it is not over the estimate', !/over estimate/i.test(await siteRow('Marine Drive Tower')))

console.log('\n── STOCK OFF THE SHELF IS A COST OF THE JOB ──')
// A builder with a central store who counts only the bills finds every job
// profitable and the company losing money.
await p.evaluate((siteId) => {
  const now = new Date().toISOString()
  localStorage.setItem('pl_corp_items', JSON.stringify([
    { id: 'i1', entity_id: 'ent-proj-1', name: 'TMT bar 12mm', category: 'steel', unit: 'kg', reorder_level: 0, created_at: now },
  ]))
  localStorage.setItem('pl_corp_movements', JSON.stringify([
    { id: 'm1', entity_id: 'ent-proj-1', item_id: 'i1', kind: 'receipt', qty: 100000, unit_cost: 60, other_cost: 0, date: '2026-02-01', created_at: now },
    { id: 'm2', entity_id: 'ent-proj-1', item_id: 'i1', kind: 'issue', qty: 100000, project_id: siteId, date: '2026-02-10', created_at: now },
  ]))
}, sites[0].id)
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(800)
text = await main()
// 30 lakh of bills plus 60 lakh of steel is 90 lakh against an 80 lakh
// estimate: inside budget on the bills alone, over it once the stores are in.
ok('adding the stores pushes the job over its estimate',
  /over estimate/i.test(await siteRow('Marine Drive Tower')), (await siteRow('Marine Drive Tower')).slice(0, 400))
ok('and the overrun is stated', /10,00,000|1,000,000/.test(text), text.slice(0, 1000))
// Still profitable against the contract, which is the other question.
ok('but it is not called losing, because the contract still covers it',
  !/losing money/i.test(await siteRow('Marine Drive Tower')))

console.log('\n── WHERE THE MONEY WENT ──')
await view('Costs')
const costs = await main()
ok('bills and material are shown apart', /Bills/.test(costs) && /Material/.test(costs), costs.slice(0, 500))
ok('bills booked total is there', /30,00,000|3,000,000/.test(costs))
ok('and the material issued', /60,00,000|6,000,000/.test(costs))
// A site's true cost is wrong by whatever sits in here.
ok('what was booked to no site is called out', /Booked to no site/.test(costs), costs.slice(0, 900))
ok('with its total', /4,00,000|400,000/.test(costs))

console.log('\n── WHAT THE CLIENT OWES ──')
await view('Billing')
let billing = await main()
ok('nothing invoiced yet', /Invoiced/.test(billing))
// Work the contract covers that nobody has raised an invoice for — usually
// larger than the unpaid invoices and nobody has a number for it.
ok('the whole contract is not yet billed', /Not yet billed/.test(billing))
ok('and that is the full contract value', /1,00,00,000|10,000,000/.test(billing), billing.slice(0, 900))

await p.goto(`${B}/income/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
ok('the income form offers a site too', (await p.locator('select[aria-label="Site"]').count()) === 1)
await p.locator('select[aria-label="Site"]').selectOption({ label: 'Marine Drive Tower' })
await p.locator('#main-content input[type="number"]').first().fill('4000000')
await p.locator('button[type="submit"]').first().click()
await p.waitForTimeout(900)
const income = await ls('pl_income')
ok('the invoice is stored against the site', income[0]?.project_id === sites[0].id, JSON.stringify(income[0] || {}).slice(0, 120))

await p.goto(`${B}/operations`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
await view('Billing')
billing = await main()
ok('the invoice reaches the billing view', /40,00,000|4,000,000/.test(billing), billing.slice(0, 900))
ok('and what is left unbilled came down', /60,00,000|6,000,000/.test(billing), billing.slice(0, 900))

console.log('\n── EDITING A SITE ──')
await view('Sites')
await p.locator('button[aria-label="Edit Marine Drive Tower"]').click()
await p.waitForTimeout(500)
ok('the form fills with the site', (await p.locator('input[aria-label="Site name"]').inputValue()) === 'Marine Drive Tower')
ok('and says which one is being edited', /Edit Marine Drive Tower/.test(await main()))
await p.locator('input[aria-label="Estimate"]').fill('12000000')
await p.locator('button', { hasText: /save site/i }).click()
await p.waitForTimeout(700)
const edited = await ls('pl_corp_projects')
ok('no second site was created', edited.length === 2, String(edited.length))
// Editing a site must not make it a different one.
ok('and it kept its id', edited.some((s) => s.id === sites[0].id))
ok('the estimate changed', edited.find((s) => s.id === sites[0].id)?.estimate === 12000000)
text = await main()
ok('and a 90-lakh spend is inside a 1.2-crore estimate again',
  !/over estimate/i.test(await siteRow('Marine Drive Tower')), (await siteRow('Marine Drive Tower')).slice(0, 400))

console.log('\n── LATE ──')
await p.evaluate(() => {
  const list = JSON.parse(localStorage.getItem('pl_corp_projects'))
  list[0].due_on = '2020-01-01'
  localStorage.setItem('pl_corp_projects', JSON.stringify(list))
})
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(800)
// Said in days rather than as a flag: "four days over" and "eight months over"
// are not the same conversation.
ok('a live job past its date says how many days', /\d+ days late/i.test(await main()), (await main()).slice(0, 700))
await view('Billing')
ok('and it is listed as past its date', /Past their date/.test(await main()))
await p.evaluate(() => {
  const list = JSON.parse(localStorage.getItem('pl_corp_projects'))
  list[0].status = 'completed'
  localStorage.setItem('pl_corp_projects', JSON.stringify(list))
})
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(800)
ok('a completed job is never late', !/days late/i.test(await main()), (await main()).slice(0, 600))

console.log('\n── OPEN ONLY ──')
await p.locator('input[aria-label="Open sites only"]').check()
await p.waitForTimeout(450)
const openOnly = await main()
ok('the finished job drops out', !/Marine Drive Tower/.test(openOnly), openOnly.slice(0, 500))
ok('and the open one stays', /Powai Annexe/.test(openOnly))

console.log('\n── THE BOOKS LINE STILL HOLDS ──')
await p.evaluate(() => localStorage.setItem('pl_corp_active', '__personal__'))
await p.goto(`${B}/operations`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
const personal = await main()
ok('in personal books the page says these belong to a company', /personal books/i.test(personal), personal.slice(0, 300))
ok('and shows no sites', !/Marine Drive Tower/.test(personal))
// A personal expense has no site, and the field should not be there to suggest
// otherwise.
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
ok('and the expense form offers no site', (await p.locator('select[aria-label="Site"]').count()) === 0)

console.log('\n── NOTHING BROKE ──')
ok('no page errors anywhere in the run', errs.length === 0, errs.slice(0, 3).join(' / '))

console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
if (fail) process.exitCode = 1
