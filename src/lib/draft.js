// Keeping a half-typed entry while you go and look something up.
//
// A form's state lives in React and dies with the component. Navigating to
// check an invoice number, or a phone deciding to reclaim a backgrounded tab —
// which reloads the page — took everything typed so far with it, silently, with
// no way to get it back. That is the "it forgets what I typed" complaint, and
// it is a different thing from the ledger's own storage, which persists fine.
//
// A draft is small, scalar and short-lived, so localStorage is the right home:
// it survives a reload, unlike anything in memory.

const PREFIX = 'pl_draft_'

// A draft older than this is more likely to confuse than to help — you have
// forgotten the context, and silently restoring last week's half-entry over a
// fresh form is worse than losing it.
const MAX_AGE_MS = 24 * 60 * 60 * 1000

// `books` is the company whose books the form is being filled in, or '' for
// your own. A half-typed company expense restoring itself into a personal form
// is the same leak as the ledger's, in miniature — and the more confusing kind,
// because it arrives unannounced in a form you had just opened.
export const draftKey = (kind, id, books = '') =>
  `${PREFIX}${kind}_${id || 'new'}${books ? `@${books}` : ''}`

// Only plain scalars. A File cannot be serialised and a data URL would put a
// photograph into every keystroke's worth of writes, so attachments are
// deliberately not part of a draft — see restoreNote().
const scalarsOnly = (value) => {
  const out = {}
  for (const [k, v] of Object.entries(value || {})) {
    if (v == null) continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v
  }
  return out
}

export function writeDraft(key, value) {
  try {
    const fields = scalarsOnly(value)
    // Nothing worth keeping means nothing kept, including anything kept
    // earlier: this used to `return` and leave the old key sitting there.
    //
    // Narrower than it looks, and deliberately so. `scalarsOnly` keeps an empty
    // string, so a form the user blanked still has fields and still writes —
    // and the forms do not call this on a blanked form anyway, because
    // `worthKeeping` (ExpenseForm.jsx) suppresses it. That guard is there to
    // stop "start fresh" immediately writing back the draft it just removed,
    // which is a real bug and not one to trade away. What this branch catches
    // is the case where every field is null or undefined, where the old key
    // used to survive for a day having been superseded by nothing.
    if (!Object.keys(fields).length) {
      clearDraft(key)
      return
    }
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), fields }))
  } catch {
    // A draft is a convenience. If storage is full or blocked, the form must
    // still work — failing the thing someone is typing to protect a backup of
    // it would be the wrong way round.
  }
}

export function readDraft(key) {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return null
    const parsed = JSON.parse(raw)
    // A draft is an object of scalars or it is not a draft. This checked only
    // that `fields` was truthy, so a stored array came back as an array and the
    // form spread it into its state as `{0: 'x', 1: 'y'}` — and a number or a
    // string came back and was swallowed by the spread without a trace.
    const fields = parsed?.fields
    const usable = fields && typeof fields === 'object' && !Array.isArray(fields)
    if (!usable) {
      // Cleared rather than merely refused, which is the whole point of the
      // sweep below: this branch and the `catch` both used to return null and
      // leave the key behind, so the only entries `pruneDrafts` could never
      // collect were the malformed ones it most needed to.
      clearDraft(key)
      return null
    }
    // A draft stamped in the future is not fresh, it is wrong — a phone before
    // its clock synced, or a clock somebody corrected. `now - at` is negative
    // there, so it compared as newer than new and the draft became immortal:
    // never expiring, and never collectable either.
    const age = Date.now() - parsed.at
    if (!parsed.at || age < 0 || age > MAX_AGE_MS) {
      clearDraft(key)
      return null
    }
    return fields
  } catch {
    // Unparseable. Same reasoning as above — it can never become readable, and
    // leaving it is the leak.
    clearDraft(key)
    return null
  }
}

export function clearDraft(key) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* nothing to do */
  }
}

// Whether a draft actually differs from the form you would have got anyway.
// Restoring a draft identical to the blank form, and announcing it, would be
// noise pretending to be a rescue.
export function draftDiffers(draft, base) {
  if (!draft) return false
  return Object.keys(draft).some((k) => String(draft[k] ?? '') !== String(base?.[k] ?? ''))
}

// Drafts are per-form and expire, but a browser that never finishes an entry
// would still accumulate one key per asset edited. Cheap to sweep on startup.
//
// It collects malformed entries as well as stale ones. It did not: `readDraft`
// cleared only on the expiry branch, so a key holding broken JSON, `null`, `{}`
// or a timestamp with no fields survived every sweep for the life of the
// installation — which is exactly the leak this exists to stop, kept alive for
// the entries with the least claim to be kept.
export function pruneDrafts() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX)) readDraft(key) // readDraft clears what is stale
    }
  } catch {
    /* nothing to do */
  }
}
