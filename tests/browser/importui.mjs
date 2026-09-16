// Somebody else's spreadsheet, into the books.
//
// The screen is built around one idea: the column match is a guess, so it is
// shown before anything is written. An importer that guesses silently and
// writes four hundred rows is worse than one that refuses.
//
// So the assertions are mostly about what is on screen *before* the button is
// pressed — the mapping, the columns it ignored, the rows it will skip and why
// — and about the file it correctly declines to read.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1200 }, serviceWorkers: 'block' })
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
const file = (name, csv) => p.locator('#main-content input[aria-label="Spreadsheet to import"]')
  .setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(csv) })
const ENT = 'ent-imp-1'

await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(({ ent }) => {
  localStorage.clear()
  const now = new Date().toISOString()
  for (const k of ['pl_expenses', 'pl_income', 'pl_documents']) localStorage.setItem(k, '[]')
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'a1', name: 'Yard', type: 'Real Estate — Villa / House', entity_id: ent, created_at: now },
  ]))
  localStorage.setItem('pl_corp_entities', JSON.stringify([
    { id: ent, name: 'Navi Builders Pvt Ltd', currency: 'INR', fy_start_month: 4, created_at: now },
  ]))
  localStorage.setItem('pl_corp_members', JSON.stringify([
    { id: 'm1', entity_id: ent, user_id: 'local-user', email: '', role: 'owner', created_at: now },
  ]))
  localStorage.setItem('pl_corp_active', ent)
  localStorage.setItem('pl_corp_projects', JSON.stringify([
    { id: 'tower', entity_id: ent, name: 'Marine Drive Tower', status: 'active', contract_value: 0, estimate: 0, created_at: now, updated_at: now },
  ]))
}, { ent: ENT })

