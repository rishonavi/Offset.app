// Choosing for someone, but only when their own history makes the choice
// obvious.
//
// A form that pre-fills a guess is worse than one that leaves the field blank.
// A blank field asks a question; a wrong default answers it quietly, and the
// answer goes into the books. So these return nothing at all unless the
// evidence is one-sided — which for most people it is, because the same shop,
// the same card and the same flat come up again and again.

// Recent entries only. Someone who changed bank last year did not change it
// halfway through every entry, and the whole ledger would keep voting for the
// old one long after they stopped using it.
const RECENT = 40
// The value has to be most of what they do, not merely the largest slice of a
// scattered field. Two categories at 30% each is not a habit.
const SHARE = 0.6
// And it has to have happened enough times to be a habit rather than a
// coincidence: the first entry someone ever makes should not become the default
// for the second.
const LEAST = 3

const newestFirst = (rows) =>
  [...rows].sort((a, b) => String(b.date || b.created_at || '').localeCompare(String(a.date || a.created_at || '')))

// The value someone uses most, or '' when there is no clear answer.
export function usual(rows, field, { among } = {}) {
  if (!Array.isArray(rows) || !rows.length || !field) return ''
  const recent = newestFirst(rows).slice(0, RECENT)
  const counts = new Map()
  let total = 0
  for (const row of recent) {
    const v = row?.[field]
    if (v === null || v === undefined || v === '') continue
    if (among && !among.includes(v)) continue
    counts.set(v, (counts.get(v) || 0) + 1)
    total += 1
  }
  if (!total) return ''
  let best = ''
  let hits = 0
  for (const [v, n] of counts) if (n > hits) { best = v; hits = n }
  return hits >= LEAST && hits / total >= SHARE ? best : ''
}

// The one they touched last. For picking which asset an entry belongs to, this
// beats counting: someone working through a stack of bills for one flat wants
// that flat again, even if another one has more entries overall.
export function lastUsed(rows, field, { among } = {}) {
  if (!Array.isArray(rows) || !field) return ''
  for (const row of newestFirst(rows)) {
    const v = row?.[field]
    if (v === null || v === undefined || v === '') continue
    if (among && !among.includes(v)) continue
    return v
  }
  return ''
}

// Whether a form has anything in it beyond the essentials — the question
// "should the rest of this form already be open?". Editing an entry that has a
// payment method recorded must not hide it behind a disclosure.
export function hasDetail(form, fields, blank) {
  if (!form) return false
  return fields.some((f) => {
    const v = form[f]
    if (v === null || v === undefined || v === '') return false
    // A default is not detail. 'paid' and 'none' are what the form starts as.
    return v !== (blank ? blank[f] : undefined)
  })
}
