// What a cost is booked to, and what a company is allowed to leave blank.
//
// Personal books have one answer and must insist on it. A builder's books have
// three — an asset, a job, or an overhead that is honestly neither — and the
// old form, which insisted, was answered by inventing an asset called "Depot"
// and carrying it in every total forever. These tests pin the fallback order
// and, more importantly, pin what is *not* called missing.
import { placeOf, placeName, placeHeading, assetOptional } from '../../src/lib/place.js'
import { totalsByPlace } from '../../src/lib/stats.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${e ? '  — ' + e : ''}`) }
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

const assets = new Map([['p1', 'Andheri Shop'], ['p2', 'Bandra Flat']])
const sites = new Map([['s1', 'Marine Drive Tower'], ['s2', 'Powai Phase 2']])
const names = { assetName: (id) => assets.get(id), siteName: (id) => sites.get(id) }

console.log('\n── WHICH OF THE THREE ANSWERS ──')
eq('an asset names the asset', placeOf({ property_id: 'p1' }, names), { kind: 'asset', id: 'p1', name: 'Andheri Shop' })
eq('a site names the site', placeOf({ project_id: 's1' }, names), { kind: 'site', id: 's1', name: 'Marine Drive Tower' })
eq('neither is an answer of its own', placeOf({}, names), { kind: 'none', id: null, name: '' })
eq('and so is a row that is not there', placeOf(null, names), { kind: 'none', id: null, name: '' })

// A repair to the company's own crane, charged to the job it was standing on.
// Both are true; the narrower one is what a person scanning the column wants.
eq('both named, the asset wins', placeOf({ property_id: 'p2', project_id: 's2' }, names).name, 'Bandra Flat')
eq('and it says so', placeOf({ property_id: 'p2', project_id: 's2' }, names).kind, 'asset')

console.log('\n── A LOOKUP THAT WILL NOT RESOLVE ──')
// An asset deleted out from under its costs, or one in books you are not
// looking at. The row still knows which job it was for.
eq('a dead asset id falls through to the site',
  placeOf({ property_id: 'gone', project_id: 's1' }, names), { kind: 'site', id: 's1', name: 'Marine Drive Tower' })
eq('with nothing to fall through to, nothing is claimed',
  placeOf({ property_id: 'gone' }, names), { kind: 'none', id: null, name: '' })
eq('a dead site id is not a name either', placeOf({ project_id: 'gone' }, names).name, '')
// The control: the same shape with a live id does resolve, so the two above
// are testing the lookup and not testing a typo in the fixture.
eq('the same row with a live id resolves', placeOf({ property_id: 'p1' }, names).name, 'Andheri Shop')

console.log('\n── WITH NO LOOKUPS AT ALL ──')
// lib/invoice.js calls this with an optional helper, so an absent one must not
// throw; it must simply have no answer.
eq('no helpers, no answer', placeOf({ property_id: 'p1', project_id: 's1' }), { kind: 'none', id: null, name: '' })
eq('placeName is the name and nothing else', placeName({ project_id: 's2' }, names), 'Powai Phase 2')
eq('placeName of nothing is the empty string', placeName({}, names), '')

console.log('\n── WHAT THE COLUMN IS CALLED ──')
eq('a landlord sees Property', placeHeading(false), 'Property')
eq('a builder sees Booked to', placeHeading(true), 'Booked to')
eq('and an app that does not know yet sees Property', placeHeading(undefined), 'Property')

console.log('\n── WHO MAY LEAVE IT BLANK ──')
ok('a company may', assetOptional({ corporate: true }))
ok('personal books may not', !assetOptional({ corporate: false }))
ok('and neither may an app with no entity context', !assetOptional(null))
ok('nor one where the flag is simply absent', !assetOptional({}))

console.log('\n── WHAT WAS SPENT ON WHAT ──')
const spend = [
  { property_id: 'p1', amount: 1000 },
  { property_id: 'p1', amount: 500 },
  { project_id: 's1', amount: 9000 },
  { project_id: 's2', amount: 2000 },
  { amount: 300 },                       // office rent
  { amount: 700 },                       // the auditor
  { property_id: 'gone', amount: 50 },   // an asset since deleted
]
const at = (r) => placeOf(r, names)
const totals = totalsByPlace(spend, at)
eq('one bucket per thing, ordered by size',
  totals.map((t) => [t.name, t.value]),
  [['Marine Drive Tower', 9000], ['Powai Phase 2', 2000], ['Andheri Shop', 1500], ['Not booked', 1000], ['Unknown', 50]])
ok('nothing is lost on the way in', totals.reduce((t, d) => t + d.value, 0) === 13550)
// The distinction the old chart could not make: an overhead is not a failed
// lookup, and a failed lookup is not an overhead.
eq('overheads are named, not shrugged at', totals.find((t) => t.value === 1000).name, 'Not booked')
eq('a deleted asset is still booked to something', totals.find((t) => t.value === 50).name, 'Unknown')
ok('and the two are different buckets', totals.filter((t) => t.name === 'Not booked' || t.name === 'Unknown').length === 2)

// Keyed on the id, not the label: two assets can share a name and are still
// two assets. Before this they were one slice, and the chart was a lie.
const twins = new Map([['a', 'Shop'], ['b', 'Shop']])
const byTwin = totalsByPlace(
  [{ property_id: 'a', amount: 100 }, { property_id: 'b', amount: 400 }],
  (r) => placeOf(r, { assetName: (id) => twins.get(id) }),
)
eq('two assets of the same name stay two', byTwin.map((t) => [t.id, t.value]), [['b', 400], ['a', 100]])

// The same trap from the other side. A row naming a dead asset *and* a live job
// falls through to the job for its label — so if it were named that way here it
// would draw the job twice under one name, which is exactly what keying on the
// id is for.
const mixed = totalsByPlace(
  [{ project_id: 's1', amount: 400 }, { property_id: 'gone', project_id: 's1', amount: 100 }],
  at,
)
eq('a dead asset does not borrow the name of the job beside it',
  mixed.map((t) => [t.name, t.value]), [['Marine Drive Tower', 400], ['Unknown', 100]])

eq('a bucket that nets to nothing is not drawn',
  totalsByPlace([{ property_id: 'p1', amount: 0 }, { project_id: 's1', amount: 5 }], at)
    .map((t) => t.name),
  ['Marine Drive Tower'])
eq('no rows, no chart', totalsByPlace([], at), [])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
