// Working through what is outstanding, in batches — and not importing the same
// file twice.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const open = async () => {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
  const p = await ctx.newPage(); p.setDefaultTimeout(30000)
  const errs = []
  p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push(s.slice(0, 120)) })
  await p.route('**/fonts.g**/**', (r) => r.abort())
  // addInitScript runs on every navigation, so writing unconditionally would
  // reset the ledger each time the test moved page — and quietly undo whatever
  // the previous step had just imported.
  await p.addInitScript(() => {
    if (localStorage.getItem('pl_properties')) return
    const now = new Date().toISOString()
    localStorage.setItem('pl_properties', JSON.stringify([
      { id: 'a1', name: 'Sea View Villa', type: 'Real Estate — Apartment / Flat', created_at: now }]))
    localStorage.setItem('pl_expenses', JSON.stringify(Array.from({ length: 5 }, (_, i) => ({
      id: 'e' + i, property_id: 'a1', date: '2026-0' + (i + 1) + '-10', amount: 1000 * (i + 1),
      category: 'Utilities', vendor: 'Ravi',
      // Three outstanding, two already settled.
      status: i < 3 ? 'unpaid' : 'paid', due_date: i < 3 ? '2026-09-01' : '', created_at: now }))))
  })
  return { ctx, p, errs }
}
const badge = (p) => p.evaluate(() => {
  const link = [...document.querySelectorAll('aside nav a')].find((a) => a.innerText.trim().startsWith('Expenses'))
  return link ? link.innerText.replace('Expenses', '').trim() : ''
})

console.log('── SETTLING SEVERAL AT ONCE ──')
{
  const { ctx, p, errs } = await open()
  await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(700)
  ok('the side bar says three are outstanding', (await badge(p)).includes('3'), await badge(p))

  await p.locator('#main-content thead input[type=checkbox]').first().check()
  await p.waitForTimeout(300)
  const bar = await p.locator('#main-content').innerText()
  ok('selecting all offers to settle them', /mark 3 paid/i.test(bar), bar.split('\n').slice(0, 3).join(' | '))
  // Two of the five are already paid; offering to mark five would be a lie.
  ok('and offers only the outstanding ones', !/mark 5 paid/i.test(bar))

  await p.locator('#main-content button:has-text("Mark 3 paid")').click()
  await p.waitForTimeout(900)
  ok('the badge clears', (await badge(p)) === '', await badge(p))
  const after = await p.locator('#main-content').innerText()
  ok('and nothing is overdue any more', !/overdue/i.test(after))
  ok('it says what it did', /3 marked paid/i.test(await p.locator('body').innerText()))

  console.log('\n── AND PUTTING IT BACK ──')
  await p.locator('button:has-text("Undo")').first().click()
  await p.waitForTimeout(900)
  ok('undo restores all three', (await badge(p)).includes('3'), await badge(p))
  ok('nothing threw', errs.length === 0, errs.join(' | '))
  await ctx.close()
}

console.log('\n── NOTHING TO SETTLE, NOTHING OFFERED ──')
{
  const { ctx, p } = await open()
  await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(700)
  // The table sorts newest first, so position is not a reliable way to find a
  // settled row. Pick the one whose row has no Overdue badge.
  await p.locator('#main-content tbody tr').filter({ hasNotText: /overdue/i }).first()
    .locator('input[type=checkbox]').check()
  await p.waitForTimeout(300)
  const bar = await p.locator('#main-content').innerText()
  ok('a settled row offers no settle button', !/mark \d+ paid/i.test(bar), bar.split('\n').slice(0, 3).join(' | '))
  ok('but can still be deleted', /delete 1/i.test(bar))
  await ctx.close()
}

console.log('\n── THE SAME SPREADSHEET TWICE ──')
{
  // The ordinary mistake: you download last month's file again. Before this the
  // rows simply doubled and nothing said so.
  const { ctx, p, errs } = await open()
  const csv = 'Date,Property,Category,Amount\n2026-07-01,Sea View Villa,Utilities,4321\n'
  const file = { name: 'july.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }
  await p.goto(`${B}/import`, { waitUntil: 'networkidle' })
  await p.locator('#main-content').getByText(/From a spreadsheet/i).first().waitFor({ state: 'visible' })
  const sheetInput = p.locator('#main-content .card', { hasText: 'From a spreadsheet' })
    .locator('input[type=file]')
  await sheetInput.setInputFiles(file)
  await p.waitForTimeout(1200)
  ok('the first import lands', /imported 1 expense/i.test(await p.locator('#main-content').innerText()),
    (await p.locator('#main-content').innerText()).slice(0, 120))
  await sheetInput.setInputFiles(file)
  await p.waitForTimeout(1200)
  const msg = await p.locator('#main-content').innerText()
  ok('the second says it skipped a duplicate', /skipped 1 duplicate/i.test(msg), msg.slice(0, 160))
  await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(700)
  const count = await p.evaluate(() =>
    [...document.querySelectorAll('#main-content tbody tr')].filter((r) => /4,321/.test(r.innerText)).length)
  ok('and the row is in the books exactly once', count === 1, `${count} rows`)
  ok('nothing threw', errs.length === 0, errs.join(' | '))
  await ctx.close()
}

console.log('\n── AND THE SAME TALLY FILE TWICE ──')
{
  // An empty file returns before the duplicate check ever runs, so a suite that
  // only feeds it an empty one will pass while the real path throws. This feeds
  // a voucher — which is how "expenses is not defined" hid in a shipped build.
  const { ctx, p, errs } = await open()
  const xml = `<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
    <TALLYMESSAGE><VOUCHER VCHTYPE="Payment">
      <DATE>20260715</DATE><NARRATION>Sea View Villa</NARRATION>
      <ALLLEDGERENTRIES.LIST><LEDGERNAME>Utilities</LEDGERNAME><AMOUNT>7654</AMOUNT></ALLLEDGERENTRIES.LIST>
    </VOUCHER></TALLYMESSAGE>
  </REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`
  const file = { name: 'daybook.xml', mimeType: 'text/xml', buffer: Buffer.from(xml) }
  await p.goto(`${B}/import`, { waitUntil: 'networkidle' })
  await p.locator('#main-content').getByText(/From Tally/i).first().waitFor({ state: 'visible' })
  const tally = p.locator('#main-content .card', { hasText: 'From Tally' }).locator('input[type=file]')
  await tally.setInputFiles(file)
  await p.waitForTimeout(1200)
  const first = await p.locator('#main-content').innerText()
  ok('a voucher imports without throwing', /imported 1 expense/i.test(first), first.slice(0, 160))
  await tally.setInputFiles(file)
  await p.waitForTimeout(1200)
  ok('and the same file again is skipped', /skipped 1 duplicate/i.test(await p.locator('#main-content').innerText()),
    (await p.locator('#main-content').innerText()).slice(0, 160))
  ok('nothing threw', errs.length === 0, errs.join(' | '))
  await ctx.close()
}

console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
