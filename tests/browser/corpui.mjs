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

// The books switcher, used from several sections below.
const tabs = p.locator('aside [role="tablist"]')
const chosen = () => p.locator('aside [role="tab"][aria-selected="true"]').innerText()
const pick = (name) => p.locator('aside [role="tab"]', { hasText: new RegExp(name, 'i') }).click()

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
ok('and no books tabs', (await p.locator('aside [role="tablist"]').count()) === 0)
ok('nothing corporate is written to storage',
  (await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('pl_corp')).length)) === 0)
await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' })
ok('the ledger still shows the personal entry', /Adani/.test(await p.locator('#main-content').innerText()))

// ── 1b. There has to be a way in ──
// The layer being dormant is right; being unreachable is not. Before this there
// was no nav entry, no link on any page and no palette match, so the only route
// to the page that turns the corporate side on was typing its URL.
console.log('\n── AND YET THERE IS A WAY IN ──')
await p.goto(`${B}/settings`, { waitUntil: 'networkidle' })
await p.waitForTimeout(500)
const settings = await p.locator('#main-content').innerText()
// Directly under the account card, because it is about the account: which sets
// of books this login has. Personal is stated as a fact — it already exists and
// there is nothing to create — and the company side is the one to ask for.
ok('Settings lays out the two sets of books', /Your books/.test(settings), settings.slice(0, 240))
ok('and says the personal side is already there', /nothing to set up/.test(settings))
ok('and offers to create a company', (await p.locator('#main-content a[href="/companies"]').count()) === 1)
const order = settings.split('\n').map((l) => l.trim()).filter((l) => ['Account', 'Your books', 'Appearance'].includes(l))
ok('sitting between the account and the appearance',
  JSON.stringify(order) === JSON.stringify(['Account', 'Your books', 'Appearance']), JSON.stringify(order))
await p.locator('body').click({ position: { x: 5, y: 5 } })
await p.keyboard.press('Control+k')
await p.locator('[role="dialog"] input').first().waitFor({ state: 'visible' })
for (const q of ['company', 'business', 'entity']) {
  await p.locator('[role="dialog"] input').first().fill(q)
  await p.waitForTimeout(350)
  ok(`the palette finds it from "${q}"`, /Companies/.test(await p.locator('[role="dialog"]').innerText()))
}
// Operations stays hidden: it would lead to a screen that only says you have
// no company, which is a worse answer than no result.
await p.locator('[role="dialog"] input').first().fill('payroll')
await p.waitForTimeout(350)
ok('but Operations still waits for one', !/Operations/.test(await p.locator('[role="dialog"]').innerText()))
await p.keyboard.press('Escape')
await p.waitForTimeout(300)
// And the account card carries no books switch yet: with no company there is
// nothing to switch between, and the card above already offers to make one.
ok('the account card has no books switch yet',
  (await p.locator('#main-content h2', { hasText: /^Account$/ }).locator('xpath=..').locator('[role="tablist"]').count()) === 0)

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
// One company needs no dropdown to choose between — the tabs say which set of
// books, and the company's name sits under them.
ok('and the books tabs appear', await p.locator('aside [role="tablist"]').isVisible())
ok('with the company selected', /COMPANY/i.test(await p.locator('aside [role="tab"][aria-selected="true"]').innerText()))
ok('and named underneath', /Acme Industries/.test(await p.locator('aside').innerText()))
ok('but no dropdown, with only one to choose from',
  (await p.locator('select[aria-label="Switch company"]').count()) === 0)
