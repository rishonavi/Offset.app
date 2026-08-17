// Gold and silver are held in grams, quoted per contract unit, and almost
// never pure. Three facts that between them cause every valuation mistake
// people make with metal:
//
//   1. MCX quotes gold per **10 grams** and silver per **kilogram**. Multiply
//      a per-10g rate by your gram count and you are out by 10x.
//   2. A rate is for fine metal (999). A 22K chain is 91.6% gold, so it is
//      worth 91.6% of the rate — not the rate.
//   3. Jewellery carries making charges and GST that you will never get back
//      on resale. This values the *metal*, and says so.

// Everything reduces to grams. Tola and troy ounce are exact definitions, not
// approximations — 1 tola is 3/8 of a troy ounce by law.
export const UNITS = {
  g: { label: 'grams', short: 'g', grams: 1 },
  kg: { label: 'kilograms', short: 'kg', grams: 1000 },
  tola: { label: 'tola', short: 'tola', grams: 11.6638038 },
  ozt: { label: 'troy ounces', short: 'oz t', grams: 31.1034768 },
}

export const UNIT_KEYS = Object.keys(UNITS)

// Purity in millesimal fineness — the number actually stamped on the piece.
// Karat is a display convenience; 22K and 916 are the same thing.
export const PURITIES = {
  gold: [
    { fineness: 999, label: '24K · 999 (fine)' },
    { fineness: 995, label: '24K · 995' },
    { fineness: 916, label: '22K · 916' },
    { fineness: 750, label: '18K · 750' },
    { fineness: 585, label: '14K · 585' },
    { fineness: 375, label: '9K · 375' },
  ],
  silver: [
    { fineness: 999, label: '999 (fine)' },
    { fineness: 925, label: '925 (sterling)' },
    { fineness: 900, label: '900 (coin)' },
  ],
  platinum: [
    { fineness: 999, label: '999 (fine)' },
    { fineness: 950, label: '950' },
    { fineness: 900, label: '900' },
  ],
}

// `quotePer` + `quoteUnit` is how the market prints the price, not how you
// hold the metal.
export const METALS = {
  gold: { key: 'gold', label: 'Gold', symbol: 'XAU', quoteUnit: 'g', quotePer: 10, defaultFineness: 916 },
  silver: { key: 'silver', label: 'Silver', symbol: 'XAG', quoteUnit: 'kg', quotePer: 1, defaultFineness: 999 },
  platinum: { key: 'platinum', label: 'Platinum', symbol: 'XPT', quoteUnit: 'g', quotePer: 10, defaultFineness: 950 },
}

export const METAL_KEYS = Object.keys(METALS)

// Asset types that are a quantity of metal rather than a single thing with a
// price. Matched exactly against the list in constants.js — deliberately not
// a regex over the label, because 'Precious Metals — Gold / Silver' names two
// metals and a pattern would silently pick whichever appears first.
export const METAL_ASSET_TYPES = ['Jewellery', 'Precious Metals — Gold / Silver']

export const holdsMetal = (type) => METAL_ASSET_TYPES.includes(type)

// Jewellery is overwhelmingly gold in India, and the combined metals type
// starts at gold too — but both are pickers, so the user corrects it in one
// click if they are holding silver.
export const defaultMetalFor = (type) => (holdsMetal(type) ? 'gold' : null)

// Number(null), Number('') and Number(' ') are all 0, which would turn "no
// rate given" into "worth nothing" — the exact confusion this module exists to
// avoid. Absent has to stay absent.
const num = (v) => {
  if (v == null) return null
  if (typeof v === 'string' && v.trim() === '') return null
  const n = typeof v === 'string' ? Number(v.trim()) : Number(v)
  return Number.isFinite(n) ? n : null
}

const round = (n, dp) => {
  const f = 10 ** dp
  return Math.round((n + Number.EPSILON) * f) / f
}

export const round2 = (n) => round(n, 2)

// 916/1000 in binary floating point is 0.9159999999999999, and that error
// rides all the way into the rupee figure. Fix it at the source.
export function purityFactor(fineness) {
  const f = num(fineness)
  if (f == null || f <= 0 || f > 1000) return null
  return round(f / 1000, 4)
}

export function karatOf(fineness) {
  const f = purityFactor(fineness)
  return f == null ? null : round(f * 24, 1)
}

