// A document, read.
//
// A spreadsheet is four hundred rows of one shape. A PDF is one document of a
// shape somebody chose — a salary slip, a vendor's quotation, an allotment
// letter — and the two need opposite treatment. `intake.js` matches columns
// because a sheet has columns; this matches **labels**, because a document has
// a label in front of every figure and that is the only thing all of them have
// in common.
//
// Three rules, and they are the same three that make the spreadsheet importer
// safe:
//
//   **What was not found is said, not filled.** A slip with no PF line gives a
//   PF of nothing-at-all, not nought. One of those is a fact about the slip and
//   the other is a fact about the reader, and writing the second as the first is
//   how a payroll silently loses a deduction.
//
//   **The document's own totals are checked, not trusted.** A slip that says
//   Gross 43,600 when its own components come to 42,000 has been read wrong or
//   written wrong, and either way somebody has to look. The arithmetic is done
//   and the disagreement reported.
//
//   **One document is one record.** A PDF is not a table, and pretending it is
//   produces four rows from a letter about one flat.
//
// The text comes from `ocr.js`, which already reads a generated PDF as text and
// falls back to OCR on a scanned one. Nothing here cares which it was.
import { normaliseHeader, toNumber, TARGETS } from './intake'
import { normalizeDate } from './readDate'
import { makeQuote, makeQuoteLine } from './quotes'

const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

// ── Reading a labelled line ─────────────────────────────────────────
//
// "Basic Salary : 30,000.00", "BASIC           30,000.00" and "Basic pay 30000"
// are the same line. The label is whatever comes before the first colon, or
// before the first run of digits where there is no colon — because plenty of
// slips are a column of labels and a column of figures with nothing between
// them but spaces.
// One line can carry several labelled figures, and on a salary slip it usually
// does: earnings down the left and deductions down the right, printed as one
// line with a gap in the middle. Reading only the first pair on each line found
// the conveyance and lost the basic, which is not a small error — it is a slip
// read as a tenth of itself.
//
// Split on runs of two or more spaces, because that gap is the only thing
// separating the columns once the box lines are gone. A chunk with a colon is a
// pair on its own; a chunk of words followed by a chunk of digits is a pair
// across two chunks.
export function pairsInLine(line) {
  const raw = String(line || '').trim()
  if (!raw) return []

  // A colon is an explicit label, and a line of them is a header: "Tower: A
  // Floor: 12". Each value runs until the next thing that looks like a label.
  if (raw.includes(':')) {
    const out = []
    const re = /([A-Za-z][A-Za-z ./&()'-]*?)\s*:\s*([^:]*?)(?=\s+[A-Za-z][A-Za-z ./&()'-]*\s*:|$)/g
    for (const m of raw.matchAll(re)) {
      out.push({ label: normaliseHeader(m[1]), value: m[2].trim(), raw })
    }
    if (out.length) return out.filter((p) => p.label)
  }

  // Otherwise the line is a run of "label figure" pairs, and the only reliable
  // separator is the figure itself.
  //
  // Splitting on wide gaps was the obvious approach and it does not survive a
  // real PDF: the reader collapses "Basic        30,000.00    PF     1,800.00"
  // to "Basic  30,000.00 PF  1,800.00", which splits into "Basic",
  // "30,000.00 PF" and "1,800.00" — a label glued to the next label's value.
  // Scanning for numbers does not care how wide the gaps were.
  const NUMBER = /^(?:₹|rs\.?|inr)?-?\d[\d,]*(?:\.\d+)?$/i
  const out = []
  let label = []
  for (const token of raw.split(/\s+/)) {
    if (NUMBER.test(token)) {
      if (label.length) out.push({ label: normaliseHeader(label.join(' ')), value: token, raw })
      label = []
      continue
    }
    label.push(token)
  }
  if (label.length) out.push({ label: normaliseHeader(label.join(' ')), value: '', raw })
  return out.filter((p) => p.label)
}

// Every labelled line in a document, in order. Kept as a list rather than an
// object: a slip repeats "Amount" down a column, and the last one is not the
// only one that matters.
export function labelledLines(text = '') {
  return String(text)
    .split(/\r?\n/)
    .flatMap(pairsInLine)
    .filter((l) => l.label)
}

const scoreLabel = (label, candidate) => {
  if (label === candidate) return 100
  if (label.startsWith(`${candidate} `)) return 80
  if (label.endsWith(` ${candidate}`)) return 70
  if (label.includes(candidate)) return 50
  return 0
}

