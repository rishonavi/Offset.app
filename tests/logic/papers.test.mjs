// A document, read.
//
// A spreadsheet is four hundred rows of one shape; a PDF is one document of a
// shape somebody chose. `intake.js` matches columns because a sheet has
// columns; this matches labels, because a document has a label in front of
// every figure and that is the only thing all of them have in common.
//
// Four things went wrong writing it, every one of them silent — a wrong figure
// that reads like a right one:
//
//   A salary slip prints earnings on the left and deductions on the right as
//   ONE line. Reading the first pair per line found the conveyance and lost the
//   basic: a slip read as a tenth of itself.
//
//   "Rs. 1,24,50,000" stripped character by character keeps the full stop from
//   "Rs." and becomes 0.1245 — a hundred-thousand-fold error from a punctuation
//   mark.
//
//   "TMT bars 12mm" has a 12 in it. Counted as a quantity, a two-line quotation
//   became three lines priced at the bar diameter.
//
//   `12-06-2026` handed to a browser is the sixth of December. In an app that
//   is India-first everywhere else it is the twelfth of June.
import {
  pairsInLine, labelledLines, findField, slipPeriod,
  parseSalarySlip, parseQuotation, parseAllotment, guessPaper, readPaper,
  PAPERS, PAPER_IDS,
} from '../../src/lib/papers.js'
import { normalizeDate } from '../../src/lib/exports.js'
import { toNumber } from '../../src/lib/intake.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, got, want) => ok(n, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

console.log('\n── ONE LINE CAN CARRY TWO FIGURES ──')
// The bug that read a slip as a tenth of itself.
const two = pairsInLine('Basic              30,000.00  PF                1,800.00')
eq('both pairs are found', two.length, 2)
eq('the earning', `${two[0].label}=${toNumber(two[0].value)}`, 'basic=30000')
eq('and the deduction beside it', `${two[1].label}=${toNumber(two[1].value)}`, 'pf=1800')
// Two labelled fields on one line, which is how every header is laid out.
const hdr = pairsInLine('Tower: A      Floor: 12')
eq('two colon pairs are two pairs', hdr.length, 2)
eq('the first', `${hdr[0].label}=${hdr[0].value}`, 'tower=A')
eq('the second', `${hdr[1].label}=${hdr[1].value}`, 'floor=12')
// A label and its figure separated only by a wide gap.
eq('a label above a column of figures pairs with its figure',
  JSON.stringify(pairsInLine('Net Pay            41,600.00').map((p) => [p.label, p.value])), '[["net pay","41,600.00"]]')
// A single space between label and figure is the same pair.
eq('and so does one with a single space',
  JSON.stringify(pairsInLine('Basic 30000').map((p) => [p.label, p.value])), '[["basic","30000"]]')
eq('a line of words alone is a label with nothing', pairsInLine('Earnings')[0].value, '')
eq('an empty line is nothing at all', pairsInLine('   ').length, 0)

console.log('\n── FINDING A FIELD ──')
const lines = labelledLines('Employee Name: R. Sharma\nBasic   30,000.00\nHRA   12,000.00')
eq('by its exact label', findField(lines, ['basic'], { number: true }).value, 30000)
eq('by a longer name for the same thing', findField(lines, ['basic salary', 'basic'], { number: true }).value, 30000)
eq('a label nothing matches is nothing', findField(lines, ['gratuity'], { number: true }), null)
eq('and text comes back as text', findField(lines, ['employee name']).value, 'R. Sharma')

