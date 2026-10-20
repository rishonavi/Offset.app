// Every rupee the app prints comes through here, and none of it was tested.
//
// Five exports, no assertions anywhere in the suite — found by listing exports
// no test so much as mentions. It is the most-used module in the app and the
// easiest to test, being pure, so the gap was worth closing on its own; it also
// held a real fault.
import {
  formatCurrency, formatCompact, currencySymbol, formatDate, monthKey,
} from '../../src/lib/format.js'
import { CURRENCY, LOCALE } from '../../src/lib/constants.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

console.log('── THE BUILD THESE TESTS DESCRIBE ──')
// Everything below is true of en-IN/INR. A build configured for another locale
// formats differently and correctly, so say which one is being asserted rather
// than letting the suite go quietly wrong somewhere else.
eq('is the Indian default', LOCALE, 'en-IN')
eq('in rupees', CURRENCY, 'INR')
eq('whose symbol is found rather than hardcoded', currencySymbol, '₹')

console.log('\n── GROUPED THE WAY INDIA GROUPS ──')
// Lakhs and crores, not thousands: 12,34,567 and not 1,234,567. This is the
// reason the app sets a locale at all.
eq('a thousand', formatCurrency(1234), '₹1,234')
eq('a lakh', formatCurrency(100000), '₹1,00,000')
eq('and above it', formatCurrency(1234567), '₹12,34,567')
eq('a crore', formatCurrency(12345678), '₹1,23,45,678')
eq('and a hundred of them', formatCurrency(1000000000), '₹1,00,00,00,000')
// The control: this is not what a western grouping would print.
ok('which is not three-digit grouping', !formatCurrency(1234567).includes('1,234,567'), formatCurrency(1234567))

console.log('\n── PAISE WHERE THERE ARE ANY ──')
eq('a round figure carries no decimals', formatCurrency(5), '₹5')
eq('nor does zero', formatCurrency(0), '₹0')
eq('half a rupee shows', formatCurrency(1234.5), '₹1,234.5')
eq('and paise show', formatCurrency(1234.56), '₹1,234.56')
eq('a third decimal is rounded, not dropped', formatCurrency(1234.567), '₹1,234.57')
eq('and a fraction of a paisa disappears', formatCurrency(0.004), '₹0')
eq('a debit keeps its sign', formatCurrency(-5000), '-₹5,000')

console.log('\n── AND NOTHING THAT IS NOT A NUMBER REACHES A SCREEN ──')
for (const [label, value] of [
  ['nothing', null], ['undefined', undefined], ['an empty string', ''],
  ['a word', 'abc'], ['NaN', NaN],
]) {
  eq(`${label} prints as zero`, formatCurrency(value), '₹0')
}
// The one `Number(n) || 0` let through: ±Infinity is truthy, so it was passed
// to ICU and came out as ₹∞ on a card. A division with a zero denominator
// upstream is all it takes.
eq('and infinity does too', formatCurrency(Infinity), '₹0')
eq('as does negative infinity', formatCurrency(-Infinity), '₹0')
eq('compact is guarded the same way', formatCompact(Infinity), '0')
// The control beside those: a real number is still printed, so the guard is
// not simply zeroing everything.
eq('while a real figure is untouched', formatCurrency(4321), '₹4,321')

console.log('\n── COMPACT, FOR A CHART AXIS ──')
// Pinned rather than chosen: these are ICU's en-IN compact forms, and the point
// of writing them down is that a locale or ICU change that moves them should
// be a failing test and not a quiet change to every chart.
eq('under a thousand is itself', formatCompact(999), '999')
eq('a thousand is K', formatCompact(1000), '1K')
eq('a lakh is L', formatCompact(100000), '1L')
eq('and a half', formatCompact(150000), '1.5L')
eq('ten lakh stays in lakhs', formatCompact(1000000), '10L')
eq('a crore is Cr', formatCompact(10000000), '1Cr')
eq('and a hundred crore', formatCompact(1000000000), '100Cr')

console.log('\n── AND IT NEVER CLAIMS A FIGURE THAT WAS NOT REACHED ──')
// ICU rounds to nearest by default, so one rupee short of a lakh carried the
// same label as a lakh itself — on an axis whose only job is to say which order
// of magnitude you are reading.
eq('one rupee short of a lakh is not a lakh', formatCompact(99999), '99.9K')
eq('a lakh is', formatCompact(100000), '1L')
eq('one short of ten lakh is not ten lakh', formatCompact(999999), '9.9L')
eq('one short of a crore is not a crore', formatCompact(9999999), '99.9L')
eq('a crore is', formatCompact(10000000), '1Cr')
// And the digit that is kept is still truncated, not rounded up: 99,950 would
// round to 1L and must not.
eq('fifty short of a lakh is not a lakh either', formatCompact(99950), '99.9K')
eq('while 99,949 reads the same, as it always did', formatCompact(99949), '99.9K')
// The reason this is `trunc` and not `floor`. Flooring -99,999 gives -1L,
// because floor moves away from zero below it — overstating the figure in the
// one direction nobody checks.
eq('a negative is not overstated either', formatCompact(-99999), '-99.9K')
eq('nor is a larger one', formatCompact(-9999999), '-99.9L')
eq('and a negative lakh is still a negative lakh', formatCompact(-100000), '-1L')
// Controls: truncating must not shift a figure that is already exact, or one
// well inside a band.
eq('an exact figure is unmoved', formatCompact(1500), '1.5K')
eq('and so is one mid-band', formatCompact(1234), '1.2K')
eq('zero is zero', formatCompact(0), '0')

console.log('\n── DATES ──')
eq('an ISO date reads as a person writes it', formatDate('2026-04-01'), '01 Apr 2026')
eq('and another', formatDate('2026-10-19'), '19 Oct 2026')
eq('a Date object too', formatDate(new Date('2026-04-01T00:00:00.000Z')), '01 Apr 2026')
eq('and a timestamp', formatDate(1760000000000), '09 Oct 2025')
eq('nothing is nothing', formatDate(null), '')
eq('and an empty string is too', formatDate(''), '')
// Shown back rather than swallowed: a row holding something unparseable should
// say so on the screen, not read as blank.
eq('an impossible date is shown as it was stored', formatDate('2026-13-45'), '2026-13-45')
eq('as is a word', formatDate('not a date'), 'not a date')

eq('the month key is the year and month', monthKey('2026-04-01'), '2026-04')
eq('from a Date as well', monthKey(new Date('2026-10-19T00:00:00.000Z')), '2026-10')
eq('and nothing where there is no date', monthKey('2026-13-45'), '')
eq('or no input at all', monthKey(null), '')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
