// Earned leave, and the two ways it quietly costs money.
//
// Days standing are payable in cash when somebody leaves — a liability like
// gratuity, and like gratuity nothing monthly mentions it, so nobody adds it up
// until a site finishes and forty men are paid off in the same week.
//
// The second cost is worse, because it falls on the worker. Leave carries
// forward only up to a cap and anything over it lapses at the year end. A mason
// with forty-one days standing against a thirty-day cap loses eleven days of
// pay on the 31st of March, and nothing anywhere says so until it has happened.
// That is what the lapsing figure is for, and it is why this module exists.
import {
  FACTORIES_ACT, ANNUAL, POLICIES, POLICY_IDS, DEFAULT_DIVISOR, policyOf,
  earnedIn, carryForward, encashmentFor, leaveLiability,
} from '../../src/lib/leave.js'
import { makeEmployee, configForEntity } from '../../src/lib/payroll.js'
import { makeEntity } from '../../src/lib/corporate.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, got, want) => ok(n, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const hand = (id, basic, da, balance, over = {}) => ({
  ...makeEmployee({ entityId: 'e1', id, name: id, basic, da, joinedOn: '2018-01-01', ...over }),
  leave_balance: balance,
})

console.log('\n── TWO SHAPES, BECAUSE THERE IS NO ONE ACT ──')
// The Factories Act gives a day for every twenty worked; the state Shops and
// Establishments Acts mostly give a flat number. Bending one into the other
// would make one of them wrong for everybody on it.
eq('there are two policies', POLICY_IDS.length, 2)
eq('the Factories Act counts days worked', FACTORIES_ACT.basis, 'worked')
eq('one for every twenty', FACTORIES_ACT.perDays, 20)
eq('the other is a flat year', ANNUAL.basis, 'annual')
ok('and each names what it comes from', POLICY_IDS.every((id) => POLICIES[id].act), '')
// Which means a full working year earns twelve days, not eighteen.
eq('a full working year earns twelve days', earnedIn({ daysWorked: 240, policy: FACTORIES_ACT }).days, 12)
eq('half a year earns six', earnedIn({ daysWorked: 120, policy: FACTORIES_ACT }).days, 6)
// On a site this is the difference between a full year and a monsoon, so it is
// asked for — and marked as assumed where nobody counted.
eq('nobody having counted assumes a full year', earnedIn({ policy: FACTORIES_ACT }).days, 12)
ok('and says it assumed', earnedIn({ policy: FACTORIES_ACT }).assumed === true, '')
ok('while a counted year does not', earnedIn({ daysWorked: 240, policy: FACTORIES_ACT }).assumed === false, '')
// A flat policy does not care about attendance, which is the whole point of it.
eq('a flat policy gives its days whatever the attendance', earnedIn({ daysWorked: 20, policy: ANNUAL }).days, 18)
eq('the same as a full year', earnedIn({ daysWorked: 300, policy: ANNUAL }).days, 18)

console.log('\n── THE CAP, AND WHAT FALLS OFF IT ──')
eq('thirty days carry forward', FACTORIES_ACT.carryCap, 30)
eq('thirty days survive', carryForward(30, FACTORIES_ACT).carried, 30)
eq('and nothing lapses', carryForward(30, FACTORIES_ACT).lapsed, 0)
// The boundary, because it is the difference between losing a day and not.
eq('thirty-one carries thirty', carryForward(31, FACTORIES_ACT).carried, 30)
eq('and loses one', carryForward(31, FACTORIES_ACT).lapsed, 1)
ok('which is flagged', carryForward(31, FACTORIES_ACT).willLapse === true, '')
ok('while thirty is not', carryForward(30, FACTORIES_ACT).willLapse === false, '')
eq('fifty-five loses twenty-five', carryForward(55, FACTORIES_ACT).lapsed, 25)
eq('nobody with no leave loses any', carryForward(0, FACTORIES_ACT).lapsed, 0)
// A company can set its own cap, and plenty do.
eq('a company cap of sixty keeps fifty-five', carryForward(55, policyOf({ carryCap: 60 })).lapsed, 0)

