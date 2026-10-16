// A browser holding entries that will not read.
//
// Both local backends answered such a key with an empty array and said nothing,
// so the ledger read as empty — and the next save replaced the value with the
// one new row, destroying whatever was still in there. A half-written array is
// mostly intact text and can be picked over by hand; an overwritten one is gone.
import { chromium } from './_playwright.mjs'

const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b2) => ok(n, a === b2, `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b2)}`)

// What a write cut off halfway through looks like: valid JSON up to the cut.
const TRUNCATED = '[{"id":"e1","amount":1200,"category":"Materials","date":"2026-05-01","property_id":"p1"},{"id":"e2","amo'
const PROPERTIES = JSON.stringify([
  { id: 'p1', name: 'Marine Drive Tower', type: 'Property / Flat', value: 9000000, user_id: 'local-user' },
])

async function open_(seed) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
  await ctx.addInitScript((rows) => {
    try {
      for (const [k, v] of rows) localStorage.setItem(k, v)
    } catch {}
  }, seed)
  const p = await ctx.newPage()
  p.setDefaultTimeout(30000)
  await p.route('**/fonts.g**/**', (r) => r.abort())
  await p.goto(`${B}/`, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(2200)
  return {
    p, ctx,
    body: async () => (await p.locator('body').innerText()).replace(/\s+/g, ' '),
    stored: (k) => p.evaluate((key) => localStorage.getItem(key), k),
  }
}

console.log('\n── THE ENTRIES THAT WILL NOT READ ──')
{
  const { ctx, body, stored } = await open_([['pl_expenses', TRUNCATED], ['pl_properties', PROPERTIES]])
  const t = await body()
  ok('the app says so', /some saved entries could not be read/i.test(t), t.slice(0, 500))
  ok('and that the rest is what is shown', /what is shown is the rest/i.test(t), t.slice(0, 500))
  ok('and names the key, for getting them back by hand', /pl_expenses/.test(t), t.slice(0, 500))
  // The guarantee. Taken on the read, before anything in the app can write.
  eq('the original text is kept aside, byte for byte', await stored('pl_expenses__unreadable'), TRUNCATED)
  // And the app is usable: a bad key is not a dead app.
  ok('the books that did read are still there', /Marine Drive Tower/.test(t), t.slice(0, 600))
  await ctx.close()
}

console.log('\n── A VALUE OF THE WRONG SHAPE ──')
{
  // `JSON.parse(...) || []` handed this straight back and the consumer did
  // `[...rows].sort()`, which throws on something that is not iterable.
  const object = JSON.stringify({ id: 'e1', amount: 1200 })
  const { ctx, body, stored } = await open_([['pl_expenses', object], ['pl_properties', PROPERTIES]])
  const t = await body()
  ok('is reported too', /some saved entries could not be read/i.test(t), t.slice(0, 400))
  eq('and kept', await stored('pl_expenses__unreadable'), object)
  ok('with the app still standing', /Marine Drive Tower/.test(t), t.slice(0, 400))
  ok('and no crash screen', !/something went wrong/i.test(t), t.slice(0, 400))
  await ctx.close()
}

console.log('\n── THE CONTROLS ──')
{
  // Entries that read perfectly. Without this the suite would pass on a banner
  // that is always up and a copy that is always taken.
  const good = JSON.stringify([{ id: 'e1', amount: 1200, category: 'Materials', date: '2026-05-01', property_id: 'p1' }])
  const { ctx, body, stored } = await open_([['pl_expenses', good], ['pl_properties', PROPERTIES]])
  const t = await body()
  ok('say nothing', !/could not be read/i.test(t), t.slice(0, 400))
  eq('and nothing is copied aside', await stored('pl_expenses__unreadable'), null)
  ok('and the ledger is there', /Marine Drive Tower/.test(t), t.slice(0, 400))
  await ctx.close()
}
{
  // A browser with nothing in it at all, which is every first visit. A warning
  // here would meet everybody on their way in.
  const { ctx, body } = await open_([])
  const t = await body()
  ok('an empty browser is not a damaged one', !/could not be read/i.test(t), t.slice(0, 300))
  await ctx.close()
}

console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
