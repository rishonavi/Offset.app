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

const addressField = () => p.locator('input[placeholder="Street, area, city"]')
// The type is a grid of radio cards rather than a dropdown now. Addressed
// through the accessibility tree on purpose: if the label does not name the
// radio, keyboard and screen-reader users cannot pick a type either, so a
// selector that still works is itself part of what is being checked.
const SHORT = (type) => type.split(' — ')[1] || type
const setType = async (type) => {
  await p.getByRole('radio', { name: SHORT(type), exact: true }).check()
  await p.waitForTimeout(350)
}
// Loan, tenancy and notes start collapsed — they are optional, and four inputs
// sitting open is four inputs you feel you owe an answer to.
const openSection = async (title) => {
  const head = p.locator('button', { hasText: title }).first()
  if ((await head.getAttribute('aria-expanded')) === 'false') { await head.click(); await p.waitForTimeout(250) }
}

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
await openSection('Loan / mortgage')
await p.locator('input[placeholder="e.g. 240"]').fill('240')
await openSection('Tenancy / lease')
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
await openSection('Loan / mortgage')
await p.locator('input[placeholder="e.g. 240"]').fill('180')
await openSection('Tenancy / lease')
await p.locator('input[placeholder="e.g. Rahul Mehta"]').fill('Rahul Mehta')
await p.locator('form button[type="submit"], button:has-text("Save")').first().click()
await p.waitForTimeout(1200)
const shop = await p.evaluate(() =>
  (JSON.parse(localStorage.getItem('pl_properties') || '[]').find((x) => x.name === 'Let Shop') || {}))
ok('a shop keeps the loan it was given', Number(shop.loan_tenure_months) === 180, JSON.stringify(shop.loan_tenure_months))
ok('and the tenant it was given', shop.tenant_name === 'Rahul Mehta', JSON.stringify(shop.tenant_name))

console.log('\n── THE FORM ASKS FOR ONE THING ──')
await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(500)
let text = await p.locator('#main-content').innerText()
ok('it says only the name is needed', /Only the name is needed/.test(text), text.slice(-200))
ok('the loan block starts shut', (await p.locator('input[placeholder="e.g. 240"]').count()) === 0)
ok('so does the tenancy', (await p.locator('input[placeholder="e.g. Rahul Mehta"]').count()) === 0)
ok('and the notes', (await p.locator('#main-content textarea').count()) === 0)
// The two most-used optional fields stay in the open: hiding "what is it worth"
// behind a disclosure would be tidiness at the cost of the common case.
ok('but what it is worth is right there', (await p.locator('#main-content input[type=number]').count()) >= 2)
await p.locator('#main-content input').first().fill('Sea View')
await p.waitForTimeout(300)
ok('and once it is named, it says that is enough',
  /That is enough to save/.test(await p.locator('#main-content').innerText()))

console.log('\n── THE TYPE PICKER ──')
ok('every type is on the page, not inside a dropdown',
  (await p.getByRole('radio').count()) === 15, `${await p.getByRole('radio').count()}`)
ok('and it is a real radio group', (await p.locator('#main-content fieldset').count()) === 1)
ok('one of them is already chosen', (await p.locator('#main-content input[type=radio]:checked').count()) === 1)
// A tile is a tap target on a phone before it is a decoration.
const tile = await p.getByRole('radio', { name: 'Vehicle / Car', exact: true }).evaluate(
  (el) => { const r = el.closest('label').getBoundingClientRect(); return { w: r.width, h: r.height } })
ok('a tile is big enough to hit', tile.h >= 44 && tile.w >= 44, JSON.stringify(tile))
// Keyboard: arrow keys move within a radio group, which a grid of buttons
// would not give for free.
await p.getByRole('radio', { name: 'Apartment / Flat', exact: true }).focus()
await p.keyboard.press('ArrowRight')
await p.waitForTimeout(250)
ok('arrow keys move through the types',
  await p.getByRole('radio', { name: 'Villa / House', exact: true }).isChecked())

console.log('\n── IT KNOWS WHAT YOU PICKED ──')
await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
await setType('Vehicle / Car')
ok('a car is not offered a flat as an example',
  (await p.locator('#main-content input').first().getAttribute('placeholder')) === 'e.g. BMW X5',
  await p.locator('#main-content input').first().getAttribute('placeholder'))
await setType('Jewellery')
ok('and jewellery is not offered a car',
  /bangles/.test(await p.locator('#main-content input').first().getAttribute('placeholder')))

console.log('\n── THE LOAN ANSWERS BACK ──')
await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
await setType('Real Estate — Villa / House')
await p.locator('#main-content input').first().fill('Mortgaged Villa')
await p.locator('#main-content input[type=number]').first().fill('9000000')
await openSection('Loan / mortgage')
await p.locator('input[placeholder="e.g. 8.5"]').fill('8.5')
await p.locator('input[placeholder="e.g. 240"]').fill('240')
await p.locator('#main-content input[type=number]').nth(2).fill('6000000')
await p.waitForTimeout(400)
text = await p.locator('#main-content').innerText()
// 60 lakh at 8.5% over 240 months is 52,069 a month — the same figure the
// asset page shows after saving, from the same function.
ok('the EMI appears while you are still typing', /₹52,069 a month/.test(text), text.slice(-500))
ok('in whole rupees, not to the paisa', !/52,069\.\d/.test(text))
ok('with the term in years', /for 20 years/.test(text))
ok('what it comes to in all', /₹1,24,96,560 in all/.test(text), text.slice(-400))
ok('and how much of that is interest', /₹64,96,560 of it interest/.test(text))
// The value is already on the form, so the form can say what the loan is
// against it without being asked.
ok('the loan is measured against the value', /67% of what the asset is worth/.test(text), text.slice(-300))
ok('and the shut row will carry the figure', /₹52,069 a month/.test(
  await p.locator('button', { hasText: 'Loan / mortgage' }).first().innerText()))

console.log('\n── EDITING SHOWS WHAT IS THERE ──')
await p.locator('form button[type="submit"]').first().click()
await p.waitForTimeout(1200)
const id = await p.evaluate(() =>
  (JSON.parse(localStorage.getItem('pl_properties') || '[]').find((x) => x.name === 'Mortgaged Villa') || {}).id)
ok('the asset with the loan saved', Boolean(id), String(id))
await p.goto(`${B}/properties/${id}/edit`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
// A collapsed row saying "Loan / mortgage" would hide the very numbers you
// opened the page to change.
ok('a mortgaged asset opens with its loan showing',
  (await p.locator('input[placeholder="e.g. 240"]').count()) === 1)
ok('and the tenancy it does not have stays shut',
  (await p.locator('input[placeholder="e.g. Rahul Mehta"]').count()) === 0)

console.log(`\n${pass} passed, ${fail} failed`); console.log('errors:', errs.length ? errs.slice(0, 4) : 'none')
await b.close(); if (fail) process.exitCode = 1
