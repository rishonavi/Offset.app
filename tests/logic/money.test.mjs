// What the app will accept as money.
//
// The bound is not about big spenders. Past 2^53 JavaScript stops representing
// integers exactly, so a total containing such a number is quietly wrong — and
// a ledger that is quietly wrong is worse than one that refuses the entry.
import { MAX_AMOUNT, amountError, isSaneAmount, safeAmount, cleanAmount, cleanMoney, MONEY_FIELDS, isBlank } from '../../src/lib/money.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${e ? '  — ' + e : ''}`) }
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

console.log('\n── ORDINARY AMOUNTS ──')
for (const v of [1, 0.01, 4200, 9000000, 12345678.9, '4200', '0.5', 1e14]) {
  ok(`${v} is money`, isSaneAmount(v), String(amountError(v)))
}

console.log('\n── WHAT IS NOT ──')
eq('a number too big to add up is refused',
  Boolean(amountError(1e308)), true)
eq('and so is one just past the cap', Boolean(amountError(MAX_AMOUNT + 1e3)), true)
eq('but the cap itself is fine', amountError(MAX_AMOUNT), null)
ok('infinity is refused', Boolean(amountError(Infinity)))
ok('and NaN', Boolean(amountError(NaN)))
ok('and letters', Boolean(amountError('abc')))
ok('a negative amount is refused', /negative/.test(amountError(-1) || ''), String(amountError(-1)))
ok('and says which problem it was', /add up/.test(amountError(1e308) || ''), String(amountError(1e308)))

console.log('\n── BLANK IS NOT AN ERROR ──')
ok('an empty optional field is fine', amountError('') === null)
ok('and so is a missing one', amountError(null) === null && amountError(undefined) === null)
ok('but a required one says so', /Enter an amount/.test(amountError('', { required: true }) || ''))
ok('zero is refused where something is required',
  Boolean(amountError(0, { required: true })), String(amountError(0, { required: true })))
ok('and allowed where it is not', amountError(0) === null)
ok('and allowed explicitly', amountError(0, { required: true, allowZero: true }) === null)
ok('blank is recognised', isBlank('') && isBlank(null) && isBlank(undefined) && !isBlank(0))

console.log('\n── ROWS ALREADY IN THE FILE ──')
// A row written before this rule existed, or edited by hand, must not be able
// to poison a total that is only reading it.
eq('a sane stored amount is itself', safeAmount('4200'), 4200)
eq('an absurd one reads as zero', safeAmount(1e308), 0)
eq('so does infinity', safeAmount(Infinity), 0)
eq('so does rubbish', safeAmount('nonsense'), 0)
eq('so does a negative', safeAmount(-5), 0)
eq('and a missing one', safeAmount(undefined), 0)

console.log('\n── ON THE WAY IN ──')
// Blank is left exactly as it arrived: a missing budget and a budget of zero
// are different facts, and turning one into the other is its own corruption.
eq('a blank stays blank', cleanAmount(''), '')
eq('and a null stays null', cleanAmount(null), null)
eq('an undefined stays undefined', cleanAmount(undefined), undefined)
eq('a real amount comes through', cleanAmount('4200'), 4200)
eq('an absurd one is flattened to zero', cleanAmount(1e308), 0)
eq('and a negative', cleanAmount(-3), 0)

console.log('\n── A WHOLE ROW ──')
const dirty = { name: 'Flat', value: 1e308, monthly_budget: '', loan_principal: -5, notes: 'kept' }
const clean = cleanMoney(dirty, 'property')
eq('the absurd value is flattened', clean.value, 0)
eq('the blank budget is untouched', clean.monthly_budget, '')
eq('the negative principal is flattened', clean.loan_principal, 0)
eq('and everything else is left alone', clean.notes, 'kept')
ok('the original is not mutated', dirty.value === 1e308)
eq('an unknown kind passes through', cleanMoney({ amount: 1e308 }, 'nonsense').amount, 1e308)
eq('and a missing row does not crash', cleanMoney(null, 'expense'), null)
eq('an expense cleans its tax too', cleanMoney({ amount: 5, tax: 1e308 }, 'expense').tax, 0)
ok('every kind that stores money is listed',
  ['property', 'expense', 'income'].every((k) => MONEY_FIELDS[k]?.length))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
