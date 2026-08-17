// Invoices: the template engine (including nesting), GST, numbering and words.
import * as T from '../../src/lib/invoiceTemplate.js'
import * as I from '../../src/lib/invoice.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)
const r = (tpl, tok, opt) => T.renderTemplate(tpl, tok, opt)

console.log('\n── VALUES ──')
eq('a token is filled', r('Hi {{client.name}}', { client: { name: 'Rahul' } }), 'Hi Rahul')
eq('a missing token becomes empty, not "undefined"', r('[{{nope.here}}]', {}), '[]')
eq('whitespace inside the braces is allowed', r('{{  client.name  }}', { client: { name: 'A' } }), 'A')

console.log('\n── ESCAPING ──')
eq('an ampersand cannot break the markup',
  r('{{client.name}}', { client: { name: 'Smith & Sons' } }), 'Smith &amp; Sons')
eq('nor can a script tag',
  r('{{c}}', { c: '<script>alert(1)</script>' }),
  '&lt;script&gt;alert(1)&lt;/script&gt;')
eq('escaping can be turned off for trusted output', r('{{c}}', { c: '<b>x</b>' }, { escape: false }), '<b>x</b>')

console.log('\n── LOOPS ──')
eq('each row is rendered',
  r('{{#each lines}}[{{description}}]{{/each}}', { lines: [{ description: 'A' }, { description: 'B' }] }),
  '[A][B]')
eq('a loop over nothing renders nothing', r('x{{#each lines}}y{{/each}}z', { lines: [] }), 'xz')
eq('a loop over a missing value renders nothing', r('x{{#each nope}}y{{/each}}z', {}), 'xz')
eq('the document is still reachable from inside a loop',
  r('{{#each lines}}{{issuer.name}}:{{description}} {{/each}}',
    { issuer: { name: 'Acme' }, lines: [{ description: 'A' }] }),
  'Acme:A ')

console.log('\n── CONDITIONS ──')
eq('a true condition includes its body', r('{{#if a}}yes{{/if}}', { a: 1 }), 'yes')
eq('a false one does not', r('{{#if a}}yes{{/if}}', { a: 0 }), '')
eq('an empty list is falsy', r('{{#if lines}}yes{{/if}}', { lines: [] }), '')
eq('unless is the other way round', r('{{#unless a}}no{{/unless}}', { a: 0 }), 'no')

console.log('\n── NESTING — the bug the shipped template found ──')
// A non-greedy regex ends the outer block at the inner {{/if}}, evaluating the
// wrong body and printing the leftover closing tag onto the invoice.
eq('an if inside an if, both true',
  r('{{#if a}}A{{#if b}}B{{/if}}{{/if}}', { a: 1, b: 1 }), 'AB')
eq('an if inside an if, inner false',
  r('{{#if a}}A{{#if b}}B{{/if}}{{/if}}', { a: 1, b: 0 }), 'A')
eq('an if inside an if, outer false — the inner must not leak',
  r('{{#if a}}A{{#if b}}B{{/if}}{{/if}}', { a: 0, b: 1 }), '')
ok('and no stray closing tag is ever printed',
  !r('{{#if a}}A{{#if b}}B{{/if}}{{/if}}', { a: 1, b: 1 }).includes('{{/if}}'))
// The real line from the default template.
const issuerLine = '{{#if issuer.email}}<p>{{issuer.email}}{{#if issuer.phone}} · {{issuer.phone}}{{/if}}</p>{{/if}}'
eq('the shipped issuer line, with both',
  r(issuerLine, { issuer: { email: 'a@b.com', phone: '99999' } }), '<p>a@b.com · 99999</p>')
eq('the shipped issuer line, email only',
  r(issuerLine, { issuer: { email: 'a@b.com' } }), '<p>a@b.com</p>')
