// Stock, advances and payroll in the browser. All three had working, tested
// arithmetic and no screen at all until now, so this suite is mostly asking the
// simplest question there is: does what the library computes reach the page,
// and does what the page writes reach the library.
import { chromium } from './_playwright.mjs'
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const TMP = await mkdtemp(join(tmpdir(), 'opsui-'))
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
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
// The tab buttons carry an icon, so their text has leading whitespace and an
// anchored match never fires. They are the only aria-pressed controls here.
const TABS = ['Stock', 'Advances', 'Payroll']
const tab = async (name) => { await p.locator('#main-content button[aria-pressed]').nth(TABS.indexOf(name)).click(); await p.waitForTimeout(350) }

// ── 1. Dormant without a company ──
console.log('\n── NO COMPANY, NO OPERATIONS ──')
await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(() => {
  localStorage.clear()
  localStorage.setItem('pl_properties', JSON.stringify([{ id: 'p1', name: 'Sea View Villa', type: 'Real Estate — Villa / House', value: 4200000 }]))
  localStorage.setItem('pl_expenses', '[]'); localStorage.setItem('pl_income', '[]'); localStorage.setItem('pl_documents', '[]')
})
await p.goto(B, { waitUntil: 'networkidle' })
ok('the sidebar has no Operations entry', !/OPERATIONS/i.test(await p.locator('aside nav').innerText()))
await p.goto(`${B}/operations`, { waitUntil: 'networkidle' })
await p.waitForTimeout(400)
ok('the page itself says why it is empty', /Add a company first/.test(await main()))
await p.locator('body').click({ position: { x: 5, y: 5 } })
await p.keyboard.press('Control+k')
await p.locator('[role="dialog"] input').first().waitFor({ state: 'visible' })
await p.locator('[role="dialog"] input').first().fill('payroll')
await p.waitForTimeout(400)
ok('and the palette does not offer it either', !/Operations/.test(await p.locator('[role="dialog"]').innerText()))
await p.keyboard.press('Escape')
await p.waitForTimeout(300)
await p.goto(`${B}/reports`, { waitUntil: 'networkidle' })
await p.waitForTimeout(500)
ok('and the report grows no company section', !/What the company cost/.test(await main()))

// ── 2. With a company ──
console.log('\n── WITH A COMPANY ──')
await p.evaluate(() => {
  const id = 'ent-test-1'
  // Created a year ago, because a company incorporated five minutes ago has no
  // payroll history to report and the page correctly says so.
  const born = new Date(); born.setFullYear(born.getFullYear() - 1)
  localStorage.setItem('pl_corp_entities', JSON.stringify([
    { id, name: 'Acme Industries Pvt Ltd', registration: '', gstin: '27AAAPA1234A1Z5', currency: 'INR', fyStartMonth: 4, created_at: born.toISOString() },
  ]))
  localStorage.setItem('pl_corp_members', JSON.stringify([
    { id: 'm1', entity_id: id, user_id: 'local-user', email: '', role: 'owner', department_id: null, created_at: new Date().toISOString() },
  ]))
  localStorage.setItem('pl_corp_active', id)
})
await p.goto(B, { waitUntil: 'networkidle' })
await p.waitForTimeout(400)
ok('Operations appears in the sidebar', /OPERATIONS/i.test(await p.locator('aside nav').innerText()))
await p.locator('aside nav a[href="/operations"]').click()
await p.waitForURL('**/operations')
await p.waitForTimeout(500)
const opened = await main()
ok('the page opens on Stock', /On hand/.test(opened) && /No items yet/.test(opened))
ok('and names the company', /Acme/.test(opened), opened.slice(0, 120))

// The palette is where people who know what they want go. "Payroll" and
// "reorder" are words that used to match nothing at all.
const openPalette = async () => {
  if (await p.locator('[role="dialog"]').count()) { await p.keyboard.press('Escape'); await p.waitForTimeout(250) }
  await p.locator('body').click({ position: { x: 5, y: 5 } })
  await p.keyboard.press('Control+k')
  await p.locator('[role="dialog"] input').first().waitFor({ state: 'visible' })
  await p.waitForTimeout(250)
}
await openPalette()
await p.locator('[role="dialog"] input').first().fill('payroll')
await p.waitForTimeout(400)
ok('the palette finds Operations by the word payroll', /Operations/.test(await p.locator('[role="dialog"]').innerText()))
await p.keyboard.press('Enter')
await p.waitForTimeout(600)
ok('and going there works', p.url().endsWith('/operations'), p.url())
await openPalette()
await p.locator('[role="dialog"] input').first().fill('reorder')
await p.waitForTimeout(400)
ok('and by the word reorder', /Operations/.test(await p.locator('[role="dialog"]').innerText()))
await p.keyboard.press('Escape')
await p.waitForTimeout(300)

