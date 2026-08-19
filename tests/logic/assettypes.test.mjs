// Which fields an asset type actually has.
//
// Not every asset is a place. A car, a gold chain, a holding of stock and a
// wallet have no address, and a form that asks for one invites someone to type
// where the thing is kept — a different fact from the one the field means.
import { ASSET_TYPES, ADDRESSABLE_ASSET_TYPES, hasAddress } from '../../src/lib/constants.js'
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

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
