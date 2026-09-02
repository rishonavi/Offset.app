// What someone can change about how Offset looks, and the two places that have
// to agree about it.
import { readFileSync } from 'node:fs'
import {
  ACCENTS, DEFAULT_ACCENT, accentById, accentVars, initialsFrom, AVATAR_SYMBOLS,
  TONES, DEFAULT_TONE, toneById, schemeVars, chromeVars, schemeStyle, hueOfHex, accentHueOf,
  LIGHT_UNTINTED, chromeColour, hexFromOklch,
} from '../../src/lib/appearance.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

console.log('── THE ACCENTS ON OFFER ──')
ok('there are few enough to choose from at a glance', ACCENTS.length >= 3 && ACCENTS.length <= 8, `${ACCENTS.length}`)
ok('every accent has an id, a name and a hue', ACCENTS.every((a) => a.id && a.name && typeof a.hue === 'number'))
ok('no two share an id', new Set(ACCENTS.map((a) => a.id)).size === ACCENTS.length)
ok('no two share a hue', new Set(ACCENTS.map((a) => a.hue)).size === ACCENTS.length)
ok('every hue is a real angle', ACCENTS.every((a) => a.hue >= 0 && a.hue < 360))
ok('the default is one of them', ACCENTS.some((a) => a.id === DEFAULT_ACCENT))
ok('the default is the gold the app already shipped', DEFAULT_ACCENT === 'gold')

console.log('\n── AN UNKNOWN CHOICE FALLS BACK ──')
// A stale localStorage value from a removed accent must not leave the app with
// no accent at all.
ok('a name nobody offers gives the default', accentById('chartreuse').id === DEFAULT_ACCENT)
ok('so does nothing at all', accentById(undefined).id === DEFAULT_ACCENT)
ok('so does a non-string', accentById(42).id === DEFAULT_ACCENT)
ok('a real id is kept', accentById('indigo').id === 'indigo')

console.log('\n── WHAT AN ACCENT SETS ──')
const vars = accentVars(accentById('indigo').hue)
for (const key of ['--color-gold', '--color-gold-dark', '--color-brand', '--color-brand-dark', '--color-brand-light']) {
  ok(`${key} is set`, typeof vars[key] === 'string' && vars[key].startsWith('oklch('))
}
// `gold` and `brand` are two names for one colour. Setting one and not the
// other would re-tint half the interface and leave the rest gold.
ok('gold and brand stay the same colour', vars['--color-gold'] === vars['--color-brand'])

console.log('\n── HUE VARIES, LIGHTNESS DOES NOT ──')
// This is the whole safety argument. 142 places use these tokens as fills, as
// borders, and as text on both the navy sidebar and a white card — every one of
// those is a question about lightness. Hold it and they all keep gold's answer.
const lightnessOf = (v) => v.match(/oklch\(([\d.]+)/)[1]
const goldVars = accentVars(accentById('gold').hue)
for (const a of ACCENTS) {
  const v = accentVars(a.hue)
  const same = Object.keys(goldVars).every((k) => lightnessOf(v[k]) === lightnessOf(goldVars[k]))
  ok(`${a.name} sits at gold's lightness`, same)
}
ok('and the hue actually changes', new Set(ACCENTS.map((a) => accentVars(a.hue)['--color-gold'])).size === ACCENTS.length)

console.log('\n── THE PRE-PAINT SCRIPT AGREES WITH THE LIBRARY ──')
// index.html sets the accent before any module loads, so it carries its own
// copy of the hues. If the two drift, someone who chose a colour sees the wrong
// one for a frame — which is exactly what that script exists to prevent.
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const inline = html.match(/var hues = \{([^}]*)\}/)
ok('the script still declares its hues', !!inline)
if (inline) {
  const declared = Object.fromEntries(
    inline[1].split(',').map((pair) => {
      const [k, v] = pair.split(':')
      return [k.trim(), Number(v)]
    }),
  )
  ok('it lists exactly the accents on offer', Object.keys(declared).sort().join() === ACCENTS.map((a) => a.id).sort().join(),
    `${Object.keys(declared).sort().join()} vs ${ACCENTS.map((a) => a.id).sort().join()}`)
  for (const a of ACCENTS) {
    ok(`${a.name}'s hue matches`, declared[a.id] === a.hue, `${declared[a.id]} vs ${a.hue}`)
  }
  // The shades are duplicated too, so they are checked the same way.
  for (const [token, shade] of [['--color-gold', '0.7245 0.0998'], ['--color-gold-dark', '0.7665 0.1387'], ['--color-brand-light', '0.9533 0.0184']]) {
    ok(`${token}'s shade matches`, html.includes(`'${token}', 'oklch(${shade} '`), shade)
  }
}

