// Reading rows out of the browser, and what to do when they will not read.
//
// Both local backends parsed JSON out of localStorage and answered a key they
// could not read with an empty array. Two things follow from that and neither
// is acceptable.
//
// The ledger reads as empty — no assets, no costs, nothing — and says nothing
// about it. That is the same silent failure the cloud path had, and an empty
// ledger is worse than an error because somebody acts on it.
//
// And the next write replaces the value with `[theOneNewRow]`, destroying
// whatever was still in there. A half-written array is mostly intact text and
// can be picked over by hand; an overwritten one is gone. `setItem` is atomic,
// so this is not a state the app can reach on its own — it takes an extension,
// a tab killed during an eviction, or somebody in devtools — but the cost of
// being wrong about that is a builder's whole year of books.
//
// The personal backend also returned whatever it parsed without checking it was
// a list, so a stored object came back as an object and `[...rows].sort()` threw
// on something that is not iterable. The corporate one checked. Both read
// through here now, so there is one answer to the question instead of two.

export const SALVAGE_SUFFIX = '__unreadable'

// Keyed by storage key, valued by what was wrong with it. A Map rather than a
// Set so the banner can say which, and so a key that reads correctly later
// clears itself.
const noted = new Map()

export const unreadable = () => [...noted.keys()]
export const whyUnreadable = (key) => noted.get(key) || null
export const forgetUnreadable = (key) => (key === undefined ? noted.clear() : noted.delete(key))

// Copy the raw text aside once, before anything can write over it. Keyed off
// the original so a human can find it, and never overwritten — the first copy
// is the one taken before any of this session's writes.
function setAside(storage, key, raw) {
  try {
    if (storage.getItem(key + SALVAGE_SUFFIX) === null) storage.setItem(key + SALVAGE_SUFFIX, raw)
  } catch {
    // No room to keep a copy. The original is still there until something
    // writes over it, and the warning is worth having either way.
  }
}

export function readRows(key, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage) return []
  let raw = null
  try {
    raw = storage.getItem(key)
  } catch {
    // Storage refused outright — a private window with site data blocked.
    // Nothing is stored and nothing is lost, so this is not worth reporting.
    return []
  }
  // An absent key is the normal state of a fresh browser, not a fault.
  if (raw === null || raw === '') {
    noted.delete(key)
    return []
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    noted.set(key, 'could not be read')
    setAside(storage, key, raw)
    return []
  }
  if (!Array.isArray(parsed)) {
    noted.set(key, 'was not a list of entries')
    setAside(storage, key, raw)
    return []
  }
  noted.delete(key)
  return parsed
}
