// What a visitor downloads before they can read anything.
//
// The app shipped 1.27 MB to open the dashboard and 1.80 MB to open a materials
// tab, and almost none of it was the app. Three of the heaviest libraries in the
// project were reaching first paint through imports that had nothing to do with
// drawing or exporting anything:
//
//   `normalizeDate` lived in `exports.js`, which statically imports xlsx and
//   jspdf. `papers.js` and `intake.js` wanted that one forty-line date function
//   and got three quarters of a megabyte of spreadsheet and PDF libraries with
//   it, on every screen that reads a document.
//
//   recharts was imported at the top of the dashboard and of Personal — 367 kB
//   of charting in front of the first paint of both, on pages whose headline
//   figures are all text and whose rings are explicitly decoration, carrying
//   `aria-hidden` with a key in words underneath.
//
//   jspdf was imported at the top of Reports, by everybody who came to read the
//   figures on screen and never pressed the export button.
//
// None of that is visible in a diff. A static import costs nothing to write and
// the number it moves is on a page nobody measures, so this is a ratchet: the
// heavy libraries may be reached only from the modules that exist to load them,
// and adding one anywhere else fails here rather than quietly costing every
// visitor a third of a megabyte.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { callable } from '../../src/lib/pdfLib.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, got, want) => ok(n, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f)
  return statSync(p).isDirectory() ? walk(p) : /\.jsx?$/.test(p) ? [p] : []
})
const files = walk('src')
const sourceOf = (f) => readFileSync(f, 'utf8')

// A static import is `import … from 'pkg'` at the top level. A dynamic one is
// `import('pkg')`, which is the whole point, so it must not match.
//
// Braced specifier lists run over several lines when they are long, and the
// first version of this read one line at a time — so `DashboardCharts.jsx`,
// which imports twelve things from recharts across three lines, did not look
// like a recharts import at all. A ratchet that cannot see the most ordinary
// way of writing the thing it guards is not a ratchet, so the braces are
// flattened first and there is a control below proving it now catches one.
const flatten = (src) => src.replace(/import\s*\{[^}]*\}\s*from/g, (m) => m.replace(/\s+/g, ' '))
const staticallyImports = (src, pkg) =>
  new RegExp(`^import\\s[^\\n]*['"]${pkg}(/[^'"]*)?['"]`, 'm').test(flatten(src))

console.log('\n── THE HEAVY LIBRARIES, AND WHO MAY REACH THEM ──')
// Each may be imported statically only from the module whose job is to carry
// it. Everything else loads that module with `import()`.
const ALLOWED = {
  xlsx: ['src/lib/exports.js', 'src/lib/officeTemplate.js'],
  jspdf: ['src/lib/pdfLib.js', 'src/lib/exports.js'],
  'jspdf-autotable': ['src/lib/pdfLib.js', 'src/lib/exports.js'],
  recharts: ['src/components/SpendRing.jsx', 'src/components/DashboardCharts.jsx'],
  html2canvas: [],
  'pdfjs-dist': [],
  'tesseract.js': [],
}
for (const [pkg, allowed] of Object.entries(ALLOWED)) {
  const offenders = files.filter((f) => staticallyImports(sourceOf(f), pkg))
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => !allowed.includes(f))
  ok(`${pkg} is only imported statically where it is meant to be`, offenders.length === 0,
    `also in ${offenders.join(', ')}`)
}
// The control. Without it the loop above passes just as happily on a project
// that stopped using any of these, and would go on passing after somebody
// deleted the charts entirely.
ok('and the charts really do import recharts',
  ['src/components/SpendRing.jsx', 'src/components/DashboardCharts.jsx']
    .every((f) => staticallyImports(sourceOf(f), 'recharts')), '')
