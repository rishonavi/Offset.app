// Cost centres: a field that was never filled in, and a budget nothing checked.
//
// `department_id` has been a column on expenses and income since the corporate
// layer was written, and no form ever set it. `budget_monthly` has been on a
// department just as long, and no screen ever compared it to anything — you
// could give a cost centre a budget and the app would never once tell you that
// you were over it. Both are wired here.
//
// The assertion worth reading is the total: a division's figure includes the
// teams inside it, so the column does not add up to the total and must not.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 }, serviceWorkers: 'block' })
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
const save = () => p.locator('#main-content form button[type="submit"]').first()
const amount = () => p.locator('#main-content input[type=number]').first()
const dept = () => p.locator('#main-content select[aria-label="Cost centre"]').first()
// Just the cost-centre block. The Reports page carries its own expense total
// further down, and an assertion that reads the whole page can be satisfied by
// that instead — which is how the first version of the total check below passed
// against a table plainly showing the wrong number.
const section = async () => {
  const t = await main()
  const i = t.search(/COST CENTRES/i)
  if (i < 0) return ''
  // Cut at the next block. A fixed-length slice ran on into the Preview table,
  // which carries a Total of its own — the very figure this is trying not to
  // be fooled by.
  const rest = t.slice(i)
  const end = rest.search(/\nPreview\b|\nWHAT IS OWED|\nADVANCES\b/i)
  return end > 0 ? rest.slice(0, end) : rest
}
const ENT = 'ent-dept-1'
const month = new Date().toISOString().slice(0, 7)

await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(({ ent }) => {
  localStorage.clear()
  const born = new Date(); born.setFullYear(born.getFullYear() - 1)
  for (const k of ['pl_properties', 'pl_expenses', 'pl_income', 'pl_documents']) localStorage.setItem(k, '[]')
  localStorage.setItem('pl_corp_entities', JSON.stringify([
    { id: ent, name: 'Navi Builders Pvt Ltd', currency: 'INR', fy_start_month: 4, created_at: born.toISOString() },
  ]))
  localStorage.setItem('pl_corp_members', JSON.stringify([
    { id: 'm1', entity_id: ent, user_id: 'local-user', email: '', role: 'owner', department_id: null, created_at: new Date().toISOString() },
  ]))
  localStorage.setItem('pl_corp_active', ent)
}, { ent: ENT })

console.log('\n── WITH NO DEPARTMENTS, THE FIELD IS NOT THERE ──')
// A select whose only option says "none" is a field people learn to skip.
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
ok('the form opens', /amount/i.test(await main()))
ok('and offers no cost centre', await dept().count() === 0)

console.log('\n── ONCE THERE ARE SOME, IT IS ──')
await p.evaluate(({ ent }) => {
  const now = new Date().toISOString()
  localStorage.setItem('pl_corp_departments', JSON.stringify([
    { id: 'd-build', entity_id: ent, name: 'Construction', code: 'CON', budget_monthly: 800000, parent_id: null, created_at: now },
    { id: 'd-a', entity_id: ent, name: 'Site A', code: '', budget_monthly: 400000, parent_id: 'd-build', created_at: now },
    { id: 'd-office', entity_id: ent, name: 'Head office', code: 'HO', budget_monthly: 200000, parent_id: null, created_at: now },
  ]))
}, { ent: ENT })
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
ok('the cost centre field appears', await dept().count() === 1)
const opts = await dept().locator('option').allInnerTexts()
ok('with "none of them" as a real answer', /not booked to a cost centre/i.test(opts.join('|')), opts.join('|'))
ok('every department is offered', opts.join('|').includes('Construction') && opts.join('|').includes('Site A'))
// A team inside a division is indented, so a one-line-at-a-time list still
// shows the shape.
ok('and a team inside a division is indented under it',
  opts.some((o) => /^\s| /.test(o) && /Site A/.test(o)), JSON.stringify(opts))
ok('nothing is pre-picked', (await dept().inputValue()) === '', await dept().inputValue())

