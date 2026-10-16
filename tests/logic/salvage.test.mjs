// Reading rows out of a browser that has something wrong with them.
//
// Both local backends answered a key they could not read with an empty array
// and said nothing. The ledger then read as empty — no assets, no costs — which
// is the same silent failure the cloud path had, and worse than an error
// because somebody acts on it. And the next write replaced the value with
// `[theOneNewRow]`, destroying whatever was still in there: a half-written
// array is mostly intact text and can be picked over by hand, an overwritten
// one is gone.
//
// The personal backend also handed back whatever it parsed without checking it
// was a list, so a stored object came through as an object and `[...rows].sort()`
// threw on something that is not iterable.
import {
  readRows, unreadable, whyUnreadable, forgetUnreadable, SALVAGE_SUFFIX,
} from '../../src/lib/storage/salvage.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

function store(initial = {}, { broken = false } = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (k) => { if (broken) throw new Error('refused'); return map.has(k) ? map.get(k) : null },
    setItem: (k, v) => { if (broken) throw new Error('refused'); map.set(k, String(v)) },
    removeItem: (k) => map.delete(k),
  }
}

console.log('── WHAT READS NORMALLY ──')
forgetUnreadable()
{
  const s = store({ pl_expenses: JSON.stringify([{ id: 'e1' }, { id: 'e2' }]) })
  const rows = readRows('pl_expenses', s)
  eq('a stored list comes back whole', rows.length, 2)
  eq('with its contents', rows[0].id, 'e1')
  eq('and nothing is marked', unreadable().length, 0)
  eq('nor copied aside', s.map.has('pl_expenses' + SALVAGE_SUFFIX), false)
}
{
  // The ordinary state of a fresh browser. Marking this would put a warning in
  // front of every new install.
  const s = store({})
  eq('an absent key is empty, not damaged', readRows('pl_income', s).length, 0)
  eq('and is not reported', unreadable().length, 0)
  eq('an empty string is the same', readRows('pl_x', store({ pl_x: '' })).length, 0)
  eq('and also not reported', unreadable().length, 0)
}

console.log('\n── WHAT WILL NOT PARSE ──')
forgetUnreadable()
{
  // What a truncated write looks like: valid JSON up to the cut.
  const truncated = '[{"id":"e1","amount":1200},{"id":"e2","amo'
  const s = store({ pl_expenses: truncated })
  const rows = readRows('pl_expenses', s)
  eq('the app still gets a list to render', rows.length, 0)
  eq('the key is reported', unreadable().join(), 'pl_expenses')
  eq('with a reason worth reading', whyUnreadable('pl_expenses'), 'could not be read')
  // The whole point. Without this the next save overwrites the only copy.
  eq('and the raw text is copied aside', s.map.get('pl_expenses' + SALVAGE_SUFFIX), truncated)
}
{
  // Read twice, which happens on every refresh. The copy must be the one taken
  // first, before any of this session's writes.
  const s = store({ pl_expenses: 'not json at all' })
  readRows('pl_expenses', s)
  s.map.set('pl_expenses', 'something else broken')
  readRows('pl_expenses', s)
  eq('the copy is never overwritten by a later read', s.map.get('pl_expenses' + SALVAGE_SUFFIX), 'not json at all')
}

console.log('\n── AND WHAT PARSES INTO THE WRONG SHAPE ──')
forgetUnreadable()
{
  // `JSON.parse(...) || []` returned this as-is and the consumer did
  // `[...rows].sort()`, which throws on a value that is not iterable.
  const s = store({ pl_properties: JSON.stringify({ id: 'p1', name: 'Flat' }) })
  const rows = readRows('pl_properties', s)
  ok('an object is not handed on as rows', Array.isArray(rows), JSON.stringify(rows))
  eq('it is empty', rows.length, 0)
  eq('and reported for what it is', whyUnreadable('pl_properties'), 'was not a list of entries')
  ok('and kept', s.map.has('pl_properties' + SALVAGE_SUFFIX))
  // The control: it really would have thrown.
  let threw = false
  try { [...JSON.parse(s.map.get('pl_properties'))].sort() } catch { threw = true }
  ok('which is what used to reach the sort', threw)
}
{
  forgetUnreadable()
  const s = store({ pl_x: 'null' })
  eq('a stored null is empty', readRows('pl_x', s).length, 0)
  eq('and counts as the wrong shape', whyUnreadable('pl_x'), 'was not a list of entries')
}

console.log('\n── A KEY THAT COMES GOOD CLEARS ITSELF ──')
forgetUnreadable()
{
  const s = store({ pl_expenses: '[broken' })
  readRows('pl_expenses', s)
  eq('marked while it is broken', unreadable().length, 1)
  s.map.set('pl_expenses', JSON.stringify([{ id: 'e9' }]))
  const rows = readRows('pl_expenses', s)
  eq('and read once it is not', rows.length, 1)
  eq('with the warning gone', unreadable().length, 0)
  ok('though the copy is still there to go back to', s.map.has('pl_expenses' + SALVAGE_SUFFIX))
}

console.log('\n── AND A BROWSER THAT REFUSES STORAGE ALTOGETHER ──')
forgetUnreadable()
{
  // A private window with site data blocked. Nothing is stored, so nothing is
  // damaged, and a warning here would be a lie.
  eq('it reads as empty', readRows('pl_expenses', store({}, { broken: true })).length, 0)
  eq('and reports nothing', unreadable().length, 0)
  eq('no storage at all is also survivable', readRows('pl_expenses', null).length, 0)
}
{
  // And a store that can be read but not written: the warning is still worth
  // having even when the copy cannot be kept.
  forgetUnreadable()
  const s = store({ pl_expenses: '[broken' })
  const readOnly = { getItem: s.getItem, setItem: () => { throw new Error('full') }, removeItem: s.removeItem }
  eq('it still reads as empty', readRows('pl_expenses', readOnly).length, 0)
  eq('and is still reported', unreadable().join(), 'pl_expenses')
  eq('even though no copy could be kept', s.map.has('pl_expenses' + SALVAGE_SUFFIX), false)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
