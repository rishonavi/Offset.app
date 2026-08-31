// Invoice templates: the user brings their own layout, Offset fills in the
// numbers.
//
// A template is an HTML file with {{tokens}} in it — whatever letterhead, logo,
// terms and column order their accountant already expects, rather than a layout
// Offset invented. Three constructs, which is as much as a document needs:
//
//   {{issuer.name}}                        a value
//   {{#each lines}} … {{/each}}            repeat for every line item
//   {{#if has_tax}} … {{/if}}              include only when true
//
// Values are HTML-escaped on the way in, so an address with an ampersand or a
// tenant called "Smith & Sons" can't break the markup — and a ledger entry
// can't inject script into the document.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c])

// ── Reading a token path ───────────────────────────────────────────
function lookup(scope, path) {
  const parts = String(path).trim().split('.')
  let cur = scope
  for (const part of parts) {
    if (cur == null) return undefined
    cur = cur[part]
  }
  return cur
}

// Inside {{#each lines}}, a bare {{description}} means this line's description;
// {{issuer.name}} still reaches the document. Being able to say either is what
// keeps the loop body readable.
function resolve(path, item, root) {
  const p = String(path).trim()
  if (item != null) {
    const local = p.startsWith('this.') ? lookup(item, p.slice(5)) : lookup(item, p)
    if (local !== undefined) return local
  }
  return lookup(root, p)
}

// ── Rendering ──────────────────────────────────────────────────────
const BLOCK_OPEN = /\{\{#(each|if|unless)\s+([\w.]+)\}\}/
const VALUE = /\{\{\s*([\w.]+)\s*\}\}/g

// Find the {{/kind}} that closes the block opened at `from`, counting nested
// opens of the same kind on the way.
//
// A regex cannot do this. A non-greedy match stops at the *first* closing tag,
// so in
//
//   {{#if issuer.email}}{{issuer.email}}{{#if issuer.phone}} · … {{/if}}{{/if}}
//
// the outer block ends at the inner {{/if}} — the condition is evaluated
// against the wrong body and the leftover {{/if}} is printed onto the invoice.
// The template Offset ships does exactly this, on the issuer's phone number.
function findClose(text, kind, from) {
  const open = `{{#${kind}`
  const close = `{{/${kind}}}`
  let depth = 1
  let i = from
  while (i < text.length) {
    const nextOpen = text.indexOf(open, i)
    const nextClose = text.indexOf(close, i)
    if (nextClose === -1) return -1 // unbalanced; the caller leaves it alone
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1
      i = nextOpen + open.length
      continue
    }
    depth -= 1
    if (depth === 0) return nextClose
    i = nextClose + close.length
  }
  return -1
}

function fill(template, item, root, escape) {
  const text = String(template)
  let out = ''
  let cursor = 0

  // Blocks first, so a value inside a loop is rendered once per item rather
  // than once for the whole document.
  for (;;) {
    const rest = text.slice(cursor)
    const m = rest.match(BLOCK_OPEN)
    if (!m) {
      out += rest
      break
    }
    const start = cursor + m.index
    const bodyFrom = start + m[0].length
    const [, kind, path] = m
    const closeAt = findClose(text, kind, bodyFrom)
    if (closeAt === -1) {
      // An unclosed block is the user's typo, not something to guess at. Leave
      // the rest verbatim so they can see where it went wrong.
      out += rest
      break
    }
    out += text.slice(cursor, start)
    const body = text.slice(bodyFrom, closeAt)
    const value = resolve(path, item, root)
    if (kind === 'each') {
      if (Array.isArray(value)) out += value.map((entry) => fill(body, entry, root, escape)).join('')
    } else {
      const truthy = Array.isArray(value) ? value.length > 0 : Boolean(value)
      if (kind === 'if' ? truthy : !truthy) out += fill(body, item, root, escape)
    }
    cursor = closeAt + `{{/${kind}}}`.length
  }

  out = out.replace(VALUE, (_, path) => {
    const value = resolve(path, item, root)
    if (value == null || typeof value === 'object') return ''
    return escape ? escapeHtml(value) : String(value)
  })
  return out
}

export function renderTemplate(template, tokens, { escape = true } = {}) {
  return fill(template, null, tokens, escape)
}

// ── Checking a template before it is used ──────────────────────────
// Every token a template may use. An unknown one is almost always a typo
// ({{client.gst}} for {{client.gstin}}), and finding it at import time beats
// finding a blank space on a sent invoice.
export const TOKENS = {
  'invoice.number': 'Invoice number',
  'invoice.date': 'Invoice date',
  'invoice.due_date': 'Due date',
  'invoice.period': 'Billing period, e.g. "May 2026"',
  'invoice.notes': 'Free-text notes',
  'invoice.place_of_supply': 'Place of supply (GST state code)',
  'issuer.name': 'Your name / business name',
  'issuer.address': 'Your address',
  'issuer.gstin': 'Your GSTIN',
  'issuer.pan': 'Your PAN',
  'issuer.email': 'Your email',
  'issuer.phone': 'Your phone',
  'issuer.bank': 'Your bank details',
  'client.name': 'Who is being billed',
  'client.address': 'Their address',
  'client.gstin': 'Their GSTIN',
  'client.email': 'Their email',
  'asset.name': 'The asset being billed for',
  'asset.address': 'That asset’s address',
  'totals.subtotal': 'Total before tax',
  'totals.cgst': 'CGST',
  'totals.sgst': 'SGST',
  'totals.igst': 'IGST',
  'totals.tax_total': 'All tax',
  'totals.total': 'Amount payable',
  'totals.in_words': 'Amount payable, in words',
}

// Valid only inside {{#each lines}}.
export const LINE_TOKENS = {
  n: 'Row number',
  description: 'What the line is for',
  hsn: 'HSN / SAC code',
  qty: 'Quantity',
  rate: 'Rate',
  tax_rate: 'Tax rate on this line',
  tax: 'Tax on this line',
  amount: 'Line total',
}

export const CONDITIONS = {
  has_tax: 'Any GST applies',
  is_intra_state: 'Same state — CGST + SGST',
  is_inter_state: 'Different states — IGST',
  lines: 'There is at least one line',
}

// Scripts and inline handlers are stripped rather than trusted. A template is
// usually the user's own file, but it may equally have been emailed to them by
// their accountant, and a document that renders is not a document that should
// be able to run.
// Entities are decoded before a URL is judged, because `jav&#97;script:` and
// `javascript:` are the same instruction to the browser and only one of them
// looks like one here.
const decodeEntities = (s) =>
  String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, body) => {
    if (body[0] !== '#') return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", tab: '\t', newline: '\n', colon: ':', sol: '/', semi: ';', lpar: '(', rpar: ')' }[body.toLowerCase()] ?? m
    const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
    return Number.isFinite(code) ? String.fromCodePoint(code) : m
  })

