// What someone searched for recently, kept on the device for a week.
//
// Two decisions do most of the work here.
//
// **Recorded when a search succeeds, not while it is typed.** Saving on every
// keystroke fills the list with "s", "se", "sea" — the prefixes of one search,
// none of which anyone meant. A search is a thing someone did only once they
// acted on a result, so that is the moment it is written down.
//
// **It expires.** A week is long enough to cover "what was that vendor called
// last Tuesday" and short enough that a shared laptop does not hand over a
// month of someone's finances. Old entries are dropped on the way out as well
// as on the way in, so a list that has been sitting in storage since March
// cannot be read back even once.

const KEY = 'pl_search_history'
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
// Enough to be useful in a dropdown, few enough to scan without reading.
const MAX = 8
// One letter is a keystroke, not a search worth remembering.
const MIN_LENGTH = 2

const load = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

const save = (rows) => {
  try {
    if (rows.length) localStorage.setItem(KEY, JSON.stringify(rows))
    else localStorage.removeItem(KEY)
  } catch {
    /* a browser refusing to store this is not worth an error to the user */
  }
}

// Anything malformed is dropped rather than trusted: this is read back from
// storage that another version of the app — or a person with devtools — may
// have written.
const clean = (rows, now) =>
  rows
    .filter((r) => r && typeof r.q === 'string' && typeof r.at === 'number')
    .filter((r) => r.q.trim().length >= MIN_LENGTH)
    .filter((r) => now - r.at < WEEK_MS && r.at <= now)
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX)

export function readSearches(now = Date.now()) {
  const rows = clean(load(), now)
  return rows
}

// The queries alone, which is all the UI wants.
export const recentSearches = (now = Date.now()) => readSearches(now).map((r) => r.q)

export function recordSearch(q, now = Date.now()) {
  const text = String(q ?? '').trim()
  if (text.length < MIN_LENGTH) return recentSearches(now)
  // Searching the same thing again moves it to the top rather than listing it
  // twice — and matching case-insensitively, because "Villa" and "villa" are
  // one search to the person who typed them.
  const rest = clean(load(), now).filter((r) => r.q.toLowerCase() !== text.toLowerCase())
  const rows = [{ q: text, at: now }, ...rest].slice(0, MAX)
  save(rows)
  return rows.map((r) => r.q)
}

export function clearSearches() {
  save([])
  return []
}

// Exported for the tests and for anywhere that needs to describe the policy
// rather than restate the numbers.
export const RETENTION_DAYS = WEEK_MS / (24 * 60 * 60 * 1000)
export const MAX_REMEMBERED = MAX
