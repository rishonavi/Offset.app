// Getting started on the dashboard, and the sample portfolio round trip.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
const p = await ctx.newPage(); p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 160)) })
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('ERR_FAILED') && !t.includes('404')) errs.push('CONSOLE ' + t.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
p.on('dialog', (d) => d.accept())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const ls = (k) => p.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), k)
const empty = () => p.evaluate(() => { localStorage.clear(); for (const k of ['pl_properties','pl_expenses','pl_income','pl_documents']) localStorage.setItem(k, '[]') })

console.log('\n── ON AN EMPTY INSTALL ──')
await p.goto(B, { waitUntil: 'domcontentloaded' }); await empty()
await p.goto(B, { waitUntil: 'networkidle' }); await p.waitForTimeout(700)
let t = await p.locator('#main-content').innerText()
ok('the dashboard offers a short list of what to do', /Getting started/i.test(t), t.slice(0, 200).replace(/\n/g, ' | '))
ok('nothing is ticked yet', /0 of 4 done/.test(t), t.match(/\d of \d done/)?.[0] || 'absent')
ok('it says what to do first', /Add your first asset/i.test(t))
ok('and offers a sample portfolio to look around with', await p.locator('button', { hasText: 'Load sample data' }).isVisible())

console.log('\n── LOADING THE SAMPLE PORTFOLIO ──')
await p.locator('button', { hasText: 'Load sample data' }).click()
await p.waitForTimeout(3000)
const props = await ls('pl_properties'), inc = await ls('pl_income'), exp = await ls('pl_expenses')
ok('assets appear', props.length >= 3, `${props.length}`)
ok('a year of income appears', inc.length >= 20, `${inc.length}`)
ok('and a year of costs', exp.length >= 20, `${exp.length}`)
ok('every row is tagged as sample', [...props, ...inc, ...exp].every((r) => r.is_sample === true))
t = await p.locator('#main-content').innerText()
ok('the dashboard now shows real numbers', /₹/.test(t) && !/0 of 4 done/.test(t), t.match(/\d of \d done/)?.[0] || 'checklist gone')
ok('the checklist is finished and gone', !/Getting started/i.test(t))

