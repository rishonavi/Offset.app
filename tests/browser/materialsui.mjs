// Construction materials on screen: the trades, the three ways stock leaves a
// site, what any of it costs, and which job burned it.
//
// The assertions worth reading are the ones about rejection. A rejected
// delivery is the one movement that must not become a cost of the job, and
// getting it wrong is invisible — the totals still add up, they are just wrong
// in the supplier's favour.
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
const rows = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), key)
const main = () => p.locator('#main-content').innerText()
// The sub-tabs are pills, not the aria-pressed row the outer tabs use.
const view = async (label) => {
  await chose(p.locator('#main-content [role="tab"]', { hasText: label }).first())
}

// ── Set-up: one company, nothing in it ──
await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(() => {
  localStorage.clear()
  const id = 'ent-mat-1'
  const born = new Date(); born.setFullYear(born.getFullYear() - 1)
  localStorage.setItem('pl_properties', '[]')
  for (const k of ['pl_expenses', 'pl_income', 'pl_documents']) localStorage.setItem(k, '[]')
  localStorage.setItem('pl_corp_entities', JSON.stringify([
    { id, name: 'Navi Builders Pvt Ltd', registration: '', gstin: '27AAAPA1234A1Z5', currency: 'INR', fyStartMonth: 4, created_at: born.toISOString() },
  ]))
  localStorage.setItem('pl_corp_members', JSON.stringify([
    { id: 'm1', entity_id: id, user_id: 'local-user', email: '', role: 'owner', department_id: null, created_at: new Date().toISOString() },
  ]))
  localStorage.setItem('pl_corp_active', id)
})
await p.goto(`${B}/operations`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)

// The page opens on Projects — a cost belongs to a job before it belongs to a
// ledger — so this suite has to ask for Materials.
const OUTER = ['Projects', 'Materials', 'Labour', 'Plant', 'Sales', 'Advances', 'Payroll']
const outerTab = async (name) => {
  await chose(p.locator('#main-content button[aria-pressed]').nth(OUTER.indexOf(name)))
}
await outerTab('Materials')

console.log('\n── THE FOUR QUESTIONS ──')
const opened = await main()
ok('the tab is Materials, not a generic Stock', /Add a material/.test(opened), opened.slice(0, 160))
for (const label of ['Inventory', 'Prices', 'Quotations', 'Usage']) {
  ok(`there is a view for ${label}`, (await p.locator('#main-content [role="tab"]', { hasText: label }).count()) > 0)
}
ok('and it opens on the inventory', /No materials yet/.test(opened))

console.log('\n── PICKING A TRADE FILLS THE FORM IN ──')
// Cement is bagged and sand is not. A builder should not have to know that the
// unit dropdown needs changing.
await p.locator('select[aria-label="Trade"]').selectOption('aggregate')
await p.waitForTimeout(300)
ok('choosing sand & aggregate sets the unit to brass',
  (await p.locator('select[aria-label="Unit"]').inputValue()) === 'brass',
  await p.locator('select[aria-label="Unit"]').inputValue())
await p.locator('select[aria-label="Trade"]').selectOption('cement')
await p.waitForTimeout(300)
ok('and cement to bags', (await p.locator('select[aria-label="Unit"]').inputValue()) === 'bag')
await p.locator('select[aria-label="Trade"]').selectOption('steel')
await p.waitForTimeout(300)
ok('and steel to kilos', (await p.locator('select[aria-label="Unit"]').inputValue()) === 'kg')

// The catalogue is a shortcut, not a whitelist.
await p.locator('input[aria-label="Material name"]').fill('Cement OPC 53 grade')
await p.waitForTimeout(350)
ok('typing a catalogue name corrects the unit to what the trade uses',
  (await p.locator('select[aria-label="Unit"]').inputValue()) === 'bag',
  await p.locator('select[aria-label="Unit"]').inputValue())