console.log('\n── THE BASE TONES ──')
ok('there are few enough to choose from at a glance', TONES.length >= 3 && TONES.length <= 8, `${TONES.length}`)
ok('each has an id, a name, a hue and a chroma', TONES.every((t) => t.id && t.name && typeof t.hue === 'number' && typeof t.chroma === 'number'))
ok('no two share an id', new Set(TONES.map((t) => t.id)).size === TONES.length)
ok('every hue is a real angle', TONES.every((t) => t.hue >= 0 && t.hue < 360))
// A chroma above 1 would push the ramp past the colour it was measured at, and
// zero would make every tone identical.
ok('every chroma is a fraction of the original', TONES.every((t) => t.chroma > 0 && t.chroma <= 1))
ok('the default is one of them', TONES.some((t) => t.id === DEFAULT_TONE))
ok('an unknown tone falls back rather than breaking', toneById('mauve').id === DEFAULT_TONE)
ok('and so does nothing at all', toneById(undefined).id === DEFAULT_TONE)

console.log('\n── A SCHEME SETS BOTH HALVES OF EVERY TOKEN ──')
// The border-subtle bug in one line: a token set for one theme and not the
// other is invisible until somebody switches.
const lightVars = schemeVars({ tone: 'forest', accentHue: 200, dark: false })
const darkVars = schemeVars({ tone: 'forest', accentHue: 200, dark: true })
ok('the light half sets tokens', Object.keys(lightVars).length > 10, `${Object.keys(lightVars).length}`)
ok('the dark half sets tokens', Object.keys(darkVars).length > 10, `${Object.keys(darkVars).length}`)
const onlyDark = Object.keys(darkVars).filter((k) => !(k in lightVars))
const onlyLight = Object.keys(lightVars).filter((k) => !(k in darkVars))
ok('the light half lacks nothing the dark half has, except by decision',
  onlyDark.join() === LIGHT_UNTINTED.map((n) => `--color-${n}`).join(), onlyDark.join(', '))
ok('and the dark half lacks nothing at all', onlyLight.length === 0, onlyLight.join(', '))
ok('every value is a colour', Object.values({ ...lightVars, ...darkVars }).every((v) => v.startsWith('oklch(')))

console.log('\n── HUE MOVES, LIGHTNESS DOES NOT ──')
// The same argument the accents rest on, for the other half of the interface.
const navyDark = schemeVars({ tone: 'navy', accentHue: 82.35, dark: true })
for (const t of TONES) {
  const v = schemeVars({ tone: t.id, accentHue: 82.35, dark: true })
  ok(`${t.name} keeps every lightness`, Object.keys(navyDark).every((k) => lightnessOf(v[k]) === lightnessOf(navyDark[k])))
}
ok('and the tones are not all the same colour',
  new Set(TONES.map((t) => schemeVars({ tone: t.id, dark: true })['--color-surface-page'])).size === TONES.length)

console.log('\n── THE CHROME COMES WITH IT ──')
// Without this the sidebar stayed navy while every surface around it changed.
ok('navy follows the tone', chromeVars('forest')['--color-navy'] !== chromeVars('navy')['--color-navy'])
ok('and so does its darker shade', chromeVars('forest')['--color-navy-dark'] !== chromeVars('navy')['--color-navy-dark'])
ok('at the same lightness', lightnessOf(chromeVars('forest')['--color-navy']) === lightnessOf(chromeVars('navy')['--color-navy']))

console.log('\n── A COLOUR SOMEBODY PICKED ──')
ok('a teal gives a teal hue', Math.abs(hueOfHex('#0d9488') - 184.7) < 1, `${hueOfHex('#0d9488')}`)
ok('a red gives a red hue', hueOfHex('#ff0000') > 25 && hueOfHex('#ff0000') < 35, `${hueOfHex('#ff0000')}`)
ok('the leading hash is optional', hueOfHex('0d9488') !== null)
// atan2(0, 0) is 0, which would silently turn every grey into red.
ok('a grey has no hue to take', hueOfHex('#808080') === null)
ok('white has none either', hueOfHex('#ffffff') === null)
ok('black has none either', hueOfHex('#000000') === null)
ok('nonsense gives nothing', hueOfHex('nope') === null && hueOfHex('') === null && hueOfHex(null) === null)
ok('a short hex is refused rather than guessed', hueOfHex('#fff') === null)

console.log('\n── AN ACCENT IS A NAME OR A HUE ──')
ok('a preset resolves by name', accentHueOf('gold') === accentById('gold').hue)
ok('a number is taken as a hue', accentHueOf('197') === 197)
ok('and so is a real number', accentHueOf(262) === 262)
ok('a hue past the circle wraps', accentHueOf(400) === 40)
ok('a negative hue wraps too', accentHueOf(-20) === 340)
// Otherwise an unrecognised value would land on hue 0 rather than the default.
ok('an unknown name falls back to the default accent', accentHueOf('chartreuse') === accentById(DEFAULT_ACCENT).hue)
ok('so does an empty string', accentHueOf('') === accentById(DEFAULT_ACCENT).hue)

