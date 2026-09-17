// Statutory bonus, and the two ceilings everybody runs together.
//
// The Payment of Bonus Act, 1965 makes an employer with twenty or more
// employees pay every eligible person between 8.33% and 20% of a year's wages,
// within eight months of the year closing. Like gratuity it is a liability that
// nothing monthly mentions, so it accrues in silence and falls due in one lump
// — usually around Diwali, usually on a site that is also paying for materials.
//
// The part that gets computed wrong is that there are **two** ceilings, doing
// different jobs, and they are different numbers:
//
//   **₹21,000 a month decides who is covered.** Above it the Act does not reach
//   the person at all.
//
//   **₹7,000 a month — or the minimum wage for the work, whichever is higher —
//   decides what the bonus is worked out on.** Somebody on ₹18,000 is covered,
//   and their bonus is a percentage of ₹7,000 rather than of ₹18,000.
//
// Run the two together and a company pays that person about two and a half
// times what it owes them. The first section below is that arithmetic, because
// it is the reason this file exists.
import {
  bonusFor, bonusWages, bonusStatus, bonusRegister, bonusYear, monthsInYear,
  THRESHOLD, ELIGIBILITY_CEILING, CALCULATION_CEILING, MIN_RATE, MAX_RATE, MIN_DAYS, DUE_MONTHS, INFANCY_YEARS, ACT,
} from '../../src/lib/bonus.js'
import { makeEmployee, configForEntity } from '../../src/lib/payroll.js'
import { makeEntity } from '../../src/lib/corporate.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, got, want) => ok(n, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const ASOF = '2026-09-17'
const man = (id, name, basic, da = 0, joined = '2015-01-01', over = {}) =>
  makeEmployee({ entityId: 'e1', id, name, basic, da, joinedOn: joined, ...over })

console.log('\n── TWO CEILINGS, DOING DIFFERENT JOBS ──')
eq('the Act covers people up to twenty-one thousand a month', ELIGIBILITY_CEILING, 21000)
eq('and computes the bonus on seven', CALCULATION_CEILING, 7000)
ok('which are not the same number', ELIGIBILITY_CEILING !== CALCULATION_CEILING, '')
// The man this is all about: covered, and not paid on his own wages.
const middling = man('a', 'Foreman', 15000, 3000)
const b = bonusFor(middling, { rate: MIN_RATE })
eq('he is covered at eighteen thousand', b.eligible, true)
eq('but the bonus is worked out on seven', b.computedOn, 7000)
// 8.33% of 7,000 for twelve months.
eq('so it is a little under seven thousand for the year', b.amount, 6997)
// What it would be if the second ceiling were forgotten, which is the mistake.
const wrong = Math.round(18000 * 12 * MIN_RATE / 100)
ok('and not the two and a half times that follows from forgetting it', b.amount < wrong / 2,
  `${b.amount} vs ${wrong}`)
ok('the sentence names the ceiling that bit', /caps the calculation/.test(b.why), b.why)
ok('and it is flagged, not merely computed', b.held === true, JSON.stringify(b))
// Somebody under both ceilings is paid on their actual wages, which is the
// control — otherwise the cap could be clamping everybody and nobody would know.
const low = bonusFor(man('b', 'Helper', 5000, 500), { rate: MIN_RATE })
eq('a man under the calculation ceiling is paid on his wages', low.computedOn, 5500)
ok('and is not flagged as held', low.held === false, JSON.stringify(low))
// 8.33% of ₹5,500 for twelve months, to the nearest rupee.
eq('which is more than nothing', low.amount, 5498)
// And somebody over the eligibility ceiling is outside the Act entirely — a
// different thing from being capped.
const boss = bonusFor(man('c', 'Engineer', 30000, 5000), { rate: MIN_RATE })
eq('a man over the eligibility ceiling gets nothing', boss.amount, 0)
eq('because he is not covered at all', boss.eligible, false)
ok('which reads differently from being capped', boss.overCeiling === true && !boss.held, JSON.stringify(boss))
// Exactly at the ceiling is inside it.
eq('twenty-one thousand exactly is still covered', bonusFor(man('d', 'D', 21000), { rate: MIN_RATE }).eligible, true)
eq('and a rupee more is not', bonusFor(man('e', 'E', 21001), { rate: MIN_RATE }).eligible, false)

