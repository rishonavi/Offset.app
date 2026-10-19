// Reading a figure somebody else wrote.
//
// `exports.js` had no test of any kind — seven exports, nothing. It is the way
// money gets into and out of the ledger, and the way in was parsing amounts
// with `Number(String(raw).replace(/[^0-9.-]/g, '')) || 0`: keep the digits,
// the dots and the minus signs, throw the rest away.
//
// Measured against the shapes a real export contains, that was wrong four
// different ways, and every one of them silent. `ImportBills` keeps rows with
// `amount > 0`, so an unreadable figure did not arrive as ₹0 — the row
// vanished. Two hundred in, a hundred and ninety-five out, nothing said.
import { parseAmount, rowToExpenseInput, toExportRows, toIncomeRows } from '../../src/lib/exports.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

console.log('── WHAT IT ALWAYS READ CORRECTLY ──')
eq('a plain number', parseAmount('1234'), 1234)
eq('with a thousands comma', parseAmount('1,234'), 1234)
eq('Indian grouping', parseAmount('12,34,567'), 1234567)
eq('a rupee symbol and paise', parseAmount('₹1,23,456.78'), 123456.78)
eq('a decimal on its own', parseAmount('1234.56'), 1234.56)
eq('a minus sign', parseAmount('-1,234'), -1234)
eq('and a number that is already one', parseAmount(1234.5), 1234.5)

console.log('\n── AND THE FOUR IT DID NOT ──')
// A parenthesised credit, which is how every accounting package writes a
// negative. The brackets were stripped and the sign went with them, so a credit
// imported as a debit.
eq('brackets mean a credit', parseAmount('(1,234)'), -1234)
eq('with paise', parseAmount('(1,234.50)'), -1234.5)
eq('and a bracketed rupee figure', parseAmount('(₹1,234)'), -1234)
// Half of Indian ledgers write money this way, and it came back 0 — so the row
// was dropped without a word.
eq('Rs and a trailing dash', parseAmount('Rs. 1,234/-'), 1234)
eq('without the full stop', parseAmount('Rs 1,234'), 1234)
eq('and in capitals', parseAmount('INR 1,234.50'), 1234.5)
// Whichever separator comes last is the decimal one, which reads both
// conventions without having to be told which sheet this is.
eq('a European decimal', parseAmount('1.234,56'), 1234.56)
eq('beside the Indian one', parseAmount('1,234.56'), 1234.56)
// 1000 used to come through as 13, because the e was stripped and 1 and 3 were
// left touching. A plausible figure, silently wrong, which is the worst kind.
eq('scientific notation is refused, not mangled', parseAmount('1e3'), null)

console.log('\n── WHAT CANNOT BE READ SAYS SO ──')
// null rather than 0. A zero is a figure the importer would act on; a null is
// something it can report.
for (const [label, value] of [
  ['nothing', null], ['undefined', undefined], ['an empty string', ''],
  ['whitespace', '   '], ['a word', 'abc'], ['two decimal points', '1.2.3'],
  ['a double minus', '--5'], ['a date in the amount column', '01-04-2026'],
]) {
  eq(`${label} is unreadable`, parseAmount(value), null)
}
// The control: it is not simply refusing everything.
eq('while an ordinary figure still reads', parseAmount('4,321.50'), 4321.5)

console.log('\n── A ROW, AS THE IMPORTER SEES IT ──')
{
  const row = rowToExpenseInput({
    Date: '2026-04-01', Property: ' Marine Drive Tower ', Category: 'Materials',
    Vendor: 'Shree Traders', 'Payment Method': 'NEFT', Description: 'Cement',
    Amount: 'Rs. 1,23,456/-',
  })
  eq('the amount is read', row.amount, 123456)
  eq('the asset name is trimmed', row.property, 'Marine Drive Tower')
  eq('the category comes through', row.category, 'Materials')
  eq('and the vendor', row.vendor, 'Shree Traders')
  // Kept so the importer can quote it back: "could not read 1,23,456/-" is
  // worth more than a count.
  eq('and what was written is kept', row.amount_text, 'Rs. 1,23,456/-')
}
{
  // Headers are matched case-insensitively and by several names, which is what
  // lets a sheet from somebody else's software open at all.
  const row = rowToExpenseInput({ 'paid on': '2026-05-02', total: '(500)', supplier: 'Konkan', type: 'Freight' })
  eq('an alternative date header', row.date, '2026-05-02')
  eq('an alternative amount header, with its sign', row.amount, -500)
  eq('an alternative vendor header', row.vendor, 'Konkan')
  eq('and an alternative category header', row.category, 'Freight')
}
{
  const row = rowToExpenseInput({ Date: '2026-04-01', Amount: 'see attached' })
  eq('an unreadable amount is null on the row', row.amount, null)
  eq('and the text is there to quote', row.amount_text, 'see attached')
}

console.log('\n── AND THE WAY OUT ──')
{
  const rows = toExportRows(
    [{ date: '2026-04-01', category: 'Materials', vendor: 'Shree', amount: '1234.5', tax: '222' }],
    () => 'Marine Drive Tower',
  )
  eq('one row out for one row in', rows.length, 1)
  eq('the date is the stored one', rows[0].Date, '2026-04-01')
  eq('the place is resolved from the whole row', rows[0].Property, 'Marine Drive Tower')
  eq('the amount is a number, not a string', typeof rows[0].Amount, 'number')
  eq('with its value', rows[0].Amount, 1234.5)
  eq('and the tax beside it', rows[0]['Tax / GST'], 222)
}
{
  // A cost booked to no asset is the ordinary case in a builder's books, and
  // the column says so rather than being blank.
  const rows = toExportRows([{ date: '2026-04-01', amount: 100 }], () => null)
  eq('a cost against nothing is marked', rows[0].Property, '—')
  eq('and a missing amount is zero, not NaN', toExportRows([{ date: 'x' }], () => '')[0].Amount, 0)
}
{
  const rows = toIncomeRows([{ date: '2026-04-01', source: 'Rent', payer: 'Dr Kulkarni', amount: 42000 }], () => 'Flat 2B')
  eq('income carries its source', rows[0].Source, 'Rent')
  eq('and who paid', rows[0]['From (payer)'], 'Dr Kulkarni')
  eq('and its amount', rows[0].Amount, 42000)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