eq('the shipped issuer line, neither', r(issuerLine, { issuer: {} }), '')
eq('three deep', r('{{#if a}}1{{#if b}}2{{#if c}}3{{/if}}{{/if}}{{/if}}', { a: 1, b: 1, c: 1 }), '123')
eq('an if inside an each',
  r('{{#each lines}}{{description}}{{#if hsn}}({{hsn}}){{/if}} {{/each}}',
    { lines: [{ description: 'A', hsn: '9954' }, { description: 'B' }] }),
  'A(9954) B ')
eq('an each inside an if',
  r('{{#if lines}}{{#each lines}}[{{n}}]{{/each}}{{/if}}', { lines: [{ n: 1 }, { n: 2 }] }), '[1][2]')
eq('different block kinds nest without confusing each other',
  r('{{#if a}}{{#unless b}}x{{/unless}}{{/if}}', { a: 1, b: 0 }), 'x')

console.log('\n── A BROKEN TEMPLATE IS NOT GUESSED AT ──')
const unclosed = r('start {{#if a}}body', { a: 1 })
ok('an unclosed block leaves the text alone rather than inventing a close',
  unclosed.includes('body'), unclosed)
ok('and it terminates', typeof unclosed === 'string')

console.log('\n── CHECKING A TEMPLATE BEFORE IT IS USED ──')
const good = T.analyseTemplate('{{invoice.number}} {{#each lines}}{{description}}{{/each}}')
eq('a sound template reports no unknown tokens', good.unknown.length, 0)
ok('and lists what it uses', good.used.length >= 2, JSON.stringify(good.used))
const typo = T.analyseTemplate('{{client.gst}}')
ok('a typo is caught at import time', typo.unknown.length > 0, JSON.stringify(typo.unknown))
ok('the shipped default template is itself clean',
  T.analyseTemplate(T.DEFAULT_TEMPLATE_HTML).unknown.length === 0,
  JSON.stringify(T.analyseTemplate(T.DEFAULT_TEMPLATE_HTML).unknown))
