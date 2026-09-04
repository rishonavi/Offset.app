// Which fields an asset type actually has.
//
// Not every asset is a place. A car, a gold chain, a holding of stock and a
// wallet have no address, and a form that asks for one invites someone to type
// where the thing is kept — a different fact from the one the field means.
import {
  ASSET_TYPES, ADDRESSABLE_ASSET_TYPES, hasAddress,
  FINANCEABLE_ASSET_TYPES, canBeFinanced, LEASABLE_ASSET_TYPES, canBeLeased,
  ASSET_GROUPS, shortTypeLabel, exampleNameFor,
} from '../../src/lib/constants.js'
import { METAL_ASSET_TYPES, holdsMetal } from '../../src/lib/metals.js'
import { iconForAssetType } from '../../src/lib/assetIcon.js'

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

console.log('\n── THE PICKER SHOWS ALL OF THEM ──')
// The guard that matters: the picker is a hand-written grouping, so a type
// added above and forgotten here would be one nobody could ever choose.
const grouped = ASSET_GROUPS.flatMap((g) => g.types)
ok('every type is in a group', ASSET_TYPES.every((t) => grouped.includes(t)),
  ASSET_TYPES.filter((t) => !grouped.includes(t)).join(', '))
ok('and no group invents one', grouped.every((t) => ASSET_TYPES.includes(t)),
  grouped.filter((t) => !ASSET_TYPES.includes(t)).join(', '))
ok('none is in two groups at once', new Set(grouped).size === grouped.length)
ok('every group is named and non-empty', ASSET_GROUPS.every((g) => g.label && g.types.length))

console.log('\n── HOW THEY READ ──')
ok('a long type reads as its tail', shortTypeLabel('Real Estate — Apartment / Flat') === 'Apartment / Flat',
  shortTypeLabel('Real Estate — Apartment / Flat'))
ok('and one with no dash is left alone', shortTypeLabel('Jewellery') === 'Jewellery')
ok('a blank one does not crash', shortTypeLabel() === '')
ok('every type has an example name', ASSET_TYPES.every((t) => exampleNameFor(t).length > 2))
ok('a car is not offered a flat as an example', exampleNameFor('Vehicle / Car') === 'BMW X5')
ok('and an unknown type still gets something', exampleNameFor('Nonsense').length > 2)

console.log('\n── EVERY TYPE LOOKS LIKE ITSELF ──')
// Seven of the fifteen used to fall through to the same box, which put three
// identical icons in a row and made the picker harder to scan, not easier.
const icons = new Map(ASSET_TYPES.map((t) => [t, iconForAssetType(t)]))
const shared = ASSET_TYPES.filter((t) => t !== 'Other' && icons.get(t) === iconForAssetType('nothing at all'))
ok('no type falls back to the generic box', shared.length === 0, shared.join(', '))
const distinct = new Set([...icons.values()])
ok('and they are nearly all distinct', distinct.size >= ASSET_TYPES.length - 3, `${distinct.size} icons for ${ASSET_TYPES.length} types`)

// Distinctness alone was not enough: it passed while a painter's palette sat
// on "Apartment / Flat", because apArTment contains art. What each type shows
// has to be checked by name.
const named = (a, b) => ok(`${a} and ${b} do not share an icon`, icons.get(a) !== icons.get(b),
  `both ${icons.get(a)?.displayName || icons.get(a)?.name}`)
named('Real Estate — Apartment / Flat', 'Art / Collectibles')
ok('a flat looks like a building, not a painting',
  icons.get('Real Estate — Apartment / Flat') === icons.get('Real Estate — Villa / House'))
ok('and every kind of real estate agrees',
  icons.get('Real Estate — Commercial') === icons.get('Real Estate — Apartment / Flat'))
ok('a plot is not a building', icons.get('Land / Plot') !== icons.get('Real Estate — Apartment / Flat'))
ok('an aircraft is not a piece of art', icons.get('Aircraft') !== icons.get('Art / Collectibles'))
ok('an unknown type still gets an icon rather than nothing', Boolean(iconForAssetType('Racehorse')))
ok('and a blank one does too', Boolean(iconForAssetType()))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
