// A bill that repeats, and what is owed.
//
// Neither module had a single test. Both decide money: `recurring.js` creates
// ledger rows on a schedule, and `payments.js` decides what the dashboard calls
// outstanding and overdue.
//
// Three faults in the repeating, all of them silent:
//
//   1. **A series lost its day of the month, permanently.** `addMonths` clamps,
//      so 31 January plus a month is 28 February — and since each occurrence is
//      computed from the one before it, the series stayed on the 28th from then
//      on. The 30th went the same way after one February. A yearly bill on 29
//      February lost its day in the first non-leap year and never got it back.
//   2. **Series collapsed across sites and across companies.** The key was
//      asset + label + cadence, with no `project_id` and no `entity_id`. In a
//      construction company `assetOptional` leaves `property_id` null on every
//      row, so three sites each with a monthly plant hire under one category
//      were ONE series — and a series yields one due occurrence. Two of the
//      three stopped recurring with nothing saying so.
//   3. **`null` and `undefined` were different places.** The key was built by
//      interpolation, so "not booked anywhere" had two spellings and one stream
//      became two, each generating its own due occurrence for the same bill.
//
// And the copy carried last month's history forward: `created_by`, which
// `gate()` only fills in when it is absent and whose own comment calls that
// person "the one person who may not sign it", plus the approver's name and the
// date they signed, onto a row that is pending again.
import {
  RECURRENCE_OPTIONS,
  RECURRENCE_LABEL,
  dueRecurring,
  nextOccurrencePayload,
} from '../../src/lib/recurring.js'
import { isSettled, isOverdue, paymentMeta, outstandingTotal } from '../../src/lib/payments.js'
import { freezeClock } from './_clock.mjs'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

// Noon, so a date-only comparison is never a timezone question.
const at = (iso) => new Date(`${iso}T12:00:00`)
const exp = (o = {}) => ({ property_id: 'p1', category: 'Rent', recurrence: 'monthly', ...o })
const due = (rows, today, kind = 'expense') =>
  dueRecurring(rows, kind, at(today)).map((d) => d.dueDate)

console.log('── THE CADENCES ON OFFER ──')
ok('every option has a value and a label', RECURRENCE_OPTIONS.every((o) => o.value && o.label))
ok('no two share a value', new Set(RECURRENCE_OPTIONS.map((o) => o.value)).size === RECURRENCE_OPTIONS.length)
ok('"does not repeat" is one of them', RECURRENCE_OPTIONS.some((o) => o.value === 'none'))
// The dashboard reads `RECURRENCE_LABEL[d.template.recurrence]` to caption a due
// row, so a cadence the form offers but the label map has no entry for renders
// as nothing at all beside "due 5 Feb".
for (const o of RECURRENCE_OPTIONS.filter((x) => x.value !== 'none')) {
  ok(`${o.value} has a caption for the dashboard`, !!RECURRENCE_LABEL[o.value], JSON.stringify(RECURRENCE_LABEL))
}
ok('and every caption belongs to an offered cadence',
  Object.keys(RECURRENCE_LABEL).every((k) => RECURRENCE_OPTIONS.some((o) => o.value === k)))

console.log('\n── WHAT IS DUE, AND WHAT IS NOT ──')
eq('an entry that does not repeat is never due', due([exp({ recurrence: 'none', date: '2026-01-05' })], '2026-06-01').length, 0)
eq('nor is one with no cadence at all', due([exp({ recurrence: null, date: '2026-01-05' })], '2026-06-01').length, 0)
eq('nor one with no date', due([exp({ date: null })], '2026-06-01').length, 0)
eq('nor one whose date cannot be read', due([exp({ date: 'not a date' })], '2026-06-01').length, 0)
eq('nor one whose cadence nobody recognises', due([exp({ recurrence: 'fortnightly', date: '2026-01-05' })], '2026-06-01').length, 0)
eq('an empty ledger yields nothing', due([], '2026-06-01').length, 0)
// The control for all of those: a real monthly bill does come round.
eq('last month’s rent is due once its day arrives', due([exp({ date: '2026-05-05' })], '2026-06-10')[0], '2026-06-05')
eq('on the day itself it counts as due', due([exp({ date: '2026-05-05' })], '2026-06-05')[0], '2026-06-05')
eq('but the day before it is not yet', due([exp({ date: '2026-05-05' })], '2026-06-04').length, 0)
eq('nor is one whose next occurrence is tomorrow', due([exp({ date: '2026-05-06' })], '2026-06-05').length, 0)
eq('and a series already logged this month is not due again', due([
  exp({ date: '2026-05-05' }), exp({ date: '2026-06-05' }),
], '2026-06-10').length, 0)

