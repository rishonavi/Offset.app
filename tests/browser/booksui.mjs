// One login, two sets of books.
//
// Personal and company entries are separate: what you add in one does not show
// in the other, and nothing written before companies existed moves anywhere.
// The rows carry the company they belong to; a row with none belongs to you,
// which is why the migration is no migration at all.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
const p = await ctx.newPage()
p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 160)) })
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('ERR_FAILED') && !t.includes('404')) errs.push('CONSOLE ' + t.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
p.on('dialog', (d) => d.accept())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${e ? '  — ' + e : ''}`) }
const main = () => p.locator('#main-content').innerText()
const rows = (k) => p.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), k)
const chosen = () => p.locator('aside [role="tab"][aria-selected="true"]').innerText()
const pick = async (name) => {
  await p.locator('aside [role="tab"]', { hasText: new RegExp(name, 'i') }).click()
  await p.waitForTimeout(700)
}
const addAsset = async (name) => {
  await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(500)
  await p.locator('#main-content input').first().fill(name)
  await p.locator('form button[type="submit"]').first().click()
  await p.waitForTimeout(1000)
}

// ── 1. One asset, written before any company exists ──
console.log('\n── WHAT YOU HAD BEFORE STAYS YOURS ──')
await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(() => {
  localStorage.clear()
  // No entity_id — the shape of every row written before companies existed.
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'p1', name: 'Sea View Villa', type: 'Real Estate — Villa / House', value: 4200000, created_at: new Date().toISOString() }]))
  localStorage.setItem('pl_expenses', JSON.stringify([
    { id: 'e1', property_id: 'p1', category: 'Utilities', vendor: 'Adani', amount: 4200, date: '2026-05-02', status: 'paid' }]))
  localStorage.setItem('pl_income', '[]'); localStorage.setItem('pl_documents', '[]')
})
await p.goto(`${B}/properties`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
ok('a personal install sees its asset', /Sea View Villa/.test(await main()))

// ── 2. A company arrives ──
await p.evaluate(() => {
  const now = new Date().toISOString()
  localStorage.setItem('pl_corp_entities', JSON.stringify([
    { id: 'ent-1', name: 'Acme Industries Pvt Ltd', gstin: '', currency: 'INR', fyStartMonth: 4, created_at: now }]))
  localStorage.setItem('pl_corp_members', JSON.stringify([
    { id: 'm1', entity_id: 'ent-1', user_id: 'local-user', email: '', role: 'owner', department_id: null, created_at: now }]))
  localStorage.setItem('pl_corp_active', 'ent-1')
})
await p.goto(`${B}/properties`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
ok('and the company starts with none of it', !/Sea View Villa/.test(await main()), (await main()).slice(0, 200))
ok('which is the point — the books are separate', /COMPANY/i.test(await chosen()))
await pick('personal')
await p.goto(`${B}/properties`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
ok('and it is still there in your own books', /Sea View Villa/.test(await main()))

// ── 3. Adding on each side ──
console.log('\n── WHAT YOU ADD LANDS WHERE YOU ADDED IT ──')
await addAsset('Personal Flat')
let stored = await rows('pl_properties')
ok('an asset added in personal books is saved', stored.some((r) => r.name === 'Personal Flat'))
ok('with no company on it', !stored.find((r) => r.name === 'Personal Flat')?.entity_id,
  JSON.stringify(stored.find((r) => r.name === 'Personal Flat')?.entity_id))

await p.goto(B, { waitUntil: 'networkidle' })
await pick('company')
await addAsset('Factory Unit')
stored = await rows('pl_properties')
ok('an asset added in a company is saved', stored.some((r) => r.name === 'Factory Unit'))
ok('stamped with that company', stored.find((r) => r.name === 'Factory Unit')?.entity_id === 'ent-1',
  JSON.stringify(stored.find((r) => r.name === 'Factory Unit')?.entity_id))

await p.goto(`${B}/properties`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
let text = await main()
ok('the company sees only its own', /Factory Unit/.test(text) && !/Personal Flat/.test(text) && !/Sea View Villa/.test(text),
  text.slice(0, 240))
await pick('personal')
await p.goto(`${B}/properties`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
text = await main()
ok('and personal sees only its own', /Personal Flat/.test(text) && /Sea View Villa/.test(text) && !/Factory Unit/.test(text),
  text.slice(0, 240))

// ── 4. Entries follow, not just assets ──
console.log('\n── AND THE ENTRIES TOO ──')
ok('the personal expense is in personal books', /Adani/.test(await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' }).then(() => p.waitForTimeout(600)).then(main)))
await p.goto(B, { waitUntil: 'networkidle' })
await pick('company')
await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
ok('and not in the company', !/Adani/.test(await main()), (await main()).slice(0, 200))
// The dashboard and the sidebar counts read the same rows, so they follow too.
await p.goto(B, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
ok('the dashboard shows the company, not your flat', !/Sea View Villa/.test(await main()), (await main()).slice(0, 300))

// ── 5. Bills ──
// Bills are unpaid entries and overdue income, read from the same rows as
// everything else, so they follow without knowing anything about books. Worth
// asserting rather than assuming: it is the claim the page makes.
console.log('\n── BILLS FOLLOW THE BOOKS ──')
await p.goto(B, { waitUntil: 'networkidle' })
await pick('personal')
await p.evaluate(() => {
  const rows = JSON.parse(localStorage.getItem('pl_expenses'))
  rows.push({ id: 'b-own', property_id: 'p1', category: 'Materials', vendor: 'Personal Supplier',
    amount: 8000, date: '2026-05-10', status: 'unpaid', due_date: '2026-05-20' })
  const co = JSON.parse(localStorage.getItem('pl_properties')).find((r) => r.name === 'Factory Unit')
  rows.push({ id: 'b-co', property_id: co.id, entity_id: 'ent-1', category: 'Materials', vendor: 'Company Supplier',
    amount: 9000, date: '2026-05-10', status: 'unpaid', due_date: '2026-05-20' })
  localStorage.setItem('pl_expenses', JSON.stringify(rows))
})
await p.goto(`${B}/bills`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
// Bills groups attached receipts by asset, so the asset filter is what says
// whose books you are in.
let bills = await main()
ok('personal books offer only personal assets', /Sea View Villa/.test(bills) && !/Factory Unit/.test(bills),
  bills.replace(/\n+/g, ' | ').slice(0, 260))
await p.goto(B, { waitUntil: 'networkidle' })
await pick('company')
await p.goto(`${B}/bills`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
bills = await main()
ok('and the company only its own', /Factory Unit/.test(bills) && !/Sea View Villa/.test(bills),
  bills.replace(/\n+/g, ' | ').slice(0, 260))

// ── 6. Invoices ──
// An invoice says who it is from. A company's goes out under the company's
// GSTIN, and the numbering is a series per issuer — one counter shared across
// two sets of books puts gaps in both.
console.log('\n── AND SO DOES WHO AN INVOICE IS FROM ──')
await p.goto(`${B}/invoices`, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
const issuerName = () => p.getByLabel('Name / business').first()
const gstinBox = () => p.locator('input[placeholder="27AAAPA1234A1Z5"]').first()
ok('a company pre-fills its own name', (await issuerName().inputValue()).includes('Acme'),
  await issuerName().inputValue())
await gstinBox().fill('27AAAPA1234A1Z5')
await p.waitForTimeout(700)
ok('the company issuer is stored under its own key',
  Boolean(await p.evaluate(() => localStorage.getItem('pl_invoice_issuer:ent-1'))))

await p.goto(B, { waitUntil: 'networkidle' })
await pick('personal')
await p.goto(`${B}/invoices`, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
ok('your own books do not inherit the company GSTIN', (await gstinBox().inputValue()) === '',
  await gstinBox().inputValue())
await issuerName().fill('Krish Shah')
await p.waitForTimeout(700)
const personalIssuer = await p.evaluate(() => localStorage.getItem('pl_invoice_issuer'))
ok('and are stored under the unsuffixed key, where they always were',
  /Krish Shah/.test(personalIssuer || ''), String(personalIssuer).slice(0, 90))

// The numbering series is per issuer too.
await p.evaluate(() => { localStorage.setItem('pl_invoice_seq', '7'); localStorage.setItem('pl_invoice_seq:ent-1', '42') })
await p.goto(`${B}/invoices`, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
let shown = await main()
ok('personal invoices number from their own series', /0007/.test(shown), shown.slice(0, 300))
await p.goto(B, { waitUntil: 'networkidle' })
await pick('company')
await p.goto(`${B}/invoices`, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
shown = await main()
ok('and the company from its own', /0042/.test(shown) && !/0007/.test(shown), shown.slice(0, 300))

// ── 7. The bin ──
// It reads the store directly rather than through DataProvider, so it does its
// own scoping — and did not, which put a company's deleted entries, vendors
// and amounts and all, in your personal bin.
console.log('\n── AND THE BIN ──')
await p.goto(B, { waitUntil: 'networkidle' })
await pick('personal')
await p.evaluate(() => {
  const rows = JSON.parse(localStorage.getItem('pl_expenses'))
  const gone = new Date().toISOString()
  rows.push({ id: 'd-own', property_id: 'p1', category: 'Other', vendor: 'Binned Personally',
    amount: 100, date: '2026-05-01', status: 'paid', deleted_at: gone })
  rows.push({ id: 'd-co', property_id: 'p1', entity_id: 'ent-1', category: 'Other', vendor: 'Binned By Acme',
    amount: 200, date: '2026-05-01', status: 'paid', deleted_at: gone })
  localStorage.setItem('pl_expenses', JSON.stringify(rows))
})
await p.goto(`${B}/bin`, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
// The bin lists category, asset and amount rather than the vendor, so the
// amount is what tells the two rows apart.
let bin = await main()
ok('your bin holds only what you deleted', /₹100/.test(bin) && !/₹200/.test(bin),
  bin.replace(/\n+/g, ' | ').slice(0, 260))
await p.goto(B, { waitUntil: 'networkidle' })
await pick('company')
await p.goto(`${B}/bin`, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
bin = await main()
ok('and the company only what it deleted', /₹200/.test(bin) && !/₹100/.test(bin),
  bin.replace(/\n+/g, ' | ').slice(0, 260))

// ── 8. Drafts and remembered searches ──
// Small things, and the more confusing kind of leak: a half-typed company
// expense restoring itself into a personal form arrives unannounced in a form
// you had just opened.
console.log('\n── HALF-TYPED ENTRIES AND WHAT YOU SEARCHED ──')
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
await p.locator('input[placeholder="e.g. Asian Paints"]').fill('Company Vendor Draft')
await p.waitForTimeout(900)
const draftKeys = await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('pl_draft_')))
ok('a company draft is kept under its own key', draftKeys.some((k) => k.includes('@ent-1')), JSON.stringify(draftKeys))
await p.goto(B, { waitUntil: 'networkidle' })
await pick('personal')
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
ok('and does not restore into a personal form',
  (await p.locator('input[placeholder="e.g. Asian Paints"]').inputValue()) !== 'Company Vendor Draft',
  await p.locator('input[placeholder="e.g. Asian Paints"]').inputValue())

await p.evaluate(() => {
  const now = Date.now()
  localStorage.setItem('pl_search_history', JSON.stringify([{ q: 'personal search', at: now }]))
  localStorage.setItem('pl_search_history:ent-1', JSON.stringify([{ q: 'acme search', at: now }]))
})
const palette = async () => {
  await p.locator('body').click({ position: { x: 5, y: 5 } })
  await p.keyboard.press('Control+k')
  await p.locator('[role="dialog"] input').first().waitFor({ state: 'visible' })
  await p.waitForTimeout(400)
  const t = await p.locator('[role="dialog"]').innerText()
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
  return t
}
await p.goto(B, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
let pal = await palette()
ok('your own recent searches are yours', /personal search/.test(pal) && !/acme search/.test(pal), pal.slice(0, 200))
await pick('company')
await p.waitForTimeout(500)
pal = await palette()
ok('and the company\'s are its own', /acme search/.test(pal) && !/personal search/.test(pal), pal.slice(0, 200))

console.log('\n── AND FROM A PHONE, WHERE IT LIVES INSIDE THE DRAWER ──')
// Reported as "it does not switch". It switched: storage changed and the tab
// moved. What did not happen is the drawer closing, so the whole thing
// happened behind a panel still covering the page and nothing appeared to.
// Every nav link in that drawer already closed it; the books switcher was the
// one control that did not.
{
  const phone = await b.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: 'block' })
  const m = await phone.newPage(); m.setDefaultTimeout(30000)
  await m.route('**/fonts.g**/**', (r) => r.abort())
  await m.goto(B, { waitUntil: 'domcontentloaded' })
  await m.evaluate(() => {
    localStorage.clear()
    const now = new Date().toISOString()
    for (const k of ['pl_expenses', 'pl_income', 'pl_documents', 'pl_properties']) localStorage.setItem(k, '[]')
    const mk = (id, name) => ({ id, name, registration: '', gstin: '', currency: 'INR', fy_start_month: 4, created_at: now })
    localStorage.setItem('pl_corp_entities', JSON.stringify([mk('e1', 'Acme Industries'), mk('e2', 'Acme Logistics')]))
    localStorage.setItem('pl_corp_members', JSON.stringify(['e1', 'e2'].map((e, i) => ({
      id: 'm' + i, entity_id: e, user_id: 'local-user', email: '', role: 'owner', department_id: null, created_at: now }))))
    localStorage.setItem('pl_corp_active', 'e1')
  })
  await m.goto(B, { waitUntil: 'networkidle' })
  await m.waitForTimeout(900)
  // The desktop sidebar is still in the DOM at this width, just hidden — so
  // everything here asks for the *visible* control, or it drives a copy of the
  // switcher no thumb can reach.
  ok('the switcher is not on screen until the drawer is open',
    (await m.locator('[role="tab"]:visible').count()) === 0)
  await m.locator('header button').last().click()
  await m.waitForTimeout(500)
  const personalTab = m.locator('[role="tab"]:visible', { hasText: /personal/i }).first()
  ok('and is there once it is', (await personalTab.count()) === 1)

  const box = await personalTab.boundingBox()
  ok('the tab is big enough for a finger', box && box.height >= 44, box ? `${Math.round(box.height)}px` : 'not visible')

  await personalTab.click()
  await m.waitForTimeout(700)
  ok('tapping it switches the books', (await m.evaluate(() => localStorage.getItem('pl_corp_active'))) === '__personal__',
    String(await m.evaluate(() => localStorage.getItem('pl_corp_active'))))
  ok('and closes the drawer, so you can see that it did',
    (await m.locator('[role="tab"]:visible').count()) === 0,
    String(await m.locator('[role="tab"]:visible').count()))

  // The control: the drawer really was open a moment ago, so "closed" is the
  // switch doing it rather than the drawer never having opened.
  await m.locator('header button').last().click()
  await m.waitForTimeout(500)
  ok('the drawer still opens afterwards', (await m.locator('[role="tab"]:visible').count()) === 2,
    String(await m.locator('[role="tab"]:visible').count()))
  // And the company dropdown closes it too — same control, same expectation.
  await m.locator('[role="tab"]:visible', { hasText: /company/i }).first().click()
  await m.waitForTimeout(600)
  await m.locator('header button').last().click()
  await m.waitForTimeout(500)
  const picker = m.locator('select[aria-label]:visible').last()
  if (await picker.count()) {
    await picker.selectOption('e2')
    await m.waitForTimeout(600)
    ok('choosing another company closes it as well',
      (await m.locator('[role="tab"]:visible').count()) === 0,
      String(await m.locator('[role="tab"]:visible').count()))
  }
  await phone.close()
}

console.log(`\n${pass} passed, ${fail} failed`)
console.log('errors:', errs.length ? errs.slice(0, 4) : 'none')
await b.close()
if (fail) process.exitCode = 1
