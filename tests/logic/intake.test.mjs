// Getting somebody else's spreadsheet into the books.
//
// Everything here can be typed in and on a real site nothing is. The sales list
// is a spreadsheet the broker sent; the salary register is whatever the last
// accountant left behind. Re-keying four hundred flats is not a data-entry
// problem, it is the reason an app never gets used.
//
// The hard part is not reading a file. It is that somebody else named the
// columns — "Carpet Area (sq.ft.)", "CARPET", "Carpet_Area" are one column — so
// matching has to be loose, and a loose match is a guess. Every assertion below
// is really about the same thing: **the guess has to be visible before four
// hundred rows are written on the strength of it.**
import {
  normaliseHeader, toNumber, matchColumns, mapRows, describeMatch,
  isNumbersPackage, NUMBERS_NOTE, TARGETS, TARGET_IDS,
} from '../../src/lib/intake.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, got, want) => ok(n, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

console.log('\n── A COLUMN NAME, HOWEVER IT WAS TYPED ──')
eq('units in brackets are not part of the name', normaliseHeader('Carpet Area (sq.ft.)'), 'carpet area')
eq('underscores are spaces', normaliseHeader('Carpet_Area'), 'carpet area')
eq('and so is any other punctuation', normaliseHeader('Carpet-Area:'), 'carpet area')
eq('case is nothing', normaliseHeader('CARPET AREA'), 'carpet area')
eq('nothing is nothing', normaliseHeader(''), '')

console.log('\n── AND A NUMBER, HOWEVER IT WAS WRITTEN ──')
eq('rupees and Indian grouping', toNumber('₹1,24,50,000'), 12450000)
eq('a plain number is itself', toNumber(1234), 1234)
eq('decimals survive', toNumber('1,234.50'), 1234.5)
eq('and a minus sign', toNumber('-500'), -500)
// The distinction that matters: nothing is not zero. A blank rate and a rate of
// nought are different facts about a flat.
eq('a blank is not a number', toNumber(''), null)
eq('and neither is a word', toNumber('N/A'), null)
eq('nor a dash somebody typed for "none"', toNumber('-'), null)

console.log('\n── WHICH COLUMN IS WHICH ──')
const headers = ['Unit No', 'Tower', 'Floor', 'Configuration', 'Carpet Area (sq.ft.)', 'Agreed Price', 'Parking', 'Status']
const m = matchColumns(headers, 'units')
eq('the unit number is the name', m.columns.name, 'Unit No')
eq('the carpet area is found through its units', m.columns.carpetArea, 'Carpet Area (sq.ft.)')
eq('and the price', m.columns.agreedPrice, 'Agreed Price')
// The person's own column that nothing was done with. A "Parking" column that
// vanished is a question worth asking before four hundred rows are written.
eq('a column nothing was done with is named', m.ignored.join(','), 'Parking')
eq('nothing required is missing', m.missing.length, 0)
eq('and nothing is unclear', m.ambiguous.length, 0)
ok('it says so in a sentence', /7 of 12 columns recognised, 1 ignored/.test(describeMatch(m, 'units')), describeMatch(m, 'units'))

console.log('\n── ONE HEADER CANNOT BE TWO FIELDS ──')
// Scored rather than first-past-the-post: "Rate" and "Rate per sq ft" both look
// like the rate, and taking whichever came first makes the answer depend on the
// order somebody's spreadsheet happens to be in.
const rival = matchColumns(['Flat', 'Rate', 'Rate per sq ft', 'Price'], 'units')
ok('both rate columns are noticed as a problem', rival.ambiguous.length > 0, JSON.stringify(rival.ambiguous))
eq('and the field it is unclear about is named', rival.ambiguous[0].field, 'ratePerArea')
ok('with both headers', rival.ambiguous[0].headers.length === 2, JSON.stringify(rival.ambiguous[0].headers))
// A header claimed by a stronger field is not also given to a weaker one.
const once = matchColumns(['Name', 'Carpet Area', 'Super Built Up Area'], 'units')
eq('carpet is carpet', once.columns.carpetArea, 'Carpet Area')
eq('and saleable is saleable', once.columns.superBuiltUpArea, 'Super Built Up Area')
ok('neither took the other', once.columns.carpetArea !== once.columns.superBuiltUpArea)

console.log('\n── A SHEET WITHOUT THE ONE COLUMN IT NEEDS ──')
// Refusing the file beats writing four hundred unnamed rows.
const noName = mapRows([{ Tower: 'A', 'Carpet Area': 685 }], 'units', { entityId: 'e' })
eq('nothing is written', noName.ready.length, 0)
ok('and it says which column is missing', /No column looks like name/.test(noName.refused || ''), noName.refused)

