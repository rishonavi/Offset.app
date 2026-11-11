// The helper that holds the clock still, and whether it actually does.
//
// `_clock.mjs` is relied on by the suites that read figures out of the sample
// books and by the ones that assert a fetch window or a due date. It had no
// test of its own — which is the exact blind spot the rest of this work has
// been chasing, and a worse case than most: a freeze that silently did not
// take would not fail anything. It would make the suites that depend on it pass
// against the real calendar, and they would go red months later, on a date
// nobody chose, in a session with no connection to the change. That is the
// failure mode `_clock.mjs` was written to end.
//
// Four things have to hold, and the first two are the ones a naive stub gets
// wrong:
//
//   • `new Date()` with no arguments reads the frozen instant;
//   • `Date.now()` does too, because that is what date-fns calls — a stub that
//     only overrode the constructor would leave every date-fns comparison
//     reading the real clock;
//   • every *other* way of making a date is left alone, so dates in the data
//     still mean what they say. A fixture of `new Date('2018-04-01')` must not
//     become today.
//   • thawing puts the real clock back, or one suite's freeze leaks into
//     whatever runs next in the same process.
import { freezeClock } from './_clock.mjs'
import { isToday, isFuture, isValid, subDays, differenceInCalendarDays } from 'date-fns'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

const AT = '2026-10-01T06:30:00.000Z'

console.log('── THE CLOCK STOPS ──')
{
  const thaw = freezeClock(AT)
  eq('a bare `new Date()` reads the frozen instant', new Date().toISOString(), AT)
  // What date-fns calls. A stub that only subclassed the constructor would pass
  // the line above and fail this one, and every date-fns comparison in every
  // suite would quietly be against the real calendar.
  eq('`Date.now()` reads it too', new Date(Date.now()).toISOString(), AT)
  eq('and the two agree', new Date().getTime(), Date.now())
  // Time does not advance while frozen, which is the point: a suite that reads
  // the clock twice must get one answer, or an assertion can straddle a second.
  const first = Date.now()
  for (let i = 0; i < 2e5; i++) Math.sqrt(i)
  eq('nor does it advance between two reads', Date.now(), first)
  thaw()
}

console.log('\n── AND date-fns STOPS WITH IT ──')
{
  // These read the clock inside date-fns rather than in this file, so they are
  // the ones that prove the override reaches the library the app actually uses.
  const thaw = freezeClock(AT)
  const frozen = new Date(AT)
  ok('date-fns agrees the frozen instant is today', isToday(frozen))
  ok('and that a later date is still ahead', isFuture(new Date('2026-10-15T00:00:00Z')))
  ok('while an earlier one is not', !isFuture(new Date('2026-09-15T00:00:00Z')))
  // Arithmetic from "now" lands where the freeze says, not where the calendar
  // is. 180 days is `day(180)` in sampleSite.js, which is what made two suites
  // drift in the first place.
  eq('arithmetic from now follows the freeze', differenceInCalendarDays(new Date(), subDays(new Date(), 180)), 180)
  eq('and lands on a fixed day', subDays(new Date(), 180).toISOString().slice(0, 10), '2026-04-04')
  thaw()
  // The control. Deliberately not a hardcoded calendar comparison: 1 October
  // 2026 is in the past and will stay there, so this assertion cannot rot the
  // way the two suites this helper was written for did.
  ok('and once thawed that instant is no longer today', !isToday(frozen))
}

