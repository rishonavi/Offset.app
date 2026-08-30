// Matching a query the way people type it.
import { fold, terms, matchesAll, score } from '../../src/lib/searchMatch.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

console.log('── WORDS IN ANY ORDER ──')
const villa = ['Sea View Villa', 'Real Estate — Apartment / Flat', 'Marine Drive']
ok('the words as written match', matchesAll(villa, terms('sea view')))
ok('and so do the words reversed', matchesAll(villa, terms('villa sea')))
ok('and words from different fields', matchesAll(villa, terms('villa marine')))
ok('a word that is nowhere fails', !matchesAll(villa, terms('villa warehouse')))
ok('an empty query matches everything', matchesAll(villa, terms('')))
ok('and so does whitespace', matchesAll(villa, terms('   ')))

console.log('\n── CASE AND ACCENTS ARE NOT THE POINT ──')
ok('case is ignored', matchesAll(['Sea View Villa'], terms('SEA villa')))
ok('an accent typed is found unaccented', matchesAll(['Cafe Rio'], terms('café')))
ok('and an accent stored is found plainly', matchesAll(['Café Rio'], terms('cafe')))
ok('Hindi folds without breaking', fold('मुंबई') === 'मुंबई'.normalize('NFD').replace(/\p{Diacritic}/gu, ''))
ok('nothing is not a crash', fold(null) === '' && fold(undefined) === '')

console.log('\n── EMPTY AND MISSING FIELDS ──')
ok('a record with holes still matches on what it has',
  matchesAll(['Plumber', null, undefined, ''], terms('plumber')))
ok('a record with nothing matches nothing', !matchesAll([null, ''], terms('plumber')))

console.log('\n── BETTER HITS SCORE HIGHER ──')
const exact = score(['Rent'], terms('rent'))
const prefix = score(['Rental income'], terms('rent'))
const word = score(['Monthly rent received'], terms('rent'))
const buried = score(['Parent company'], terms('rent'))
ok('a whole field beats a prefix', exact > prefix, `${exact} vs ${prefix}`)
ok('a prefix beats a word inside', prefix > word, `${prefix} vs ${word}`)
ok('a word beats a fragment', word > buried, `${word} vs ${buried}`)
ok('no match scores nothing', score(['Nothing here'], terms('zzz')) === 0)
ok('an empty query scores nothing', score(['Rent'], terms('')) === 0)
ok('more matching words score higher',
  score(['Sea View Villa'], terms('sea villa')) > score(['Sea View Villa'], terms('sea')))

console.log('\n── A QUERY WITH REGEX IN IT IS JUST TEXT ──')
// Someone searching for "(" must get results, not an exception.
let threw = false
try { score(['a (b) c'], terms('(b)')) } catch { threw = true }
ok('brackets do not blow up the scorer', !threw)
ok('and they still match', matchesAll(['a (b) c'], terms('(b)')))
threw = false
try { matchesAll(['costs *'], terms('*')) } catch { threw = true }
ok('nor does a lone asterisk', !threw)

console.log('\n── TERMS ──')
ok('splits on whitespace', terms('a  b\tc').length === 3)
ok('drops nothing-words', terms('   ').length === 0)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
