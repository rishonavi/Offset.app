// The invariants that keep the theme honest.
//
// The app used to paint with the raw palette and repaint every one of those
// utilities under `.dark`, one rule per class. Two bugs came straight out of
// that: a near-white divider across every table (a `divide-` class nobody wrote
// an override for) and a near-black hairline on the Invoices totals (a token
// referenced by ten screens and never declared, so only the dark half existed).
//
// Neither could be caught by looking, and neither is a mistake anyone made
// twice on purpose — they are what the mechanism made easy. These check the
// mechanism instead.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const root = new URL('../../src/', import.meta.url).pathname
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const full = join(dir, f)
  return statSync(full).isDirectory() ? walk(full) : full.endsWith('.jsx') ? [full] : []
})
const files = walk(root)
const css = readFileSync(join(root, 'index.css'), 'utf8')

console.log('── EVERY TOKEN HAS BOTH HALVES ──')
// A token declared for one theme and not the other is invisible until someone
// switches. This is exactly how --color-border-subtle shipped: only the .dark
// half existed, so Tailwind generated no light rule at all and the borders fell
// back to currentColor.
const theme = css.slice(css.indexOf('@theme'), css.indexOf('\n}', css.indexOf('@theme')))
// There is more than one `.dark {` — one only sets color-scheme — and the token
// names now appear in the light block too, so neither "the first" nor "near
// this name" finds the ramp reliably. Take every .dark block and keep the one
// that actually declares colours; an extraction that can silently return
// nothing makes the orphan check below pass on an empty set.
const darkBlocks = [...css.matchAll(/\.dark \{[^}]*\}/g)].map((m) => m[0])
const darkBlock = darkBlocks.sort(
  (a, b) => (b.match(/--color-/g) || []).length - (a.match(/--color-/g) || []).length,
)[0] || ''
const declared = (block) => new Set([...block.matchAll(/(--color-[\w-]+)\s*:/g)].map((m) => m[1]))
const light = declared(theme)
const dark = declared(darkBlock)
ok('the light theme declares tokens', light.size > 10, `${light.size}`)
ok('the dark theme declares tokens', dark.size > 10, `${dark.size}`)
const orphans = [...dark].filter((t) => !light.has(t))
ok('no token is dark-only', orphans.length === 0, orphans.join(', '))

console.log('\n── COMPONENTS DO NOT PAINT WITH THE RAW PALETTE ──')
// A palette utility in a component needs a matching `.dark .thing` rule to work
// in both themes, and nothing makes anyone write it. A semantic token flips on
// its own, so there is no second rule to forget.
const PALETTE = /(?<![\w:-])(?:hover:|placeholder:|focus:|group-hover:)?(?:bg|text|border|divide)-slate-\d{2,3}(?![\w-])/g
// The one deliberate exception: a modal scrim is dark in both themes on
// purpose, because it exists to darken whatever is behind it.
const ALLOWED = new Set(['bg-slate-900/80'])
const offenders = []
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(PALETTE)) {
    const withOpacity = src.slice(m.index, m.index + m[0].length + 4).match(/^[\w:-]+(?:\/\d+)?/)[0]
    if (!ALLOWED.has(withOpacity)) offenders.push(`${f.replace(root, '')}: ${m[0]}`)
  }
}
ok('no component uses a raw slate utility', offenders.length === 0,
  `${offenders.length}: ${offenders.slice(0, 4).join(' | ')}`)

console.log('\n── AND NOTHING REPAINTS ONE ──')
// The overrides that made the old approach work. Their absence is the proof the
// components stopped needing them; their return would mean the pattern is back.
const repaints = [...css.matchAll(/^\.dark \.(?:hover\\:)?(?:bg|text|border|divide)-slate-[\d\\/]+/gm)].map((m) => m[0])
ok('no .dark rule repaints a slate utility', repaints.length === 0, repaints.slice(0, 4).join(' | '))

console.log('\n── DARK-ONLY VARIANTS ARE NOT NEEDED EITHER ──')
// `dark:text-slate-300` beside a token that already flips is a second opinion,
// and the two can disagree.
const darkVariants = []
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/dark:(?:hover:)?(?:bg|text|border|divide)-slate-\d{2,3}/g)) {
    darkVariants.push(`${f.replace(root, '')}: ${m[0]}`)
  }
}
ok('no component carries a dark: slate variant', darkVariants.length === 0,
  darkVariants.slice(0, 4).join(' | '))

console.log('\n── THE TOKENS COMPONENTS USE ACTUALLY EXIST ──')
// A typo in a class name fails silently: Tailwind generates nothing and the
// element inherits whatever was there. Every semantic name used has to resolve.
const SEMANTIC = /(?<![\w:-])(?:hover:|placeholder:|focus:|dark:)?(?:bg|text|border|divide)-(ink-\d|surface-[a-z]+|line(?:-soft)?|paper|hint|border-(?:light|subtle|strong))(?![\w-])/g
const used = new Set()
for (const f of files) {
  for (const m of readFileSync(f, 'utf8').matchAll(SEMANTIC)) used.add(m[1])
}
ok('components use the semantic names', used.size >= 8, `${used.size} distinct`)
const undeclared = [...used].filter((t) => !light.has(`--color-${t}`))
ok('every semantic name resolves to a declared token', undeclared.length === 0, undeclared.join(', '))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
