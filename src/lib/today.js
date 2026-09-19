// What day it is, where the user is standing.
//
// This app was writing today's date as `new Date().toISOString().slice(0, 10)`
// in thirty-odd places. `toISOString` is UTC. India is UTC+5:30, so between
// midnight and half past five in the morning that expression returns
// *yesterday* — five and a half hours out of every twenty-four, on an app that
// is India-first in its currency, its tax year and its locale.
//
// It is the kind of fault that never shows up in the office and always shows
// up on a site: a stores clerk booking a 4am delivery of RMC dates it to the
// previous day, the movement lands in a period that may already be locked, and
// the day's consumption does not line up with the day's muster. A night shift
// is not an edge case in construction; pours are scheduled at night precisely
// because it is cooler.
//
// No date-fns here on purpose. This is imported by a dozen leaf modules that
// want a date string and nothing else, and it should not drag a date library
// onto a page for the sake of ten characters.
const pad = (n) => String(n).padStart(2, '0')

// Today as yyyy-MM-dd, read off the local clock.
export const todayISO = (now = new Date()) =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

// The same reading, for the places that want a month.
export const thisMonth = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
