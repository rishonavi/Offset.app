// Flats and shops on screen: what is unsold, what is sold, and what the buyers
// owe for it.
//
// The assertion worth reading is the one where the building moves and the
// demand moves with it. "40% on completion of the structure" is a fact about
// the structure, so finishing it makes the money owed — with nobody typing a
// date and nobody remembering to send a letter.
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
const ls = (k) => p.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), k)
const main = () => p.locator('#main-content').innerText()
const OUTER = ['Projects', 'Materials', 'Labour', 'Plant', 'Sales', 'Advances', 'Payroll']
const outerTab = async (name) => {
  await chose(p.locator('#main-content button[aria-pressed]').nth(OUTER.indexOf(name)))
}
const view = async (label) => {
  await chose(p.locator('#main-content [role="tab"]', { hasText: label }).first())
}

await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(() => {
  localStorage.clear()
  const id = 'ent-sales-1'
  const now = new Date().toISOString()
  const born = new Date(); born.setFullYear(born.getFullYear() - 1)
  localStorage.setItem('pl_properties', '[]')
  for (const k of ['pl_expenses', 'pl_income', 'pl_documents']) localStorage.setItem(k, '[]')
  localStorage.setItem('pl_corp_entities', JSON.stringify([
    { id, name: 'Navi Builders Pvt Ltd', registration: '', gstin: '', currency: 'INR', fyStartMonth: 4, created_at: born.toISOString() },
  ]))
  localStorage.setItem('pl_corp_members', JSON.stringify([
    { id: 'm1', entity_id: id, user_id: 'local-user', email: '', role: 'owner', department_id: null, created_at: now },
  ]))
  localStorage.setItem('pl_corp_projects', JSON.stringify([{
    id: 'site-md', entity_id: id, name: 'Marine Drive Tower', code: 'MD-1', client: '',
    contract_value: 0, estimate: 0, status: 'active', started_on: '', due_on: '', notes: '', created_at: now,
  }]))
  // A schedule of work, with the foundation done and the structure half up.
  localStorage.setItem('pl_corp_work_items', JSON.stringify([
    { id: 'w1', entity_id: id, project_id: 'site-md', code: 'E-1', description: 'Excavation', stage: 'earthwork', unit: 'cum', planned_qty: 800, rate: 250, created_at: now },
    { id: 'w2', entity_id: id, project_id: 'site-md', code: 'S-1', description: 'RCC', stage: 'structure', unit: 'cum', planned_qty: 600, rate: 6500, created_at: now },
  ]))
  localStorage.setItem('pl_corp_measurements', JSON.stringify([
    { id: 'v1', entity_id: id, work_item_id: 'w1', project_id: 'site-md', date: '2026-02-01', qty: 800, created_at: now },
    { id: 'v2', entity_id: id, work_item_id: 'w2', project_id: 'site-md', date: '2026-05-01', qty: 300, created_at: now },
  ]))
  localStorage.setItem('pl_corp_active', id)
})
await p.goto(`${B}/operations`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)

console.log('\n── SALES IS ITS OWN TAB ──')
const tabs = (await p.locator('#main-content button[aria-pressed]').allInnerTexts()).map((t) => t.trim().toUpperCase())
ok('there is a Sales tab', tabs.some((t) => t.includes('SALES')), tabs.join(' | '))
await outerTab('Sales')
const opened = await main()
ok('it opens on the stock list', /Add a unit/.test(opened), opened.slice(0, 300))
ok('with a collections view beside it', (await p.locator('#main-content [role="tab"]', { hasText: 'Collections' }).count()) === 1)

