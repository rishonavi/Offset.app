// What the attachment pickers take, and how demo mode behaves when the
// browser's storage will not hold it.
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

const picker = () => p.locator('input[type=file]:not([capture])').first()
const clearAttachment = async () => { await p.locator('button[title="Remove receipt"]').first().click(); await p.waitForTimeout(400) }

// An expense form needs an asset to exist before it will render.
await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
await p.locator('input').first().fill('Sea View Villa')
await p.locator('form button[type="submit"], button:has-text("Save")').first().click()
await p.waitForTimeout(700)

console.log('\n── WHAT THE PICKER TAKES ──')
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
const accept = await picker().getAttribute('accept')
ok('Word is accepted', /\.docx?\b/.test(accept), accept)
ok('Excel is accepted', /\.xlsx?\b/.test(accept), accept)
ok('images and PDF still are', /image\/\*/.test(accept) && /\.pdf/.test(accept), accept)
const camera = await p.locator('input[type=file][capture]').first().getAttribute('accept')
// "Take a photo" opens a camera; offering it a spreadsheet would be nonsense.
ok('the camera button stays images-only', camera === 'image/*', camera)

console.log('\n── THE SCANNER IS ONLY OFFERED WHERE IT CAN WORK ──')
await picker().setInputFiles({ name: 'invoice-draft.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('PK\x03\x04 pretend docx') })
await p.waitForTimeout(500)
ok('a Word file attaches', await p.locator('text=invoice-draft.docx').count() > 0)
ok('and is offered no scan it cannot do', await p.locator('button:has-text("Scan to auto-fill")').count() === 0)
await clearAttachment()
await picker().setInputFiles({ name: 'bill.png', mimeType: 'image/png', buffer: Buffer.from('\x89PNG fake') })
await p.waitForTimeout(500)
ok('an image is still offered the scanner', await p.locator('button:has-text("Scan to auto-fill")').count() > 0)

console.log('\n── WHEN THE BROWSER WILL NOT HOLD IT ──')
// localStorage is ~5MB for the whole ledger, so an oversized attachment is
// refused by name rather than failing with the browser's own quota wording.
await clearAttachment()
await picker().setInputFiles({ name: 'huge-scan.png', mimeType: 'image/png', buffer: Buffer.alloc(2 * 1024 * 1024, 1) })
await p.locator('#main-content input[type=number]').first().fill('4200')
await p.locator('form button[type="submit"]').first().click()
await p.waitForTimeout(1200)
const msg = (await p.locator('#main-content').innerText()).replace(/\n+/g, ' ')
ok('the file is named', /huge-scan\.png/.test(msg), msg.slice(0, 160))
ok('its size is given', /2\.0MB/.test(msg), msg.slice(0, 160))
ok('and a way out is offered', /Supabase/.test(msg), msg.slice(0, 160))
ok('no raw browser quota wording reaches the user', !/exceeded the quota|QuotaExceeded/i.test(msg), msg.slice(0, 160))

console.log('\n── AND THE ORDINARY PATH IS UNTOUCHED ──')
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.locator('#main-content input[type=number]').first().fill('4200')
await p.locator('form button[type="submit"]').first().click()
await p.waitForTimeout(1200)
await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' })
ok('an entry with no attachment saves', await p.locator('text=4,200').count() > 0)
await p.reload({ waitUntil: 'networkidle' })
ok('and is still there after a reload', await p.locator('text=4,200').count() > 0)

console.log(`\n${pass} passed, ${fail} failed`); console.log('errors:', errs.length ? errs.slice(0, 4) : 'none')
await b.close(); if (fail) process.exitCode = 1