const listed = await p.locator('#material-catalogue option').count()
ok('the catalogue offers a real list', listed > 40, String(listed))

console.log('\n── ADDING MATERIALS ──')
const addMaterial = async (trade, name, unit, reorder) => {
  await p.locator('select[aria-label="Trade"]').selectOption(trade)
  await p.waitForTimeout(200)
  await p.locator('input[aria-label="Material name"]').fill(name)
  await p.waitForTimeout(250)
  if (unit) await p.locator('select[aria-label="Unit"]').selectOption(unit)
  if (reorder) await p.locator('input[aria-label="Reorder level"]').fill(String(reorder))
  await p.locator('button', { hasText: 'Add material' }).click()
  await p.waitForTimeout(450)
}
await addMaterial('cement', 'Cement OPC 53 grade', null, 20)
await addMaterial('steel', 'TMT bar 12mm Fe500', null, 500)
await addMaterial('joinery', 'Flush door shutter 32mm', null, 0)
const items = await ls('pl_corp_items')
ok('all three are stored', items.length === 3, String(items.length))
ok('each carries its trade', items.every((i) => i.category), JSON.stringify(items.map((i) => i.category)))
ok('the HSN chapter came with the catalogue entry',
  items.find((i) => i.category === 'cement')?.hsn === '2523',
  items.find((i) => i.category === 'cement')?.hsn)
ok('and the units are the trade’s, not pcs',
  items.map((i) => i.unit).sort().join(',') === 'bag,kg,nos',
  items.map((i) => `${i.name}:${i.unit}`).join(' / '))
ok('and every one is scoped to the company', items.every((i) => i.entity_id === 'ent-mat-1'))

const afterAdd = await main()
ok('materials are grouped by trade, not thrown in one list',
  /Cement & concrete/.test(afterAdd) && /Steel & reinforcement/.test(afterAdd) && /Doors & windows/.test(afterAdd),
  afterAdd.slice(0, 240))
// A job does cement before doors. Alphabetical would put doors first.
ok('and the trades run in the order a job consumes them',
  afterAdd.indexOf('Cement & concrete') < afterAdd.indexOf('Steel & reinforcement') &&
  afterAdd.indexOf('Steel & reinforcement') < afterAdd.indexOf('Doors & windows'))

console.log('\n── IN, OUT, WASTED, REJECTED ──')
const record = async (o) => {
  const form = p.locator('#main-content form').nth(1)
  await form.locator('select[aria-label="Material"]').selectOption({ label: o.material })
  await form.locator('select[aria-label="What happened"]').selectOption(o.kind)
  await p.waitForTimeout(250)
  await form.locator('input[aria-label="Quantity"]').fill(String(o.qty))
  if (o.rate !== undefined) await form.locator('input[aria-label="Rate per unit"]').fill(String(o.rate))
  if (o.freight !== undefined) await form.locator('input[aria-label="Freight and handling"]').fill(String(o.freight))
  if (o.vendor) await form.locator('input[aria-label="Vendor"]').fill(o.vendor)
  if (o.reason) await form.locator('input[aria-label="Rejection reason"]').fill(o.reason)
  if (o.store !== undefined) await form.locator('select[aria-label="Store"]').selectOption(o.store ? { label: o.store } : '')
  if (o.into) await form.locator('select[aria-label="Into store"]').selectOption({ label: o.into })
  if (o.site) await form.locator('select[aria-label="Site"]').selectOption({ label: o.site })
  await form.locator('button', { hasText: 'Record' }).click()
  await p.waitForTimeout(500)
}
ok('rejection is one of the things that can happen to a delivery',
  (await p.locator('#main-content select[aria-label="What happened"] option').allInnerTexts())
    .some((t) => /rejected/i.test(t)))

