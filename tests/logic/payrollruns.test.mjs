// A month that was run, against a month worked out again.
//
// Everything else in payroll computes from the employees as they stand now.
// That is right for this month and wrong for every one before it: give somebody
// a raise in June and March silently becomes more expensive, because March was
// never a record — it was arithmetic on today's numbers wearing a date.
//
// So the assertions that matter are the ones where the roster changes after the
// fact: a raise, a leaver, a whole employee deleted. A recorded month must not
// move under any of them, and the ones that were never recorded must still say
// out loud that they are projections.
import {
  makePayrollRun, recordedRun, payrollForPeriod, payrollOverPeriods, runPayroll,
  canSetStatus, canRerun, isLocked, makeEmployee, RUN_STATUS, periodsBetween,
} from '../../src/lib/payroll.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

const E = 'e1'
const staff = [
  makeEmployee({ entityId: E, id: 'emp-1', name: 'R. Yadav', code: 'RY01', basic: 40000, hra: 16000, joinedOn: '2025-04-01' }),
  makeEmployee({ entityId: E, id: 'emp-2', name: 'S. Shaikh', code: 'SS02', basic: 25000, hra: 10000, joinedOn: '2025-04-01' }),
]

console.log('\n── RUNNING A MONTH KEEPS IT ──')
const march = runPayroll(staff, { period: '2026-03' })
const kept = makePayrollRun({ entityId: E, period: '2026-03', run: march, employees: staff })
ok('the run has an id', Boolean(kept.id))
eq('and knows its month', kept.period, '2026-03')
eq('it starts as a draft', kept.status, RUN_STATUS.draft)
eq('it holds a slip per head', kept.slips.length, 2)
eq('the totals match what was run', [kept.gross, kept.net], [march.gross, march.net])
// Re-derived from the frozen slips rather than copied from the run, so a row
// whose totals disagree with its own payslips cannot be written at all.
eq('and the totals are the slips added up',
  kept.gross, Math.round(kept.slips.reduce((t, s) => t + s.gross, 0) * 100) / 100)
ok('the rates it was run under travel with it', Boolean(kept.config?.pf))

console.log('\n── AND CARRIES ENOUGH TO READ WITHOUT THE ROSTER ──')
// A slip holding only an employee_id stops meaning anything the day somebody
// leaves and is taken off the list. This is the whole reason a run is frozen.
eq('each slip names the person', kept.slips.map((s) => s.name), ['R. Yadav', 'S. Shaikh'])
eq('and their code', kept.slips.map((s) => s.code), ['RY01', 'SS02'])
ok('and still points at the employee for anyone who is still there',
  kept.slips.every((s) => s.employee_id))

console.log('\n── A RAISE IN JUNE DOES NOT CHANGE MARCH ──')
// The bug this exists to fix, stated as two numbers that must differ.
const raised = [
  { ...staff[0], pay: { ...staff[0].pay, basic: 60000, hra: 24000 } },
  staff[1],
]
const recomputed = runPayroll(raised, { period: '2026-03' })
ok('recomputing March after the raise gives a bigger number', recomputed.gross > march.gross,
  `${recomputed.gross} vs ${march.gross}`)
const readBack = payrollForPeriod(raised, '2026-03', { runs: [kept], entityId: E })
eq('but the recorded March is still what was run', readBack.gross, march.gross)
ok('and says it is a record', readBack.recorded)
eq('with the pay as it was, not as it is', readBack.slips[0].gross, march.slips[0].gross)

console.log('\n── NOR DOES SOMEBODY LEAVING ──')
const gone = [staff[1]]
const afterLeaver = payrollForPeriod(gone, '2026-03', { runs: [kept], entityId: E })
eq('both are still on the recorded month', afterLeaver.headcount, 2)
eq('and the one who left is still named', afterLeaver.slips[0].name, 'R. Yadav')
// The control: with no record, the same question gives the smaller answer,
// which is exactly the wrong answer and why the record has to exist.
eq('while a month with no record loses them', runPayroll(gone, { period: '2026-03' }).headcount, 1)

console.log('\n── A MONTH WITH NO RECORD IS STILL ANSWERED, AND LABELLED ──')
const april = payrollForPeriod(staff, '2026-04', { runs: [kept], entityId: E })
ok('the figures are there', april.gross > 0, String(april.gross))
ok('but it does not claim to be a record', !april.recorded)
eq('and has no run behind it', april.runId, null)
eq('the recorded one points at its run', readBack.runId, kept.id)

