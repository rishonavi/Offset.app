// Whether the cloud backend is wired to the cloud.
//
// `storage/supabase.js` fetches its client lazily — `const supabase = await
// client()` as the first line of every function — because importing it eagerly
// pulled 197 kB of library into demo builds that never call it. Six functions
// were left without that line and reached for a `supabase` that does not exist
// in their scope. Each one threw `ReferenceError: supabase is not defined` on
// every call, in cloud mode, for every user.
//
// `getExpenses` was among them, and it is in the `Promise.all` that
// DataContext runs on load. So the whole load rejected and a signed-in person
// saw no assets, no expenses, no income, no documents and no comments — an
// empty ledger rather than an error, because nothing read the error either.
// `addProperty`, `updateProperty`, `addExpense`, `updateExpense` and
// `setPersonalBudget` went the same way, which left the cloud app unable to add
// or change anything.
//
// Nothing could have caught it: there is no linter in this repo, the module
// imports and builds perfectly, and no test had ever called those functions
// because doing so needs a Supabase project. So the file is read as text.
import { readFileSync } from 'node:fs'
import * as remote from '../../src/lib/storage/supabase.js'
import * as local from '../../src/lib/storage/local.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

const SOURCE = new URL('../../src/lib/storage/supabase.js', import.meta.url)

// Top-level functions only, which is every one in that file. A nested one would
// see its parent's binding and is not what went wrong.
function unbound(text) {
  const lines = text.split('\n')
  const starts = lines.reduce((at, l, i) => (/^(export\s+)?(async\s+)?function\s+\w+/.test(l) ? [...at, i] : at), [])
  starts.push(lines.length)
  const out = []
  for (let i = 0; i < starts.length - 1; i += 1) {
    const body = lines.slice(starts[i], starts[i + 1]).join('\n')
    const name = lines[starts[i]].match(/function\s+(\w+)/)[1]
    // `supabase.` used as a value, not `.supabase` on something else and not
    // part of a longer name.
    const uses = /(?<![.\w])supabase\s*\./.test(body)
    // Bound by a declaration, or as the parameter of the callback that the one
    // non-async function in the file uses.
    const binds = /(?:const|let|var)\s+supabase\s*=/.test(body) || /\(\s*supabase\s*\)\s*=>/.test(body)
    if (uses && !binds) out.push(name)
  }
  return out
}

console.log('── EVERY FUNCTION THAT USES THE CLIENT ASKS FOR IT ──')
{
  const text = readFileSync(SOURCE, 'utf8')
  const missing = unbound(text)
  ok('none reaches for a client it never fetched', missing.length === 0, missing.join(', '))
}

console.log('\n── AND THE CHECK ABOVE CAN FAIL ──')
{
  // Without this, a scanner that matched nothing would read as a clean file.
  // These are the six, as they were.
  const asItWas = `
export async function getExpenses() {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
  if (error) throw error
  return data
}
export async function addExpense(payload) {
  const user_id = await ownerForWrite()
  const { data, error } = await supabase.from('expenses').insert({ ...payload, user_id })
  if (error) throw error
  return data
}
export async function getProperties() {
  const supabase = await client()
  const { data, error } = await supabase.from('properties').select('*')
  if (error) throw error
  return data
}
`
  const found = unbound(asItWas)
  eq('it catches the two that are broken', found.join(','), 'getExpenses,addExpense')
  ok('and leaves the one beside them alone', !found.includes('getProperties'), found.join(','))
}
{
  // The other half of the control: a client taken as a callback argument is
  // bound, and a property called `.supabase` on something else is not a use.
  const fine = `
export function onAuthStateChange(cb) {
  client().then((supabase) => {
    supabase.auth.getSession()
  })
}
export function describe(config) {
  return config.supabase.url
}
`
  eq('a callback parameter counts as bound', unbound(fine).join(','), '')
}

console.log('\n── AND BOTH ANSWER EVERYTHING THE APP ASKS OF THEM ──')
// `storage/index.js` picks one of the two at import time and the app talks to
// whichever it got, so every `db.something()` in the app has to exist in both.
// A name in only one of them is a TypeError on exactly the configuration
// nobody develops against — and development happens in demo mode, where the
// cloud half is the one that goes unexercised.
//
// Read from the callers rather than compared between the two modules, because
// they are not meant to match: the cloud has accounts, sharing and a storage
// bucket, and the demo backend has a blob store and nobody to share with. What
// matters is not that the two are equal but that neither is missing something
// asked of it.
{
  const callers = [
    'src/context/DataContext.jsx', 'src/context/AuthContext.jsx',
    'src/context/PlanContext.jsx', 'src/context/PersonalContext.jsx',
    'src/components/IncomeForm.jsx', 'src/components/ExpenseForm.jsx',
    'src/components/DocumentsCard.jsx', 'src/components/ReceiptViewer.jsx',
    'src/pages/Trash.jsx', 'src/pages/ImportBills.jsx',
  ]
  const asked = new Set()
  for (const f of callers) {
    const text = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
    for (const m of text.matchAll(/\bdb\.([a-zA-Z_][\w]*)/g)) asked.add(m[1])
  }
  const names = [...asked].sort()
  // The control: a scan that found nothing would pass every assertion below.
  ok(`the app calls ${names.length} things on db`, names.length > 20, names.join(', '))
  ok('including the five the ledger loads with',
    ['getProperties', 'getExpenses', 'getIncome', 'getDocuments', 'getComments'].every((n) => asked.has(n)),
    names.join(', '))

  for (const backend of [['demo', local], ['cloud', remote]]) {
    const [label, mod] = backend
    const missing = names.filter((n) => typeof mod[n] !== 'function')
    ok(`the ${label} backend answers all of them`, missing.length === 0, missing.join(', '))
  }
  // And a name nobody exports is caught, so the loop above is not vacuous.
  ok('a method neither backend has would be caught',
    typeof local.thisDoesNotExist !== 'function' && typeof remote.thisDoesNotExist !== 'function')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
