// Professional tax, which is twenty-two different taxes wearing one name.
//
// This app had one set of slabs — Maharashtra's — switched on by default, and
// no screen could change them. A company in Delhi, which levies no professional
// tax whatsoever, had ₹200 a month taken off every payslip. It is the same
// defect as deducting provident fund from a company that never registered for
// it, one layer down: an answer invented on the user's behalf and then hidden
// inside a total.
//
// Three things make this harder than a slab lookup, and each has its own
// section below:
//
//   **The states disagree about everything** except the ₹2,500 a year that
//   Article 276 caps them at. Different slabs, measured against a month's pay
//   in Maharashtra and a year's in Bihar, collected monthly in most places and
//   twice a year in Tamil Nadu and Kerala.
//
//   **A zero has four meanings** — no state named, a state that levies none, a
//   state whose slabs are not built in, and a person under the threshold. A
//   payslip carrying only the number has thrown away which, and three of those
//   four are somebody's problem.
//
//   **The tax follows the work**, not the head office, which for a builder with
//   a site over a state line is the ordinary case.
import {
  STATES, STATE_CODES, STATES_BY_NAME, ANNUAL_CAP, AS_OF, ptaxFor, ptaxYear, spread,
  taxYearMonth, stateFromGstin, workStateOf, annualMaximum, describeState,
} from '../../src/lib/ptax.js'
import { makeEmployee, runPayroll, payslipFor, configForEntity, professionalTax, DEFAULT_PAYROLL_CONFIG, ptaxSummary } from '../../src/lib/payroll.js'
import { makeEntity } from '../../src/lib/corporate.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, got, want) => ok(n, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const LEVYING = STATE_CODES.filter((c) => STATES[c].levies && STATES[c].known)
const at = (state, gross, period = '2026-06', female = false) => ptaxFor({ state, monthlyGross: gross, period, female })

console.log('\n── THE CONSTITUTION IS THE ONE THING EVERY STATE AGREES ON ──')
// Article 276(2) caps professional tax at ₹2,500 a year per person, and no
// state may exceed it. That makes it a property of the table rather than a
// number to clamp at the end: a state whose slabs add up past it has been typed
// in wrong, and this is the assertion that catches the typo.
for (const c of LEVYING) {
  const max = annualMaximum(c)
  ok(`${STATES[c].name} stays inside the cap`, max <= ANNUAL_CAP, `${max} > ${ANNUAL_CAP}`)
}
// The control. Without it the loop above would pass just as happily on a table
// where every state charged nothing.
ok('and the cap is not passing because nobody charges anything',
  LEVYING.filter((c) => annualMaximum(c) >= 2000).length >= 10,
  String(LEVYING.filter((c) => annualMaximum(c) >= 2000).length))
// Four states use their odd month to reach the cap exactly. Getting to ₹2,500
// and not a rupee over is the whole reason February is ₹300 in Maharashtra.
eq('Maharashtra collects the maximum exactly', annualMaximum('27'), 2500)
eq('so do Odisha', annualMaximum('21'), 2500)
eq('and Madhya Pradesh', annualMaximum('23'), 2500)

console.log('\n── A YEAR OF DEDUCTIONS ADDS UP TO THE YEAR ──')
// The invariant that matters for a state collecting twice a year or once a
// year: the months have to sum to the liability exactly. A rupee of rounding
// per month is twelve rupees the company either overcharged its staff or owes
// the state, every year, silently.
for (const c of LEVYING) {
  const year = ptaxYear({ state: c, monthlyGross: 42000, female: false })
  const st = STATES[c]
  const expect = st.every === 'month'
    ? year.months.reduce((t, m) => t + m.amount, 0)  // monthly states are their own answer
    : st.every === 'year' ? pickSlab(st, 42000 * 12) : pickSlab(st, 42000 * 6) * 2
  eq(`${st.name}: twelve months come to the year's liability`, year.total, expect)
}
function pickSlab(st, income) {
  return (st.slabs.find((s) => income <= s.upTo) || st.slabs[st.slabs.length - 1]).amount
}
// Spread on its own, because the remainder rule is where this would go wrong.
eq('a half-yearly ₹1,250 is ₹208 for five months', spread(1250, 6, 0), 208)
eq('and ₹210 in the sixth, not ₹208', spread(1250, 6, 5), 210)
eq('six of them are exactly ₹1,250', [0, 1, 2, 3, 4, 5].reduce((t, i) => t + spread(1250, 6, i), 0), 1250)
// The remainder goes in one place rather than being scattered a rupee at a
// time, so eleven months of a year are identical and one is not.
eq('an annual ₹2,000 is ₹166 for eleven months', spread(2000, 12, 3), 166)
eq('and ₹174 in the twelfth', spread(2000, 12, 11), 174)