// 200 bags at ₹400. Ten of them set hard in transit and went back.
await record({ material: 'Cement OPC 53 grade', kind: 'receipt', qty: 200, rate: 400, vendor: 'Shree Traders' })
let text = await main()
ok('the receipt reaches the shelf', /200 bag/.test(text), text.slice(0, 200))
ok('and the value with it', /80,000/.test(text))

await record({ material: 'Cement OPC 53 grade', kind: 'rejected', qty: 10, rate: 400, vendor: 'Shree Traders', reason: 'Set hard in transit' })
text = await main()
const movements = await ls('pl_corp_movements')
const rejection = movements.find((m) => m.kind === 'rejected')
ok('the rejection is stored as its own kind', Boolean(rejection), JSON.stringify(movements.map((m) => m.kind)))
ok('with the reason, without which nobody can claim it', rejection?.reason === 'Set hard in transit', rejection?.reason)
ok('and the vendor it goes back to', rejection?.vendor === 'Shree Traders')
ok('the stock falls by what went back', /190 bag/.test(text), text.slice(0, 200))
// The whole point: this is a receivable from a supplier, not a cost of the job
// and not an asset on the shelf.
ok('what suppliers owe back is shown apart from the stock value',
  /Rejected.*claimable/is.test(text) && /4,000/.test(text), text.slice(0, 400))
ok('and it is not added into the stock value', /76,000/.test(text), text.slice(0, 300))

// Now the two that really are costs.
await record({ material: 'Cement OPC 53 grade', kind: 'issue', qty: 100 })
await record({ material: 'Cement OPC 53 grade', kind: 'wastage', qty: 10 })
text = await main()
ok('issued and wasted are separate columns', /issued/i.test(text) && /wasted/i.test(text) && /rejected/i.test(text))
ok('the wastage rate is worked out and shown', /9\.1%/.test(text), text.slice(0, 500))
ok('and the rejection rate against what was delivered', /5%/.test(text), text.slice(0, 500))

console.log('\n── WHAT IT COST TO GET IT HERE ──')
// A lorry of sand is two bills: the sand and the trip.
await addMaterial('aggregate', 'River sand', null, 0)
await record({ material: 'River sand', kind: 'receipt', qty: 10, rate: 4500, freight: 9000, vendor: 'Kokan Sand' })
const sandText = await main()
ok('freight lands in the value of the stock', /54,000/.test(sandText), sandText.slice(0, 400))
ok('and the page says how much of it was the trip',
  /9,000 of freight and handling/.test(sandText), sandText.slice(0, 600))

console.log('\n── PRICES ──')
await record({ material: 'TMT bar 12mm Fe500', kind: 'receipt', qty: 1000, rate: 52, vendor: 'Shree Traders' })
await record({ material: 'TMT bar 12mm Fe500', kind: 'receipt', qty: 1000, rate: 61, vendor: 'Shree Traders' })
await view('Prices')
const prices = await main()
ok('the price list shows what was last paid', /61/.test(prices), prices.slice(0, 400))
// The number that explains why a job costed last year no longer adds up.
ok('and how far the rate has drifted since the first purchase', /\+17\.3%/.test(prices), prices.slice(0, 500))
ok('material nobody has bought is counted, not hidden', /never priced/i.test(prices))

console.log('\n── QUOTATIONS ──')
await view('Quotations')
ok('there is nothing on file yet', /No quotations yet/.test(await main()))
const quote = async (vendor, rate, gst) => {
  await p.locator('input[aria-label="Quotation vendor"]').fill(vendor)
  await p.locator('select[aria-label="Quoted material"]').first().selectOption({ label: 'Cement OPC 53 grade' })
  await p.locator('input[aria-label="Quoted quantity"]').first().fill('100')
  await p.locator('input[aria-label="Quoted rate"]').first().fill(String(rate))
  await p.locator('select[aria-label="GST rate"]').first().selectOption(String(gst))
  await p.locator('button', { hasText: 'Save quotation' }).click()
  await p.waitForTimeout(500)
}
// ₹380 at 28% lands at ₹486.40; ₹400 at 18% lands at ₹472. Read the rate column
// alone — which is how it is usually done — and you pick the dearer vendor.
await quote('Shree Traders', 380, 28)
await quote('Konkan Cement', 400, 18)
const quotes = await ls('pl_corp_quotes')
ok('both quotations are stored', quotes.length === 2, String(quotes.length))
ok('each keeps its own tax rate',
  quotes.map((q) => q.lines[0]?.gst_percent).sort().join(',') === '18,28',
  JSON.stringify(quotes.map((q) => q.lines[0]?.gst_percent)))
