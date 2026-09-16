// Labour, subcontractors and what is actually built, on screen.
//
// The assertion worth reading is the one about running account bills. Each one
// states the work done to date, so entering the third bill must charge the job
// the difference and not the whole figure again. The arithmetic still adds up
// when it is wrong, which is what makes it worth a test.
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
const OUTER = ['Projects', 'Materials', 'Labour', 'Plant', 'Sales', 'Advances', 'Payroll']
const outerTab = async (name) => {
  await p.locator('#main-content button[aria-pressed]').nth(OUTER.indexOf(name)).click()
  await p.waitForTimeout(450)
}
const view = async (label) => {
  await p.locator('#main-content [role="tab"]', { hasText: label }).first().click()
  await p.waitForTimeout(450)
}

// ── One company with one site already on it ──
await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(() => {
  localStorage.clear()
  const id = 'ent-lab-1'
  const born = new Date(); born.setFullYear(born.getFullYear() - 1)
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'a1', name: 'Company Depot', type: 'Real Estate — Villa / House', entity_id: id, created_at: born.toISOString() },
  ]))
  for (const k of ['pl_expenses', 'pl_income', 'pl_documents']) localStorage.setItem(k, '[]')
  localStorage.setItem('pl_corp_entities', JSON.stringify([
    { id, name: 'Navi Builders Pvt Ltd', registration: '', gstin: '', currency: 'INR', fyStartMonth: 4, created_at: born.toISOString() },
  ]))
  localStorage.setItem('pl_corp_members', JSON.stringify([
    { id: 'm1', entity_id: id, user_id: 'local-user', email: '', role: 'owner', department_id: null, created_at: new Date().toISOString() },
  ]))
  localStorage.setItem('pl_corp_projects', JSON.stringify([{
    id: 'site-md', entity_id: id, name: 'Marine Drive Tower', code: 'MD-1', client: 'Navi Realty',
    contract_value: 10000000, estimate: 8000000, status: 'active', started_on: '', due_on: '', notes: '',
    created_at: new Date().toISOString(),
  }]))
  localStorage.setItem('pl_corp_active', id)
})
await p.goto(`${B}/operations`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)

