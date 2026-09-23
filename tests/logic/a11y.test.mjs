// The accessibility settings model.
//
// Worth testing away from the browser because every one of these is a promise
// to somebody who cannot use the app without it: that the setting they chose
// is the setting that gets written, that a corrupt stored value degrades to
// "off" rather than to a blank screen, and that there is always a way back to
// normal.
import { readFileSync } from 'node:fs'
import {
  DEFAULTS, STEPS, SCALES, ALIGNMENTS, STORAGE_KEY,
  sanitise, isDefault, activeCount, cycle, filterFor, varsFor, flagsFor, styleFor,
  applyA11y, readStored, writeStored,
} from '../../src/lib/a11y.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

// ── The shape holds together ────────────────────────────────────────────
// Three objects have to agree about which settings exist. They are written
// out separately for readability, which means they can drift apart.
ok('every setting has a step count', Object.keys(DEFAULTS).every((k) => STEPS[k] >= 2),
  Object.keys(DEFAULTS).filter((k) => !STEPS[k]).join(', '))
ok('no setting has a step count without being a setting',
  Object.keys(STEPS).every((k) => k in DEFAULTS), Object.keys(STEPS).filter((k) => !(k in DEFAULTS)).join(', '))
ok('every stepped scale is as long as its step count',
  Object.entries(SCALES).every(([k, v]) => v.length === STEPS[k]),
  Object.entries(SCALES).filter(([k, v]) => v.length !== STEPS[k]).map(([k]) => k).join(', '))
eq('alignment has a value per step', ALIGNMENTS.length, STEPS.align)
// Index 0 is "leave it alone" everywhere, which is what lets `varsFor` decide
// whether to write a property by truthiness alone.
ok('step zero is inert in every scale',
  Object.values(SCALES).every((v) => v[0] === null || v[0] === 1) && ALIGNMENTS[0] === null)

// ── Nothing on, nothing written ─────────────────────────────────────────
eq('the defaults are the defaults', sanitise(null), DEFAULTS)
ok('the defaults are default', isDefault(DEFAULTS))
eq('nothing is active by default', activeCount(DEFAULTS), 0)
eq('and no filter is produced', filterFor(DEFAULTS), '')
eq('and no custom properties', varsFor(DEFAULTS), {})
ok('and no flags', Object.values(flagsFor(DEFAULTS)).every((v) => v === null))

// ── A stored value cannot break the app ─────────────────────────────────
for (const junk of [undefined, null, 0, '', 'nonsense', [], [1, 2], true, NaN]) {
  ok(`${JSON.stringify(junk) ?? 'undefined'} sanitises to the defaults`,
    isDefault(sanitise(junk)), JSON.stringify(sanitise(junk)))
}
eq('an out-of-range step falls back to off', sanitise({ fontSize: 99 }).fontSize, 0)
eq('a negative step falls back to off', sanitise({ fontSize: -3 }).fontSize, 0)
eq('a fractional step is truncated, not rounded up past the end',
  sanitise({ fontSize: 3.9 }).fontSize, 3)
eq('a string step is read as a number', sanitise({ contrast: '2' }).contrast, 2)
eq('a non-numeric step is off', sanitise({ contrast: 'high' }).contrast, 0)
eq('a truthy value for a toggle is a boolean', sanitise({ invert: 'yes' }).invert, true)
eq('unknown keys are dropped', Object.keys(sanitise({ invert: true, mystery: 7 })).sort(),
  Object.keys(DEFAULTS).sort())
// The highest step must survive, or the top of every scale is unreachable.
for (const [key, steps] of Object.entries(STEPS)) {
  if (steps === 2) continue
  eq(`${key} keeps its highest step`, sanitise({ [key]: steps - 1 })[key], steps - 1)
}

// ── Cycling always comes home ───────────────────────────────────────────
// The way out of a setting somebody cannot read is the same button that got
// them there. If a cycle did not close, a person who turned the contrast up
// too far would have to find the reset — which they may not be able to see.
for (const [key, steps] of Object.entries(STEPS)) {
  let s = { ...DEFAULTS }
  const seen = []
  for (let i = 0; i < steps; i++) { s = cycle(s, key); seen.push(s[key]) }
  ok(`${key} returns to its default after ${steps} presses`, s[key] === DEFAULTS[key],
    `ended at ${JSON.stringify(s[key])} via ${JSON.stringify(seen)}`)
  ok(`${key} visits every step on the way`, new Set(seen.map(String)).size === steps,
    JSON.stringify(seen))
}
eq('cycling a key that does not exist changes nothing', cycle(DEFAULTS, 'nope'), DEFAULTS)
eq('cycling one setting leaves the others alone',
  { ...cycle({ ...DEFAULTS, invert: true }, 'contrast'), contrast: 0 }, { ...DEFAULTS, invert: true })