// ── 3. Stock ──
console.log('\n── STOCK ──')
await p.locator('input[placeholder="Cement, 50kg bag"]').fill('Cement 50kg')
await p.locator('#main-content input').nth(1).fill('cem50')
await p.locator('#main-content select').first().selectOption('bag')
await p.locator('#main-content input[type="number"]').first().fill('10')
await p.locator('button', { hasText: 'Add item' }).click()
await p.waitForTimeout(500)
const items = await ls('pl_corp_items')
ok('the item is stored', items.length === 1, JSON.stringify(items[0] || {}).slice(0, 90))
ok('its SKU is upper-cased by the library', items[0]?.sku === 'CEM50', items[0]?.sku)
ok('and it is scoped to the company', items[0]?.entity_id === 'ent-test-1')
ok('it appears in the on-hand table', /Cement 50kg/.test(await main()))

// 40 bags at ₹350 in, 15 out. 25 left, worth 8750.
const moveForm = p.locator('#main-content form').nth(1)
await moveForm.locator('select').first().selectOption({ label: 'Cement 50kg' })
await moveForm.locator('input[type="number"]').first().fill('40')
await moveForm.locator('input[type="number"]').nth(1).fill('350')
await moveForm.locator('button', { hasText: 'Record' }).click()
await p.waitForTimeout(500)
await moveForm.locator('select').first().selectOption({ label: 'Cement 50kg' })
await moveForm.locator('select').nth(1).selectOption('issue')
await moveForm.locator('input[type="number"]').first().fill('15')
await moveForm.locator('button', { hasText: 'Record' }).click()
await p.waitForTimeout(600)
ok('both movements are stored', (await ls('pl_corp_movements')).length === 2)
const stockText = await main()
ok('the quantity on hand is 25', /25 bag/.test(stockText), stockText.slice(0, 200))
ok('the value is the average cost times what is left', /8,750/.test(stockText))
ok('and 25 is above the reorder level of 10, so no warning', !/Negative stock first/.test(stockText))

// Take it below the reorder level and the warning has to appear.
await moveForm.locator('select').first().selectOption({ label: 'Cement 50kg' })
await moveForm.locator('select').nth(1).selectOption('issue')
await moveForm.locator('input[type="number"]').first().fill('20')
await moveForm.locator('button', { hasText: 'Record' }).click()
await p.waitForTimeout(600)
const lowText = await main()
ok('going below the reorder level warns', /Negative stock first/.test(lowText))
ok('and negative stock is called negative', /NEGATIVE/i.test(lowText), lowText.slice(0, 160))

// ── 4. Advances ──
console.log('\n── ADVANCES ──')
await tab('Advances')
ok('the tab starts with nothing outstanding', /Nothing outstanding/.test(await main()))
await p.locator('input[placeholder="Ravi Contractors"]').fill('Ravi Contractors')
const advForm = p.locator('#main-content form').first()
await advForm.locator('input[type="number"]').first().fill('50000')
await advForm.locator('button', { hasText: 'Record advance' }).click()
await p.waitForTimeout(600)
ok('the advance is stored', (await ls('pl_corp_advances')).length === 1)
let advText = await main()
ok('it is outstanding in full', /50,000/.test(advText), advText.slice(0, 160))
ok('and the party is listed', /Ravi Contractors/.test(advText))

// Set part of it against a bill.
const setForm = p.locator('#main-content form').nth(1)
await setForm.locator('select').first().selectOption({ index: 1 })
await setForm.locator('input[type="number"]').first().fill('20000')
await setForm.locator('button', { hasText: 'Adjust' }).click()
await p.waitForTimeout(600)
ok('the adjustment is stored', (await ls('pl_corp_adjustments')).length === 1)
advText = await main()
ok('and 30,000 is left', /30,000/.test(advText), advText.slice(0, 160))

// Over-adjusting has to be refused, with the number in the message.
await setForm.locator('select').first().selectOption({ index: 1 })
await setForm.locator('input[type="number"]').first().fill('99999')
await setForm.locator('button', { hasText: 'Adjust' }).click()
await p.waitForTimeout(600)
const toast = await p.locator('body').innerText()
ok('taking out more than is left is refused', /Only 30000.00 is left/.test(toast), toast.slice(-160).replace(/\n/g, ' '))
ok('and nothing was written', (await ls('pl_corp_adjustments')).length === 1)

