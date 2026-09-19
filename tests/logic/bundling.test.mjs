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
  // The cloud library. `hasSupabase` is two environment variables and a
  // Boolean, and it lived in the module that calls `createClient` — so asking
  // whether this build has a cloud downloaded the whole answer, on every route,
  // including demo builds that have no cloud and never call it. The flag is in
  // `cloudConfig.js` now and the client is fetched on first use.
  '@supabase/supabase-js': ['src/lib/supabaseClient.js'],
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
  ['src/lib/cloudConfig.js', '@supabase/supabase-js'],
  ['src/lib/storage/index.js', '@supabase/supabase-js'],
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

// Asking whether there is a cloud must cost nothing, which is the whole point
// of splitting the flag out of the module that builds the client.
const cfg = sourceOf('src/lib/cloudConfig.js')
eq('the cloud flag module imports nothing at all',
  cfg.split('\n').filter((l) => l.startsWith('import ')).length, 0)
ok('and answers from the environment', /import\.meta\.env\.VITE_SUPABASE_URL/.test(cfg), '')
// The client has to be reached through a function rather than a binding: a
// top-level `export const supabase = createClient(...)` is what made this eager
// in the first place, and it would be the natural thing to write again.
const sbc = sourceOf('src/lib/supabaseClient.js')
ok('the client is fetched, not built at module scope',
  /import\('@supabase\/supabase-js'\)/.test(sbc) && !/^export const supabase = createClient/m.test(sbc), '')
ok('and nothing else still imports a ready-made client',
  files.filter((f) => /import \{ supabase \}/.test(sourceOf(f))).length === 0,
  files.filter((f) => /import \{ supabase \}/.test(sourceOf(f))).join(', '))

console.log('\n── NOTHING IMPORTED AND THEN NOT USED ──')
// An import nobody uses is not tidiness. It is weight: the module it names goes
// into the chunk whether or not a line of it runs, which is how a page that had
// its payroll screen moved out of it went on shipping four statutory libraries
// to anybody opening a stock table.
//
// It is also the commonest leftover of a refactor, and the thing a linter would
// catch — except this project has four devDependencies and a test suite that
// prints PASS and FAIL, and adding a linter to guard one rule would be a large
// dependency doing less than the twenty lines below.
// `.` before a name means a property access — `a.map` is not the import `map`.
// But `...` is the spread operator, and `...balanceOf(x)` is a *use*. The first
// version of this did not tell the two apart and reported a function called on
// the very next line as dead; deleting what it flagged would have broken the
// advances screen. Spreads are blanked before scanning, which is safe because
// `...` is never part of a name.
const despread = (src) => src.replace(/\.\.\./g, '   ')
const NAMES = /(?:^|[^A-Za-z0-9_$.])([A-Za-z_$][A-Za-z0-9_$]*)/g
const importsOf = (src) => {
  const found = []
  const re = /^import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([\s\S]*?)\})?\s*(?:\*\s+as\s+([A-Za-z_$][\w$]*)\s*)?from\s*['"][^'"]+['"]/gm
  let m
  while ((m = re.exec(src))) {
    const names = []
    if (m[1]) names.push(m[1])
    if (m[3]) names.push(m[3])
    for (const part of (m[2] || '').split(',')) {
      // `loadPdf as load` is used under `load`, not under `loadPdf`.
      const n = part.trim().split(/\s+as\s+/).pop().trim()
      if (n) names.push(n)
    }
    for (const name of names) found.push({ name, statement: m[0] })
  }
  return found
}
// Used anywhere other than the import that declared it. The statement is cut
// out rather than the whole line, because one import can span several lines and
// one line can hold several imports.
const usedOutside = (src, name, statement) => {
  const rest = despread(src.replace(statement, ''))
  let m
  const re = new RegExp(NAMES.source, 'g')
  while ((m = re.exec(rest))) if (m[1] === name) return true
  return false
}
const deadImports = []
for (const f of files) {
  const src = sourceOf(f)
  for (const { name, statement } of importsOf(src)) {
    if (!usedOutside(src, name, statement)) deadImports.push(`${f.replace(/\\/g, '/')}: ${name}`)
  }
}
ok('nothing is imported and then never used', deadImports.length === 0, deadImports.slice(0, 8).join(' | '))
// The detector's own controls, because a detector that finds nothing looks
// exactly like a codebase with nothing to find — and one that finds too much is
// worse, since acting on it deletes working code.
const probe = (src) => importsOf(src).filter(({ name, statement }) => !usedOutside(src, name, statement)).map((x) => x.name)
eq('a named import that is used is not flagged',
  probe("import { a, b } from 'x'\nconsole.log(a)\n").join(','), 'b')
