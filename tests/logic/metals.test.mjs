// Metal holdings: units, purity, quoting conventions, and when a price is from.
import {
  UNITS, METALS, PURITIES, METAL_ASSET_TYPES, holdsMetal, defaultMetalFor,
  purityFactor, karatOf, toGrams, fromGrams, pricePerGram, quoteLabel,
  valueMetalHolding, describeHolding, totalMetalValue, resaleEstimate,
} from '../../src/lib/metals.js'
import {
  SESSION, isTradingDay, isOpen, lastClose, nextOpen, valuationDate, describeMarket,
} from '../../src/lib/marketHours.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)
const near = (n, a, b, tol = 1e-6) => ok(n, Math.abs(a - b) <= tol, `got ${a}, wanted ${b}`)

console.log('\n── UNITS ──')
eq('a gram is a gram', toGrams(1, 'g'), 1)
eq('a kilo is 1000 g', toGrams(1, 'kg'), 1000)
near('a tola is 11.6638038 g', toGrams(1, 'tola'), 11.6638038)
near('a troy ounce is 31.1034768 g', toGrams(1, 'ozt'), 31.1034768)
near('a tola is exactly 3/8 of a troy ounce', toGrams(1, 'tola'), toGrams(3 / 8, 'ozt'), 1e-6)
eq('an unknown unit is refused, not guessed', toGrams(1, 'pounds'), null)
eq('a non-numeric quantity is refused', toGrams('heavy', 'g'), null)
eq('a numeric string is accepted', toGrams('2.5', 'g'), 2.5)
near('grams convert back out', fromGrams(1000, 'kg'), 1)
near('round-trips through tola', fromGrams(toGrams(7, 'tola'), 'tola'), 7)

console.log('\n── PURITY ──')
eq('916 is 0.916 exactly, not 0.9159999999999999', purityFactor(916), 0.916)
ok('and the naive division really is wrong', 91.6 / 100 !== 0.916)
eq('999 is 0.999', purityFactor(999), 0.999)
eq('purity above 1000 is refused', purityFactor(1100), null)
eq('zero purity is refused', purityFactor(0), null)
eq('916 is 22 karat', karatOf(916), 22)
eq('999 rounds to 24 karat', karatOf(999), 24)
eq('750 is 18 karat', karatOf(750), 18)
ok('gold offers 22K, the common Indian purity', PURITIES.gold.some((p) => p.fineness === 916))
ok('silver offers sterling', PURITIES.silver.some((p) => p.fineness === 925))

console.log('\n── QUOTING CONVENTIONS ──')
eq('gold is quoted per 10 grams', METALS.gold.quotePer, 10)
eq('silver is quoted per kilogram', METALS.silver.quoteUnit, 'kg')
eq('₹75,000 per 10g gold is ₹7,500 a gram', pricePerGram('gold', 75000), 7500)
eq('₹95,000 per kg silver is ₹95 a gram', pricePerGram('silver', 95000), 95)
eq('an unknown metal has no price', pricePerGram('unobtainium', 1000), null)
eq('a negative rate is refused', pricePerGram('gold', -1), null)
eq('the gold quote is labelled per 10 g', quoteLabel('gold'), 'per 10 g')
eq('the silver quote is labelled per kg', quoteLabel('silver'), 'per kg')

console.log('\n── VALUING A HOLDING ──')
// 10 g of 999 gold at ₹75,000/10g is exactly the quoted rate.
eq('10 g of fine gold is one quoted unit',
  valueMetalHolding({ metal: 'gold', quantity: 10, unit: 'g', fineness: 999, rate: 75000 }).value,
  round2(10 * 0.999 * 7500))
// A 22K chain is worth its gold content, not the headline rate.
const chain = valueMetalHolding({ metal: 'gold', quantity: 20, unit: 'g', fineness: 916, rate: 75000 })
eq('a 20 g 22K chain holds 18.32 g of fine gold', chain.fineGrams, 18.32)
eq('and is worth its fine content', chain.value, 137400)
ok('which is less than the gross-weight figure', chain.value < 20 * 7500)
const kilo = valueMetalHolding({ metal: 'silver', quantity: 2, unit: 'kg', fineness: 999, rate: 95000 })
eq('2 kg of fine silver is 2000 g', kilo.grams, 2000)
eq('and worth about two quoted units', kilo.value, round2(2000 * 0.999 * 95))
const tola = valueMetalHolding({ metal: 'gold', quantity: 1, unit: 'tola', fineness: 999, rate: 75000 })
near('a tola of fine gold prices off its gram weight', tola.value, 11.6638038 * 0.999 * 7500, 0.01)

