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

export const draftKey = (kind, id) => `${PREFIX}${kind}_${id || 'new'}`

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
    if (!Object.keys(fields).length) return
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), fields }))
  } catch {
    // A draft is a convenience. If storage is full or blocked, the form must
    // still work — failing the thing someone is typing to protect a backup of
    // it would be the wrong way round.
  }
}

export function readDraft(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key))
    if (!parsed?.fields) return null
    if (!parsed.at || Date.now() - parsed.at > MAX_AGE_MS) {
      clearDraft(key)
      return null
    }
    return parsed.fields
  } catch {
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
export function pruneDrafts() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX)) readDraft(key) // readDraft clears what is stale
    }
  } catch {
    /* nothing to do */
  }
}
