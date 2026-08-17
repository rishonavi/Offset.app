// Reporting a problem: reachable, honest about what it collects, validates,
// saves, and shows up in Settings.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({
  viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block',
  permissions: ['clipboard-read', 'clipboard-write'],
})
const p = await ctx.newPage(); p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 160)) })
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('ERR_FAILED') && !t.includes('404') && !t.includes('501')) errs.push('CONSOLE ' + t.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
p.on('dialog', (d) => d.accept())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const ls = (k) => p.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), k)

await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate(() => {
  localStorage.clear()
  localStorage.setItem('pl_properties', JSON.stringify([{ id: 'p1', name: 'Sea View Villa', type: 'Real Estate — Villa / House', value: 4200000 }]))
  localStorage.setItem('pl_expenses', JSON.stringify([{ id: 'e1', property_id: 'p1', category: 'Utilities', vendor: 'Adani', amount: 4200, date: '2026-05-02', status: 'paid' }]))
  localStorage.setItem('pl_income', '[]'); localStorage.setItem('pl_documents', '[]')
})
await p.goto(B, { waitUntil: 'networkidle' })
await p.waitForTimeout(500)

console.log('\n── IT IS FINDABLE ──')
const sidebarBtn = p.locator('aside button', { hasText: 'Report a problem' })
ok('there is a report button in the sidebar', await sidebarBtn.first().isVisible())

console.log('\n── THE DIALOG ──')
await sidebarBtn.first().click()
await p.waitForTimeout(600)
const dlg = p.locator('[role="dialog"], [role="alertdialog"]').first()
ok('a dialog opens', await dlg.isVisible())
let text = await dlg.innerText()
ok('it asks what kind of problem', /something is broken|number looks wrong/i.test(text), text.slice(0, 150).replace(/\n/g, ' | '))
ok('focus lands inside the dialog',
  await p.evaluate(() => { const d = document.querySelector('[role="dialog"],[role="alertdialog"]'); return d ? d.contains(document.activeElement) : false }))

console.log('\n── IT SAYS WHAT IT COLLECTS, BEFORE SENDING ──')
ok('it states up front that the ledger is never sent', /never included/i.test(text), text.slice(0, 200).replace(/\n/g, ' | '))
const detailToggle = dlg.locator('button', { hasText: /show what.s attached/i }).first()
ok('and offers to show exactly what is', await detailToggle.isVisible())
await detailToggle.click()
await p.waitForTimeout(400)
text = await dlg.innerText()
ok('the diagnostics are shown, not hidden', /page|browser|version|appearance|build/i.test(text), text.slice(-300).replace(/\n/g, ' | '))
ok('and none of the ledger leaks in — no vendor name', !/Adani/.test(text))
ok('nor an asset name', !/Sea View Villa/.test(text))

console.log('\n── IT REFUSES AN EMPTY REPORT ──')
const submit = dlg.locator('button').filter({ hasText: /send|file|submit|save/i }).last()
await submit.click()
await p.waitForTimeout(500)
text = await dlg.innerText()
ok('an empty report is refused', (await ls('pl_reports')).length === 0, `${(await ls('pl_reports')).length} saved`)
ok('and it says why', /tell|describe|what happened|required|can’t be empty|cannot be empty/i.test(text),
  text.slice(-250).replace(/\n/g, ' | '))

console.log('\n── FILING ONE ──')
const box = dlg.locator('textarea').first()
await box.fill('The dashboard total is ₹200 higher than the sum of the rows.')
await p.waitForTimeout(200)
await submit.click()
await p.waitForTimeout(1000)
const reports = await ls('pl_reports')
ok('the report is saved locally', reports.length === 1, `${reports.length}`)
const r = reports[0] || {}
ok('with a reference the user can quote', Boolean(r.reference), String(r.reference))
ok('and the message', /₹200 higher/.test(r.message || ''), String(r.message).slice(0, 60))
ok('and diagnostics attached', Boolean(r.diagnostics), JSON.stringify(r.diagnostics || {}).slice(0, 80))
ok('the page it was filed from is recorded', Boolean(r.diagnostics?.route), String(r.diagnostics?.route))
ok('but no ledger contents are', !JSON.stringify(r).includes('Adani') && !JSON.stringify(r).includes('Sea View'))