console.log('\n── THE STOCK LIST ──')
const addUnit = async (u) => {
  await p.locator('input[aria-label="Unit name"]').fill(u.name)
  await p.locator('select[aria-label="Unit kind"]').selectOption(u.kind || 'flat')
  if (u.tower) await p.locator('input[aria-label="Tower"]').fill(u.tower)
  if (u.floor) await p.locator('input[aria-label="Floor"]').fill(String(u.floor))
  if (u.config) await p.locator('input[aria-label="Configuration"]').fill(u.config)
  await p.locator('input[aria-label="Carpet area"]').fill(String(u.carpet || ''))
  if (u.superArea) await p.locator('input[aria-label="Super built-up area"]').fill(String(u.superArea))
  await p.locator('select[aria-label="Area basis"]').selectOption(u.basis || 'carpet')
  await p.locator('input[aria-label="Rate per area"]').fill(String(u.rate || ''))
  if (u.charges) await p.locator('input[aria-label="Other charges"]').fill(String(u.charges))
  await p.locator('select[aria-label="Unit status"]').selectOption(u.status || 'available')
  await p.locator('button', { hasText: /add unit/i }).click()
  await p.waitForTimeout(550)
}
await addUnit({ name: 'A-1204', tower: 'A', floor: 12, config: '3BHK', carpet: 1100, rate: 10000, charges: 500000, status: 'booked' })
await addUnit({ name: 'A-1201', tower: 'A', floor: 12, config: '2BHK', carpet: 900, rate: 10000, status: 'available' })
await addUnit({ name: 'A-1202', tower: 'A', floor: 12, config: '2BHK', carpet: 900, rate: 10000, status: 'held' })
await addUnit({ name: 'S-01', kind: 'shop', carpet: 400, rate: 25000, status: 'registered' })
const units = await ls('pl_corp_units')
ok('four units are stored', units.length === 4, String(units.length))
ok('scoped to the company', units.every((u) => u.entity_id === 'ent-sales-1'))
ok('and to the site', units.every((u) => u.project_id === 'site-md'))
ok('a price comes off the rate and the area', Number(units[0]?.agreed_price) === 11000000, String(units[0]?.agreed_price))
let text = await main()
ok('two are sold', /SOLD\n2/.test(text) || /sold[\s\S]{0,20}2/i.test(text), text.slice(0, 600))
// Available and held back are both unsold and are not the same thing.
ok('one is available and one is held back, counted apart',
  /available/i.test(text) && /held back/i.test(text), text.slice(0, 600))
ok('the shop is listed as a shop', /Shop/.test(text), text.slice(0, 1400))
// A developer counts stock in square feet as often as in flats.
ok('area is counted as well as flats', /1500 sq ft sold/.test(text) && /900 sq ft still available/.test(text), text.slice(-500))

console.log('\n── THREE AREAS DESCRIBE THE SAME FLAT ──')
await addUnit({ name: 'B-101', tower: 'B', carpet: 900, superArea: 1200, basis: 'superBuiltUp', rate: 10000, status: 'available' })
const superUnit = (await ls('pl_corp_units')).find((u) => u.name === 'B-101')
// Carpet is what you can walk on; super built-up adds a share of the lobby and
// can be 30% more. A rate means nothing without saying which.
ok('a super built-up price is not a carpet price',
  Number(superUnit?.agreed_price) === 12000000, String(superUnit?.agreed_price))

console.log('\n── SELLING AGAINST BUILDING ──')
text = await main()
// A tower sold ahead of what is built is holding other people's money; built
// ahead of sold is funding a building nobody bought.
ok('the two are put side by side', /Selling against building/.test(text), text.slice(0, 900))
ok('and the verdict is in words',
  /more is sold than built|more is built than sold|keeping pace/.test(text), text.slice(0, 1100))

console.log('\n── A PAYMENT PLAN TIED TO THE BUILDING ──')
await view('Collections')
let money = await main()
ok('nothing is owed before there is a plan', /agreed/i.test(money), money.slice(0, 400))
const instalment = async (i) => {
  await p.locator('input[aria-label="Instalment label"]').fill(i.label)
  if (i.percent) await p.locator('input[aria-label="Instalment percent"]').fill(String(i.percent))
  if (i.amount) await p.locator('input[aria-label="Instalment amount"]').fill(String(i.amount))
  await p.locator('select[aria-label="Instalment work stage"]').selectOption(i.stage || '')
  await p.waitForTimeout(250)
  if (i.stage) await p.locator('input[aria-label="Trigger at"]').fill(String(i.at || 100))
  else if (i.date) await p.locator('input[aria-label="Instalment date"]').fill(i.date)
  await p.locator('button', { hasText: /add instalment/i }).click()
  await p.waitForTimeout(550)
}
await p.locator('button', { hasText: /instalment/i }).first().click()
await p.waitForTimeout(450)
await instalment({ label: 'On booking', amount: 1000000, date: '2026-01-01' })
await instalment({ label: 'On foundation', percent: 15, stage: 'earthwork', at: 100 })
await instalment({ label: 'On structure', percent: 40, stage: 'structure', at: 100 })
const plan = await ls('pl_corp_plan_stages')
ok('three instalments are stored', plan.length === 3, String(plan.length))
ok('two of them name a stage of the building rather than a date',
  plan.filter((s) => s.work_stage).length === 2, JSON.stringify(plan.map((s) => s.work_stage)))