ok('the personal books are untouched', (await ls('pl_expenses')).length === 1)
// Once you are through it, the door stops being a door: the nav entry and the
// books tabs are how you get back, and a third copy in Settings would be noise.
await p.goto(`${B}/settings`, { waitUntil: 'networkidle' })
await p.waitForTimeout(500)
// After that the books tabs on the account card are how you move between them,
// and this would be a second copy of a control that already exists.
ok('and Settings stops offering, now that there is one',
  !/Your books/.test(await p.locator('#main-content').innerText()))

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
// The books are separate now, so a personal entry is not in a company's
// ledger — that is the feature. What has to survive is that it is still there,
// untouched, in the books it belongs to.
await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' })
await p.waitForTimeout(500)
ok('a personal entry is not in the company ledger', !/Adani/.test(await p.locator('#main-content').innerText()))
ok('but the row itself is untouched', (await ls('pl_expenses')).some((e) => e.vendor === 'Adani'))
await pick('personal')
await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' })
await p.waitForTimeout(500)
ok('and it still shows in your own books', /Adani/.test(await p.locator('#main-content').innerText()))
await pick('company')
await p.goto(B, { waitUntil: 'networkidle' })
ok('the dashboard still works', (await p.locator('#main-content').innerText()).length > 100)

// ── 9. Personal books and company books, as two tabs ──
// The choice that changes what the app is for was previously one option inside
// a dropdown you had to open to read. The dangerous part of putting it on the
// surface is what "personal" does to permissions: `can` is about a company and
// must answer no, while `canWrite` is about the ledger in front of you and must
// keep answering yes, or looking at your own books turns the app read-only.
console.log('\n── PERSONAL BOOKS ──')
await p.setViewportSize({ width: 1440, height: 1000 })