console.log('\n── THE MINIMUM WAGE IS THE HALF NOBODY APPLIES ──')
// "₹7,000 or the minimum wage for the scheduled employment, whichever is
// higher" — and the second half is the clause most often dropped. It is per
// state, per scheduled employment, revised twice a year, and construction has
// its own schedule, so it is asked for rather than built in and wrong by June.
eq('with no minimum wage the ceiling is seven thousand', bonusWages(18000).ceiling, 7000)
eq('a lower minimum wage does not lower it', bonusWages(18000, { minimumWage: 5000 }).ceiling, 7000)
eq('a higher one raises it', bonusWages(18000, { minimumWage: 12000 }).ceiling, 12000)
eq('and the bonus with it', bonusFor(middling, { rate: MIN_RATE, minimumWage: 12000 }).amount, 11995)
ok('which is nearly twice what the bare ceiling gives',
  bonusFor(middling, { rate: MIN_RATE, minimumWage: 12000 }).amount > b.amount * 1.7, '')
ok('and the sentence says the minimum wage is what bit',
  /which here is the minimum wage/.test(bonusFor(middling, { rate: MIN_RATE, minimumWage: 12000 }).why),
  bonusFor(middling, { rate: MIN_RATE, minimumWage: 12000 }).why)
// A minimum wage above somebody's actual pay does not invent pay for them.
const under = bonusFor(man('f', 'F', 5000), { rate: MIN_RATE, minimumWage: 12000 })
eq('somebody paid less than the minimum wage is still paid on what they get', under.computedOn, 5000)
ok('and is not held', under.held === false, JSON.stringify(under))

eq('and the infancy period is five years', INFANCY_YEARS, 5)

console.log('\n── THE RATE IS A DECISION, AND THE MINIMUM IS NOT IT ──')
eq('the Act imposes 8.33 per cent', MIN_RATE, 8.33)
eq('and allows up to twenty', MAX_RATE, 20)
eq('a rate under the minimum is lifted to it', bonusFor(middling, { rate: 2 }).amount, 6997)
eq('and one over the maximum is held to it', bonusFor(middling, { rate: 50 }).amount, bonusFor(middling, { rate: MAX_RATE }).amount)
eq('twenty per cent on the ceiling is sixteen thousand eight hundred', bonusFor(middling, { rate: MAX_RATE }).amount, 16800)

console.log('\n── THIRTY DAYS IN THE YEAR ──')
eq('the Act asks for thirty days', MIN_DAYS, 30)
// A man who joined in the last fortnight of the year has not earned it yet.
const fortnight = bonusFor(man('g', 'G', 10000), { rate: MIN_RATE, monthsWorked: 12, daysWorked: 20 })
eq('twenty days is not enough', fortnight.amount, 0)
eq('and he is not eligible', fortnight.eligible, false)
ok('the reason counts the days', /20 days/.test(fortnight.why), fortnight.why)
eq('thirty is enough', bonusFor(man('h', 'H', 10000), { rate: MIN_RATE, monthsWorked: 1, daysWorked: 30 }).eligible, true)
// Where nobody counted days, a month of service stands in — and the caller is
// told it was assumed rather than handed a figure that looks measured.
ok('an uncounted year is assumed from the months', bonusFor(man('i', 'I', 10000), { rate: MIN_RATE }).assumedDays === true, '')
ok('and a counted one is not', bonusFor(man('j', 'J', 10000), { rate: MIN_RATE, daysWorked: 300 }).assumedDays === false, '')

console.log('\n── A YEAR, AND WHEN THE MONEY HAS TO BE OUT ──')
eq('eight months after the close', DUE_MONTHS, 8)
const yr = bonusYear(4, ASOF, 1)
eq('the April year that just closed', yr.label, '2025-26')
eq('running from April', yr.from, '2025-04-01')
eq('to the end of March', yr.to, '2026-03-31')
// Which lands on the last day of November, squarely on top of the season a
// builder is paying for materials.
eq('and payable by the end of November', yr.due, '2026-11-30')
eq('it has closed', yr.closed, true)
eq('and is not yet late in September', yr.overdue, false)
eq('with the days counted', yr.daysToDue, 74)
eq('in December it is late', bonusYear(4, '2026-12-05', 1).overdue, true)
eq('and the days go negative', bonusYear(4, '2026-12-05', 1).daysToDue, -5)
// The year in progress is not payable for another twenty months, which is why
// the register looks back by default.
eq('the current year has not closed', bonusYear(4, ASOF, 0).closed, false)
eq('nor is it due', bonusYear(4, ASOF, 0).overdue, false)
// A company on a January year closes in December and pays by August.
eq('a January year runs to December', bonusYear(1, '2026-09-17', 1).to, '2025-12-31')
eq('and is due in August', bonusYear(1, '2026-09-17', 1).due, '2026-08-31')