ok('and the material it is for', quotes.every((q) => q.lines[0]?.item_id))

await p.locator('select[aria-label="Compare material"]').selectOption({ label: 'Cement OPC 53 grade' })
await p.waitForTimeout(450)
const cmp = await main()
ok('the comparison ranks by the landed price, not the rate',
  cmp.indexOf('Konkan Cement') < cmp.indexOf('Shree Traders'),
  cmp.slice(cmp.indexOf('Compare on one material'), cmp.indexOf('Compare on one material') + 400))
ok('and says so with both figures', /472/.test(cmp) && /486/.test(cmp))
ok('the spread is spelled out', /3% between the cheapest and the dearest/.test(cmp), cmp.slice(0, 600))

// Accepting is a decision, not a delivery. Booking the stock here would put a
// hundred bags of cement on the shelf the moment somebody agreed a price.
const before = (await ls('pl_corp_movements')).length
await p.locator('#main-content button', { hasText: 'Accept' }).first().click()
await p.waitForTimeout(700)
ok('the quotation is marked accepted', (await ls('pl_corp_quotes')).some((q) => q.status === 'accepted'))
ok('and nothing arrived on the shelf for it',
  (await ls('pl_corp_movements')).length === before, `${before} → ${(await ls('pl_corp_movements')).length}`)

// The delivery, when it comes, at the rate that was agreed.
await p.locator('#main-content button', { hasText: 'Receive delivery' }).first().click()
await p.waitForTimeout(700)
const after = await ls('pl_corp_movements')
ok('receiving the delivery books the receipt', after.length === before + 1, `${before} → ${after.length}`)
const booked = after[after.length - 1]
ok('at the rate that was agreed', Number(booked.unit_cost) === 400 || Number(booked.unit_cost) === 380, String(booked.unit_cost))
ok('against the vendor who quoted it', Boolean(booked.vendor), booked.vendor)
// Pressing it twice would double the stock, and nothing on the shelf says so.
ok('and it cannot be received a second time',
  (await p.locator('#main-content button', { hasText: 'Receive delivery' }).count()) === 0)
ok('the quotation says it was delivered', /delivered/i.test(await main()))

console.log('\n── USAGE ──')
await view('Usage')
// Sites are made on the Projects tab, not here: two forms writing the same
// store is how the two quietly stop agreeing about what a site is.
ok('with no sites it points at where they are made', /No sites yet/.test(await main()), (await main()).slice(0, 300))
ok('and offers no second way to create one',
  (await p.locator('#main-content input[aria-label="Site name"]').count()) === 0)
await p.evaluate(() => {
  localStorage.setItem('pl_corp_projects', JSON.stringify([{
    id: 'site-md', entity_id: 'ent-mat-1', name: 'Marine Drive Tower', code: 'MD-1', client: '',
    contract_value: 0, estimate: 0, status: 'active', created_at: new Date().toISOString(),
  }]))
})
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(700)
await outerTab('Materials')
await view('Usage')
const sites = await ls('pl_corp_projects')
ok('the site is stored', sites.length === 1, JSON.stringify(sites[0] || {}).slice(0, 80))
ok('and scoped to the company', sites[0]?.entity_id === 'ent-mat-1')
ok('it appears on the page', /Marine Drive Tower/.test(await main()))

