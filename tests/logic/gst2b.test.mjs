// The input credit a vendor has not filed for.
//
// A builder pays 18% on steel and 28% on cement and gets it back — but only if
// the vendor actually files. When he does not, the money is gone, and nothing
// in the books says so: the purchase is recorded, the tax is recorded, and the
// credit that never arrived leaves no row anywhere.
//
// Two bugs found while writing this, both in the reading rather than the
// arithmetic, and both of the kind that make a reconciliation report everything
// as broken and get switched off:
//
//   "GSTIN of supplier" matches the vendor pattern as well as the GSTIN one, so
//   taking the first header that matched put a tax number in the name column.
//
//   `&` is not a word character, so stripping the word "and" never reached it.
//   "Shakti Steel & Alloys" and "Shakti Steel and Alloys" were two vendors.
import {
  parse2B, reconcile2B, vendorKey, normaliseDate, describe2B, TOLERANCE,
} from '../../src/lib/gst2b.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, got, want) => ok(n, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

console.log('\n── ONE VENDOR, HOWEVER IT WAS TYPED ──')
eq('case does not make two vendors', vendorKey('UltraTech Cement'), vendorKey('ULTRATECH CEMENT'))
eq('nor does a company suffix', vendorKey('Shakti Steel Pvt. Ltd.'), vendorKey('Shakti Steel'))
eq('nor "private limited" spelt out', vendorKey('Shakti Steel Private Limited'), vendorKey('Shakti Steel'))
// The one that cost a whole reconciliation.
eq('nor an ampersand against the word', vendorKey('Shakti Steel & Alloys'), vendorKey('Shakti Steel and Alloys'))
eq('and both come to the same three words', vendorKey('SHAKTI STEEL AND ALLOYS PRIVATE LIMITED'), 'shakti steel alloys')
ok('two different vendors stay different', vendorKey('Shakti Steel') !== vendorKey('Mahalaxmi Steel'))
eq('nothing keys to nothing', vendorKey(''), '')

console.log('\n── THE PORTAL’S DOWNLOAD ──')
const csv = `GSTR-2B for the period June 2026
GSTIN of supplier,Trade Name,Invoice number,Invoice Date,Taxable Value,IGST,CGST,SGST
27AAAPZ1234A1Z5,Shakti Steel & Alloys Pvt. Ltd.,INV-114,12-06-2026,100000,0,9000,9000
27BBBPZ4321B1Z9,UltraTech Cement,C-889,18-06-2026,50000,0,7000,7000`
const rows = parse2B(csv)
eq('two lines were read', rows.length, 2)
// The title row above the headers is how the portal actually writes the file,
// and assuming the first line is the header reads a file of nothing.
eq('the title row above the headers did not confuse it', rows[0].invoice, 'INV-114')
eq('the supplier is the name, not the tax number', rows[0].vendor, 'Shakti Steel & Alloys Pvt. Ltd.')
eq('and the tax number is the tax number', rows[0].gstin, '27AAAPZ1234A1Z5')
eq('the portal’s date becomes an ordinary one', rows[0].date, '2026-06-12')
eq('central and state add to the tax', rows[0].tax, 18000)
eq('and the taxable value is its own figure', rows[0].taxable, 100000)

// Interstate: one IGST figure instead of two.
const igst = parse2B(`GSTIN,Trade Name,Invoice number,Invoice Date,Taxable Value,IGST,CGST,SGST
29CCCPZ1111C1Z1,Karnataka Granite,K-12,03-06-2026,200000,36000,0,0`)
eq('one interstate figure is the tax', igst[0].tax, 36000)
// A file that gives only a total, which plenty of accountants' exports do.
const stated = parse2B(`GSTIN,Supplier Name,Invoice No,Date,Taxable Value,Total Tax
27DDDPZ2222D1Z2,Sai Hardware,SH-9,05-06-2026,10000,1800`)
eq('a stated total is used when there are no parts', stated[0].tax, 1800)
// And is not added to them, which would double every row.
const both = parse2B(`GSTIN,Trade Name,Invoice No,Date,Taxable Value,CGST,SGST,Total Tax
27EEEPZ3333E1Z3,Both Ways,B-1,06-06-2026,10000,900,900,1800`)
eq('the parts win over a stated total rather than adding to it', both[0].tax, 1800)

eq('an empty file is no rows', parse2B('').length, 0)
eq('and so is a header with nothing under it', parse2B('GSTIN,Trade Name\n').length, 0)
eq('rows already parsed from JSON are taken as they are',
  parse2B([{ GSTIN: '27X', 'Trade Name': 'A Vendor', 'Invoice Date': '2026-06-01', 'Total Tax': '900' }])[0].vendor, 'A Vendor')
// Amounts come with currency marks and thousands separators.
eq('a formatted amount is still a number',
  parse2B([{ GSTIN: '27X', 'Trade Name': 'V', 'Total Tax': '₹1,23,456.50' }])[0].tax, 123456.5)

console.log('\n── DATES ──')
eq('the portal writes day first', normaliseDate('12-06-2026'), '2026-06-12')
eq('with slashes too', normaliseDate('3/6/2026'), '2026-06-03')
eq('an ISO date is left alone', normaliseDate('2026-06-12'), '2026-06-12')
eq('and anything else is no date', normaliseDate('sometime in June'), '')