console.log('\n── AFTER FILING ──')
text = await p.locator('body').innerText()
ok('the reference is shown back to the user', text.includes(r.reference), r.reference)

console.log('\n── IT APPEARS IN SETTINGS ──')
await p.goto(`${B}/settings`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
const settings = await p.locator('#main-content').innerText()
ok('Settings has a Report a problem section', /Report a problem/.test(settings))
ok('and lists the filed report', settings.includes(r.reference), r.reference)
ok('with its message', /₹200 higher/.test(settings))
ok('there is a New report button', await p.locator('button', { hasText: 'New report' }).first().isVisible())
ok('the copy control is labelled for screen readers',
  (await p.locator(`button[aria-label="Copy report ${r.reference}"]`).count()) === 1)
ok('so is delete', (await p.locator(`button[aria-label="Delete report ${r.reference}"]`).count()) === 1)

console.log('\n── DELETING ONE ──')
await p.locator(`button[aria-label="Delete report ${r.reference}"]`).click()
await p.waitForTimeout(700)
ok('the report is removed', (await ls('pl_reports')).length === 0, `${(await ls('pl_reports')).length}`)
ok('and the list is gone from the page', !(await p.locator('#main-content').innerText()).includes(r.reference))

console.log('\n── A CRASH OFFERS TO REPORT ITSELF ──')
await p.goto(B, { waitUntil: 'networkidle' })
await p.waitForTimeout(400)
await p.evaluate(() => {
  const err = new Error('Synthetic failure for the error log')
  window.dispatchEvent(new ErrorEvent('error', { message: err.message, error: err }))
})
await p.waitForTimeout(300)
await p.locator('aside button', { hasText: 'Report a problem' }).first().click()
await p.waitForTimeout(600)
const dlg2 = p.locator('[role="dialog"], [role="alertdialog"]').first()
await dlg2.locator('button', { hasText: /show what.s attached/i }).first().click()
await p.waitForTimeout(400)
const attached = await dlg2.innerText()
ok('a runtime error is captured and carried into the next report',
  /Synthetic failure for the error log/.test(attached), attached.slice(-260).replace(/\n/g, ' | '))
ok('the buffer is in memory, not written to storage',
  (await p.evaluate(() => Object.keys(localStorage).filter((k) => /error/i.test(k)).length)) === 0)
await p.keyboard.press('Escape')
await p.waitForTimeout(400)

console.log('\n── COMMAND PALETTE ──')
await p.keyboard.press('Control+k')
await p.waitForTimeout(600)
const palette = await p.locator('body').innerText()
ok('the palette offers reporting a problem', /report a problem/i.test(palette))
await p.keyboard.press('Escape')

console.log('\n── LAYOUT ──')
await p.setViewportSize({ width: 390, height: 800 })
await p.goto(`${B}/settings`, { waitUntil: 'networkidle' })
await p.waitForTimeout(500)
let overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
ok('Settings does not scroll sideways on a phone', overflow <= 2, `${overflow}px`)
await p.locator('button', { hasText: 'New report' }).first().click()
await p.waitForTimeout(700)
overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
ok('nor does the dialog', overflow <= 2, `${overflow}px`)
const unlabelled = await p.evaluate(() => {
  const d = document.querySelector('[role="dialog"],[role="alertdialog"]')
  if (!d) return ['no dialog']
  return [...d.querySelectorAll('input,select,textarea')]
    .filter((el) => el.type !== 'hidden' && el.offsetParent !== null)
    .filter((el) => !(el.getAttribute('aria-label') || el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`))))
    .map((el) => el.outerHTML.slice(0, 70))
})
ok('every control in the dialog is labelled', unlabelled.length === 0, unlabelled.join(' | '))
// Escape must close it.
await p.keyboard.press('Escape')
await p.waitForTimeout(500)
ok('escape closes the dialog', (await p.locator('[role="dialog"],[role="alertdialog"]').count()) === 0)

console.log(`\n${pass} passed, ${fail} failed`)
console.log('errors:', errs.length ? errs.slice(0, 5) : 'none')
await b.close()
if (fail) process.exitCode = 1
