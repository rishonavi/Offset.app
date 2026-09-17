// Whether a company runs these schemes at all.
//
// Provident fund and state insurance both defaulted to ON, and nothing in the
// app could turn them off — no screen passed a config, so every company got the
// default. A builder with four men and no registration had twelve per cent
// taken off every payslip, and the only way to stop it was to edit the source.
//
// Two separate questions were being answered as one, and both were being
// answered wrongly:
//
//   **Is the company registered?** Three answers, not two. "Nobody has said" is
//   different from "no": a payslip that quietly deducts nothing because a
//   question was never asked is as wrong as one that deducts because a default
//   said true.
//
//   **Is it over the threshold?** State insurance bites at ten employees in
//   most states, provident fund at twenty. A company can be registered and
//   under the threshold — voluntary registration is common — or over it and not
//   registered, which is not a payroll setting but a compliance problem, and
//   the app knows the headcount so it is the thing placed to notice.
//
// And a third, per person rather than per company: state insurance covers only
// employees drawing up to the gross ceiling, whatever the company's status.
import {
  DEFAULT_PAYROLL_CONFIG, SCHEMES, SCHEME_IDS, schemeStatus, statutoryStatus, resolveConfig,
  configForEntity, providentFund, stateInsurance, payslipFor, runPayroll, makeEmployee,
} from '../../src/lib/payroll.js'
import { makeEntity } from '../../src/lib/corporate.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, got, want) => ok(n, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const config = (pf, esi) => ({
  ...DEFAULT_PAYROLL_CONFIG,
  pf: { ...DEFAULT_PAYROLL_CONFIG.pf, registered: pf },
  esi: { ...DEFAULT_PAYROLL_CONFIG.esi, registered: esi },
})
const staff = (n, over = {}) => Array.from({ length: n }, (_, i) =>
  makeEmployee({ entityId: 'e1', id: `p${i}`, name: `P${i}`, basic: 12000, hra: 4000, ...over }))

console.log('\n── NOTHING RUNS UNTIL SOMEBODY SAYS ──')
// The whole point. This used to be true by default and could not be made false.
eq('the provident fund is unanswered out of the box', DEFAULT_PAYROLL_CONFIG.pf.registered, null)
eq('and so is state insurance', DEFAULT_PAYROLL_CONFIG.esi.registered, null)
eq('an unanswered fund deducts nothing', providentFund(20000, DEFAULT_PAYROLL_CONFIG.pf).employee, 0)
eq('nor does unanswered insurance', stateInsurance(16000, DEFAULT_PAYROLL_CONFIG.esi).employee, 0)
// And the control beside it: saying yes turns it on.
eq('a registered fund deducts', providentFund(20000, config(true).pf).employee, 1800)
eq('and registered insurance deducts', stateInsurance(16000, config(null, true).esi).employee, 120)
// "No" is a real answer too, and it is not the same as silence.
eq('an explicit no deducts nothing', providentFund(20000, config(false).pf).employee, 0)

console.log('\n── THE TWO THRESHOLDS ──')
eq('state insurance bites at ten', SCHEMES.esi.threshold, 10)
eq('provident fund at twenty', SCHEMES.pf.threshold, 20)
eq('there are two schemes', SCHEME_IDS.join(','), 'pf,esi')
ok('and each names the Act it comes from', SCHEME_IDS.every((id) => SCHEMES[id].act))
// The state variation is real, so the number is a setting rather than a
// comparison written into the code.
eq('a state that bites at twenty can say so',
  schemeStatus('esi', { headcount: 12, config: { esi: { registered: false, threshold: 20 } } }).mustRegister, false)
eq('where the default would have called it required',
  schemeStatus('esi', { headcount: 12, config: config(null, false) }).mustRegister, true)

console.log('\n── FOUR MEN AND NO REGISTRATION ──')
const small = statutoryStatus({ headcount: 4, config: DEFAULT_PAYROLL_CONFIG })
eq('nothing runs', small.pf.runs || small.esi.runs, false)
eq('both are unanswered', small.unanswered.join(','), 'pf,esi')
// Under the threshold and unanswered is a question, not a breach.
eq('and neither has to be registered', small.mustRegister.length, 0)
ok('the reason says nothing is being deducted', /nothing is being deducted/.test(small.pf.why), small.pf.why)