console.log('\n── WHAT IT REFUSES TO GUESS ──')
const norate = valueMetalHolding({ metal: 'gold', quantity: 10, unit: 'g', fineness: 916 })
eq('with no rate the value is unknown, not zero', norate.value, null)
eq('but the fine weight is still known', norate.fineGrams, 9.16)
eq('a negative holding is rejected', valueMetalHolding({ metal: 'gold', quantity: -5, rate: 75000 }).value, null)
ok('and says so', /negative/i.test(valueMetalHolding({ metal: 'gold', quantity: -5, rate: 75000 }).error))
ok('no metal is rejected', /pick a metal/i.test(valueMetalHolding({ quantity: 5, rate: 1 }).error))
ok('a bad unit is named in the error', /furlong/.test(valueMetalHolding({ metal: 'gold', quantity: 5, unit: 'furlong', rate: 1 }).error))
eq('purity defaults to the metal default when unset',
  valueMetalHolding({ metal: 'gold', quantity: 10, unit: 'g', rate: 75000 }).fineness, 916)

console.log('\n── ASSET TYPES ──')
ok('jewellery holds metal', holdsMetal('Jewellery'))
ok('the precious metals type holds metal', holdsMetal('Precious Metals — Gold / Silver'))
ok('a villa does not', !holdsMetal('Real Estate — Villa / House'))
eq('jewellery defaults to gold', defaultMetalFor('Jewellery'), 'gold')
// The type label names two metals; a regex over it would pick one at random.
eq('the two-metal type still defaults to gold, not whichever the label names first',
  defaultMetalFor('Precious Metals — Gold / Silver'), 'gold')
eq('a non-metal type has no default metal', defaultMetalFor('Aircraft'), null)
ok('both metal types exist in the app asset list', METAL_ASSET_TYPES.length === 2)

console.log('\n── DESCRIBING A HOLDING ──')
eq('a plain fine-gram holding reads simply',
  describeHolding({ metal: 'gold', quantity: 10, unit: 'g', fineness: 999 }),
  '10 g of 24K gold · 9.99 g fine')
ok('a 22K holding spells out the fine weight',
  /18.32 g fine/.test(describeHolding({ metal: 'gold', quantity: 20, unit: 'g', fineness: 916 })),
  describeHolding({ metal: 'gold', quantity: 20, unit: 'g', fineness: 916 }))
ok('silver is described by fineness, not karat',
  /925/.test(describeHolding({ metal: 'silver', quantity: 100, unit: 'g', fineness: 925 })))

console.log('\n── TOTALS ──')
const t = totalMetalValue([
  { metal: 'gold', quantity: 10, unit: 'g', fineness: 999, rate: 75000 },
  { metal: 'silver', quantity: 1, unit: 'kg', fineness: 999, rate: 95000 },
  { metal: 'gold', quantity: 5, unit: 'g', fineness: 916 }, // no rate
])
eq('unpriced holdings are counted separately', t.unpriced.length, 1)
eq('two of the three are priced', t.priced, 2)
ok('the unpriced one is not added in as zero', t.value > 0)
eq('but its metal still counts toward the fine weight',
  Math.round(t.fineGrams * 100) / 100,
  Math.round((10 * 0.999 + 1000 * 0.999 + 5 * 0.916) * 100) / 100)
eq('an empty portfolio totals zero', totalMetalValue([]).value, 0)

console.log('\n── RESALE ──')
const r = resaleEstimate({ value: 100000, makingChargePct: 12, wastagePct: 3 })
eq('making charges and wastage come off', r.estimate, 85000)
eq('and are named as unrecoverable', r.notRecovered, 15000)
eq('with no charges the estimate is the metal value', resaleEstimate({ value: 50000 }).estimate, 50000)
ok('a nonsense value is refused', resaleEstimate({ value: -1 }) === null)

