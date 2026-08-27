// Signing in, and what the screen says when it does not work.
//
// Runs against a build with Supabase keys set — the sign-in screen does not
// exist without them, because the demo backend reports a signed-in user and
// /login redirects away. The keys point at nothing; every call to them is
// intercepted, since what is under test is what the app does with the answer.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const visit = async (url) => {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
  const p = await ctx.newPage(); p.setDefaultTimeout(30000)
  await p.route('**supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await p.route('**/fonts.g**/**', (r) => r.abort())
  await p.goto(url, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(1800)
  return { p, ctx, text: (await p.locator('body').innerText()).replace(/\n+/g, ' ') }
}

// The other browser suites build with VITE_OPEN_ACCESS=true, where there are no
// accounts and no sign-in screen to test. Skip rather than fail: a suite that
// goes red because of how the build was configured teaches people to ignore it.
{
  const { p, ctx } = await visit(`${B}/login`)
  const cloud = p.url().includes('/login')
  await ctx.close()
  if (!cloud) {
    console.log('skipped — this suite needs a build with Supabase keys set:')
    console.log('  VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=anything npx vite build')
    await b.close()
    process.exit(0)
  }
}

console.log('\n── THE SIGN-IN SCREEN ──')
{
  const { p, ctx, text } = await visit(`${B}/login`)
  ok('is reachable once Supabase is configured', p.url().includes('/login'), p.url())
  ok('and offers Google', await p.locator('button:has-text("Continue with Google")').count() === 1)
  ok('and email and password', /password/i.test(text))
  await ctx.close()
}

console.log('\n── WHEN THE PROVIDER SENDS BACK A REFUSAL ──')
// OAuth leaves the page, so a failure never returns as a thrown error — it
// arrives as parameters on the URL the provider returns to. Supabase uses the
// hash for implicit flow and the query string for PKCE, so both are read.
{
  const { p, ctx, text } = await visit(`${B}/#error=server_error&error_description=Unsupported+provider%3A+provider+is+not+enabled`)
  ok('a hash error lands on the sign-in screen, not the marketing page', p.url().includes('/login'), p.url())
  ok('and names the setting to turn on', /switched on in this project’s Supabase/.test(text), text.slice(0, 180))
  ok('without showing the raw provider wording', !/Unsupported provider/.test(text), text.slice(0, 180))
  await ctx.close()
}
{
  const { p, ctx, text } = await visit(`${B}/login?error=invalid_request&error_description=requested+path+is+invalid`)
  ok('a query error is read too', /refused the return address/.test(text), text.slice(0, 180))
  ok('and says which URL to allow', text.includes(B), text.slice(0, 200))
  await ctx.close()
}
{
  const { ctx, text } = await visit(`${B}/#error=server_error&error_description=Unable+to+exchange+external+code`)
  ok('a mismatched client id is explained as one', /client ID or secret/.test(text), text.slice(0, 180))
  ok('including the redirect URI Google needs', /auth\/v1\/callback/.test(text), text.slice(0, 220))
  await ctx.close()
}

console.log('\n── AND THE FAILURE DOES NOT OUTLIVE ITSELF ──')
{
  const { p, ctx } = await visit(`${B}/#error=server_error&error_description=Unsupported+provider`)
  // Cleared from the URL, so a reload is not a second report of one failure.
  ok('the error is taken off the address bar', !p.url().includes('error='), p.url())
  await p.reload({ waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(1200)
  const after = (await p.locator('body').innerText()).replace(/\n+/g, ' ')
  ok('and reloading does not repeat it', !/switched on in this project/.test(after), after.slice(0, 140))
  await ctx.close()
}

console.log(`\n${pass} passed, ${fail} failed`)
await b.close(); if (fail) process.exitCode = 1
