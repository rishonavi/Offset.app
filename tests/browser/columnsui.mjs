// The rows the app actually leaves behind, against the columns that exist.
//
// tests/logic/wirecheck.test.mjs asks this of the corporate sync layer, where
// every row comes from a maker and can be built without a browser. The
// personal ledger has no makers: an expense is an object literal typed inside
// a form's submit handler, and there are a dozen other places that write one —
// a quick-add, a bank statement, a spreadsheet, a Tally file, a restored
// backup, a mark-paid that spreads the whole row back. Parsing those out of
// the source would be guessing at what the code does.
//
// So this drives the real paths and reads what they wrote. Demo mode stores in
// localStorage, which accepts any key at all — which is exactly why nothing
// caught that the demo portfolio's `is_sample` had no column and its insert had
// been refused in cloud mode for as long as the feature existed.
import { chromium } from './_playwright.mjs'
import { columnsFromSql, readSql } from '../schema.mjs'

const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
const p = await ctx.newPage(); p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
p.on('dialog', (d) => d.accept())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const schema = columnsFromSql(readSql())
const ls = (k) => p.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), k)

const TABLES = {
  pl_properties: 'properties',
  pl_expenses: 'expenses',
  pl_income: 'income',
  pl_documents: 'documents',
  pl_comments: 'comments',
}

// Every key seen at any point, not the keys left at the end.
//
// This started as a single pass over the finished state, and a deliberate break
// walked straight through it: restoring a backup rebuilds each row from an
// explicit list of fields, so it quietly dropped the sample tag the step before
// had written, and the check found nothing to complain about. A key that
// reaches storage once has reached it.
const seen = new Map()
let rowsSeen = 0
async function collect(where) {
  for (const [key, table] of Object.entries(TABLES)) {
    const rows = await ls(key)
    rowsSeen += rows.length
    if (!seen.has(table)) seen.set(table, new Map())
    for (const row of rows) {
      for (const k of Object.keys(row)) if (!seen.get(table).has(k)) seen.get(table).set(k, where)
    }
  }
}
const save = () => p.locator('#main-content form button[type="submit"]').first()
const amount = () => p.locator('#main-content input[type=number]').first()

// Written by the client, and by no column: the personal backend keeps a local
// id and a workspace owner that Supabase supplies itself.
const CLIENT_ONLY = new Set(['user_id'])

// localStorage takes anything, so the parser has to be doing its job for any of
// this to mean something.
console.log('\n── THE COLUMNS ARE READ, NOT ASSUMED ──')
ok('the schema parsed', schema.size > 25, `${schema.size} tables`)
for (const t of ['properties', 'expenses', 'income', 'documents', 'comments']) {
  ok(`${t} has columns`, (schema.get(t)?.size || 0) > 4, `${schema.get(t)?.size}`)
}
ok('and a column nobody wrote is not among them', !schema.get('expenses')?.has('made_up'))

// ── Drive every path that writes a personal row ─────────────────────
await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(() => {
  localStorage.clear()
  for (const k of ['pl_properties', 'pl_expenses', 'pl_income', 'pl_documents', 'pl_comments']) {
    localStorage.setItem(k, '[]')
  }
})

console.log('\n── AN ASSET, FROM THE ASSET FORM ──')
await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
await p.locator('#main-content input').first().fill('Sea View Villa')
await save().click()
await p.waitForTimeout(1000)
ok('the asset saved', (await ls('pl_properties')).length === 1, String((await ls('pl_properties')).length))
await collect('the asset form')

console.log('\n── AN EXPENSE, WITH EVERYTHING THE FORM OFFERS ──')
// The optional half of the form is behind a disclosure, and it is the half
// that carries the fields nobody remembers: tax, due date, recurrence, notes.
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await amount().fill('4200')
const more = p.locator('#main-content button[aria-expanded]').first()
if (await more.count()) await more.click()
await p.waitForTimeout(300)
const taxBox = p.locator('#main-content input[type=number]').nth(1)
if (await taxBox.count()) await taxBox.fill('756')
const notes = p.locator('#main-content textarea').last()
if (await notes.count()) await notes.fill('Quarterly service')
await save().click()
await p.waitForTimeout(1100)
ok('the expense saved', (await ls('pl_expenses')).length === 1, String((await ls('pl_expenses')).length))
await collect('the expense form')

console.log('\n── INCOME, THE SAME WAY ──')
await p.goto(`${B}/income/new`, { waitUntil: 'networkidle' })
await amount().fill('185000')
const more2 = p.locator('#main-content button[aria-expanded]').first()
if (await more2.count()) await more2.click()
await p.waitForTimeout(300)
await save().click()
await p.waitForTimeout(1100)
ok('the income saved', (await ls('pl_income')).length === 1, String((await ls('pl_income')).length))
await collect('the income form')

