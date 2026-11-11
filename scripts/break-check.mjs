// Break each fix on purpose and check the test notices.
//
//   node scripts/break-check.mjs breaks.json
//
// A test written next to a fix almost always passes. Whether it would have
// *failed* before is the only question, and the only way to know is to put the
// bug back. This has twice shown an assertion I was pleased with could not fail
// at all — neither was visible by reading.
//
// breaks.json is a list of { label, file, old, new, suite }. `old` must appear
// exactly once, or it is an error rather than a guess. `"new": ""` deletes.
//
// A break that makes the suite crash counts as caught, but is reported
// separately: a clean **FAIL** naming the behaviour beats a stack trace.
//
// Exits non-zero if any break went unnoticed. That is the defect — a fix whose
// removal nothing detects is a fix nobody can keep.
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const spec = process.argv[2]
if (!spec) {
  console.error('usage: node scripts/break-check.mjs <breaks.json>')
  process.exit(2)
}

let breaks
try {
  breaks = JSON.parse(readFileSync(spec, 'utf8'))
} catch (e) {
  console.error(`could not read ${spec}: ${e.message}`)
  process.exit(2)
}
if (!Array.isArray(breaks) || !breaks.length) {
  console.error(`${spec} should hold a non-empty list of breaks`)
  process.exit(2)
}

const run = (suite) => {
  try {
    return execFileSync('npx', ['vite-node', suite], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' })
  } catch (e) {
    // A failing suite exits non-zero, which is the normal outcome here.
    return `${e.stdout || ''}${e.stderr || ''}`
  }
}

let missed = 0
let applied = 0

for (const [i, b] of breaks.entries()) {
  const { label = `break ${i + 1}`, file, old, new: replacement, suite } = b
  if (!file || typeof old !== 'string' || typeof replacement !== 'string' || !suite) {
    console.log(`SKIP   ${label}  — needs file, old, new and suite`)
    missed += 1
    continue
  }

  const path = join(ROOT, file)
  // Kept in memory, not restored from `git show HEAD`: the ordinary case is
  // verifying a fix that is not committed yet, and HEAD would throw it away.
  const before = readFileSync(path, 'utf8')
  const hits = before.split(old).length - 1
  if (hits !== 1) {
    console.log(`SKIP   ${label}  — "old" appears ${hits} times in ${file}, needs to appear once`)
    missed += 1
    continue
  }

  writeFileSync(path, before.replace(old, replacement))
  let output = ''
  try {
    output = run(suite)
  } finally {
    // Always, or a broken file is left behind.
    writeFileSync(path, before)
  }
  applied += 1

  const fails = output.split('\n').filter((l) => l.includes('**FAIL**'))
  const tally = output.match(/\d+ passed, \d+ failed/)
  if (fails.length) {
    console.log(`RED    ${label}  (${fails.length} failed)`)
    for (const line of fails.slice(0, 3)) console.log(`         ${line.trim().slice(0, 120)}`)
  } else if (!tally) {
    console.log(`RED    ${label}  (the suite crashed rather than failing — see below)`)
    for (const line of output.split('\n').filter((l) => /Error|error:/.test(l)).slice(0, 2)) {
      console.log(`         ${line.trim().slice(0, 120)}`)
    }
  } else {
    console.log(`GREEN  ${label}  <-- NOT CAUGHT  (${tally[0]})`)
    missed += 1
  }
}

console.log(`\n${applied} of ${breaks.length} breaks applied`)
console.log(missed ? `${missed} went unnoticed — those fixes are not held by anything` : 'every break was caught')
process.exit(missed ? 1 : 0)
