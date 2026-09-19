// The only screen in this app that asks somebody to leave the office.
//
// Every balance in the stores ledger is a claim. A receipt says a lorry
// arrived, an issue says a bag went to the slab, and the balance that falls out
// of them is consistent to the paisa and has never once been checked against a
// godown. On an Indian site that gap is the largest silent leak there is:
// material goes a few bags at a time, through issues nobody wrote down, and the
// books stay perfectly consistent the whole way.
//
// What has to be true on screen: a blank row is not a zero, a square count is
// still recorded, the correction is posted as a movement like any other, and
// short and over are never added together.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1300 }, serviceWorkers: 'block' })
const p = await ctx.newPage(); p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 160)) })
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('ERR_FAILED') && !t.includes('404')) errs.push('CONSOLE ' + t.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
p.on('dialog', (d) => d.accept())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
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
const view = async (label) => {
  await chose(p.locator('#main-content [role="tab"]', { hasText: label }).first())
}
const box = (name) => p.locator(`#main-content input[aria-label="Counted ${name}"]`)
const ENT = 'ent-cnt-1'

await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(({ ent }) => {
  localStorage.clear()
  const now = new Date().toISOString()
  for (const k of ['pl_expenses', 'pl_income', 'pl_documents']) localStorage.setItem(k, '[]')
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'a1', name: 'Yard', type: 'Real Estate — Villa / House', entity_id: ent, created_at: now },
  ]))
  localStorage.setItem('pl_corp_entities', JSON.stringify([
    { id: ent, name: 'Navi Builders Pvt Ltd', currency: 'INR', fy_start_month: 4, created_at: now },
  ]))
  localStorage.setItem('pl_corp_members', JSON.stringify([
    { id: 'm1', entity_id: ent, user_id: 'local-user', email: '', role: 'owner', created_at: now },
  ]))
  localStorage.setItem('pl_corp_active', ent)
  localStorage.setItem('pl_corp_projects', JSON.stringify([
    { id: 'site', entity_id: ent, name: 'Marine Drive Tower', status: 'active', contract_value: 0, estimate: 0, created_at: now, updated_at: now },
  ]))
  localStorage.setItem('pl_corp_items', JSON.stringify([
    { id: 'cement', entity_id: ent, name: 'OPC 53 grade cement', category: 'cement', unit: 'bag', reorder_level: 0, created_at: now, updated_at: now },
    { id: 'steel', entity_id: ent, name: 'TMT bars 12mm', category: 'steel', unit: 'kg', reorder_level: 0, created_at: now, updated_at: now },
  ]))
  localStorage.setItem('pl_corp_movements', JSON.stringify([
    { id: 'm1', entity_id: ent, item_id: 'cement', kind: 'receipt', qty: 1000, unit_cost: 400, other_cost: 0, date: '2026-01-10', store_id: null, to_store_id: null, project_id: null, vendor: 'UltraTech', reason: '', note: '', ref: '', created_at: now, updated_at: now },
    { id: 'm2', entity_id: ent, item_id: 'cement', kind: 'issue', qty: 200, unit_cost: 0, other_cost: 0, date: '2026-02-10', store_id: null, to_store_id: null, project_id: 'site', vendor: '', reason: '', note: '', ref: '', created_at: now, updated_at: now },
    { id: 'm3', entity_id: ent, item_id: 'steel', kind: 'receipt', qty: 5000, unit_cost: 60, other_cost: 0, date: '2026-01-15', store_id: null, to_store_id: null, project_id: null, vendor: 'Shakti', reason: '', note: '', ref: '', created_at: now, updated_at: now },
  ]))
}, { ent: ENT })