console.log('\n── A ZERO MEANS FOUR DIFFERENT THINGS ──')
// This is the section the whole module exists for. All four of these deduct
// nothing, and a payslip that cannot tell them apart is lying about three.
const nobody = at('', 42000)
eq('nobody has said which state: nothing is deducted', nobody.amount, 0)
ok('and it says so', nobody.unanswered === true, JSON.stringify(nobody))
const delhi = at('07', 42000)
eq('Delhi levies none: nothing is deducted', delhi.amount, 0)
ok('and that is a different sentence', delhi.none === true && !delhi.unanswered, delhi.why)
ok('which names the state', /Delhi/.test(delhi.why), delhi.why)
const raipur = at('22', 42000)
eq('Chhattisgarh levies it but the slabs are not built in', raipur.amount, 0)
ok('and that is a third sentence', raipur.needsSlabs === true && !raipur.none, raipur.why)
// The one that costs money. Nothing is coming off and something is owed.
ok('which says money is owed', /levies professional tax/.test(raipur.why), raipur.why)
const poor = at('27', 5000)
eq('under the threshold: nothing is due', poor.amount, 0)
ok('and nothing is wrong', !poor.unanswered && !poor.none && !poor.needsSlabs, JSON.stringify(poor))
// A code that is not a state at all, which is what a typo produces.
const junk = at('99', 42000)
eq('a code that is not a state deducts nothing', junk.amount, 0)
ok('and says it does not know it', junk.unknownState === true, JSON.stringify(junk))

console.log('\n── EACH STATE CHARGES WHAT IT CHARGES ──')
// Slabs on a month's pay.
eq('Maharashtra, middle slab', at('27', 9000).amount, 175)
eq('Maharashtra, top slab', at('27', 42000).amount, 200)
eq('Maharashtra, February', at('27', 42000, '2026-02').amount, 300)
eq('but February is not higher where nothing is due', at('27', 5000, '2026-02').amount, 0)
eq('Karnataka, under its threshold', at('29', 24999).amount, 0)
eq('Karnataka, at it', at('29', 25000).amount, 200)
eq('West Bengal, third of five slabs', at('19', 20000).amount, 130)
eq('Andhra Pradesh', at('37', 18000).amount, 150)
eq('Telangana charges the same', at('36', 18000).amount, 150)
eq('Gujarat, one threshold', at('24', 12000).amount, 0)
eq('Gujarat, over it', at('24', 12001).amount, 200)
eq('Assam, top slab', at('18', 30000).amount, 208)
// Slabs on a year's pay, deducted monthly.
eq('Madhya Pradesh reads the year and charges the month', at('23', 40000).amount, 208)
eq('and charges more in March', at('23', 40000, '2026-03').amount, 212)
// ₹30,000 a month is ₹3.6 lakh a year, which is MP's middle band and not its
// top one — the slab is read against the year even though the money comes off
// the month, and that is the whole difference between MP and Maharashtra.
eq('and reads the year, not the month, to decide which band', at('23', 30000).amount, 166)
eq('Odisha likewise', at('21', 30000).amount, 200)
eq('with ₹300 in March', at('21', 30000, '2026-03').amount, 300)
// The Punjab levy is on income-tax assessability, not on gross, so the
// threshold here stands in for the basic exemption limit. A flat ₹200 took it
// off a labourer on ₹8,000 a month who owes no income tax at all.
eq('Punjab does not charge a man under the income-tax limit', at('03', 8000).amount, 0)
eq('and does charge one above it', at('03', 42000).amount, 200)
ok('and says the test is really his whole income', /assessable to income tax/.test(STATES['03'].caveat), STATES['03'].caveat)