console.log('\n── A SERIES KEEPS THE DAY IT STARTED ON ──')
// Walk the series forward the way the dashboard does: log the due occurrence,
// then ask again. This is what made the clamp permanent.
const walk = (start, recurrence, horizon, steps) => {
  let rows = [exp({ id: 's0', recurrence, date: start })]
  const seen = []
  for (let i = 1; i <= steps; i++) {
    const [hit] = dueRecurring(rows, 'expense', at(horizon))
    if (!hit) break
    seen.push(hit.dueDate)
    rows = [...rows, { ...hit.template, id: 's' + i, date: hit.dueDate }]
  }
  return seen
}
{
  const got = walk('2026-01-31', 'monthly', '2027-01-01', 6)
  // February shortens this one occurrence — it has to — and March is back on
  // the 31st. Before the fix every month after February was the 28th.
  eq('31 January lands on 28 February', got[0], '2026-02-28')
  eq('and then back to the 31st of March', got[1], '2026-03-31')
  eq('April has thirty days, so the 30th', got[2], '2026-04-30')
  eq('and May is the 31st again', got[3], '2026-05-31')
  eq('the drift never accumulates', got.join(','),
    '2026-02-28,2026-03-31,2026-04-30,2026-05-31,2026-06-30,2026-07-31')
}
{
  const got = walk('2026-01-30', 'monthly', '2027-01-01', 4)
  eq('the 30th survives February too', got.join(','), '2026-02-28,2026-03-30,2026-04-30,2026-05-30')
}
{
  const got = walk('2026-01-31', 'quarterly', '2028-01-01', 4)
  eq('a quarterly bill keeps its day as well', got.join(','),
    '2026-04-30,2026-07-31,2026-10-31,2027-01-31')
}
{
  // 29 February is the one day a yearly series cannot always have.
  const got = walk('2028-02-29', 'yearly', '2035-01-01', 5)
  eq('a leap-day bill falls back to the 28th', got[0], '2029-02-28')
  eq('stays there through the common years', got[2], '2031-02-28')
  eq('and returns to the 29th in the next leap year', got[3], '2032-02-29')
}
{
  // The controls. A day that exists in every month must not be touched, and a
  // bill logged late must not move the series onto the day it was logged.
  eq('a series on the 5th never moves', walk('2026-01-05', 'monthly', '2027-01-01', 4).join(','),
    '2026-02-05,2026-03-05,2026-04-05,2026-05-05')
  const late = [exp({ date: '2026-01-05' }), exp({ date: '2026-02-25' })]
  eq('and a bill paid three weeks late still runs on the 5th', due(late, '2026-06-01')[0], '2026-03-05')
}

console.log('\n── ONE SERIES PER STREAM, AND SITES ARE STREAMS ──')
// The construction case, and it is the ordinary one: nothing is booked to an
// asset, so the asset cannot tell two streams apart.
{
  const sites = ['s1', 's2', 's3'].map((project_id, i) =>
    exp({ id: project_id, property_id: null, project_id, category: 'Plant hire', date: `2026-01-0${5 + i}` }))
  eq('three sites, three streams', due(sites, '2026-04-01').join(','), '2026-02-05,2026-02-06,2026-02-07')
}
{
  // The control, and the reason the key cannot simply include everything: two
  // entries on the SAME site are one stream and must yield one occurrence.
  const same = [
    exp({ property_id: null, project_id: 's1', category: 'Plant hire', date: '2026-01-05' }),
    exp({ property_id: null, project_id: 's1', category: 'Plant hire', date: '2026-02-05' }),
  ]
  eq('but two bills on one site are one stream', due(same, '2026-04-01').join(','), '2026-03-05')
}
{
  const firms = ['c1', 'c2'].map((entity_id) =>
    exp({ entity_id, property_id: null, category: 'Rent', date: '2026-01-05' }))
  eq('two companies in a consolidated view are two streams', due(firms, '2026-04-01').length, 2)
}
{
  // Not booked anywhere is one place, however it was spelled.
  const spellings = [
    exp({ property_id: null, project_id: null, date: '2026-01-05' }),
    { category: 'Rent', recurrence: 'monthly', date: '2026-02-05' },
  ]
  eq('a missing field and a null field are the same place', due(spellings, '2026-04-01').join(','), '2026-03-05')
}
{
  // Different labels are different streams, and that is the pre-existing
  // behaviour this must not have broken.
  const labels = [
    exp({ category: 'Rent', date: '2026-01-05' }),
    exp({ category: 'Insurance', date: '2026-01-06' }),
  ]
  eq('two categories are two streams', due(labels, '2026-04-01').length, 2)
  // Monthly and yearly on one asset and one category. Dated so that both have
  // come round by the horizon — otherwise this passes whether or not the
  // cadence is part of the key, because the yearly one simply is not due yet.
  const cadences = [
    exp({ recurrence: 'monthly', date: '2026-01-05' }),
    exp({ recurrence: 'yearly', date: '2025-01-05' }),
  ]
  eq('and so are two cadences', due(cadences, '2026-04-01').join(','), '2026-01-05,2026-02-05')
}
{
  // Income is labelled by its source, not its category.
  const inc = [
    { property_id: 'p1', source: 'Rent', recurrence: 'monthly', date: '2026-01-05' },
    { property_id: 'p1', source: 'Interest', recurrence: 'monthly', date: '2026-01-06' },
  ]
  eq('two income sources are two streams', due(inc, '2026-04-01', 'income').length, 2)
  // And an income row carrying a category must not be grouped by it.
  const muddled = [
    { property_id: 'p1', source: 'Rent', category: 'X', recurrence: 'monthly', date: '2026-01-05' },
    { property_id: 'p1', source: 'Rent', category: 'Y', recurrence: 'monthly', date: '2026-02-05' },
  ]
  eq('while one source twice is one stream', due(muddled, '2026-04-01', 'income').join(','), '2026-03-05')
}
{
  const mixed = [exp({ date: '2026-01-07' }), exp({ category: 'Insurance', date: '2026-01-05' })]
  eq('and the answer is sorted by when it is due', due(mixed, '2026-04-01').join(','), '2026-02-05,2026-02-07')
}
{
  // The template handed back is the latest entry in the stream, because that is
  // what gets copied forward — amounts change, and last January's figure is the
  // wrong one to repeat.
  const stream = [exp({ id: 'old', amount: 100, date: '2026-01-05' }), exp({ id: 'new', amount: 250, date: '2026-02-05' })]
  const [hit] = dueRecurring(stream, 'expense', at('2026-04-01'))
  eq('the newest entry is the one copied forward', hit.template.id, 'new')
  eq('so the amount is the current one', hit.template.amount, 250)
  eq('and the kind comes back with it', hit.kind, 'expense')
}