console.log('\n── TWELVE, AND STILL NOBODY HAS SAID ──')
const dozen = statutoryStatus({ headcount: 12, config: DEFAULT_PAYROLL_CONFIG })
eq('state insurance is now required', dozen.mustRegister.join(','), 'esi')
// Twelve is over the insurance threshold and under the fund's.
eq('the provident fund is not', dozen.pf.mustRegister, false)
ok('and the reason names the Act and the headcount',
  /at 12 employees ESI Act requires it/.test(dozen.esi.why), dozen.esi.why)
// Required is not the same as running. The app cannot register anybody.
eq('being required does not start deducting', dozen.esi.runs, false)

console.log('\n── AND TWELVE WITH IT SAID ──')
const said = statutoryStatus({ headcount: 12, config: config(false, true) })
eq('insurance runs', said.esi.runs, true)
ok('because it is registered and required', /Registered, and at 12 employees it is required/.test(said.esi.why), said.esi.why)
eq('the fund does not', said.pf.runs, false)
eq('and is not required at twelve', said.pf.mustRegister, false)
ok('which the reason says', /under 20 employees it is not required/.test(said.pf.why), said.pf.why)
eq('nothing is unanswered any more', said.unanswered.length, 0)

console.log('\n── REGISTERED AND UNDER THE THRESHOLD ──')
// Voluntary registration is common and is not an error.
const voluntary = statutoryStatus({ headcount: 6, config: config(true, true) })
eq('both run', voluntary.pf.runs && voluntary.esi.runs, true)
eq('neither is flagged', voluntary.mustRegister.length, 0)
ok('and it says the registration was voluntary',
  /Registered voluntarily/.test(voluntary.pf.why), voluntary.pf.why)

console.log('\n── OVER THE THRESHOLD AND SAYING NO ──')
const refusing = statutoryStatus({ headcount: 25, config: config(false, false) })
eq('both are required', refusing.mustRegister.join(','), 'pf,esi')
eq('and neither runs', refusing.pf.runs || refusing.esi.runs, false)
ok('the fund reason names the Act', /EPF & MP Act requires it/.test(refusing.pf.why), refusing.pf.why)

console.log('\n── A PAYROLL RUN ──')
const twelve = runPayroll(staff(12), { period: '2026-06' })
eq('twelve are employed', twelve.employed, 12)
eq('and nothing statutory is deducted', twelve.statutory.pf + twelve.statutory.esi, 0)
eq('the run says what was never answered', twelve.unanswered.join(','), 'pf,esi')
eq('and what the headcount requires', twelve.mustRegister.join(','), 'esi')
const running = runPayroll(staff(12), { period: '2026-06', config: config(true, true) })
ok('a registered company deducts the fund', running.statutory.pf > 0, String(running.statutory.pf))
ok('and the insurance', running.statutory.esi > 0, String(running.statutory.esi))
eq('with nothing left unanswered', running.unanswered.length, 0)
// The run carries why, so a slip can be explained months later without
// re-deriving it from a headcount that has since changed.
eq('the run remembers what applied', running.schemes.esi.runs, true)
eq('and the config it settled on', running.config.esi.enabled, true)

console.log('\n── AND SOMEBODY WHO HAS NOT STARTED IS NOT EMPLOYED ──')
// The headcount is this month's, which is the set that gets slips. Counting
// everybody on the books instead would put a company over a threshold a month
// before it got there.
const joining = [
  ...staff(9),
  makeEmployee({ entityId: 'e1', id: 'late', name: 'Joins in July', basic: 12000, joinedOn: '2026-07-01' }),
]
const june = runPayroll(joining, { period: '2026-06' })
eq('nine are on June\u2019s payroll', june.employed, 9)
eq('so state insurance is not required yet', june.mustRegister.length, 0)
const july = runPayroll(joining, { period: '2026-07' })
eq('ten are on July\u2019s', july.employed, 10)
eq('and then it is', july.mustRegister.join(','), 'esi')