// The best line for a field, or nothing. Nothing is an answer.
export function findField(lines, names = [], { number = false, date = false } = {}) {
  const wanted = names.map(normaliseHeader)
  let best = null
  for (const line of lines) {
    const s = Math.max(...wanted.map((w) => scoreLabel(line.label, w)), 0)
    if (!s) continue
    const value = number ? toNumber(line.value) : date ? normalizeDate(line.value) : line.value.trim()
    // A line that matched the label and carries nothing usable is not a better
    // answer than one further down that carries something.
    if (value === null || value === '' ) { if (!best) best = { score: s, value: null, raw: line.raw }; continue }
    if (!best || s > best.score || best.value === null) best = { score: s, value, raw: line.raw }
  }
  return best && best.value !== null ? best : null
}

// ── A salary slip ───────────────────────────────────────────────────
const SLIP_COMPONENTS = {
  basic: ['basic', 'basic pay', 'basic salary'],
  hra: ['hra', 'house rent allowance', 'h r a'],
  conveyance: ['conveyance', 'conveyance allowance', 'transport allowance'],
  medical: ['medical', 'medical allowance'],
  special: ['special allowance', 'special pay'],
  other: ['other allowance', 'others', 'other earnings'],
}
const SLIP_DEDUCTIONS = {
  pf: ['pf', 'provident fund', 'epf', 'employee pf'],
  esi: ['esi', 'esic', 'employee state insurance'],
  professionalTax: ['professional tax', 'p tax', 'ptax', 'pt'],
  tds: ['tds', 'income tax'],
  advance: ['advance', 'loan', 'salary advance'],
}

// The month a slip is for, written any of the ways a slip writes it.
export function slipPeriod(text = '') {
  const s = String(text)
  let m = /\b(\d{4})-(0[1-9]|1[0-2])\b/.exec(s)
  if (m) return `${m[1]}-${m[2]}`
  m = new RegExp(`\\b(${Object.keys(MONTHS).join('|')})[a-z]*\\.?[ ,-]+(\\d{4})\\b`, 'i').exec(s)
  if (m) return `${m[2]}-${MONTHS[m[1].slice(0, 3).toLowerCase()]}`
  m = /\b(0[1-9]|1[0-2])\/(\d{4})\b/.exec(s)
  if (m) return `${m[2]}-${m[1]}`
  return null
}

export function parseSalarySlip(text = '') {
  const lines = labelledLines(text)
  const get = (names, opts) => findField(lines, names, opts)
  const num = (names) => get(names, { number: true })?.value ?? null

  const components = {}
  const missing = []
  for (const [field, names] of Object.entries(SLIP_COMPONENTS)) {
    const v = num(names)
    // Not found is not nought. A slip with no conveyance line says nothing
    // about conveyance, and writing a zero makes the reader's silence into the
    // document's statement.
    if (v === null) missing.push(field); else components[field] = v
  }
  const deductions = {}
  for (const [field, names] of Object.entries(SLIP_DEDUCTIONS)) {
    const v = num(names)
    if (v !== null) deductions[field] = v
  }

  const statedGross = num(['gross', 'gross earnings', 'gross salary', 'total earnings'])
  const statedDeductions = num(['total deductions', 'deductions', 'total deduction'])
  const statedNet = num(['net pay', 'net salary', 'take home', 'net amount payable', 'net'])

  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
  const addedGross = round2(Object.values(components).reduce((t, n) => t + n, 0))
  const addedDeductions = round2(Object.values(deductions).reduce((t, n) => t + n, 0))

  // The document's own totals are checked rather than trusted. A slip whose
  // parts do not come to its total has been read wrong or written wrong, and
  // either way somebody has to look.
  const problems = []
  if (statedGross !== null && Math.abs(statedGross - addedGross) > 1) {
    problems.push(`the earnings come to ${addedGross} and the slip says ${statedGross}`)
  }
  if (statedDeductions !== null && Math.abs(statedDeductions - addedDeductions) > 1) {
    problems.push(`the deductions come to ${addedDeductions} and the slip says ${statedDeductions}`)
  }
  const gross = statedGross ?? addedGross
  const total = statedDeductions ?? addedDeductions
  if (statedNet !== null && Math.abs(statedNet - (gross - total)) > 1) {
    problems.push(`take-home should be ${round2(gross - total)} and the slip says ${statedNet}`)
  }

  return {
    kind: 'salarySlip',
    name: get(['employee name', 'name of employee', 'name'])?.value || '',
    code: get(['employee code', 'emp code', 'employee no', 'emp id', 'code'])?.value || '',
    pan: get(['pan', 'pan no'])?.value || '',
    uan: get(['uan', 'uan no', 'pf number'])?.value || '',
    period: slipPeriod(text),
    components,
    deductions,
    // What the slip says, and what its own lines come to. Both, because the
    // difference is the finding.
    statedGross, statedDeductions, statedNet,
    gross, totalDeductions: total, net: round2(gross - total),
    missing,
    problems,
    read: Boolean(get(['employee name', 'name of employee', 'name'])?.value) && addedGross > 0,
  }
}

