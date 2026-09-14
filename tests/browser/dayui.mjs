// A day on a site, entered on a phone.
//
// Driven at 390px because that is the case this page is for, not a width the
// desktop layout also survives at. A supervisor is standing at a gate with one
// hand free; if the controls are small or the Save button is three cards down,
// the muster does not get kept and every report built on it is empty.
//
// The assertion that matters is the last one: saving twice must not double a
// day's wages. A bad signal and an impatient thumb is the ordinary case.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, serviceWorkers: 'block' })
const p = await ctx.newPage(); p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 160)) })
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('ERR_FAILED') && !t.includes('404')) errs.push('CONSOLE ' + t.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
p.on('dialog', (d) => d.accept())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const ls = (k) => p.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), k)
const live = async (k) => (await ls(k)).filter((r) => !r.deleted_at)
const main = () => p.locator('#main-content').innerText()
const saveDay = () => p.locator('button', { hasText: 'Save the day' }).first()
const ENT = 'ent-day-1', SITE = 'site-day-1'

await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(({ ent, site }) => {
  localStorage.clear()
  const born = new Date(); born.setFullYear(born.getFullYear() - 1)
  for (const k of ['pl_properties', 'pl_expenses', 'pl_income', 'pl_documents']) localStorage.setItem(k, '[]')
  localStorage.setItem('pl_corp_entities', JSON.stringify([
    { id: ent, name: 'Navi Builders Pvt Ltd', currency: 'INR', fy_start_month: 4, created_at: born.toISOString() },
  ]))
  localStorage.setItem('pl_corp_members', JSON.stringify([
    { id: 'm1', entity_id: ent, user_id: 'local-user', email: '', role: 'owner', department_id: null, created_at: new Date().toISOString() },
  ]))
  localStorage.setItem('pl_corp_projects', JSON.stringify([
    { id: site, entity_id: ent, name: 'Marine Drive Tower', code: 'MD-1', client: '', site_address: '',
      contract_value: 0, estimate: 0, started_on: '', due_on: '', status: 'active',
      department_id: null, notes: '', created_at: born.toISOString() },
  ]))
  localStorage.setItem('pl_corp_plant', JSON.stringify([
    { id: 'plant-day-1', entity_id: ent, project_id: site, name: 'Tower crane', kind: 'crane',
      ownership: 'hired', registration: 'TC-01', vendor: '', hire_rate: 285000, hire_basis: 'monthly',
      minimum_hours: 0, hired_from: '', hired_to: '', fuel_included: false, operator_included: true,
      purchase_value: 0, purchased_on: '', useful_life_years: 8, salvage_value: 0,
      status: 'active', note: '', created_at: born.toISOString() },
  ]))
  localStorage.setItem('pl_corp_muster', '[]')
  localStorage.setItem('pl_corp_plant_logs', '[]')
  localStorage.setItem('pl_corp_active', ent)
}, { ent: ENT, site: SITE })

console.log('\n── IT IS IN THE SIDE BAR, AND IT OPENS ──')
await p.goto(`${B}/day`, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
let t = await main()
ok('the page is there', /day sheet/i.test(t), t.slice(0, 200).replace(/\n/g, ' | '))
ok('on the right site', /Marine Drive Tower/.test(t))
ok('with the two trades a site starts with', /Mason/.test(t) && /Helper/.test(t), t.slice(0, 500).replace(/\n/g, ' | '))
ok('and the machine parked on it', /Tower crane/.test(t))
ok('it does not claim the day has been started', !/already started/i.test(t))

console.log('\n── IT FITS A PHONE, WHICH IS THE WHOLE POINT ──')
const fit = await p.evaluate(() => {
  const de = document.documentElement
  const controls = [...document.querySelectorAll('#main-content button, #main-content input, #main-content select')]
  const small = controls
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 40 })
    .map((el) => (el.getAttribute('aria-label') || el.tagName) + ' ' + Math.round(el.getBoundingClientRect().height))
  return { overflow: de.scrollWidth - de.clientWidth, controls: controls.length, small }
})
ok('nothing scrolls sideways', fit.overflow <= 2, `${fit.overflow}px`)
ok('there are controls to press', fit.controls >= 8, `${fit.controls}`)
// 40px is the floor the rest of the app is held to; a stepper you have to aim
// at is a stepper nobody uses twice.
ok('and every one of them is thumb-sized', fit.small.length === 0, fit.small.join(', '))
// The button you came to press is pinned, not below three cards of scrolling.
const pinned = await p.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((el) => /save the day/i.test(el.textContent || ''))
  if (!b) return null
  const r = b.getBoundingClientRect()
  return { visible: r.top >= 0 && r.bottom <= window.innerHeight + 1, top: Math.round(r.top) }
})
ok('the save button is on screen without scrolling', pinned?.visible, JSON.stringify(pinned))