// ── 5. Payroll ──
console.log('\n── PAYROLL ──')
await tab('Payroll')
ok('the tab starts empty', /Nobody on payroll yet/.test(await main()))
const payForm = p.locator('#main-content form').first()
await payForm.locator('input').first().fill('Sunil Rao')
await payForm.locator('input').nth(1).fill('emp01')
await payForm.locator('input[type="number"]').first().fill('30000')
await payForm.locator('input[type="number"]').nth(1).fill('12000')
await payForm.locator('button', { hasText: 'Add employee' }).click()
await p.waitForTimeout(700)
ok('the employee is stored', (await ls('pl_corp_employees')).length === 1)
const payText = await main()
// This is the join that was broken: a payslip carries employee_id, not the
// employee, so rendering s.employee.name threw on the first row.
ok('the payslip names the employee', /Sunil Rao/.test(payText), payText.slice(0, 200))
ok('the code shows too', /EMP01/.test(payText))
ok('gross is basic plus HRA', /42,000/.test(payText))
// PF is 12% of basic capped at a 15,000 wage → 1,800. ESI does not apply above
// a 21,000 gross. Both come from the library; the point is that they arrive.
ok('PF is deducted at the statutory rate', /1,800/.test(payText), payText.slice(0, 260))
ok('and the deposit line is shown', /To deposit this month/.test(payText))

// ── 6. Where the three ledgers meet ──
console.log('\n── AN EMPLOYEE ADVANCE RECOVERED IN PAYROLL ──')
await tab('Advances')
await p.locator('input[placeholder="Ravi Contractors"]').fill('Sunil Rao')
await p.locator('#main-content form').first().locator('select').first().selectOption('employee')
await p.locator('#main-content form').first().locator('input[type="number"]').first().fill('5000')
await p.locator('button', { hasText: 'Record advance' }).click()
await p.waitForTimeout(600)
await tab('Payroll')
let recText = await main()
ok('payroll notices the outstanding employee advance', /Recover advances in this run/.test(recText), recText.slice(0, 200))
ok('but does not recover it unasked', !/5,000/.test(recText) && /40,000/.test(recText))
await p.locator('#main-content input[type="checkbox"]').first().check()
await p.waitForTimeout(400)
recText = await main()
ok('ticking it deducts the advance', /5,000/.test(recText), recText.slice(0, 300))
// 42,000 gross less PF 1,800, professional tax 200 and the 5,000 advance.
ok('and take-home drops by that much', /35,000/.test(recText) && !/40,000/.test(recText), recText.slice(0, 400))
await p.locator('button', { hasText: 'Close ' }).click()
await p.waitForTimeout(700)
const adjustments = await ls('pl_corp_adjustments')
ok('closing it writes the adjustment', adjustments.length === 2, `${adjustments.length}`)
ok('against this payroll run', /^payroll:\d{4}-\d{2}$/.test(adjustments[1]?.against || ''), adjustments[1]?.against)
await tab('Advances')
await p.waitForTimeout(300)
const after = await main()
ok('and the employee advance is gone from the outstanding list', !/Sunil Rao/.test(after), after.slice(0, 200))

// ── 7. Consolidated view ──
console.log('\n── CONSOLIDATED ──')
// The all-companies option only exists once there are two to consolidate.
await p.evaluate(() => {
  const list = JSON.parse(localStorage.getItem('pl_corp_entities'))
  list.push({ id: 'ent-test-2', name: 'Acme Logistics Pvt Ltd', registration: '', gstin: '', currency: 'INR', fyStartMonth: 4, created_at: new Date().toISOString() })
  localStorage.setItem('pl_corp_entities', JSON.stringify(list))
  const m = JSON.parse(localStorage.getItem('pl_corp_members'))
  m.push({ id: 'm2', entity_id: 'ent-test-2', user_id: 'local-user', email: '', role: 'owner', department_id: null, created_at: new Date().toISOString() })
  localStorage.setItem('pl_corp_members', JSON.stringify(m))
})
await p.goto(`${B}/operations`, { waitUntil: 'networkidle' })
await p.waitForTimeout(500)
await p.locator('select[aria-label="Switch company"]').selectOption('__all__')
await p.waitForTimeout(600)
ok('all-companies says these are kept per company', /Pick one company/.test(await main()), (await main()).slice(0, 160))
await p.locator('select[aria-label="Switch company"]').selectOption('ent-test-2')
await p.waitForTimeout(600)
const other = await main()
ok('the second company has its own empty books', /No items yet/.test(other) && !/Cement/.test(other), other.slice(0, 200))