console.log('\n── A SALARY SLIP ──')
const slip = `NAVI BUILDERS PVT LTD
Payslip for the month of June 2026

Employee Name: R. Sharma
Employee Code: E-01
PAN: AAAPZ1234C

Earnings                      Deductions
Basic              30,000.00  PF                1,800.00
HRA                12,000.00  Professional Tax    200.00
Conveyance          1,600.00
Gross Earnings     43,600.00  Total Deductions  2,000.00
Net Pay            41,600.00`
const s = parseSalarySlip(slip)
eq('the name', s.name, 'R. Sharma')
eq('the code', s.code, 'E-01')
eq('the PAN', s.pan, 'AAAPZ1234C')
eq('the month it is for', s.period, '2026-06')
eq('the basic', s.components.basic, 30000)
eq('the house rent allowance', s.components.hra, 12000)
eq('the conveyance', s.components.conveyance, 1600)
eq('the provident fund', s.deductions.pf, 1800)
eq('the professional tax', s.deductions.professionalTax, 200)
eq('the gross', s.gross, 43600)
eq('the deductions', s.totalDeductions, 2000)
eq('and the take-home', s.net, 41600)
ok('it read', s.read)
// Not found is not nought. A slip with no medical line says nothing about
// medical, and a zero would make the reader's silence into the slip's
// statement.
ok('a component the slip does not have is missing, not zero', s.components.medical === undefined, JSON.stringify(s.components))
ok('and it is named', s.missing.includes('medical'), s.missing.join(','))
eq('a slip that adds up has nothing to report', s.problems.length, 0)

console.log('\n── AS A PDF READER ACTUALLY HANDS IT OVER ──')
// The fixture above is the slip as it is printed. This is the same slip as the
// PDF reader returns it, with the wide gaps between the columns collapsed —
// which is what happens in practice and what the first version of this could
// not read. Splitting on wide gaps turned "Basic  30,000.00 PF  1,800.00" into
// "Basic", "30,000.00 PF" and "1,800.00": a label glued to the next label's
// value, and a slip read as a third of itself.
const collapsed = parseSalarySlip([
  'NAVI BUILDERS PVT LTD',
  'Payslip for the month of June 2026',
  'Employee Name: A. Deshmukh',
  'Employee Code: E-07',
  'PAN: AKLPD9911F',
  'Earnings  Deductions',
  'Basic  30,000.00 PF  1,800.00',
  'HRA  12,000.00 Professional Tax  200.00',
  'Conveyance  1,600.00',
  'Gross Earnings  43,600.00 Total Deductions 2,000.00',
  'Net Pay  41,600.00',
].join('\n'))
eq('the name still reads', collapsed.name, 'A. Deshmukh')
eq('the basic', collapsed.components.basic, 30000)
eq('the house rent allowance beside it', collapsed.components.hra, 12000)
eq('the provident fund from the right column', collapsed.deductions.pf, 1800)
eq('and the professional tax', collapsed.deductions.professionalTax, 200)
eq('the gross', collapsed.gross, 43600)
eq('the deductions', collapsed.totalDeductions, 2000)
eq('the take-home', collapsed.net, 41600)
eq('and it all adds up', collapsed.problems.length, 0)

console.log('\n── AND ONE THAT DOES NOT ADD UP ──')
// The document's own totals are checked, not trusted.
const wrong = parseSalarySlip(`Payslip June 2026
Employee Name: S. Iyer
Basic   30,000.00
HRA     12,000.00
Gross Earnings   45,000.00
Net Pay          45,000.00`)
ok('the disagreement is reported', wrong.problems.length > 0, JSON.stringify(wrong.problems))
ok('naming both figures', /come to 42000 and the slip says 45000/.test(wrong.problems[0]), wrong.problems[0])
// What the slip says is kept beside what its lines come to, because the
// difference is the finding.
eq('the slip’s own gross is kept', wrong.statedGross, 45000)
eq('and the slip is believed for the total, having been flagged', wrong.gross, 45000)

console.log('\n── THE MONTH, HOWEVER IT IS WRITTEN ──')
eq('in words', slipPeriod('Payslip for the month of June 2026'), '2026-06')
eq('shortened', slipPeriod('Salary for Jun-2026'), '2026-06')
eq('as numbers', slipPeriod('Period: 06/2026'), '2026-06')
eq('already as a month', slipPeriod('2026-06'), '2026-06')
eq('and not at all', slipPeriod('a slip with no month on it'), null)

