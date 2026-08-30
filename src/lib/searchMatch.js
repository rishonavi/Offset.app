// Matching a query against a record, in the ways people actually type.
//
// The palette used to test one field at a time with a raw substring, so
// "villa sea" found nothing that "sea view villa" found, and "cafe" found no
// Café. Both are the same mistake: treating the query as one literal string
// and each field as a separate universe.

// Fold accents and case so "Café" and "cafe" are one word. Latin, Devanagari
// and Arabic all normalise; scripts without diacritics are simply unchanged.
export const fold = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

// The words someone typed, in no particular order.
export const terms = (q) => fold(q).split(/\s+/).filter(Boolean)

// Every word has to appear somewhere in the record — not all in the same field,
// which is what lets "villa plumber" find the plumber's bill for the villa.
export function matchesAll(fields, queryTerms) {
  if (!queryTerms.length) return true
  const hay = fields.filter(Boolean).map(fold).join(' ')
  return queryTerms.every((t) => hay.includes(t))
}

// How well a record matched, for ordering. A word that starts a field is a
// better hit than one buried in the middle of a note, and a whole-field match
// is better still — someone typing "rent" means the source called Rent before
// they mean an expense whose description mentions rent.
export function score(fields, queryTerms) {
  if (!queryTerms.length) return 0
  let total = 0
  const folded = fields.filter(Boolean).map(fold)
  for (const t of queryTerms) {
    let best = 0
    for (const f of folded) {
      if (f === t) best = Math.max(best, 4)
      else if (f.startsWith(t)) best = Math.max(best, 3)
      else if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(f)) best = Math.max(best, 2)
      else if (f.includes(t)) best = Math.max(best, 1)
    }
    total += best
  }
  return total
}