console.log('\n── WHAT THE NEXT OCCURRENCE INHERITS ──')
const template = {
  id: 'e1', user_id: 'u1', created_at: '2026-01-05T10:00:00Z', updated_at: '2026-01-09T10:00:00Z',
  deleted_at: null, receipt_url: 'idb:abc#jan.png',
  created_by: 'alice', approval_status: 'approved', approved_by: 'bob', approved_at: '2026-01-06',
  property_id: 'p1', project_id: 's1', entity_id: 'c1', department_id: 'd1',
  date: '2026-01-05', amount: 48000, category: 'Rent', vendor: 'Landlord',
  payment_method: 'Bank Transfer', description: 'Office rent', recurrence: 'monthly',
  status: 'unpaid', due_date: '2026-01-10', tax: 0,
}
{
  const p = nextOccurrencePayload(template, 'expense', '2026-02-05')
  eq('it is dated to the due date', p.date, '2026-02-05')
  eq('and marked paid', p.status, 'paid')
  eq('with no due date of its own', p.due_date, null)
  // Each of these is a row that already happened, recorded on one that has not.
  for (const gone of ['id', 'user_id', 'created_at', 'updated_at', 'deleted_at', 'receipt_url',
    'created_by', 'approval_status', 'approved_by', 'approved_at']) {
    ok(`${gone} does not travel`, !(gone in p), JSON.stringify(p[gone]))
  }
  // The controls, and they are the point: stripping too much would make the
  // copy land in the wrong books, on the wrong site, for the wrong money, or
  // end the series.
  eq('the asset comes with it', p.property_id, 'p1')
  eq('so does the site', p.project_id, 's1')
  eq('and the company', p.entity_id, 'c1')
  eq('and the department', p.department_id, 'd1')
  eq('the amount is unchanged', p.amount, 48000)
  eq('so is the category', p.category, 'Rent')
  eq('and the vendor', p.vendor, 'Landlord')
  eq('the cadence survives, or the series ends here', p.recurrence, 'monthly')
  eq('and the description carries over', p.description, 'Office rent')
  ok('a zero figure is kept, not dropped as falsy', 'tax' in p && p.tax === 0)
}
{
  const p = nextOccurrencePayload({ ...template, source: 'Rent' }, 'income', '2026-02-05')
  eq('income is marked received instead', p.status, 'received')
  eq('and keeps its source', p.source, 'Rent')
}
ok('the template itself is not modified', template.receipt_url === 'idb:abc#jan.png' && template.status === 'unpaid')

