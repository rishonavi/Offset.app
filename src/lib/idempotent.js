// The same thing recorded twice.
//
// A site engineer taps Record, the phone is on 2G in a basement lift shaft, and
// nothing visible happens for four seconds. He taps it again. The books now say
// the gang was twice the size it was, and every cost downstream of that day is
// wrong by a day's labour — with two rows that are individually perfect and a
// total nobody will question.
//
// This is not the import problem, which `dedupe.js` already solves by asking
// whether a row is *already in the books at all*. It is narrower and needs a
// narrower answer: **an identical row, written seconds ago, is the same row.**
//
// Two things follow from that, and both matter:
//
//   **Seconds, not days.** Two genuinely separate gangs of six masons at ₹850
//   on one site on one day is a thing that happens, and a rule that refused it
//   would have people entering fiction to get round the app. Fifteen seconds
//   apart it is a double tap; an hour apart it is two gangs.
//
//   **It is reported, not swallowed.** The repeat comes back marked, so the
//   screen can say nothing was added twice. A silent swallow of a real second
//   entry is worse than the double it prevents, because nobody can see it.
//
// The other half of idempotence — a *sync* retried after a dropped connection —
// is already handled: rows carry a client-generated id and the push upserts on
// it, so the same row sent twice is one row. This is the half the id cannot
// help with, because a second tap makes a second id.

// How long two identical rows are treated as one.
export const WINDOW_SECONDS = 15

// Keys that differ between two taps of the same button and say nothing about
// what was recorded.
const VOLATILE = new Set(['id', 'created_at', 'updated_at', 'deleted_at'])

// Everything the row actually says, in a stable order so two objects built in
// different key orders compare equal.
export function contentKey(row = {}) {
  const parts = []
  for (const key of Object.keys(row).sort()) {
    if (VOLATILE.has(key) || key.startsWith('_')) continue
    const value = row[key]
    parts.push(`${key}=${value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}`)
  }
  return parts.join('|')
}

const at = (row) => {
  const t = Date.parse(row?.created_at || '')
  return Number.isFinite(t) ? t : null
}

// A row already written that says exactly the same thing, moments ago.
//
// Deleted rows are skipped on purpose: somebody who removed a line and entered
// it again meant to, and handing back the tombstone would undo their correction.
export function findRepeat(row, existing = [], { windowSeconds = WINDOW_SECONDS, now = null } = {}) {
  const key = contentKey(row)
  if (!key) return null
  const nowMs = now === null ? Date.now() : (typeof now === 'number' ? now : Date.parse(now))
  const cutoff = nowMs - windowSeconds * 1000
  let best = null
  for (const candidate of existing) {
    if (candidate?.deleted_at) continue
    if (candidate?.id === row?.id) continue
    const when = at(candidate)
    // A row with no usable timestamp cannot be shown to be recent, and guessing
    // that it is would silently drop a legitimate entry.
    if (when === null || when < cutoff || when > nowMs) continue
    if (contentKey(candidate) !== key) continue
    if (!best || when > at(best)) best = candidate
  }
  return best
}

// For the sentence a screen shows when it happens.
export const repeatNote = (noun = 'entry') =>
  `That ${noun} was already recorded a moment ago, so nothing was added twice.`
