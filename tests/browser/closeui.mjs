// A month that has been closed, on screen.
//
// Every report is a photograph of a moving thing. Somebody prints March, sends
// it to the bank, and a bill dated the 28th arrives a fortnight later — March is
// now a different number from the one in the bank's file, and nothing in the
// app had any idea March was ever finished.
//
// The assertions worth reading are the ones about where the rule lives. A
// control enforced by a disabled field is not a control, so the entry form is
// checked *and* the corporate store behind it, and reopening has to visibly
// take the months after it with it.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1200 }, serviceWorkers: 'block' })
const p = await ctx.newPage(); p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 160)) })
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('ERR_FAILED') && !t.includes('404')) errs.push('CONSOLE ' + t.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
let confirmed = 0
p.on('dialog', (d) => { confirmed += 1; d.accept() })
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const ls = (k) => p.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), k)
const main = () => p.locator('#main-content').innerText()
const ENT = 'ent-lock-1'
// The month before last and the one before that, so there is always something
// finished to close whenever this runs.
const monthBack = (n) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 7) }
const LAST = monthBack(1)
const BEFORE = monthBack(2)

await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(({ ent }) => {
  localStorage.clear()
  const now = new Date().toISOString()
  for (const k of ['pl_expenses', 'pl_income', 'pl_documents']) localStorage.setItem(k, '[]')
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'a1', name: 'Yard', type: 'Real Estate — Villa / House', entity_id: ent, created_at: now },
  ]))
  localStorage.setItem('pl_corp_entities', JSON.stringify([
    { id: ent, name: 'Navi Builders Pvt Ltd', currency: 'INR', fy_start_month: 4, books_locked_through: null, created_at: now },
  ]))
  localStorage.setItem('pl_corp_members', JSON.stringify([
    { id: 'm1', entity_id: ent, user_id: 'local-user', email: '', role: 'owner', created_at: now },
  ]))
  localStorage.setItem('pl_corp_active', ent)
}, { ent: ENT })

