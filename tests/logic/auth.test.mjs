// The bearer-token check the serverless endpoints share.
//
// The branch that actually calls Supabase cannot run here — there is no project
// to call — so what is covered is everything around it: the shape of the
// answers, and that an unconfigured deployment behaves the way each endpoint
// expects rather than crashing.
import { bearerToken, hasAccounts, requireUser, requireUserIfConfigured } from '../../api/_auth.js'
import report from '../../api/report.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`)

const env = { ...process.env }
const restore = () => { process.env = { ...env } }

console.log('\n── READING THE HEADER ──')
eq('a bearer token is taken from the header', bearerToken({ headers: { authorization: 'Bearer abc123' } }), 'abc123')
eq('capitalised header name works too', bearerToken({ headers: { Authorization: 'Bearer abc123' } }), 'abc123')
eq('another scheme is not a bearer token', bearerToken({ headers: { authorization: 'Basic abc123' } }), null)
eq('an empty bearer is nothing, not an empty string', bearerToken({ headers: { authorization: 'Bearer ' } }), null)
eq('no header at all is nothing', bearerToken({ headers: {} }), null)
eq('no headers object at all does not throw', bearerToken({}), null)

console.log('\n── WHETHER THIS DEPLOYMENT HAS ACCOUNTS ──')
delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY
ok('neither variable set: no accounts', hasAccounts() === false)
process.env.SUPABASE_URL = 'https://x.supabase.co'
ok('the URL alone is not enough — it cannot verify anything', hasAccounts() === false)
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
ok('both set: accounts exist', hasAccounts() === true)
restore()

console.log('\n── WITH NO ACCOUNTS CONFIGURED ──')
delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY
// A demo deployment has nobody to sign in as, so requiring a sign-in would
// close the endpoint to everyone rather than to strangers.
eq('the optional check lets the request through', await requireUserIfConfigured({ headers: {} }), { ok: true, user: null })
const strict = await requireUser({ headers: {} })
ok('the strict check refuses', strict.ok === false)
eq('and says it is unconfigured rather than unauthorised', strict.status, 501)

console.log('\n── WITH ACCOUNTS, BUT NO TOKEN ──')
process.env.SUPABASE_URL = 'https://x.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
const noToken = await requireUser({ headers: {} })
eq('a missing token is 401, not 501', noToken.status, 401)
eq('and names itself', noToken.error, 'unauthorized')
const optionalNoToken = await requireUserIfConfigured({ headers: {} })
ok('once accounts exist the optional check stops being optional', optionalNoToken.ok === false, JSON.stringify(optionalNoToken))
restore()

console.log('\n── THE ENDPOINT THAT DEPENDS ON IT ──')
// This import failing is the whole reason this file exists: report.js imported
// a module that was never committed, so every call to /api/report died at load.
ok('report.js has a handler to call', typeof report === 'function')
delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY
delete process.env.REPORTS_EMAIL; delete process.env.RESEND_API_KEY
const captured = {}
const res = { status(c) { captured.status = c; return this }, json(b) { captured.body = b; return this } }
await report({ method: 'POST', headers: {}, body: JSON.stringify({ text: 'the totals are wrong' }) }, res)
eq('an unconfigured deployment answers 501, not 500', captured.status, 501)
eq('and says which piece is missing', captured.body?.error, 'email_not_configured')
// GET is not the write path — it is how the client asks whether email delivery
// exists here, so that the report dialog can say so before anyone types.
captured.status = null
await report({ method: 'GET', headers: {} }, res)
eq('a GET answers rather than refusing', captured.status, 200)
eq('and reports that email is not set up here', captured.body?.configured, false)
captured.status = null
await report({ method: 'DELETE', headers: {} }, res)
eq('a method that is neither is refused', captured.status, 405)
restore()

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
