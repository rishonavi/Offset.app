// Gratuity: the money a company already owes and has never added up.
//
// It is not a deduction, it reaches no payslip, and nothing in a month's
// accounts moves when it grows — which is exactly why a builder with forty men,
// a dozen of them there since the first site, is carrying a number nobody has
// written down. It falls due all at once when a job ends and the men are paid
// off, which is the worst month for it to be a surprise.
//
// Four places to get it wrong, and each has a section here:
//
//   **Wages means basic plus dearness allowance.** Not gross. Computing on
//   gross overstates the liability by half for most payrolls.
//
//   **Fifteen days out of twenty-six**, because the Act divides a month's wages
//   by twenty-six working days rather than thirty.
//
//   **A part-year over six months counts as a whole year**, and the jump is a
//   month's wages wide.
//
//   **Accrued is not payable.** Somebody three years in has a number and would
//   get nothing if they left tomorrow, and a screen that shows one figure for
//   both is lying about whichever one it is not.
import {
  serviceOn, gratuityFor, gratuityStatus, gratuityLiability,
  THRESHOLD, VESTING_YEARS, CEILING, DAYS_PER_YEAR, DAYS_PER_MONTH, ACT,
} from '../../src/lib/gratuity.js'
import { makeEmployee, wagesOf, grossOf, configForEntity } from '../../src/lib/payroll.js'
import { makeEntity } from '../../src/lib/corporate.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, got, want) => ok(n, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

// A fixed day, so a suite that passes in September still passes in March.
const ASOF = '2026-09-17'
const man = (id, name, basic, da, joined, over = {}) =>
  makeEmployee({ entityId: 'e1', id, name, basic, da, joinedOn: joined, ...over })
const svc = (joined) => serviceOn(joined, ASOF)

console.log('\n── HOW LONG SOMEBODY HAS BEEN HERE ──')
eq('ten years and three months', svc('2016-06-01').years, 10)
eq('and the months with it', svc('2016-06-01').months, 3)
// The rounding rule, at the boundary, because the jump is a month's wages wide.
eq('five years and six months counts as five', svc('2021-03-17').counted, 5)
eq('five years and seven months counts as six', svc('2021-02-17').counted, 6)
// "In excess of six months", so six months to the day does not round up. It is
// written down here because it is exactly the comparison somebody flips later.
eq('six months to the day does not round up', svc('2021-03-17').months, 6)
eq('and it is six months with no days over', svc('2021-03-17').restDays, 0)
eq('nor does anything under it', svc('2021-06-01').counted, 5)
// The day that costs a month's wages. Whole-month arithmetic on its own cannot
// see it, and rounded this man down until it did.
eq('a day past six months does', svc('2021-03-16').counted, 6)
eq('because there is a day over', svc('2021-03-16').restDays, 1)
// Vesting is on completed years, not on the rounded figure — which is why
// somebody at four years eleven months has a counted year they cannot claim.
eq('vesting takes five completed years', svc('2021-09-17').vested, true)
eq('a day short is not vested', svc('2021-09-18').vested, false)
eq('though it still counts as five for the arithmetic', svc('2021-10-01').counted, 5)
eq('while not being payable', svc('2021-10-01').vested, false)
// Section 2A and the four-years-240-days line of cases: contested, dependent on
// the working week, and not a thing a payroll screen can decide. Flagged rather
// than answered.
ok('four years and eleven months is flagged as arguable', svc('2021-10-01').arguable === true, JSON.stringify(svc('2021-10-01')))
ok('four years and five months is not', svc('2022-04-01').arguable !== true, JSON.stringify(svc('2022-04-01')))
ok('and somebody already vested is not flagged either', svc('2016-06-01').arguable !== true, '')
// No date is not a zero-length service, it is an unknown one.
eq('no joining date is not nought years', svc('').known, false)
eq('nor is a date in the future', svc('2027-01-01').known, false)
eq('nor nonsense', svc('the third of never').known, false)

