// Remembering what someone searched for, and forgetting it on time.
import {
  readSearches, recentSearches, recordSearch, clearSearches,
  RETENTION_DAYS, MAX_REMEMBERED,
} from '../../src/lib/searchHistory.js'

// A localStorage that behaves like the real one, including throwing when full.
let store = {}
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v) },
  removeItem: (k) => { delete store[k] },
}
const reset = () => { store = {} }

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const T0 = Date.parse('2026-08-30T12:00:00Z')
const days = (n) => n * 24 * 60 * 60 * 1000

console.log('── IT REMEMBERS ──')
reset()
recordSearch('sea view villa', T0)
ok('a search comes back', recentSearches(T0)[0] === 'sea view villa')
recordSearch('plumber', T0 + 1000)
ok('the newest is first', recentSearches(T0 + 1000)[0] === 'plumber')
ok('and the older one is still there', recentSearches(T0 + 1000)[1] === 'sea view villa')

console.log('\n── THE SAME SEARCH IS ONE ENTRY ──')
reset()
recordSearch('villa', T0)
recordSearch('plumber', T0 + 1000)
recordSearch('villa', T0 + 2000)
ok('repeating one moves it to the top', recentSearches(T0 + 2000)[0] === 'villa')
ok('rather than listing it twice', recentSearches(T0 + 2000).length === 2)
// "Villa" and "villa" are one search to the person who typed them.
recordSearch('VILLA', T0 + 3000)
ok('case does not make a second entry', recentSearches(T0 + 3000).length === 2)
ok('and the newest spelling is the one kept', recentSearches(T0 + 3000)[0] === 'VILLA')

console.log('\n── IT FORGETS AFTER A WEEK ──')
ok('the policy is a week', RETENTION_DAYS === 7)
reset()
recordSearch('old thing', T0)
ok('still there after six days', recentSearches(T0 + days(6)).includes('old thing'))
ok('gone after eight', !recentSearches(T0 + days(8)).includes('old thing'))
ok('and gone exactly at seven', !recentSearches(T0 + days(7)).includes('old thing'))
// Expiry has to happen on the way out too, or a list left in storage since
// March would be handed back in full the next time the app opened.
reset()
store['pl_search_history'] = JSON.stringify([{ q: 'ancient', at: T0 - days(30) }])
ok('an old list in storage is not read back', recentSearches(T0).length === 0)

console.log('\n── EXPIRY DOES NOT TAKE THE LIVE ONES WITH IT ──')
reset()
recordSearch('stale', T0)
recordSearch('fresh', T0 + days(6))
// Read far enough out that the first has aged past the week and the second has
// not: 7.5 days and 1.5 days respectively.
const after = recentSearches(T0 + days(7.5))
ok('the recent one survives', after.includes('fresh'))
ok('the expired one does not', !after.includes('stale'))

console.log('\n── A KEYSTROKE IS NOT A SEARCH ──')
reset()
recordSearch('s', T0)
ok('one letter is not remembered', recentSearches(T0).length === 0)
recordSearch('', T0)
ok('nor is nothing', recentSearches(T0).length === 0)
recordSearch('   ', T0)
ok('nor is whitespace', recentSearches(T0).length === 0)
recordSearch('  villa  ', T0)
ok('and what is kept is trimmed', recentSearches(T0)[0] === 'villa')
ok('two letters is enough', recordSearch('go', T0).includes('go'))

console.log('\n── THE LIST STAYS SHORT ──')
reset()
for (let i = 0; i < 20; i++) recordSearch(`search ${i}`, T0 + i * 1000)
ok(`no more than ${MAX_REMEMBERED} are kept`, recentSearches(T0 + 20000).length === MAX_REMEMBERED)
ok('and it is the newest that are kept', recentSearches(T0 + 20000)[0] === 'search 19')

console.log('\n── CLEARING MEANS CLEARING ──')
reset()
recordSearch('private', T0)
clearSearches()
ok('the list is empty', recentSearches(T0).length === 0)
ok('and nothing is left in storage', store['pl_search_history'] === undefined)

console.log('\n── RUBBISH IN STORAGE IS NOT TRUSTED ──')
// Read back from storage another version of the app, or a person with
// devtools, may have written.
reset()
store['pl_search_history'] = 'not json at all'
ok('unparseable storage gives nothing', recentSearches(T0).length === 0)
store['pl_search_history'] = JSON.stringify({ q: 'not an array' })
ok('the wrong shape gives nothing', recentSearches(T0).length === 0)
store['pl_search_history'] = JSON.stringify([{ q: 'fine', at: T0 }, null, { q: 5, at: T0 }, { q: 'no time' }])
ok('bad rows are dropped and good ones kept', recentSearches(T0).join() === 'fine')
// A clock that went backwards, or a row written with a future timestamp, must
// not pin itself to the top of the list forever.
store['pl_search_history'] = JSON.stringify([{ q: 'from the future', at: T0 + days(3) }])
ok('a future timestamp is not trusted', recentSearches(T0).length === 0)

console.log('\n── A BROWSER THAT REFUSES TO STORE ──')
reset()
const realSet = globalThis.localStorage.setItem
globalThis.localStorage.setItem = () => { throw new Error('QuotaExceededError') }
let threw = false
try { recordSearch('villa', T0) } catch { threw = true }
ok('recording does not throw at the caller', !threw)
globalThis.localStorage.setItem = realSet

console.log('\n── READSEARCHES CARRIES THE TIMES ──')
reset()
recordSearch('villa', T0)
const rows = readSearches(T0)
ok('rows have the query and when it happened', rows[0].q === 'villa' && rows[0].at === T0)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
