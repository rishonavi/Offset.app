// What someone can change about how Offset looks, and the two places that have
// to agree about it.
import { readFileSync } from 'node:fs'
import { ACCENTS, DEFAULT_ACCENT, accentById, accentVars, initialsFrom, AVATAR_SYMBOLS } from '../../src/lib/appearance.js'

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
