// What the serverless endpoints refuse, and to whom.
//
// The endpoints that call Gemini spend the operator's own quota on every
// request, and two of them were reachable by anyone who knew the URL. What can
// be checked here is everything up to the outbound call: the method, the
// configuration, the identity and the ceiling.
import { callerKey, overRate, rateLimited, __resetRates } from '../../api/_rate.js'
import ask from '../../api/ask.js'
import parseEntry from '../../api/parse-entry.js'
import bankLink from '../../api/bank/link.js'
import bankTransactions from '../../api/bank/transactions.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`)

const env = { ...process.env }
const restore = () => { process.env = { ...env }; __resetRates() }
const clearEnv = (...names) => names.forEach((n) => delete process.env[n])

// Minimal req/res doubles — these handlers only ever touch these few fields.
const call = async (handler, { method = 'POST', headers = {}, body = {} } = {}) => {
  const out = {}
  const res = { status(c) { out.status = c; return this }, json(b) { out.body = b; return this } }
  await handler({ method, headers, body: JSON.stringify(body), socket: {} }, res)
  return out
}

console.log('\n── WHO IS ASKING ──')
eq('a signed-in user is counted as themselves', callerKey({ headers: {} }, { id: 'u1' }), 'user:u1')
eq('an anonymous caller is counted by address', callerKey({ headers: { 'x-forwarded-for': '203.0.113.9' } }, null), 'ip:203.0.113.9')
// x-forwarded-for accumulates every proxy; only the first entry is the client.
eq('only the client end of a proxy chain counts', callerKey({ headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1, 10.0.0.2' } }, null), 'ip:203.0.113.9')
eq('an identified user beats their address', callerKey({ headers: { 'x-forwarded-for': '203.0.113.9' } }, { id: 'u1' }), 'user:u1')
ok('two users are not the same bucket', callerKey({ headers: {} }, { id: 'a' }) !== callerKey({ headers: {} }, { id: 'b' }))

console.log('\n── THE CEILING ──')
__resetRates()
let allowed = 0
for (let i = 0; i < 12; i++) if (!overRate('probe', { max: 10 })) allowed++
eq('a max of 10 allows exactly 10', allowed, 10)
// Recorded whether or not it was allowed: hammering a closed door should not
// reopen it the moment the window rolls forward.
ok('calls made while over the limit still count', overRate('probe', { max: 10 }) === true)
__resetRates()
ok('resetting clears the count', overRate('probe', { max: 1 }) === false)
__resetRates()
ok('separate callers have separate ceilings',
  !overRate('one', { max: 1 }) && !overRate('two', { max: 1 }))
const res429 = {}
const fakeRes = { status(c) { res429.status = c; return this }, json(b) { res429.body = b; return this } }
__resetRates()
ok('under the limit nothing is sent', rateLimited({ headers: {} }, fakeRes, { id: 'x' }, { max: 5 }) === false)
for (let i = 0; i < 6; i++) rateLimited({ headers: {} }, fakeRes, { id: 'x' }, { max: 5 })
eq('over it, the caller gets 429', res429.status, 429)
eq('and is told why', res429.body?.error, 'rate_limited')

console.log('\n── THE ENDPOINTS THAT SPEND MONEY ──')
restore()
clearEnv('GEMINI_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY')
for (const [name, handler] of [['ask', ask], ['parse-entry', parseEntry]]) {
  const unconfigured = await call(handler, { body: { question: 'x', text: 'x' } })
  eq(`${name}: no API key answers 501, not 500`, unconfigured.status, 501)
  const wrongMethod = await call(handler, { method: 'DELETE' })
  eq(`${name}: an unexpected method is refused`, wrongMethod.status, 405)
  const probe = await call(handler, { method: 'GET' })
  eq(`${name}: GET reports whether AI is set up`, probe.body?.configured, false)
}

// With a key present the ceiling applies. The request never reaches Gemini
// because the limit is checked first, which is what makes this testable.
restore()
process.env.GEMINI_API_KEY = 'test-key'
clearEnv('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY')
__resetRates()
let sawRateLimit = false
for (let i = 0; i < 70 && !sawRateLimit; i++) {
  const r = await call(ask, { headers: { 'x-forwarded-for': '198.51.100.7' }, body: { question: '' } })
  if (r.status === 429) sawRateLimit = true
}
ok('an anonymous caller cannot drain the Gemini key indefinitely', sawRateLimit)
restore()

console.log('\n── THE ENDPOINTS THAT TOUCH A BANK ──')
clearEnv('PLAID_CLIENT_ID', 'PLAID_SECRET', 'SETU_CLIENT_ID', 'SETU_CLIENT_SECRET',
         'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY')
for (const [name, handler] of [['bank/link', bankLink], ['bank/transactions', bankTransactions]]) {
  const unconfigured = await call(handler)
  // Unchanged behaviour: with no provider there is nothing to protect, and the
  // UI relies on 501 to fall back to statement-file import.
  eq(`${name}: no provider still answers 501`, unconfigured.status, 501)
}
process.env.PLAID_CLIENT_ID = 'id'
process.env.PLAID_SECRET = 'secret'
for (const [name, handler] of [['bank/link', bankLink], ['bank/transactions', bankTransactions]]) {
  const anon = await call(handler)
  ok(`${name}: a configured provider refuses an anonymous caller`, anon.status === 401 || anon.status === 501,
     `${anon.status} ${JSON.stringify(anon.body)}`)
  ok(`${name}: and does not answer 200`, anon.status !== 200, String(anon.status))
}
restore()

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
