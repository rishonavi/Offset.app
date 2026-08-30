// Which values on a form the app put there, rather than the person.
//
// Filling a field in borrows someone's authority. The number looks typed, it
// goes into the books, and it leaves in an export to an accountant as though a
// person had checked it. A default learned from history and a figure read off a
// photograph are both guesses, and neither looks like one once it is sitting in
// the box.
//
// So anything the app fills says where it came from — and stops saying so the
// moment the person edits it, because from then on the value is theirs and the
// note would be false.

// The origins a field can have. Anything not in here is not shown, so a typo in
// a caller cannot quietly produce a blank badge that means nothing.
export const ORIGINS = ['recent', 'history', 'scan', 'bill']

export const isOrigin = (v) => ORIGINS.includes(v)

// Mark fields as app-filled. Values that are empty are not marked: there is
// nothing there to explain, and a note under an empty box is just noise.
export function mark(filled, values, source) {
  if (!isOrigin(source)) return filled || {}
  const next = { ...(filled || {}) }
  for (const [k, v] of Object.entries(values || {})) {
    if (v === null || v === undefined || v === '') continue
    next[k] = source
  }
  return next
}

// The person has taken this field over. Returns the same object when there was
// nothing to drop, so a change handler on every keystroke does not re-render the
// whole form for nothing.
export function claim(filled, key) {
  if (!filled || !(key in filled)) return filled || {}
  const next = { ...filled }
  delete next[key]
  return next
}

// Everything is theirs again — after a save, or after the form is reset.
export const claimAll = () => ({})

// How many values on screen are still the app's rather than the person's, so a
// form can say so once at the top instead of only field by field.
export const pending = (filled) => Object.keys(filled || {}).length