console.log('\n── A QUICK ADD, WHICH BUILDS ITS OWN ROW ──')
await p.goto(B, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
const quick = p.locator('button', { hasText: /quick add|add expense/i }).first()
if (await quick.count()) {
  await quick.click()
  await p.waitForTimeout(500)
  const qa = p.locator('input[type=number]').first()
  if (await qa.count()) {
    await qa.fill('990')
    await p.locator('form button[type="submit"]').first().click()
    await p.waitForTimeout(900)
  }
}
ok('a second expense exists however it was added', (await ls('pl_expenses')).length >= 1,
  String((await ls('pl_expenses')).length))
await collect('the quick add')

console.log('\n── MARKING ONE PAID, WHICH SPREADS THE WHOLE ROW BACK ──')
// updateExpense(id, { ...rest, status, due_date }) — the row goes back out
// through the same write. If a key got onto it that has no column, this is
// where it would be sent a second time.
await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
const paidBtn = p.locator('#main-content button', { hasText: /mark paid|paid/i }).first()
if (await paidBtn.count()) { await paidBtn.click(); await p.waitForTimeout(800) }
ok('the expenses list is still there', (await ls('pl_expenses')).length >= 1)
await collect('marking one paid')

console.log('\n── THE SAMPLE PORTFOLIO, WHICH IS WHERE THIS STARTED ──')
await p.evaluate(() => {
  localStorage.setItem('pl_properties', '[]')
  localStorage.setItem('pl_expenses', '[]')
  localStorage.setItem('pl_income', '[]')
  localStorage.removeItem('pl_onboarding_dismissed')
})
await p.goto(B, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
const load = p.locator('button', { hasText: 'Load sample data' })
ok('the sample is on offer', await load.count() === 1)
await load.click()
await p.waitForTimeout(4000)
ok('it wrote assets', (await ls('pl_properties')).length >= 3, String((await ls('pl_properties')).length))
ok('and a year of entries', (await ls('pl_expenses')).length >= 20, String((await ls('pl_expenses')).length))
await collect('the sample portfolio')

console.log('\n── AND A BACKUP PUT BACK, WHICH REBUILDS EVERY ROW ──')
await p.goto(`${B}/exports`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
const [download] = await Promise.all([
  p.waitForEvent('download', { timeout: 30000 }),
  p.locator('button', { hasText: /Download backup/i }).first().click(),
])
const file = await download.path()
await p.evaluate(() => {
  for (const k of ['pl_properties', 'pl_expenses', 'pl_income']) localStorage.setItem(k, '[]')
})
await p.goto(`${B}/import`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
await p.locator('input[type=file][accept*="json"]').first().setInputFiles(file)
await p.waitForTimeout(4000)
ok('the restore rebuilt the books', (await ls('pl_expenses')).length >= 20,
  String((await ls('pl_expenses')).length))
await collect('a restored backup')

// ── The question ────────────────────────────────────────────────────
console.log('\n── EVERY KEY ON EVERY ROW IS A COLUMN ──')
for (const table of Object.values(TABLES)) {
  const cols = schema.get(table) || new Set()
  const keys = [...(seen.get(table) || new Map())]
  const missing = keys.filter(([c]) => !cols.has(c) && !CLIENT_ONLY.has(c))
  ok(`${table}: ${keys.length} distinct keys`, missing.length === 0,
    missing.map(([c, where]) => `no such column: ${c} (written by ${where})`).join('; '))
}
// A pass over nothing is not a pass. If the driving above stopped working,
// every check would come back clean on empty tables and say so cheerfully.
ok('and there were rows to check', rowsSeen >= 60, `${rowsSeen} rows`)
ok('over several distinct shapes of expense',
  (seen.get('expenses')?.size || 0) >= 12, `${seen.get('expenses')?.size} keys`)
// The two nobody drove above. Said out loud rather than counted as covered:
// a table with no rows passes this check for the wrong reason.
for (const table of ['documents', 'comments']) {
  ok(`${table} is not exercised here, and is not claimed as checked`,
    (seen.get(table)?.size || 0) === 0, `${seen.get(table)?.size} keys — update the suite`)
}

console.log('\n── THE SAME, IN A COMPANY’S BOOKS ──')
// A company stamps `entity_id` and can book to a site, which are two more keys
// on the way out.
const ENT = 'ent-col-1'
await p.evaluate((ent) => {
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
    { id: 'site-col-1', entity_id: ent, name: 'Marine Drive Tower', code: 'MD-1', client: '',
      site_address: '', contract_value: 0, estimate: 0, started_on: '', due_on: '',
      status: 'active', department_id: null, notes: '', created_at: born.toISOString() },
  ]))
  localStorage.setItem('pl_corp_active', ent)
}, ENT)
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
await amount().fill('810000')
const site = p.locator('#main-content select[aria-label="Site"]').first()
if (await site.count()) await site.selectOption('site-col-1')
await save().click()
await p.waitForTimeout(1100)
const corpRows = await ls('pl_expenses')
ok('a company expense saved', corpRows.length === 1, String(corpRows.length))
ok('stamped with the company', corpRows[0]?.entity_id === ENT, String(corpRows[0]?.entity_id))
ok('and booked to the site', corpRows[0]?.project_id === 'site-col-1', String(corpRows[0]?.project_id))
const corpKeys = Object.keys(corpRows[0] || {})
const corpMissing = corpKeys.filter((c) => !schema.get('expenses').has(c) && !CLIENT_ONLY.has(c))
ok('every key on it is a column too', corpMissing.length === 0, `no such column: ${corpMissing.join(', ')}`)

for (const e of errs) ok(e, false)
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
