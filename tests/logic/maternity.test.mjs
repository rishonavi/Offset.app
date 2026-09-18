// Maternity benefit, and the question that decides who writes the cheque.
//
// The Act gives twenty-six weeks of paid leave for a first or second child in
// an establishment of ten or more. But an employer covered by state insurance
// usually pays none of it: where ESI reaches the woman — the company
// registered, and her gross inside the ceiling — ESIC pays and the employer
// pays nothing. The liability is for the women ESI does not reach.
//
// That is a question this app is unusually placed to answer, because it already
// knows both halves, and getting it wrong is expensive in both directions: a
// company that budgets for leave ESI is paying wastes the money, and one that
// assumes ESI covers everybody finds out when a manager goes on leave and
// nothing arrives.
//
// The second trap is that this Act means something different by wages. Gratuity
// and bonus are on basic plus dearness allowance; section 3(n) here is all cash
// remuneration including house rent allowance. Reading it off basic plus DA
// understates the benefit by the whole of somebody's HRA — and, worse, puts a
// woman on ₹15,000 basic and ₹8,000 HRA inside the ESI ceiling when her gross
// of ₹23,000 is outside it, which is the wrong answer to the only question
// this module exists to settle.
import {
  maternityStatus, maternityFor, whoPays, maternityExposure,
  ENTITLEMENT, ENTITLEMENT_IDS, THRESHOLD, QUALIFYING_DAYS, CRECHE_THRESHOLD,
  MEDICAL_BONUS, MAX_PRENATAL_WEEKS, NURSING_MONTHS, ILLNESS_WEEKS, ACT,
} from '../../src/lib/maternity.js'
import { makeEmployee, grossOf, wagesOf, DEFAULT_PAYROLL_CONFIG } from '../../src/lib/payroll.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, got, want) => ok(n, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const ESI_ON = { ...DEFAULT_PAYROLL_CONFIG.esi, registered: true }
const ESI_OFF = { ...DEFAULT_PAYROLL_CONFIG.esi, registered: false }
const woman = (id, pay, over = {}) => ({
  ...makeEmployee({ entityId: 'e1', id, name: id, joinedOn: '2020-01-01', ...pay, ...over }), female: true,
})
const DATE = '2027-03-01'

console.log('\n── WHO PAYS ──')
// The whole module in four lines.
const clerk = woman('clerk', { basic: 12000, da: 3000 })
const manager = woman('manager', { basic: 40000, da: 5000 })
eq('a woman inside the ceiling is paid by ESIC', whoPays(clerk, { esi: ESI_ON }).payer, 'esic')
eq('one above it is paid by the employer', whoPays(manager, { esi: ESI_ON }).payer, 'employer')
// And where the company never registered, ESI reaches nobody.
eq('and where the company never registered, the employer pays for everyone', whoPays(clerk, { esi: ESI_OFF }).payer, 'employer')
ok('each says why', [clerk, manager].every((e) => whoPays(e, { esi: ESI_ON }).why.length > 20), '')
ok('and the two reasons are different', whoPays(clerk, { esi: ESI_ON }).why !== whoPays(manager, { esi: ESI_ON }).why, '')
// The boundary, which is where a payroll actually sits.
eq('exactly at the ceiling is covered', whoPays(woman('x', { basic: 21000 }), { esi: ESI_ON }).payer, 'esic')
eq('a rupee over is not', whoPays(woman('y', { basic: 21001 }), { esi: ESI_ON }).payer, 'employer')
// The legacy spelling of the ESI config still means what it said.
eq('an explicitly enabled scheme counts as registered', whoPays(clerk, { esi: { ...ESI_ON, registered: undefined, enabled: true } }).payer, 'esic')

console.log('\n── AND WHAT IT IS ON, WHICH IS NOT WHAT GRATUITY IS ON ──')
// Section 3(n): all cash remuneration, house rent allowance included.
const hra = woman('hra', { basic: 15000, hra: 8000 })
eq('basic and DA is fifteen thousand', wagesOf(hra), 15000)
eq('but gross is twenty-three', grossOf(hra), 23000)
// Which is the difference between ESI covering her and not.
eq('so ESI does not reach her', whoPays(hra, { esi: ESI_ON }).payer, 'employer')
ok('though basic and DA alone would have said it did', wagesOf(hra) <= 21000, '')
// And the benefit is on the larger figure.
const onGross = maternityFor(hra, { kind: 'first', expectedOn: DATE, esi: ESI_ON, daysWorked: 200 })
eq('the daily wage is gross over thirty', onGross.perDay, round2(23000 / 30))
ok('which is more than basic and DA would give', onGross.perDay > 15000 / 30, String(onGross.perDay))
function round2(n) { return Math.round(n * 100) / 100 }

