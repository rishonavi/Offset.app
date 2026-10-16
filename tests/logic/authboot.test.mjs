// Whether the app can be told that the cloud did not answer.
//
// `watchAuth` is the first thing the app does and everything waits on it: the
// provider starts with `loading: true` and clears it only when this calls back.
// So every path through here has to call back. Three of them did not — the
// dynamic import rejecting, `getSession()` rejecting, and `getSession()` never
// settling at all — and each one left the app on "Starting up…" for the life of
// the page, which is what a paused Supabase project looks like from a browser.
//
// Measured, before the fix, against a host that refuses the connection: the
// spinner held for 35 seconds and then redirected to the marketing page. Against
// one that accepts and never replies: it never moved.
import { watchAuth } from '../../src/lib/storage/supabase.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
const USER = { id: 'u1', email: 'owner@example.com' }

// A Supabase client with exactly the three surfaces `watchAuth` touches, so a
// change in what it reaches for shows up here as a thrown TypeError rather than
// as a silent pass.
function fakeClient({ session = null, sessionError = null, reject = null, hang = false } = {}) {
  const listeners = []
  let unsubscribed = 0
  return {
    listeners,
    get unsubscribed() { return unsubscribed },
    auth: {
      getSession: () =>
        hang ? new Promise(() => {})
          : reject ? Promise.reject(reject)
            : Promise.resolve({ data: { session }, error: sessionError }),
      onAuthStateChange: (fn) => {
        listeners.push(fn)
        return { data: { subscription: { unsubscribe: () => { unsubscribed += 1 } } } }
      },
    },
  }
}

// Every case records every call, because "called once with the right thing" and
// "called four times, one of which was right" are different outcomes and only
// the first is correct.
function watch(getClient, waitMs = 40) {
  const calls = []
  const stop = watchAuth(getClient, (user, error) => calls.push({ user, error }), waitMs)
  return { calls, stop, last: () => calls[calls.length - 1] }
}

console.log('── WHEN THE CLOUD ANSWERS ──')
{
  const c = fakeClient({ session: { user: USER } })
  const w = watch(() => Promise.resolve(c))
  await tick(5)
  eq('the signed-in user is reported', w.last()?.user?.id, 'u1')
  eq('with no error beside them', w.last()?.error, null)
  eq('once', w.calls.length, 1)
  w.stop()
  eq('and stopping unsubscribes the listener', c.unsubscribed, 1)
}
{
  // Signed out is an answer, and it is not an error. The app sends this person
  // to the landing page, which is right — the whole bug was doing the same to
  // somebody whose session could not be checked.
  const w = watch(() => Promise.resolve(fakeClient({ session: null })))
  await tick(5)
  eq('no session reports nobody', w.last()?.user, null)
  eq('and still no error', w.last()?.error, null)
}
{
  const w = watch(() => Promise.resolve(null))
  await tick(5)
  eq('a build with no cloud reports nobody', w.last()?.user, null)
  eq('which is an answer, not a failure', w.last()?.error, null)
}

console.log('\n── WHEN IT DOES NOT ──')
{
  // The dynamic import of @supabase/supabase-js failing: a chunk that 404s
  // because a deploy replaced it, or no network at all. This rejected in
  // milliseconds and called nothing, so the spinner ran forever over a failure
  // the app already knew about.
  const boom = new Error('Failed to fetch dynamically imported module')
  const w = watch(() => Promise.reject(boom))
  await tick(5)
  eq('a library that never arrives is reported', w.calls.length, 1)
  eq('as nobody', w.last()?.user, null)
  eq('with the reason', w.last()?.error, boom)
}
{
  const boom = new Error('AuthRetryableFetchError')
  const w = watch(() => Promise.resolve(fakeClient({ reject: boom })))
  await tick(5)
  eq('a rejected getSession is reported', w.last()?.error, boom)
  eq('and nobody is signed in by it', w.last()?.user, null)
}
{
  // Supabase hands errors back in the payload rather than rejecting, so the
  // happy-path destructuring read `session` off it and reported nobody — the
  // failure arrived as a successful sign-out.
  const boom = { message: 'Invalid Refresh Token: Already Used' }
  const w = watch(() => Promise.resolve(fakeClient({ sessionError: boom })))
  await tick(5)
  eq('an error in the payload is reported too', w.last()?.error, boom)
  eq('and not as a successful sign-out', w.calls.length, 1)
}

console.log('\n── AND WHEN IT NEVER REPLIES AT ALL ──')
{
  const w = watch(() => Promise.resolve(fakeClient({ hang: true })), 40)
  await tick(20)
  // The control beside the assertion below: if nothing were ever reported this
  // suite would pass on the wait alone.
  eq('nothing is said while there is still time', w.calls.length, 0)
  await tick(40)
  eq('then the wait ends', w.calls.length, 1)
  eq('reporting nobody', w.last()?.user, null)
  ok('and saying the cloud did not answer', /did not answer/i.test(w.last()?.error?.message || ''),
    JSON.stringify(w.last()?.error?.message))
}
{
  // The timer must not be able to sign out somebody who is already signed in.
  // `onAuthStateChange` fires INITIAL_SESSION of its own accord, and it can win
  // the race against a getSession that is still refreshing a token.
  const c = fakeClient({ hang: true })
  const w = watch(() => Promise.resolve(c), 40)
  await tick(5)
  c.listeners[0]('INITIAL_SESSION', { user: USER })
  eq('a listener that answers first is reported', w.last()?.user?.id, 'u1')
  await tick(60)
  eq('and the wait running out says nothing over it', w.calls.length, 1)
  eq('leaving them signed in', w.last()?.user?.id, 'u1')
}
{
  // The wait is on the answer, not on the request: the attempt is left running,
  // so a cloud that comes back after ten seconds still gets somebody in.
  const c = fakeClient({ hang: true })
  const w = watch(() => Promise.resolve(c), 20)
  await tick(40)
  eq('the wait ran out first', w.calls.length, 1)
  ok('with an error', Boolean(w.last()?.error))
  c.listeners[0]('SIGNED_IN', { user: USER })
  eq('then a late answer reports the user', w.last()?.user?.id, 'u1')
  eq('with the error gone', w.last()?.error, null)
}

console.log('\n── AND NOTHING IS SAID AFTER THE CALLER HAS GONE ──')
{
  let resolve
  const c = fakeClient({ session: { user: USER } })
  const w = watch(() => new Promise((r) => { resolve = r }))
  w.stop()
  resolve(c)
  await tick(10)
  eq('a client that arrives after unsubscribing reports nothing', w.calls.length, 0)
  eq('and no listener is left behind', c.listeners.length, 0)
}
{
  const c = fakeClient({ hang: true })
  const w = watch(() => Promise.resolve(c), 20)
  await tick(5)
  w.stop()
  await tick(40)
  eq('and a wait that runs out afterwards says nothing', w.calls.length, 0)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