// data: is not dangerous in itself — an embedded logo is the ordinary way a
// letterhead travels in a single file, and blocking it breaks real templates.
// What must not through is a data: URL carrying a *document*. Images are safe
// here even as SVG, because <img> is a scripting-disabled context and the
// elements that would make SVG executable are stripped above.
const DANGEROUS_URL = /^\s*(javascript|vbscript)\s*:/i
const DOCUMENT_DATA_URL = /^\s*data\s*:(?!image\/)/i
// The named-entity table above is an allowlist, and an allowlist of HTML5
// entities is a list you will always be one short of: `&colon;` is real, was
// missing, and `javascript&colon;alert(1)` is what a browser reads as
// `javascript:alert(1)`. Rather than chase the full table, the URL is judged
// twice — once as it decodes, and once assuming every entity still standing is
// the separator. Being wrong about which entity it was no longer matters.
const asWorstCase = (s) => s.replace(/&[a-z][a-z0-9]*;?/gi, ':')
const unsafeUrl = (value) => {
  const decoded = decodeEntities(value)
  return [decoded, asWorstCase(decoded)].some((form) => {
    const url = form.replace(/[\u0000-\u0020]/g, '')
    return DANGEROUS_URL.test(url) || DOCUMENT_DATA_URL.test(url)
  })
}