console.log('\n── TWENTY-SIX WEEKS, AND THE OTHER FIVE CASES ──')
eq('a first or second child is twenty-six weeks', ENTITLEMENT.first.weeks, 26)
// The 2017 amendment tripled the first and left this one alone.
eq('a third is twelve', ENTITLEMENT.third.weeks, 12)
eq('adoption is twelve', ENTITLEMENT.adoption.weeks, 12)
eq('a commissioning mother twelve', ENTITLEMENT.commissioning.weeks, 12)
eq('a miscarriage six', ENTITLEMENT.miscarriage.weeks, 6)
eq('a tubectomy two', ENTITLEMENT.tubectomy.weeks, 2)
eq('six cases in all', ENTITLEMENT_IDS.length, 6)
ok('each with a note', ENTITLEMENT_IDS.every((id) => ENTITLEMENT[id].note), '')
// Illness arising out of it adds a month on top of any of them.
eq('illness adds four weeks', ILLNESS_WEEKS, 4)
eq('so twenty-six becomes thirty', maternityFor(manager, { kind: 'first', expectedOn: DATE, esi: ESI_ON, illness: true }).weeks, 30)
eq('and twelve becomes sixteen', maternityFor(manager, { kind: 'third', expectedOn: DATE, esi: ESI_ON, illness: true }).weeks, 16)

console.log('\n── THE DATES ──')
eq('at most eight weeks may be taken before', MAX_PRENATAL_WEEKS, 8)
const full = maternityFor(manager, { kind: 'first', expectedOn: DATE, esi: ESI_ON })
eq('eight weeks before the first of March is the fourth of January', full.from, '2027-01-04')
eq('and twenty-six weeks runs to the fourth of July', full.to, '2027-07-04')
eq('which is a hundred and eighty-two days', full.days, 182)
// Asking for more than eight weeks before does not get you more than eight.
eq('twelve weeks before is held to eight', maternityFor(manager, { kind: 'first', expectedOn: DATE, esi: ESI_ON, preNatalWeeks: 12 }).preNatalWeeks, 8)
eq('and taking none is allowed', maternityFor(manager, { kind: 'first', expectedOn: DATE, esi: ESI_ON, preNatalWeeks: 0 }).from, DATE)
// The cases that run from the day it happens rather than from a delivery date.
// There is nothing to take before the fact.
eq('adoption runs from the handover, not eight weeks earlier', maternityFor(manager, { kind: 'adoption', expectedOn: DATE, esi: ESI_ON }).from, DATE)
eq('so does a miscarriage', maternityFor(manager, { kind: 'miscarriage', expectedOn: DATE, esi: ESI_ON }).from, DATE)
eq('and a tubectomy', maternityFor(manager, { kind: 'tubectomy', expectedOn: DATE, esi: ESI_ON }).preNatalWeeks, 0)
eq('no expected date gives no dates at all', maternityFor(manager, { kind: 'first', esi: ESI_ON }).from, '')

console.log('\n── EIGHTY DAYS, WHICH IS A REAL TEST ON A SITE ──')
eq('the Act asks for eighty days in the year before', QUALIFYING_DAYS, 80)
const short = maternityFor(manager, { kind: 'first', expectedOn: DATE, esi: ESI_ON, daysWorked: 60 })
eq('sixty days does not qualify', short.qualifies, false)
// And a figure shown beside "does not qualify" is a figure somebody budgets for.
eq('so nothing is owed', short.employerCost, 0)
eq('and the benefit itself is nil', short.amount, 0)
ok('with the days counted in the reason', /60 days/.test(short.why), short.why)
eq('eighty qualifies', maternityFor(manager, { kind: 'first', expectedOn: DATE, esi: ESI_ON, daysWorked: 80 }).qualifies, true)
ok('and is owed', maternityFor(manager, { kind: 'first', expectedOn: DATE, esi: ESI_ON, daysWorked: 80 }).employerCost > 0, '')
// Nobody having counted is unknown, not disqualified — the same three-valued
// honesty as every other unfilled field here.
eq('nobody having counted is not a disqualification', maternityFor(manager, { kind: 'first', expectedOn: DATE, esi: ESI_ON }).qualifies, null)
ok('and it keeps its figure', maternityFor(manager, { kind: 'first', expectedOn: DATE, esi: ESI_ON }).employerCost > 0, '')

