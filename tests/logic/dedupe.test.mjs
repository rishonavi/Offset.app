// Not importing the same row twice.
import { entryKey, seenIndex, skippedNote } from '../../src/lib/dedupe.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const row = (o = {}) => ({ property_id: 'a1', date: '2026-03-01', amount: 1200, category: 'Utilities', ...o })

console.log('── THE SAME ENTRY IS THE SAME ENTRY ──')
ok('an identical row matches', entryKey(row()) === entryKey(row()))
ok('a different asset does not', entryKey(row()) !== entryKey(row({ property_id: 'a2' })))
ok('a different day does not', entryKey(row()) !== entryKey(row({ date: '2026-03-02' })))
ok('a different amount does not', entryKey(row()) !== entryKey(row({ amount: 1201 })))
ok('a different category does not', entryKey(row()) !== entryKey(row({ category: 'Insurance' })))

console.log('\n── SPELLING IS NOT A DIFFERENCE ──')
// A spreadsheet writes "1200", the store holds 1200; a person types "utilities".
ok('a numeric string matches a number', entryKey(row({ amount: '1200' })) === entryKey(row()))
ok('case does not matter', entryKey(row({ category: 'UTILITIES' })) === entryKey(row()))
ok('nor does surrounding space', entryKey(row({ category: ' Utilities ' })) === entryKey(row()))
// The wording almost never survives a round trip through two systems.
ok('the description is not part of it', entryKey(row({ description: 'x' })) === entryKey(row({ description: 'y' })))
ok('nor is the vendor', entryKey(row({ vendor: 'Ravi' })) === entryKey(row({ vendor: 'Sunil' })))

console.log('\n── INCOME IS KEYED ON ITS OWN FIELD ──')
const inc = (o = {}) => ({ property_id: 'a1', date: '2026-03-01', amount: 50000, source: 'Rent', ...o })
ok('two rents match', entryKey(inc(), 'income') === entryKey(inc(), 'income'))
ok('rent and a deposit do not', entryKey(inc(), 'income') !== entryKey(inc({ source: 'Deposit' }), 'income'))
// Reading income with the expense key would compare its source against a
// category that is not there, making every income row look identical.
ok('income is not keyed as an expense', entryKey(inc(), 'income') !== entryKey(inc(), 'expense'))

console.log('\n── MISSING FIELDS DO NOT COLLAPSE EVERYTHING ──')
ok('an empty row still produces a key', typeof entryKey({}) === 'string')
ok('nothing at all does too', typeof entryKey(null) === 'string')
ok('but an empty row is not the same as a real one', entryKey({}) !== entryKey(row()))

console.log('\n── THE INDEX ──')
const seen = seenIndex([row(), row({ amount: 999 })])
ok('it holds what was passed', seen.size === 2)
ok('and recognises a repeat', seen.has(entryKey(row())))
ok('but not a new entry', !seen.has(entryKey(row({ date: '2026-04-01' }))))
ok('an empty ledger recognises nothing', seenIndex([]).size === 0)
ok('and no argument does not throw', seenIndex().size === 0)
// A file that repeats a row inside itself should import it once.
const running = seenIndex([])
running.add(entryKey(row()))
ok('adding as you go catches a repeat within one file', running.has(entryKey(row())))

console.log('\n── SAYING SO ──')
ok('nothing skipped says nothing', skippedNote(0) === '')
ok('one is singular', skippedNote(1).includes('1 duplicate already'))
ok('more are plural', skippedNote(4).includes('4 duplicates already'))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