// An invoice layout is a document: text, tables, styling, images. None of the
// elements below have any part in one, and each is a way to run code — an
// iframe carries its own document in srcdoc, object and embed load one from a
// URL. Stripping them outright is both safer and simpler than trying to decide
// which attributes on them are acceptable.
const EXECUTABLE_ELEMENTS = /<(script|iframe|object|embed|applet|frame|frameset)\b[\s\S]*?(<\/\1\s*>|$)/gi
const EXECUTABLE_OPEN_TAGS = /<\/?(script|iframe|object|embed|applet|frame|frameset)\b[^>]*>/gi

// The template is written into a same-origin iframe to be printed and
// photographed for the PDF, so anything that executes there can read the whole
// ledger and the session token out of localStorage. That frame is sandboxed
// without allow-scripts, which is the control that actually holds; this pass is
// the second layer, and it is deliberately blunt about what it removes.
const URL_ATTRS = new Set(['href', 'src', 'data', 'action', 'formaction', 'poster', 'background'])

// A tag, with its attribute list captured whole — quoted runs are consumed as
// units so a `>` inside `title="a > b"` does not end the tag early.
const TAG = /<([a-z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi
// Attribute names, and values quoted three ways.
const ATTR = /([a-z_:][-\w:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]*)))?/gi

// Attributes are read one at a time rather than matched with a pattern over the
// whole tag, because the two questions "is this a separator?" and "is this part
// of a value?" have the same answer only if you are tracking quotes.
//
// A regex that treated a solidus as a separator caught `<img/onerror=alert(1)>`
// — which HTML really does parse as an image with a handler — and also mangled
// `href="/online=1"`, an ordinary link, into nothing. Reading the attributes
// makes both cases obvious instead of trading one for the other.
function cleanAttributes(whole, name, attrs) {
  if (!attrs.trim()) return whole
  const selfClosing = /\/\s*$/.test(attrs)
  const kept = []
  let dropped = 0
  ATTR.lastIndex = 0
  let m
  while ((m = ATTR.exec(attrs))) {
    if (!m[0].trim()) { ATTR.lastIndex += 1; continue }
    const attr = m[1].toLowerCase()
    const value = m[2] ?? m[3] ?? m[4] ?? ''
    // An inline handler is a script with a shorter name.
    if (/^on[a-z]+$/.test(attr)) { dropped += 1; continue }
    // srcdoc carries an entire document inside an attribute.
    if (attr === 'srcdoc') { dropped += 1; continue }
    if (URL_ATTRS.has(attr) && unsafeUrl(value)) { dropped += 1; continue }
    kept.push(m[0].trim())
  }
  // Nothing was removed, so hand back exactly what came in. A sanitiser that
  // rewrites every tag it inspects turns `<br/>` into `<br />` throughout
  // someone's letterhead for no reason, and makes its own diff impossible to
  // read the day it does remove something.
  if (!dropped) return whole
  return `<${name}${kept.length ? ' ' + kept.join(' ') : ''}${selfClosing ? ' /' : ''}>`
}

export function sanitiseTemplate(html) {
  return String(html)
    .replace(EXECUTABLE_ELEMENTS, '')
    .replace(EXECUTABLE_OPEN_TAGS, '')
    .replace(TAG, cleanAttributes)
    .replace(/javascript:/gi, '')
}