// ── A vendor's quotation ────────────────────────────────────────────
//
// The header is labelled and the lines are a table drawn with spaces. A line
// item is a row with words and at least two numbers on it, which is what a
// quantity and a rate look like once the box lines are gone.
export function parseQuotation(text = '') {
  const lines = labelledLines(text)
  const get = (names, opts) => findField(lines, names, opts)

  const rows = []
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (/^(s\.?\s?no|sr|sl|item|description|particulars|material|qty|quantity|rate|amount|total)\b/i.test(normaliseHeader(line))) continue
    // Standalone numbers only. "TMT bars 12mm" has a 12 in it that is part of
    // the material's name, and counting it as a quantity turned a two-line
    // quotation into three lines of nonsense priced at the bar diameter.
    const STANDALONE = /(?:^|\s)(?:₹|rs\.?|inr)?\s*(-?\d[\d,]*(?:\.\d+)?)(?=\s|$)/gi
    const numbers = [...line.matchAll(STANDALONE)].map((m) => toNumber(m[1]))
    const words = line.replace(STANDALONE, ' ').replace(/\s+/g, ' ').trim()
    if (numbers.length < 2 || words.replace(/[^a-z]/gi, '').length < 3) continue
    // A line that is a header or a labelled field rather than an item. "Date:
    // 12-06-2026" beside "Quotation No: Q-114" has two numbers and some words
    // and is not a material.
    if (line.includes(':')) continue
    // A leading serial number is not a quantity.
    const figures = /^\s*\d{1,3}[.)]?\s/.test(line) ? numbers.slice(1) : numbers
    if (figures.length < 2) continue
    rows.push({
      name: words.replace(/^[.)\-\s]+/, '').replace(/[|:]+$/, '').trim(),
      qty: figures[0],
      rate: figures[1],
      // The unit is whatever word sits between the two figures, where there is
      // one: "24000 kg 61.40".
      unit: (/\d[\d,]*(?:\.\d+)?\s+([a-z]{2,6})\s+\d/i.exec(line)?.[1] || '').toLowerCase(),
    })
  }

  const gst = get(['gst', 'gst percent', 'tax', 'igst', 'cgst'], { number: true })?.value ?? null
  return {
    kind: 'quotation',
    vendor: get(['vendor', 'supplier', 'from', 'messrs', 'm s'])?.value || firstStrongLine(text),
    ref: get(['quotation no', 'quote no', 'ref', 'reference', 'quotation number'])?.value || '',
    date: get(['date', 'quotation date', 'quote date'], { date: true })?.value || '',
    validUntil: get(['valid until', 'valid till', 'validity'], { date: true })?.value || '',
    contact: get(['contact', 'phone', 'mobile'])?.value || '',
    lines: rows.map((r) => ({ ...r, gstPercent: gst ?? undefined })),
    read: rows.length > 0,
  }
}

// A letterhead has the vendor's name at the top and no label in front of it.
function firstStrongLine(text = '') {
  for (const raw of String(text).split(/\r?\n/).slice(0, 6)) {
    const line = raw.trim()
    if (line.length < 4 || line.length > 80) continue
    if (/\d{4}/.test(line)) continue
    if (/^(quotation|estimate|proforma|invoice|tax invoice)\b/i.test(line)) continue
    if (/[a-z]/i.test(line)) return line
  }
  return ''
}

// ── An allotment letter, for the area and the price ─────────────────
export function parseAllotment(text = '') {
  const lines = labelledLines(text)
  const get = (names, opts) => findField(lines, names, opts)
  const num = (names) => get(names, { number: true })?.value ?? null

  const carpet = num(['carpet area', 'carpet', 'rera carpet area'])
  const price = num(['agreement value', 'agreed price', 'consideration', 'total consideration', 'sale consideration', 'price'])
  return {
    kind: 'allotment',
    name: get(['unit no', 'flat no', 'apartment no', 'unit', 'flat', 'shop no'])?.value || '',
    tower: get(['tower', 'wing', 'building', 'block'])?.value || '',
    floor: get(['floor', 'level'])?.value || '',
    configuration: get(['configuration', 'type', 'bhk'])?.value || '',
    carpetArea: carpet ?? 0,
    builtUpArea: num(['built up area', 'built up']) ?? 0,
    superBuiltUpArea: num(['super built up area', 'saleable area', 'super built up']) ?? 0,
    agreedPrice: price ?? 0,
    otherCharges: num(['other charges', 'extras', 'amenities']) ?? 0,
    buyer: get(['allottee', 'purchaser', 'buyer', 'applicant', 'name of allottee'])?.value || '',
    // An allotment letter with no unit number and no price is not one.
    read: Boolean(get(['unit no', 'flat no', 'apartment no', 'unit', 'flat', 'shop no'])?.value) && (carpet !== null || price !== null),
  }
}

