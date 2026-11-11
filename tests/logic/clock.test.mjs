// The helper that holds the clock still.
//
// `_clock.mjs` is relied on by four suites and had no test, which is the worst
// shape available: a freeze that silently did not take would make those suites
// pass against the real calendar and go red months later, on a date nobody
// chose. That drift is what `_clock.mjs` was written to end.
//
// Writing this found `freezeClock(null)` freezing the clock to 1 January 1970 —
// `new Date(null)` is the epoch, not an error.
import { freezeClock } from './_clock.mjs'
import { isToday, isFuture, isValid, subDays } from 'date-fns'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

const AT = '2026-10-01T06:30:00.000Z'

console.log('── THE CLOCK STOPS ──')
{
  const thaw = freezeClock(AT)
  eq('a bare `new Date()` reads the frozen instant', new Date().toISOString(), AT)
  // What date-fns calls. A stub that only subclassed the constructor would pass
  // the line above and leave every date-fns comparison on the real calendar.
  eq('`Date.now()` reads it too', new Date(Date.now()).toISOString(), AT)
  eq('and the two agree', new Date().getTime(), Date.now())
  thaw()
}

console.log('\n── AND date-fns STOPS WITH IT ──')
{
  // These read the clock inside date-fns, so they are what prove the override
  // reaches the library the app uses.
  const thaw = freezeClock(AT)
  const frozen = new Date(AT)
  ok('date-fns agrees the frozen instant is today', isToday(frozen))
  ok('and that a later date is still ahead', isFuture(new Date('2026-10-15T00:00:00Z')))
  // 180 days is `day(180)` in sampleSite.js, which is what drifted.
  eq('arithmetic from now lands on a fixed day', subDays(new Date(), 180).toISOString().slice(0, 10), '2026-04-04')
  thaw()
  // The control, deliberately not a calendar comparison: 1 October 2026 is past
  // and will stay there, so this cannot rot the way the two suites did.
  ok('and once thawed that instant is no longer today', !isToday(frozen))
}

console.log('\n── EVERY OTHER WAY OF MAKING A DATE IS LEFT ALONE ──')
{
  // Without this a frozen clock would rewrite the fixtures, and every suite that
  // freezes also carries dates in its data.
  const thaw = freezeClock(AT)
  eq('a parsed ISO string is itself', new Date('2018-04-01').toISOString(), '2018-04-01T00:00:00.000Z')
  eq('so is a parsed timestamp', new Date(1700000000000).getTime(), 1700000000000)
  eq('and a date built from parts', new Date(2020, 0, 15).getFullYear(), 2020)
  eq('`Date.UTC` is untouched', Date.UTC(2019, 5, 1), 1559347200000)
  // Subclassing must not break the type; `isValid` and others check it.
  ok('a frozen date is still a Date', new Date() instanceof Date && isValid(new Date()))
  thaw()
}

console.log('\n── THAWING PUTS IT BACK ──')
{
  const thaw = freezeClock(AT)
  eq('frozen, now is the frozen instant', Date.now(), new Date(AT).getTime())
  thaw()
  // Not an equality against a literal — the real clock has moved on. What has to
  // hold is that it is the real one again.
  ok('thawed, now is a long way from it', Math.abs(Date.now() - new Date(AT).getTime()) > 60000)
}

console.log('\n── AND IT REFUSES WHAT IS NOT A DATE ──')
// A freeze that silently did the wrong thing is the whole hazard, and JavaScript
// coerces rather than refuses: `new Date(null)` is the epoch, `new Date(true)` a
// millisecond after it. `freezeClock(null)` froze to 1970 and said nothing.
for (const [label, bad] of [['a word', 'yesterday'], ['an impossible date', '2026-13-45'], ['null', null], ['undefined', undefined], ['NaN', NaN], ['an object', {}], ['true', true]]) {
  let threw = false
  let unfreeze = null
  try {
    unfreeze = freezeClock(bad)
  } catch {
    threw = true
  }
  if (unfreeze) unfreeze()
  ok(`${label} is refused`, threw)
}
{
  // The controls: the check is a type check, not a blanket refusal. Zero is a
  // real instant and has to pass while the `null` that coerces to it does not.
  for (const [label, good, expected] of [['an ISO string', AT, new Date(AT).getTime()], ['a timestamp', 1700000000000, 1700000000000], ['the epoch itself', 0, 0], ['a Date', new Date(AT), new Date(AT).getTime()]]) {
    const thaw = freezeClock(good)
    eq(`${label} is accepted`, Date.now(), expected)
    thaw()
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