await p.goto(`${B}/operations`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
ok('the tabs offer both sets of books', /PERSONAL/.test(await tabs.innerText()) && /COMPANY/.test(await tabs.innerText()))
ok('a company is what you are in', /COMPANY/i.test(await chosen()))
await pick('personal')
await p.waitForTimeout(700)
ok('switching lands on personal', /PERSONAL/i.test(await chosen()))
ok('and the company dropdown goes with it',
  (await p.locator('select[aria-label="Switch company"]').count()) === 0)
ok('Operations says which books you are in', /You are in your personal books/.test(await p.locator('#main-content').innerText()))

// The one that would be a disaster to get wrong.
await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' })
await p.waitForTimeout(500)
ok('the personal ledger still shows', /Adani/.test(await p.locator('#main-content').innerText()))
ok('and is still writable', (await p.locator('a[href="/expenses/new"]').count()) > 0)
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
ok('a new entry can still be started', (await p.locator('#main-content input,#main-content select').count()) > 3,
  (await p.locator('#main-content').innerText()).slice(0, 120))

// Companies is still reachable — otherwise the tab would be a trap.
await p.goto(`${B}/companies`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
let co = await p.locator('#main-content').innerText()
ok('Companies still lists them', /Acme Industries/.test(co))
ok('and still offers to add one', /Add a company/i.test(co))
ok('but the per-company sections wait for a company', /Pick one above to manage them/.test(co), co.slice(0, 300))

// And back again, to the company you were last in.
await pick('company')
await p.waitForTimeout(700)
ok('coming back lands on a company', !/PERSONAL/i.test(await chosen()))
await p.goto(`${B}/operations`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
ok('and Operations works again', /Add a site/.test(await p.locator('#main-content').innerText()))
ok('the dropdown is back, with two companies to choose from',
  await p.locator('select[aria-label="Switch company"]').isVisible())

await pick('personal')
await p.waitForTimeout(500)
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(700)
ok('the choice survives a reload', /PERSONAL/i.test(await chosen()))
ok('and nothing corporate is written for it', (await ls('pl_corp_entities')).length === 2)
await pick('company')
await p.waitForTimeout(600)

// ── 9b. Adding a company while in your personal books ──
// The nav entry is there in both sets of books, because you manage companies
// from a page rather than from inside one.
console.log('\n── ADDING ONE FROM PERSONAL BOOKS ──')
await pick('personal')
await p.waitForTimeout(600)
ok('Companies is still in the nav from personal books', /COMPANIES/i.test(await p.locator('aside nav').innerText()))
await p.goto(`${B}/companies`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
ok('and the page still offers to add one', (await p.locator('#main-content button', { hasText: 'Add a company' }).count()) > 0,
  (await p.locator('#main-content').innerText()).slice(0, 200))
const before = (await ls('pl_corp_entities')).length
await p.locator('button', { hasText: 'Add a company' }).first().click()
await p.waitForTimeout(400)
await p.locator('#main-content input').first().fill('Third Co Pvt Ltd')
await p.locator('button', { hasText: 'Create company' }).click()
await p.waitForTimeout(900)
ok('it is created', (await ls('pl_corp_entities')).length === before + 1)
// The bug this is here for: createCompany wrote the active company straight to
// storage without telling React, so the tab still read PERSONAL while storage
// had already moved — and the next reload jumped you into a company you had
// not asked to be in.
ok('and you are put into the company you just made',
  !/PERSONAL/i.test(await chosen()), await chosen())
// Read without assuming the switcher is on screen: in personal books it is
// not, and a locator that times out gives a crashed run rather than a failed
// assertion — which is the one thing a regression must not do.
const stored = await p.evaluate(() => localStorage.getItem('pl_corp_active'))
const shown = await p.evaluate(() => {
  const sel = document.querySelector('select[aria-label="Switch company"]')
  return sel ? sel.value : '(no switcher — personal books)'
})
ok('with the screen and the stored choice agreeing', stored === shown, `stored ${stored}, shown ${shown}`)
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(700)
ok('and a reload does not move you somewhere else', (await p.evaluate(() => localStorage.getItem('pl_corp_active'))) === stored)

// ── 9c. The same control on Settings ──
// Which books you are in is a fact about the account, so it is on the account
// card too — the same component, so the two cannot drift apart.
console.log('\n── AND ON THE ACCOUNT CARD ──')
await p.goto(`${B}/settings`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
const account = p.locator('#main-content h2', { hasText: /^Account$/ }).locator('xpath=..')
ok('the account card carries the books switch', (await account.locator('[role="tablist"]').count()) === 1,
  (await account.innerText()).replace(/\n+/g, ' | ').slice(0, 200))
ok('and says what it decides', /Your own, or a company/.test(await account.innerText()))
// Switching here has to move the whole app, not just this card.
await account.getByRole('tab', { name: /personal/i }).click()
await p.waitForTimeout(700)
ok('switching on Settings moves the side bar too',
  /PERSONAL/i.test(await chosen()), await chosen())
ok('and it is the same choice, not a second one',
  (await p.evaluate(() => localStorage.getItem('pl_corp_active'))) === '__personal__')
await p.goto(`${B}/operations`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
ok('so Operations follows it', /You are in your personal books/.test(await p.locator('#main-content').innerText()))
await p.goto(`${B}/settings`, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
await account.getByRole('tab', { name: /company/i }).click()
await p.waitForTimeout(700)
ok('and back again', !/PERSONAL/i.test(await chosen()), await chosen())

// ── 10. Layout ──
console.log('\n── A COMPANY CAN BE CORRECTED AFTER IT IS ADDED ──')
// `updateEntity` had existed and been tested since the corporate layer was
// written, and no screen ever called it for a company's own details. A name
// typed wrong, a GSTIN entered before the certificate arrived, or a subsidiary
// whose year starts in January were all permanent; the only control on the
// list was Archive, which is not a correction.
await p.evaluate(() => {
  localStorage.clear()
  const now = new Date().toISOString()
  for (const k of ['pl_expenses', 'pl_income', 'pl_documents', 'pl_properties']) localStorage.setItem(k, '[]')
  localStorage.setItem('pl_corp_entities', JSON.stringify([{
    id: 'e-fix', name: 'U.K. Builders', registration: '', gstin: '', currency: 'INR',
    fy_start_month: 4, created_at: now,
    // What the statutory screens own. This panel does not ask about any of it
    // and must not reset it — which is the whole risk of rebuilding a row.
    pf_registered: true, esi_registered: false, pt_state: '27', bonus_rate: 12.5,
    minimum_wage: 14400, gratuity_voluntary: true, leave_policy: 'annual',
    leave_days_per_year: 18, books_locked_through: '2026-06',
  }]))
  localStorage.setItem('pl_corp_members', JSON.stringify([{ id: 'm-fix', entity_id: 'e-fix', user_id: 'local-user', email: '', role: 'owner', department_id: null, created_at: now }]))
  localStorage.setItem('pl_corp_active', 'e-fix')
})
await p.goto(`${B}/companies`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
await p.locator('button[aria-label="Edit U.K. Builders"]').click()
await p.waitForTimeout(350)
const panel = p.locator('[role="group"][aria-label="Editing U.K. Builders"]')
ok('the panel opens on the company you asked for', await panel.count() === 1)
ok('and it arrives holding what is already there', (await panel.getByLabel('Registered name').inputValue()) === 'U.K. Builders')

await panel.getByLabel('Registered name').fill('Navi Builders Pvt Ltd')
await panel.getByLabel('GSTIN').fill('27aaapa1234a1z5')
await panel.getByLabel('Registered address').fill('Plot 14, MIDC, Navi Mumbai 400703')
await panel.getByLabel('Financial year starts').selectOption('1')
await panel.getByRole('button', { name: 'Save changes' }).click()
await p.waitForTimeout(700)

const fixed = (await ls('pl_corp_entities'))[0]
ok('the name is corrected', fixed.name === 'Navi Builders Pvt Ltd', fixed.name)
ok('the GSTIN is cleaned the way the add form cleans it', fixed.gstin === '27AAAPA1234A1Z5', fixed.gstin)
ok('the year start is no longer stuck on the default', fixed.fy_start_month === 1, String(fixed.fy_start_month))
ok('the row keeps its id', fixed.id === 'e-fix', fixed.id)
ok('and the day it was created', Boolean(fixed.created_at))

// The address existed nowhere. Operations reads `entity.address` and prints it
// under the company name on the stock statement, the material indent and the
// demand letter — three documents that go to a supplier or a buyer — and
// nothing in the app could ever write it, so the line was always blank.
ok('the address a document prints can now be set', fixed.address === 'Plot 14, MIDC, Navi Mumbai 400703', String(fixed.address))

// The assertion that matters most: this panel asks about six fields and the
// row has twenty. Rebuilding it through `makeEntity` regenerates the other
// fourteen at their defaults, which would silently un-register the company for
// provident fund, move it back to Maharashtra's professional tax, drop the
// bonus rate it had agreed and re-open a month that was closed.
ok('provident-fund registration survives', fixed.pf_registered === true, JSON.stringify(fixed.pf_registered))
ok('and the state-insurance answer, which is false rather than unset', fixed.esi_registered === false, JSON.stringify(fixed.esi_registered))
ok('the professional-tax state survives', fixed.pt_state === '27', String(fixed.pt_state))
ok('the agreed bonus rate survives', fixed.bonus_rate === 12.5, String(fixed.bonus_rate))
ok('the minimum wage survives', fixed.minimum_wage === 14400, String(fixed.minimum_wage))
ok('the gratuity promise survives', fixed.gratuity_voluntary === true, String(fixed.gratuity_voluntary))
ok('the leave policy survives', fixed.leave_policy === 'annual' && fixed.leave_days_per_year === 18,
  `${fixed.leave_policy}/${fixed.leave_days_per_year}`)
ok('and a closed month stays closed', fixed.books_locked_through === '2026-06', String(fixed.books_locked_through))

// It reads back on the page, not just in storage.
const listed = await p.locator('#main-content').innerText()
ok('the list shows the corrected name', /Navi Builders Pvt Ltd/.test(listed))
ok('and the year start in words rather than a number', /FY from January/.test(listed), (/FY from [^\n·]*/.exec(listed) || [''])[0])
// The control: the old default is gone, so the assertion above is not agreeing
// with a string that was there all along.
ok('and not the month number it used to print', !/FY from month/.test(listed))

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
