// Break each fix on purpose and check the test notices.
//
//   node scripts/break-check.mjs breaks.json
//
// A test written next to a fix almost always passes. The question that matters
// is whether it would have *failed* before — and the only way to know is to put
// the bug back and watch the suite go red. Every section of this audit ended
// this way, and it has twice shown that an assertion I was pleased with could
// not fail at all:
//
//   • a stale-deploy test passed with the fix removed, because it navigated with
//     `page.goto` (itself a load) and matched "Reports" in the sidebar;
//   • a "ring stacks do not travel" assertion could not fail, because the same
//     stack fixture was shared between the ring and the crash that legitimately
//     keeps one.
//
// Neither was visible by reading. Both were obvious within a second of running
// this.
//
// The breaks file is JSON, a list of objects:
//
//   [
//     {
//       "label": "the ring keeps its stacks again",
//       "file":  "src/lib/reports.js",
//       "old":   "errors: recentErrors().map(({ at, source, message, count })",
//       "new":   "errors: recentErrors(",
//       "suite": "tests/logic/bugreport.test.mjs"
//     }
//   ]
//
// `old` must appear **exactly once** in the file; anything else is an error
// rather than a guess, because a substitution that lands in two places is not
// the break you described. Set `"new": ""` to delete the text outright, which is
// the most honest way to remove a guard.
//
// A break that makes the suite *crash* counts as caught — a `TypeError` where
// there used to be a guard is a failure in the loudest available register — but
// it is reported separately, because a clean `**FAIL**` line naming the
// behaviour is better than a stack trace, and a crash usually means an
// assertion dereferenced something before the `ok()` could run.
//
// **Exit code is the whole point.** Non-zero if any break went unnoticed, since
// that is the defect: a fix whose removal nothing detects is a fix nobody can
// keep.
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
    // A suite that fails exits non-zero, which is the normal outcome here.
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
  // The file as it stands, kept in memory. NOT `git show HEAD:<file>`: the
  // ordinary case is verifying a fix that has not been committed yet, and
  // restoring from HEAD would throw the fix away — which is exactly the
  // accident this tool exists to avoid causing.
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
    // Always, even on an exception, or a broken file is left behind.
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