export function analyseTemplate(html) {
  const source = String(html || '')
  const used = new Set()
  const unknown = new Set()
  const conditions = new Set()

  // Which paths appear inside an {{#each lines}} body — those are checked
  // against the line vocabulary, not the document one.
  const loopBodies = []
  source.replace(/\{\{#each\s+([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (m, path, body) => {
    loopBodies.push(body)
    conditions.add(path)
    return m
  })
  source.replace(/\{\{#(if|unless)\s+([\w.]+)\}\}/g, (m, _kind, path) => {
    conditions.add(path)
    return m
  })

  const inLoop = new Set()
  for (const body of loopBodies) {
    body.replace(VALUE, (m, path) => {
      inLoop.add(path)
      return m
    })
  }

  source.replace(VALUE, (m, path) => {
    const p = path.trim()
    used.add(p)
    if (inLoop.has(p)) {
      const bare = p.startsWith('this.') ? p.slice(5) : p
      if (!(bare in LINE_TOKENS) && !(p in TOKENS)) unknown.add(p)
    } else if (!(p in TOKENS)) {
      unknown.add(p)
    }
    return m
  })

  for (const c of conditions) {
    if (!(c in CONDITIONS) && !(c in TOKENS)) unknown.add(c)
  }

  return {
    used: [...used],
    unknown: [...unknown],
    hasLines: loopBodies.length > 0,
    hasTotal: used.has('totals.total'),
    hasNumber: used.has('invoice.number'),
    // Enough of a document to send. Missing pieces are warnings, not refusals —
    // it's their format, and a delivery note legitimately has no total.
    warnings: [
      loopBodies.length === 0 && 'No {{#each lines}} block — the invoice will have no line items.',
      !used.has('totals.total') && 'No {{totals.total}} — the amount payable won’t appear.',
      !used.has('invoice.number') && 'No {{invoice.number}} — the invoice will be unnumbered.',
    ].filter(Boolean),
  }
}

// ── Importing ──────────────────────────────────────────────────────
export const TEMPLATE_EXTENSIONS = ['.html', '.htm', '.txt', '.json']

// Accepts an HTML/text layout, or a JSON file previously exported from here so
// a format can be moved between browsers or shared with a colleague.
export function parseTemplateFile(name, text) {
  const trimmed = String(text || '').trim()
  if (!trimmed) throw new Error('That file is empty.')

  if (/\.json$/i.test(name) || trimmed.startsWith('{')) {
    let parsed
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error('That JSON file couldn’t be read.')
    }
    if (!parsed.html) throw new Error('That JSON file has no "html" field — it isn’t an Offset invoice format.')
    return {
      name: parsed.name || name.replace(/\.[^.]+$/, ''),
      html: sanitiseTemplate(parsed.html),
      paper: parsed.paper === 'letter' ? 'letter' : 'a4',
    }
  }

  return { name: name.replace(/\.[^.]+$/, ''), html: sanitiseTemplate(trimmed), paper: 'a4' }
}

export const templateToFile = (t) =>
  JSON.stringify({ format: 'offset-invoice-template', version: 1, name: t.name, paper: t.paper, html: t.html }, null, 2)

// ── Storage ────────────────────────────────────────────────────────
// Kept in this browser: a template is a document layout, not portfolio data,
// and export/import is how it moves. Templates are listed newest last, and the
// chosen default is what a new invoice opens with.
const KEY = 'pl_invoice_templates'
const DEFAULT_KEY = 'pl_invoice_template_default'

export function listTemplates() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function persist(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    throw new Error('There’s no room left in this browser’s storage to save that format. Delete one you no longer use.')
  }
}

export function saveTemplate(template) {
  const row = {
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
    name: (template.name || 'Untitled format').slice(0, 80),
    html: template.html || '',
    paper: template.paper === 'letter' ? 'letter' : 'a4',
    created_at: new Date().toISOString(),
  }
  persist([...listTemplates(), row])
  return row
}

export function deleteTemplate(id) {
  persist(listTemplates().filter((t) => t.id !== id))
  if (defaultTemplateId() === id) setDefaultTemplate('')
}

export function defaultTemplateId() {
  try {
    return localStorage.getItem(DEFAULT_KEY) || ''
  } catch {
    return ''
  }
}

export function setDefaultTemplate(id) {
  try {
    if (id) localStorage.setItem(DEFAULT_KEY, id)
    else localStorage.removeItem(DEFAULT_KEY)
  } catch {
    /* a stored preference is not worth failing over */
  }
}