console.log('\n── FINDING THE RUN FOR A MONTH ──')
eq('by month', recordedRun([kept], { entityId: E, period: '2026-03' })?.id, kept.id)
eq('a month with none has none', recordedRun([kept], { entityId: E, period: '2026-04' }), null)
// Another company's March is not this company's March.
eq('and another company’s run is not ours',
  recordedRun([{ ...kept, entity_id: 'other' }], { entityId: E, period: '2026-03' }), null)
eq('a discarded run does not count',
  recordedRun([{ ...kept, deleted_at: '2026-04-01T00:00:00Z' }], { entityId: E, period: '2026-03' }), null)

console.log('\n── A DRAFT CAN BE RUN AGAIN; AN APPROVED ONE CANNOT ──')
ok('a draft is not locked', !isLocked(kept))
ok('so it can be run again', canRerun(kept).ok)
const approved = { ...kept, status: RUN_STATUS.approved }
ok('an approved run is locked', isLocked(approved))
ok('and refuses to be run again', !canRerun(approved).ok)
ok('saying which month and why', /2026-03/.test(canRerun(approved).why), canRerun(approved).why)
const paid = { ...kept, status: RUN_STATUS.paid }
ok('so does a paid one', !canRerun(paid).ok)
ok('a month nobody has run yet can always be run', canRerun(null).ok)

console.log('\n── AND THE STATES ONLY GO ONE WAY ──')
ok('a draft can be approved', canSetStatus(kept, RUN_STATUS.approved).ok)
ok('an approved run can be marked paid', canSetStatus(approved, RUN_STATUS.paid).ok)
ok('a draft cannot jump straight to paid', !canSetStatus(kept, RUN_STATUS.paid).ok)
ok('with a reason that says what to do first',
  /approved/i.test(canSetStatus(kept, RUN_STATUS.paid).why), canSetStatus(kept, RUN_STATUS.paid).why)
ok('an approved run cannot be reopened', !canSetStatus(approved, RUN_STATUS.draft).ok)
ok('a paid one cannot be moved at all', !canSetStatus(paid, RUN_STATUS.approved).ok)
ok('nor marked paid twice', !canSetStatus(paid, RUN_STATUS.paid).ok)
ok('and a state nobody has heard of is refused', !canSetStatus(kept, 'nonsense').ok)
ok('a missing run is refused rather than crashed', !canSetStatus(null, RUN_STATUS.approved).ok)

console.log('\n── A YEAR THAT IS PART RECORD AND PART GUESS ──')
const year = periodsBetween('2026-01', '2026-06')
eq('six months', year.length, 6)
const over = payrollOverPeriods(raised, year, { runs: [kept], entityId: E })
eq('one of them is a record', over.recorded, 1)
eq('and five are not', over.projected, 5)
eq('which add up to the six', over.recorded + over.projected, year.length)
// A report that mixed the two silently would be worse than one that refused.
ok('the recorded month is flagged in the list',
  over.months.find((m) => m.period === '2026-03').recorded === true)
ok('and the rest are not', over.months.filter((m) => m.period !== '2026-03').every((m) => !m.recorded))
// The total has to include the recorded month at its recorded figure, not at
// the recomputed one — otherwise the record is decoration.
const wouldBe = year.reduce((t, p) => t + runPayroll(raised, { period: p }).gross, 0)
ok('the year is cheaper than recomputing it, because March is held down',
  over.gross < Math.round(wouldBe * 100) / 100, `${over.gross} vs ${Math.round(wouldBe * 100) / 100}`)
eq('by exactly the raise that March never got',
  Math.round((Math.round(wouldBe * 100) / 100 - over.gross) * 100) / 100,
  Math.round((recomputed.gross - march.gross) * 100) / 100)

console.log('\n── WITH NO RUNS AT ALL, NOTHING CHANGES ──')
// The behaviour every existing caller already depends on.
const bare = payrollOverPeriods(staff, year)
eq('every month is a projection', bare.projected, 6)
eq('and none is a record', bare.recorded, 0)
eq('the figures are the ones runPayroll gives',
  bare.months[0].gross, runPayroll(staff, { period: year[0] }).gross)

console.log('\n── A RUN OF NOTHING IS STILL A RUN ──')
// A month where everybody had left is a real answer: zero. Refusing to record
// it would leave the month looking unrun, and it would be recomputed forever.
const empty = makePayrollRun({ entityId: E, period: '2026-02', run: runPayroll([], { period: '2026-02' }), employees: [] })
eq('no slips', empty.slips.length, 0)
eq('no gross', empty.gross, 0)
ok('but it is a record', payrollForPeriod(staff, '2026-02', { runs: [empty], entityId: E }).recorded)
eq('and holds the month at zero rather than recomputing it',
  payrollForPeriod(staff, '2026-02', { runs: [empty], entityId: E }).gross, 0)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