console.log('\n── A VENDOR’S QUOTATION ──')
const quote = `SHAKTI STEEL & ALLOYS PVT LTD
Quotation No: Q-114     Date: 12-06-2026
GST: 18

S.No  Material          Qty      Rate     Amount
1     TMT bars 12mm    24000     61.40   1473600
2     TMT bars 16mm     8000     60.90    487200`
const q = parseQuotation(quote)
eq('the vendor comes off the letterhead', q.vendor, 'SHAKTI STEEL & ALLOYS PVT LTD')
eq('the reference', q.ref, 'Q-114')
// Day first. The browser's own reading of this is the sixth of December.
eq('and the date, read the way it was written', q.date, '2026-06-12')
eq('two materials', q.lines.length, 2)
// The one that made three lines out of two.
eq('the diameter in the name is not a quantity', q.lines[0].name, 'TMT bars 12mm')
eq('the quantity is the quantity', q.lines[0].qty, 24000)
eq('and the rate the rate', q.lines[0].rate, 61.4)
eq('the tax from the header goes on every line', q.lines[0].gstPercent, 18)
eq('the second line too', q.lines[1].qty, 8000)
ok('it read', q.read)
// The header row of the table is not a material.
ok('no line is called "Material"', !q.lines.some((l) => /^material$/i.test(l.name)), JSON.stringify(q.lines.map((l) => l.name)))
// And a labelled header line with two numbers on it is not a material either.
ok('nor is the quotation number', !q.lines.some((l) => /quotation/i.test(l.name)), JSON.stringify(q.lines.map((l) => l.name)))

console.log('\n── AN ALLOTMENT LETTER ──')
const letter = `ALLOTMENT LETTER
Unit No: A-1201
Tower: A      Floor: 12
Configuration: 2 BHK
Carpet Area: 685 sq.ft.
Agreement Value: Rs. 1,24,50,000
Allottee: Mr. S. Nair`
const a = parseAllotment(letter)
eq('the unit', a.name, 'A-1201')
eq('the tower', a.tower, 'A')
eq('the floor', a.floor, '12')
eq('the configuration', a.configuration, '2 BHK')
eq('the carpet area, without its units', a.carpetArea, 685)
// The punctuation bug: "Rs." left a full stop that made this 0.1245.
eq('and the price, in full', a.agreedPrice, 12450000)
eq('the buyer', a.buyer, 'Mr. S. Nair')
ok('it read', a.read)
// A letter with a unit number and nothing else is not an allotment.
ok('a letter with no area and no price did not read',
  !parseAllotment('ALLOTMENT LETTER\nUnit No: A-1201').read)

console.log('\n── WHICH KIND OF PAPER IS THIS ──')
eq('a slip knows itself', guessPaper(slip).id, 'salarySlip')
eq('so does a quotation', guessPaper(quote).id, 'quotation')
eq('and a letter', guessPaper(letter).id, 'allotment')
// Guessing is reported as guessing. Reading a quotation as a salary slip
// produces a confident set of zeroes.
eq('a document that says nothing about itself is not guessed at', guessPaper('hello world').id, null)
ok('and says why', /what kind of document/.test(guessPaper('hello world').why))
const read = readPaper(slip)
eq('reading without being told picks the kind', read.kind, 'salarySlip')
ok('and says it guessed', read.guessed)
eq('and where it would go', read.target, 'employees')
const told = readPaper(slip, 'salarySlip')
ok('being told is not guessing', !told.guessed)
eq('every paper knows where it belongs', PAPER_IDS.every((id) => PAPERS[id].target), true)
eq('three kinds', PAPER_IDS.join(','), 'salarySlip,quotation,allotment')

console.log('\n── AND THE DATE THAT WAS BEING READ BACKWARDS ──')
// Not only in documents: every spreadsheet imported before this had the same
// two numbers swapped on any day of the month up to the twelfth, silently,
// because the result is always a real date.
eq('the twelfth of June', normalizeDate('12-06-2026'), '2026-06-12')
eq('with slashes too', normalizeDate('12/06/2026'), '2026-06-12')
eq('an ISO date is left alone', normalizeDate('2026-06-12'), '2026-06-12')
// Where one of the two is above twelve it cannot be the month, whichever order
// it was written in.
eq('a thirteenth read day-first', normalizeDate('13/06/2026'), '2026-06-13')
eq('and one written month-first is read for what it can only be', normalizeDate('06/13/2026'), '2026-06-13')
eq('the last day of the year', normalizeDate('31-12-2026'), '2026-12-31')
eq('a two-digit year', normalizeDate('1/1/26'), '2026-01-01')
eq('a month spelt out still works', normalizeDate('12 June 2026'), '2026-06-12')
eq('and a thirty-second of anything is nothing', normalizeDate('32/01/2026'), '')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
