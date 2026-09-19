// Plant on screen, and the one figure a hire bill never contains.
//
// A machine hired at ₹12,000 a day that works three hours of eight does not
// cost ₹1,500 an hour. The assertions worth reading are the ones that put the
// nominal rate and the real one side by side, and the ones about days billed
// with no log sheet written against them.
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
  const id = 'ent-plant-1'
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

console.log('\n── PLANT IS ITS OWN TAB ──')
const tabs = (await p.locator('#main-content button[aria-pressed]').allInnerTexts()).map((t) => t.trim().toUpperCase())
ok('there is a Plant tab', tabs.some((t) => t.includes('PLANT')), tabs.join(' | '))
await outerTab('Plant')
const opened = await main()
ok('it opens on the yard', /Add a machine/.test(opened), opened.slice(0, 300))
ok('with a log sheets view beside it', (await p.locator('#main-content [role="tab"]', { hasText: 'Log sheets' }).count()) === 1)
ok('and nothing in it yet', /No plant yet/.test(opened))

console.log('\n── A HIRED MACHINE ──')
await p.locator('select[aria-label="Plant kind"]').selectOption('excavator')
await p.waitForTimeout(250)
// The basis follows the kind, because a tipper is hired by the trip and a
// crane by the month, and nobody should have to know which dropdown to fix.
ok('the charging basis follows the kind',
  (await p.locator('select[aria-label="Hire basis"]').inputValue()) === 'daily')
await p.locator('select[aria-label="Plant kind"]').selectOption('tipper')
await p.waitForTimeout(250)
ok('a tipper is hired by the trip', (await p.locator('select[aria-label="Hire basis"]').inputValue()) === 'trip')
await p.locator('select[aria-label="Plant kind"]').selectOption('excavator')
await p.waitForTimeout(250)

await p.locator('input[aria-label="Plant name"]').fill('JCB 3DX')
await p.locator('input[aria-label="Registration"]').fill('mh-04-ab-1234')
await p.locator('input[aria-label="Hire rate"]').fill('12000')
await p.locator('input[aria-label="Plant vendor"]').fill('Konkan Plant')
await p.locator('input[aria-label="Hired from"]').fill('2026-03-01')
await p.locator('input[aria-label="Hired to"]').fill('2026-03-10')
await p.locator('button', { hasText: /add machine/i }).click()
await p.waitForTimeout(600)
const plant = await ls('pl_corp_plant')
ok('the machine is stored', plant.length === 1, String(plant.length))
ok('scoped to the company', plant[0]?.entity_id === 'ent-plant-1')
// How two identical JCBs are told apart, and what a log sheet is headed with.
ok('the registration is upper-cased', plant[0]?.registration === 'MH-04-AB-1234', plant[0]?.registration)
ok('and it is hired, not owned', plant[0]?.ownership === 'hired')
let text = await main()
ok('it is listed with its rate', /JCB 3DX/.test(text) && /12,000/.test(text), text.slice(0, 600))
// Ten days on hire and not one log sheet.
ok('and flagged as never logged', /never logged/i.test(text), text.slice(0, 700))
ok('with what that cost for nothing recorded', /1,20,000/.test(text), text.slice(0, 900))

console.log('\n── THE LOG SHEETS ──')
await view('Log sheets')
const log = async (o) => {
  await p.locator('select[aria-label="Machine"]').selectOption({ label: 'JCB 3DX · MH-04-AB-1234' })
  await p.locator('input[aria-label="Log date"]').fill(o.date)
  if (o.site) await p.locator('select[aria-label="Log site"]').selectOption({ label: o.site })
  await p.locator('input[aria-label="Working hours"]').fill(String(o.worked || ''))
  await p.locator('input[aria-label="Idle hours"]').fill(String(o.idle || ''))
  await p.locator('input[aria-label="Breakdown hours"]').fill(String(o.broken || ''))
  await p.locator('input[aria-label="Fuel cost"]').fill(String(o.fuel || ''))
  await p.locator('button', { hasText: /record log sheet/i }).click()
  await p.waitForTimeout(500)
}
await log({ date: '2026-03-01', site: 'Marine Drive Tower', worked: 6, idle: 2, fuel: 3600 })
await log({ date: '2026-03-02', site: 'Marine Drive Tower', worked: 4, idle: 4, fuel: 2400 })
await log({ date: '2026-03-03', site: 'Marine Drive Tower', worked: 2, idle: 6, fuel: 1200 })
await log({ date: '2026-03-04', site: 'Marine Drive Tower', broken: 8 })
await log({ date: '2026-03-05', site: 'Marine Drive Tower', worked: 8, fuel: 4800 })
const logs = await ls('pl_corp_plant_logs')
ok('five log sheets are stored', logs.length === 5, String(logs.length))
ok('idle and breakdown are stored apart',
  logs.some((l) => l.idle_hours > 0 && l.breakdown_hours === 0) &&
  logs.some((l) => l.breakdown_hours > 0 && l.idle_hours === 0))