console.log('\n── A DAY, ENTERED WITH A THUMB ──')
const plus = (label) => p.locator(`button[aria-label="One more ${label}"]`).first()
for (let i = 0; i < 12; i++) await plus('Mason headcount').click()
for (let i = 0; i < 8; i++) await plus('Helper / unskilled headcount').click()
await p.waitForTimeout(300)
ok('the masons went up', (await p.locator('input[aria-label="Mason headcount"]').inputValue()) === '12',
  await p.locator('input[aria-label="Mason headcount"]').inputValue())
await p.locator('button[aria-label="One fewer Mason headcount"]').first().click()
ok('and back down again', (await p.locator('input[aria-label="Mason headcount"]').inputValue()) === '11')
// The rate field only appears once somebody is on site: an empty trade has no
// rate to ask about.
await p.locator('input[aria-label="Mason rate"]').first().fill('850')
await p.locator('input[aria-label="Helper / unskilled rate"]').first().fill('550')
for (let i = 0; i < 15; i++) await plus('Tower crane worked hours').click()
await p.waitForTimeout(300)
t = await main()
ok('the running total counts the heads', /19 on site/.test(t), t.slice(-300).replace(/\n/g, ' | '))
ok('and the wages', /13,750/.test(t), t.slice(-300).replace(/\n/g, ' | '))

console.log('\n── ONE SAVE WRITES THE LOT ──')
await saveDay().click()
await p.waitForTimeout(1200)
const muster = await live('pl_corp_muster')
const logs = await live('pl_corp_plant_logs')
ok('two muster lines', muster.length === 2, JSON.stringify(muster.map((m) => [m.trade, m.headcount])))
ok('with the headcounts as entered',
  muster.find((m) => m.trade === 'mason')?.headcount === 11 && muster.find((m) => m.trade === 'helper')?.headcount === 8,
  JSON.stringify(muster.map((m) => [m.trade, m.headcount])))
ok('booked to the site', muster.every((m) => m.project_id === SITE))
ok('and one log sheet', logs.length === 1, String(logs.length))
ok('with the hours on it', logs[0]?.working_hours === 7.5, String(logs[0]?.working_hours))
// A machine nobody touched is a day with no sheet, which the plant report
// counts. Writing a row of zeroes would hide it.
ok('nothing was written for hours nobody worked', logs.every((l) => l.working_hours > 0))

console.log('\n── AND SAVING AGAIN DOES NOT DOUBLE THE DAY ──')
// The failure this page exists to prevent: a bad signal, an impatient thumb.
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(900)
t = await main()
ok('re-opening says the day is under way', /already started/i.test(t), t.slice(0, 300).replace(/\n/g, ' | '))
ok('with what was entered still in the boxes',
  (await p.locator('input[aria-label="Mason headcount"]').inputValue()) === '11')
await saveDay().click()
await p.waitForTimeout(1200)
await saveDay().click()
await p.waitForTimeout(1200)
const after = await live('pl_corp_muster')
ok('still two muster lines after two more saves', after.length === 2,
  JSON.stringify(after.map((m) => [m.trade, m.headcount])))
ok('still one log sheet', (await live('pl_corp_plant_logs')).length === 1)
ok('and the wage bill has not moved',
  after.reduce((s, m) => s + m.headcount * m.rate, 0) === 11 * 850 + 8 * 550,
  String(after.reduce((s, m) => s + m.headcount * m.rate, 0)))

console.log('\n── A LINE TAKEN BACK TO NOTHING GOES AWAY ──')
for (let i = 0; i < 8; i++) await p.locator('button[aria-label="One fewer Helper / unskilled headcount"]').first().click()
await p.waitForTimeout(300)
await saveDay().click()
await p.waitForTimeout(1200)
const left = await live('pl_corp_muster')
ok('the helpers are off the sheet', left.length === 1 && left[0].trade === 'mason',
  JSON.stringify(left.map((m) => [m.trade, m.headcount])))
// Removed, not zeroed: "0 helpers" in a day's report is not something anybody
// writes on a muster.
ok('and not left as a zero', !left.some((m) => m.headcount === 0))
const tombstoned = (await ls('pl_corp_muster')).filter((m) => m.deleted_at)
ok('it is tombstoned rather than vanished, so other devices hear about it',
  tombstoned.length === 1, String(tombstoned.length))

console.log('\n── A TRADE THE SITE HAS NOT USED CAN BE ADDED ──')
await p.locator('select[aria-label="Add a trade"]').first().selectOption('carpenter')
await p.waitForTimeout(400)
ok('the carpenter appears', /Carpenter/.test(await main()))
for (let i = 0; i < 4; i++) await plus('Carpenter / shuttering headcount').click()
await p.locator('input[aria-label="Carpenter / shuttering rate"]').first().fill('900')
await saveDay().click()
await p.waitForTimeout(1200)
ok('and is recorded', (await live('pl_corp_muster')).some((m) => m.trade === 'carpenter' && m.headcount === 4))
// Next time the sheet opens, the site's own trades are the ones offered.
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(900)
t = await main()
ok('the sheet remembers which trades this site uses', /Carpenter/.test(t))
ok('and what they were paid', (await p.locator('input[aria-label="Carpenter / shuttering rate"]').inputValue()) === '900')

for (const e of errs) ok(e, false)
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