// The detector's own control, because the detector is the thing most likely to
// be quietly wrong: it missed the three-line recharts import in
// `DashboardCharts.jsx` on the first try, which is the commonest way anybody
// would actually write one.
ok('a one-line import is seen', staticallyImports("import X from 'xlsx'\n", 'xlsx'), '')
ok('a braced one is seen', staticallyImports("import { a } from 'xlsx'\n", 'xlsx'), '')
ok('and one spread over three lines is seen',
  staticallyImports("import {\n  a, b,\n  c,\n} from 'xlsx'\n", 'xlsx'), '')
ok('a subpath is seen', staticallyImports("import x from 'pdfjs-dist/build/pdf'\n", 'pdfjs-dist'), '')
// And the whole point: a dynamic import is not a static one.
ok('while a dynamic import is not', !staticallyImports("const m = await import('xlsx')\n", 'xlsx'), '')
ok('nor one inside a promise', !staticallyImports("Promise.all([import('jspdf')])\n", 'jspdf'), '')
// Nor is a different package that merely starts the same way.
ok('nor a package with a longer name', !staticallyImports("import x from 'xlsx-style'\n", 'xlsx'), '')

console.log('\n── AND THE PAGES THAT USED TO CARRY THEM ──')
// Named rather than covered by the loop, because these are the four regressions
// that actually happened and the ones most likely to happen again.
for (const [f, pkg] of [
  ['src/pages/Dashboard.jsx', 'recharts'],
  ['src/pages/Personal.jsx', 'recharts'],
  ['src/pages/Reports.jsx', 'jspdf'],
  ['src/lib/readDate.js', 'xlsx'],
]) ok(`${f.split('/').pop()} does not pull in ${pkg}`, !staticallyImports(sourceOf(f), pkg), '')
// `normalizeDate` is the one that dragged xlsx and jspdf into every document
// screen, so its new home has to stay light.
const readDate = sourceOf('src/lib/readDate.js')
ok('and reads dates with nothing heavier than date-fns',
  /^import \{ format, isValid, parseISO \} from 'date-fns'$/m.test(readDate)
  && readDate.split('\n').filter((l) => l.startsWith('import ')).length === 1,
  readDate.split('\n').filter((l) => l.startsWith('import ')).join(' | '))

console.log('\n── ONE COPY OF THE INTEROP RULE ──')
// CommonJS through a dynamic import comes back wrapped, and how many times
// depends on the package and the bundler. A static import gets one layer
// unwrapped for free, which is why `.default || module` is right there and
// wrong here — Reports moved from static to dynamic, kept that line, and threw
// `t is not a function` on every export until this was shared.
eq('a bare function is already callable', callable(() => 'x', 'x')(), 'x')
eq('one wrapper is unwrapped', callable({ default: () => 'x' }, 'x')(), 'x')
eq('so is two', callable({ default: { default: () => 'x' } }, 'x')(), 'x')
eq('and three', callable({ default: { default: { default: () => 'x' } } }, 'x')(), 'x')
// It has to give up rather than loop, and say which library failed rather than
// letting a TypeError surface from inside a PDF call.
let threw = ''
try { callable({ nothing: true }, 'The PDF table plugin') } catch (e) { threw = e.message }
ok('something that never unwraps to a function is refused', threw.length > 0, threw)
ok('naming the library that failed', /The PDF table plugin/.test(threw), threw)
ok('and saying what cannot happen as a result', /nothing to make a PDF with/.test(threw), threw)
// A cycle would spin forever without the bound.
let looped = ''
const cyclic = {}; cyclic.default = cyclic
try { callable(cyclic, 'x') } catch (e) { looped = e.message }
ok('and a wrapper that never ends does not hang', looped.length > 0, looped)
// One copy: two of these is one of them going stale, which is exactly what
// happened.
const unwrappers = files.filter((f) => /for \(let i = 0; i < 4 && found/.test(sourceOf(f)))
eq('the unwrapping rule is written down once', unwrappers.length, 1)
eq('in pdfLib', unwrappers[0]?.replace(/\\/g, '/'), 'src/lib/pdfLib.js')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
