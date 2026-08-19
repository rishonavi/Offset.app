// Which fields an asset type actually has.
//
// Not every asset is a place. A car, a gold chain, a holding of stock and a
// wallet have no address, and a form that asks for one invites someone to type
// where the thing is kept — a different fact from the one the field means.
import {
  ASSET_TYPES, ADDRESSABLE_ASSET_TYPES, hasAddress,
  FINANCEABLE_ASSET_TYPES, canBeFinanced, LEASABLE_ASSET_TYPES, canBeLeased,
} from '../../src/lib/constants.js'
import { METAL_ASSET_TYPES, holdsMetal } from '../../src/lib/metals.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

console.log('\n── WHAT HAS AN ADDRESS ──')
for (const type of ['Real Estate — Apartment / Flat', 'Real Estate — Villa / House', 'Real Estate — Commercial', 'Land / Plot']) {
  ok(`${type} has one`, hasAddress(type))
}
// "Other" is the unknown case: someone filing a warehouse under it should still
// be able to say where it is. A field nobody fills costs less than a missing one.
ok('Other keeps it, because Other could be anything', hasAddress('Other'))

console.log('\n── WHAT DOES NOT ──')
for (const type of ['Vehicle / Car', 'Yacht / Boat', 'Aircraft', 'Machinery / Equipment', 'Jewellery',
                    'Precious Metals — Gold / Silver', 'Stocks / Equity', 'Mutual Funds / Bonds',
                    'Cryptocurrency', 'Art / Collectibles']) {
  ok(`${type} does not`, !hasAddress(type))
}

console.log('\n── THE LIST CANNOT DRIFT FROM THE TYPES ──')
// A renamed asset type would leave a string here that matches nothing, and the
// address field would quietly stop appearing for a kind of property. Nothing
// else would fail, which is why this is asserted rather than assumed.
const unknown = ADDRESSABLE_ASSET_TYPES.filter((t) => !ASSET_TYPES.includes(t))
ok('every addressable type is a real asset type', unknown.length === 0, unknown.join(', '))
const unknownMetal = METAL_ASSET_TYPES.filter((t) => !ASSET_TYPES.includes(t))
ok('and so is every metal type', unknownMetal.length === 0, unknownMetal.join(', '))

// An asset that is a quantity of metal is a thing you hold, not a place.
const both = ASSET_TYPES.filter((t) => hasAddress(t) && holdsMetal(t))
ok('nothing is both a place and a quantity of metal', both.length === 0, both.join(', '))

console.log('\n── AND NOTHING IS AMBIGUOUS ──')
ok('an unrecognised type has no address', !hasAddress('Spaceship'))
ok('nor does an empty one', !hasAddress(''))
ok('nor undefined', !hasAddress(undefined))
ok('every shipped type gives a straight yes or no',
  ASSET_TYPES.every((t) => typeof hasAddress(t) === 'boolean'))

console.log('\n── WHAT CAN CARRY A LOAN ──')
for (const type of ['Real Estate — Apartment / Flat', 'Land / Plot', 'Vehicle / Car', 'Yacht / Boat',
                    'Aircraft', 'Machinery / Equipment', 'Art / Collectibles', 'Other']) {
  ok(`${type} can`, canBeFinanced(type))
}
// India-first: a gold loan is among the most common secured borrowing there is,
// so leaving bullion and jewellery out would be a Western default.
ok('Jewellery can — gold loans are ordinary here', canBeFinanced('Jewellery'))
ok('and so can bullion', canBeFinanced('Precious Metals — Gold / Silver'))
// A facility against a portfolio has no EMI and no payoff date, so recording
// one against a single line would misstate both.
for (const type of ['Stocks / Equity', 'Mutual Funds / Bonds', 'Cryptocurrency']) {
  ok(`${type} cannot — a portfolio facility is not an EMI`, !canBeFinanced(type))
}

console.log('\n── WHAT CAN BE LET OUT ──')
for (const type of ['Real Estate — Commercial', 'Real Estate — Villa / House', 'Land / Plot',
                    'Vehicle / Car', 'Yacht / Boat', 'Aircraft', 'Machinery / Equipment', 'Other']) {
  ok(`${type} can be leased`, canBeLeased(type))
}
for (const type of ['Jewellery', 'Precious Metals — Gold / Silver', 'Stocks / Equity',
                    'Mutual Funds / Bonds', 'Cryptocurrency', 'Art / Collectibles']) {
  ok(`${type} cannot have a tenant`, !canBeLeased(type))
}

console.log('\n── THE TWO ARE NOT THE SAME QUESTION ──')
// Tenancy is the narrower of the two: everything you can let out, you could
// have financed, but not the reverse — a gold loan does not come with a tenant.
const leasableButNotFinanceable = ASSET_TYPES.filter((t) => canBeLeased(t) && !canBeFinanced(t))
ok('anything lettable could also have been financed', leasableButNotFinanceable.length === 0,
  leasableButNotFinanceable.join(', '))
ok('but not the other way round', ASSET_TYPES.some((t) => canBeFinanced(t) && !canBeLeased(t)))

const strayFinance = FINANCEABLE_ASSET_TYPES.filter((t) => !ASSET_TYPES.includes(t))
ok('every financeable type is a real asset type', strayFinance.length === 0, strayFinance.join(', '))
const strayLease = LEASABLE_ASSET_TYPES.filter((t) => !ASSET_TYPES.includes(t))
ok('every leasable type is too', strayLease.length === 0, strayLease.join(', '))

// A purely financial holding is name, type, value and notes — nothing else on
// the form applies to it.
for (const type of ['Stocks / Equity', 'Mutual Funds / Bonds', 'Cryptocurrency']) {
  ok(`${type} shows none of the three blocks`,
    !hasAddress(type) && !canBeFinanced(type) && !canBeLeased(type))
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