console.log('\n── THE BOOKS AGAINST THE PORTAL ──')
const E = 'e1'
const bill = (id, vendor, date, tax) => ({ id, entity_id: E, vendor, date, amount: tax * 6, tax })
const books = [
  bill('e1', 'SHAKTI STEEL AND ALLOYS PRIVATE LIMITED', '2026-06-12', 18000),
  bill('e2', 'UltraTech Cement', '2026-06-18', 14000),
  bill('e3', 'Konkan Aggregates', '2026-06-20', 2500),
]
const r = reconcile2B(rows, books, { entityId: E, month: '2026-06' })
eq('two purchases are in the portal', r.counts.matched, 2)
// The money. A vendor who filed nothing at all.
eq('one is not', r.counts.missing, 1)
eq('and the credit on it is at risk', r.atRisk, 2500)
eq('nothing in the portal is missing from the books', r.counts.extra, 0)
eq('the matched tax is the rest', r.matchedTax, 32000)
eq('the vendor who has not filed is first', r.vendors[0].vendor, 'Konkan Aggregates')
eq('with the figure against their name', r.vendors[0].atRisk, 2500)
ok('and it is said in a sentence', /1 purchase with no 2B line/.test(describe2B(r)), describe2B(r))

console.log('\n── AND THE OTHER DIRECTION ──')
// In the portal and not in the books: a bill nobody entered, or somebody else's
// invoice raised against this GSTIN. Two different problems, both worth a look.
const short = reconcile2B(rows, [books[0]], { entityId: E, month: '2026-06' })
eq('a 2B line with no purchase is counted', short.counts.extra, 1)
eq('with its tax', short.unrecordedTax, 14000)
ok('and named', short.vendors.some((v) => v.unrecorded === 14000))
ok('said plainly', /1 2B line not in the books/.test(describe2B(short)), describe2B(short))

console.log('\n── A VENDOR WITH THREE INVOICES IN A MONTH ──')
// Pairing in file order would report two mismatches where there are none, so
// the closest pair goes first.
const many = parse2B([
  { GSTIN: '27X', 'Trade Name': 'Sai Hardware', 'Invoice Date': '2026-06-05', 'Total Tax': '900' },
  { GSTIN: '27X', 'Trade Name': 'Sai Hardware', 'Invoice Date': '2026-06-12', 'Total Tax': '5400' },
  { GSTIN: '27X', 'Trade Name': 'Sai Hardware', 'Invoice Date': '2026-06-19', 'Total Tax': '1800' },
])
const three = reconcile2B(many, [
  bill('b1', 'Sai Hardware', '2026-06-06', 1800),
  bill('b2', 'Sai Hardware', '2026-06-13', 5400),
  bill('b3', 'Sai Hardware', '2026-06-20', 900),
], { entityId: E, month: '2026-06' })
eq('all three pair up', three.counts.matched, 3)
eq('with nothing left over', three.counts.missing + three.counts.extra, 0)

// And the closest pair really does go first. Two purchases from one vendor,
// one an exact match for the single 2B line and one a rupee off: taken in file
// order the near-miss is paired and the exact match is reported as unfiled,
// which counts the same and blames the wrong invoice.
const near = reconcile2B(
  [{ vendor: 'Sai Hardware', date: '2026-06-05', tax: 1800, taxable: 10000 }],
  [bill('off', 'Sai Hardware', '2026-06-04', 1801), bill('exact', 'Sai Hardware', '2026-06-05', 1800)],
  { entityId: E, month: '2026-06' })
eq('one of the two pairs', near.counts.matched, 1)
eq('and it is the exact one', near.matched[0].expense.id, 'exact')
eq('with no gap at all', near.matched[0].gap, 0)
eq('so the one left unfiled is the other', near.missing[0].expense.id, 'off')

console.log('\n── THE TOLERANCE ──')
eq('a rupee either way is the same invoice', TOLERANCE, 1)
eq('a rounding difference still matches',
  reconcile2B([{ vendor: 'Sai Hardware', date: '2026-06-05', tax: 1800.4, taxable: 10000 }],
    [bill('b1', 'Sai Hardware', '2026-06-05', 1800)], { entityId: E, month: '2026-06' }).counts.matched, 1)
eq('a hundred rupees is a different invoice',
  reconcile2B([{ vendor: 'Sai Hardware', date: '2026-06-05', tax: 1900, taxable: 10000 }],
    [bill('b1', 'Sai Hardware', '2026-06-05', 1800)], { entityId: E, month: '2026-06' }).counts.matched, 0)

console.log('\n── WHAT IS NOT IN THIS MONTH, OR THESE BOOKS ──')
eq('last month’s purchases are not in this reconciliation',
  reconcile2B(rows, [bill('b1', 'Shakti Steel', '2026-05-12', 18000)], { entityId: E, month: '2026-06' }).counts.books, 0)
eq('another company’s are not either',
  reconcile2B(rows, books, { entityId: 'e2', month: '2026-06' }).counts.books, 0)
// A purchase with no tax on it has no credit to lose and is not a finding.
eq('a purchase with no tax is not part of this',
  reconcile2B([], [{ id: 'x', entity_id: E, vendor: 'Cash Purchase', date: '2026-06-01', amount: 5000, tax: 0 }],
    { entityId: E, month: '2026-06' }).counts.books, 0)

console.log('\n── AND NOTHING LOADED IS NOT A CLEAN BILL OF HEALTH ──')
const nothing = reconcile2B([], books, { entityId: E, month: '2026-06' })
eq('it says so', nothing.empty, true)
ok('rather than reporting everything as unfiled', /nothing has been checked/.test(describe2B(nothing)), describe2B(nothing))
// Though the purchases are still counted, so a screen can say what it would be
// checking if something were loaded.
eq('the books are still read', nothing.counts.books, 3)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
