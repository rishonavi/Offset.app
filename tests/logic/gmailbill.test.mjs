// Turning a Gmail attachment into a row somebody can recognise.
//
// The picker on the expense form shows one line per attachment, and the
// material it has to work with is awkward: a From header is "Name <addr>", a
// subject is often a reference number, and a filename is usually
// "invoice.pdf". Getting a readable line out of that is worth testing away
// from a browser, because the alternative is fifteen rows that all say
// invoice.pdf.
import { billSummary } from '../../src/lib/gmail.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

// ── Who it is from ──────────────────────────────────────────────────────
eq('a named sender gives the name, not the address',
  billSummary({ from: 'Kadam Hardware <billing@kadam.example>' }).who, 'Kadam Hardware')
eq('a quoted name is unquoted',
  billSummary({ from: '"Kadam Hardware & Co." <billing@kadam.example>' }).who, 'Kadam Hardware & Co.')
eq('a bare address is shown as it is',
  billSummary({ from: 'billing@kadam.example' }).who, 'billing@kadam.example')
eq('an address in angle brackets alone loses the brackets',
  billSummary({ from: '<billing@kadam.example>' }).who, 'billing@kadam.example')
eq('no sender is an empty string, never "undefined"', billSummary({}).who, '')
eq('and neither is no candidate at all', billSummary().who, '')

// ── What it is ──────────────────────────────────────────────────────────
eq('the filename carries through', billSummary({ filename: 'TAX-INV-8841.pdf' }).file, 'TAX-INV-8841.pdf')
eq('a nameless attachment still says something', billSummary({}).file, 'Attachment')
eq('the subject is trimmed', billSummary({ subject: '  Invoice for September  ' }).subject, 'Invoice for September')

// ── How big it is ───────────────────────────────────────────────────────
// Base64 is four characters per three bytes, less the padding. Shown so
// nobody picks a 30MB scan on a site connection without being told.
const b64 = (n) => Buffer.from('x'.repeat(n)).toString('base64')
for (const n of [1, 2, 3, 100, 1023, 4096, 100_000]) {
  eq(`${n} bytes round-trips through the size estimate`, billSummary({ data: b64(n) }).bytes, n)
}
eq('no attachment data is zero, not NaN', billSummary({}).bytes, 0)
ok('and the estimate is always a number', Number.isFinite(billSummary({ data: 'not base64!' }).bytes))

// ── Nothing throws on rubbish ───────────────────────────────────────────
for (const junk of [null, undefined, 0, '', [], { from: 12 }, { subject: null }, { filename: false }]) {
  ok(`${JSON.stringify(junk) ?? 'undefined'} does not throw`,
    (() => { try { billSummary(junk); return true } catch { return false } })())
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
