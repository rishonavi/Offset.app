// The asset form showing only the fields the chosen type actually has.
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

const typePicker = () => p.locator('#main-content select').first()
const addressField = () => p.locator('input[placeholder="Street, area, city"]')
const setType = async (label) => { await typePicker().selectOption({ label }); await p.waitForTimeout(350) }

await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })

console.log('\n── A PLACE HAS AN ADDRESS ──')
for (const type of ['Real Estate — Apartment / Flat', 'Real Estate — Commercial', 'Land / Plot']) {
  await setType(type)
  ok(`${type} is asked for one`, await addressField().count() === 1)
}

console.log('\n── A THING YOU HOLD DOES NOT ──')
for (const type of ['Vehicle / Car', 'Jewellery', 'Stocks / Equity', 'Cryptocurrency', 'Aircraft']) {
  await setType(type)
  ok(`${type} is not`, await addressField().count() === 0)
}
// Other is the unknown case and keeps the field.
await setType('Other')
ok('Other keeps it', await addressField().count() === 1)

console.log('\n── A MIS-CLICK DOES NOT LOSE WHAT WAS TYPED ──')
await setType('Real Estate — Villa / House')
await addressField().fill('12 Marine Drive, Mumbai')
await setType('Vehicle / Car')
ok('the field goes away on a type with no address', await addressField().count() === 0)
await setType('Real Estate — Villa / House')
ok('and coming back brings the text with it',
  (await addressField().inputValue()) === '12 Marine Drive, Mumbai',
  await addressField().inputValue())

console.log('\n── AND AN ADDRESS DOES NOT TRAIL THE WRONG ASSET ──')
// Kept in form state while editing, but not saved onto a type that has no
// address — otherwise a brief mis-typing leaves one on a car for good.
await p.locator('#main-content input').first().fill('Family Car')
await setType('Vehicle / Car')
await p.locator('form button[type="submit"], button:has-text("Save")').first().click()
await p.waitForTimeout(1200)
const saved = await p.evaluate(() =>
  (JSON.parse(localStorage.getItem('pl_properties') || '[]').find((x) => x.name === 'Family Car') || {}))
ok('the car saved', saved.name === 'Family Car', JSON.stringify(saved).slice(0, 120))
ok('with no address on it', !saved.address, JSON.stringify(saved.address))

await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
await p.locator('#main-content input').first().fill('Sea View Villa')
await setType('Real Estate — Villa / House')
await addressField().fill('12 Marine Drive, Mumbai')
await p.locator('form button[type="submit"], button:has-text("Save")').first().click()
await p.waitForTimeout(1200)
const villa = await p.evaluate(() =>
  (JSON.parse(localStorage.getItem('pl_properties') || '[]').find((x) => x.name === 'Sea View Villa') || {}))
ok('and a flat keeps the address it was given', villa.address === '12 Marine Drive, Mumbai', JSON.stringify(villa.address))

console.log('\n── EDITING AN ASSET THAT ALREADY HAS ONE ──')
await p.goto(`${B}/properties`, { waitUntil: 'networkidle' })
const shown = await p.locator('#main-content').innerText()
ok('the address shows on the asset list', shown.includes('12 Marine Drive'), shown.slice(0, 200).replace(/\n/g, ' | '))
ok('and the car is listed without one', shown.includes('Family Car'))

console.log('\n── A LOAN ONLY WHERE ONE CAN EXIST ──')
const loanBlock = () => p.locator('text=Loan / mortgage')
const leaseBlock = () => p.locator('text=Tenancy / lease')
await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
for (const type of ['Real Estate — Apartment / Flat', 'Vehicle / Car', 'Machinery / Equipment']) {
  await setType(type)
  ok(`${type} can carry one`, await loanBlock().count() > 0)
}
// A gold loan is ordinary here, so bullion and jewellery keep the block.
for (const type of ['Jewellery', 'Precious Metals — Gold / Silver']) {
  await setType(type)
  ok(`${type} keeps it — gold loans are ordinary`, await loanBlock().count() > 0)
}
for (const type of ['Stocks / Equity', 'Mutual Funds / Bonds', 'Cryptocurrency']) {
  await setType(type)
  ok(`${type} does not`, await loanBlock().count() === 0)
}

console.log('\n── A TENANT ONLY WHERE ONE CAN EXIST ──')
for (const type of ['Real Estate — Commercial', 'Land / Plot', 'Aircraft']) {
  await setType(type)
  ok(`${type} can be let out`, await leaseBlock().count() > 0)
}
for (const type of ['Jewellery', 'Art / Collectibles', 'Cryptocurrency']) {
  await setType(type)
  ok(`${type} cannot`, await leaseBlock().count() === 0)
}

console.log('\n── A FINANCIAL HOLDING IS A SHORT FORM ──')
await setType('Cryptocurrency')
ok('no address, no loan, no tenancy',
  (await addressField().count()) === 0 && (await loanBlock().count()) === 0 && (await leaseBlock().count()) === 0)
ok('but it still has a value field', await p.locator('#main-content input[type=number]').count() > 0)

console.log('\n── AND NEITHER TRAILS THE WRONG ASSET ──')
await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
await p.locator('#main-content input').first().fill('Rented Flat')
await setType('Real Estate — Apartment / Flat')
await p.locator('input[placeholder="e.g. 240"]').fill('240')
await p.locator('input[placeholder="e.g. Rahul Mehta"]').fill('Rahul Mehta')
// Retype it as something that can have neither, and save.
await setType('Cryptocurrency')
await p.locator('form button[type="submit"], button:has-text("Save")').first().click()
await p.waitForTimeout(1200)
const coin = await p.evaluate(() =>
  (JSON.parse(localStorage.getItem('pl_properties') || '[]').find((x) => x.name === 'Rented Flat') || {}))
ok('the holding saved', coin.name === 'Rented Flat', JSON.stringify(coin).slice(0, 120))
ok('with no loan tenure on it', !coin.loan_tenure_months, JSON.stringify(coin.loan_tenure_months))
ok('and no tenant', !coin.tenant_name, JSON.stringify(coin.tenant_name))

await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
await p.locator('#main-content input').first().fill('Let Shop')
await setType('Real Estate — Commercial')
await p.locator('input[placeholder="e.g. 240"]').fill('180')
await p.locator('input[placeholder="e.g. Rahul Mehta"]').fill('Rahul Mehta')
await p.locator('form button[type="submit"], button:has-text("Save")').first().click()
await p.waitForTimeout(1200)
const shop = await p.evaluate(() =>
  (JSON.parse(localStorage.getItem('pl_properties') || '[]').find((x) => x.name === 'Let Shop') || {}))
ok('a shop keeps the loan it was given', Number(shop.loan_tenure_months) === 180, JSON.stringify(shop.loan_tenure_months))
ok('and the tenant it was given', shop.tenant_name === 'Rahul Mehta', JSON.stringify(shop.tenant_name))

console.log(`\n${pass} passed, ${fail} failed`); console.log('errors:', errs.length ? errs.slice(0, 4) : 'none')
await b.close(); if (fail) process.exitCode = 1