// ── Which kind of paper is this ─────────────────────────────────────
//
// Guessed from the words a document uses about itself, and reported as a guess:
// the screen asks rather than assuming, because reading a quotation as a salary
// slip produces a confident set of zeroes.
export const PAPERS = {
  salarySlip: { id: 'salarySlip', label: 'Salary slip', parse: parseSalarySlip, target: 'employees' },
  quotation: { id: 'quotation', label: 'Quotation', parse: parseQuotation, target: 'quotes' },
  allotment: { id: 'allotment', label: 'Allotment letter', parse: parseAllotment, target: 'units' },
}
export const PAPER_IDS = Object.keys(PAPERS)

const HINTS = {
  salarySlip: /\b(pay ?slip|salary slip|salary for the month|net pay|gross earnings|earnings and deductions)\b/i,
  quotation: /\b(quotation|quote no|proforma|estimate for|we are pleased to quote)\b/i,
  allotment: /\b(allotment|allottee|agreement to sell|carpet area|agreement value|booking form)\b/i,
}

export function guessPaper(text = '') {
  const scores = PAPER_IDS.map((id) => ({
    id,
    hits: (String(text).match(new RegExp(HINTS[id], 'gi')) || []).length,
  })).sort((a, b) => b.hits - a.hits)
  // No word from any of them is not a guess, and saying so beats picking the
  // first in the list.
  if (!scores[0].hits) return { id: null, confident: false, why: 'Nothing in it says what kind of document it is.' }
  return {
    id: scores[0].id,
    // Two kinds claiming it equally is a document the reader cannot place.
    confident: scores[0].hits > (scores[1]?.hits || 0),
    why: '',
  }
}

export function readPaper(text = '', kind = null) {
  const guess = kind ? { id: kind, confident: true, why: '' } : guessPaper(text)
  if (!guess.id) return { kind: null, read: false, why: guess.why }
  const paper = PAPERS[guess.id]
  return { ...paper.parse(text), target: paper.target, guessed: !kind, confident: guess.confident }
}

// ── What a document becomes ─────────────────────────────────────────
//
// One document is one record, so this returns a list of one — except a
// quotation, which is one record with as many lines as the vendor priced.
// Returning a list either way means the screen that confirms a spreadsheet and
// the screen that confirms a PDF are the same screen.
export function paperRows(paper, { entityId = null, projectId = null } = {}) {
  if (!paper?.read) return []
  if (paper.kind === 'allotment') {
    // The parsed field names are the importer's field names on purpose, so the
    // same maker runs whether the flat came off a spreadsheet or a letter.
    return [TARGETS.units.make(paper, { entityId, projectId })]
  }
  if (paper.kind === 'salarySlip') {
    // A slip is about a month; what it tells you that outlives the month is the
    // person's pay structure, which is what an employee record is.
    return [TARGETS.employees.make({
      name: paper.name,
      code: paper.code,
      pan: paper.pan,
      uan: paper.uan,
      ...paper.components,
    }, { entityId })]
  }
  if (paper.kind === 'quotation') {
    return [makeQuote({
      entityId,
      projectId,
      vendor: paper.vendor,
      contact: paper.contact,
      date: paper.date,
      validUntil: paper.validUntil,
      ref: paper.ref,
      lines: paper.lines.map((l) => makeQuoteLine(l)),
    })]
  }
  return []
}

// What was read and what was not, for a screen to show before it writes.
export function describePaper(paper) {
  if (!paper) return ''
  if (!paper.kind) return paper.why || 'Nothing in it could be read.'
  const label = PAPERS[paper.kind].label
  if (!paper.read) return `That looks like a ${label.toLowerCase()}, but not enough of it could be read to add anything.`
  const bits = [`Read as a ${label.toLowerCase()}`]
  if (paper.guessed && !paper.confident) bits.push('though it could be another kind — check before adding')
  return `${bits.join(', ')}.`
}
