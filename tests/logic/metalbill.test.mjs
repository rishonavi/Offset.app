// Reading a jeweller's bill into a metal holding.
//
// Every assertion here is a way the number comes out wrong if the conversion is
// skipped. A bill quotes per gram and the app stores per 10 grams; a jewellery
// bill has two weights and only one of them is metal; and the total includes
// making charges that are not part of what the metal is worth.
import { fromBill, finenessFromKarat, rateToQuoteBasis, metalFromText } from '../../src/lib/metalBill.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, a === b, `${JSON.stringify(a)} !== ${JSON.stringify(b)}`)

console.log('\n── KARAT IS NOT FINENESS ──')
// 22/24 is 0.91666…, and the number stamped on the piece is 916 — which is what
// the purity picker has to match.
eq('22K is 916, not 917', finenessFromKarat(22), 916)
eq('18K is 750', finenessFromKarat(18), 750)
eq('24K is 999, the fine metal a rate buys', finenessFromKarat(24), 999)
eq('14K is 585', finenessFromKarat(14), 585)
eq('an unusual karat still converts', finenessFromKarat(20), 833)
eq('nonsense is unknown, not zero', finenessFromKarat(0), null)
eq('and so is more than pure', finenessFromKarat(30), null)

console.log('\n── WHAT THE RATE IS PER ──')
// The single most expensive mistake available here: a jeweller quotes per gram,
// the app stores gold per 10 grams. Carried across unchanged it is out by ten.
eq('gold at 7,200 a gram is 72,000 per 10g', rateToQuoteBasis(7200, 'per_gram', 'gold'), 72000)
eq('gold already per 10g is unchanged', rateToQuoteBasis(72000, 'per_10_gram', 'gold'), 72000)
// Silver is quoted per kilogram, so the same slip is a factor of a thousand.
eq('silver at 92 a gram is 92,000 per kg', rateToQuoteBasis(92, 'per_gram', 'silver'), 92000)
eq('silver already per kg is unchanged', rateToQuoteBasis(92000, 'per_kg', 'silver'), 92000)
// A tola is exactly 3/8 of a troy ounce, so this is a round trip rather than a
// constant somebody typed: 7,200 a gram priced per tola and converted back has
// to land on 72,000 per 10g, give or take the rounding money gets.
const perTola = 7200 * 11.6638038
ok('a tola of gold converts by its legal definition',
  Math.abs(rateToQuoteBasis(perTola, 'per_tola', 'gold') - 72000) < 0.05,
  String(rateToQuoteBasis(perTola, 'per_tola', 'gold')))
eq('a troy ounce does too',
  Math.abs(rateToQuoteBasis(7200 * 31.1034768, 'per_ozt', 'gold') - 72000) < 0.05, true)
eq('an unstated basis is unknown', rateToQuoteBasis(7200, null, 'gold'), null)
eq('and so is an unknown metal', rateToQuoteBasis(7200, 'per_gram', 'palladium'), null)

console.log('\n── A JEWELLERY BILL ──')
// 22K chain: gross 12.4g including 0.9g of stones, at 7,200 a gram, plus making
// and GST. The metal is 11.5g, and the holding must say so.
const chain = fromBill({
  metal: 'gold', gross_weight_g: 12.4, stone_weight_g: 0.9, net_weight_g: 11.5,
  purity_karat: 22, rate_amount: 7200, rate_basis: 'per_gram',
  metal_value: 82800, making_charges: 9936, tax: 2782, total: 95518,
  vendor: 'Tanishq', date: '2026-07-03',
})
eq('the metal is gold', chain.metal, 'gold')
eq('the weight is the net, not the gross', chain.metal_quantity, 11.5)
eq('recorded in grams', chain.metal_unit, 'g')
eq('purity comes across as fineness', chain.metal_fineness, 916)
eq('and the rate in the basis the app stores', chain.metal_rate, 72000)
eq('the value is what was actually paid', chain.value, 95518)
ok('with the making charges kept separate', chain.breakdown.making === 9936 && chain.breakdown.metalValue === 82800)
ok('and said to be excluded from the metal', chain.notes.includes('making_charges_excluded_from_metal'))

console.log('\n── WHEN ONLY A GROSS WEIGHT IS GIVEN ──')
const gross = fromBill({ metal: 'gold', gross_weight_g: 12.4, purity_fineness: 916, rate_amount: 72000, rate_basis: 'per_10_gram' })
eq('the gross is used, for want of anything better', gross.metal_quantity, 12.4)
ok('but it is flagged as gross', gross.notes.includes('weight_is_gross'))
const less = fromBill({ metal: 'gold', gross_weight_g: 12.4, stone_weight_g: 0.9, purity_karat: 22 })
eq('with stones itemised, the metal is the difference', less.metal_quantity, 11.5)
ok('and that is said too', less.notes.includes('weight_from_gross_less_stones'))

console.log('\n── A BULLION BILL ──')
const coin = fromBill({
  metal: 'silver', net_weight_g: 1000, purity_fineness: 999,
  rate_amount: 92000, rate_basis: 'per_kg', total: 95000, tax: 3000,
})
eq('a kilo of silver is a thousand grams', coin.metal_quantity, 1000)
eq('at its own quote basis', coin.metal_rate, 92000)
eq('fineness straight off the bill', coin.metal_fineness, 999)

console.log('\n── WHAT THE BILL DOES NOT SAY STAYS UNKNOWN ──')
// Number(null) and Number('') are both 0, which would turn "no rate given" into
// "worth nothing" — the confusion the whole metals module exists to avoid.
const sparse = fromBill({ metal: 'gold', net_weight_g: 8 })
eq('no rate is null, not zero', sparse.metal_rate, null)
eq('no purity is null, not zero', sparse.metal_fineness, null)
eq('no value is null, not zero', sparse.value, null)
ok('and the gaps are named', sparse.notes.includes('no_purity'))
const nothing = fromBill({})
eq('an unreadable bill yields no metal', nothing.metal, null)
eq('and no weight', nothing.metal_quantity, null)
ok('saying so', nothing.notes.includes('no_weight'))

console.log('\n── A RATE WITH NO STATED BASIS ──')
// Guessing between per-gram and per-10-gram is a coin flip on a factor of ten,
// so it is refused rather than assumed.
const noBasis = fromBill({ metal: 'gold', net_weight_g: 10, rate_amount: 7200, rate_basis: null })
eq('the rate is left out', noBasis.metal_rate, null)
ok('and the reason is given', noBasis.notes.includes('bill_rate_basis_unknown'))

console.log('\n── WORKING OUT THE METAL FROM WORDS ──')
eq('an English description', metalFromText('22K Gold Chain'), 'gold')
eq('silver in Hindi', metalFromText('चांदी का सिक्का'), 'silver')
eq('platinum wins over a passing mention of gold', metalFromText('Platinum band, gold plated clasp'), 'platinum')
eq('and nothing is nothing', metalFromText('Diamond ring'), null)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
