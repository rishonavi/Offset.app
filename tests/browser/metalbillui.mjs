// Filling a metal holding from the purchase bill.
//
// The reader itself is a Gemini call and cannot run here, so /api/scan-receipt
// is answered with what a jeweller's bill actually yields. What is under test
// is everything after that: the conversions, which fields get written, and what
// the screen says about the ones it left out.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const open = async (reply, status = 200) => {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 }, serviceWorkers: 'block' })
  const p = await ctx.newPage(); p.setDefaultTimeout(30000)
  await p.route('**/api/scan-receipt', (r) =>
    r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(reply) }))
  await p.route('**/fonts.g**/**', (r) => r.abort())
  await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
  await p.getByRole('radio', { name: 'Jewellery', exact: true }).check()
  await p.waitForTimeout(400)
  return { p, ctx }
}
const attach = async (p) => {
  await p.locator('input[aria-label="Purchase bill to read"]').setInputFiles({
    name: 'tanishq-bill.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('\xff\xd8\xff pretend photo'),
  })
  await p.waitForTimeout(2000)
}
// Fields are labelled by the text of their own <label>; matching on that
// rather than on position keeps the assertions readable when the form changes.
const val = (p, label) =>
  p.evaluate((want) => {
    const el = [...document.querySelectorAll('#main-content input, #main-content select')].find(
      (n) => (n.closest('label')?.innerText || '').split('\n')[0].trim().toUpperCase() === want.toUpperCase(),
    )
    return el ? el.value : null
  }, label)

console.log('\n── A 22K CHAIN, QUOTED PER GRAM ──')
{
  const { p, ctx } = await open({
    metal: 'gold', gross_weight_g: 12.4, stone_weight_g: 0.9, net_weight_g: 11.5,
    purity_karat: 22, rate_amount: 7200, rate_basis: 'per_gram',
    metal_value: 82800, making_charges: 9936, tax: 2782, total: 95518,
    vendor: 'Tanishq', date: '2026-07-03',
  })
  ok('the form offers to read a bill', await p.locator('button:has-text("Fill from a purchase bill")').count() === 1)
  await attach(p)
  ok('the net weight is used, not the gross', (await val(p, 'How much you hold')) === '11.5', await val(p, 'How much you hold'))
  const purity = await val(p, 'Purity')
  ok('22K became 916', purity === '916', purity)
  // The whole point: a per-gram rate stored as per-10-grams would be out by ten.
  ok('the per-gram rate became a per-10g rate', (await val(p, 'Market rate')) === '72000', await val(p, 'Market rate'))
  ok('the value is what was paid', (await val(p, 'Asset value')) === '95518', await val(p, 'Asset value'))
  const text = await p.locator('#main-content').innerText()
  ok('the breakdown is shown', /Read from the bill/.test(text))
  ok('and making charges are named as not part of the metal', /not recovered on resale/.test(text), text.slice(0, 200))
  await ctx.close()
}

console.log('\n── A BILL THAT DOES NOT SAY WHAT THE RATE IS PER ──')
{
  const { p, ctx } = await open({
    metal: 'gold', net_weight_g: 10, purity_karat: 22, rate_amount: 7200, rate_basis: null, total: 75000,
  })
  await attach(p)
  ok('the weight still comes through', (await val(p, 'How much you hold')) === '10')
  // Guessing between per-gram and per-10-gram is a coin flip on a factor of ten.
  ok('the rate is left blank rather than guessed', (await val(p, 'Market rate')) === '', await val(p, 'Market rate'))
  ok('and the screen says why', /wrong by ten/.test(await p.locator('#main-content').innerText()))
  await ctx.close()
}

console.log('\n── WHEN THE READER IS NOT AVAILABLE ──')
{
  const { p, ctx } = await open({ error: 'ai_not_configured' }, 501)
  await attach(p)
  const text = await p.locator('#main-content').innerText()
  ok('it says the key is missing', /Gemini key/.test(text), text.slice(0, 200))
  ok('and tells you to fill it in by hand', /by hand/.test(text))
  ok('without inventing any numbers', (await val(p, 'How much you hold')) === '', await val(p, 'How much you hold'))
  await ctx.close()
}

console.log('\n── THE CONTROL BELONGS TO METAL ASSETS ──')
{
  const ctx = await b.newContext({ serviceWorkers: 'block' })
  const p = await ctx.newPage()
  await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
  await p.getByRole('radio', { name: 'Vehicle / Car', exact: true }).check()
  await p.waitForTimeout(400)
  ok('a car is not offered a metal bill', await p.locator('button:has-text("Fill from a purchase bill")').count() === 0)
  await p.getByRole('radio', { name: 'Gold / Silver', exact: true }).check()
  await p.waitForTimeout(400)
  ok('bullion is', await p.locator('button:has-text("Fill from a purchase bill")').count() === 1)
  await ctx.close()
}

console.log(`\n${pass} passed, ${fail} failed`)
await b.close(); if (fail) process.exitCode = 1