console.log('\n── SETTLED, AND NOT ──')
eq('a paid expense is settled', isSettled({ status: 'paid' }, 'expense'), true)
eq('an unpaid one is not', isSettled({ status: 'unpaid' }, 'expense'), false)
eq('received income is settled', isSettled({ status: 'received' }, 'income'), true)
eq('pending income is not', isSettled({ status: 'pending' }, 'income'), false)
// Older rows from before the app tracked payment. payables.js states this rule
// too and points here for it, so the two screens cannot disagree.
eq('a row with no status at all reads as settled', isSettled({}, 'expense'), true)
eq('and so does an explicit null', isSettled({ status: null }, 'expense'), true)
eq('the same on the income side', isSettled({}, 'income'), true)
// An empty string is not "no status" — it is a status nobody recognises.
eq('an empty status is not settled', isSettled({ status: '' }, 'expense'), false)
// The two sides do not share a vocabulary, and must not.
eq('an expense marked received is not settled', isSettled({ status: 'received' }, 'expense'), false)
eq('nor is income marked paid', isSettled({ status: 'paid' }, 'income'), false)
eq('no kind at all is read as an expense', isSettled({ status: 'paid' }), true)

console.log('\n── OVERDUE ──')
{
  const unfreeze = freezeClock('2026-06-15T09:00:00')
  eq('an unpaid bill past its date is overdue', isOverdue({ status: 'unpaid', due_date: '2026-06-14' }, 'expense'), true)
  eq('one due today is not', isOverdue({ status: 'unpaid', due_date: '2026-06-15' }, 'expense'), false)
  eq('nor is one due tomorrow', isOverdue({ status: 'unpaid', due_date: '2026-06-16' }, 'expense'), false)
  // Nothing to be late against.
  eq('an unpaid bill with no due date is not overdue', isOverdue({ status: 'unpaid' }, 'expense'), false)
  eq('nor with an empty one', isOverdue({ status: 'unpaid', due_date: '' }, 'expense'), false)
  // The control that matters most: paying it stops it being late.
  eq('a paid bill is never overdue', isOverdue({ status: 'paid', due_date: '2020-01-01' }, 'expense'), false)
  eq('and neither is a statusless row', isOverdue({ due_date: '2020-01-01' }, 'expense'), false)
  eq('income can be overdue too', isOverdue({ status: 'pending', due_date: '2026-06-14' }, 'income'), true)
  eq('but not once received', isOverdue({ status: 'received', due_date: '2020-01-01' }, 'income'), false)

  console.log('\n── THE CHIP THAT SAYS SO ──')
  const settled = paymentMeta({ status: 'paid' }, 'expense')
  ok('a paid expense reads Paid and is not overdue', settled.settled && !settled.overdue && settled.label === 'Paid', JSON.stringify(settled))
  eq('received income reads Received', paymentMeta({ status: 'received' }, 'income').label, 'Received')
  eq('an unpaid expense in date reads Unpaid', paymentMeta({ status: 'unpaid', due_date: '2026-06-20' }, 'expense').label, 'Unpaid')
  eq('pending income in date reads Pending', paymentMeta({ status: 'pending', due_date: '2026-06-20' }, 'income').label, 'Pending')
  const late = paymentMeta({ status: 'unpaid', due_date: '2026-06-01' }, 'expense')
  eq('a late one reads Overdue', late.label, 'Overdue')
  ok('and is flagged as both unsettled and overdue', !late.settled && late.overdue)
  ok('every outcome carries a colour', [settled, late, paymentMeta({ status: 'unpaid' }, 'expense')]
    .every((m) => /^#[0-9A-Fa-f]{6}$/.test(m.color)))
  ok('and overdue is not the same colour as merely unpaid',
    late.color !== paymentMeta({ status: 'unpaid', due_date: '2026-06-20' }, 'expense').color)
  unfreeze()
}

console.log('\n── WHAT IS STILL OWED ──')
const owed = [
  { status: 'unpaid', amount: 1000 },
  { status: 'paid', amount: 500 },
  { status: 'unpaid', amount: '250' },
  { amount: 9999 },
  { status: 'unpaid' },
  { status: 'unpaid', amount: 'nonsense' },
]
eq('only the unsettled rows count', outstandingTotal(owed, 'expense'), 1250)
eq('an empty ledger owes nothing', outstandingTotal([], 'expense'), 0)
eq('a ledger that is all paid owes nothing', outstandingTotal([{ status: 'paid', amount: 10 }], 'expense'), 0)
// The control: on the income side the same rows mean something different, so
// the kind has to reach the filter.
eq('the same rows read differently as receivables', outstandingTotal(owed, 'income'), 1750)
eq('a credit note reduces the total rather than being ignored',
  outstandingTotal([{ status: 'unpaid', amount: 1000 }, { status: 'unpaid', amount: -200 }], 'expense'), 800)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
