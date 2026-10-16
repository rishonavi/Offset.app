// A fixed "today", for the suites that read the sample books.
//
// `sampleSite.js` dates every row relative to now — `day(180)` is a bill from a
// hundred and eighty days ago — because a demo ledger stamped with fixed dates
// reads as somebody else's old books within a year of being written. The cost
// is that the story it tells changes as the calendar moves, and India's
// financial year is an absolute window: on 23 September the first RA bill on
// the sample's RCC order fell 180 days back, five days before the year began,
// and was out of the return. Three weeks later the same `day(180)` landed four
// days *after* 1 April and the deduction on that order went from ₹96,000 to
// ₹1,46,000 with nothing in the app or the data having changed.
//
// So a suite that asserts a figure from those books has to say which day it is
// standing on. Two tests were passing only because of where the calendar
// happened to be — which is the worst kind, since they go red on a date nobody
// chose and in a session nobody connected to the change.
//
// Subclassing covers both ways the time is read: `new Date()` with no argument,
// and `Date.now()`, which is what date-fns calls. Every other form — a parsed
// string, a timestamp, `Date.UTC` — is left alone, so dates in the data still
// mean what they say.
export function freezeClock(iso) {
  const fixed = new Date(iso).getTime()
  if (!Number.isFinite(fixed)) throw new Error(`freezeClock: ${iso} is not a date`)
  const Real = globalThis.Date
  class Frozen extends Real {
    constructor(...args) {
      super(...(args.length ? args : [fixed]))
    }
    static now() {
      return fixed
    }
  }
  globalThis.Date = Frozen
  return () => {
    globalThis.Date = Real
  }
}
