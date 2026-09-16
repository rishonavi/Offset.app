// A month that has been closed, and what that has to mean.
//
// Every report in this app is a photograph of a moving thing. Somebody prints
// March, sends it to the bank, and a fortnight later a bill dated the 28th of
// March is entered — not dishonestly, just late — and March is now a different
// number from the one in the bank's file. Nobody notices, because nothing in
// the app has any idea that March was ever finished.
//
// So a company can close its books through a month, and after that a write
// dated into it is refused. Three decisions:
//
//   **One line, not a table.** The lock is a single month on the entity — "the
//   books are closed through June". You do not close March and leave February
//   open, and a table of independent month flags would let somebody do exactly
//   that and then produce a year whose parts nobody can add up.
//
//   **Reopening is a step backwards, and it is loud.** Reopening June sets the
//   lock to May, which reopens July and August too if they were closed. That is
//   the honest consequence rather than a limitation: a month cannot be final
//   while the month before it is being edited.
//
//   **The rule lives where the writes are, not on the button.** A control
//   enforced by a disabled field is not a control — a second screen, an
//   import, or a restored backup all reach the store directly.
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/

export const monthOf = (dateISO) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(dateISO || ''))
  return m && MONTH.test(`${m[1]}-${m[2]}`) ? `${m[1]}-${m[2]}` : null
}

export const nextMonth = (month) => {
  if (!MONTH.test(String(month || ''))) return null
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

export const prevMonth = (month) => {
  if (!MONTH.test(String(month || ''))) return null
  const [y, m] = month.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

// The month the books are closed through, or null. Anything that is not a month
// is not a lock — a half-written value must not close the books by accident,
// and must not leave them open by accident either, so it is read strictly and
// reported as absent.
export const lockedThrough = (entity) => {
  const value = String(entity?.books_locked_through || '')
  return MONTH.test(value) ? value : null
}

export const isLockedOn = (entity, dateISO) => {
  const lock = lockedThrough(entity)
  const month = monthOf(dateISO)
  return Boolean(lock && month && month <= lock)
}

// Whether a row dated here may be written, and why not. The reason is half the
// feature: "refused" with no sentence beside it is a bug report.
export function checkPeriod(entity, dateISO) {
  const lock = lockedThrough(entity)
  const month = monthOf(dateISO)
  if (!lock) return { ok: true, lockedThrough: null, month, why: '' }
  // A row with no date cannot be in a closed month. A work order or a material
  // is not an entry in a period, and refusing those would close the company
  // rather than its books.
  if (!month) return { ok: true, lockedThrough: lock, month: null, why: '' }
  if (month > lock) return { ok: true, lockedThrough: lock, month, why: '' }
  return {
    ok: false,
    lockedThrough: lock,
    month,
    why: `The books are closed through ${lock}. Reopen them to change anything dated ${month}.`,
  }
}

// The months a company could close now: everything after the current lock, up
// to and including the last month that has finished. The current month is never
// offered — it is not over, and closing it would refuse entries for work being
// done today.
export function monthsToClose(entity, asOf = null) {
  const today = asOf || new Date().toISOString().slice(0, 10)
  const thisMonth = monthOf(today)
  if (!thisMonth) return []
  const last = prevMonth(thisMonth)
  const lock = lockedThrough(entity)
  // With nothing closed yet, only the month just gone is offered. A company
  // opening the app for the first time does not want eleven years of buttons,
  // and closing a month it has no records for means nothing.
  let from = lock ? nextMonth(lock) : last
  const out = []
  // Bounded rather than trusting the data: a lock read from a bad row could
  // otherwise walk forward for ever.
  while (from && from <= last && out.length < 24) {
    out.push(from)
    from = nextMonth(from)
  }
  return out
}

export const nextToClose = (entity, asOf = null) => monthsToClose(entity, asOf)[0] || null

// What reopening does. Returned rather than applied, because the caller is the
// one that writes and audits.
export const reopenTo = (entity) => {
  const lock = lockedThrough(entity)
  return lock ? prevMonth(lock) : null
}

export function describeLock(entity, asOf = null) {
  const lock = lockedThrough(entity)
  if (!lock) return 'The books have never been closed, so any month can still change.'
  const open = monthsToClose(entity, asOf)
  if (!open.length) return `Closed through ${lock}. Nothing older can change.`
  return open.length === 1
    ? `Closed through ${lock}. ${open[0]} is finished and still open.`
    : `Closed through ${lock}. ${open.length} finished months are still open.`
}