// ── The filter composes ─────────────────────────────────────────────────
ok('invert rotates the hue back', filterFor({ ...DEFAULTS, invert: true }).includes('hue-rotate(180deg)'),
  filterFor({ ...DEFAULTS, invert: true }))
eq('grayscale alone', filterFor({ ...DEFAULTS, grayscale: true }), 'grayscale(1)')
// Two ways of saying the same thing; saying both is just a slower grayscale.
eq('low saturation defers to grayscale', filterFor({ ...DEFAULTS, grayscale: true, saturation: true }), 'grayscale(1)')
ok('but stands on its own', filterFor({ ...DEFAULTS, saturation: true }).startsWith('saturate('))
eq('contrast uses the scale, not the step number',
  filterFor({ ...DEFAULTS, contrast: 2 }), `contrast(${SCALES.contrast[2]})`)
{
  const all = filterFor({ ...DEFAULTS, invert: true, grayscale: true, contrast: 1 })
  eq('everything at once is one filter with three parts', all.split(') ').length, 4)
  ok('  and invert comes first', all.startsWith('invert('), all)
}

// ── Only what is on gets written ────────────────────────────────────────
eq('a font size writes one property', varsFor({ ...DEFAULTS, fontSize: 2 }),
  { '--a11y-font-scale': String(SCALES.fontSize[2]) })
eq('alignment writes a logical value, not left or right',
  varsFor({ ...DEFAULTS, align: 3 })['--a11y-align'], 'end')
ok('no property is ever written as the string "null"',
  Object.values(varsFor({ ...DEFAULTS, fontSize: 1, lineHeight: 1, letterSpacing: 1, align: 1 }))
    .every((v) => v !== 'null' && v != null))
// Line height and letter spacing get a flag each, and neither may raise the
// other's. They started out sharing one, which made the line-height rule live
// whenever letter spacing alone was on — and that rule's `!important` fallback
// then overrode Tailwind's line-heights across the app for a setting nobody
// had touched.
eq('line height raises only its own flag',
  [flagsFor({ ...DEFAULTS, lineHeight: 1 })['data-a11y-lh'], flagsFor({ ...DEFAULTS, lineHeight: 1 })['data-a11y-ls']],
  ['', null])
eq('letter spacing raises only its own flag',
  [flagsFor({ ...DEFAULTS, letterSpacing: 1 })['data-a11y-lh'], flagsFor({ ...DEFAULTS, letterSpacing: 1 })['data-a11y-ls']],
  [null, ''])
// Text size needs no flag: it rides a custom property that already defaults to
// 1, so the rule is always live and always inert until somebody changes it.
eq('text size raises no flag at all',
  Object.values(flagsFor({ ...DEFAULTS, fontSize: 3 })).filter((v) => v !== null), [])

// ── Applying it to a document ───────────────────────────────────────────
// A stand-in for documentElement: enough of the interface to prove the writes
// and, more importantly, the removals.
const fakeRoot = () => {
  const attrs = new Map(), props = new Map()
  return {
    attrs, props, style: {
      filter: '',
      setProperty: (k, v) => props.set(k, v),
      removeProperty: (k) => props.delete(k),
    },
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k),
  }
}
{
  const root = fakeRoot()
  applyA11y({ ...DEFAULTS, invert: true, fontSize: 2, links: true }, root)
  ok('the filter reaches the element', root.style.filter.includes('invert('), root.style.filter)
  eq('the scale reaches the element', root.props.get('--a11y-font-scale'), String(SCALES.fontSize[2]))
  ok('the flag reaches the element', root.attrs.has('data-a11y-links'))
  // Written first as `!has('data-a11y-invert') === false`, which is `has(...)`
  // — it passed, under a name claiming the opposite, on a setting that was on.
  ok('and a flag that is off is not set', !root.attrs.has('data-a11y-dyslexia'),
    [...root.attrs.keys()].join(', '))

  // Turning things off has to remove them. Leaving a stale custom property or
  // attribute behind is how a setting stays on after the person turned it off,
  // which is the worst outcome here: they cannot find what is doing it.
  applyA11y(DEFAULTS, root)
  eq('turning everything off clears the filter', root.style.filter, '')
  eq('  and removes every custom property', root.props.size, 0)
  eq('  and removes every attribute', root.attrs.size, 0)
}
ok('applying to nothing does not throw', (() => { try { applyA11y(DEFAULTS, null); return true } catch { return false } })())