// With a site on file, the movement form has somewhere to book material to.
await view('Inventory')
ok('the movement form now offers a site',
  (await p.locator('#main-content select[aria-label="Site"]').count()) === 0)
await p.locator('#main-content form').nth(1).locator('select[aria-label="What happened"]').selectOption('issue')
await p.waitForTimeout(300)
ok('once the movement is one that leaves the shelf',
  (await p.locator('#main-content select[aria-label="Site"]').count()) === 1)
await record({ material: 'TMT bar 12mm Fe500', kind: 'issue', qty: 400, site: 'Marine Drive Tower' })
await record({ material: 'TMT bar 12mm Fe500', kind: 'wastage', qty: 50, site: 'Marine Drive Tower' })

await view('Usage')
const usage = await main()
ok('the site shows what it consumed', /Marine Drive Tower/.test(usage))
ok('issued and wasted stay apart there too', /400/.test(usage) && /50/.test(usage), usage.slice(0, 600))
// Material issued before there was a site to book it to has to show up
// somewhere, or a company's costs quietly do not add up.
ok('and material nobody booked to a site is called that',
  /Not booked to a site/.test(usage), usage.slice(0, 700))

console.log('\n── A YARD AND A STORE ON EVERY SITE ──')
await outerTab('Materials')
await view('Inventory')
let stores = await main()
// The total, and the two halves it is made of. A builder who knows only the
// total will buy again for a site that already has it.
ok('the yard and the sites are shown apart from the total',
  /in the yard/i.test(stores) && /out on sites/i.test(stores), stores.slice(0, 500))
// Everything recorded so far had no store on it, which is what every movement
// written before there were stores says: it was all at the yard.
ok('everything recorded so far is in the yard', /out on sites[\s\S]{0,40}₹0/i.test(stores), stores.slice(0, 600))

// A delivery straight to site: the lorry never sees the yard.
await record({ material: 'Cement OPC 53 grade', kind: 'receipt', qty: 50, rate: 400, store: 'Marine Drive Tower' })
stores = await main()
ok('a delivery to a site lands there', /where the stock is/i.test(stores), stores.slice(0, 900))
ok('and the yard and the site are listed separately',
  /central store/i.test(stores) && /Marine Drive Tower/.test(stores), stores.slice(0, 900))
const afterDirect = await rows(p, 'pl_corp_movements')
ok('the delivery carries the store it landed at',
  afterDirect.some((m) => m.kind === 'receipt' && m.store_id === 'site-md'),
  JSON.stringify(afterDirect.slice(-1)))

// Moving it between the company's own stores.
await record({ material: 'Cement OPC 53 grade', kind: 'transfer', qty: 20, store: 'Central store', into: 'Marine Drive Tower' })
const moved = (await rows(p, 'pl_corp_movements')).find((m) => m.kind === 'transfer')
ok('a transfer is one row, not two', Boolean(moved), JSON.stringify(moved || {}))
ok('carrying both ends', moved?.store_id === null && moved?.to_store_id === 'site-md',
  `${moved?.store_id} → ${moved?.to_store_id}`)
stores = await main()
ok('the material now sits in two stores',
  /in the yard/i.test(stores) && !/out on sites[\s\S]{0,40}₹0/i.test(stores), stores.slice(0, 600))
// The company did not buy anything, so the company did not gain anything.
ok('and each material says how it is split between them',
  /in the yard ·/i.test(stores), stores.slice(0, 1400))

console.log('\n── THE MOVEMENT LOG ──')
// The log lives on the Usage view, and the stores work above left us on
// Inventory.
await view('Usage')
const logText = await main()
ok('the log lists what happened', /Movement log/.test(logText))
ok('and says which store each movement was at', /central store/i.test(logText), logText.slice(-900))
ok('a transfer names both ends', /Central store → Marine Drive Tower/.test(logText), logText.slice(-1200))
ok('including the rejection, with its reason', /Set hard in transit/.test(logText), logText.slice(-900))
await p.locator('select[aria-label="Filter by movement"]').selectOption('rejected')
await p.waitForTimeout(450)
const filtered = await main()
ok('it can be narrowed to rejections', /Set hard in transit/.test(filtered) && !/Issued to site ·/.test(filtered), filtered.slice(-500))
await p.locator('select[aria-label="Filter by movement"]').selectOption('')
await p.waitForTimeout(400)