console.log('\n── NOBODY HAS EVER LOOKED ──')
await p.goto(`${B}/operations?tab=materials`, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
await view('Verify')
let t = await main()
ok('the verify screen opens', /count sheet/i.test(t), t.slice(0, 300))
ok('and says the store has never been counted', /never been counted/i.test(t), t.slice(0, 500))
ok('naming it', /The yard/.test(t))
ok('the books say eight hundred bags', /800/.test(t), t.slice(0, 800))
ok('and five thousand kilos', /5000/.test(t))
ok('nothing is on file yet', /counts on file/i.test(t))

console.log('\n── A BLANK IS NOT A ZERO ──')
// The distinction the whole sheet turns on: a row nobody wrote in is a row
// nobody counted, and a zero is a material somebody looked for and did not find.
ok('the save is refused with nothing entered',
  await p.getByRole('button', { name: /record count/i }).first().isDisabled())
ok('and it says nothing has been counted', /nothing counted yet/i.test(await main()))

console.log('\n── WHAT THE SHELF ACTUALLY HELD ──')
await box('OPC 53 grade cement').fill('760')
await p.waitForTimeout(400)
t = await main()
ok('the difference appears as it is typed', /-40/.test(t), t.slice(0, 900))
ok('and it is counted as one short', /1 short/.test(t), t.slice(0, 900))
ok('with what it is worth', /₹16,000 short/.test(t), t.slice(0, 900))
// The second material, the other way, so the two can be seen not to merge.
await box('TMT bars 12mm').fill('5040')
await p.waitForTimeout(400)
t = await main()
ok('an overage is counted separately', /1 short, 1 over/.test(t), t.slice(0, 900))
// ₹16,000 short and ₹2,400 over. Netting them would print ₹13,600.
ok('and the shortage is not netted against it', /₹16,000 short/.test(t), t.slice(0, 900))
ok('which is not the difference of the two', !/13,600/.test(t), t.slice(0, 900))

console.log('\n── RECORDING IT ──')
await p.getByRole('button', { name: /record count/i }).first().click()
await p.waitForTimeout(1200)
const counts = await ls('pl_corp_stock_counts')
ok('both counts are stored', counts.length === 2, String(counts.length))
const bags = counts.find((c) => c.item_id === 'cement')
ok('carrying what was counted', Number(bags?.counted_qty) === 760, String(bags?.counted_qty))
// Frozen, not derived: this is what makes a verification a verification.
ok('and what the books said at the time', Number(bags?.book_qty) === 800, String(bags?.book_qty))
ok('at what the shelf was carrying it at', Number(bags?.avg_cost) === 400, String(bags?.avg_cost))
ok('the yard is stored as no store, like a movement', bags?.store_id === null, String(bags?.store_id))

console.log('\n── AND THE CORRECTION IT IMPLIES ──')
const moves = (await ls('pl_corp_movements')).filter((m) => m.kind === 'adjustment')
ok('two adjustments were posted', moves.length === 2, String(moves.length))
const down = moves.find((m) => m.item_id === 'cement')
ok('the shortage is negative', Number(down?.qty) === -40, String(down?.qty))
ok('the overage is positive', Number(moves.find((m) => m.item_id === 'steel')?.qty) === 40)
ok('and it says where it came from', /Physical verification/.test(down?.note || ''), down?.note)

console.log('\n── WHAT HAS BEEN CHECKED ──')
t = await main()
ok('the sheet is on the record', /what has been checked/i.test(t), t.slice(0, 400))
ok('the yard is no longer unverified', !/never been counted/i.test(t), t.slice(0, 400))
ok('the shortage is on a stat card', /found short/i.test(t))
ok('and the overage on its own', /found over/i.test(t))
// The site store holds nothing, so it is not nagged about — the difference
// between "unchecked" and "empty". Scoped to the warning rather than the page:
// the store selector lists every site by name, so a check over the whole screen
// can never fail and is worth nothing.
ok('no store is called overdue at all', !/overdue a count|never been counted/i.test(t), t.slice(0, 600))
ok('though the empty site is still offered to count',
  (await p.locator('#main-content select[aria-label="Store to count"] option').allInnerTexts()).some((o) => /Marine Drive Tower/.test(o)))

console.log('\n── A COUNT THAT FINDS NOTHING IS STILL A COUNT ──')
// It is what proves a store sound, and a list of only the bad ones reads as
// though every count found something.
//
// The site store, which the books say holds nothing — so a count of nothing is
// square. Not the yard on a back-date: a sheet dated before today excludes the
// correction just posted, so it would read as short again and prove the
// opposite of what this section is for.
await p.locator('#main-content select[aria-label="Store to count"]').selectOption('site')
await p.waitForTimeout(500)
await box('OPC 53 grade cement').fill('0')
await p.waitForTimeout(300)
t = await main()
ok('counting exactly what the books now say is square', /1 square/.test(t), t.slice(0, 900))
await p.getByRole('button', { name: /record count/i }).first().click()
await p.waitForTimeout(1200)
ok('it is stored all the same', (await ls('pl_corp_stock_counts')).length === 3, String((await ls('pl_corp_stock_counts')).length))
ok('and corrects nothing', (await ls('pl_corp_movements')).filter((m) => m.kind === 'adjustment').length === 2)
ok('the record says it was all square', /all square/i.test(await main()), (await main()).slice(0, 700))

ok('no page errors', errs.length === 0, errs.join(' | '))
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