money = await main()
// Booking (10,00,000) plus foundation (15% of 1.1cr = 16,50,000). The structure
// money is not owed: half a structure is not a structure.
ok('only what the building has earned is demanded', /26,50,000/.test(money), money.slice(0, 900))
ok('the structure instalment is shown as not yet due', /not yet due/i.test(money), money.slice(0, 1600))
// Agreed, demanded, received and due are four figures routinely treated as one.
ok('agreed and demanded are separate figures',
  /agreed/i.test(money) && /demanded/i.test(money) && /due now/i.test(money), money.slice(0, 700))

console.log('\n── MONEY IN ──')
await p.locator('select[aria-label="Receipt unit"]').selectOption({ label: 'A-1204' })
await p.locator('input[aria-label="Receipt amount"]').fill('1600000')
await p.locator('button', { hasText: /record receipt/i }).click()
await p.waitForTimeout(700)
const receipts = await ls('pl_corp_receipts')
ok('the receipt is stored', receipts.length === 1, String(receipts.length))
money = await main()
ok('what came in is shown', /16,00,000/.test(money), money.slice(0, 700))
// The number a developer is asked for and usually cannot produce.
ok('and what has fallen due and is unpaid', /10,50,000/.test(money), money.slice(0, 900))
// Applied oldest-first, which is how a clerk does it.
ok('the booking instalment is settled first and the rest lands on the next',
  /6,00,000/.test(money), money.slice(0, 1800))

console.log('\n── THE BUILDING MOVES AND SO DOES THE DEMAND ──')
// Nobody types a date and nobody sends a letter: the structure finishes and
// 40% of the price becomes owed because the site says so.
await p.evaluate(() => {
  const list = JSON.parse(localStorage.getItem('pl_corp_measurements'))
  list.push({ id: 'v3', entity_id: 'ent-sales-1', work_item_id: 'w2', project_id: 'site-md', date: '2026-08-01', qty: 300, created_at: new Date().toISOString() })
  localStorage.setItem('pl_corp_measurements', JSON.stringify(list))
})
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(800)
await outerTab('Sales')
await view('Collections')
money = await main()
ok('finishing the structure makes its instalment fall due', /70,50,000/.test(money), money.slice(0, 900))
ok('so what is owed today jumps', /54,50,000/.test(money), money.slice(0, 900))
ok('without anybody typing a date', (await ls('pl_corp_plan_stages')).filter((s) => s.due_on).length === 1)

console.log('\n── A PLAN THAT WILL NOT COLLECT ITSELF ──')
await p.locator('button', { hasText: /instalment/i }).first().click()
await p.waitForTimeout(450)
await instalment({ label: 'On possession', amount: 1500000 })
money = await main()
// Every plan ends with "on possession", which names no stage and has no date.
ok('an instalment waiting on nothing is called out',
  /will never fall due|names no stage/i.test(money), money.slice(0, 1400))
ok('and it is not counted as owed', /70,50,000/.test(money), money.slice(0, 900))
// Nobody checks that a plan adds up, and the last instalment is where it shows.
ok('a plan short of the price says so', /short of the price/.test(money), money.slice(0, 1600))

console.log('\n── A CANCELLATION PUTS THE FLAT BACK ──')
await view('Inventory')
await p.locator('select[aria-label="Status of A-1204"]').selectOption('cancelled')
await p.waitForTimeout(700)
text = await main()
ok('the flat returns to stock rather than vanishing',
  (await ls('pl_corp_units')).find((u) => u.name === 'A-1204')?.status === 'cancelled')
ok('and the booking record survives it', (await ls('pl_corp_receipts')).length === 1)

console.log('\n── FINDING IT ──')
await p.locator('body').click({ position: { x: 5, y: 5 } })
await p.keyboard.press('Control+k')
await p.locator('[role="dialog"] input').first().waitFor({ state: 'visible' })
for (const word of ['flats', 'booking', 'collections', 'carpet', 'overdue']) {
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
ok('and no units are shown', !/A-1204/.test(personal))

console.log('\n── NOTHING BROKE ──')
ok('no page errors anywhere in the run', errs.length === 0, errs.slice(0, 3).join(' / '))

console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
if (fail) process.exitCode = 1
