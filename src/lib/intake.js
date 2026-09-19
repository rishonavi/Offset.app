// Getting a spreadsheet into the books.
//
// Everything in this app can be typed in, and on a real site nothing is. The
// sales list is a spreadsheet the broker sent. The quotation is a PDF from the
// vendor. The salary register is whatever the last accountant left behind.
// Re-keying four hundred flats is not a data-entry problem, it is the reason
// the app never gets used.
//
// One importer rather than four, because the hard parts are the same every
// time and getting them wrong is the same every time:
//
//   **Somebody else named the columns.** "Carpet Area (sq.ft.)", "CARPET",
//   "Carpet sq ft" and "Carpet_Area" are one column. Matching has to be loose
//   or nothing ever lines up.
//
//   **A loose match is a guess, so it has to be shown.** The mapping is
//   reported before anything is written — which column became which field, and
//   which of the user's columns were ignored. An importer that guesses silently
//   and writes four hundred rows is worse than one that refuses.
//
//   **A row that cannot be read is named, not dropped.** "12 skipped" with no
//   reason is how somebody finds out in March that the penthouse is missing.
//
// What this deliberately does not do is accept a `.numbers` file. It is a zip
// package, not a spreadsheet, and no library here reads one — so it is detected
// and the person is told to export, rather than being shown "could not read
// file" about a file that is perfectly fine.
import { makeUnit, UNIT_KINDS, UNIT_STATUS } from './sales'
import { makeEmployee } from './payroll'
import { makeQuote, makeQuoteLine } from './quotes'
import { normalizeDate } from './readDate'

// ── Reading what a person actually typed ────────────────────────────
// Headers arrive with units in brackets, underscores, stray punctuation and
// capital letters nobody agrees on.
export const normaliseHeader = (h) => String(h ?? '')
  .toLowerCase()
  .replace(/\([^)]*\)/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()

