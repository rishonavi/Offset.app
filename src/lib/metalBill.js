// Turning a jeweller's or bullion dealer's bill into a metal holding.
//
// A bill and an asset do not describe the same thing, and three differences
// between them cause every wrong number here:
//
//   1. A bill quotes per gram. The app stores a rate the way the market prints
//      it — gold per 10 grams, silver per kilogram — so a per-gram figure
//      carried across unchanged is out by ten, or by a thousand.
//   2. A jewellery bill has two weights. Gross includes the stones; only the
//      net is metal. Reading the larger number values a diamond ring as though
//      the diamond were gold.
//   3. The total is not the metal. Making charges and the GST on them are not
//      recovered on resale, so a valuation built from the total flatters the
//      asset — the point docs/ASSETS.md makes about jewellery.
//
// So the bill's own breakdown is kept as a breakdown, and only the metal facts
// become the holding.

import { METALS, UNITS } from './metals'

// Karat is what the bill says; fineness is what the app stores. These are the
// stamped values, not k/24 — 22/24 is 0.91666…, and the number on the piece is
// 916, which is what a purity picker has to match.
const STAMPED = { 24: 999, 23: 958, 22: 916, 21: 875, 18: 750, 14: 585, 10: 417, 9: 375 }

export function finenessFromKarat(karat) {
  const k = Number(karat)
  if (!Number.isFinite(k) || k <= 0 || k > 24) return null
  if (STAMPED[k]) return STAMPED[k]
  // An unusual karat still converts; rounding to a whole thousandth is what
  // fineness is.
  return Math.round((k / 24) * 1000)
}

// How much of one gram of the quoted metal a bill's rate refers to. Everything
// is reduced to a per-gram figure first, because that is the only basis all of
// them share.
const BASIS_GRAMS = {
  per_gram: 1,
  per_10_gram: 10,
  per_100_gram: 100,
  per_kg: 1000,
  per_tola: UNITS.tola.grams,
  per_ozt: UNITS.ozt.grams,
}

export const RATE_BASES = Object.keys(BASIS_GRAMS)

// The app stores a rate in the metal's own quote convention: `quotePer` of
// `quoteUnit`. Gold is 10 grams, silver is 1 kilogram.
export function rateToQuoteBasis(amount, basis, metalKey) {
  const value = Number(amount)
  const perGrams = BASIS_GRAMS[basis]
  const metal = METALS[metalKey]
  if (!Number.isFinite(value) || value <= 0 || !perGrams || !metal) return null
  const perGram = value / perGrams
  const quoteGrams = UNITS[metal.quoteUnit].grams * metal.quotePer
  // Two decimal places: a rate is money, and carrying float noise into a rupee
  // figure is the mistake this module exists to avoid.
  return Math.round(perGram * quoteGrams * 100) / 100
}

const num = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

const METAL_WORDS = [
  [/plat/i, 'platinum'],
  [/silver|chandi|चांदी|ચાંદી|வெள்ளி/i, 'silver'],
  [/gold|sona|सोना|સોનું|தங்கம்|swarna/i, 'gold'],
]

export function metalFromText(text) {
  const s = String(text || '')
  for (const [pattern, key] of METAL_WORDS) if (pattern.test(s)) return key
  return null
}

// Takes what the reader got off the bill and returns the fields the asset form
// uses, plus the arithmetic that was left out of them and why. Anything the
// bill does not say comes back null — a missing rate is "we don't know", never
// zero, and a zero here would quietly value a holding at nothing.
export function fromBill(raw = {}) {
  const metal = METALS[raw.metal] ? raw.metal : metalFromText(raw.description || raw.item || raw.vendor)

  const net = num(raw.net_weight_g)
  const gross = num(raw.gross_weight_g)
  const stones = num(raw.stone_weight_g)
  // Net if it is given. If only a gross weight is on the bill and stones are
  // itemised, gross minus stones is the metal; if nothing says otherwise, gross
  // is all there is, and the caller is told the difference.
  const quantity = net ?? (gross != null && stones != null ? Math.round((gross - stones) * 10000) / 10000 : gross)

  const fineness = num(raw.purity_fineness) ?? finenessFromKarat(raw.purity_karat)
  const rate = rateToQuoteBasis(raw.rate_amount, raw.rate_basis, metal)

  const making = num(raw.making_charges)
  const tax = num(raw.tax)
  const total = num(raw.total)
  const metalValue = num(raw.metal_value)

  const notes = []
  if (metal && rate == null && num(raw.rate_amount) != null) {
    // A rate with no stated basis is the one number that cannot be guessed:
    // per-gram and per-10-gram differ by ten, and picking wrong is a valuation
    // out by an order of magnitude.
    notes.push('bill_rate_basis_unknown')
  }
  if (net == null && gross != null) notes.push(stones == null ? 'weight_is_gross' : 'weight_from_gross_less_stones')
  if (making != null) notes.push('making_charges_excluded_from_metal')
  if (quantity == null) notes.push('no_weight')
  if (fineness == null) notes.push('no_purity')

  return {
    metal: metal || null,
    metal_quantity: quantity,
    metal_unit: 'g',
    metal_fineness: fineness,
    metal_rate: rate,
    // What the purchase cost, which is what an asset's value means here. The
    // holding's worth is computed from weight, purity and rate instead — and
    // the gap between the two is the making charges, which is the honest
    // picture rather than a flattering one.
    value: total ?? metalValue,
    vendor: raw.vendor || null,
    date: raw.date || null,
    breakdown: { metalValue, making, tax, total },
    notes,
  }
}

// What to tell someone about a reading, in the order it matters.
export function billNotes(result, t = (k) => k) {
  const said = []
  for (const note of result?.notes || []) said.push(t(`metalBill.${note}`))
  return said
}