// ── The one that ships ─────────────────────────────────────────────
// So the feature works before anyone has imported anything — and doubles as a
// worked example of every construct, which is easier to adapt than a blank file.
export const DEFAULT_TEMPLATE_HTML = `<div class="invoice">
  <header>
    <div>
      <h1>{{issuer.name}}</h1>
      <p>{{issuer.address}}</p>
      {{#if issuer.gstin}}<p>GSTIN: {{issuer.gstin}}</p>{{/if}}
      {{#if issuer.email}}<p>{{issuer.email}}{{#if issuer.phone}} · {{issuer.phone}}{{/if}}</p>{{/if}}
    </div>
    <div class="meta">
      <h2>TAX INVOICE</h2>
      <p><strong>{{invoice.number}}</strong></p>
      <p>Date: {{invoice.date}}</p>
      {{#if invoice.due_date}}<p>Due: {{invoice.due_date}}</p>{{/if}}
      {{#if invoice.period}}<p>Period: {{invoice.period}}</p>{{/if}}
    </div>
  </header>

  <section class="parties">
    <div>
      <h3>Billed to</h3>
      <p><strong>{{client.name}}</strong></p>
      <p>{{client.address}}</p>
      {{#if client.gstin}}<p>GSTIN: {{client.gstin}}</p>{{/if}}
    </div>
    {{#if asset.name}}
    <div>
      <h3>For</h3>
      <p><strong>{{asset.name}}</strong></p>
      <p>{{asset.address}}</p>
    </div>
    {{/if}}
  </section>

  <table>
    <thead>
      <tr>
        <th>#</th><th>Description</th><th>HSN/SAC</th><th class="r">Qty</th>
        <th class="r">Rate</th><th class="r">Amount</th>
      </tr>
    </thead>
    <tbody>
      {{#each lines}}
      <tr>
        <td>{{n}}</td><td>{{description}}</td><td>{{hsn}}</td>
        <td class="r">{{qty}}</td><td class="r">{{rate}}</td><td class="r">{{amount}}</td>
      </tr>
      {{/each}}
    </tbody>
  </table>

  <div class="totals">
    <p><span>Subtotal</span><span>{{totals.subtotal}}</span></p>
    {{#if is_intra_state}}
    <p><span>CGST</span><span>{{totals.cgst}}</span></p>
    <p><span>SGST</span><span>{{totals.sgst}}</span></p>
    {{/if}}
    {{#if is_inter_state}}
    <p><span>IGST</span><span>{{totals.igst}}</span></p>
    {{/if}}
    <p class="grand"><span>Total</span><span>{{totals.total}}</span></p>
  </div>

  <p class="words">{{totals.in_words}}</p>

  {{#if issuer.bank}}<div class="pay"><h3>Payment</h3><p>{{issuer.bank}}</p></div>{{/if}}
  {{#if invoice.notes}}<div class="notes"><h3>Notes</h3><p>{{invoice.notes}}</p></div>{{/if}}
</div>`

// Stylesheet for the shipped template. Kept apart so an imported template can
// bring its own <style> and not inherit this one's opinions.
export const DEFAULT_TEMPLATE_CSS = `
  body { font: 12px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; margin: 0; padding: 32px; }
  .invoice { max-width: 760px; margin: 0 auto; }
  header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #0d2040; padding-bottom: 16px; }
  header h1 { font-size: 18px; margin: 0 0 4px; }
  header p { margin: 2px 0; color: #444; }
  .meta { text-align: right; }
  .meta h2 { font-size: 13px; letter-spacing: 2px; margin: 0 0 6px; color: #0d2040; }
  .parties { display: flex; gap: 40px; margin: 20px 0; }
  h3 { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #777; margin: 0 0 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #0d2040; color: #fff; text-align: left; padding: 7px 8px; font-size: 11px; }
  td { padding: 7px 8px; border-bottom: 1px solid #e6e6e6; }
  .r { text-align: right; }
  .totals { margin-top: 16px; margin-left: auto; width: 260px; }
  .totals p { display: flex; justify-content: space-between; margin: 4px 0; }
  .totals .grand { border-top: 2px solid #0d2040; padding-top: 6px; font-weight: 700; font-size: 14px; }
  .words { margin-top: 12px; font-style: italic; color: #444; }
  .pay, .notes { margin-top: 20px; }
`

// A complete document, ready for an iframe or a print window.
export function renderDocument(templateHtml, tokens, { css = '', title = 'Invoice' } = {}) {
  const body = renderTemplate(templateHtml, tokens)
  const bringsOwnStyle = /<style[\s>]/i.test(templateHtml)
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>${bringsOwnStyle ? '' : css}
@page { margin: 12mm; }
@media print { body { padding: 0; } }
</style></head><body>${body}</body></html>`
}