console.log('\n── A COST BOOKED TO ONE ──')
await amount().fill('250000')
await dept().selectOption('d-a')
await save().click()
await p.waitForTimeout(1100)
let rows = (await ls('pl_expenses')).filter((e) => !e.deleted_at)
ok('the expense saved', rows.length === 1, String(rows.length))
ok('carrying the cost centre', rows[0]?.department_id === 'd-a', String(rows[0]?.department_id))
ok('and still the company', rows[0]?.entity_id === ENT)

console.log('\n── AND ONE BOOKED TO NOTHING ──')
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
await amount().fill('120000')
await save().click()
await p.waitForTimeout(1100)
rows = (await ls('pl_expenses')).filter((e) => !e.deleted_at)
ok('it saves too', rows.length === 2, String(rows.length))
// Null, not the empty string: an empty select value reaching storage is neither
// an id nor nothing.
ok('with no cost centre, as null', rows.find((e) => Number(e.amount) === 120000)?.department_id === null,
  JSON.stringify(rows.map((e) => e.department_id)))

console.log('\n── INCOME CAN NAME ONE AS WELL ──')
await p.goto(`${B}/income/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
await amount().fill('900000')
await dept().selectOption('d-a')
await save().click()
await p.waitForTimeout(1100)
ok('the income carries it', (await ls('pl_income')).filter((e) => !e.deleted_at)[0]?.department_id === 'd-a')

console.log('\n── AND THE REPORT FINALLY CHECKS THE BUDGET ──')
// Another 600,000 on Site A, so the division is pushed past its own 800,000
// budget purely by its child while its own directly-booked costs are nil.
await p.evaluate(({ ent, m }) => {
  const list = JSON.parse(localStorage.getItem('pl_expenses'))
  list.push({ id: 'x-extra', entity_id: ent, property_id: null, project_id: null, department_id: 'd-a',
    date: `${m}-12`, amount: 600000, category: 'Materials', status: 'paid' })
  localStorage.setItem('pl_expenses', JSON.stringify(list))
}, { ent: ENT, m: month })
await p.goto(`${B}/reports`, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
let t = await main()
ok('there is a cost centre table', /cost centres/i.test(t), t.slice(0, 400).replace(/\n/g, ' | '))
ok('with the departments on it', /Construction/.test(t) && /Site A/.test(t))
// The budget was dead data until now.
ok('Site A is flagged as over its budget', /over by/i.test(t), t.slice(0, 1200).replace(/\n/g, ' | '))
ok('and so is the division above it, on its team’s spending',
  (t.match(/over by/gi) || []).length >= 2, `${(t.match(/over by/gi) || []).length} flags`)
// The figure that says whether the rest of the table is worth reading.
ok('what nobody booked is on the table too', /not booked to a cost centre/i.test(t),
  t.slice(0, 1400).replace(/\n/g, ' | '))
ok('with its share of the spend', /% of the spend/i.test(t))
// 850,000 on Site A plus 120,000 booked to nothing is 970,000. Adding the
// column would give 1,820,000, because the division's row already contains
// Site A's — so this reads the table's own total row, not the page.
const block = await section()
ok('the total is what was actually spent', /Total\s+\u20b99,70,000/.test(block),
  block.replace(/\n/g, ' | '))
ok('and not the column added up, which double-counts the division',
  !/18,20,000/.test(block), block.replace(/\n/g, ' | '))
// The same arithmetic from the other side: the share is of the real total.
ok('the unbooked share is of what was really spent', /12\.4% of the spend/.test(block),
  block.replace(/\n/g, ' | '))

console.log('\n── A DEPARTMENT WITH NO BUDGET IS NOT ONE IN BUDGET ──')
await p.evaluate(({ ent }) => {
  const list = JSON.parse(localStorage.getItem('pl_corp_departments'))
  list.push({ id: 'd-legal', entity_id: ent, name: 'Legal', code: '', budget_monthly: 0, parent_id: null, created_at: new Date().toISOString() })
  localStorage.setItem('pl_corp_departments', JSON.stringify(list))
}, { ent: ENT })
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
t = await main()
ok('it is listed', /Legal/.test(t), t.slice(0, 1400).replace(/\n/g, ' | '))
ok('and not called over budget', (t.match(/over by/gi) || []).length === 2,
  `${(t.match(/over by/gi) || []).length} flags`)

for (const e of errs) ok(e, false)
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
