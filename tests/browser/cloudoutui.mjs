// What the app does when the cloud behind it is not answering.
//
// Needs a build with Supabase keys set, like loginui — a demo build reports a
// signed-in user from browser storage and never asks anything. The keys point
// at nothing; every request to them is intercepted here, because what is under
// test is what the app does with silence.
//
//   VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=test-anon-key \
//     npx vite build --outDir dist-cloud
//   npx vite preview --outDir dist-cloud --port 4190 --strictPort
//   OFFSET_TEST_URL=http://localhost:4190 npx vite-node tests/browser/cloudoutui.mjs
//
// The bug this holds shut: a paused Supabase project accepts the connection and
// never replies, so `getSession()` never settled, the provider never cleared
// `loading`, and the app sat on "Starting up…" with nothing to read and nothing
// to click — for the life of the page. Where the host refused outright it was
// worse than it looked: gotrue retried for about thirty-five seconds and then
// reported no session, which the app rendered as a successful sign-out and sent
// somebody with a year of books in the cloud to the marketing page.
import { chromium } from './_playwright.mjs'

const B = process.env.OFFSET_TEST_URL || 'http://localhost:4190'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
// A session the client will accept from storage. `expired` decides whether it
// has to go to the network to use it, which is the whole difference between the
// controls below and the cases.
const session = (expired) => {
  const exp = Math.floor(Date.now() / 1000) + (expired ? -7200 : 7200)
  const id = '11111111-2222-3333-4444-555555555555'
  return JSON.stringify({
    access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
      sub: id, aud: 'authenticated', role: 'authenticated', email: 'owner@example.com',
      exp, iat: exp - 3600, session_id: 'sess-1',
    })}.signature`,
    token_type: 'bearer', expires_in: 3600, expires_at: exp,
    refresh_token: 'stored-refresh-token',
    user: {
      id, aud: 'authenticated', role: 'authenticated', email: 'owner@example.com',
      app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
    },
  })
}

// `cloud` is what the Supabase host does: hang, refuse, or answer.
async function visit({ stored = null, cloud = 'hang', waitMs = 12000 } = {}) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
  if (stored) {
    await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} },
      ['sb-example-auth-token', stored])
  }
  const p = await ctx.newPage()
  p.setDefaultTimeout(30000)
  await p.route('**example.supabase.co/**', (r) => {
    if (cloud === 'hang') return // never answered, never refused
    if (cloud === 'refuse') return r.abort('connectionrefused')
    // The tables and the auth endpoint answered separately, because the two
    // failures are different screens: nothing can be read at all, or somebody
    // is signed in and their rows will not come.
    const table = r.request().url().includes('/rest/v1/')
    if (cloud === 'restfail' && table) {
      return r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"canceling statement due to statement timeout"}' })
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: table ? '[]' : '{}' })
  })
  await p.route('**/fonts.g**/**', (r) => r.abort())
  await p.goto(`${B}/`, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(waitMs)
  return { p, ctx, path: new URL(p.url()).pathname, text: (await p.locator('body').innerText()).replace(/\s+/g, ' ') }
}

{
  const ctx = await b.newContext({ serviceWorkers: 'block' })
  const p = await ctx.newPage()
  await p.route('**/fonts.g**/**', (r) => r.abort())
  await p.goto(`${B}/login`, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(1500)
  const cloud = p.url().includes('/login')
  await ctx.close()
  if (!cloud) {
    console.log('skipped — this suite needs a build with Supabase keys set; see the header.')
    await b.close()
    process.exit(0)
  }
}

console.log('\n── A CLOUD THAT NEVER REPLIES ──')
{
  const { p, ctx, text, path } = await visit({ stored: session(true), cloud: 'hang' })
  ok('the spinner does not run forever', !/Starting up/i.test(text), text.slice(0, 200))
  ok('it says the books cannot be reached', /can.t reach your books/i.test(text), text.slice(0, 300))
  ok('and that they are not lost', /not lost/i.test(text), text.slice(0, 300))
  // Not the landing page: being unable to ask is not being signed out, and
  // sending somebody to a page selling them the app they pay for is the part
  // that read as "the app has stopped working".
  ok('and does not pitch the app at its own customer', path === '/', path)
  ok('there is a way to try again',
    await p.getByRole('button', { name: /try again/i }).isVisible().catch(() => false))
  ok('and a way to sign in',
    await p.getByRole('link', { name: /sign in/i }).isVisible().catch(() => false))
  // The library's own words, so a report of this is worth something.
  ok('with the reason named', /did not answer/i.test(text), text.slice(0, 400))
  await ctx.close()
}

console.log('\n── AND ONE THAT REFUSES THE CONNECTION ──')
{
  const { ctx, text, path } = await visit({ stored: session(true), cloud: 'refuse', waitMs: 12000 })
  ok('is reported the same way', /can.t reach your books/i.test(text), text.slice(0, 300))
  ok('rather than as a sign-out', path === '/', path)
  await ctx.close()
}

console.log('\n── THE CONTROLS ──')
{
  // A session that has not expired is read from storage without a request, so
  // the hanging route is never reached and the app opens. Without this the
  // suite would pass just as well on a screen that always says the cloud is
  // down.
  const { ctx, text, path } = await visit({ stored: session(false), cloud: 'hang', waitMs: 6000 })
  ok('a usable stored session gets in', !/can.t reach your books/i.test(text), text.slice(0, 300))
  ok('to the app itself', path === '/', path)
  await ctx.close()
}
{
  // Nobody signed in at all: `getSession()` answers from storage immediately,
  // so there is no failure to report and the landing page is the right place.
  const { ctx, text, path } = await visit({ stored: null, cloud: 'hang', waitMs: 6000 })
  ok('and with no session stored it is still the landing page', path === '/welcome', path)
  ok('not the error screen', !/can.t reach your books/i.test(text), text.slice(0, 200))
  await ctx.close()
}

console.log('\n\u2500\u2500 AND WHEN IT TAKES THE SIGN-IN AND NOT THE ROWS \u2500\u2500')
{
  // The second half of the same bug, one layer down. `DataContext` caught a
  // failed load and put the reason in `error` \u2014 which nothing in the app read.
  // So a cloud that answered the sign-in and then failed every query rendered
  // an empty ledger: no assets, no expenses, no income, and no indication that
  // anything had gone wrong. An empty ledger is worse than an error, because
  // somebody acts on it.
  const { ctx, text, path } = await visit({ stored: session(false), cloud: 'restfail', waitMs: 8000 })
  ok('the app is in', path === '/', path)
  ok('and says the books did not load', /load your books/i.test(text), text.slice(0, 400))
  ok('that nothing has been lost', /nothing has been lost/i.test(text), text.slice(0, 400))
  ok('and offers to try again', /try again/i.test(text), text.slice(0, 400))
  await ctx.close()
}
{
  // The control: the same route answering normally, so the banner is a report
  // of a failure and not a decoration that is always there.
  const { ctx, text, path } = await visit({ stored: session(false), cloud: 'answer', waitMs: 8000 })
  ok('a cloud that answers shows no such banner', !/load your books/i.test(text), text.slice(0, 400))
  ok('and the app is still in', path === '/', path)
  await ctx.close()
}

console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