console.log('\n── THE PER-PERSON HALF, WHICH NO HEADCOUNT DECIDES ──')
// State insurance covers only those up to the gross ceiling, whatever the
// company's status. One man over it drops out and the rest stay in.
const mixed = [...staff(11), makeEmployee({ entityId: 'e1', id: 'boss', name: 'Boss', basic: 30000, hra: 10000 })]
const run = runPayroll(mixed, { period: '2026-06', config: config(true, true) })
eq('eleven of twelve are covered', run.slips.filter((s) => s.esiApplicable).length, 11)
eq('the twelfth is not', run.slips.find((s) => s.employee_id === 'boss').esiApplicable, false)
eq('and has nothing deducted for it', run.slips.find((s) => s.employee_id === 'boss').deductions.esi, 0)
// He is on the payroll whether or not the insurance covers him, so he counts
// towards the threshold that decides whether it applies at all.
eq('though he still counts towards the headcount', run.employed, 12)

console.log('\n── WHAT THE COMPANY REMEMBERS ──')
eq('a new company has said nothing about the fund', makeEntity({ name: 'X' }).pf_registered, null)
eq('nor about insurance', makeEntity({ name: 'X' }).esi_registered, null)
eq('yes is kept', makeEntity({ name: 'X', pfRegistered: true }).pf_registered, true)
eq('no is kept, and is not the same as silence', makeEntity({ name: 'X', pfRegistered: false }).pf_registered, false)
eq('and anything else is silence', makeEntity({ name: 'X', pfRegistered: 'maybe' }).pf_registered, null)

console.log('\n── AND THE OLDER SPELLING STILL MEANS WHAT IT SAID ──')
// A config written by hand before this used `enabled`. Ignoring it would turn
// somebody's deliberate setting into a default.
eq('an explicitly enabled scheme runs', providentFund(20000, { ...DEFAULT_PAYROLL_CONFIG.pf, enabled: true }).employee, 1800)
eq('and an explicitly disabled one does not', providentFund(20000, { ...DEFAULT_PAYROLL_CONFIG.pf, enabled: false }).employee, 0)
eq('the status layer reads it too', schemeStatus('pf', { headcount: 4, config: { pf: { enabled: true } } }).runs, true)
// Resolving turns the company's answer into the switch the arithmetic reads.
eq('resolving an unanswered scheme switches it off', resolveConfig(DEFAULT_PAYROLL_CONFIG, 30).pf.enabled, false)
eq('and a registered one on', resolveConfig(config(true, true), 30).pf.enabled, true)

console.log('\n── THE ANSWER IS ON THE COMPANY, AND EVERY SCREEN READS IT THE SAME WAY ──')
// Three screens need the company's answers as a config — the payroll tab, the
// report and the attention list — and each built it inline. The report forgot,
// so a company that had said yes saw the deduction on its payslips and a cost
// to company in its report that did not include the employer's half.
const answered = makeEntity({ name: 'X', pfRegistered: true, esiRegistered: false })
eq('yes on the company reaches the config', configForEntity(answered).pf.registered, true)
eq('and no does too', configForEntity(answered).esi.registered, false)
eq('silence stays silence', configForEntity(makeEntity({ name: 'X' })).pf.registered, null)
// A company that does not exist is not a company that said no.
eq('and no company at all is silence, not a no', configForEntity(null).pf.registered, null)
eq('and not a yes either', configForEntity(undefined).esi.registered, null)
// The rest of the config has to survive being rebuilt, or every rate in it
// silently reverts to the library default the moment somebody answers.
eq('the rates come through untouched', configForEntity(answered).pf.wageCeiling, 15000)
// Professional tax is not one of the two schemes and travels in the same
// config, so it has to survive being rebuilt alongside them.
eq('and so does everything that is not a scheme', configForEntity({ ...answered, gstin: '27AAAPA1234A1Z5' }).professionalTax.state, '27')
// The thing the report was getting wrong, at the layer it was wrong at.
const four = staff(4)
const withPf = runPayroll(four, { period: '2026-06', config: configForEntity(answered) })
const without = runPayroll(four, { period: '2026-06', config: configForEntity(makeEntity({ name: 'X' })) })
eq('a registered company costs the employer share', withPf.employerCost - without.employerCost, 4 * 1440)
eq('and an unanswered one costs exactly the wage bill', without.employerCost, without.gross)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
