// The trail, read back.
//
// Every update in the corporate store already recorded which fields moved and
// what they moved from — `{ rate: [550, 620] }` — and every create and delete
// recorded what identified the row. None of it had ever been shown. The log on
// the Companies page said "Deepak edited a site" and stopped, which tells you
// an argument happened without telling you what it was about, and is the one
// thing a log exists to do.
import {
  makeAuditEvent, auditChanges, describeAuditChanges, auditFieldLabel,
  describeAuditEvent, auditAt, AUDIT_ACTIONS,
} from '../../src/lib/corporate.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, got, want) => ok(n, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const ev = (action, detail) => makeAuditEvent({
  entityId: 'e1', actorId: 'u1', actorEmail: 'deepak@navi.example', action, targetId: 't1', detail,
})

console.log('\n── AN EDIT READS AS A MOVE ──')
const raised = auditChanges(ev('muster.update', { rate: [550, 620] }))
eq('one field moved', raised.length, 1)
eq('and it is named', raised[0].field, 'rate')
eq('from what it was', raised[0].from, '550')
eq('to what it is', raised[0].to, '620')
eq('said in a line', describeAuditChanges(ev('muster.update', { rate: [550, 620] })), 'rate 550 → 620')

console.log('\n── AND SEVERAL AT ONCE ──')
const many = ev('site.update', { name: ['Tower A', 'Tower A — Wing 1'], contract_value: [90000000, 96000000] })
eq('both are carried', auditChanges(many).length, 2)
eq('with the column name spoken', auditChanges(many)[1].field, 'contract value')
ok('and both appear in the sentence',
  /Tower A → Tower A — Wing 1/.test(describeAuditChanges(many))
  && /9,00,00,000 → 9,60,00,000/.test(describeAuditChanges(many)),
  describeAuditChanges(many))

console.log('\n── NOTHING IS NOT AN EMPTY GAP ──')
// A field cleared, and a field filled for the first time. Printing "" either
// side of an arrow is what a half-finished log looks like.
eq('a cleared field says so', describeAuditChanges(ev('site.update', { due_on: ['2026-09-30', ''] })), 'due date 2026-09-30 → nothing')
eq('and one filled for the first time', describeAuditChanges(ev('site.update', { due_on: [null, '2026-09-30'] })), 'due date nothing → 2026-09-30')
// Three answers, not two: the statutory flags mean something different when
// nobody has said, and "no" must not read the same as "unanswered".
eq('false reads as no', describeAuditChanges(ev('entity.update', { pf_registered: [null, false] })), 'provident fund registration nothing → no')
eq('and true as yes', describeAuditChanges(ev('entity.update', { pf_registered: [false, true] })), 'provident fund registration no → yes')
ok('so an unanswered flag and a refused one do not read alike',
  describeAuditChanges(ev('entity.update', { pf_registered: [null, true] }))
  !== describeAuditChanges(ev('entity.update', { pf_registered: [false, true] })))

console.log('\n── A SHAPE THE STORE WILL NOT PRINT ──')
// Objects and arrays are compared by their JSON and recorded as the word
// `changed`, because printing a slab of JSON on an audit line helps nobody.
const slabs = auditChanges(ev('entity.update', { pt_slabs: 'changed' }))
eq('it is still reported', slabs.length, 1)
eq('as having changed', slabs[0].note, 'changed')
eq('with no from and no to', `${slabs[0].from}/${slabs[0].to}`, 'null/null')
eq('and reads plainly', describeAuditChanges(ev('entity.update', { pt_slabs: 'changed' })), 'professional tax slabs changed')