export function toGrams(quantity, unit) {
  const q = num(quantity)
  const u = UNITS[unit]
  if (q == null || !u) return null
  return round(q * u.grams, 6)
}

export function fromGrams(grams, unit) {
  const g = num(grams)
  const u = UNITS[unit]
  if (g == null || !u) return null
  return round(g / u.grams, 6)
}

// A market rate, converted to the only unit the arithmetic below cares about.
export function pricePerGram(metalKey, rate) {
  const m = METALS[metalKey]
  const r = num(rate)
  if (!m || r == null || r < 0) return null
  const gramsPerQuote = UNITS[m.quoteUnit].grams * m.quotePer
  return round(r / gramsPerQuote, 6)
}

export function quoteLabel(metalKey) {
  const m = METALS[metalKey]
  if (!m) return ''
  const u = UNITS[m.quoteUnit]
  return m.quotePer === 1 ? `per ${u.short}` : `per ${m.quotePer} ${u.short}`
}

// What the metal in a holding is worth.
//
// Returns `value: null` rather than 0 when there is no rate — "we don't know"
// and "it's worth nothing" are different answers, and a zero here would quietly
// drag a portfolio total down.
export function valueMetalHolding({ metal, quantity, unit = 'g', fineness, rate } = {}) {
  const m = METALS[metal]
  if (!m) return { error: 'Pick a metal.', value: null }

  const q = num(quantity)
  if (q == null) return { error: 'Enter how much you hold.', value: null }
  if (q < 0) return { error: 'A holding cannot be negative.', value: null }

  const grams = toGrams(q, unit)
  if (grams == null) return { error: `${unit} is not a unit this understands.`, value: null }

  const factor = purityFactor(fineness ?? m.defaultFineness)
  if (factor == null) return { error: 'Purity must be between 1 and 1000.', value: null }

  const fineGrams = round(grams * factor, 6)
  const perGram = pricePerGram(metal, rate)

  return {
    metal: m.key,
    grams,
    fineGrams,
    fineness: num(fineness ?? m.defaultFineness),
    factor,
    pricePerGram: perGram,
    // Fine grams, not gross — the rate buys pure metal.
    value: perGram == null ? null : round2(fineGrams * perGram),
    error: null,
  }
}

const trim = (n) => String(round(n, 3)).replace(/\.0+$/, '')

// "12 g of 22K gold · 11 g fine" — the fine weight spelled out, because that
// is the number the valuation actually used and the one people misread.
export function describeHolding({ metal, quantity, unit = 'g', fineness } = {}) {
  const m = METALS[metal]
  if (!m) return ''
  const q = num(quantity)
  if (q == null) return ''
  const u = UNITS[unit] || UNITS.g
  const fine = fineness ?? m.defaultFineness
  const factor = purityFactor(fine) ?? 1
  const grams = toGrams(q, unit) ?? 0
  const k = karatOf(fine)
  const purity = m.key === 'gold' && k != null ? `${trim(k)}K` : `${fine}`
  const head = `${trim(q)} ${u.short} of ${purity} ${m.label.toLowerCase()}`
  if (factor === 1 && u.grams === 1) return head
  return `${head} · ${trim(grams * factor)} g fine`
}

// Total across many holdings. Holdings with no rate are counted as `unpriced`
// and left out of the total rather than added in as zero.
export function totalMetalValue(holdings = []) {
  let value = 0
  let fineGrams = 0
  const unpriced = []
  for (const h of holdings) {
    const r = valueMetalHolding(h)
    if (r.error) continue
    fineGrams += r.fineGrams
    if (r.value == null) unpriced.push(h)
    else value += r.value
  }
  return { value: round2(value), fineGrams: round(fineGrams, 6), unpriced, priced: holdings.length - unpriced.length }
}

// Jewellery is bought at a premium it does not hold. Making charges and the
// 3% GST on them are gone the moment you walk out, so a resale estimate that
// ignores them flatters the asset.
export function resaleEstimate({ value, makingChargePct = 0, wastagePct = 0 } = {}) {
  const v = num(value)
  if (v == null || v < 0) return null
  const making = round2(v * (num(makingChargePct) || 0) / 100)
  const wastage = round2(v * (num(wastagePct) || 0) / 100)
  return { metalValue: round2(v), notRecovered: round2(making + wastage), estimate: round2(Math.max(0, v - making - wastage)) }
}
