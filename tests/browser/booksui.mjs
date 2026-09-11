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

console.log(`\n${pass} passed, ${fail} failed`)
console.log('errors:', errs.length ? errs.slice(0, 4) : 'none')
await b.close()
if (fail) process.exitCode = 1
