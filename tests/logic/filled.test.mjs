// Keeping track of which values on a form the app put there.
import { mark, claim, claimAll, pending, isOrigin, ORIGINS } from '../../src/lib/filled.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

console.log('── MARKING WHAT THE APP FILLED IN ──')
ok('a filled field is marked with its source',
  mark({}, { payment_method: 'UPI' }, 'history').payment_method === 'history')
ok('several at once', Object.keys(mark({}, { a: 1, b: 2, c: 3 }, 'scan')).length === 3)
ok('marks accumulate rather than replace',
  Object.keys(mark(mark({}, { a: 1 }, 'history'), { b: 2 }, 'scan')).length === 2)
ok('a later source wins for the same field',
  mark(mark({}, { a: 1 }, 'history'), { a: 2 }, 'scan').a === 'scan')

console.log('\n── NOTHING TO EXPLAIN IS NOT MARKED ──')
// A note under an empty box explains a value that is not there.
ok('an empty string is not marked', pending(mark({}, { a: '' }, 'scan')) === 0)
ok('null is not marked', pending(mark({}, { a: null }, 'scan')) === 0)
ok('undefined is not marked', pending(mark({}, { a: undefined }, 'scan')) === 0)
ok('zero IS marked — it is a real amount', pending(mark({}, { a: 0 }, 'scan')) === 1)
ok('and so is false', pending(mark({}, { a: false }, 'scan')) === 1)

console.log('\n── AN UNKNOWN SOURCE IS REFUSED ──')
// A typo in a caller must not produce a badge with nothing behind it.
ok('a made-up source marks nothing', pending(mark({}, { a: 1 }, 'magic')) === 0)
ok('and leaves what was there alone',
  mark(mark({}, { a: 1 }, 'scan'), { b: 2 }, 'magic').a === 'scan')
ok('every listed origin is accepted', ORIGINS.every(isOrigin))
ok('and nothing else is', !isOrigin('') && !isOrigin(null) && !isOrigin('guess'))

console.log('\n── EDITING MAKES IT THEIRS ──')
const two = mark({}, { a: 1, b: 2 }, 'history')
ok('a claimed field loses its mark', claim(two, 'a').a === undefined)
ok('and the others keep theirs', claim(two, 'a').b === 'history')
// Called on every keystroke, so it must not churn the object it was given.
ok('claiming a field nobody filled changes nothing', claim(two, 'zzz') === two)
ok('claiming from nothing does not throw', pending(claim(null, 'a')) === 0)
ok('claiming everything empties it', pending(claimAll()) === 0)

console.log('\n── HOW MANY ARE STILL THE APP’S ──')
ok('none to begin with', pending({}) === 0)
ok('counted as they are marked', pending(mark({}, { a: 1, b: 2 }, 'scan')) === 2)
ok('and down again as they are claimed', pending(claim(mark({}, { a: 1, b: 2 }, 'scan'), 'a')) === 1)
ok('nothing is not a crash', pending(null) === 0 && pending(undefined) === 0)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