// ── Storage ─────────────────────────────────────────────────────────────
const fakeStore = () => {
  const m = new Map()
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }
}
{
  const store = fakeStore()
  writeStored({ ...DEFAULTS, contrast: 2 }, store)
  ok('a choice is stored', store.m.has(STORAGE_KEY))
  eq('and reads back', readStored(store).contrast, 2)
  writeStored(DEFAULTS, store)
  ok('but the defaults are not stored', !store.m.has(STORAGE_KEY))
  eq('and an absent key reads as the defaults', readStored(store), DEFAULTS)

  store.m.set(STORAGE_KEY, '{ this is not json')
  eq('unparseable storage reads as the defaults', readStored(store), DEFAULTS)
  store.m.set(STORAGE_KEY, '{"contrast":99,"invert":true}')
  eq('a stored value out of range is clamped on the way in', readStored(store), { ...DEFAULTS, invert: true })
}
{
  // A browser with storage switched off throws on every access. The app has to
  // keep working, unstyled by preference rather than broken.
  const hostile = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') }, removeItem: () => { throw new Error('denied') } }
  eq('storage that throws reads as the defaults', readStored(hostile), DEFAULTS)
  ok('and writing to it does not throw',
    (() => { try { writeStored({ ...DEFAULTS, invert: true }, hostile); return true } catch { return false } })())
}

// ── A round trip through everything ─────────────────────────────────────
{
  let s = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS)) s = cycle(s, key)
  eq('with one step on each, everything is active', activeCount(s), Object.keys(DEFAULTS).length)
  ok('  and that is not the default', !isDefault(s))
  const store = fakeStore()
  writeStored(s, store)
  eq('  and it survives a round trip', readStored(store), s)
  const style = styleFor(s)
  ok('  and produces a filter', style.filter.length > 0)
  ok('  and four custom properties', Object.keys(style.vars).length === 4, JSON.stringify(style.vars))
  ok('  and every flag', Object.values(style.flags).every((v) => v === ''), JSON.stringify(style.flags))
}

// ── The copy of this file that runs before this file ────────────────────
//
// index.html carries an ES5 transcription of applyA11y, because the settings
// have to be on the document before any module loads — a person who inverted
// the page did it to avoid being shown a bright one, and applying it after
// first paint shows them exactly that, once per navigation.
//
// Duplicated logic rots. The accent above it has carried the same duplication
// for a while on the strength of a comment asking people to be careful. A
// comment is not a mechanism; this is. Every number in the inline script is
// read back out of the HTML and checked against the scales here.
{
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  // The literal is written *before* the index it is subscripted with —
  //   var fs = [1, 1.15, ...][a11y.fontSize | 0]
  // — so reading forward from "a11y.fontSize" lands on the next line's array.
  // The first version did exactly that and reported four mismatches that were
  // all its own; keying on the assignment is what actually finds the table.
  const table = (assignment) => {
    const at = html.indexOf(assignment)
    if (at < 0) return null
    const open = html.indexOf('[', at)
    return JSON.parse(html.slice(open, html.indexOf(']', open) + 1).replace(/'/g, '"'))
  }
  eq('the inline script uses the same font scale', table('var fs = '), SCALES.fontSize)
  eq('  the same line heights', table('var lh = '), [0, ...SCALES.lineHeight.slice(1)])
  eq('  the same letter spacings', table('var ls = '), [0, ...SCALES.letterSpacing.slice(1)])
  eq('  the same alignments', table('var al = '), [0, ...ALIGNMENTS.slice(1)])
  eq('  the same contrast steps', table("f.push('contrast("), [0, ...SCALES.contrast.slice(1)])
  // And the same filter strings, character for character, or an inverted page
  // would shift hue for one frame on every load.
  for (const piece of ['invert(1) hue-rotate(180deg)', 'grayscale(1)', 'saturate(0.45)']) {
    ok(`  and the exact filter string ${piece.split('(')[0]}`, html.includes(piece))
  }
  // Every flag the stylesheet reads has to be set by the inline script too,
  // or the setting arrives a frame late.
  for (const attr of Object.keys(flagsFor(DEFAULTS))) {
    ok(`  and sets ${attr} before paint`, html.includes(attr), 'missing from index.html')
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
