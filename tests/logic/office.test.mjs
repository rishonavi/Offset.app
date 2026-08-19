// Word and Excel drafts becoming invoice formats.
//
// The .docx here is built byte by byte rather than committed as a fixture: a
// binary blob in the tree tells nobody what it contains, and the thing most
// worth testing — Word splitting a token across runs — is invisible inside one.
import { deflateRawSync } from 'node:zlib'
import { docxXmlToHtml, xlsxToHtml, isOfficeTemplate, officeTemplateToHtml } from '../../src/lib/officeTemplate.js'
import * as XLSX from 'xlsx'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : '**FAIL**'}  ${name}${cond ? '' : '  — ' + extra}`) }

// ── A real ZIP, so the reader is exercised rather than stubbed ──
function zip(entries) {
  const chunks = [], central = []
  let offset = 0
  for (const [name, content] of entries) {
    const nameBytes = Buffer.from(name, 'utf8')
    const raw = Buffer.from(content, 'utf8')
    const deflated = deflateRawSync(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8)
    local.writeUInt32LE(0, 14); local.writeUInt32LE(deflated.length, 18); local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBytes.length, 26); local.writeUInt16LE(0, 28)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10)
    cen.writeUInt32LE(0, 16); cen.writeUInt32LE(deflated.length, 20); cen.writeUInt32LE(raw.length, 24)
    cen.writeUInt16LE(nameBytes.length, 28); cen.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([cen, nameBytes]))
    chunks.push(local, nameBytes, deflated)
    offset += local.length + nameBytes.length + deflated.length
  }
  const cd = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16)
  const all = Buffer.concat([...chunks, cd, eocd])
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength)
}

const para = (runs) => `<w:p>${runs.map((r) => `<w:r><w:t>${r}</w:t></w:r>`).join('')}</w:p>`
const doc = (body) => `<?xml version="1.0"?><w:document><w:body>${body}</w:body></w:document>`

console.log('\n── WHAT WORD ACTUALLY STORES ──')
// The reason this module exists: Word splits a run wherever formatting or a
// spell-check boundary falls, so one typed token arrives in pieces.
let html = docxXmlToHtml(doc(para(['{{issuer.', 'name}}'])))
ok('a token split across runs is put back together', html.includes('{{issuer.name}}'), html)

html = docxXmlToHtml(doc(para(['Invoice ', '{{invoice.', 'number', '}}', ' dated {{invoice.date}}'])))
ok('several splits in one paragraph survive', html.includes('{{invoice.number}}') && html.includes('{{invoice.date}}'), html)

console.log('\n── STRUCTURE THAT CARRIES MEANING ──')
html = docxXmlToHtml(doc(`<w:tbl><w:tr><w:tc>${para(['{{line.description}}'])}</w:tc><w:tc>${para(['{{line.amount}}'])}</w:tc></w:tr></w:tbl>`))
ok('a table stays a table', /<table><tr><td>.*<\/td><td>.*<\/td><\/tr><\/table>/.test(html), html)
ok('and its cells keep their tokens', html.includes('{{line.description}}') && html.includes('{{line.amount}}'), html)

html = docxXmlToHtml(doc(para(['One']) + '<w:p></w:p>' + para(['Two'])))
ok('an empty paragraph is kept as the spacing it is', html.includes('&nbsp;'), html)
ok('paragraphs stay separate', html.includes('<p>One</p>') && html.includes('<p>Two</p>'), html)

console.log('\n── TEXT THAT COULD BREAK THE PAGE ──')
html = docxXmlToHtml(doc(para(['Terms &amp; conditions: 5 &lt; 10'])))
ok('XML entities are decoded', html.includes('Terms & conditions') || html.includes('Terms &amp; conditions'), html)
ok('a literal < cannot open a tag', !/<(?!\/?(p|table|tr|td)\b)/.test(html), html)

console.log('\n── THE WHOLE FILE ──')
const buffer = zip([
  ['[Content_Types].xml', '<Types/>'],
  ['word/document.xml', doc(para(['{{issuer.', 'name}}']) + para(['{{invoice.total}}']))],
])
html = await officeTemplateToHtml('layout.docx', buffer)
ok('a .docx is read end to end', html.includes('{{issuer.name}}') && html.includes('{{invoice.total}}'), html)

let threw = null
try { await officeTemplateToHtml('layout.docx', zip([['word/other.xml', '<x/>']])) } catch (e) { threw = e.message }
ok('a .docx with no document inside says so', /no readable document/i.test(threw || ''), threw)

threw = null
try { await officeTemplateToHtml('layout.rtf', new ArrayBuffer(8)) } catch (e) { threw = e.message }
ok('an unsupported extension is named in the error', /layout\.rtf/.test(threw || ''), threw)

console.log('\n── EXCEL ──')
const ws = XLSX.utils.aoa_to_sheet([['Description', 'Amount'], ['{{line.description}}', '{{line.amount}}']])
const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Invoice')
const xbuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
html = xlsxToHtml(xbuf)
ok('a sheet becomes a table', /^<table/i.test(html.trim()), html.slice(0, 80))
ok('no surrounding document comes with it', !/<html|<body/i.test(html), html.slice(0, 80))
ok('cell tokens survive', html.includes('{{line.description}}') && html.includes('{{line.amount}}'), html.slice(0, 200))

console.log('\n── WHICH FILES THIS APPLIES TO ──')
ok('.docx is an office format', isOfficeTemplate('a.docx'))
ok('.xlsx is an office format', isOfficeTemplate('A.XLSX'))
ok('.html is not', !isOfficeTemplate('a.html'))
ok('.doc is not — only the zip formats are readable', !isOfficeTemplate('a.doc'))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
