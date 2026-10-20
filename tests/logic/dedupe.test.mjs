// Not importing the same row twice.
import { entryKey, seenIndex, skippedNote, dropKnown } from '../../src/lib/dedupe.js'

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

console.log('\n── WHAT TO ADD, AND WHAT WAS ALREADY THERE ──')
// The bank importer had none of this: reconcile() only matches *unpaid* bills,
// so a transaction imported last week is already paid, matches nothing, and
// comes back as new. The endpoint asks the provider for the whole history every
// time, so a second Sync re-added up to five hundred rows in silence.
{
  const r = dropKnown([row()], [row()])
  ok('a row already in the books is not added', r.rows.length === 0)
  ok('and it is counted', r.skipped === 1)
}
{
  const r = dropKnown([row({ date: '2026-04-01' })], [row()])
  ok('a row that is not there is added', r.rows.length === 1)
  ok('and nothing is counted', r.skipped === 0)
}
{
  // The control that matters: a guard that simply added nothing would pass the
  // first case above and break the importer.
  const r = dropKnown([row(), row({ amount: 5 }), row({ date: '2026-05-05' })], [])
  ok('an empty ledger takes everything', r.rows.length === 3, JSON.stringify(r))
  ok('and reports no duplicates', r.skipped === 0)
}
{
  // Within one import, not just against the ledger.
  const r = dropKnown([row(), row(), row()], [])
  ok('a batch that repeats itself imports once', r.rows.length === 1, JSON.stringify(r))
  ok('and counts the repeats', r.skipped === 2)
}
{
  const r = dropKnown([row({ source: 'Rent' })], [row({ source: 'Rent' })], 'income')
  ok('income is keyed on its source', r.skipped === 1)
}
{
  // The kinds must not collide: an expense in Utilities and income from Rent on
  // the same day for the same amount are different rows, and `entryKey` reads a
  // different field for each.
  const r = dropKnown([row({ source: 'Rent' })], [row()], 'income')
  ok('an expense does not mask an income', r.rows.length === 1, JSON.stringify(r))
}
{
  const r = dropKnown()
  ok('no arguments does not throw', r.rows.length === 0 && r.skipped === 0)
}
{
  // Order is the caller's to keep — it decides which `add*` runs when.
  const r = dropKnown([row({ amount: 1 }), row({ amount: 2 }), row({ amount: 3 })], [])
  ok('the rows come back in the order given', r.rows.map((x) => x.amount).join(',') === '1,2,3')
  ok('and are the objects passed in, not copies', r.rows[0].category === 'Utilities')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