console.log('\n── FIFTEEN DAYS OF THE RIGHT NUMBER ──')
// Wages is basic plus dearness allowance. Not gross. This is the single most
// expensive place to be wrong, because HRA is commonly forty per cent of basic
// and nothing on screen would look odd.
const hand = man('a', 'Mason', 20000, 5000, '2016-09-17', { hra: 10000, special: 4000 })
eq('gross is everything', grossOf(hand), 39000)
eq('but wages is basic and DA only', wagesOf(hand), 25000)
const g = gratuityFor(hand, { asOf: ASOF })
eq('ten years in', g.service.counted, 10)
// 25,000 × 15 ÷ 26 × 10 = 1,44,230.77, paid as whole rupees.
eq('fifteen days of it for each year', g.accrued, 144231)
ok('which is not fifteen days of gross', g.accrued !== Math.round(grossOf(hand) * 15 / 26 * 10),
  `${g.accrued} vs ${Math.round(grossOf(hand) * 15 / 26 * 10)}`)
// Twenty-six, not thirty. Using thirty pays 13% less.
eq('a month is twenty-six working days', DAYS_PER_MONTH, 26)
eq('and the entitlement is fifteen of them', DAYS_PER_YEAR, 15)
ok('which is more than half a month', g.accrued > Math.round(25000 * 0.5 * 10),
  `${g.accrued} vs ${Math.round(25000 * 0.5 * 10)}`)
// Whole rupees: a total nobody can match to a cheque is worse than no total.
ok('it is whole rupees', Number.isInteger(g.accrued), String(g.accrued))
eq('somebody with no wages recorded gets nothing', gratuityFor(man('b', 'B', 0, 0, '2010-01-01'), { asOf: ASOF }).accrued, 0)
ok('and is told why', /No basic or dearness allowance/.test(gratuityFor(man('b', 'B', 0, 0, '2010-01-01'), { asOf: ASOF }).why), '')

console.log('\n── ACCRUED IS NOT PAYABLE ──')
// The distinction the whole card turns on.
const young = gratuityFor(man('c', 'C', 20000, 0, '2023-09-17'), { asOf: ASOF })
ok('three years in has accrued something', young.accrued > 0, String(young.accrued))
eq('and would be paid nothing today', young.payable, 0)
eq('because it has not vested', young.vested, false)
ok('and the sentence says so', /has accrued but not vested/.test(young.why), young.why)
const old = gratuityFor(man('d', 'D', 20000, 0, '2016-09-17'), { asOf: ASOF })
eq('ten years in is payable in full', old.payable, old.accrued)
ok('and the sentence does not hedge', !/not vested/.test(old.why), old.why)

console.log('\n── THE CEILING ──')
eq('the Act caps a gratuity at twenty lakh', CEILING, 2000000)
// Thirty years on ₹3,00,000 a month is ₹51.9 lakh before the cap.
const boss = gratuityFor(man('e', 'E', 250000, 50000, '1996-09-17'), { asOf: ASOF })
ok('a long-serving director would earn more than that', boss.uncapped > CEILING, String(boss.uncapped))
eq('but is capped', boss.accrued, CEILING)
ok('and flagged as capped', boss.capped === true, '')
ok('with the ceiling named', /ceiling/.test(boss.why), boss.why)
// The control: just under the ceiling is not capped.
ok('somebody under it is not', gratuityFor(man('f', 'F', 20000, 0, '2016-09-17'), { asOf: ASOF }).capped === false, '')

console.log('\n── WHETHER THE ACT APPLIES AT ALL ──')
eq('it bites at ten employees', THRESHOLD, 10)
eq('which is the same ten as state insurance', gratuityStatus({ headcount: 10 }).over, true)
eq('nine is under it', gratuityStatus({ headcount: 9 }).over, false)
eq('and then it does not apply', gratuityStatus({ headcount: 9 }).applies, false)
// A promise made is owed whatever the Act says, so a small firm can say it pays
// anyway — and plenty do.
eq('unless the company says it pays anyway', gratuityStatus({ headcount: 9, config: { voluntary: true } }).applies, true)
eq('which is marked as voluntary', gratuityStatus({ headcount: 9, config: { voluntary: true } }).voluntary, true)
eq('and is not voluntary once it is compulsory', gratuityStatus({ headcount: 40, config: { voluntary: true } }).voluntary, false)
ok('the Act is named', gratuityStatus({ headcount: 40 }).why.includes(ACT), gratuityStatus({ headcount: 40 }).why)

