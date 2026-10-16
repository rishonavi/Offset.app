// A deploy that lands while the app is open.
//
// Every page is a lazy import and every build renames the hashed chunks, so a
// tab that was open across a deploy asks for a file that no longer exists. An
// installed app on a phone is open for days, which makes this the ordinary case
// rather than the edge one. Simulated by 404ing one route's chunk, which is
// precisely what the server does once the next deploy has replaced it.
//
// Measured before and after, because the first version of this suite passed
// with the recovery deliberately removed from main.jsx — it navigated with
// `page.goto`, which is itself a page load, so "did it reload?" was already
// true, and it matched the word "Reports" in the sidebar as proof the Reports
// page had opened. Both assertions were unfalsifiable. The counts below are
// exact for that reason: 1 means the app never reloaded, 2 means it reloaded
// once, and a client-side click adds nothing of its own.
import { chromium } from './_playwright.mjs'

const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b2) => ok(n, a === b2, `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b2)}`)

// `gone`: 'always' leaves the chunk missing, 'once' serves one 404 and then
// lets it through — a good deploy, where the file is there the moment the page
// is fetched again. null blocks nothing.
async function open_(gone) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
  // Counted in the page: a reload is the thing under test, and Playwright's own
  // navigation events fire for the client-side router too.
  await ctx.addInitScript(
    `try{const n=Number(sessionStorage.getItem('loads')||0)+1;sessionStorage.setItem('loads',String(n))}catch{}`,
  )
  const p = await ctx.newPage()
  p.setDefaultTimeout(30000)
  await p.route('**/fonts.g**/**', (r) => r.abort())
  const state = { hits: 0 }
  if (gone) {
    await p.route('**/assets/Reports-*.js', (r) => {
      state.hits += 1
      if (gone === 'once' && state.hits > 1) return r.continue()
      // A plain 404, which is what it is now that vercel.json no longer
      // rewrites /assets/ to index.html.
      return r.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' })
    })
  }
  await p.goto(`${B}/`, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(1500)
  return {
    p, ctx, state,
    loads: () => p.evaluate(() => Number(sessionStorage.getItem('loads') || 0)),
    main: async () => (await p.locator('#main-content').innerText()).replace(/\s+/g, ' '),
    openReports: async () => {
      await p.getByRole('link', { name: /^Reports$/i }).first().click()
      await p.waitForTimeout(4500)
    },
  }
}

console.log('\n── A GOOD DEPLOY, LANDED UNDER A RUNNING APP ──')
{
  const { ctx, state, loads, main, openReports } = await open_('once')
  eq('one load to get in', await loads(), 1)
  await openReports()
  ok('the missing chunk was asked for', state.hits >= 1, String(state.hits))
  eq('and the app fetched itself again, once', await loads(), 2)
  const t = await main()
  ok('the page it was asked for is open', /Income, expenses and tax over the period you choose/i.test(t), t.slice(0, 300))
  ok('with no crash screen', !/something went wrong/i.test(t), t.slice(0, 300))
  ok('and nothing left saying a version is pending', !/new version of offset/i.test(t), t.slice(0, 300))
  await ctx.close()
}

console.log('\n── AND ONE THAT RELOADING DOES NOT HELP ──')
{
  // A genuinely broken deploy, or a cache that will not let go. The reload is
  // rate-limited, so the second failure falls through to the boundary — and
  // what it says there is the point. A page that could not be downloaded is not
  // a page that crashed, and "something went wrong" sends somebody hunting for
  // a bug in their own books.
  const { ctx, loads, main, openReports } = await open_('always')
  await openReports()
  eq('it reloads once and then stops', await loads(), 2)
  const t = await main()
  ok('and says a new version is ready', /new version of offset is ready/i.test(t), t.slice(0, 400))
  ok('that nothing has been lost', /nothing has been lost/i.test(t), t.slice(0, 400))
  ok('and offers the reload by hand', /reload offset/i.test(t), t.slice(0, 400))
  ok('rather than "something went wrong"', !/something went wrong/i.test(t), t.slice(0, 400))
  await ctx.close()
}

console.log('\n── THE CONTROL ──')
{
  // Nothing blocked. This is what makes the two counts above mean anything: a
  // client-side navigation is not a page load, so an app that reloaded on every
  // route change, or one that always claimed a new version was ready, fails
  // here.
  const { ctx, loads, main, openReports } = await open_(null)
  await openReports()
  eq('a route whose file is there costs no reload at all', await loads(), 1)
  const t = await main()
  ok('and simply opens', /Income, expenses and tax over the period you choose/i.test(t), t.slice(0, 300))
  ok('with no new-version screen', !/new version of offset/i.test(t), t.slice(0, 300))
  ok('and no crash screen', !/something went wrong/i.test(t), t.slice(0, 300))
  await ctx.close()
}

console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
