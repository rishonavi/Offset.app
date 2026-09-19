// What day the app thinks it is.
//
// Thirty-odd places in this codebase wrote today's date as
// `new Date().toISOString().slice(0, 10)`. That is the UTC date. India runs at
// UTC+5:30, so from midnight to 05:30 every one of them returned *yesterday* —
// five and a half hours out of twenty-four, on an app whose currency, tax year
// and locale are all India-first.
//
// Where it bites: a night pour. Concrete is placed at night because it is
// cooler, so the 3am delivery, the 3am muster and the 3am issue of cement all
// carried the previous day's date. The stores ledger and the day sheet then
// disagreed about which day the material went into the slab, the movement
// could land in a month already locked, and the default date on every form
// was one the user had to notice and correct.
//
// Node re-reads `process.env.TZ` on the next Date operation, so this file can
// stand in Mumbai, in London and in Denver and check the answer in each.
import { todayISO, thisMonth } from '../../src/lib/today.js'
import { daysLate } from '../../src/lib/projects.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, got, want) => ok(n, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const at = (tz, fn) => {
  const was = process.env.TZ
  process.env.TZ = tz
  try { return fn() } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was }
}

// 20:00 UTC on the 18th is 01:30 on the 19th in Mumbai. One instant, two dates.
const NIGHT = new Date('2026-09-18T20:00:00Z')

console.log('\n── THE HOUR THAT USED TO BE YESTERDAY ──')
eq('half past one in the morning in Mumbai is the 19th', at('Asia/Kolkata', () => todayISO(NIGHT)), '2026-09-19')
// The control: the same instant really is the 18th in UTC, so the assertion
// above is doing work rather than agreeing with the clock it ran on.
eq('the same instant in London is still the 18th', at('UTC', () => todayISO(NIGHT)), '2026-09-18')
eq('and the expression this replaced always said the 18th', NIGHT.toISOString().slice(0, 10), '2026-09-18')
// West of Greenwich the old code was wrong in the other direction, in the
// evening rather than the small hours.
eq('four in the afternoon in Denver is the 18th', at('America/Denver', () => todayISO(NIGHT)), '2026-09-18')
eq('and there the old expression said the 19th', at('America/Denver', () => new Date('2026-09-19T04:00:00Z').toISOString().slice(0, 10)), '2026-09-19')
eq('where the local date was the 18th', at('America/Denver', () => todayISO(new Date('2026-09-19T04:00:00Z'))), '2026-09-18')

console.log('\n── SHAPE ──')
eq('zero padded on the month', todayISO(new Date('2026-01-05T12:00:00Z')), '2026-01-05')
eq('and on the day', todayISO(new Date('2026-11-02T12:00:00Z')), '2026-11-02')
ok('the live reading has the shape of a date', /^\d{4}-\d{2}-\d{2}$/.test(todayISO()))
ok('and is not the empty string or NaN', todayISO().length === 10 && !todayISO().includes('NaN'))

console.log('\n── THE MONTH, WHICH FLIPS ON THE FIRST ──')
// 01 October, 01:30 IST. The scan quota and the payroll period both key off
// this, so being a month out is a month of quota or the wrong payslip run.
const FIRST = new Date('2026-09-30T20:00:00Z')
eq('the first of October in Mumbai is October', at('Asia/Kolkata', () => thisMonth(FIRST)), '2026-10')
eq('the same instant in London is September', at('UTC', () => thisMonth(FIRST)), '2026-09')
eq('and the expression this replaced said September', FIRST.toISOString().slice(0, 7), '2026-09')
ok('the live reading has the shape of a month', /^\d{4}-\d{2}$/.test(thisMonth()))
eq('and agrees with the day it belongs to', thisMonth(), todayISO().slice(0, 7))

console.log('\n── A JOB PAST ITS DATE ──')
const late = { due_on: '2026-01-01', status: 'active' }
// The two shapes daysLate is handed anywhere in the app.
eq('a string as-of reads as that day', daysLate(late, '2026-01-11'), 10)
eq('a UTC-midnight Date reads as the same day', daysLate(late, new Date('2026-01-11T00:00:00Z')), 10)
eq('before the date it is not late', daysLate(late, '2025-12-01'), null)
eq('a closed job is never late', daysLate({ ...late, status: 'completed' }, '2027-01-01'), null)
eq('nonsense as-of does not crash', daysLate(late, 'rubbish'), null)
ok('and with no as-of at all it still answers', daysLate(late) === null || daysLate(late) > 0)

console.log('\n── NOBODY READS THE CLOCK IN UTC AGAIN ──')
// A ratchet. The fix is thirty files wide and a single copy-paste undoes it in
// one of them, silently, because the result is always a real date.
const { readFileSync, readdirSync, statSync } = await import('node:fs')
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = `${dir}/${f}`
  return statSync(p).isDirectory() ? walk(p) : (/\.jsx?$/.test(p) ? [p] : [])
})
// A bare `new Date().toISOString()` stored as `created_at` is right and stays:
// a timestamp is an instant, and UTC is the correct way to write one down. What
// is wrong is cutting a *date* out of one — `.slice(0, 10)` for a day,
// `.slice(0, 7)` for a month — or handing one in as an `asOf`, which every
// caller then slices itself.
const READS_A_DAY = /new Date\(\)\s*\.toISOString\(\)\s*\.slice\(0, ?[17]0?\)|(?:asOf|day|date|today|month) = new Date\(\)\.toISOString\(\)/
const offenders = walk('src')
  .filter((p) => p !== 'src/lib/today.js')
  .flatMap((p) => readFileSync(p, 'utf8').split('\n')
    .map((line, i) => ({ p, n: i + 1, line }))
    .filter(({ line }) => READS_A_DAY.test(line) && !line.trimStart().startsWith('//')))
ok('no file cuts a date out of the UTC clock', offenders.length === 0,
  offenders.map((o) => `${o.p}:${o.n}`).join(', '))
// Three controls: the detector sees each shape it is meant to see, and does not
// fire on the timestamp it is meant to leave alone.
ok('the detector sees a sliced day', READS_A_DAY.test('const d = new Date().toISOString().slice(0, 10)'))
ok('and a sliced month', READS_A_DAY.test('const m = new Date().toISOString().slice(0, 7)'))
ok('and one handed in as an as-of', READS_A_DAY.test('function f({ asOf = new Date().toISOString() }) {}'))
ok('and leaves a stored timestamp alone', !READS_A_DAY.test('created_at: new Date().toISOString(),'))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