console.log('\n── COLLECTED TWICE A YEAR, PAID TWELVE TIMES ──')
// Tamil Nadu and Kerala slab on six months' pay and collect twice a year. A
// payslip still has to carry a share, and the shares still have to add up.
const tn = at('33', 42000)
eq('Tamil Nadu reads six months of pay', tn.periodTotal, 1250)
eq('and puts a share on the month', tn.amount, 208)
eq('collected half-yearly', tn.collected, 'half-year')
eq('Kerala, a lower earner', at('32', 4000).periodTotal, 180)
// Bihar and Jharkhand slab on the year and collect once.
eq('Bihar reads the year', at('10', 42000).periodTotal, 2000)
eq('and puts a twelfth on the month', at('10', 42000).amount, 166)
eq('Jharkhand has its own bands', at('20', 42000).periodTotal, 1800)
// Somebody under every threshold pays nothing anywhere, which is the control
// for the whole section — a spread of zero must stay zero and not become a
// rupee of rounding.
//
// ₹1,900 and not a round ₹3,000, because Kerala's nil band is ₹11,999 over six
// months: about ₹2,000 a month, the lowest threshold in the country by a wide
// margin and low enough that a ₹3,000-a-month man does owe Kerala ₹180 a half
// year. That surprise is the reason this line is a loop over every state rather
// than a spot check on Maharashtra.
for (const c of LEVYING) eq(`${STATES[c].name} charges a ₹1,900 man nothing`, at(c, 1900).amount, 0)
// And the control for the control: Kerala really does charge just above it.
eq('while Kerala charges a ₹3,000 man', at('32', 3000).amount, 30)
eq('which is ₹180 over the half year', at('32', 3000).periodTotal, 180)

console.log('\n── THE TAX FOLLOWS THE WORK ──')
// For a builder this is the ordinary case, not the exception: a Mumbai company
// with a site in Bengaluru owes Karnataka for the men on that site.
const mumbai = makeEntity({ name: 'Navi Builders', gstin: '27AAAPA1234A1Z5' })
eq('a GSTIN already says which state the company is in', stateFromGstin(mumbai.gstin), '27')
eq('and a blank one says nothing', stateFromGstin(''), '')
eq('as does a GSTIN opening on a code that is not a state', stateFromGstin('99AAAPA1234A1Z5'), '')
eq('the company answers for somebody with no state of their own',
  workStateOf(makeEmployee({ entityId: 'e1', name: 'A' }), mumbai), '27')
eq('but the employee’s own state wins',
  workStateOf(makeEmployee({ entityId: 'e1', name: 'B', workState: '29' }), mumbai), '29')
eq('and a chosen state beats the GSTIN',
  workStateOf(makeEmployee({ entityId: 'e1', name: 'C' }), { ...mumbai, pt_state: '24' }), '24')
// A state code that is not a state is not kept, or it would sit on the row
// looking like an answer.
eq('a junk work state is not stored', makeEmployee({ entityId: 'e1', name: 'D', workState: '99' }).work_state, '')

