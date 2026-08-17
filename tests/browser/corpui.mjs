// The corporate layer in the browser: dormant until a company exists, then
// entities, roles, departments, approvals and the audit trail.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
const p = await ctx.newPage()
p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 130)) })
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('ERR_FAILED') && !t.includes('404')) errs.push('CONSOLE ' + t.slice(0, 130)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
p.on('dialog', (d) => d.accept())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${e ? '  — ' + e : ''}`) }
const ls = (k) => p.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), k)

const seedPersonal = () => p.evaluate(() => {
  localStorage.clear()
  localStorage.setItem('pl_properties', JSON.stringify([{ id: 'p1', name: 'Sea View Villa', type: 'Real Estate — Villa / House', value: 4200000 }]))
  localStorage.setItem('pl_expenses', JSON.stringify([{ id: 'e1', property_id: 'p1', category: 'Utilities', vendor: 'Adani', amount: 4200, date: '2026-05-02', status: 'paid' }]))
  localStorage.setItem('pl_income', '[]'); localStorage.setItem('pl_documents', '[]')
})

// ── 1. Dormant on a personal install ──
console.log('\n── A PERSONAL INSTALL SEES NONE OF IT ──')
await p.goto(B, { waitUntil: 'domcontentloaded' })
await seedPersonal()
await p.goto(B, { waitUntil: 'networkidle' })
const nav = await p.locator('aside nav').innerText()
ok('the sidebar has no Companies entry', !/COMPANIES/i.test(nav), nav.replace(/\n/g, ' | '))
ok('and no company switcher', (await p.locator('select[aria-label="Switch company"]').count()) === 0)
ok('nothing corporate is written to storage',
  (await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('pl_corp')).length)) === 0)
await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' })
ok('the ledger still shows the personal entry', /Adani/.test(await p.locator('#main-content').innerText()))

// ── 2. Creating the first company ──
console.log('\n── THE FIRST COMPANY ──')
await p.goto(`${B}/companies`, { waitUntil: 'networkidle' })
await p.waitForTimeout(400)
ok('the page invites you to add one', /No companies yet/.test(await p.locator('#main-content').innerText()))
await p.locator('button', { hasText: 'Add a company' }).first().click()
await p.waitForTimeout(300)
await p.locator('input').first().fill('Acme Industries Pvt Ltd')
await p.locator('#main-content input').nth(1).fill('27AAAPA1234A1Z5')
await p.locator('button', { hasText: 'Create company' }).click()
await p.waitForTimeout(800)
const entities = await ls('pl_corp_entities')
ok('the company is created', entities.length === 1, `${entities.length}`)
ok('with the GSTIN normalised', entities[0]?.gstin === '27AAAPA1234A1Z5', entities[0]?.gstin)
const members = await ls('pl_corp_members')
ok('the creator is its owner', members[0]?.role === 'owner', members[0]?.role)
ok('creating it is audited', (await ls('pl_corp_audit')).some((a) => a.action === 'entity.create'))

// The nav and switcher appear only now.
await p.goto(B, { waitUntil: 'networkidle' })
await p.waitForTimeout(400)
ok('Companies now appears in the sidebar', /COMPANIES/i.test(await p.locator('aside nav').innerText()))
ok('and the switcher appears', await p.locator('select[aria-label="Switch company"]').isVisible())
ok('the personal books are untouched', (await ls('pl_expenses')).length === 1)

// ── 3. Departments ──
console.log('\n── DEPARTMENTS ──')
await p.goto(`${B}/companies`, { waitUntil: 'networkidle' })
await p.waitForTimeout(400)
await p.locator('input[aria-label="Department name"]').fill('Operations')
await p.locator('input[aria-label="Department code"]').fill('ops')
await p.locator('button', { hasText: 'Add department' }).click()
await p.waitForTimeout(600)
let depts = await ls('pl_corp_departments')
ok('a department is created', depts.length === 1)
ok('its code is upper-cased', depts[0]?.code === 'OPS', depts[0]?.code)
// Nest one inside it.
await p.locator('input[aria-label="Department name"]').fill('Mumbai')
await p.locator('select[aria-label="Sits inside"]').selectOption({ label: 'Operations' })
await p.locator('button', { hasText: 'Add department' }).click()
await p.waitForTimeout(600)
depts = await ls('pl_corp_departments')
ok('a nested department is created', depts.length === 2)
ok('and records its parent', depts[1]?.parent_id === depts[0]?.id)
ok('the path is shown top-down', /Operations › Mumbai/.test(await p.locator('#main-content').innerText()))

// The parent cannot be deleted while it has children.
await p.locator('button[aria-label="Remove Operations"]').click()
await p.waitForTimeout(600)
ok('a department with children is not deleted', (await ls('pl_corp_departments')).length === 2)
ok('and the refusal is explained',
  (await p.locator('[role="status"]').allInnerTexts()).some((t) => /inside this one/.test(t)),
  (await p.locator('[role="status"]').allInnerTexts()).join(' / '))

// ── 4. Members and roles ──
console.log('\n── PEOPLE ──')
await p.locator('input[aria-label="Email to add"]').fill('finance@acme.com')
await p.locator('select[aria-label="Role for the new member"]').selectOption('finance')
await p.locator('button', { hasText: /^Add$/ }).click()
await p.waitForTimeout(600)
const mem2 = await ls('pl_corp_members')
ok('a member is added', mem2.length === 2, `${mem2.length}`)
ok('with the role chosen', mem2.find((m) => m.email === 'finance@acme.com')?.role === 'finance')
// The last owner is protected.
const ownerRow = mem2.find((m) => m.role === 'owner')
await p.locator(`button[aria-label^="Remove "]`).first().click()
await p.waitForTimeout(600)
ok('the last owner cannot be removed', (await ls('pl_corp_members')).some((m) => m.id === ownerRow.id))
ok('and the reason is shown',
  (await p.locator('[role="status"]').allInnerTexts()).some((t) => /at least one owner/.test(t)),
  (await p.locator('[role="status"]').allInnerTexts()).join(' / '))

// ── 5. Approvals ──
console.log('\n── APPROVALS ──')
await p.locator('input[type="checkbox"]').first().check()
await p.waitForTimeout(500)
const policy = await p.evaluate(() => JSON.parse(localStorage.getItem('pl_corp_policy') || '{}'))
ok('the approval policy is stored', Object.values(policy)[0]?.enabled === true, JSON.stringify(policy))
ok('turning it on is audited', (await ls('pl_corp_audit')).some((a) => a.action === 'policy.update'))

// ── 6. Audit log on screen ──
console.log('\n── AUDIT LOG ──')
const pageText = await p.locator('#main-content').innerText()
ok('the audit log is shown', /Audit log/.test(pageText))
ok('and names what happened', /created a company|added a member|added a department/.test(pageText), pageText.slice(-300).replace(/\n/g, ' | '))

// ── 7. A second company and the consolidated view ──
console.log('\n── A SECOND COMPANY ──')
await p.locator('button', { hasText: 'Add a company' }).first().click()
await p.waitForTimeout(300)
await p.locator('#main-content input').first().fill('Acme Logistics')
await p.locator('button', { hasText: 'Create company' }).click()
await p.waitForTimeout(800)
ok('a second company is created', (await ls('pl_corp_entities')).length === 2)
const switcher = p.locator('select[aria-label="Switch company"]')
const opts = await switcher.locator('option').allInnerTexts()
ok('both appear in the switcher', opts.some((o) => /Acme Industries/.test(o)) && opts.some((o) => /Acme Logistics/.test(o)), opts.join(' / '))
ok('and a consolidated option appears', opts.some((o) => /All companies/i.test(o)), opts.join(' / '))

await switcher.selectOption('__all__')
await p.waitForTimeout(700)
const consolidated = await p.locator('#main-content').innerText()
ok('the consolidated view says it is all companies', /all companies together/i.test(consolidated), consolidated.slice(0, 120).replace(/\n/g, ' '))
ok('and refuses per-company management there', /set per company/i.test(consolidated))
ok('departments are not editable in it', (await p.locator('input[aria-label="Department name"]').count()) === 0)

// Switching back restores management.
await switcher.selectOption({ index: 0 })
await p.waitForTimeout(700)
ok('switching back to a company restores its tools', (await p.locator('input[aria-label="Department name"]').count()) === 1)
ok('the choice is remembered', Boolean(await p.evaluate(() => localStorage.getItem('pl_corp_active'))))

// ── 8. It survives a reload, and the personal side is intact ──
console.log('\n── AFTER A RELOAD ──')
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(600)
ok('the company is still active', /Acme/.test(await p.locator('#main-content').innerText()))
await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' })
ok('personal entries still show', /Adani/.test(await p.locator('#main-content').innerText()))
await p.goto(B, { waitUntil: 'networkidle' })
ok('the dashboard still works', (await p.locator('#main-content').innerText()).length > 100)

// ── 9. Layout ──
console.log('\n── LAYOUT ──')
await p.setViewportSize({ width: 390, height: 800 })
await p.goto(`${B}/companies`, { waitUntil: 'networkidle' })
await p.waitForTimeout(400)
const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
ok('no sideways scroll on a phone', overflow <= 2, `${overflow}px`)
const unlabelled = await p.evaluate(() =>
  [...document.querySelectorAll('#main-content input,#main-content select,#main-content textarea')]
    .filter((el) => el.type !== 'hidden' && el.offsetParent !== null)
    .filter((el) => !(el.getAttribute('aria-label') || el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`))))
    .map((el) => el.outerHTML.slice(0, 60)))
ok('every control is labelled', unlabelled.length === 0, unlabelled.join(' | '))
const h1s = await p.locator('#main-content h1').count()
ok('the page has exactly one h1', h1s === 1, `${h1s}`)

console.log(`\n${pass} passed, ${fail} failed`)
console.log('errors:', errs.length ? errs.slice(0, 4) : 'none')
await b.close()