console.log('\n── THE BOOKS HAVE NEVER BEEN CLOSED ──')
await p.goto(`${B}/companies`, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
let t = await main()
ok('the closing card is there', /closing the books/i.test(t), t.slice(0, 400))
ok('and says nothing has been closed', /never been closed/i.test(t), t.slice(0, 900))
ok('offering the month just gone', await p.getByRole('button', { name: new RegExp(`Close ${LAST}`) }).count() === 1)
// One at a time and in order: you do not close March and leave February open.
ok('and only that one', await p.getByRole('button', { name: /^Close \d{4}-\d{2}$/ }).count() === 1)
ok('with nothing to reopen', await p.getByRole('button', { name: /Reopen/ }).count() === 0)

console.log('\n── AN ENTRY IN AN OPEN MONTH SAVES ──')
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
await p.locator('#main-content input[type=number]').first().fill('40000')
await p.locator('#main-content input[type=date]').first().fill(`${BEFORE}-15`)
await p.locator('#main-content form button[type="submit"]').first().click()
await p.waitForTimeout(1200)
ok('it is in the books', (await ls('pl_expenses')).filter((e) => !e.deleted_at).length === 1,
  String((await ls('pl_expenses')).length))

console.log('\n── CLOSING IT ──')
await p.goto(`${B}/companies`, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
await p.getByRole('button', { name: new RegExp(`Close ${LAST}`) }).first().click()
await p.waitForTimeout(1000)
ok('it asked first', confirmed > 0, String(confirmed))
const locked = (await ls('pl_corp_entities'))[0]?.books_locked_through
ok('the lock is stored on the company', locked === LAST, String(locked))
t = await main()
ok('and the card says so', new RegExp(`Closed through ${LAST}`).test(t), t.slice(0, 900))
ok('with nothing older able to change', /Nothing older can change/.test(t), t.slice(0, 900))
ok('there is now something to reopen', await p.getByRole('button', { name: new RegExp(`Reopen ${LAST}`) }).count() === 1)

console.log('\n── AND THE ENTRY FORM REFUSES A DATE INSIDE IT ──')
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
await p.locator('#main-content input[type=number]').first().fill('55000')
await p.locator('#main-content input[type=date]').first().fill(`${LAST}-20`)
await p.locator('#main-content form button[type="submit"]').first().click()
await p.waitForTimeout(1200)
ok('nothing was written', (await ls('pl_expenses')).filter((e) => !e.deleted_at).length === 1,
  String((await ls('pl_expenses')).filter((e) => !e.deleted_at).length))
t = await main()
ok('and it says why', new RegExp(`closed through ${LAST}`, 'i').test(t), t.slice(0, 700))
ok('naming what to do about it', /Reopen them/i.test(t), t.slice(0, 700))

console.log('\n── A DATE AFTER IT STILL SAVES ──')
// The control has to let the ordinary case through, or it is a wall.
const today = new Date().toISOString().slice(0, 10)
await p.locator('#main-content input[type=date]').first().fill(today)
await p.locator('#main-content form button[type="submit"]').first().click()
await p.waitForTimeout(1200)
ok('this month is not closed', (await ls('pl_expenses')).filter((e) => !e.deleted_at).length === 2,
  String((await ls('pl_expenses')).filter((e) => !e.deleted_at).length))

console.log('\n── THE STORE REFUSES TOO, NOT ONLY THE FORM ──')
// A control enforced by a disabled field is not a control. The money ledger has
// its own backend and the corporate store is a different write path entirely,
// so the same month is tried through the muster roll — which never touches the
// expense form and would have been the way round a form-only check.
await p.goto(`${B}/operations?tab=labour`, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
await p.locator('#main-content input[aria-label="Muster date"]').fill(`${LAST}-18`)
await p.locator('#main-content input[aria-label="Headcount"]').fill('6')
await p.locator('#main-content input[aria-label="Day rate"]').fill('850')
await p.locator('#main-content form button[type="submit"]').first().click()
await p.waitForTimeout(1200)
ok('a muster roll in a closed month is refused as well',
  (await ls('pl_corp_muster')).filter((m) => !m.deleted_at).length === 0,
  String((await ls('pl_corp_muster')).length))
// The toast renders outside the main region, so this reads the page. The
// refusal reaching the screen at all is the point: before the writes were
// wrapped, the store refused correctly and the person standing there was told
// nothing, because an uncaught throw from a click handler goes to the window.
const shown = await p.locator('body').innerText()
ok('and the screen says why', new RegExp(`closed through ${LAST}`, 'i').test(shown), shown.slice(-300).replace(/\n/g, ' '))
// Control: the same form on an open date writes, so the refusal above is the
// lock and not a form that never worked.
await p.locator('#main-content input[aria-label="Muster date"]').fill(today)
await p.locator('#main-content form button[type="submit"]').first().click()
await p.waitForTimeout(1200)
ok('and the same day, dated today, goes in',
  (await ls('pl_corp_muster')).filter((m) => !m.deleted_at).length === 1,
  String((await ls('pl_corp_muster')).length))

console.log('\n── REOPENING TAKES THE MONTHS AFTER IT ──')
await p.goto(`${B}/companies`, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
await p.getByRole('button', { name: new RegExp(`Reopen ${LAST}`) }).first().click()
await p.waitForTimeout(1000)
const after = (await ls('pl_corp_entities'))[0]?.books_locked_through
ok('the lock steps back a month', after === BEFORE, String(after))
t = await main()
ok('and the card follows', new RegExp(`Closed through ${BEFORE}`).test(t), t.slice(0, 900))
// The consequence, stated rather than hidden: the month just reopened can be
// written into again.
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
await p.locator('#main-content input[type=number]').first().fill('55000')
await p.locator('#main-content input[type=date]').first().fill(`${LAST}-20`)
await p.locator('#main-content form button[type="submit"]').first().click()
await p.waitForTimeout(1200)
ok('the entry that was refused now saves', (await ls('pl_expenses')).filter((e) => !e.deleted_at).length === 3,
  String((await ls('pl_expenses')).filter((e) => !e.deleted_at).length))

console.log('\n── AND THE MONTH BEFORE IT IS STILL SHUT ──')
await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
await p.locator('#main-content input[type=number]').first().fill('9000')
await p.locator('#main-content input[type=date]').first().fill(`${BEFORE}-05`)
await p.locator('#main-content form button[type="submit"]').first().click()
await p.waitForTimeout(1200)
ok('it is refused', (await ls('pl_expenses')).filter((e) => !e.deleted_at).length === 3,
  String((await ls('pl_expenses')).filter((e) => !e.deleted_at).length))
ok('naming the month that is still closed', new RegExp(`closed through ${BEFORE}`, 'i').test(await main()),
  (await main()).slice(0, 700))

ok('no page errors', errs.length === 0, errs.join(' | '))
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
