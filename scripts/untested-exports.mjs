// Every export that no test so much as mentions.
//
//   npx vite-node scripts/untested-exports.mjs
//
// This is how the last stretch of this audit chose what to look at, and it
// earned the place: once targets were picked this way rather than by reading
// files, the next two things opened were both real bugs — `₹∞` on a stat card
// from `format.js`, and rows vanishing out of a spreadsheet import in
// `exports.js`. An export nothing tests is where this codebase's faults have
// consistently lived. It is the same blind spot that produced six storage
// functions reaching for a client nobody fetched, an `authHeader.js` that never
// sent a token, and a `cloudReportsAvailable` that threw on call.
//
// **Deliberately crude, and the asymmetry is the point.** A mention is not a
// test: a name that appears once in a comment counts as covered here and may
// have no assertion anywhere. So the output is not a coverage figure and must
// not be read as one. What it is good for is the other direction — a name
// nothing mentions is *certainly* untested — and that one-sided claim is strong
// enough to pick the next thing to read.
//
// It is in `scripts/` and not `tests/` on purpose: `scripts/sweep.sh` globs
// `tests/<dir>/*.mjs` and would run this as a suite, which it is not.
//
// Sibling of `tests/logic/deadwiring.test.mjs`, which asks a narrower question
// — which exports nothing *calls* — and asks it as a ratchet that fails the
// build. This one is a prompt for a human, so it has no allow-list and no
// opinion about what ought to be on it.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

// Relative to this file, so it works in any checkout rather than only in the
// container it was written in.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry !== 'node_modules') walk(path, out)
    } else {
      out.push(path)
    }
  }
  return out
}

// The code that ships, and everything the tests say about it. `.sql` is in the
// test side because the SQL suite names functions and columns the client calls.
const shipped = walk(join(ROOT, 'src'))
  .concat(walk(join(ROOT, 'api')))
  .filter((f) => /\.(js|jsx)$/.test(f))
const testText = walk(join(ROOT, 'tests'))
  .filter((f) => /\.(mjs|sql|js)$/.test(f))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')

// `export default` is left out: it has no name to search for, and every default
// here is a React component or an API handler, both of which the browser suites
// and `apiguard.test.mjs` reach through the app rather than by name.
const EXPORTED = /^export\s+(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)|let\s+(\w+)|class\s+(\w+))/gm

const rows = []
for (const file of shipped) {
  const text = readFileSync(file, 'utf8')
  const names = [...text.matchAll(EXPORTED)].map((m) => m[1] || m[2] || m[3] || m[4]).filter(Boolean)
  if (!names.length) continue
  const missing = names.filter((name) => !new RegExp(`\\b${name}\\b`).test(testText))
  if (missing.length) rows.push({ file: relative(ROOT, file), total: names.length, missing })
}

// Worst file first, because the question this answers is "what next".
rows.sort((a, b) => b.missing.length - a.missing.length || a.file.localeCompare(b.file))

const SHOW = Number(process.env.SHOW || 22)
for (const r of rows.slice(0, SHOW)) {
  console.log(`${String(r.missing.length).padStart(3)}/${String(r.total).padEnd(3)} ${r.file}`)
  console.log(`          ${r.missing.join(', ')}`)
}
const unmentioned = rows.reduce((sum, r) => sum + r.missing.length, 0)
console.log(`\n${rows.length} files with at least one unmentioned export; ${unmentioned} exports in all`)
if (rows.length > SHOW) console.log(`(showing ${SHOW}; SHOW=${rows.length} for all)`)

// Reading the output: a high count is not automatically a target. Two files top
// it that are deliberately left alone — `src/lib/storage/local.js` and
// `supabase.js` — because `cloudwiring.test.mjs` already asserts every `db.*`
// the app calls exists in both backends and the SQL suite covers the policies
// behind them, so the count overstates them. `src/components/ui.jsx` is
// exercised through every browser suite. `src/lib/admin.js` is client-side
// sugar over `SECURITY DEFINER` RPCs that Postgres guards with `is_admin()`.
// docs/HANDOFF.md keeps the current reading of this list, with a reason per
// entry.
