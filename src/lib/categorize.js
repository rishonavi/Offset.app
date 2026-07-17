// Smart expense categorisation — suggests a category from the vendor/payee.
// Two signals, in order of confidence:
//   1. History  — how you categorised this same vendor before (learns as you go)
//   2. Keywords — a built-in map for common vendors when there's no history yet
// Everything runs client-side on data already in the app; nothing is sent out.

const normalize = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()

// Ordered keyword rules — first match wins, so put the more specific ones first.
const KEYWORD_RULES = [
  [/(insurance|policy|premium|\blic\b)/, 'Insurance'],
  [/(property\s*tax|municipal|corporation|\bbbmp\b|\bbmc\b|house\s*tax|\bkhata\b)/, 'Property Tax'],
  [/(\bemi\b|home\s*loan|mortgage|loan\s*repay|\bemis\b)/, 'Loan / EMI'],
  [/(broker|brokerage|commission|listing|advertis|marketing)/, 'Brokerage / Marketing'],
  [/(permit|legal|lawyer|advocate|notary|registration|stamp\s*duty|registrar)/, 'Permits & Legal'],
  [/(furnitur|sofa|curtain|mattress|appliance|\bikea\b|pepperfry|urban\s*ladder|furnish)/, 'Furnishing'],
  [/(plumb|electrician|carpenter|repair|servic|pest|clean|leak|maintenance|\bamc\b)/, 'Maintenance & Repairs'],
  [/(contractor|labour|\blabor\b|mason|mistri|worker|mestri)/, 'Labor / Contractors'],
  [/(cement|steel|\bsand\b|brick|tiles?|hardware|timber|\bwood\b|paint|ultratech|material|plywood|sanitary|fittings?)/, 'Materials'],
  [/(electric|\bpower\b|\bgas\b|\bwater\b|broadband|internet|\bwifi\b|\bphone\b|mobile|bescom|\bmseb\b|tata\s*power|adani|\bjio\b|airtel|utility|utilities|sewage|\bbsnl\b)/, 'Utilities'],
]

// Build a vendor → most-used-category lookup from your expense history.
export function buildVendorIndex(expenses = []) {
  const counts = new Map() // normVendor → Map(category → count)
  for (const e of expenses) {
    const v = normalize(e.vendor)
    const c = (e.category || '').trim()
    if (!v || !c) continue
    if (!counts.has(v)) counts.set(v, new Map())
    const inner = counts.get(v)
    inner.set(c, (inner.get(c) || 0) + 1)
  }
  const index = new Map()
  for (const [v, inner] of counts) {
    let best = null
    let bestN = 0
    for (const [c, n] of inner) if (n > bestN) ((best = c), (bestN = n))
    if (best) index.set(v, best)
  }
  return index
}

// Suggest a category for a vendor. Returns { category, source } or null.
export function suggestCategory(vendor, index = new Map()) {
  const norm = normalize(vendor)
  if (norm.length < 2) return null

  // 1. Exact history match.
  if (index.has(norm)) return { category: index.get(norm), source: 'history' }

  // 2. Partial history match (either contains the other), for typed prefixes.
  for (const [k, v] of index) {
    if (k.length >= 3 && (k.includes(norm) || norm.includes(k))) {
      return { category: v, source: 'history' }
    }
  }

  // 3. Built-in keyword fallback.
  for (const [re, cat] of KEYWORD_RULES) {
    if (re.test(norm)) return { category: cat, source: 'keyword' }
  }
  return null
}