console.log('\n── WHAT A DAY IS WORTH ──')
eq('twenty-six working days to the month', DEFAULT_DIVISOR, 26)
const engineer = hand('engineer', 30000, 5000, 41)
const e = encashmentFor(engineer)
// 35,000 ÷ 26 = 1,346.15 a day.
eq('a day is basic and DA over the divisor', e.perDay, 1346.15)
eq('forty-one days is that times forty-one', e.value, 55192)
ok('in whole rupees', Number.isInteger(e.value), String(e.value))
// The number nobody is ever shown.
eq('eleven of those days are about to be lost', e.lapsing, 11)
eq('which is fourteen thousand of his money', e.lapsingValue, 14808)
ok('and the two are different figures', e.value !== e.lapsingValue, '')
// A company on thirty days to the month pays less per day, which is why the
// divisor is a setting and not a constant.
eq('thirty to the month is a smaller day', encashmentFor(engineer, { policy: policyOf({ divisor: 30 }) }).perDay, 1166.67)
ok('and a smaller cheque', encashmentFor(engineer, { policy: policyOf({ divisor: 30 }) }).value < e.value, '')
// Nothing standing is nothing owed, and it says so rather than showing a zero.
eq('no leave standing is worth nothing', encashmentFor(hand('none', 20000, 0, 0)).value, 0)
ok('and says so', /No leave standing/.test(encashmentFor(hand('none', 20000, 0, 0)).why), '')
eq('and no wages recorded is worth nothing either', encashmentFor(hand('nopay', 0, 0, 20)).value, 0)
ok('for a different reason', /No basic or dearness allowance/.test(encashmentFor(hand('nopay', 0, 0, 20)).why), '')

console.log('\n── THE WHOLE PAYROLL ──')
const crew = [
  hand('a', 30000, 5000, 41),
  hand('b', 18000, 3000, 30),
  hand('c', 12000, 2000, 12),
  hand('d', 9000, 1500, 0),
  hand('e', 7000, 1000, 55),
  hand('f', 10000, 0, 8, { active: false }),
]
const book = leaveLiability(crew)
eq('the five on the books are counted', book.people, 5)
eq('and somebody who left is not', crew.length - book.people, 1)
// The totals have to be the lines added up.
eq('the value is the lines added up', book.value, book.lines.reduce((t, l) => t + l.value, 0))
eq('and the days likewise', book.days, book.lines.reduce((t, l) => t + l.balance, 0))
eq('four of the five have a balance recorded', book.recorded, 4)
// A zero that means "nobody entered it" is the one this app keeps trying to
// stop showing.
eq('and one has none, which is not the same as having taken it all', book.unrecorded, 1)
eq('two are over the cap', book.lapsingPeople, 2)
eq('losing thirty-six days between them', book.lapsingDays, 36)
eq('worth twenty-two and a half thousand', book.lapsingValue, 22500)
ok('the worst case comes first', book.over[0].lapsing >= book.over[book.over.length - 1].lapsing, '')
// The control: raise the cap past everybody and nothing lapses at all.
const generous = leaveLiability(crew, { policy: policyOf({ carryCap: 90 }) })
eq('a cap nobody reaches loses nothing', generous.lapsingValue, 0)
eq('while the standing value is unchanged', generous.value, book.value)

console.log('\n── AND THE COMPANY CARRIES THE POLICY ──')
const plain = makeEntity({ name: 'X' })
eq('a new company is on the Factories Act shape', plain.leave_policy, 'factories')
eq('with no cap of its own', plain.leave_carry_cap, null)
eq('a chosen policy is kept', makeEntity({ name: 'X', leavePolicy: 'annual' }).leave_policy, 'annual')
eq('and nonsense falls back', makeEntity({ name: 'X', leavePolicy: 'whatever' }).leave_policy, 'factories')
eq('a cap is kept', makeEntity({ name: 'X', leaveCarryCap: 45 }).leave_carry_cap, 45)
eq('the config carries the policy', configForEntity(makeEntity({ name: 'X', leavePolicy: 'annual' })).leave.policy, 'annual')
eq('and the cap', configForEntity(makeEntity({ name: 'X', leaveCarryCap: 45 })).leave.carryCap, 45)
// Which has to reach the arithmetic, or the setting is a field nobody reads.
eq('a company cap changes what lapses',
  leaveLiability(crew, { policy: configForEntity(makeEntity({ name: 'X', leaveCarryCap: 45 })).leave }).lapsingPeople, 1)
eq('a balance on an employee is kept', makeEmployee({ entityId: 'e1', name: 'N', leaveBalance: 12 }).leave_balance, 12)
eq('and cannot go negative', makeEmployee({ entityId: 'e1', name: 'N', leaveBalance: -5 }).leave_balance, 0)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