// ₹1,23,456.50 is a number. So is "1234". "N/A" is not, and neither is "".
export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  // The first number-like run, rather than every digit-ish character left after
  // stripping. "Rs. 1,24,50,000" stripped character by character keeps the full
  // stop from "Rs." and becomes 0.1245 — a hundred-thousand-fold error from a
  // punctuation mark, and it reads like a real figure.
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(String(value ?? '').replace(/[₹$]/g, ' '))
  if (!m) return null
  const n = Number(m[0].replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

const FIELD = (names, opts = {}) => ({ names: names.map(normaliseHeader), ...opts })

// ── What can be brought in ──────────────────────────────────────────
export const TARGETS = {
  units: {
    id: 'units',
    label: 'Flats and shops',
    noun: 'unit',
    // What a broker's sheet is called when they send it.
    example: 'Unit, Tower, Floor, Configuration, Carpet Area, Agreed Price',
    fields: {
      name: FIELD(['name', 'unit', 'unit no', 'flat', 'flat no', 'shop', 'shop no', 'apartment'], { required: true }),
      kind: FIELD(['kind', 'type', 'unit type']),
      tower: FIELD(['tower', 'wing', 'block', 'building']),
      floor: FIELD(['floor', 'level']),
      configuration: FIELD(['configuration', 'config', 'bhk', 'layout']),
      carpetArea: FIELD(['carpet area', 'carpet', 'rera carpet'], { number: true }),
      builtUpArea: FIELD(['built up area', 'built up', 'bua'], { number: true }),
      superBuiltUpArea: FIELD(['super built up area', 'super built up', 'saleable area', 'sba', 'salable area'], { number: true }),
      ratePerArea: FIELD(['rate per area', 'rate', 'rate per sq ft', 'psf'], { number: true }),
      agreedPrice: FIELD(['agreed price', 'price', 'consideration', 'agreement value', 'total'], { number: true }),
      otherCharges: FIELD(['other charges', 'charges', 'extras', 'amenities'], { number: true }),
      status: FIELD(['status', 'sale status', 'booking status']),
    },
    make: (input, ctx) => makeUnit({
      ...input,
      entityId: ctx.entityId,
      projectId: ctx.projectId || null,
      // A sheet says "Sold" and "2 BHK"; the app has ids. An unknown value is
      // not a reason to lose the row — the maker falls back and the mapping
      // report says what was not understood.
      kind: matchId(input.kind, UNIT_KINDS),
      status: matchId(input.status, UNIT_STATUS),
    }),
  },

  employees: {
    id: 'employees',
    label: 'People on the payroll',
    noun: 'employee',
    example: 'Name, Code, Basic, HRA, Conveyance, PAN, Joined On',
    fields: {
      name: FIELD(['name', 'employee', 'employee name', 'staff name'], { required: true }),
      code: FIELD(['code', 'employee code', 'emp code', 'emp no', 'id']),
      email: FIELD(['email', 'e mail']),
      basic: FIELD(['basic', 'basic pay', 'basic salary'], { number: true }),
      hra: FIELD(['hra', 'house rent allowance'], { number: true }),
      conveyance: FIELD(['conveyance', 'transport allowance'], { number: true }),
      medical: FIELD(['medical', 'medical allowance'], { number: true }),
      special: FIELD(['special', 'special allowance'], { number: true }),
      other: FIELD(['other', 'other allowance', 'others'], { number: true }),
      pan: FIELD(['pan', 'pan no', 'pan number']),
      uan: FIELD(['uan', 'uan no', 'pf number']),
      joinedOn: FIELD(['joined on', 'date of joining', 'doj', 'joining date'], { date: true }),
    },
    make: (input, ctx) => makeEmployee({
      entityId: ctx.entityId,
      name: input.name,
      code: input.code,
      email: input.email,
      pan: input.pan,
      uan: input.uan,
      joinedOn: input.joinedOn,
      // The pay components live in one object; a register has them in columns.
      basic: input.basic, hra: input.hra, conveyance: input.conveyance,
      medical: input.medical, special: input.special, other: input.other,
    }),
  },

  quotes: {
    id: 'quotes',
    label: 'Material quotations',
    noun: 'quotation',
    // One line per row, grouped into quotations by vendor and reference — which
    // is how a vendor's own price list arrives.
    example: 'Vendor, Date, Ref, Material, Quantity, Rate, GST %',
    grouped: true,
    fields: {
      vendor: FIELD(['vendor', 'supplier', 'party', 'firm'], { required: true }),
      date: FIELD(['date', 'quote date', 'quotation date'], { date: true }),
      validUntil: FIELD(['valid until', 'valid till', 'validity'], { date: true }),
      ref: FIELD(['ref', 'reference', 'quote no', 'quotation no']),
      contact: FIELD(['contact', 'phone', 'mobile']),
      name: FIELD(['material', 'item', 'description', 'particulars'], { required: true }),
      qty: FIELD(['quantity', 'qty'], { number: true }),
      rate: FIELD(['rate', 'price', 'unit rate'], { number: true }),
      unit: FIELD(['unit', 'uom']),
      gstPercent: FIELD(['gst', 'gst percent', 'tax', 'gst rate'], { number: true }),
    },
  },
}
export const TARGET_IDS = Object.keys(TARGETS)

// "Sold" against the ids the app actually has. Returns undefined when nothing
// matches, so the maker's own default applies rather than a guess.
function matchId(value, table) {
  const want = normaliseHeader(value)
  if (!want) return undefined
  for (const [id, def] of Object.entries(table)) {
    if (normaliseHeader(id) === want || normaliseHeader(def.label) === want) return id
  }
  return undefined
}

// ── Which column is which ───────────────────────────────────────────
//
// Scored rather than first-past-the-post: "Rate" and "Rate per sq ft" both look
// like the rate, and a scan that takes whichever it meets first depends on the
// order somebody's spreadsheet happens to be in.
function score(header, candidate) {
  if (header === candidate) return 100
  if (header.startsWith(`${candidate} `)) return 80
  if (header.endsWith(` ${candidate}`)) return 75
  if (header.includes(` ${candidate} `)) return 70
  if (header.replace(/\s/g, '') === candidate.replace(/\s/g, '')) return 90
  return 0
}

export function matchColumns(headers = [], targetId = 'units') {
  const target = TARGETS[targetId]
  if (!target) return { columns: {}, ignored: [], missing: [], ambiguous: [] }
  const seen = headers.map((h) => ({ raw: h, key: normaliseHeader(h) })).filter((h) => h.key)

  const columns = {}
  const ambiguous = []
  const taken = new Set()
  // Best match per field, strongest first across all fields, so a header can
  // only be claimed once and the strongest claim wins it.
  const claims = []
  for (const [field, def] of Object.entries(target.fields)) {
    for (const h of seen) {
      const best = Math.max(...def.names.map((n) => score(h.key, n)), 0)
      if (best > 0) claims.push({ field, header: h.raw, key: h.key, score: best })
    }
  }
  claims.sort((a, b) => b.score - a.score)
  for (const claim of claims) {
    if (columns[claim.field] || taken.has(claim.key)) continue
    // Two headers claiming one field at the same strength is a sheet the
    // importer cannot read confidently, and saying so beats picking one.
    const rivals = claims.filter((c) => c.field === claim.field && c.score === claim.score && c.key !== claim.key && !taken.has(c.key))
    if (rivals.length) ambiguous.push({ field: claim.field, headers: [claim.header, ...rivals.map((r) => r.header)] })
    columns[claim.field] = claim.header
    taken.add(claim.key)
  }

  return {
    columns,
    // The person's own columns that nothing was done with. Shown, because a
    // sheet with a "Parking" column that vanished is a question worth asking
    // before four hundred rows are written.
    ignored: seen.filter((h) => !taken.has(h.key)).map((h) => h.raw),
    missing: Object.entries(target.fields).filter(([f, d]) => d.required && !columns[f]).map(([f]) => f),
    ambiguous,
  }
}

// ── Rows into things the makers understand ──────────────────────────
export function mapRows(rows = [], targetId = 'units', { entityId = null, projectId = null } = {}) {
  const target = TARGETS[targetId]
  if (!target) return { ready: [], skipped: [], match: { columns: {}, ignored: [], missing: [], ambiguous: [] }, rows: 0 }
  const headers = rows.length ? Object.keys(rows[0]) : []
  const match = matchColumns(headers, targetId)

  const ready = []
  const skipped = []
  if (match.missing.length) {
    // Nothing is written from a sheet missing a column the target cannot do
    // without. Refusing the file beats writing four hundred unnamed rows.
    return { ready, skipped, match, rows: rows.length, refused: `No column looks like ${match.missing.join(' or ')}.` }
  }

  rows.forEach((row, i) => {
    const input = {}
    let blank = true
    for (const [field, def] of Object.entries(target.fields)) {
      const header = match.columns[field]
      if (!header) continue
      const raw = row[header]
      if (raw !== '' && raw !== null && raw !== undefined) blank = false
      input[field] = def.number ? (toNumber(raw) ?? 0) : def.date ? normalizeDate(raw) : String(raw ?? '').trim()
    }
    // A run of empty rows under the data is what every spreadsheet has, and
    // reporting four hundred of them as errors buries the two that matter.
    if (blank) return
    const required = Object.entries(target.fields).filter(([, d]) => d.required)
    const empty = required.filter(([f]) => !String(input[f] ?? '').trim()).map(([f]) => f)
    if (empty.length) {
      skipped.push({ line: i + 2, why: `no ${empty.join(' or ')}`, row })
      return
    }
    ready.push(input)
  })

  if (!target.grouped) {
    return { ready: ready.map((input) => target.make(input, { entityId, projectId })), skipped, match, rows: rows.length, inputs: ready }
  }
  return { ready: groupQuotes(ready, { entityId, projectId }), skipped, match, rows: rows.length, inputs: ready }
}

// A vendor's price list is one row per material and one quotation per vendor
// and reference — which is what a quotation is.
function groupQuotes(inputs, { entityId, projectId }) {
  const groups = new Map()
  for (const input of inputs) {
    const key = `${normaliseHeader(input.vendor)}|${normaliseHeader(input.ref)}|${input.date || ''}`
    if (!groups.has(key)) {
      groups.set(key, {
        entityId,
        projectId,
        vendor: input.vendor,
        contact: input.contact,
        date: input.date,
        validUntil: input.validUntil,
        ref: input.ref,
        lines: [],
      })
    }
    groups.get(key).lines.push(makeQuoteLine({
      name: input.name,
      qty: input.qty,
      rate: input.rate,
      unit: input.unit,
      gstPercent: input.gstPercent,
    }))
  }
  return [...groups.values()].map((g) => makeQuote(g))
}

// ── The file itself ─────────────────────────────────────────────────
// `.numbers` is a zip package rather than a spreadsheet, and no library here
// reads one. Detected by name so the person is told to export rather than shown
// "could not read file" about a file that is perfectly fine.
export const isNumbersPackage = (name = '') => /\.numbers$/i.test(String(name))
export const NUMBERS_NOTE =
  'A .numbers file is a package rather than a spreadsheet. In Numbers choose File → Export To → Excel or CSV, and load that.'

export function describeMatch(match, targetId) {
  const target = TARGETS[targetId]
  if (!match) return ''
  const found = Object.keys(match.columns).length
  const total = Object.keys(target?.fields || {}).length
  const bits = [`${found} of ${total} columns recognised`]
  if (match.ignored.length) bits.push(`${match.ignored.length} ignored`)
  if (match.ambiguous.length) bits.push(`${match.ambiguous.length} unclear`)
  return `${bits.join(', ')}.`
}
