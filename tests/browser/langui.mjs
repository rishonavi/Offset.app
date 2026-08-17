// Switching language in a real browser: the picker, what actually changes on
// screen, what is declared to assistive tech, and that it survives a reload.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
// The PWA worker will serve the previous build's chunks and make a fixed thing
// look broken, so it stays out of the way.
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
const p = await ctx.newPage()
p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s) })
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('ERR_FAILED') && !t.includes('404')) errs.push('CONSOLE ' + t) })
await p.route('**/fonts.g**/**', (r) => r.abort())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${e ? '  — ' + e : ''}`) }

const seed = () => p.evaluate(() => {
  localStorage.clear()
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'p1', name: 'Sea View Villa', type: 'Real Estate — Villa / House', value: 4200000 },
  ]))
  localStorage.setItem('pl_expenses', JSON.stringify([
    { id: 'e1', property_id: 'p1', category: 'Utilities', vendor: 'Adani', amount: 4200, date: '2026-05-02', status: 'paid' },
  ]))
  localStorage.setItem('pl_income', '[]')
  localStorage.setItem('pl_documents', '[]')
})

const nav = () => p.locator('aside nav').innerText()
const picker = () => p.locator('select[aria-label]').filter({ has: p.locator('option', { hasText: 'हिन्दी' }) }).first()

// ── 1. Default ──
console.log('\n── BEFORE CHANGING ANYTHING ──')
await p.goto(B, { waitUntil: 'domcontentloaded' })
await seed()
await p.goto(B, { waitUntil: 'networkidle' })
ok('the app starts in English', /DASHBOARD/i.test(await nav()), (await nav()).replace(/\n/g, ' | '))
ok('the page declares English', (await p.getAttribute('html', 'lang')) === 'en', await p.getAttribute('html', 'lang'))
ok('and a left-to-right direction', ['ltr', ''].includes(await p.getAttribute('html', 'dir') || ''), await p.getAttribute('html', 'dir'))

// ── 2. The picker ──
console.log('\n── THE PICKER ──')
await p.goto(`${B}/settings`, { waitUntil: 'networkidle' })
ok('Settings offers a language picker', await picker().isVisible())
const options = await picker().locator('option').allInnerTexts()
console.log('  offers:', options.join(' / '))
ok('it offers a follow-the-browser choice', /browser/i.test(options[0]), options[0])
for (const name of ['English', 'हिन्दी', 'मराठी', 'ગુજરાતી', 'বাংলা', 'தமிழ்']) {
  ok(`${name} is on the list`, options.some((o) => o.includes(name)))
}
ok('each language is named in its own script', options.some((o) => o.includes('हिन्दी · Hindi')), options.join(' | '))
ok('the picker is labelled for screen readers', Boolean(await picker().getAttribute('aria-label')))

// ── 3. Switching ──
console.log('\n── SWITCHING TO हिन्दी ──')
await picker().selectOption('hi')
await p.waitForTimeout(700)
const hiNav = await nav()
console.log('  sidebar:', hiNav.replace(/\n/g, ' | '))
ok('the sidebar is in Hindi', /डैशबोर्ड/.test(hiNav) && /संपत्तियाँ/.test(hiNav), hiNav.replace(/\n/g, ' | '))
ok('no English nav labels are left', !/DASHBOARD|ASSETS|EXPENSES/i.test(hiNav))
ok('the page now declares Hindi', (await p.getAttribute('html', 'lang')) === 'hi')
ok('the settings heading is translated', /सेटिंग्स/.test(await p.locator('h1').first().innerText()))
ok('a confirmation is shown', await p.locator('[role="status"]').first().isVisible())

// The parts nobody has translated yet must read as English, not as blanks or keys.
const body = await p.locator('#main-content').innerText()
ok('untranslated parts stay in English rather than going blank', /Plan|Account|plan/i.test(body), body.slice(0, 160).replace(/\n/g, ' | '))
ok('no raw translation keys leak to the screen', !/\b(nav|chrome|settings|language)\.[a-z]/i.test(body),
  (body.match(/\b\w+\.[a-zA-Z]+\b/g) || []).slice(0, 5).join(', '))
ok('nothing renders as undefined', !/undefined/.test(body))

// ── 4. It sticks ──
console.log('\n── AFTER A RELOAD ──')
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(500)
ok('the choice survives a reload', /डैशबोर्ड/.test(await nav()))
ok('and is stored under one key', (await p.evaluate(() => localStorage.getItem('pl_lang'))) === 'hi')
await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' })
await p.waitForTimeout(400)
ok('and holds across navigation', /व्यय/.test(await nav()))

// ── 5. Every language renders ──
console.log('\n── EVERY LANGUAGE ──')
const EXPECT = { hi: 'डैशबोर्ड', mr: 'डॅशबोर्ड', gu: 'ડેશબોર્ડ', bn: 'ড্যাশবোর্ড', ta: 'டாஷ்போர்டு' }
for (const [code, word] of Object.entries(EXPECT)) {
  await p.goto(`${B}/settings`, { waitUntil: 'networkidle' })
  await picker().selectOption(code)
  await p.waitForTimeout(600)
  const text = await nav()
  ok(`${code}: the sidebar renders in that language`, text.includes(word), text.split('\n')[0])
  ok(`${code}: the document declares it`, (await p.getAttribute('html', 'lang')) === code)
  // Non-Latin scripts are taller; the sidebar must not spill sideways.
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ok(`${code}: no sideways scroll`, overflow <= 2, `${overflow}px`)
  const clipped = await p.evaluate(() => {
    const links = [...document.querySelectorAll('aside nav a')]
    return links.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.innerText.trim())
  })
  ok(`${code}: no nav label is clipped`, clipped.length === 0, clipped.join(', '))
}

// ── 6. Back to English, and back to the browser ──
console.log('\n── UNDOING IT ──')
await p.goto(`${B}/settings`, { waitUntil: 'networkidle' })
await picker().selectOption('en')
await p.waitForTimeout(500)
ok('English can be chosen back', /DASHBOARD/i.test(await nav()))
ok('choosing English is remembered as a choice', (await p.evaluate(() => localStorage.getItem('pl_lang'))) === 'en')
await picker().selectOption('')
await p.waitForTimeout(500)
ok('following the browser again clears the stored choice',
  (await p.evaluate(() => localStorage.getItem('pl_lang'))) === null)

// ── 7. A browser that asks for Tamil ──
console.log('\n── FOLLOWING THE BROWSER ──')
const ta = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ta-IN', serviceWorkers: 'block' })
const tp = await ta.newPage()
await tp.route('**/fonts.g**/**', (r) => r.abort())
await tp.goto(B, { waitUntil: 'networkidle' })
await tp.waitForTimeout(700)
const taNav = await tp.locator('aside nav').innerText()
ok('a Tamil browser gets Tamil without being asked', /டாஷ்போர்டு/.test(taNav), taNav.split('\n')[0])
ok('with nothing stored, because it was never chosen',
  (await tp.evaluate(() => localStorage.getItem('pl_lang'))) === null)
await ta.close()

// Icelandic, because French is one of the languages Offset now speaks.
const other = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'is-IS', serviceWorkers: 'block' })
const op = await other.newPage()
await op.route('**/fonts.g**/**', (r) => r.abort())
await op.goto(B, { waitUntil: 'networkidle' })
await op.waitForTimeout(600)
ok('a browser Offset does not speak falls back to English',
  /DASHBOARD/i.test(await op.locator('aside nav').innerText()),
  (await op.locator('aside nav').innerText()).split('\n')[0])
await other.close()

// And one it does now speak is picked up without being asked.
const frc = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' })
const fp = await frc.newPage()
await fp.route('**/fonts.g**/**', (r) => r.abort())
await fp.goto(B, { waitUntil: 'networkidle' })
await fp.waitForTimeout(600)
ok('a French browser now gets French',
  /TABLEAU DE BORD/i.test(await fp.locator('aside nav').innerText()),
  (await fp.locator('aside nav').innerText()).split('\n')[0])
await frc.close()

// ── 8. Mobile ──
console.log('\n── MOBILE ──')
await p.setViewportSize({ width: 390, height: 800 })
await p.goto(`${B}/settings`, { waitUntil: 'networkidle' })
await picker().selectOption('bn')
await p.waitForTimeout(600)
const overflowM = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
ok('no sideways scroll on a phone', overflowM <= 2, `${overflowM}px`)
await p.locator('button[aria-label]').filter({ hasText: '' }).first().waitFor().catch(() => {})
const menuBtn = p.locator('header button').last()
await menuBtn.click()
await p.waitForTimeout(400)
const drawer = await p.locator('[role="dialog"], aside, div').filter({ hasText: 'ড্যাশবোর্ড' }).first().isVisible().catch(() => false)
ok('the mobile menu is translated too', drawer)

console.log(`\n${pass} passed, ${fail} failed`)
console.log('errors:', errs.length ? errs.slice(0, 4) : 'none')
await b.close()