console.log('\n── THE STYLESHEET IT WRITES ──')
const css = schemeStyle({ accent: '197', tone: 'plum' })
ok('it has a light block', css.includes(':root{'))
ok('it has a dark block', css.includes('.dark{'))
ok('the accent reaches the brand tokens', css.includes('--color-gold:oklch(0.7245 0.0998 197)'))
ok('and nothing is left undefined', !/:\s*(undefined|NaN)/.test(css), css.slice(0, 120))

console.log('\n── THE PRE-PAINT SCRIPT KNOWS THE SAME TONES ──')
// Same drift risk as the hue table above: index.html carries its own copy so
// the ground is right before the app loads, and a copy can fall behind.
const tonesInline = html.match(/var tones = \{([\s\S]*?)\};/)
ok('the script still declares its tones', !!tonesInline)
if (tonesInline) {
  const declared = Object.fromEntries(
    [...tonesInline[1].matchAll(/(\w+):\s*\[([\d.]+),\s*([\d.]+)\]/g)].map((m) => [m[1], [Number(m[2]), Number(m[3])]]),
  )
  ok('it lists exactly the tones on offer',
    Object.keys(declared).sort().join() === TONES.map((t) => t.id).sort().join(),
    `${Object.keys(declared).sort().join()} vs ${TONES.map((t) => t.id).sort().join()}`)
  for (const t of TONES) {
    ok(`${t.name} matches`, declared[t.id] && declared[t.id][0] === t.hue && declared[t.id][1] === t.chroma,
      JSON.stringify(declared[t.id]))
  }
}

console.log('\n── THE COLOUR THE OPERATING SYSTEM IS TOLD ──')
ok('the default is a hex, not an oklch', /^#[0-9a-f]{6}$/.test(chromeColour('navy')), chromeColour('navy'))
ok('and it is dark enough to be chrome', parseInt(chromeColour('navy').slice(1, 3), 16) < 60)
ok('every tone gives its own', new Set(TONES.map((t) => chromeColour(t.id))).size === TONES.length)
// A round trip through OKLCH and back must land on the colour it started from,
// or the status bar and the sidebar drift apart by a shade nobody chose.
const back = hexFromOklch(0.7245, 0.0998, 82.35)
ok('a known colour survives the conversion', back.toLowerCase() === '#c5a059', back)
ok('an out-of-gamut chroma is clamped rather than wrapped',
  /^#[0-9a-f]{6}$/.test(hexFromOklch(0.5, 0.4, 120)), hexFromOklch(0.5, 0.4, 120))

// index.html carries the same six values so the bar is right before any script
// runs, and a second copy is a second thing to fall behind.
const chromeInline = html.match(/var chrome = \{([\s\S]*?)\};/)
ok('the script still declares the chrome colours', !!chromeInline)
if (chromeInline) {
  const declared = Object.fromEntries(
    [...chromeInline[1].matchAll(/(\w+):\s*'(#[0-9a-f]{6})'/g)].map((m) => [m[1], m[2]]),
  )
  ok('it lists exactly the tones on offer',
    Object.keys(declared).sort().join() === TONES.map((t) => t.id).sort().join(),
    Object.keys(declared).sort().join())
  for (const t of TONES) {
    ok(`${t.name}'s bar colour matches`, declared[t.id] === chromeColour(t.id),
      `${declared[t.id]} vs ${chromeColour(t.id)}`)
  }
}

console.log('\n── INITIALS ──')
ok('a full name gives first and last', initialsFrom('Rishona Vishal', 'x@y.com') === 'RV')
ok('a middle name is ignored', initialsFrom('Ada Byron Lovelace', 'x@y.com') === 'AL')
ok('one name gives two letters', initialsFrom('Priya', 'x@y.com') === 'PR')
ok('extra spacing does not confuse it', initialsFrom('  Ada   Lovelace  ', 'x@y.com') === 'AL')
ok('no name falls back to the address', initialsFrom('', 'krish@example.com') === 'KR')
ok('a blank name is the same as none', initialsFrom('   ', 'krish@example.com') === 'KR')
ok('neither one gives something rather than nothing', initialsFrom('', '') === 'U')
ok('a one-letter address does not crash', initialsFrom('', 'k@example.com') === 'K')
ok('the result is always upper case', initialsFrom('ada lovelace', '') === 'AL')

console.log('\n── SYMBOLS ──')
ok('there is a short row rather than a grid', AVATAR_SYMBOLS.length >= 4 && AVATAR_SYMBOLS.length <= 12, `${AVATAR_SYMBOLS.length}`)
ok('none is repeated', new Set(AVATAR_SYMBOLS).size === AVATAR_SYMBOLS.length)
ok('all are non-empty', AVATAR_SYMBOLS.every((s) => typeof s === 'string' && s.trim().length > 0))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