console.log('\n── AND IT ALL LEAVES A TRAIL ──')
// Every construction ledger used to write nothing at all to the audit log, in
// an app that keeps one, shows it on a page, and tested it — so what went
// unrecorded was exactly the work that decides money.
// Deleting is the one write this suite had not exercised, and an untried path
// is exactly where a silent ledger hides.
await outerTab('Materials')
await view('Quotations')
const quotesBefore = (await ls('pl_corp_quotes')).filter((q) => !q.deleted_at).length
await p.locator('#main-content button[aria-label^="Delete quotation"]').first().click()
await p.waitForTimeout(600)
const quotesAfter = await ls('pl_corp_quotes')
ok('a quotation can be deleted', quotesAfter.filter((q) => !q.deleted_at).length === quotesBefore - 1,
  `${quotesBefore} → ${quotesAfter.filter((q) => !q.deleted_at).length}`)
// A tombstone rather than a hole: a row that is simply gone cannot reach the
// other devices, so each would keep its copy, re-send it, and the thing
// somebody deleted would come back.
ok('and leaves a mark rather than a hole', quotesAfter.some((q) => q.deleted_at),
  JSON.stringify(quotesAfter.map((q) => Boolean(q.deleted_at))))

const trail = await ls('pl_corp_audit')
for (const action of ['material.create', 'movement.create', 'quotation.create', 'quotation.delete']) {
  ok(`${action} is recorded`, trail.some((a) => a.action === action),
    [...new Set(trail.map((a) => a.action))].join(', '))
}
ok('every entry names the company it belongs to', trail.every((a) => a.entity_id === 'ent-mat-1'))
ok('and reads as a sentence rather than a dotted string',
  trail.every((a) => a.summary && !/^[a-z]+\.[a-z]+$/.test(a.summary)),
  trail.filter((a) => /^[a-z]+\.[a-z]+$/.test(a.summary || '')).map((a) => a.action).join(', '))