console.log('\n── FOUR HUNDRED FLATS ──')
const sheet = [
  { 'Unit No': 'A-1201', Tower: 'A', Floor: 12, Configuration: '2 BHK', 'Carpet Area (sq.ft.)': '685', 'Agreed Price': '₹1,24,50,000', Parking: 'Yes', Status: 'Booked' },
  { 'Unit No': 'A-1202', Tower: 'A', Floor: 12, Configuration: '3 BHK', 'Carpet Area (sq.ft.)': '940', 'Agreed Price': '1,78,00,000', Parking: 'No', Status: 'Available' },
  // The run of empty rows every spreadsheet has under its data. Reporting four
  // hundred of these as errors buries the two that matter.
  { 'Unit No': '', Tower: '', Floor: '', Configuration: '', 'Carpet Area (sq.ft.)': '', 'Agreed Price': '', Parking: '', Status: '' },
  // And a real row with the one thing it cannot do without missing.
  { 'Unit No': '', Tower: 'A', Floor: 13, Configuration: '2 BHK', 'Carpet Area (sq.ft.)': '685', 'Agreed Price': '1,24,50,000', Parking: '', Status: '' },
]
const r = mapRows(sheet, 'units', { entityId: 'e1', projectId: 'p1' })
eq('two flats are ready', r.ready.length, 2)
eq('the blank row is not an error', r.skipped.length, 1)
// Named, not dropped. "12 skipped" with no reason is how somebody finds out in
// March that the penthouse is missing.
eq('the one that is says which line it was on', r.skipped[0].line, 5)
eq('and why', r.skipped[0].why, 'no name')
eq('the price came through the rupee sign', r.ready[0].agreed_price, 12450000)
eq('the area through its units', r.ready[0].carpet_area, 685)
// A sheet says "Booked"; the app has ids.
eq('a status in words became a status', r.ready[0].status, 'booked')
eq('and an unknown one falls back rather than losing the row', r.ready[1].status, 'available')
eq('the company is stamped on', r.ready[0].entity_id, 'e1')
eq('and the site', r.ready[0].project_id, 'p1')

console.log('\n── A SALARY REGISTER ──')
const register = [
  { Name: 'R. Sharma', 'Emp Code': 'E-01', Basic: '30000', HRA: '12000', Conveyance: '1600', PAN: 'AAAPZ1234C', 'Date of Joining': '2024-04-01' },
  { Name: 'S. Iyer', 'Emp Code': 'E-02', Basic: '18000', HRA: '7200', Conveyance: '', PAN: '', 'Date of Joining': '' },
]
const staff = mapRows(register, 'employees', { entityId: 'e1' })
eq('both are ready', staff.ready.length, 2)
eq('the name came through', staff.ready[0].name, 'R. Sharma')
eq('the code too', staff.ready[0].code, 'E-01')
// The register has the pay in columns; the app keeps it in one object.
eq('the basic went into the pay', staff.ready[0].pay.basic, 30000)
eq('and the house rent allowance', staff.ready[0].pay.hra, 12000)
eq('a blank component is nought, not missing', staff.ready[1].pay.conveyance, 0)
eq('the PAN is kept', staff.ready[0].pan, 'AAAPZ1234C')
eq('and the joining date read as a date', staff.ready[0].joined_on, '2024-04-01')

console.log('\n── A VENDOR’S PRICE LIST ──')
// One row per material and one quotation per vendor and reference, which is
// what a quotation is.
const list = [
  { Vendor: 'Shakti Steel', Ref: 'Q-114', Date: '2026-06-12', Material: 'TMT 12mm', Quantity: '24000', Rate: '61.40', Unit: 'kg', GST: '18' },
  { Vendor: 'Shakti Steel', Ref: 'Q-114', Date: '2026-06-12', Material: 'TMT 16mm', Quantity: '8000', Rate: '60.90', Unit: 'kg', GST: '18' },
  { Vendor: 'UltraTech', Ref: 'C-889', Date: '2026-06-18', Material: 'OPC 53', Quantity: '1800', Rate: '392', Unit: 'bag', GST: '28' },
]
const quotes = mapRows(list, 'quotes', { entityId: 'e1' })
eq('three rows became two quotations', quotes.ready.length, 2)
eq('the first has both its materials', quotes.ready[0].lines.length, 2)
eq('and the second one', quotes.ready[1].lines.length, 1)
eq('the vendor came through', quotes.ready[0].vendor, 'Shakti Steel')
eq('the reference too', quotes.ready[0].ref, 'Q-114')
eq('and the rate on a line', quotes.ready[0].lines[0].rate, 61.4)
eq('with its tax', quotes.ready[0].lines[0].gst_percent, 18)
// Two references from one vendor are two quotations, not one with six lines.
const split = mapRows([
  { Vendor: 'Shakti Steel', Ref: 'Q-1', Material: 'A', Quantity: 1, Rate: 1 },
  { Vendor: 'Shakti Steel', Ref: 'Q-2', Material: 'B', Quantity: 1, Rate: 1 },
], 'quotes', { entityId: 'e1' })
eq('two references are two quotations', split.ready.length, 2)

console.log('\n── AND A FILE THAT IS NOT A SPREADSHEET ──')
// A .numbers document is a zip package, and nothing here reads one. Saying so
// beats "could not read file" about a file that is perfectly fine.
ok('a Numbers package is recognised', isNumbersPackage('Sales List.numbers'))
ok('an export of one is not', !isNumbersPackage('Sales List.xlsx'))
ok('and the person is told what to do', /Export To/.test(NUMBERS_NOTE), NUMBERS_NOTE)

console.log('\n── EVERY TARGET IS A REAL ONE ──')
eq('three things can be brought in', TARGET_IDS.join(','), 'units,employees,quotes')
ok('each says what it is for', TARGET_IDS.every((id) => TARGETS[id].label && TARGETS[id].noun))
ok('and shows the columns it expects', TARGET_IDS.every((id) => TARGETS[id].example.includes(',')))
ok('each has at least one column it cannot do without',
  TARGET_IDS.every((id) => Object.values(TARGETS[id].fields).some((f) => f.required)))
eq('an unknown target writes nothing', mapRows(sheet, 'nonsense').ready.length, 0)
eq('and an empty sheet is not an error', mapRows([], 'units', { entityId: 'e' }).ready.length, 0)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