console.log('\n── MARKET HOURS (all in IST, whatever the browser thinks) ──')
// 2026-08-11 is a Tuesday. 10:00 IST = 04:30 UTC.
const tueMorning = new Date('2026-08-11T04:30:00Z')
const tueLateNight = new Date('2026-08-11T18:30:00Z') // 00:00 IST Wednesday
const satNoon = new Date('2026-08-15T06:30:00Z')      // Saturday 12:00 IST
const sunNight = new Date('2026-08-16T20:30:00Z')     // 02:00 IST Monday
eq('the session opens at 9am', SESSION.openMin, 540)
ok('a Tuesday is a trading day', isTradingDay(tueMorning))
ok('a Saturday is not', !isTradingDay(satNoon))
ok('the market is open on a Tuesday morning', isOpen(tueMorning))
ok('and shut at midnight', !isOpen(tueLateNight))
ok('and shut all weekend', !isOpen(satNoon))

console.log('\n── DATING A VALUATION ──')
eq('a Saturday price is Friday\'s close', valuationDate(satNoon), '2026-08-14')
// 02:00 IST Monday is still the weekend as far as prices go.
eq('an early Monday-morning price is still Friday\'s', valuationDate(sunNight), '2026-08-14')
eq('a Tuesday morning price is Monday\'s close, since Tuesday has not closed', valuationDate(tueMorning), '2026-08-10')
ok('the last close is never in the future', lastClose(satNoon) <= satNoon)
ok('the last close is never in the future, mid-session either', lastClose(tueMorning) <= tueMorning)
ok('the next open is always ahead', nextOpen(satNoon) > satNoon)
eq('the next open after Saturday is Monday', valuationDate(new Date(nextOpen(satNoon).getTime() + 20 * 3600e3)), '2026-08-17')

console.log('\n── HOLIDAYS, WHEN YOU SUPPLY THEM ──')
const holidays = ['2026-08-14'] // pretend Friday is a holiday
eq('a holiday is skipped back over', valuationDate(satNoon, holidays), '2026-08-13')
ok('and the holiday itself is not a trading day', !isTradingDay(new Date('2026-08-14T06:30:00Z'), holidays))
// A pathological list must not hang.
const allHolidays = Array.from({ length: 40 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`)
ok('an absurd holiday list terminates instead of spinning', lastClose(satNoon, allHolidays) instanceof Date)

console.log('\n── SAYING HOW STALE ──')
ok('an open market says so', describeMarket(tueMorning).open)
ok('a weekend says it is closed', /closed/i.test(describeMarket(satNoon).text))
eq('a Saturday is one day stale', describeMarket(satNoon).daysStale, 1)
ok('a Sunday says two days', describeMarket(new Date('2026-08-16T06:30:00Z')).daysStale === 2,
  String(describeMarket(new Date('2026-08-16T06:30:00Z')).daysStale))

console.log('\n── TIMEZONE INDEPENDENCE ──')
// The same instant must give the same answer regardless of the host zone.
const before = valuationDate(satNoon)
process.env.TZ = 'America/New_York'
eq('the answer does not move with the host timezone', valuationDate(satNoon), before)
process.env.TZ = 'Asia/Kolkata'
eq('nor in IST', valuationDate(satNoon), before)

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100 }

console.log('\n── ABSENT IS NOT ZERO ──')
for (const empty of [null, undefined, '', '   ']) {
  const r = valueMetalHolding({ metal: 'gold', quantity: 10, unit: 'g', fineness: 916, rate: empty })
  ok(`rate ${JSON.stringify(empty)} means unknown, not zero`, r.value === null, `got ${r.value}`)
}
eq('an empty-string rate has no per-gram price', pricePerGram('gold', ''), null)
eq('a null rate has no per-gram price', pricePerGram('gold', null), null)
eq('an empty-string quantity is refused', toGrams('', 'g'), null)
eq('a whitespace quantity is refused', toGrams('  ', 'g'), null)
// But a real zero rate is a real answer.
eq('an explicit zero rate really is zero', pricePerGram('gold', 0), 0)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