await p.goto(`${B}/companies`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
const shown = await main()
ok('and the log on screen shows the construction work',
  /recorded a stock movement|added a material/i.test(shown), shown.slice(-900))
await p.goto(`${B}/operations`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
await outerTab('Materials')

console.log('\n── FINDING IT ──')
// Somebody looking for where the cement is types "cement", not "operations".
await p.locator('body').click({ position: { x: 5, y: 5 } })
await p.keyboard.press('Control+k')
await p.locator('[role="dialog"] input').first().waitFor({ state: 'visible' })
for (const word of ['cement', 'quotation', 'rejected', 'materials']) {
  await p.locator('[role="dialog"] input').first().fill(word)
  await p.waitForTimeout(350)
  ok(`the palette finds Operations by the word ${word}`,
    /Operations/.test(await p.locator('[role="dialog"]').innerText()))
}
await p.keyboard.press('Escape')
await p.waitForTimeout(300)

console.log('\n── THE BOOKS LINE STILL HOLDS ──')
// Materials belong to a company. Switching to the personal books must not show
// somebody else's steel.
await p.evaluate(() => localStorage.setItem('pl_corp_active', '__personal__'))
await p.goto(`${B}/operations`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
const personal = await main()
ok('in personal books the page says these belong to a company',
  /personal books/i.test(personal), personal.slice(0, 300))
ok('and shows no materials', !/TMT bar/.test(personal) && !/Cement OPC/.test(personal))

console.log('\n── CORRECTING WHAT IS ALREADY RECORDED ──')
// None of this could be touched once entered, and a receipt booked at the wrong
// rate is the worst of it: stock is valued at a moving average, so one bad rate
// quietly reprices every issue after it and the job costs that follow are all a
// little wrong with nothing to point at.
await p.evaluate(() => {
  const id = 'ent-mat-1'
  const now = new Date().toISOString()
  localStorage.setItem('pl_corp_items', JSON.stringify([
    { id: 'it-1', entity_id: id, name: 'Cment OPC 53', brand: '', spec: '', sku: 'CEM53',
      unit: 'bag', category: 'cement', hsn: '', reorder_level: 20, created_at: now },
    { id: 'it-2', entity_id: id, name: 'Unused sand', brand: '', spec: '', sku: '',
      unit: 'cft', category: 'aggregate', hsn: '', reorder_level: 0, created_at: now },
  ]))
  localStorage.setItem('pl_corp_movements', JSON.stringify([
    { id: 'mv-1', entity_id: id, item_id: 'it-1', kind: 'receipt', qty: 500, unit_cost: 40,
      other_cost: 0, store_id: null, to_store_id: null, project_id: null, vendor: 'Shah Traders',
      reason: '', note: '', ref: '', date: '2026-01-01', created_at: now },
    { id: 'mv-2', entity_id: id, item_id: 'it-1', kind: 'issue', qty: 300, unit_cost: 0,
      other_cost: 0, store_id: null, to_store_id: null, project_id: null, vendor: '',
      reason: '', note: '', ref: '', date: '2026-02-01', created_at: now },
  ]))
  localStorage.setItem('pl_corp_quotes', '[]')
  // The section before this one switches to personal books, which have no
  // company and therefore no materials at all.
  localStorage.setItem('pl_corp_active', id)
})
await p.goto(`${B}/operations?tab=materials`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
const onFile = async () => (await ls('pl_corp_items')).filter((r) => !r.deleted_at)
const logged = async () => (await ls('pl_corp_movements')).filter((r) => !r.deleted_at)
const panel = (name) => (label) =>
  p.locator(`#main-content [role=group][aria-label="${name}"]`).locator(`label:has-text("${label}")`).locator('input, select').first()
const saveIn = (name) => p.locator(`#main-content [role=group][aria-label="${name}"] button`, { hasText: 'Save' }).first()

await view('Inventory')
await p.waitForTimeout(500)
let now = await main()
ok('the material with the typo is on the stock table', /Cment OPC 53/.test(now), now.slice(0, 600).replace(/\n/g, ' | '))
await p.locator('#main-content button[aria-label="Edit Cment OPC 53"]').click()
await p.waitForTimeout(500)
await panel('Editing Cment OPC 53')('Material').fill('Cement OPC 53')
await panel('Editing Cment OPC 53')('Reorder level').fill('50')
await saveIn('Editing Cment OPC 53').click()
await p.waitForTimeout(800)
ok('the name is corrected', (await onFile())[0]?.name === 'Cement OPC 53',
  JSON.stringify((await onFile()).map((i) => i.name)))
ok('and the reorder level with it', (await onFile())[0]?.reorder_level === 50, String((await onFile())[0]?.reorder_level))
ok('it is still two materials, not three', (await onFile()).length === 2, String((await onFile()).length))

console.log('\n── BUT NOT THE UNIT, ONCE ANYTHING HAS MOVED ──')
// A hundred bags that become a hundred kilos are still a hundred, and every
// quantity in the history silently changes meaning. There is no conversion to
// do, because none of the numbers are wrong — only what they count.
await p.locator('#main-content button[aria-label="Edit Cement OPC 53"]').click()
await p.waitForTimeout(500)
await panel('Editing Cement OPC 53')('Unit').selectOption('kg')
await saveIn('Editing Cement OPC 53').click()
await p.waitForTimeout(800)
ok('changing the unit is refused', (await onFile())[0]?.unit === 'bag', (await onFile())[0]?.unit)
let why = await p.locator('body').innerText()
ok('and says what every quantity would come to mean',
  /change what every quantity in the history means/.test(why),
  (why.match(/[^\n]*unit[^\n]*/gi) || []).slice(0, 2).join(' | '))
// The control: a material nobody has moved can change unit freely, so the
// refusal is the rule and not a form that never saves.
await p.locator('#main-content button[aria-label="Edit Unused sand"]').click()
await p.waitForTimeout(500)
await panel('Editing Unused sand')('Unit').selectOption('kg')
await saveIn('Editing Unused sand').click()
await p.waitForTimeout(800)
ok('a material nobody has moved can change unit', (await onFile()).find((i) => i.id === 'it-2')?.unit === 'kg',
  (await onFile()).find((i) => i.id === 'it-2')?.unit)

console.log('\n── AND DELETING IS ONLY OFFERED WHERE IT IS SAFE ──')
await p.locator('#main-content button[aria-label="Edit Unused sand"]').click()
await p.waitForTimeout(400)
await p.locator('#main-content button[aria-label="Delete Unused sand"]').click()
await p.waitForTimeout(800)
ok('an unused material can be deleted', (await onFile()).length === 1, String((await onFile()).length))
await p.locator('#main-content button[aria-label="Edit Cement OPC 53"]').click()
await p.waitForTimeout(400)
await p.locator('#main-content button[aria-label="Delete Cement OPC 53"]').click()
await p.waitForTimeout(800)
ok('one with movements against it is not', (await onFile()).length === 1, String((await onFile()).length))
why = await p.locator('body').innerText()
ok('and says to delete those first', /Delete those first/.test(why), '')

console.log('\n── THE RATE THAT REPRICES EVERYTHING AFTER IT ──')
await view('Usage')
await p.waitForTimeout(600)
now = await main()
ok('the movement log lists the receipt', /Received/i.test(now), now.slice(0, 900).replace(/\n/g, ' | '))
const wasRate = (await logged()).find((m) => m.id === 'mv-1')?.unit_cost
ok('booked at the wrong rate', wasRate === 40, String(wasRate))
await p.locator('#main-content button[aria-label^="Edit received of 500"]').first().click()
await p.waitForTimeout(500)
const mvPanel = 'Editing received of Cement OPC 53'
await panel(mvPanel)('Rate per unit').fill('400')
await saveIn(mvPanel).click()
await p.waitForTimeout(900)
ok('the rate is corrected', (await logged()).find((m) => m.id === 'mv-1')?.unit_cost === 400,
  String((await logged()).find((m) => m.id === 'mv-1')?.unit_cost))
ok('and it is still two movements', (await logged()).length === 2, String((await logged()).length))
// Which is the point: the valuation follows.
await view('Inventory')
await p.waitForTimeout(600)
now = await main()
ok('the stock is revalued at the corrected rate', /₹80,000/.test(now), now.slice(0, 1200).replace(/\n/g, ' | '))

console.log('\n── AND A MOVEMENT CAN BE DELETED, WITH WARNING ──')
await view('Usage')
await p.waitForTimeout(600)
await p.locator('#main-content button[aria-label^="Edit issued to work of 300"]').first().click()
await p.waitForTimeout(500)
await p.locator('#main-content button[aria-label^="Delete issued to work of 300"]').first().click()
await p.waitForTimeout(900)
ok('the issue is gone', (await logged()).length === 1, String((await logged()).length))
await view('Inventory')
await p.waitForTimeout(600)
now = await main()
ok('and all five hundred bags are back on hand', /500 bag/.test(now), now.slice(0, 1200).replace(/\n/g, ' | '))

console.log('\n── NOTHING BROKE ──')
ok('no page errors anywhere in the run', errs.length === 0, errs.slice(0, 3).join(' / '))

console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
if (fail) process.exitCode = 1