// ── 8. Layout and accessibility ──
console.log('\n── LAYOUT ──')
await p.locator('select[aria-label="Switch company"]').selectOption('ent-test-1')
await p.waitForTimeout(500)
ok('switching back brings the first company\u2019s stock with it', /Cement/.test(await main()))
const h1s = await p.locator('#main-content h1').count()
ok('exactly one h1', h1s === 1, `${h1s}`)
for (const name of ['Stock', 'Advances', 'Payroll']) {
  await tab(name)
  const unlabelled = await p.evaluate(() =>
    [...document.querySelectorAll('#main-content input,#main-content select,#main-content textarea')]
      .filter((el) => el.type !== 'hidden' && el.offsetParent !== null)
      .filter((el) => !(el.getAttribute('aria-label') || el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`))))
      .map((el) => el.outerHTML.slice(0, 60)))
  ok(`every control on ${name} is labelled`, unlabelled.length === 0, unlabelled.join(' | '))
}
await p.setViewportSize({ width: 390, height: 800 })
await p.waitForTimeout(400)
for (const name of ['Stock', 'Advances', 'Payroll']) {
  await tab(name)
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ok(`no sideways scroll on ${name} on a phone`, overflow <= 2, `${overflow}px`)
}

// ── 9. The company's costs in the report ──
// Stock and payroll were their own page and nothing else knew about them, so a
// company's books were two sets of numbers that never met.
console.log('\n── STOCK AND PAYROLL IN THE REPORT ──')
await p.setViewportSize({ width: 1440, height: 1000 })
await p.goto(`${B}/reports`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
let rep = await main()
ok('the report has a section for what the company cost', /What the company cost/.test(rep), rep.slice(-300))
ok('it names the company', /Acme Industries/.test(rep))
// 40 bags in at 350, 35 issued: 5 left at the average, so 1,750 on hand.
ok('stock on hand is valued', /1,750/.test(rep), rep.slice(-700))
ok('and what was used up is stated', /12,250/.test(rep), rep.slice(-700))
ok('payroll cost to company is there', /43,800/.test(rep), rep.slice(-500))
// 50,000 to Ravi less the 20,000 set against a bill, plus 5,000 to Sunil that
// payroll recovered in full: 55,000 out, 25,000 back, 30,000 still owed.
ok('advances are reported too', /ADVANCES/.test(rep), rep.slice(-900))
ok('what went out is stated', /55,000/.test(rep), rep.slice(-900))
ok('what came back is stated', /25,000/.test(rep), rep.slice(-900))
ok('and what is still owed', /30,000/.test(rep), rep.slice(-900))
ok('an advance is not counted as a cost', /An advance is not a cost/.test(rep))
ok('the settled one is not still listed', /No due date\t1\t₹30,000/.test(rep), rep.slice(-700))
ok('with no range it answers for this month', /for this month/.test(rep))
ok('and admits it is not a record of past runs', /no history of past payroll runs/.test(rep))
ok('one month needs no month-by-month table', !/MONTH\tSTAFF/.test(rep))

// A range turns it into a month-by-month statement. Built from today so the
// suite keeps working next month.
const monthsBack = (n) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 7) }
const [m2, m1, m0] = [monthsBack(2), monthsBack(1), monthsBack(0)]
await p.goto(`${B}/reports?from=${m2}-01&to=${m0}-28`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
rep = await main()
ok('a range gives a month for each', [m2, m1, m0].every((m) => rep.includes(m)), rep.slice(-900))
ok('three months of payroll cost more than one', /1,31,400/.test(rep), rep.slice(-900))
ok('and the wording follows the filter', /for the period above/.test(rep))

// A range running into next year is not a forecast. Months the company has not
// reached are dropped, and the card says it dropped them.
const ahead = (n) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 7) }
await p.goto(`${B}/reports?from=${m0}-01&to=${ahead(3)}-28`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
rep = await main()
ok('months still to come are left out', !rep.includes(ahead(1)) && !rep.includes(ahead(3)), rep.slice(-500))
ok('and it says it left them out', /still to come, are left out/.test(rep), rep.slice(-400))

// Stock is dated, so an end date before the movements is a real answer.
await p.goto(`${B}/reports?from=2020-01-01&to=2020-12-31`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
rep = await main()
ok('a period before anything happened shows no stock', /ON HAND\n₹0/.test(rep), rep.slice(-600))
ok('and no payroll section, because nobody was employed then', !/ON PAYROLL/.test(rep), rep.slice(-600))

// An advance past the day it was expected back is the one thing in this card a
// finance team acts on, so it gets said in words rather than left in a table.
await p.goto(`${B}/operations`, { waitUntil: 'networkidle' })
await p.waitForTimeout(500)
await tab('Advances')
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
await p.locator('input[placeholder="Ravi Contractors"]').fill('Late Vendor')
const overdueForm = p.locator('#main-content form').first()
await overdueForm.locator('input[type="number"]').first().fill('12000')
await overdueForm.locator('input[type="date"]').first().fill(yesterday)
await p.locator('button', { hasText: 'Record advance' }).click()
await p.waitForTimeout(600)
await p.goto(`${B}/reports`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
rep = await main()
ok('an advance past its date is called out', /past the date it was expected back/.test(rep), rep.slice(-800))
ok('by how much', /₹12,000 is past the date/.test(rep), rep.slice(-800))
ok('and the ladder ages it', /1–30 days/.test(rep), rep.slice(-800))
ok('the total owed grows by it', /42,000/.test(rep), rep.slice(-800))

// The year-end PDF has to carry them too.
await p.goto(`${B}/reports`, { waitUntil: 'networkidle' })
await p.waitForTimeout(500)
const pdf = await Promise.all([
  p.waitForEvent('download'),
  p.locator('button', { hasText: 'Year-end PDF' }).click(),
]).then(([d]) => d)
const pdfPath = `${TMP}/year-end.pdf`
await pdf.saveAs(pdfPath)
const raw = await readFile(pdfPath, 'latin1')
ok('the year-end PDF is produced', raw.startsWith('%PDF'), raw.slice(0, 8))
ok('and is not an empty shell', raw.length > 4000, `${raw.length} bytes`)

// ── 10. A backup that actually carries the company ──
// exportCorporate existed and was never called, so until now a backup held only
// the personal books and restoring one onto a new browser lost every company,
// every item, every advance and every employee in it.
console.log('\n── BACKUP AND RESTORE ──')
await p.setViewportSize({ width: 1440, height: 1000 })
await p.goto(`${B}/exports`, { waitUntil: 'networkidle' })
await p.waitForTimeout(400)
const dl = await Promise.all([
  p.waitForEvent('download'),
  p.locator('button', { hasText: 'Download backup' }).click(),
]).then(([d]) => d)
const file = `${TMP}/ops-backup.json`
await dl.saveAs(file)
const payload = JSON.parse(await readFile(file, 'utf8'))
ok('the backup carries the companies', payload.corporate?.entities?.length === 2, `${payload.corporate?.entities?.length}`)
ok('and the stock', payload.corporate?.items?.length === 1)
ok('and the movements', payload.corporate?.movements?.length === 3, `${payload.corporate?.movements?.length}`)
ok('and the advances', payload.corporate?.advances?.length === 3, `${payload.corporate?.advances?.length}`)
ok('and the employees', payload.corporate?.employees?.length === 1)
ok('and not the active-company pointer, which is this browser’s', payload.corporate?.active === undefined)

// Wipe the corporate side only, the way a new browser would have it.
await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('pl_corp')).forEach((k) => localStorage.removeItem(k)))
await p.goto(`${B}/operations`, { waitUntil: 'networkidle' })
await p.waitForTimeout(500)
ok('with the corporate side wiped, the page is back to asking for a company', /Add a company first/.test(await main()))

await p.goto(`${B}/import`, { waitUntil: 'networkidle' })
await p.waitForTimeout(400)
await p.locator('input[accept="application/json,.json"]').setInputFiles(file)
await p.waitForTimeout(1500)
ok('the restore says how many company records came back', /company records/.test(await main()), (await main()).slice(0, 300))
ok('the companies are back', (await ls('pl_corp_entities')).length === 2)
await p.goto(`${B}/operations`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
const back = await main()
ok('and the stock is back with it', /Cement 50kg/.test(back), back.slice(0, 200))
await tab('Payroll')
ok('and the employee', /Sunil Rao/.test(await main()))

// Doing it twice must not double the books.
await p.goto(`${B}/import`, { waitUntil: 'networkidle' })
await p.waitForTimeout(400)
await p.locator('input[accept="application/json,.json"]').setInputFiles(file)
await p.waitForTimeout(1500)
ok('restoring the same file again adds no companies', (await ls('pl_corp_entities')).length === 2)
ok('nor duplicate stock', (await ls('pl_corp_items')).length === 1)

console.log(`\n${pass} passed, ${fail} failed`)
console.log('errors:', errs.length ? errs.slice(0, 5) : 'none')
await b.close()
if (fail) process.exitCode = 1
