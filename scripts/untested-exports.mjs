// Every export that no test so much as mentions.
//
//   npx vite-node scripts/untested-exports.mjs
//
// This is how targets got picked once reading files stopped being the way, and
// the next two modules it pointed at both held real bugs.
//
// One-sided on purpose: a mention is not a test, so the output is not a coverage
// figure. But a name nothing mentions is certainly untested, and that is enough
// to choose what to read next. A high count is not automatically a target —
// docs/HANDOFF.md says which of the top entries are deliberately left alone.
//
// In scripts/ and not tests/ because sweep.sh would run it as a suite.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

// Relative to this file, so it works in any checkout.
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

// `.sql` counts as a test: the SQL suite names functions the client calls.
const shipped = walk(join(ROOT, 'src'))
  .concat(walk(join(ROOT, 'api')))
  .filter((f) => /\.(js|jsx)$/.test(f))
const testText = walk(join(ROOT, 'tests'))
  .filter((f) => /\.(mjs|sql|js)$/.test(f))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')

// `export default` has no name to search for, and every default here is a
// component or an API handler, reached through the app rather than by name.
const EXPORTED = /^export\s+(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)|let\s+(\w+)|class\s+(\w+))/gm

const rows = []
for (const file of shipped) {
  const text = readFileSync(file, 'utf8')
  const names = [...text.matchAll(EXPORTED)].map((m) => m[1] || m[2] || m[3] || m[4]).filter(Boolean)
  if (!names.length) continue
  const missing = names.filter((name) => !new RegExp(`\\b${name}\\b`).test(testText))
  if (missing.length) rows.push({ file: relative(ROOT, file), total: names.length, missing })
}

rows.sort((a, b) => b.missing.length - a.missing.length || a.file.localeCompare(b.file))

const SHOW = Number(process.env.SHOW || 22)
for (const r of rows.slice(0, SHOW)) {
  console.log(`${String(r.missing.length).padStart(3)}/${String(r.total).padEnd(3)} ${r.file}`)
  console.log(`          ${r.missing.join(', ')}`)
}
const unmentioned = rows.reduce((sum, r) => sum + r.missing.length, 0)
console.log(`\n${rows.length} files with at least one unmentioned export; ${unmentioned} exports in all`)
if (rows.length > SHOW) console.log(`(showing ${SHOW}; SHOW=${rows.length} for all)`)