console.log('\n── EVERY OTHER WAY OF MAKING A DATE IS LEFT ALONE ──')
{
  // Without this, a frozen clock would rewrite the fixtures. Every suite that
  // freezes also carries dates in its data, and those have to keep meaning what
  // they say.
  const thaw = freezeClock(AT)
  eq('a parsed ISO string is itself', new Date('2018-04-01').toISOString(), '2018-04-01T00:00:00.000Z')
  eq('so is a parsed timestamp', new Date(1700000000000).getTime(), 1700000000000)
  eq('and a date built from parts', new Date(2020, 0, 15).getFullYear(), 2020)
  eq('`Date.UTC` is untouched', Date.UTC(2019, 5, 1), 1559347200000)
  eq('and `Date.parse`', Date.parse('2018-04-01T00:00:00.000Z'), 1522540800000)
  // Subclassing must not break the type. Libraries check this, `isValid` among
  // them, and a frozen date that is not a Date would fail in ways nothing here
  // would attribute to the clock.
  ok('a frozen date is still a Date', new Date() instanceof Date)
  ok('and still reads as one', Object.prototype.toString.call(new Date()) === '[object Date]')
  ok('and date-fns will accept it', isValid(new Date()))
  thaw()
}

console.log('\n── THAWING PUTS IT BACK ──')
{
  const before = Date.now()
  const thaw = freezeClock(AT)
  eq('frozen, now is the frozen instant', Date.now(), new Date(AT).getTime())
  thaw()
  // Not an equality against a literal: the real clock has moved on. What has to
  // hold is that it is the real one again.
  ok('thawed, now is a long way from it', Math.abs(Date.now() - new Date(AT).getTime()) > 60000)
  ok('and is at or after where it was before the freeze', Date.now() >= before)
  ok('a bare date is a real date again', new Date().getTime() === Date.now())
}
{
  // Nested freezes unwind last-in-first-out, because each call captures
  // whatever `Date` was current when it ran. Worth pinning: a suite that
  // freezes inside a block that is already frozen would otherwise restore the
  // wrong clock and leak.
  const outer = freezeClock(AT)
  const inner = freezeClock('2030-01-01T00:00:00.000Z')
  eq('the inner freeze wins', new Date().toISOString(), '2030-01-01T00:00:00.000Z')
  inner()
  eq('and thawing it returns to the outer one', new Date().toISOString(), AT)
  outer()
  ok('then to the real clock', Math.abs(Date.now() - new Date(AT).getTime()) > 60000)
}

console.log('\n── AND IT REFUSES WHAT IS NOT A DATE ──')
// A freeze that silently did the wrong thing is the whole hazard, so a bad
// argument has to throw rather than be coerced. JavaScript will coerce most
// things: `new Date(null)` is the epoch, `new Date(true)` a millisecond after
// it, `new Date([])` the epoch again. Found by this suite — `freezeClock(null)`
// froze the clock to 1 January 1970 and said nothing, which is precisely the
// failure the helper was written to prevent, in the helper itself.
// `JSON.stringify` renders NaN and Infinity as "null", which made two of these
// lines read identically and the first one look like a duplicate.
const label = (v) =>
  typeof v === 'number' && !Number.isFinite(v) ? String(v) : v === undefined ? 'undefined' : JSON.stringify(v)
for (const bad of ['not a date', '', 'yesterday', '2026-13-45', null, undefined, NaN, {}, [], true, false, Infinity]) {
  let threw = false
  let unfreeze = null
  try {
    unfreeze = freezeClock(bad)
  } catch {
    threw = true
  }
  if (unfreeze) unfreeze()
  ok(`${label(bad)} is refused`, threw)
}
{
  // The control beside those: a real date is accepted, so the check is not
  // simply refusing everything.
  const thaw = freezeClock(AT)
  eq('while a real instant is accepted', new Date().toISOString(), AT)
  thaw()
  // A timestamp is a date too, and `new Date(number)` is how half the callers
  // would reach for this.
  const thaw2 = freezeClock(1700000000000)
  eq('and so is a timestamp', Date.now(), 1700000000000)
  thaw2()
  // Including the epoch itself. Zero is a real instant, and the type check has
  // to let it through while still refusing the `null` that coerces to it.
  const thaw3 = freezeClock(0)
  eq('the epoch is a real instant, not a missing one', Date.now(), 0)
  thaw3()
  // And a Date object, which is what a caller holding one would pass.
  const thaw4 = freezeClock(new Date(AT))
  eq('as is a Date itself', new Date().toISOString(), AT)
  thaw4()
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