console.log('\n── A MAN WHO JOINED IN DECEMBER IS NOT OWED A YEAR ──')
const year = { from: '2025-04-01', to: '2026-03-31' }
eq('somebody there all year gets twelve months', monthsInYear('2020-01-01', year).months, 12)
eq('somebody who joined on the first day too', monthsInYear('2025-04-01', year).months, 12)
eq('somebody who joined in December gets four', monthsInYear('2025-12-01', year).months, 4)
eq('somebody who joined after it closed gets none', monthsInYear('2026-06-01', year).months, 0)
eq('and no joining date is a full year, but known to be a guess', monthsInYear('', year).known, false)
eq('which still counts twelve', monthsInYear('', year).months, 12)
// A third of a year is a third of the bonus.
eq('four months is a third of the money', bonusFor(middling, { rate: MIN_RATE, monthsWorked: 4 }).amount, 2332)

console.log('\n── WHETHER THE ACT APPLIES AT ALL ──')
eq('it bites at twenty employees', THRESHOLD, 20)
eq('which is the same twenty as the provident fund', bonusStatus({ headcount: 20 }).over, true)
eq('nineteen is under it', bonusStatus({ headcount: 19 }).applies, false)
eq('unless the company says it pays anyway', bonusStatus({ headcount: 19, config: { voluntary: true } }).applies, true)
eq('which is marked as voluntary', bonusStatus({ headcount: 19, config: { voluntary: true } }).voluntary, true)
ok('the Act is named', bonusStatus({ headcount: 30 }).why.includes(ACT), bonusStatus({ headcount: 30 }).why)

console.log('\n── A NEW ESTABLISHMENT, FLAGGED AND NOT EXCUSED ──')
// Section 16 keeps a new establishment outside the Act for five years, except
// in a year it makes a profit — and whether it did is not a thing a payroll
// screen knows. So it is flagged and not applied: a company told it owes
// nothing, wrongly, finds out eight months late.
const young = bonusStatus({ headcount: 30, born: '2024-01-01', asOf: ASOF })
eq('a two-year-old company is in its infancy', young.infancy, true)
eq('with its age counted', young.companyAge, 2)
// Flagged, not excused. The Act still applies as far as this is concerned.
eq('and the Act still applies as far as this can tell', young.applies, true)
const grown = bonusStatus({ headcount: 30, born: '2015-01-01', asOf: ASOF })
eq('a ten-year-old company is not', grown.infancy, false)
eq('five years to the day is out of it', bonusStatus({ headcount: 30, born: '2021-09-17', asOf: ASOF }).infancy, false)
eq('a day short is still in it', bonusStatus({ headcount: 30, born: '2021-09-18', asOf: ASOF }).infancy, true)
// No founding date is not a young company.
eq('a company with no founding date is not assumed young', bonusStatus({ headcount: 30 }).infancy, false)
eq('and has no age', bonusStatus({ headcount: 30 }).companyAge, null)
eq('the register carries it', bonusRegister([man('n', 'N', 9000)], { asOf: ASOF, born: '2024-01-01' }).infancy, true)

