// A builder's costs, which belong to things the builder does not own.
//
// Every expense in this app used to require an asset. That is right for the
// books it was written for — a landlord's costs are all against a flat — and
// wrong for a construction company, whose spend is on towers it is selling by
// the flat and whose overheads sit against nothing at all. The old form's
// answer was to refuse, and the answer to the refusal was an invented asset
// called "Depot" carried in every total forever.
//
// These assertions are about what the screen now accepts, and about the two
// kinds of blank it must keep apart: not booked, and booked to something the
// lookup cannot name.
import { readFileSync } from 'node:fs'
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

const main = () => p.locator('#main-content').innerText()
const amount = () => p.locator('#main-content input[type=number]').first()
const save = () => p.locator('form button[type="submit"]').first()
const assetSelect = () => p.locator('#main-content select').first()
const siteSelect = () => p.locator('#main-content select[aria-label="Site"]').first()
const expenses = () => p.evaluate(() => JSON.parse(localStorage.getItem('pl_expenses') || '[]'))

// ── A company with one job and nothing it owns ──────────────────
// Deliberately no asset at all. That is the state the app used to refuse to
// open an expense form in.
const ENT = 'ent-place-1'
const SITE = 'site-place-1'
await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(({ ent, site }) => {
  localStorage.clear()
  const born = new Date(); born.setFullYear(born.getFullYear() - 1)
  for (const k of ['pl_properties', 'pl_expenses', 'pl_income', 'pl_documents']) localStorage.setItem(k, '[]')
  localStorage.setItem('pl_corp_entities', JSON.stringify([
    { id: ent, name: 'Navi Builders Pvt Ltd', registration: '', gstin: '27AAAPA1234A1Z5', currency: 'INR', fyStartMonth: 4, created_at: born.toISOString() },
  ]))
  localStorage.setItem('pl_corp_members', JSON.stringify([
    { id: 'm1', entity_id: ent, user_id: 'local-user', email: '', role: 'owner', department_id: null, created_at: new Date().toISOString() },
  ]))
  localStorage.setItem('pl_corp_projects', JSON.stringify([
    { id: site, entity_id: ent, name: 'Marine Drive Tower', code: 'MD-1', client: 'Navi Realty',
      site_address: '', contract_value: 100000000, estimate: 80000000, started_on: '', due_on: '',
      status: 'active', department_id: null, notes: '', created_at: born.toISOString() },
  ]))
  localStorage.setItem('pl_corp_active', ent)
}, { ent: ENT, site: SITE })

console.log('\n── THE FORM OPENS WITH NOTHING TO BOOK TO ──')
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(500)
let body = await main()
ok('it does not send you off to create an asset first', !/add an asset first|create one before/i.test(body), body.slice(0, 200).replace(/\n/g, ' | '))
ok('there is an amount box to type in', await amount().isVisible())
// A select whose only option says "none" is a question with one answer, which
// is a field people learn to skip and then skip once it matters.
ok('and no asset field at all, since the company owns nothing',
  await p.locator('#main-content select').filter({ hasText: 'Not booked to an asset' }).count() === 0)
ok('the job is offered instead', await siteSelect().isVisible())

console.log('\n── AND SO DOES THE IMPORT PAGE ──')
// A bank statement is where most of a builder's costs arrive from, and the
// page refused to show the importer at all until an asset existed.
await p.goto(`${B}/import`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
body = await main()
ok('a statement can be imported with nothing owned', !/add an asset first/i.test(body), body.slice(0, 250).replace(/\n/g, ' | '))
ok('the statement importer is on the page', /bank .{0,4}(&|and).{0,4} upi statement/i.test(body), body.slice(0, 400).replace(/\n/g, ' | '))

await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(400)
console.log('\n── A COST BOOKED TO THE JOB ──')
await amount().fill('810000')
await siteSelect().selectOption(SITE)
await save().click()
await p.waitForTimeout(900)
let rows = await expenses()
ok('the entry saved', rows.length === 1, JSON.stringify(rows))
ok('booked to the job', rows[0]?.project_id === SITE, String(rows[0]?.project_id))
// The bug this is really guarding: an empty select value reaching storage as
// the empty string, which is not null and is not an id either.
ok('and to no asset, as null rather than an empty string', rows[0]?.property_id === null, JSON.stringify(rows[0]?.property_id))

console.log('\n── WHAT THE LIST CALLS IT ──')
await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
body = await main()
// Headings are CSS-uppercased, so these read case-insensitively.
ok('the column is not headed Property in a company', !/\bPROPERTY\b/.test(body), body.slice(0, 300).replace(/\n/g, ' | '))
ok('it asks what the cost is booked to', /booked to/i.test(body))
ok('and the answer is the job', /Marine Drive Tower/.test(body), body.slice(0, 400).replace(/\n/g, ' | '))

console.log('\n── AN OVERHEAD, WHICH IS BOOKED TO NOTHING ──')
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(400)
await amount().fill('65000')
// The site select is left on its first option, which is "Not booked to a site".
await save().click()
await p.waitForTimeout(900)
rows = await expenses()
ok('the office rent is a bill like any other', rows.length === 2, String(rows.length))
const rent = rows.find((r) => Number(r.amount) === 65000)
ok('against no job', !rent?.project_id, String(rent?.project_id))
ok('and no asset', !rent?.property_id, String(rent?.property_id))
await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
body = await main()
ok('it shows in the list', /65,000/.test(body), body.slice(0, 400).replace(/\n/g, ' | '))
ok('with the job still named on the other row', /Marine Drive Tower/.test(body))

console.log('\n── THE DASHBOARD SAYS WHO IS CARRYING WHAT ──')
await p.goto(`${B}/`, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
body = await main()
ok('the job appears as something spent against', /Marine Drive Tower/.test(body), body.slice(0, 500).replace(/\n/g, ' | '))
// It used to read "Unknown", which is what a failed lookup says. Office rent is
// not unknown; it is simply nobody's job to carry.
ok('and the overhead is named rather than shrugged at', /not booked/i.test(body), body.slice(0, 600).replace(/\n/g, ' | '))
ok('nothing calls it Unknown', !/\bunknown\b/i.test(body), body.slice(0, 600).replace(/\n/g, ' | '))

console.log('\n── ONCE THE COMPANY DOES OWN SOMETHING ──')
await p.evaluate(({ ent }) => {
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'a1', name: 'Head Office', type: 'Real Estate — Villa / House', entity_id: ent, created_at: new Date().toISOString() },
  ]))
}, { ent: ENT })
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
ok('the asset field appears', await assetSelect().isVisible())
const opts = await assetSelect().locator('option').allInnerTexts()
ok('with "none of them" as a real answer', /not booked to an asset/i.test(opts.join('|')), opts.join('|'))
// The one that matters: a form that pre-picks the office books the site's
// cement to the office every time somebody does not notice the field.
ok('and nothing pre-picked, because guessing an asset in a company is wrong',
  (await assetSelect().inputValue()) === '', await assetSelect().inputValue())