console.log('\n── REMOVING IT AGAIN ──')
await p.goto(`${B}/settings`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
const rm = p.locator('button', { hasText: 'Remove sample data' })
ok('Settings offers to remove it', await rm.isVisible())
await rm.click()
await p.waitForTimeout(3500)
ok('the assets are gone', (await ls('pl_properties')).length === 0, `${(await ls('pl_properties')).length}`)
ok('the income is gone', (await ls('pl_income')).length === 0, `${(await ls('pl_income')).length}`)
ok('the costs are gone', (await ls('pl_expenses')).length === 0, `${(await ls('pl_expenses')).length}`)
ok('and the offer disappears with it', !(await p.locator('#main-content').innerText()).includes('Remove sample data'))

console.log('\n── IT WILL NOT TOUCH REAL BOOKS ──')
await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(() => {
  localStorage.clear()
  localStorage.setItem('pl_properties', JSON.stringify([{ id: 'mine', name: 'My actual flat', type: 'Real Estate — Apartment / Flat', value: 100 }]))
  for (const k of ['pl_expenses','pl_income','pl_documents']) localStorage.setItem(k, '[]')
})
await p.goto(B, { waitUntil: 'networkidle' }); await p.waitForTimeout(700)
t = await p.locator('#main-content').innerText()
ok('the checklist knows the asset is there', /1 of 4 done/.test(t), t.match(/\d of \d done/)?.[0] || 'absent')
ok('and the sample offer is withdrawn once there is real data',
  (await p.locator('button', { hasText: 'Load sample data' }).count()) === 0)
ok('Settings offers no removal either',
  await (async () => { await p.goto(`${B}/settings`, { waitUntil: 'networkidle' }); await p.waitForTimeout(600)
    return !(await p.locator('#main-content').innerText()).includes('Remove sample data') })())

console.log('\n── DISMISSING IT ──')
await p.goto(B, { waitUntil: 'networkidle' }); await p.waitForTimeout(700)
await p.locator('button[aria-label="Hide getting started"]').click()
await p.waitForTimeout(500)
ok('it goes away when waved off', !(await p.locator('#main-content').innerText()).includes('Getting started'))
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(800)
ok('and stays away after a reload', !(await p.locator('#main-content').innerText()).includes('Getting started'))

console.log('\n── LAYOUT ──')
await p.evaluate(() => localStorage.removeItem('pl_onboarding_dismissed'))
await p.setViewportSize({ width: 390, height: 800 })
await p.goto(B, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
ok('no sideways scroll on a phone', overflow <= 2, `${overflow}px`)
const h1s = await p.locator('#main-content h1').count()
ok('the dashboard still has exactly one h1', h1s === 1, `${h1s}`)
console.log('\n── A COMPANY IS ASKED SOMETHING ELSE ──')
// A builder owns almost nothing it spends money on. "Everything hangs off an
// asset" is how somebody invents one, and four of this repo's own fixtures
// carry an invented asset called "Company Depot".
await p.setViewportSize({ width: 1440, height: 1000 })
const ENT = 'ent-onb-1'
await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate((ent) => {
  localStorage.clear()
  const born = new Date(); born.setFullYear(born.getFullYear() - 1)
  for (const k of ['pl_properties', 'pl_expenses', 'pl_income', 'pl_documents']) localStorage.setItem(k, '[]')
  localStorage.setItem('pl_corp_entities', JSON.stringify([
    { id: ent, name: 'Navi Builders Pvt Ltd', registration: '', gstin: '', currency: 'INR', fyStartMonth: 4, created_at: born.toISOString() },
  ]))
  localStorage.setItem('pl_corp_members', JSON.stringify([
    { id: 'm1', entity_id: ent, user_id: 'local-user', email: '', role: 'owner', department_id: null, created_at: new Date().toISOString() },
  ]))
  localStorage.setItem('pl_corp_projects', '[]')
  localStorage.setItem('pl_corp_active', ent)
}, ENT)
await p.goto(B, { waitUntil: 'networkidle' }); await p.waitForTimeout(900)
t = await p.locator('#main-content').innerText()
ok('the checklist is still offered', /Getting started/i.test(t), t.slice(0, 200).replace(/\n/g, ' | '))
ok('nothing is ticked', /0 of 4 done/.test(t), t.match(/\d of \d done/)?.[0] || 'absent')
ok('the first thing to do is a site', /Add your first site/i.test(t), t.slice(0, 400).replace(/\n/g, ' | '))
ok('and not an asset', !/Add your first asset/i.test(t), t.slice(0, 400).replace(/\n/g, ' | '))
// The sample is two flats, a car and a year of rent. Loading a landlord's
// portfolio into a construction company's ledger is the invented asset again,
// with a button on it.
ok('the landlord sample portfolio is not offered here',
  await p.locator('button', { hasText: 'Load sample data' }).count() === 0)

console.log('\n── AND TICKED BY THE SAME BOOKS ──')
await p.evaluate((ent) => {
  localStorage.setItem('pl_corp_projects', JSON.stringify([
    { id: 'site-onb-1', entity_id: ent, name: 'Marine Drive Tower', code: 'MD-1', client: '',
      site_address: '', contract_value: 0, estimate: 0, started_on: '', due_on: '',
      status: 'active', department_id: null, notes: '', created_at: new Date().toISOString() },
  ]))
}, ENT)
await p.goto(B, { waitUntil: 'networkidle' }); await p.waitForTimeout(900)
t = await p.locator('#main-content').innerText()
ok('adding a site ticks the first step', /1 of 4 done/.test(t), t.match(/\d of \d done/)?.[0] || 'absent')
ok('and the next thing asked for is a cost', /Log a cost against it/i.test(t), t.slice(0, 500).replace(/\n/g, ' | '))
// The step a landlord's list does not have: an estimate, which is what turns
// "spent so far" into "running over".
ok('the last step is costing the job', /Cost one of your jobs/i.test(t), t.slice(0, 700).replace(/\n/g, ' | '))

console.log('\n── WAVED AWAY IN ONE SET OF BOOKS ONLY ──')
await p.locator('button[aria-label="Hide getting started"]').click()
await p.waitForTimeout(400)
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(900)
ok('the company checklist stays hidden',
  !(await p.locator('#main-content').innerText()).includes('Getting started'))
await p.evaluate(() => localStorage.setItem('pl_corp_active', '__personal__'))
await p.goto(B, { waitUntil: 'networkidle' }); await p.waitForTimeout(900)
t = await p.locator('#main-content').innerText()
ok('your own books were not dismissed with it', /Getting started/i.test(t), t.slice(0, 200).replace(/\n/g, ' | '))
ok('and they ask for an asset, the way they always did', /Add your first asset/i.test(t), t.slice(0, 400).replace(/\n/g, ' | '))

console.log(`\n${pass} passed, ${fail} failed`); console.log('errors:', errs.length ? errs.slice(0, 4) : 'none')
await b.close(); if (fail) process.exitCode = 1
