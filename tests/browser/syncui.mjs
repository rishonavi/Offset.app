// What a person is told about the state of their books on this device.
//
// The reconciliation itself is tested in `tests/logic/sync.test.mjs` and
// `syncwire.test.mjs`, against a stub rather than a server — this build runs in
// demo mode, where there is no server to reconcile with. So what is asserted
// here is the behaviour that matters most in that state: that the app does not
// claim to be up to date with something it is not talking to, and that the
// mistake several people keeping one ledger actually make — the same day
// entered twice — is surfaced whether or not anything is syncing.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 }, serviceWorkers: 'block' })
const p = await ctx.newPage()
p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 160)) })
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('ERR_FAILED') && !t.includes('404')) errs.push('CONSOLE ' + t.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
p.on('dialog', (d) => d.accept())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${e ? '  — ' + e : ''}`) }
// Clicking a tab is a network fetch now, and React commits the switch
// asynchronously. So "no loading card on screen" is true for a moment *before*
// the new panel starts loading, and a check made in that moment passes while
// still reading the tab you just left — which is how four assertions came to
// read the demo-mode banner off a page that was perfectly correct.
//
// The control reports itself chosen in the same commit that mounts the loading
// card, so waiting for that first closes the gap. Then wait for the card to go.
const chose = async (locator) => {
  await locator.click()
  const handle = await locator.elementHandle()
  await p.waitForFunction(
    (el) => el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true',
    handle, { timeout: 30000 })
  await p.waitForFunction(() => !document.querySelector('#main-content [role="status"]'), null, { timeout: 30000 })
  await p.waitForTimeout(150)
}
const ls = (k) => p.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), k)
const main = () => p.locator('#main-content').innerText()

const seed = (muster = []) => p.evaluate((rows) => {
  localStorage.clear()
  const id = 'ent-sync-1'
  const now = new Date().toISOString()
  const born = new Date(); born.setFullYear(born.getFullYear() - 1)
  localStorage.setItem('pl_properties', '[]')
  for (const k of ['pl_expenses', 'pl_income', 'pl_documents']) localStorage.setItem(k, '[]')
  localStorage.setItem('pl_corp_entities', JSON.stringify([
    { id, name: 'Navi Builders Pvt Ltd', currency: 'INR', fyStartMonth: 4, created_at: born.toISOString(), updated_at: born.toISOString() },
  ]))
  localStorage.setItem('pl_corp_members', JSON.stringify([
    { id: 'm1', entity_id: id, user_id: 'local-user', email: 'owner@test.invalid', role: 'owner', department_id: null, created_at: now },
  ]))
  localStorage.setItem('pl_corp_muster', JSON.stringify(rows))
  localStorage.setItem('pl_corp_active', id)
}, muster)

console.log('\n── NOTHING TO RECONCILE WITH, AND IT SAYS SO BY SAYING NOTHING ──')
await p.goto(B, { waitUntil: 'domcontentloaded' })
await seed()
await p.goto(`${B}/companies`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
const quiet = await main()
// "Everything is up to date" with no server behind it is a lie that reads as
// reassurance, which is the worst kind.
ok('demo mode claims nothing about being up to date', !/up to date/i.test(quiet), quiet.slice(0, 400))
ok('and shows no tick for a sync that is not happening', !/Last reconciled/i.test(quiet))
ok('the page is otherwise itself', /Audit log/.test(quiet))

console.log('\n── A WRITE CARRIES A VERSION ──')
// Without one, nothing can tell a row that has been sent from one that has not.
await p.goto(`${B}/operations`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
await chose(p.locator('#main-content button[aria-pressed]').nth(2))
await p.locator('input[aria-label="Muster date"]').fill('2026-03-03')
await p.locator('select[aria-label="Trade"]').selectOption('mason')
await p.locator('input[aria-label="Headcount"]').fill('14')
await p.locator('input[aria-label="Day rate"]').fill('800')
await p.locator('button', { hasText: /record muster/i }).click()
await p.waitForTimeout(700)
const written = await ls('pl_corp_muster')
ok('the row is stored', written.length === 1, String(written.length))
ok('carrying when it was written', Boolean(written[0].updated_at), JSON.stringify(written[0]).slice(0, 120))
// Nothing has acknowledged it, which is exactly what unsent means.
ok('and nothing has acknowledged it yet', !written[0]._rev)

console.log('\n── A DELETE LEAVES A MARK ──')
// A row that is simply gone cannot reach the other devices: each keeps its
// copy, re-sends it, and the thing somebody deleted comes back.
await p.goto(`${B}/operations`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
await chose(p.locator('#main-content button[aria-pressed]').nth(1))
await chose(p.locator('#main-content [role="tab"]', { hasText: 'Quotations' }).first())
await p.evaluate(() => {
  const now = new Date().toISOString()
  localStorage.setItem('pl_corp_quotes', JSON.stringify([{
    id: 'q1', entity_id: 'ent-sync-1', vendor: 'Shree Traders', date: '2026-04-01',
    valid_until: '', project_id: null, lines: [], status: 'sent', notes: '', ref: '',
    created_at: now, updated_at: now,
  }]))
})
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(800)
await chose(p.locator('#main-content button[aria-pressed]').nth(1))
await chose(p.locator('#main-content [role="tab"]', { hasText: 'Quotations' }).first())
await p.locator('#main-content button[aria-label^="Delete quotation"]').first().click()
await p.waitForTimeout(700)
const quotes = await ls('pl_corp_quotes')
ok('the row is still in storage', quotes.length === 1, String(quotes.length))
ok('marked with the day it went', Boolean(quotes[0].deleted_at))
ok('and gone from the screen', !/Shree Traders/.test(await main()), (await main()).slice(0, 400))

console.log('\n── THE SAME DAY ENTERED TWICE ──')
// The mistake several people keeping one ledger actually make. It is just as
// true of two entries on one device, so it does not wait for a server.
const twice = [
  { id: 'm1', entity_id: 'ent-sync-1', date: '2026-03-03', trade: 'mason', project_id: null, headcount: 14, rate: 800, overtime_hours: 0, overtime_rate: 0, created_at: '2026-03-03T10:00:00.000Z', updated_at: '2026-03-03T10:00:00.000Z' },
  { id: 'm2', entity_id: 'ent-sync-1', date: '2026-03-03', trade: 'mason', project_id: null, headcount: 14, rate: 800, overtime_hours: 0, overtime_rate: 0, created_at: '2026-03-03T18:00:00.000Z', updated_at: '2026-03-03T18:00:00.000Z' },
  { id: 'm3', entity_id: 'ent-sync-1', date: '2026-03-03', trade: 'helper', project_id: null, headcount: 22, rate: 500, overtime_hours: 0, overtime_rate: 0, created_at: '2026-03-03T10:00:00.000Z', updated_at: '2026-03-03T10:00:00.000Z' },
]
await p.goto(B, { waitUntil: 'domcontentloaded' })
await seed(twice)
await p.goto(`${B}/companies`, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
const flagged = await main()
ok('the repeat is surfaced even with no server', /looks like a repeat|look like repeats/.test(flagged), flagged.slice(0, 600))
ok('naming the day', /2026-03-03/.test(flagged), flagged.slice(0, 800))
ok('and saying how many copies', /2×|2 copies/.test(flagged), flagged.slice(0, 800))
// Nothing is deleted for you: both entries are valid rows and only a person
// knows which is the re-entry.
ok('nothing was deleted on your behalf', (await ls('pl_corp_muster')).filter((r) => !r.deleted_at).length === 3)
// A different trade on the same day is a different thing, not a repeat.
ok('the helpers are not called a repeat', !/helper/i.test(flagged.slice(flagged.indexOf('repeat'), flagged.indexOf('repeat') + 300)))

console.log('\n── AND NOT WHEN THERE IS NOTHING TO SAY ──')
await p.goto(B, { waitUntil: 'domcontentloaded' })
await seed([twice[0], twice[2]])
await p.goto(`${B}/companies`, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
ok('a clean ledger is not nagged about', !/looks like a repeat|look like repeats/.test(await main()))

console.log('\n── NOTHING BROKE ──')
ok('no page errors anywhere in the run', errs.length === 0, errs.slice(0, 3).join(' / '))

console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
if (fail) process.exitCode = 1
