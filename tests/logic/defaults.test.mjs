// Choosing for someone from their own history — and, more importantly, knowing
// when not to.
import { usual, lastUsed, hasDetail } from '../../src/lib/defaults.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const rows = (...vals) => vals.map((v, i) => ({
  payment_method: v,
  date: `2026-01-${String(i + 1).padStart(2, '0')}`,
}))

console.log('── A HABIT IS WORTH OFFERING ──')
ok('a value used every time is the default',
  usual(rows('UPI', 'UPI', 'UPI', 'UPI'), 'payment_method') === 'UPI')
ok('a clear majority still counts',
  usual(rows('UPI', 'UPI', 'UPI', 'UPI', 'Cash'), 'payment_method') === 'UPI')

console.log('\n── A COIN TOSS IS NOT ──')
// The whole reason this returns nothing rather than the largest slice: a wrong
// default is answered quietly and ends up in the books.
ok('a even split offers nothing',
  usual(rows('UPI', 'UPI', 'Cash', 'Cash'), 'payment_method') === '')
ok('a plurality that is not a majority offers nothing',
  usual(rows('UPI', 'UPI', 'UPI', 'Cash', 'Cash', 'Card', 'Card'), 'payment_method') === '')
ok('three ways of doing things offers nothing',
  usual(rows('UPI', 'Cash', 'Card', 'UPI', 'Cash', 'Card'), 'payment_method') === '')

console.log('\n── TOO LITTLE TO GO ON IS NOT EITHER ──')
ok('one entry is not a habit', usual(rows('UPI'), 'payment_method') === '')
ok('nor are two', usual(rows('UPI', 'UPI'), 'payment_method') === '')
ok('three of the same is', usual(rows('UPI', 'UPI', 'UPI'), 'payment_method') === 'UPI')
ok('no history at all offers nothing', usual([], 'payment_method') === '')
ok('and neither does nonsense', usual(null, 'payment_method') === '' && usual(undefined, 'x') === '')

console.log('\n── BLANKS ARE NOT A CHOICE ──')
// Someone who left the field empty forty times has not chosen "empty" — they
// have simply not answered, and the entries that did answer are the evidence.
ok('empty values are not counted as a value',
  usual(rows('UPI', 'UPI', 'UPI', '', '', '', '', ''), 'payment_method') === 'UPI')
ok('nulls and undefined are skipped',
  usual([...rows('UPI', 'UPI', 'UPI'), { payment_method: null }, { payment_method: undefined }], 'payment_method') === 'UPI')
ok('a field nothing ever set offers nothing', usual(rows('UPI', 'UPI', 'UPI'), 'vendor') === '')

console.log('\n── ONLY WHAT IS STILL ON OFFER ──')
// An asset that has been deleted, or a payment method dropped from the list,
// must not come back as a default nobody can act on.
ok('a value no longer offered is skipped',
  usual(rows('Cheque', 'Cheque', 'Cheque', 'UPI', 'UPI', 'UPI'), 'payment_method', { among: ['UPI', 'Cash'] }) === 'UPI')
ok('and if nothing survives the filter, nothing is offered',
  usual(rows('Cheque', 'Cheque', 'Cheque'), 'payment_method', { among: ['UPI'] }) === '')

console.log('\n── RECENCY BEATS THE WHOLE LEDGER ──')
// Someone who changed bank last year did not change it halfway through every
// entry; a ledger of five hundred would keep voting for the old one forever.
const old = Array.from({ length: 300 }, (_, i) => ({ payment_method: 'Cheque', date: `2019-01-${String((i % 28) + 1).padStart(2, '0')}` }))
const now = Array.from({ length: 30 }, (_, i) => ({ payment_method: 'UPI', date: `2026-02-${String((i % 28) + 1).padStart(2, '0')}` }))
ok('a habit someone has stopped is not offered back', usual([...old, ...now], 'payment_method') === 'UPI')

console.log('\n── THE ONE THEY TOUCHED LAST ──')
// For which asset an entry belongs to, recency beats counting: working through
// a stack of bills for one flat, you want that flat again.
const assets = [
  { property_id: 'a', date: '2026-01-01' },
  { property_id: 'a', date: '2026-01-02' },
  { property_id: 'a', date: '2026-01-03' },
  { property_id: 'b', date: '2026-01-09' },
]
ok('the most recent wins over the most frequent', lastUsed(assets, 'property_id') === 'b')
ok('a deleted asset is skipped for one that still exists',
  lastUsed(assets, 'property_id', { among: ['a'] }) === 'a')
ok('nothing to go on gives nothing', lastUsed([], 'property_id') === '')
ok('and nonsense does not throw', lastUsed(null, 'property_id') === '')
ok('rows with the field empty are passed over',
  lastUsed([{ property_id: '', date: '2026-03-01' }, { property_id: 'a', date: '2026-01-01' }], 'property_id') === 'a')
ok('created_at stands in when there is no date',
  lastUsed([{ property_id: 'a', created_at: '2026-01-01' }, { property_id: 'b', created_at: '2026-05-01' }], 'property_id') === 'b')

console.log('\n── IS THERE ANYTHING BEHIND THE FOLD ──')
const FIELDS = ['tax', 'payment_method', 'status', 'recurrence', 'description']
const BLANK = { status: 'paid', recurrence: 'none' }
ok('a form at its defaults has nothing to show',
  hasDetail({ tax: '', payment_method: '', status: 'paid', recurrence: 'none', description: '' }, FIELDS, BLANK) === false)
ok('a payment method counts',
  hasDetail({ status: 'paid', recurrence: 'none', payment_method: 'UPI' }, FIELDS, BLANK) === true)
ok('so does an unpaid status',
  hasDetail({ status: 'unpaid', recurrence: 'none' }, FIELDS, BLANK) === true)
ok('so does a recurrence',
  hasDetail({ status: 'paid', recurrence: 'monthly' }, FIELDS, BLANK) === true)
ok('so does a note',
  hasDetail({ status: 'paid', recurrence: 'none', description: 'hi' }, FIELDS, BLANK) === true)
// The default itself must not read as detail, or the fold would never close.
ok('the default status is not detail',
  hasDetail({ status: 'paid' }, ['status'], BLANK) === false)
ok('a field outside the list is ignored',
  hasDetail({ vendor: 'Acme' }, FIELDS, BLANK) === false)
ok('no form at all is not detail', hasDetail(null, FIELDS, BLANK) === false)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