console.log('\n── ONE PAYROLL, THREE STATES ──')
const cfg = configForEntity(mumbai)
eq('the config takes the state off the GSTIN', cfg.professionalTax.state, '27')
const staff = [
  makeEmployee({ entityId: 'e1', id: 'a', name: 'Mumbai', basic: 30000, hra: 12000, female: false }),
  makeEmployee({ entityId: 'e1', id: 'd', name: 'Bengaluru', basic: 30000, hra: 12000, workState: '29', female: false }),
  makeEmployee({ entityId: 'e1', id: 'e', name: 'Delhi', basic: 30000, hra: 12000, workState: '07', female: false }),
  makeEmployee({ entityId: 'e1', id: 'f', name: 'Raipur', basic: 30000, hra: 12000, workState: '22', female: false }),
]
const run = runPayroll(staff, { period: '2026-06', config: cfg })
const slipOf = (id) => run.slips.find((s) => s.employee_id === id)
eq('the Mumbai man pays Maharashtra', slipOf('a').deductions.professionalTax, 200)
eq('the Bengaluru man pays Karnataka', slipOf('d').deductions.professionalTax, 200)
eq('the Delhi man pays nothing, because Delhi charges nothing', slipOf('e').deductions.professionalTax, 0)
eq('and the Raipur man pays nothing because nobody entered the slabs', slipOf('f').deductions.professionalTax, 0)
// The two zeroes are not the same zero, and the run knows which is which.
ok('the Delhi zero is not flagged', slipOf('e').ptax.none && !slipOf('e').ptax.needsSlabs)
ok('the Raipur zero is', slipOf('f').ptax.needsSlabs === true)
eq('the run counts the state that needs slabs', run.ptax.needsSlabs, 1)
eq('and lists every state it paid', run.ptax.states.length, 4)
eq('with the total', run.ptax.total, 400)
// The whole point of the change, stated as one number: this company used to
// pay Maharashtra's tax on all four.
const oldWay = staff.length * 200
ok('which is not what one set of slabs for everybody would have said', run.ptax.total !== oldWay,
  `${run.ptax.total} vs ${oldWay}`)

console.log('\n── THE EXEMPTION NOBODY CLAIMS ──')
// Maharashtra exempts women drawing up to ₹25,000 a month — ₹2,400 a year to
// somebody on a site wage. Three-valued for the same reason registration is:
// nobody having recorded it is not the same as everybody being a man.
eq('a woman under the ceiling pays nothing', at('27', 20000, '2026-06', true).amount, 0)
eq('a woman over it pays', at('27', 30000, '2026-06', true).amount, 200)
eq('a man under it pays', at('27', 20000, '2026-06', false).amount, 200)
const unsaid = ptaxFor({ state: '27', monthlyGross: 20000, period: '2026-06', female: null })
eq('and somebody whose sex nobody recorded is deducted from meanwhile', unsaid.amount, 200)
ok('but flagged, rather than quietly charged', unsaid.mayBeExempt === true, JSON.stringify(unsaid))
// The sentence has to carry both halves or it explains a figure it did not
// produce: this said only "Maharashtra exempts women" above a ₹200 deduction.
ok('and the reason says what was charged as well as what might not be owed',
  /falls in the ₹200/.test(unsaid.why) && /not recorded/.test(unsaid.why), unsaid.why)
eq('nowhere else asks', STATES['29'].women, undefined)
eq('so a Karnataka woman is charged like anyone else', at('29', 30000, '2026-06', true).amount, 200)
// Recorded either way, the flag goes.
ok('recording it clears the flag', !ptaxFor({ state: '27', monthlyGross: 20000, female: true }).mayBeExempt)
// And a run counts them, because one unrecorded field is a shrug and forty is
// a job somebody has to do.
const mixed = runPayroll([
  makeEmployee({ entityId: 'e1', id: 'w', name: 'W', basic: 14000, hra: 6000 }),
  makeEmployee({ entityId: 'e1', id: 'x', name: 'X', basic: 14000, hra: 6000, female: true }),
  makeEmployee({ entityId: 'e1', id: 'y', name: 'Y', basic: 14000, hra: 6000, female: false }),
], { period: '2026-06', config: cfg })
eq('the run counts who might be exempt', mixed.ptax.mayBeExempt, 1)
eq('and who is', mixed.ptax.exempt, 1)

console.log('\n── A COMPANY’S OWN SLABS BEAT THE TABLE ──')
// Because states revise these in their budgets and a slab that moved last
// April is a wrong payslip every month until somebody notices.
const own = { slabs: [{ upTo: 10000, amount: 0 }, { upTo: Infinity, amount: 250 }] }
eq('the company’s slabs are used', ptaxFor({ state: '27', monthlyGross: 42000, period: '2026-06', female: false, override: own }).amount, 250)
eq('and they reach a state the table does not carry',
  ptaxFor({ state: '22', monthlyGross: 42000, period: '2026-06', female: false, override: own }).amount, 250)