console.log('\n── WHAT IT COSTS THIS COMPANY ──')
// ESIC paying means the employer's cost is nil, not that the benefit is nil.
const covered = maternityFor(clerk, { kind: 'first', expectedOn: DATE, esi: ESI_ON, daysWorked: 200 })
ok('a covered woman still has a benefit', covered.amount > 0, String(covered.amount))
eq('but it costs the employer nothing', covered.employerCost, 0)
eq('and there is no medical bonus either, ESIC has its own', covered.medicalBonus, 0)
const uncovered = maternityFor(manager, { kind: 'first', expectedOn: DATE, esi: ESI_ON, daysWorked: 200 })
eq('an uncovered woman costs the employer the benefit', uncovered.employerCost, uncovered.amount + MEDICAL_BONUS)
eq('with the medical bonus on top', uncovered.medicalBonus, 3500)
// Unless the employer provides the care itself, which is the condition the Act
// actually puts on it.
eq('which goes where free pre-natal care is given',
  maternityFor(manager, { kind: 'first', expectedOn: DATE, esi: ESI_ON, daysWorked: 200, medicalCareProvided: true }).medicalBonus, 0)
ok('and the cost drops by exactly that',
  maternityFor(manager, { kind: 'first', expectedOn: DATE, esi: ESI_ON, daysWorked: 200, medicalCareProvided: true }).employerCost
  === uncovered.employerCost - MEDICAL_BONUS, '')

console.log('\n── WHETHER THE ACT APPLIES, AND WHAT ELSE COMES WITH THE HEADCOUNT ──')
eq('it bites at ten employees', THRESHOLD, 10)
eq('which is the same ten as state insurance and gratuity', maternityStatus({ headcount: 10 }).applies, true)
eq('nine is under it', maternityStatus({ headcount: 9 }).applies, false)
ok('the Act is named', maternityStatus({ headcount: 20 }).why.includes(ACT), '')
// A separate duty with a separate threshold, and one nobody hears about until
// an inspector asks.
eq('a creche is compulsory at fifty', CRECHE_THRESHOLD, 50)
eq('so forty-nine does not need one', maternityStatus({ headcount: 49 }).crecheRequired, false)
eq('and fifty does', maternityStatus({ headcount: 50 }).crecheRequired, true)
eq('with four visits a day', maternityStatus({ headcount: 50 }).crecheVisits, 4)
ok('and it is not the same threshold as the Act itself', CRECHE_THRESHOLD !== THRESHOLD, '')
eq('nursing breaks run to fifteen months', NURSING_MONTHS, 15)

console.log('\n── THE COMPANY’S EXPOSURE ──')
const payroll = [
  woman('w-low', { basic: 12000, da: 3000 }),
  woman('w-high', { basic: 40000, da: 5000 }),
  { ...makeEmployee({ entityId: 'e1', id: 'm1', name: 'Mason', basic: 9000 }), female: false },
  makeEmployee({ entityId: 'e1', id: 'u1', name: 'Unrecorded', basic: 15000 }),
  ...Array.from({ length: 8 }, (_, i) => ({ ...makeEmployee({ entityId: 'e1', id: `h${i}`, name: `Hand ${i}`, basic: 9000 }), female: false })),
]
const on = maternityExposure(payroll, { esi: ESI_ON })
eq('twelve on the books, so the Act applies', on.applies, true)
eq('two women', on.women, 2)
eq('ESIC would pay for one', on.esicPays, 1)
eq('and this company for the other', on.employerPays, 1)
ok('with a figure on it', on.exposure > 0, String(on.exposure))
// Somebody whose sex nobody recorded is counted separately rather than assumed
// to be a man, which is the same failure as every other unfilled field here.
eq('and one person whose sex nobody recorded', on.unrecorded, 1)
ok('who is in neither count', on.women + on.unrecorded <= on.people, '')
// The control that matters: registering for state insurance moves the cost.
const off = maternityExposure(payroll, { esi: ESI_OFF })
eq('without ESI the company pays for both', off.employerPays, 2)
eq('and ESIC for neither', off.esicPays, 0)
ok('which costs it more', off.exposure > on.exposure, `${off.exposure} vs ${on.exposure}`)
// Under ten the Act does not apply at all.
eq('a company of eight is outside it', maternityExposure(payroll.slice(0, 8), { esi: ESI_ON }).applies, false)
// Fifty brings the creche with it.
const big = maternityExposure([...payroll, ...Array.from({ length: 40 }, (_, i) =>
  ({ ...makeEmployee({ entityId: 'e1', id: `b${i}`, name: `B${i}`, basic: 9000 }), female: false }))], { esi: ESI_ON })
eq('fifty-two needs a creche', big.crecheRequired, true)
ok('while twelve does not', on.crecheRequired === false, '')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
