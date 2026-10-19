// Whether the app sends the token its own API requires.
//
// `_auth.js` states the rule the whole API is built on: identity comes from the
// token, never from the request body. That only works if the client sends one.
//
// It did not. `authHeader.js` read `const { supabase } = await
// import('./supabaseClient')`, from back when that module built a client at
// import time; the lazy refactor replaced it with `client()` and left this file
// behind. The import still resolved, `supabase` was quietly `undefined`, the
// `if` never ran, and every call went out with no Authorization header. Nothing
// threw and nothing logged — the same shape as the six storage functions that
// reached for a client nobody fetched, from the same refactor.
//
// On a cloud deployment that is receipt scanning, bank sync and both AI
// endpoints answering 401 to their own app, permanently: /api/scan-receipt and
// /api/bank/* call `requireUser`, and /api/ask and /api/parse-entry call
// `requireUserIfConfigured`, which on a deployment with accounts is the same
// thing.
import { authHeaders } from '../../src/lib/authHeader.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

const withSession = (token) => async () => ({
  auth: { getSession: async () => ({ data: { session: token ? { access_token: token } : null } }) },
})

console.log('── A SIGNED-IN CALLER SENDS THEIR TOKEN ──')
{
  const h = await authHeaders({}, withSession('tok-abc'))
  eq('the header is there', h.Authorization, 'Bearer tok-abc')
  eq('with the content type beside it', h['Content-Type'], 'application/json')
}
{
  const h = await authHeaders({ 'X-Thing': '1' }, withSession('tok-abc'))
  eq('and anything extra is kept', h['X-Thing'], '1')
  eq('alongside the token', h.Authorization, 'Bearer tok-abc')
}

console.log('\n── AND NOBODY SENDS ONE THEY HAVE NOT GOT ──')
// The control: if a token appeared here the test above would pass on an
// implementation that invents one.
{
  const h = await authHeaders({}, withSession(null))
  eq('no session, no header', h.Authorization, undefined)
  eq('but the call still goes out', h['Content-Type'], 'application/json')
}
{
  // Demo mode: `client()` resolves to null because no cloud is configured.
  const h = await authHeaders({}, async () => null)
  eq('a build with no cloud sends none', h.Authorization, undefined)
}
{
  // A browser that cannot reach storage, or a client that fails to arrive. The
  // call must still be made; the endpoint decides what to do with an anonymous
  // one.
  const h = await authHeaders({}, async () => { throw new Error('refused') })
  eq('and a client that throws does not take the call with it', h['Content-Type'], 'application/json')
  eq('it just has no token', h.Authorization, undefined)
}
{
  const h = await authHeaders({}, async () => ({ auth: { getSession: async () => { throw new Error('offline') } } }))
  eq('nor does a getSession that throws', h['Content-Type'], 'application/json')
}
{
  // The exact shape the old code produced, asserted so it cannot come back:
  // a module with no `supabase` export read as "nothing to do".
  const h = await authHeaders({}, async () => ({ hasSupabase: true, client: () => {} }))
  eq('a client of the wrong shape sends no token', h.Authorization, undefined)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
