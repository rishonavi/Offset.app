// Invoice layouts that arrive as Word or Excel.
//
// People do not draft an invoice in HTML. They draft it in Word, or lay it out
// as a spreadsheet, and the tokens get typed straight into that document. So
// the job here is not to reproduce the file's styling — the template's own CSS
// does that — but to recover its text and table structure with the {{tokens}}
// intact, and hand back HTML that the existing template parser can take.
//
// Word matters more than it looks. It splits a run wherever formatting or a
// spell-check boundary falls, so `{{issuer.name}}` typed as one word can be
// stored as <w:t>{{issuer.</w:t><w:t>name}}</w:t>. Any approach that reads runs
// individually shreds every token in the document. Joining all the text within
// a paragraph before looking at it is what makes this work at all.

import * as XLSX from 'xlsx'

export const OFFICE_TEMPLATE_EXTENSIONS = ['.docx', '.xlsx']

export const isOfficeTemplate = (name) =>
  OFFICE_TEMPLATE_EXTENSIONS.some((ext) => new RegExp(`\\${ext}$`, 'i').test(String(name || '')))

// ── A minimal ZIP reader ───────────────────────────────────────────
// .docx is a ZIP holding word/document.xml. Reading that one entry needs the
// central directory and an inflate, both of which the platform already has —
// DecompressionStream has been in every current browser since Safari 16.4 — so
// this stays a dependency rather than becoming one.

const EOCD_SIG = 0x06054b50
const CEN_SIG = 0x02014b50

// The end-of-central-directory record sits at the very end, after a comment of
// unknown length, so it has to be found by scanning backwards for its
// signature rather than by arithmetic.
function findEndOfCentralDirectory(view) {
  const max = Math.min(view.byteLength, 0xffff + 22)
  for (let i = 22; i <= max; i++) {
    const at = view.byteLength - i
    if (at < 0) break
    if (view.getUint32(at, true) === EOCD_SIG) return at
  }
  return -1
}

function locateEntry(buffer, wanted) {
  const view = new DataView(buffer)
  const eocd = findEndOfCentralDirectory(view)
  if (eocd < 0) throw new Error('That file isn’t a readable Word document.')

  const count = view.getUint16(eocd + 10, true)
  let at = view.getUint32(eocd + 16, true)
  const names = new TextDecoder()

  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== CEN_SIG) break
    const method = view.getUint16(at + 10, true)
    const compressedSize = view.getUint32(at + 20, true)
    const nameLen = view.getUint16(at + 28, true)
    const extraLen = view.getUint16(at + 30, true)
    const commentLen = view.getUint16(at + 32, true)
    const localAt = view.getUint32(at + 42, true)
    const name = names.decode(new Uint8Array(buffer, at + 46, nameLen))

    if (name === wanted) {
      // The local header repeats the name and extra fields, and its extra
      // field length can differ from the central one — trusting the central
      // copy here lands mid-file and inflates to garbage.
      const localNameLen = view.getUint16(localAt + 26, true)
      const localExtraLen = view.getUint16(localAt + 28, true)
      const start = localAt + 30 + localNameLen + localExtraLen
      return { method, bytes: new Uint8Array(buffer, start, compressedSize) }
    }
    at += 46 + nameLen + extraLen + commentLen
  }
  return null
}

async function inflate(entry) {
  if (entry.method === 0) return entry.bytes // stored, not compressed
  if (entry.method !== 8) throw new Error('That Word document uses compression Offset can’t read.')
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser is too old to read .docx files — save the layout as HTML instead.')
  }
  const stream = new Blob([entry.bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// ── Word ───────────────────────────────────────────────────────────

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decodeXml = (s) =>
  s.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (m, e) =>
    e.startsWith('#') ? String.fromCharCode(Number(e.slice(1))) : XML_ENTITIES[e])

// Escaped on the way back out so a literal < in the draft can't open a tag,
// while the braces a token is made of pass through untouched.
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// All the text of one paragraph, joined with nothing between the runs — see
// the note at the top about Word splitting tokens across them.
const paragraphText = (xml) => {
  const parts = []
  for (const m of xml.matchAll(/<w:(t|tab|br|cr)(\s[^>]*)?(\/>|>([\s\S]*?)<\/w:\1>)/g)) {
    if (m[1] === 't') parts.push(decodeXml(m[4] || ''))
    else if (m[1] === 'tab') parts.push('\t')
    else parts.push('\n')
  }
  return parts.join('')
}

export function docxXmlToHtml(xml) {
  const body = xml.match(/<w:body[^>]*>([\s\S]*)<\/w:body>/)?.[1] ?? xml
  const out = []

  // Tables carry the line-item block in almost every real invoice layout, so
  // they are reproduced as tables rather than flattened into paragraphs.
  const chunks = body.split(/(<w:tbl>[\s\S]*?<\/w:tbl>)/)
  for (const chunk of chunks) {
    if (!chunk) continue
    if (chunk.startsWith('<w:tbl>')) {
      const rows = []
      for (const row of chunk.matchAll(/<w:tr[\s\S]*?<\/w:tr>/g)) {
        const cells = []
        for (const cell of row[0].matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)) {
          cells.push(`<td>${escapeHtml(paragraphText(cell[1])).trim()}</td>`)
        }
        if (cells.length) rows.push(`<tr>${cells.join('')}</tr>`)
      }
      if (rows.length) out.push(`<table>${rows.join('')}</table>`)
      continue
    }
    for (const para of chunk.matchAll(/<w:p(\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
      const text = escapeHtml(paragraphText(para[2])).trim()
      // An empty paragraph in Word is deliberate vertical space.
      out.push(text ? `<p>${text}</p>` : '<p>&nbsp;</p>')
    }
  }
  return out.join('\n')
}

async function docxToHtml(buffer) {
  const entry = locateEntry(buffer, 'word/document.xml')
  if (!entry) throw new Error('That .docx has no readable document inside it.')
  const xml = new TextDecoder().decode(await inflate(entry))
  const html = docxXmlToHtml(xml)
  if (!html.replace(/<[^>]*>|&nbsp;|\s/g, '')) throw new Error('That Word document has no text in it.')
  return html
}

// ── Excel ──────────────────────────────────────────────────────────

export function xlsxToHtml(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) throw new Error('That spreadsheet has no sheets in it.')
  const full = XLSX.utils.sheet_to_html(sheet)
  // sheet_to_html wraps the table in a whole document; only the table belongs
  // in a template, which supplies its own page and styling.
  return full.match(/<table[\s\S]*<\/table>/i)?.[0] || full
}

// ── Entry point ────────────────────────────────────────────────────

// Returns HTML for parseTemplateFile to sanitise and store. Whatever tokens the
// draft contained come through as text; unrecognised ones are reported by the
// existing analyseTemplate check, exactly as for an imported HTML layout.
export async function officeTemplateToHtml(name, buffer) {
  if (/\.docx$/i.test(name)) return docxToHtml(buffer)
  if (/\.xlsx$/i.test(name)) return xlsxToHtml(buffer)
  throw new Error(`Offset can’t read ${name} as an invoice format.`)
}