const open = async () => {
  await p.goto(`${B}/operations?tab=import`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(900)
}
await open()

console.log('\n── THE SCREEN ──')
let t = await main()
ok('the import tab opens', /from a spreadsheet/i.test(t), t.slice(0, 300))
ok('and says nothing is written until it has been seen', /Nothing is written until you have seen/i.test(t))
ok('with the columns it expects', /Unit, Tower, Floor/i.test(t), t.slice(0, 700))

console.log('\n── A BROKER’S SALES LIST ──')
// Real headers: units in brackets, a column we have no field for, a blank
// filler row, and one real row missing the thing it cannot do without.
await p.locator('#main-content select[aria-label="Import site"]').selectOption('tower')
await p.waitForTimeout(300)
await file('Sales List.csv', [
  'Unit No,Tower,Floor,Configuration,Carpet Area (sq.ft.),Agreed Price,Parking,Status',
  'A-1201,A,12,2 BHK,685,12450000,Yes,Booked',
  'A-1202,A,12,3 BHK,940,17800000,No,Available',
  ',,,,,,,',
  ',A,13,2 BHK,685,12450000,,',
].join('\n'))
await p.waitForTimeout(900)
t = await main()
ok('it says how many rows were read', /4 rows read from Sales List\.csv/.test(t), t.slice(0, 800))
ok('and how many columns it recognised', /7 of 12 columns recognised/.test(t), t.slice(0, 900))
// The guess, shown.
ok('the mapping is on screen', /Unit No/.test(t) && /carpetArea/.test(t), t.slice(0, 1200))
ok('the column it could do nothing with is named', /Ignored: Parking/.test(t), t.slice(0, 1200))
// Named, not dropped.
ok('the row it will skip is named by line', /Line 5 — no name/.test(t), t.slice(0, 1400))
ok('and the blank filler row is not called an error', !/Line 4/.test(t), t.slice(0, 1400))
ok('two units are ready', /2 units ready/.test(t), t.slice(0, 1400))
// Nothing written yet — the whole point of the preview.
ok('and nothing has been written', (await ls('pl_corp_units')).length === 0)

console.log('\n── AND ONLY THEN ──')
await p.getByRole('button', { name: /Add 2 units/i }).first().click()
await p.waitForTimeout(1200)
const units = await ls('pl_corp_units')
ok('both flats are in the books', units.length === 2, String(units.length))
ok('the price came through', Number(units[0]?.agreed_price) === 12450000, String(units[0]?.agreed_price))
ok('the area through its bracketed units', Number(units[0]?.carpet_area) === 685, String(units[0]?.carpet_area))
ok('a status in words became a status', units[0]?.status === 'booked', String(units[0]?.status))
ok('and the site was stamped on', units[0]?.project_id === 'tower', String(units[0]?.project_id))
ok('the screen says what it did', /2 of 2 added/.test(await main()), (await main()).slice(0, 600))

console.log('\n── A SHEET WITHOUT THE ONE COLUMN IT NEEDS ──')
// Refusing beats writing four hundred unnamed rows.
await open()
await file('No Names.csv', 'Tower,Floor,Carpet Area\nA,12,685')
await p.waitForTimeout(800)
t = await main()
ok('it refuses', /No column looks like name/i.test(t), t.slice(0, 800))
ok('and says nothing has been written', /Nothing has been written/.test(t))
ok('with no button to press', await p.getByRole('button', { name: /^Add \d+ /i }).count() === 0)

console.log('\n── A NUMBERS PACKAGE ──')
// It is a zip, not a spreadsheet. Saying so beats "could not read file" about
// a file that is perfectly fine.
await file('Sales List.numbers', 'not really a spreadsheet')
await p.waitForTimeout(700)
t = await main()
ok('it is recognised for what it is', /package rather than a spreadsheet/i.test(t), t.slice(0, 800))
ok('and says how to get one it can read', /Export To/.test(t))

console.log('\n── A SALARY REGISTER ──')
await open()
await p.locator('#main-content select[aria-label="What to import"]').selectOption('employees')
await p.waitForTimeout(400)
await file('Payroll.csv', [
  'Name,Emp Code,Basic,HRA,Conveyance,PAN,Date of Joining',
  'R. Sharma,E-01,30000,12000,1600,AAAPZ1234C,2024-04-01',
  'S. Iyer,E-02,18000,7200,,,',
].join('\n'))
await p.waitForTimeout(900)
ok('two people are ready', /2 employees ready/.test(await main()), (await main()).slice(0, 1000))
await p.getByRole('button', { name: /Add 2 employees/i }).first().click()
await p.waitForTimeout(1200)
const staff = await ls('pl_corp_employees')
ok('both are on the payroll', staff.length === 2, String(staff.length))
// The register has pay in columns; the app keeps it in one object.
ok('the basic went into the pay', Number(staff[0]?.pay?.basic) === 30000, JSON.stringify(staff[0]?.pay))
ok('and the house rent allowance', Number(staff[0]?.pay?.hra) === 12000)

console.log('\n── A VENDOR’S PRICE LIST ──')
await open()
await p.locator('#main-content select[aria-label="What to import"]').selectOption('quotes')
await p.waitForTimeout(400)
await file('Prices.csv', [
  'Vendor,Ref,Date,Material,Quantity,Rate,Unit,GST',
  'Shakti Steel,Q-114,2026-06-12,TMT 12mm,24000,61.40,kg,18',
  'Shakti Steel,Q-114,2026-06-12,TMT 16mm,8000,60.90,kg,18',
  'UltraTech,C-889,2026-06-18,OPC 53,1800,392,bag,28',
].join('\n'))
await p.waitForTimeout(900)
t = await main()
// Three rows are two quotations, and the screen says so rather than making the
// count look wrong.
ok('three rows became two quotations', /2 quotations ready/.test(t), t.slice(0, 1000))
ok('and it says where they came from', /from 3 rows/.test(t), t.slice(0, 1000))
await p.getByRole('button', { name: /Add 2 quotations/i }).first().click()
await p.waitForTimeout(1200)
const quotes = await ls('pl_corp_quotes')
ok('two quotations are on file', quotes.length === 2, String(quotes.length))
ok('the first carries both its materials', quotes[0]?.lines?.length === 2, String(quotes[0]?.lines?.length))

ok('no page errors', errs.length === 0, errs.join(' | '))
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