body = await main()
ok('the field no longer carries a required mark', !/Property\s*\*/.test(body), body.slice(0, 300).replace(/\n/g, ' | '))

console.log('\n── A BACKUP THAT DOES NOT QUIETLY DROP THE OVERHEADS ──')
// Restore matched entries to assets by name and skipped anything it could not
// match — which, once an entry may legitimately have no asset, meant throwing
// away every overhead in the file without saying so.
await p.goto(`${B}/exports`, { waitUntil: 'networkidle' })
await p.waitForTimeout(500)
const [download] = await Promise.all([
  p.waitForEvent('download', { timeout: 30000 }),
  p.locator('button', { hasText: /Download backup/i }).first().click(),
])
const file = await download.path()
const dump = JSON.parse(readFileSync(file, 'utf8'))
ok('both entries are in the file', (dump.expenses || []).length === 2, String((dump.expenses || []).length))
ok('the overhead travels with no asset on it',
  (dump.expenses || []).some((e) => Number(e.amount) === 65000 && !e.property_id))
ok('and the site cost travels with its job', (dump.expenses || []).some((e) => e.project_id === SITE))

await p.evaluate(() => localStorage.setItem('pl_expenses', '[]'))
await p.goto(`${B}/import`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
await p.locator('input[type=file][accept*="json"]').first().setInputFiles(file)
await p.waitForTimeout(1800)
rows = await expenses()
ok('both come back', rows.length === 2, JSON.stringify(rows.map((r) => r.amount)))
ok('the overhead among them', rows.some((r) => Number(r.amount) === 65000), JSON.stringify(rows.map((r) => r.amount)))
ok('still booked to nothing rather than to the nearest asset',
  rows.find((r) => Number(r.amount) === 65000)?.property_id == null,
  JSON.stringify(rows.find((r) => Number(r.amount) === 65000)?.property_id))
// The control: restoring did not simply forget every booking it had.
ok('and the site cost still knows its job',
  rows.find((r) => Number(r.amount) === 810000)?.project_id === SITE,
  JSON.stringify(rows.find((r) => Number(r.amount) === 810000)?.project_id))

console.log('\n── PERSONAL BOOKS ARE UNCHANGED ──')
// Nothing else in personal books can carry a cost, so an entry pointing at
// nothing there is a mistake and is still refused.
await p.evaluate(() => {
  localStorage.setItem('pl_corp_active', '__personal__')
  localStorage.setItem('pl_properties', '[]')
  localStorage.setItem('pl_expenses', '[]')
})
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
body = await main()
ok('with no asset, the form still refuses to open', /add an asset first|create one before/i.test(body), body.slice(0, 250).replace(/\n/g, ' | '))
await p.evaluate(() => {
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'own1', name: 'Sea View Villa', type: 'Real Estate — Villa / House', created_at: new Date().toISOString() },
  ]))
})
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
ok('with one, it opens on that asset rather than on nothing',
  (await assetSelect().inputValue()) === 'own1', await assetSelect().inputValue())
const ownOpts = await assetSelect().locator('option').allInnerTexts()
ok('and "none of them" is not offered', !/not booked to an asset/i.test(ownOpts.join('|')), ownOpts.join('|'))
await amount().fill('1200')
await save().click()
await p.waitForTimeout(900)
await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
body = await main()
ok('and the column goes back to being called Property', /\bproperty\b/i.test(body), body.slice(0, 300).replace(/\n/g, ' | '))
ok('with nothing about being booked to anything', !/booked to/i.test(body), body.slice(0, 300).replace(/\n/g, ' | '))

for (const e of errs) ok(e, false)
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
