// What the attachment pickers take, and how demo mode behaves when the
// browser's storage will not hold it.
import { chromium } from './_playwright.mjs'
import { readFileSync } from 'node:fs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true })
const p = await ctx.newPage(); p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 160)) })
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('ERR_FAILED') && !t.includes('404')) errs.push('CONSOLE ' + t.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
p.on('dialog', (d) => d.accept())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const picker = () => p.locator('input[type=file]:not([capture])').first()
const clearAttachment = async () => { await p.locator('button[title="Remove attachment"]').first().click(); await p.waitForTimeout(400) }

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

console.log('\n── A RECEIPT THE OLD STORAGE COULD NOT HOLD ──')
// Attachments used to be base64 inside localStorage, one ~5MB budget shared
// with the whole ledger, so this file would have been refused outright. It now
// goes to IndexedDB and the row keeps only a token.
await clearAttachment()
await picker().setInputFiles({ name: 'big-scan.png', mimeType: 'image/png', buffer: Buffer.alloc(3 * 1024 * 1024, 1) })
await p.locator('#main-content input[type=number]').first().fill('4200')
await p.locator('form button[type="submit"]').first().click()
await p.waitForTimeout(2000)
const afterSave = (await p.locator('#main-content').innerText()).replace(/\n+/g, ' ')
ok('a 3MB receipt saves', !/refused|full|quota/i.test(afterSave), afterSave.slice(0, 160))

const stored = await p.evaluate(() =>
  (JSON.parse(localStorage.getItem('pl_expenses') || '[]').find((e) => Number(e.amount) === 4200) || {}).receipt_url)
ok('the row keeps a token, not the file', /^idb:/.test(stored || ''), String(stored).slice(0, 60))
ok('and the token names the file, so a PDF can still be told from an image',
  /big-scan\.png/.test(decodeURIComponent(stored || '')), String(stored).slice(0, 80))

const ledgerBytes = await p.evaluate(() => (localStorage.getItem('pl_expenses') || '').length)
// The point of the change: the ledger no longer grows with the attachment.
ok('the ledger stays small next to a 3MB file', ledgerBytes < 100000, `${ledgerBytes} bytes`)

const inIdb = await p.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('offset-attachments', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  const size = await new Promise((res) => {
    const tx = db.transaction('blobs', 'readonly')
    const all = tx.objectStore('blobs').getAll()
    tx.oncomplete = () => res((all.result || []).reduce((n, rec) => n + (rec.blob?.size || 0), 0))
  })
  db.close()
  return size
})
ok('and the file really is in IndexedDB', inIdb >= 3 * 1024 * 1024, `${inIdb} bytes`)

// Two more, because the old limit was reached on the second or third receipt.
for (const n of [2, 3]) {
  await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
  await p.locator('input[type=file]:not([capture])').first().setInputFiles({
    name: `scan-${n}.png`, mimeType: 'image/png', buffer: Buffer.alloc(3 * 1024 * 1024, n) })
  await p.locator('#main-content input[type=number]').first().fill(`70${n}0`)
  await p.locator('form button[type="submit"]').first().click()
  await p.waitForTimeout(2000)
}
const saved = await p.evaluate(() =>
  JSON.parse(localStorage.getItem('pl_expenses') || '[]').filter((e) => /^idb:/.test(e.receipt_url || '')).length)
ok('three 3MB receipts all save, where two used to be the limit', saved === 3, `${saved} saved`)

console.log('\n── AND THE ORDINARY PATH IS UNTOUCHED ──')
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.locator('#main-content input[type=number]').first().fill('4200')
await p.locator('form button[type="submit"]').first().click()
await p.waitForTimeout(1200)
await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' })
ok('an entry with no attachment saves', await p.locator('text=4,200').count() > 0)
await p.reload({ waitUntil: 'networkidle' })
ok('and is still there after a reload', await p.locator('text=4,200').count() > 0)

console.log('\n── AND IT CAN STILL BE LOOKED AT ──')
// A token is only useful if it resolves back to the file. This is the path a
// data URL used to make trivial and no longer does.
await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' })
const viewButton = p.locator('button[title="View receipt"], button[title="View proof"]').first()
ok('an entry with a receipt offers to show it', await viewButton.count() > 0)
if (await viewButton.count()) {
  await viewButton.click()
  await p.waitForTimeout(1500)
  const shown = await p.evaluate(() => {
    const el = document.querySelector('img[src^="blob:"], iframe[src^="blob:"]')
    return el ? el.getAttribute('src').slice(0, 5) : null
  })
  ok('and resolves the token to something displayable', shown === 'blob:', String(shown))
  await p.keyboard.press('Escape')
}

console.log('\n── A BACKUP STILL CARRIES THE FILE ──')
// The row holds a token that means nothing on another device, so the backup has
// to inline the file. Getting this wrong loses every receipt on restore, and
// silently — the backup would still look complete.
// Backup lives with the other ways of moving data, not with the summaries.
await p.goto(`${B}/exports`, { waitUntil: 'networkidle' })
const backupBtn = p.locator('button', { hasText: /Download backup/i }).first()
await backupBtn.waitFor({ state: 'visible' }).catch(() => {})
ok('there is a backup control', await backupBtn.count() > 0)
if (await backupBtn.count()) {
  const [download] = await Promise.all([
    p.waitForEvent('download', { timeout: 30000 }),
    backupBtn.click(),
  ])
  const path = await download.path()
  const backup = JSON.parse(readFileSync(path, 'utf8'))
  const withReceipts = (backup.expenses || []).filter((e) => e.receipt_url)
  ok('the backup has the entries that carry receipts', withReceipts.length >= 3, `${withReceipts.length}`)
  ok('and every receipt travels as the file, not as a token',
    withReceipts.every((e) => String(e.receipt_url).startsWith('data:')),
    withReceipts.map((e) => String(e.receipt_url).slice(0, 12)).join(' '))
}

console.log(`\n${pass} passed, ${fail} failed`); console.log('errors:', errs.length ? errs.slice(0, 4) : 'none')
await b.close(); if (fail) process.exitCode = 1
