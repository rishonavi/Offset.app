// Invoicing in the browser: a default format that renders, your own format
// imported and used, lines pulled from the ledger, GST, and a PDF that exists.
import { chromium } from './_playwright.mjs'
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { deflateRawSync } from 'node:zlib'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const DL = mkdtempSync(`${tmpdir()}/offset-invoice-`)
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true })
const p = await ctx.newPage(); p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 170)) })
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('ERR_FAILED') && !t.includes('404')) errs.push('CONSOLE ' + t.slice(0, 170)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
p.on('dialog', (d) => d.accept())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(() => {
  localStorage.clear()
  localStorage.setItem('pl_properties', JSON.stringify([{ id: 'p1', name: 'Sea View Villa', type: 'Real Estate — Villa / House', value: 4200000 }]))
  localStorage.setItem('pl_expenses', '[]')
  localStorage.setItem('pl_income', JSON.stringify([
    { id: 'i1', property_id: 'p1', source: 'Rent', amount: 90000, date: '2026-05-01' },
    { id: 'i2', property_id: 'p1', source: 'Maintenance', amount: 5000, date: '2026-05-01' },
  ]))
  localStorage.setItem('pl_documents', '[]')
})

console.log('\n── IT IS IN THE APP ──')
await p.goto(B, { waitUntil: 'networkidle' })
await p.waitForTimeout(500)
ok('Invoices is in the sidebar', /INVOICES/i.test(await p.locator('aside nav').innerText()),
  (await p.locator('aside nav').innerText()).replace(/\n/g, ' | '))
await p.goto(`${B}/invoices`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
let t = await p.locator('#main-content').innerText()
ok('the page loads', t.length > 200, t.slice(0, 120))
ok('with exactly one h1', (await p.locator('#main-content h1').count()) === 1)
ok('it offers a built-in format to start from', /format/i.test(t))

console.log('\n── FILLING ONE IN ──')
const fill = async (label, value) => {
  const f = p.locator('label', { hasText: new RegExp(`^\\s*${label}`, 'i') }).locator('input,textarea').first()
  if (await f.count()) { await f.fill(value); return true }
  return false
}
await fill('Name / business', 'Acme Estates')
await fill('GSTIN', '27AAAPA1234A1Z5')
await p.waitForTimeout(200)
// Bill-to is the second "Name" field on the page.
const nameFields = p.locator('label', { hasText: /^\s*Name\s*$/i }).locator('input')
if (await nameFields.count()) await nameFields.first().fill('Rahul Mehta')
await p.waitForTimeout(200)

console.log('\n── LINES FROM THE LEDGER ──')
const fromLedger = p.locator('button', { hasText: /from ledger/i }).first()
ok('there is a way to pull lines from entries you already have', await fromLedger.isVisible())
await fromLedger.click()
await p.waitForTimeout(900)
// Line descriptions live in input values, which innerText does not see.
const lineValues = await p.evaluate(() =>
  [...document.querySelectorAll('#main-content input')].map((el) => el.value).filter(Boolean))
ok('the rent entry becomes a line', lineValues.some((v) => /Rent/.test(v)), lineValues.join(' | ').slice(0, 300))
ok('the maintenance entry too', lineValues.some((v) => /Maintenance/.test(v)), lineValues.join(' | ').slice(0, 300))
ok('each line carries the asset it belongs to', lineValues.some((v) => /Sea View Villa/.test(v)))
t = await p.locator('#main-content').innerText()
ok('and the subtotal is the sum of both entries', /95,000/.test(t), t.match(/Subtotal[^|]*/)?.[0] || t.slice(-200))

console.log('\n── THE PREVIEW ──')
await p.waitForTimeout(600)
const frame = p.frameLocator('iframe').first()
let preview = ''
try { preview = await frame.locator('body').innerText({ timeout: 5000 }) } catch { preview = '' }
if (!preview) {
  // Not in an iframe — look for the rendered document inline.
  preview = await p.locator('#main-content').innerText()
}
ok('the invoice previews', preview.length > 50, preview.slice(0, 120).replace(/\n/g, ' | '))
ok('no unrendered token is left on the document', !/\{\{/.test(preview),
  (preview.match(/\{\{[^}]*\}\}/g) || []).slice(0, 4).join(' '))
ok('and no leftover block tag — the nesting bug', !/\{\{[#/]/.test(preview),
  (preview.match(/\{\{[#/][^}]*\}\}/g) || []).slice(0, 4).join(' '))
ok('the biller appears on it', /Acme Estates/.test(preview), preview.slice(0, 200).replace(/\n/g, ' | '))
ok('so does the client', /Rahul Mehta/.test(preview))
ok('and an amount in words, the way a tax invoice wants', /only/i.test(preview),
  preview.slice(-260).replace(/\n/g, ' | '))

console.log('\n── GST ON THE DOCUMENT ──')
// Same-state client: CGST + SGST, not IGST.
const clientGst = p.locator('label', { hasText: /^\s*GSTIN/i }).locator('input').nth(1)
if (await clientGst.count()) { await clientGst.fill('27BBBPB5678B1Z9'); await p.waitForTimeout(900) }
try { preview = await frame.locator('body').innerText({ timeout: 5000 }) } catch { preview = await p.locator('#main-content').innerText() }
ok('a same-state invoice shows CGST and SGST', /CGST/i.test(preview) && /SGST/i.test(preview),
  preview.slice(-300).replace(/\n/g, ' | '))
ok('and not IGST', !/IGST/i.test(preview))
await clientGst.fill('29CCCPC9999C1Z1')
await p.waitForTimeout(900)
try { preview = await frame.locator('body').innerText({ timeout: 5000 }) } catch { preview = await p.locator('#main-content').innerText() }
ok('an out-of-state invoice switches to IGST', /IGST/i.test(preview), preview.slice(-300).replace(/\n/g, ' | '))
ok('and drops CGST', !/CGST/i.test(preview))

console.log('\n── IMPORTING YOUR OWN FORMAT ──')
const own = `<html><body><h1>LETTERHEAD OF MINE</h1>
<p>Bill to {{client.name}}</p>
{{#if issuer.gstin}}<p>GSTIN {{issuer.gstin}}{{#if issuer.phone}} ph {{issuer.phone}}{{/if}}</p>{{/if}}
<table>{{#each lines}}<tr><td>{{description}}</td><td>{{amount}}</td></tr>{{/each}}</table>
<p>Total {{totals.total}}</p><p>{{totals.in_words}}</p></body></html>`
const chooser = p.locator('input[type="file"]').first()
ok('a format can be imported', (await chooser.count()) > 0)
await chooser.setInputFiles({ name: 'my-format.html', mimeType: 'text/html', buffer: Buffer.from(own) })
await p.waitForTimeout(1200)
t = await p.locator('#main-content').innerText()
ok('the imported format is listed', /my-format/i.test(t), t.slice(0, 400).replace(/\n/g, ' | '))
try { preview = await frame.locator('body').innerText({ timeout: 5000 }) } catch { preview = await p.locator('#main-content').innerText() }
ok('and the invoice now uses it', /LETTERHEAD OF MINE/.test(preview), preview.slice(0, 200).replace(/\n/g, ' | '))
ok('the nested condition in a user format renders correctly', !/\{\{/.test(preview),
  (preview.match(/\{\{[^}]*\}\}/g) || []).slice(0, 4).join(' '))
ok('the imported format survives a reload',
  await (async () => { await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(900)
    return /my-format/i.test(await p.locator('#main-content').innerText()) })())

console.log('\n── A BAD FORMAT IS REJECTED, NOT SILENTLY USED ──')
await p.locator('input[type="file"]').first().setInputFiles({
  name: 'typo.html', mimeType: 'text/html', buffer: Buffer.from('<p>{{client.gst}}</p>'),
})
await p.waitForTimeout(1000)
t = await p.locator('#main-content').innerText()
ok('a typo in a token is pointed out at import time', /client\.gst\b|unknown|not a token|don’t recognise|do not recognise/i.test(t),
  t.slice(0, 500).replace(/\n/g, ' | '))

console.log('\n── DOWNLOADING ──')
rmSync(DL, { recursive: true, force: true })
const pdfBtn = p.locator('button', { hasText: /pdf|download/i }).first()
ok('there is a download control', await pdfBtn.isVisible())
let file = null
try {
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 25000 }), pdfBtn.click()])
  file = `${DL}/${dl.suggestedFilename()}`
  await dl.saveAs(file)
} catch (e) { errs.push('download: ' + String(e).slice(0, 120)) }
ok('a file is produced', Boolean(file) && existsSync(file), String(file))
if (file && existsSync(file)) {
  const buf = readFileSync(file)
  ok('it is a real PDF', buf.slice(0, 5).toString() === '%PDF-', buf.slice(0, 8).toString())
  ok('and not an empty one', buf.length > 3000, `${buf.length} bytes`)
  ok('named for the invoice', /\.pdf$/i.test(file), file)
}

console.log('\n── LAYOUT ──')
await p.setViewportSize({ width: 390, height: 800 })
await p.goto(`${B}/invoices`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
ok('no sideways scroll on a phone', overflow <= 2, `${overflow}px`)
const unlabelled = await p.evaluate(() =>
  [...document.querySelectorAll('#main-content input,#main-content select,#main-content textarea')]
    .filter((el) => el.type !== 'hidden' && el.type !== 'file' && el.offsetParent !== null)
    .filter((el) => !(el.getAttribute('aria-label') || el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`))))
    .map((el) => el.outerHTML.slice(0, 70)))
ok('every control is labelled', unlabelled.length === 0, unlabelled.join(' | '))

console.log('\n── A WORD DRAFT AS A FORMAT ──')
// Built here rather than committed: the case worth testing is Word splitting a
// token across runs, which is invisible inside a binary fixture.
const zip = (entries) => {
  const chunks = [], central = []; let offset = 0
  for (const [name, content] of entries) {
    const nb = Buffer.from(name, 'utf8'), raw = Buffer.from(content, 'utf8'), df = deflateRawSync(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8)
    local.writeUInt32LE(df.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nb.length, 26)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10)
    cen.writeUInt32LE(df.length, 20); cen.writeUInt32LE(raw.length, 24)
    cen.writeUInt16LE(nb.length, 28); cen.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([cen, nb])); chunks.push(local, nb, df)
    offset += local.length + nb.length + df.length
  }
  const cd = Buffer.concat(central), eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, cd, eocd])
}
const wp = (runs) => `<w:p>${runs.map((r) => `<w:r><w:t>${r}</w:t></w:r>`).join('')}</w:p>`
const docx = zip([
  ['[Content_Types].xml', '<Types/>'],
  ['word/document.xml', `<?xml version="1.0"?><w:document><w:body>${wp(['DRAFTED IN WORD']) + wp(['Invoice ', '{{invoice.', 'number}}'])}</w:body></w:document>`],
])

const formatPicker = p.locator('input[aria-label="Import an invoice format"]')
ok('the format picker offers Word and Excel', /\.docx/.test(await formatPicker.getAttribute('accept') || '') && /\.xlsx/.test(await formatPicker.getAttribute('accept') || ''), await formatPicker.getAttribute('accept'))
await formatPicker.setInputFiles({ name: 'drafted.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx })
await p.waitForTimeout(1500)
const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('pl_invoice_templates') || '[]'))
const fromWord = stored.find((t) => t.name === 'drafted')
ok('the Word draft is stored as a format', Boolean(fromWord), stored.map((t) => t.name).join(', '))
ok('its wording comes through', (fromWord?.html || '').includes('DRAFTED IN WORD'), fromWord?.html?.slice(0, 120))
// The point of the whole module: Word had split this across two runs.
ok('a token split across runs is whole again', (fromWord?.html || '').includes('{{invoice.number}}'), fromWord?.html?.slice(0, 160))

console.log(`\n${pass} passed, ${fail} failed`)
console.log('errors:', errs.length ? errs.slice(0, 5) : 'none')
await b.close()
if (fail) process.exitCode = 1