// Without them that same state deducts nothing, which is the control.
eq('which without them deducts nothing', at('22', 42000).amount, 0)
eq('an entity carrying slabs passes them through',
  configForEntity({ ...mumbai, pt_slabs: own.slabs }).professionalTax.slabs.length, 2)

console.log('\n── AND THERE IS NO LONGER A DEFAULT ──')
// The defect this replaces, asserted directly.
eq('the library ships no slabs at all', DEFAULT_PAYROLL_CONFIG.professionalTax.slabs, null)
eq('and no state', DEFAULT_PAYROLL_CONFIG.professionalTax.state, null)
eq('so slabs nobody gave deduct nothing', professionalTax(42000, 6), 0)
// A payslip run with the bare default deducts no professional tax from anyone,
// where it used to deduct Maharashtra's from everyone.
const bare = payslipFor(makeEmployee({ entityId: 'e1', name: 'Z', basic: 30000, hra: 12000 }), { period: '2026-06' })
eq('and a payslip with no config deducts none', bare.deductions.professionalTax, 0)
ok('saying why', bare.ptax.unanswered === true, JSON.stringify(bare.ptax))

console.log('\n── THE TABLE ITSELF ──')
eq('every state code is two digits', STATE_CODES.filter((c) => /^\d{2}$/.test(c)).length, STATE_CODES.length)
ok('every state has a name', STATE_CODES.every((c) => STATES[c].name), '')
ok('a levying state either has slabs or admits it does not',
  STATE_CODES.every((c) => !STATES[c].levies || (STATES[c].known ? STATES[c].slabs?.length > 0 : !STATES[c].slabs)), '')
ok('a state that levies nothing carries no slabs',
  STATE_CODES.every((c) => STATES[c].levies || !STATES[c].slabs), '')
// Slabs have to be in order or the lookup returns the wrong one, and it would
// return it silently.
ok('every slab table is in ascending order',
  LEVYING.every((c) => STATES[c].slabs.every((s, i, a) => i === 0 || s.upTo > a[i - 1].upTo)), '')
ok('and ends at infinity, so a lookup always lands',
  LEVYING.every((c) => STATES[c].slabs[STATES[c].slabs.length - 1].upTo === Infinity), '')
eq('fourteen states and union territories levy none', STATE_CODES.filter((c) => !STATES[c].levies).length, 14)
eq('eight levy it with slabs still to enter', STATE_CODES.filter((c) => STATES[c].levies && !STATES[c].known).length, 8)
eq('and fourteen are built in', LEVYING.length, 14)
ok('the picker puts levying states first', STATES_BY_NAME[0].levies === true && STATES_BY_NAME[STATES_BY_NAME.length - 1].levies === false, '')
// The slabs are a starting point and not a source of law, and the app has to be
// able to say when it last looked.
ok('the table says when it was stated', /^\d{4}-\d{2}-\d{2}$/.test(AS_OF), AS_OF)
ok('a state describes itself in a sentence', /Maharashtra/.test(describeState('27')), describeState('27'))
ok('including one that charges nothing', /no professional tax/i.test(describeState('07')), describeState('07'))
ok('and one whose slabs are missing', /not built in/i.test(describeState('22')), describeState('22'))

console.log('\n── WHICH MONTH OF WHOSE YEAR ──')
// A state's professional-tax year runs April to March whatever the company's
// own books do, so this counts from April and not from the company's FY start.
eq('April is the first month of the tax year', taxYearMonth('2026-04'), 0)
eq('March is the last', taxYearMonth('2027-03'), 11)
eq('and February is the eleventh', taxYearMonth('2027-02'), 10)

console.log('\n── AND A SUMMARY OF NOTHING IS STILL A SUMMARY ──')
const empty = ptaxSummary([])
eq('an empty run totals nothing', empty.total, 0)
eq('names no states', empty.states.length, 0)
eq('and flags nothing', empty.needsSlabs + empty.unanswered + empty.mayBeExempt, 0)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