console.log('\n── THE REGISTER ──')
const crew = [
  man('r1', 'Engineer', 30000, 5000),
  man('r2', 'Foreman', 15000, 3000),
  man('r3', 'Storekeeper', 12000, 2000),
  man('r4', 'Mason', 9000, 1500),
  man('r5', 'Joined late', 8000, 1000, '2025-12-01'),
  man('r6', 'After it closed', 8000, 1000, '2026-05-01'),
  man('r7', 'No date', 11000, 0, ''),
  man('r8', 'Left', 10000, 0, '2015-01-01', { active: false }),
  ...Array.from({ length: 14 }, (_, i) => man(`x${i}`, `Hand ${i}`, 9000, 0)),
]
const reg = bonusRegister(crew, { fyStartMonth: 4, asOf: ASOF, rate: null, minimumWage: 0 })
eq('the twenty-one on the books are counted', reg.people, 21)
eq('and the Act applies', reg.applies, true)
eq('it is the closed year', reg.year.label, '2025-26')
// Nobody chose a rate, so this is what the law would settle for and not what
// the company decided — a distinction the register has to keep.
eq('the rate falls back to the minimum', reg.rate, MIN_RATE)
eq('but it is not recorded as chosen', reg.rateChosen, false)
eq('choosing one says so', bonusRegister(crew, { fyStartMonth: 4, asOf: ASOF, rate: 12 }).rateChosen, true)
eq('and uses it', bonusRegister(crew, { fyStartMonth: 4, asOf: ASOF, rate: 12 }).rate, 12)
// The engineer is over the ceiling; the man who joined after the year closed
// gets nothing.
eq('one man is outside the Act', reg.overCeiling, 1)
eq('nineteen are owed something', reg.eligible, 19)
ok('and the total is the lines added up', reg.total === reg.lines.filter((l) => l.eligible).reduce((t, l) => t + l.amount, 0),
  String(reg.total))
ok('every line is whole rupees', reg.lines.every((l) => Number.isInteger(l.amount)), '')
eq('the man who joined after it closed gets nothing', reg.lines.find((l) => l.name === 'After it closed').amount, 0)
ok('the one who joined in December gets part of a year',
  reg.lines.find((l) => l.name === 'Joined late').monthsWorked === 4, '')
eq('and the undated are counted', reg.undated, 1)
// Held at the ceiling: everybody eligible on more than ₹7,000 of basic and DA,
// which on a site is almost the whole muster — ₹7,000 has not been a realistic
// month's basic for a long time, and that is why forgetting this ceiling is so
// expensive.
eq('nineteen of the crew are paid on the ceiling rather than their wages', reg.held, 19)
eq('which is everybody the Act reaches', reg.held, reg.eligible)
// The control: raise the ceiling past their wages and nobody is held.
eq('and raising the ceiling past their pay releases them',
  bonusRegister(crew, { fyStartMonth: 4, asOf: ASOF, rate: null, minimumWage: 25000 }).held, 0)
// The question every owner asks the moment they see the minimum.
ok('the maximum costs more than the minimum', reg.atMaximum > reg.total, `${reg.atMaximum} vs ${reg.total}`)
eq('by the ratio of the two rates', Math.round(reg.atMaximum / reg.total * 100) / 100, Math.round(MAX_RATE / MIN_RATE * 100) / 100)

console.log('\n── AND THE COMPANY CARRIES THE ANSWERS ──')
const plain = makeEntity({ name: 'X' })
eq('a new company has chosen no rate', plain.bonus_rate, null)
ok('which is not the same as choosing the minimum', plain.bonus_rate !== MIN_RATE, '')
eq('nor entered a minimum wage', plain.minimum_wage, null)
eq('nor said it pays a bonus voluntarily', plain.bonus_voluntary, false)
eq('a chosen rate is kept', makeEntity({ name: 'X', bonusRate: 12 }).bonus_rate, 12)
eq('and clamped to what the Act allows', makeEntity({ name: 'X', bonusRate: 50 }).bonus_rate, MAX_RATE)
eq('and lifted to the minimum', makeEntity({ name: 'X', bonusRate: 1 }).bonus_rate, MIN_RATE)
eq('a minimum wage is kept', makeEntity({ name: 'X', minimumWage: 14000 }).minimum_wage, 14000)
const cfg = configForEntity(makeEntity({ name: 'X', bonusRate: 12, minimumWage: 14000, bonusVoluntary: true }))
eq('the config carries the rate', cfg.bonus.rate, 12)
eq('the minimum wage', cfg.bonus.minimumWage, 14000)
eq('and the voluntary flag', cfg.bonus.voluntary, true)
eq('while a plain company carries no rate', configForEntity(plain).bonus.rate, null)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