console.log('\n── WHAT THE WHOLE PAYROLL HAS ACCRUED ──')
// The number that has never been on a screen.
const crew = [
  man('p1', 'Site engineer', 30000, 5000, '2016-06-01'),
  man('p2', 'Foreman', 18000, 3000, '2019-01-15'),
  man('p3', 'Storekeeper', 12000, 2000, '2021-03-20'),
  man('p4', 'Supervisor', 14000, 2000, '2021-10-01'),
  man('p5', 'Mason', 9000, 1500, '2022-04-01'),
  man('p6', 'Helper', 7000, 1000, '2026-05-01'),
  man('p7', 'No date', 10000, 1000, ''),
  man('p8', 'Left', 10000, 1000, '2015-01-01', { active: false }),
  ...Array.from({ length: 4 }, (_, i) => man(`x${i}`, `Extra ${i}`, 10000, 0, '2024-01-01')),
]
const book = gratuityLiability(crew, { asOf: ASOF })
eq('the twelve on the books are counted', book.people, 11)
eq('and somebody who left is not', crew.length - book.people, 1)
eq('eleven is over the threshold', book.applies, true)
// The totals have to be the lines added up, or the card and the list under it
// disagree and both look authoritative.
eq('accrued is the lines added up', book.accrued, book.lines.reduce((t, l) => t + l.accrued, 0))
eq('and vested likewise', book.vestedTotal, book.lines.reduce((t, l) => t + l.payable, 0))
eq('the two parts make the whole', book.vestedTotal + book.unvested, book.accrued)
ok('and they are not the same number', book.vestedTotal !== book.accrued, `${book.vestedTotal} vs ${book.accrued}`)
ok('vested is the larger part here', book.vestedTotal > book.unvested, `${book.vestedTotal} vs ${book.unvested}`)
eq('three people have passed five years', book.vestedPeople, 3)
// Somebody with no joining date is quietly worth nothing, which is the cheapest
// kind of wrong, so the count is carried out of the function.
eq('the one with no joining date is counted', book.undated, 1)
eq('and contributes nothing to the total', gratuityFor(crew[6], { asOf: ASOF }).accrued, 0)

console.log('\n── THE CLIFF ──')
// On a site where a dozen men started together it arrives for all of them in
// the same month, which is the difference between a planned cost and a shock.
const names = book.vestingSoon.map((l) => l.name)
ok('the supervisor is a month off vesting', names.includes('Supervisor'), JSON.stringify(names))
ok('and the mason is seven months off', names.includes('Mason'), JSON.stringify(names))
ok('the helper four months in is not on the list', !names.includes('Helper'), JSON.stringify(names))
ok('nor is anybody already vested', !names.includes('Site engineer'), JSON.stringify(names))
ok('soonest first', book.vestingSoon.every((l, i, a) => i === 0 || a[i - 1].monthsToVest <= l.monthsToVest), '')
eq('and the months are counted to the cliff', book.vestingSoon[0].monthsToVest, 1)
// The control: four people who joined in 2024 are two years off and must not
// appear, or "within the year" means nothing.
ok('people two years off do not appear', !names.some((n) => n.startsWith('Extra')), JSON.stringify(names))

console.log('\n── AND THE COMPANY CARRIES THE ANSWER ──')
const plain = makeEntity({ name: 'X' })
eq('a new company has not said it pays gratuity voluntarily', plain.gratuity_voluntary, false)
eq('but it can say so', makeEntity({ name: 'X', gratuityVoluntary: true }).gratuity_voluntary, true)
eq('and the config carries it', configForEntity(makeEntity({ name: 'X', gratuityVoluntary: true })).gratuity.voluntary, true)
eq('while a plain company carries false', configForEntity(plain).gratuity.voluntary, false)
// Which is the difference between a small firm seeing a liability and not.
const four = crew.slice(0, 4)
eq('four men, and the Act does not apply', gratuityLiability(four, { asOf: ASOF }).applies, false)
eq('unless they say they pay it', gratuityLiability(four, { asOf: ASOF, config: { voluntary: true } }).applies, true)
ok('and the liability is the same either way, once it applies',
  gratuityLiability(four, { asOf: ASOF }).accrued === gratuityLiability(four, { asOf: ASOF, config: { voluntary: true } }).accrued, '')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