console.log('\n── LABOUR IS ITS OWN TAB ──')
const tabs = (await p.locator('#main-content button[aria-pressed]').allInnerTexts()).map((t) => t.trim().toUpperCase())
ok('there is a Labour tab', tabs.some((t) => t.includes('LABOUR')), tabs.join(' | '))
// It is not payroll. Payroll is a named person on a salary; this is fourteen
// masons on Tuesday, and the two must not be the same screen.
ok('and Payroll is still separate', tabs.some((t) => t.includes('PAYROLL')))
await outerTab('Labour')
const labour = await main()
ok('it opens on the muster roll', /Record a day’s muster|Record a day's muster/.test(labour), labour.slice(0, 300))
ok('with a contractors view beside it', (await p.locator('#main-content [role="tab"]', { hasText: 'Contractors' }).count()) === 1)
ok('nobody is asked to name a labourer',
  (await p.locator('#main-content input[aria-label="Headcount"]').count()) === 1 &&
  !/employee name/i.test(labour))

console.log('\n── A DAY’S MUSTER ──')
const muster = async (o) => {
  await p.locator('input[aria-label="Muster date"]').fill(o.date)
  await p.locator('select[aria-label="Trade"]').selectOption(o.trade)
  await p.locator('input[aria-label="Headcount"]').fill(String(o.heads))
  await p.locator('input[aria-label="Day rate"]').fill(String(o.rate))
  await p.locator('input[aria-label="Overtime hours"]').fill(String(o.otHours || ''))
  await p.locator('input[aria-label="Overtime rate"]').fill(String(o.otRate || ''))
  if (o.site) await p.locator('select[aria-label="Muster site"]').selectOption({ label: o.site })
  await p.locator('button', { hasText: /record muster/i }).click()
  await p.waitForTimeout(500)
}
await muster({ date: '2026-03-02', trade: 'mason', heads: 14, rate: 800, site: 'Marine Drive Tower' })
await muster({ date: '2026-03-02', trade: 'helper', heads: 22, rate: 500, otHours: 40, otRate: 90, site: 'Marine Drive Tower' })
const rows = await ls('pl_corp_muster')
ok('both lines are stored', rows.length === 2, String(rows.length))
ok('scoped to the company', rows.every((r) => r.entity_id === 'ent-lab-1'))
ok('and booked to the site', rows.every((r) => r.project_id === 'site-md'))
ok('with whole people, not fractions', rows.every((r) => Number.isInteger(r.headcount)))
let text = await main()
// 14×800 + 22×500 + 40×90 = 25,800.
ok('the wage bill adds up', /25,800/.test(text), text.slice(0, 400))
ok('head-days are counted', /36/.test(text))
// The figure that quietly doubles while everyone watches the material rates.
ok('overtime is shown on its own', /3,600/.test(text), text.slice(0, 400))
ok('and as a share of the bill', /14%|13\.9%/.test(text), text.slice(0, 400))
ok('trades are broken out', /Mason/.test(text) && /Helper/.test(text))
ok('and the site is named', /Marine Drive Tower/.test(text))

// The date and trade stay put: a muster is entered a dozen lines at a time.
ok('the date is kept for the next line',
  (await p.locator('input[aria-label="Muster date"]').inputValue()) === '2026-03-02')
ok('and the headcount is cleared', (await p.locator('input[aria-label="Headcount"]').inputValue()) === '')

console.log('\n── A RUNNING ACCOUNT BILL IS CUMULATIVE ──')
await view('Contractors')
ok('there are no work orders yet', /No work orders yet/.test(await main()))
await p.locator('input[aria-label="Contractor"]').fill('Sharma Plastering')
await p.locator('input[aria-label="Order value"]').fill('2000000')
await p.locator('input[aria-label="Scope"]').fill('Internal plaster, all floors')
await p.locator('input[aria-label="Retention percent"]').fill('5')
await p.locator('input[aria-label="TDS percent"]').fill('1')
await p.locator('select[aria-label="Work order site"]').selectOption({ label: 'Marine Drive Tower' })
await p.locator('button', { hasText: /create work order/i }).click()
await p.waitForTimeout(600)
const orders = await ls('pl_corp_work_orders')
ok('the work order is stored', orders.length === 1, String(orders.length))
ok('with its retention and TDS', orders[0]?.retention_percent === 5 && orders[0]?.tds_percent === 1)
ok('and booked to the site', orders[0]?.project_id === 'site-md')

const raBill = async (o) => {
  await p.locator('button', { hasText: /RA bill/i }).first().click()
  await p.waitForTimeout(500)
  if (o.claimed) await p.locator('input[aria-label="Claimed to date"]').fill(String(o.claimed))
  await p.locator('input[aria-label="Certified to date"]').fill(String(o.certified))
  if (o.advance) await p.locator('input[aria-label="Advance recovered"]').fill(String(o.advance))
  await p.locator('button', { hasText: /record bill/i }).click()
  await p.waitForTimeout(650)
}
// The form has to say what it is asking for, because the whole trade writes
// bills this way and every other system asks for the month's amount.
await p.locator('button', { hasText: /RA bill/i }).first().click()
await p.waitForTimeout(500)
ok('the form asks for work done to date, not this bill’s amount',
  /to date/i.test(await main()) && /Already certified/i.test(await main()), (await main()).slice(0, 600))
await p.locator('button', { hasText: /^\s*Cancel\s*$/i }).first().click()
await p.waitForTimeout(400)

await raBill({ claimed: 500000, certified: 500000 })
await raBill({ claimed: 1300000, certified: 1200000 })
await raBill({ claimed: 1800000, certified: 1750000, advance: 100000 })
const raBills = await ls('pl_corp_ra_bills')
ok('three bills are stored', raBills.length === 3, String(raBills.length))
ok('and they are numbered in order', raBills.map((r) => r.number).sort().join(',') === '1,2,3')
text = await main()
// 17,50,000 to date, not 5,00,000 + 12,00,000 + 17,50,000.
ok('certified to date is the last figure, not the sum', /17,50,000/.test(text), text.slice(0, 900))
ok('and the sum of the three is nowhere on the page', !/34,50,000/.test(text))
// 12,00,000 less the 5,00,000 already certified.
ok('the second bill is worth the difference', /7,00,000/.test(text), text.slice(0, 900))
ok('the third likewise', /5,50,000/.test(text))
ok('retention is held, not lost', /87,500/.test(text), text.slice(0, 900))
ok('and the advance is recovered from the bill it was deducted in', /1,00,000/.test(text))
ok('how much of the order is done is stated', /87\.5%/.test(text), text.slice(0, 900))
ok('and work claimed but not certified is called out', /50,000 claimed and not yet certified/.test(text), text.slice(-700))

console.log('\n── THE THREE THINGS THAT GO WRONG ──')
await raBill({ claimed: 1800000, certified: 1600000 })
text = await main()
ok('a bill certifying less than the last is flagged', /certifies less than the last/i.test(text), text.slice(0, 1200))
await raBill({ claimed: 1700000, certified: 2500000 })
text = await main()
ok('certifying above the claim is flagged', /certified above the claim/i.test(text), text.slice(0, 1400))
ok('and running past the order value is too', /past the order value/i.test(text))
ok('with a count of what needs a second look', /to check|needs a second look|need a second look/i.test(text))

console.log('\n── RETENTION IS RELEASED IN TWO PIECES, NOT FORGOTTEN ──')
// It used to come back in one lump whenever somebody pressed a button. It does
// not work that way: half at completion and half when the defect liability
// period runs out, so there are two buttons and releasing the first is not
// releasing the second. `retentionui.mjs` covers the dates and the states; this
// is the half that belongs beside the bills.
const heldBefore = await main()
ok('retention is shown as held', /Retention held/i.test(heldBefore))
ok('and a release schedule is shown with it', /retention release/i.test(heldBefore), heldBefore.slice(0, 600))
const accrued = Number((await ls('pl_corp_work_orders'))[0]?.retention_released)
await p.locator('button[aria-label="Release on completion retention for Sharma Plastering"]').click()
await p.waitForTimeout(700)
const afterFirst = Number((await ls('pl_corp_work_orders'))[0]?.retention_released)
ok('releasing the first half is recorded on the order', afterFirst > accrued, String(afterFirst))
ok('and that button is gone',
  (await p.locator('button[aria-label="Release on completion retention for Sharma Plastering"]').count()) === 0)
// The point of the change: the rest is still held.
ok('but the defects half is still there',
  (await p.locator('button[aria-label="Release after defect liability retention for Sharma Plastering"]').count()) === 1)
await p.locator('button[aria-label="Release after defect liability retention for Sharma Plastering"]').click()
await p.waitForTimeout(700)
ok('and releasing that one clears the rest',
  Number((await ls('pl_corp_work_orders'))[0]?.retention_released) > afterFirst,
  String((await ls('pl_corp_work_orders'))[0]?.retention_released))
ok('with nothing left to release',
  (await p.locator('button[aria-label^="Release "]').count()) === 0)

console.log('\n── WHAT IS ACTUALLY BUILT ──')
await outerTab('Projects')
await view('Progress')
let prog = await main()
// Without a priced schedule there is no comparison to make, and an invented
// one would be worse than none.
ok('with no schedule it says why there is no comparison',
  /No priced schedule/.test(prog), prog.slice(0, 500))
const addItem = async (o) => {
  await p.locator('select[aria-label="Work stage"]').selectOption(o.stage)
  await p.locator('input[aria-label="Item code"]').fill(o.code)
  await p.locator('input[aria-label="Item unit"]').fill(o.unit)
  await p.locator('input[aria-label="Item description"]').fill(o.description)
  await p.locator('input[aria-label="Planned quantity"]').fill(String(o.qty))
  await p.locator('input[aria-label="Item rate"]').fill(String(o.rate))
  await p.locator('button', { hasText: /add item/i }).click()
  await p.waitForTimeout(500)
}
await addItem({ stage: 'earthwork', code: 'e-1', unit: 'cum', description: 'Excavation', qty: 800, rate: 250 })
await addItem({ stage: 'structure', code: 's-1', unit: 'cum', description: 'RCC framed structure', qty: 600, rate: 6500 })
await addItem({ stage: 'finishes', code: 'f-1', unit: 'sqft', description: 'Vitrified flooring', qty: 20000, rate: 120 })
const workItems = await ls('pl_corp_work_items')
ok('three items are scheduled', workItems.length === 3, String(workItems.length))
ok('codes are upper-cased the way a drawing writes them',
  workItems.every((i) => i.code === i.code.toUpperCase()), workItems.map((i) => i.code).join(','))
prog = await main()
// Ordering by stage rather than alphabetically is what lets the list read like
// a building going up.
ok('stages run in build order',
  prog.indexOf('Earthwork') < prog.indexOf('RCC & structure') &&
  prog.indexOf('RCC & structure') < prog.indexOf('Flooring'),
  prog.slice(0, 400))

const measure = async (label, qty) => {
  await p.locator('select[aria-label="Measured item"]').selectOption({ label })
  await p.locator('input[aria-label="Measured quantity"]').fill(String(qty))
  await p.locator('button', { hasText: /^\s*Record\s*$/i }).first().click()
  await p.waitForTimeout(550)
}
await measure('E-1 · Excavation', 800)
prog = await main()
ok('the finished item reads 100%', /100%/.test(prog), prog.slice(0, 700))
// One of three items is done, so by count this is 33%. By value it is 3.1%,
// because excavation is cheap and the structure and the flooring are not — and
// on a construction schedule the expensive half always comes last.
ok('one item of three is complete', /1\/3/.test(prog), prog.slice(0, 600))
ok('yet progress reads 3.1%, because it is weighted by value',
  /3\.1%/.test(prog) && !/33\.3%/.test(prog), prog.slice(0, 800))

await measure('S-1 · RCC framed structure', 300)
prog = await main()
ok('a half-built item reads 50%', /50%/.test(prog), prog.slice(0, 900))
ok('and the total moves with the value, not the count', /33\.1%/.test(prog), prog.slice(0, 800))

console.log('\n── BUILT AGAINST SPENT ──')
// The comparison the whole view exists for. The ledger says the budget is
// going; the site says how much of the building there is.
prog = await main()
ok('both bars are shown', /Of the building/.test(prog) && /Of the budget/.test(prog), prog.slice(0, 600))
ok('and the verdict is in words, not just a number',
  /more of the budget is gone|more of the building is done|keeping pace/.test(prog), prog.slice(0, 800))
ok('with a forecast, labelled as a projection',
  /A projection, not a figure/.test(prog), prog.slice(0, 1200))

console.log('\n── LABOUR REACHES THE JOB ──')
await view('Costs')
const costs = await main()
ok('labour is a column of its own', /labour/i.test(costs), costs.slice(0, 500))
ok('and subcontractors another', /contractors/i.test(costs), costs.slice(0, 500))
ok('the muster reaches the job', /25,800/.test(costs), costs.slice(0, 900))
// Certified, not paid: retention and TDS change when money leaves, not whether
// the work was done.
ok('the contractor is costed at what was certified, not what was paid',
  /25,00,000/.test(costs), costs.slice(0, 900))

console.log('\n── FINDING IT ──')
// A site engineer looking for the muster types "muster", not "operations".
await p.locator('body').click({ position: { x: 5, y: 5 } })
await p.keyboard.press('Control+k')
await p.locator('[role="dialog"] input').first().waitFor({ state: 'visible' })
for (const word of ['muster', 'mason', 'retention', 'subcontractor', 'progress']) {
  await p.locator('[role="dialog"] input').first().fill(word)
  await p.waitForTimeout(350)
  ok(`the palette finds Operations by the word ${word}`,
    /Operations/.test(await p.locator('[role="dialog"]').innerText()))
}
await p.keyboard.press('Escape')
await p.waitForTimeout(300)

console.log('\n── THE BOOKS LINE STILL HOLDS ──')
await p.evaluate(() => localStorage.setItem('pl_corp_active', '__personal__'))
await p.goto(`${B}/operations`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
const personal = await main()
ok('in personal books the page says these belong to a company', /personal books/i.test(personal), personal.slice(0, 300))
ok('and no muster is shown', !/Sharma Plastering/.test(personal) && !/Mason/.test(personal))

console.log('\n── NOTHING BROKE ──')
ok('no page errors anywhere in the run', errs.length === 0, errs.slice(0, 3).join(' / '))

console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
if (fail) process.exitCode = 1