console.log('\n── A LONG NUMBER IS GROUPED, AND NOTHING ELSE IS ──')
// `1840000` against `18,40,000`, in the Indian grouping the rest of the app
// uses. No currency symbol: the trail does not know which fields are money.
eq('a long number is readable', describeAuditChanges(ev('rabill.approve', { amount: 1840000 })), 'amount 18,40,000')
ok('and carries no currency it cannot know about', !/₹/.test(describeAuditChanges(ev('rabill.approve', { amount: 1840000 }))))
eq('a short one is left alone', describeAuditChanges(ev('muster.update', { rate: [550, 620] })), 'rate 550 → 620')
// The control: a year is a number and must not be dressed up as a quantity.
eq('and a year is not grouped', describeAuditChanges(ev('site.update', { started_on: 2026 })), 'start date 2026')
eq('a string of digits stays a string', describeAuditChanges(ev('site.update', { gstin: '27AAAPA1234A1Z5' })), 'gstin 27AAAPA1234A1Z5')

console.log('\n── A CREATE IS NOT A MOVE ──')
// What identified the row, not a change from nothing to it.
const made = auditChanges(ev('advance.create', { party: 'Deepak Patil', amount: 40000 }))
eq('both identifying fields are carried', made.length, 2)
eq('with no "from"', made[0].from, null)
eq('and the value as it stands', made[0].to, 'Deepak Patil')
ok('so it does not pretend something moved', !describeAuditChanges(ev('advance.create', { party: 'Deepak Patil' })).includes('→'),
  describeAuditChanges(ev('advance.create', { party: 'Deepak Patil' })))

console.log('\n── NOTHING RECORDED, NOTHING INVENTED ──')
eq('an event with no detail has no lines', auditChanges(ev('member.remove', null)).length, 0)
eq('nor does one with an empty object', auditChanges(ev('member.remove', {})).length, 0)
eq('and the sentence is empty rather than odd', describeAuditChanges(ev('member.remove', null)), '')
eq('a malformed event does not throw', auditChanges(undefined).length, 0)
eq('nor does a detail that is not an object', auditChanges(ev('member.remove', 'rubbish')).length, 0)
eq('nor one that is an array', auditChanges(ev('member.remove', ['a', 'b'])).length, 0)

console.log('\n── THE FIELD NAMES PEOPLE USE ──')
eq('a column becomes words', auditFieldLabel('fy_start_month'), 'financial year start')
eq('an underscore becomes a space', auditFieldLabel('some_other_field'), 'some other field')
eq('and a plain name is left alone', auditFieldLabel('name'), 'name')
// The control: a field with no entry in the table is not silently blanked.
ok('an unmapped field still says something', auditFieldLabel('zzz_unknown').length > 0, auditFieldLabel('zzz_unknown'))

console.log('\n── THE LINE ABOVE THE CHANGES ──')
const one = ev('site.update', { name: ['A', 'B'] })
ok('says who', describeAuditEvent(one).startsWith('deepak@navi.example'), describeAuditEvent(one))
ok('and what kind of thing they did', describeAuditEvent(one).includes(AUDIT_ACTIONS['site.update']), describeAuditEvent(one))
eq('an actor with no email is still somebody', describeAuditEvent({ action: 'site.update' }).split(' ')[0], 'Someone')
ok('and every event is stamped', /^\d{4}-\d{2}-\d{2}T/.test(auditAt(one)), auditAt(one))

console.log('\n── EVERY ACTION THE STORE WRITES HAS WORDS FOR IT ──')
// The store builds action names as `${noun}.${verb}`. A noun added without a
// phrase here shows the raw key on screen, which is how "rabill.update"
// reaches a user.
const { readFileSync } = await import('node:fs')
const storeSrc = readFileSync('src/lib/storage/corporate.js', 'utf8')
const nouns = [...storeSrc.matchAll(/=\s*collection\([^,]+,\s*'([a-z ]+)'\)/g)].map((m) => m[1])
ok('the store names some nouns', nouns.length > 5, String(nouns.length))
const missing = nouns.flatMap((n) => ['create', 'update', 'delete']
  .filter((v) => !AUDIT_ACTIONS[`${n}.${v}`])
  .map((v) => `${n}.${v}`))
ok('and every one of them has a phrase', missing.length === 0, missing.join(', '))
// The control: the check can tell when one is absent.
ok('the check would notice a missing phrase', !AUDIT_ACTIONS['nonesuch.update'])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