// The whole point of the nesting fix: the shipped template must render without
// leaving a closing tag on the page.
const rendered = T.renderTemplate(T.DEFAULT_TEMPLATE_HTML, I.invoiceTokens(I.buildInvoice({
  number: 'OF-2026-27-0001',
  issuer: { name: 'Acme', gstin: '27AAAPA1234A1Z5', email: 'a@b.com', phone: '99999 11111' },
  client: { name: 'Rahul Mehta', gstin: '27BBBPB5678B1Z9' },
  lines: [{ description: 'Rent for May', qty: 1, rate: 100000 }],
})))
ok('the shipped template renders with no leftover block tags',
  !/\{\{[#/]/.test(rendered), (rendered.match(/\{\{[^}]*\}\}/g) || []).slice(0, 3).join(' '))
ok('and no unfilled tokens', !/\{\{/.test(rendered), (rendered.match(/\{\{[^}]*\}\}/g) || []).slice(0, 3).join(' '))
ok('with both the email and the phone, which is the line that used to break',
  rendered.includes('a@b.com') && rendered.includes('99999 11111'))

console.log('\n── GST ──')
const MH = '27AAAPA1234A1Z5', MH2 = '27BBBPB5678B1Z9', KA = '29CCCPC9999C1Z1'
const lines = [{ description: 'Rent', qty: 1, rate: 100000 }]
const intra = I.buildInvoice({ lines, issuer: { gstin: MH }, client: { gstin: MH2 }, taxRate: 18 })
ok('within a state the tax splits into CGST and SGST',
  intra.cgst > 0 && intra.sgst > 0 && !intra.igst, JSON.stringify({c:intra.cgst,s:intra.sgst,i:intra.igst}))
eq('and the two halves are equal', intra.cgst, intra.sgst)
eq('which add up to the whole', I.round2(intra.cgst + intra.sgst), intra.taxTotal)
const inter = I.buildInvoice({ lines, issuer: { gstin: MH }, client: { gstin: KA }, taxRate: 18 })
ok('across states it is IGST instead',
  inter.igst > 0 && !inter.cgst && !inter.sgst, JSON.stringify({c:inter.cgst,s:inter.sgst,i:inter.igst}))
eq('and the total tax is the same either way', inter.taxTotal, intra.taxTotal)
eq('the payable is subtotal plus tax', intra.total, I.round2(intra.subtotal + intra.taxTotal))
eq('18% of a lakh is 18,000', intra.taxTotal, 18000)
// No GSTIN at all means no GST — an unregistered landlord does not charge it.
const none = I.buildInvoice({ lines, issuer: {}, client: {}, taxRate: 18 })
eq('with no GSTIN there is no tax', none.taxTotal, 0)
eq('and the total is just the subtotal', none.total, none.subtotal)
// Place of supply overrides the client's own state.
const shifted = I.buildInvoice({ lines, issuer: { gstin: MH }, client: { gstin: MH2 }, placeOfSupply: KA, taxRate: 18 })
ok('place of supply decides the split when it is given', shifted.igst > 0, JSON.stringify({c:shifted.cgst,s:shifted.sgst,i:shifted.igst}))
// A line may carry its own rate.
const mixed = I.buildInvoice({
  lines: [{ description: 'Rent', qty: 1, rate: 100000, taxRate: 18 }, { description: 'Water', qty: 1, rate: 10000, taxRate: 5 }],
  issuer: { gstin: MH }, client: { gstin: MH2 }, taxRate: 18,
})
eq('lines at different rates are taxed at their own', mixed.taxTotal, 18500)
eq('the grand total is the sum of what is printed',
  mixed.total, I.round2(mixed.lines.reduce((s, l) => s + l.amount, 0) + mixed.taxTotal))

console.log('\n── STATE CODES ──')
eq('a GSTIN starts with its state code', I.stateCode(MH), '27')
eq('a bare state code is accepted', I.stateCode('29'), '29')
ok('a well-formed GSTIN validates', I.isValidGSTIN(MH))
ok('a malformed one does not', !I.isValidGSTIN('nonsense'))
eq('same state is intra', I.taxKind(MH, MH2), 'intra')
eq('different states is inter', I.taxKind(MH, KA), 'inter')
eq('an unknown party means no tax at all', I.taxKind('', ''), 'none')

console.log('\n── AMOUNT IN WORDS (Indian) ──')
const w = I.amountInWords
ok('lakh, not hundred-thousand', /lakh/i.test(w(150000)), w(150000))
ok('crore for a big one', /crore/i.test(w(12500000)), w(12500000))
ok('paise are named when present', /paise/i.test(w(100.5)), w(100.5))
ok('a round amount says only, the way a cheque does', /only/i.test(w(1500)), w(1500))
ok('zero has a form', typeof w(0) === 'string' && w(0).length > 0, w(0))

console.log('\n── NUMBERING ──')
// The short form — FY 26-27 — is what Indian invoice numbers usually carry.
eq('the financial year runs April to March', I.financialYear('2026-05-02'), '26-27')
eq('and January is still the previous one', I.financialYear('2026-01-02'), '25-26')
eq('March is the last month of the old year', I.financialYear('2026-03-31'), '25-26')
eq('April starts the new one', I.financialYear('2026-04-01'), '26-27')
eq('the pattern fills the year and pads the sequence',
  I.nextNumber('INV-{FY}-{0001}', 7, '2026-05-02'), 'INV-26-27-0007')
eq('the padding width is whatever the pattern asks for',
  I.nextNumber('{000001}', 7, '2026-05-02'), '000007')
eq('a full year and month can be used instead',
  I.nextNumber('{YYYY}/{MM}/{001}', 3, '2026-05-02'), '2026/05/003')
ok('a sequence past the padding still fits',
  I.nextNumber('INV-{0001}', 12345, '2026-05-02').includes('12345'),
  I.nextNumber('INV-{0001}', 12345, '2026-05-02'))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