ok('and each is booked to the site', logs.every((l) => l.project_id === 'site-md'))
text = await main()
ok('the log book lists them', /2026-03-04/.test(text), text.slice(-800))
// The machine stays selected: a log book is filled in a run.
ok('the machine stays picked for the next sheet',
  (await p.locator('select[aria-label="Machine"]').inputValue()) === plant[0].id)

console.log('\n── A DAY RATE IS NOT AN HOURLY COST ──')
await view('The yard')
text = await main()
// 20 worked, 12 idle, 8 broken of 40 hours on site.
ok('utilisation is what it was doing while it was there', /50%/.test(text), text.slice(0, 900))
// ₹1,20,000 hire + ₹12,000 diesel over 20 working hours.
ok('an hour of work costs far more than the day rate implies',
  /6,600/.test(text), text.slice(0, 1200))
ok('and the nominal rate is printed beside it, because the gap is the point',
  /the rate is/i.test(text) && /12,000/.test(text), text.slice(0, 1200))
ok('five days billed with no log sheet against them', /5 days on hire with no log sheet/.test(text), text.slice(0, 1200))
ok('worth this much', /60,000/.test(text), text.slice(0, 1200))

console.log('\n── WHAT STANDING STILL COST ──')
// Idle means there was no work for it. Breakdown means it could not work.
// Different people are answerable, and one figure protects both.
ok('idle and breakdown are costed apart',
  /What standing still cost/.test(text) && /Idle cost/i.test(text) && /Breakdown cost/i.test(text),
  text.slice(0, 900))
ok('and the page says why they are different',
  /could not work/i.test(text) && /no work for it/i.test(text), text.slice(0, 900))

console.log('\n── OWN OR HIRE ──')
// Answered per working hour, because comparing day rates is how a company ends
// up owning plant it cannot keep busy.
await p.locator('input[aria-label="Market day rate for JCB 3DX"]').fill('10000')
await p.waitForTimeout(500)
text = await main()
ok('a market rate gives a verdict', /costs .* more than hiring|costs .* less than hiring/.test(text), text.slice(0, 1400))

console.log('\n── AN OWNED MACHINE IS NOT FREE ──')
await p.locator('select[aria-label="Ownership"]').selectOption('owned')
await p.waitForTimeout(300)
// A hire rate is meaningless for a machine you own, and a purchase price is
// meaningless for one you rent.
ok('owning asks what it cost, not what it rents for',
  (await p.locator('input[aria-label="Purchase value"]').count()) === 1 &&
  (await p.locator('input[aria-label="Hire rate"]').count()) === 0)
await p.locator('select[aria-label="Plant kind"]').selectOption('mixer')
await p.locator('input[aria-label="Plant name"]').fill('Site mixer')
await p.locator('input[aria-label="Purchase value"]').fill('900000')
await p.locator('input[aria-label="Salvage value"]').fill('100000')
await p.locator('input[aria-label="Useful life"]').fill('8')
await p.locator('input[aria-label="Hired from"]').fill('2026-03-01')
await p.locator('button', { hasText: /add machine/i }).click()
await p.waitForTimeout(600)
const owned = (await ls('pl_corp_plant')).find((x) => x.ownership === 'owned')
ok('the owned machine is stored', Boolean(owned), String((await ls('pl_corp_plant')).length))
ok('with its purchase value and life', Number(owned?.purchase_value) === 900000 && Number(owned?.useful_life_years) === 8)
text = await main()
// (9,00,000 − 1,00,000) / (8 × 365) = ₹273.97 a day.
ok('and it costs its depreciation every day it exists',
  /273\.97|274/.test(text) && /depreciation/i.test(text), text.slice(0, 1000))

console.log('\n── PLANT REACHES THE JOB ──')
await outerTab('Projects')
await view('Costs')
const costs = await main()
ok('plant is a column of its own', /plant/i.test(costs), costs.slice(0, 700))
// ₹1,20,000 hire and ₹12,000 diesel, all of it worked on one site.
ok('the machine’s cost reaches the site it worked on', /1,32,000/.test(costs), costs.slice(0, 1200))

console.log('\n── FINDING IT ──')
await p.locator('body').click({ position: { x: 5, y: 5 } })
await p.keyboard.press('Control+k')
await p.locator('[role="dialog"] input').first().waitFor({ state: 'visible' })
for (const word of ['jcb', 'excavator', 'diesel', 'utilisation', 'breakdown']) {
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
ok('and no plant is shown', !/JCB 3DX/.test(personal))

console.log('\n── NOTHING BROKE ──')
ok('no page errors anywhere in the run', errs.length === 0, errs.slice(0, 3).join(' / '))

console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
if (fail) process.exitCode = 1