eq('nor a default one', probe("import def from 'y'\ndef()\n").length, 0)
eq('nor a namespace one', probe("import * as store from 'y'\nstore.list()\n").length, 0)
// The one that would have deleted working code: `...balanceOf(x)` is a use, and
// the dots of a spread are not a property access.
eq('a spread call counts as a use', probe("import { balanceOf } from 'x'\nconst a = { ...balanceOf(1) }\n").length, 0)
// While a genuine property access does not rescue an unused import.
eq('but a property of the same name does not', probe("import { map } from 'x'\nconst y = [].map(Number)\n").join(','), 'map')
// Renamed imports are judged by the name actually in use.
eq('a renamed import is judged by its new name', probe("import { loadPdf as load } from 'x'\nload()\n").length, 0)
eq('and flagged if the new name is unused', probe("import { loadPdf as load } from 'x'\n").join(','), 'load')
// JSX counts as use.
eq('one used only in JSX counts', probe("import Stat from './S'\nexport const A = () => <Stat />\n").length, 0)
// Two imports on one line, one used.
eq('several names on one line are judged separately',
  probe("import { a, b, c } from 'x'\na(); c()\n").join(','), 'b')

console.log('\n── NOR USED WITHOUT BEING IMPORTED ──')
// The mirror of the check above, and the dangerous direction of the two. An
// unused import is weight; a *missing* one is a ReferenceError at the moment
// somebody presses the button, and the build says nothing because a bare name
// is perfectly good JavaScript until it runs.
//
// Splitting the payroll screen out of `Operations.jsx` left it calling
// `balanceOf` and `canAdjust` without importing either. It built cleanly, and
// broke the moment anybody closed an advance out of a payroll run.
//
// Only names the library modules export are judged: this is not a scope
// analyser, it is a check that what a page calls, it has asked for.
const libExports = new Map()
for (const f of files.filter((x) => x.replace(/\\/g, '/').startsWith('src/lib'))) {
  const src = sourceOf(f)
  for (const m of src.matchAll(/^export (?:async )?(?:function|const|class) ([A-Za-z_$][\w$]*)/gm)) libExports.set(m[1], f)
  for (const m of src.matchAll(/^export \{([^}]*)\}/gm))
    for (const n of m[1].split(',')) {
      const t = n.trim().split(/\s+as\s+/).pop().trim()
      if (t) libExports.set(t, f)
    }
}
// Anything bound locally, including out of a destructuring — `const { addExpense
// } = useData()` is a declaration, and reading it as a missing import would
// bury the real finding under a page of noise.
const boundIn = (src) => {
  const names = new Set()
  for (const m of src.matchAll(/(?:^|[^A-Za-z0-9_$.])(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  // `const [plan, setPlan] = useState(...)` binds both. Missing this reported
  // every `setX` from a `useState` as an unimported library call, because the
  // storage layer happens to export a `setPlan` of its own.
  for (const m of src.matchAll(/(?:const|let|var)\s*\[([^\]]*)\]\s*=/g))
    for (const part of m[1].split(',')) {
      const t = part.trim().replace(/^\.\.\./, '').split('=')[0].trim()
      if (/^[A-Za-z_$][\w$]*$/.test(t)) names.add(t)
    }
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g))
    for (const part of m[1].split(',')) {
      const t = part.trim().split(':').pop().trim().replace(/^\.\.\./, '').split('=')[0].trim()
      if (/^[A-Za-z_$][\w$]*$/.test(t)) names.add(t)
    }
  // Parameters, including destructured props.
  for (const m of src.matchAll(/(?:function\s+[A-Za-z_$][\w$]*\s*|=>\s*|\(\s*)\(?\{([^}]*)\}\)?\s*(?:=>|\{)/g))
    for (const part of m[1].split(',')) {
      const t = part.trim().split(':').pop().trim().replace(/^\.\.\./, '').split('=')[0].trim()
      if (/^[A-Za-z_$][\w$]*$/.test(t)) names.add(t)
    }
  return names
}
const missing = []
for (const f of files) {
  const path = f.replace(/\\/g, '/')
  if (path.startsWith('src/lib')) continue
  const src = sourceOf(f)
  const have = new Set([...importsOf(src).map((i) => i.name), ...boundIn(src)])
  const seen = new Set()
  for (const m of despread(src).matchAll(/(?:^|[^A-Za-z0-9_$.])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) {
    const n = m[1]
    if (libExports.has(n) && !have.has(n) && !seen.has(n)) { seen.add(n); missing.push(`${path}: ${n}`) }
  }
}
ok('nothing calls a library function it never imported', missing.length === 0, missing.slice(0, 8).join(' | '))
// Controls, in both directions.
const okFile = "import { balanceOf } from '../../lib/advances'\nbalanceOf(1)\n"
eq('an imported call is fine', importsOf(okFile).length, 1)
const destructured = "const { addExpense } = useData()\naddExpense()\n"
ok('a name destructured out of a hook is not a missing import', boundIn(destructured).has('addExpense'), '')
const asProp = "export default function A({ budgetFor }) { return budgetFor(1) }\n"
ok('nor one arriving as a prop', boundIn(asProp).has('budgetFor'), '')
const renamedOut = "const { a: b } = x\n"
ok('nor one renamed on the way out of a destructuring', boundIn(renamedOut).has('b'), '')
// The one that produced the only two false positives: a setter out of
// `useState` shares its name with an export of the storage layer.
const stateful = "const [plan, setPlan] = useState(null)\nsetPlan(1)\n"
ok('nor a setter out of useState', boundIn(stateful).has('setPlan'), '')
ok('and the value beside it', boundIn(stateful).has('plan'), '')

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
