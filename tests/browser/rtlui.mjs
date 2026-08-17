// Thirteen languages in the browser, and the two that read right-to-left
// actually laying out right-to-left.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
const p = await ctx.newPage(); p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 160)) })
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('ERR_FAILED') && !t.includes('404')) errs.push('CONSOLE ' + t.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
p.on('dialog', (d) => d.accept())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const seed = () => p.evaluate(() => {
  localStorage.clear()
  localStorage.setItem('pl_properties', JSON.stringify([{ id: 'p1', name: 'Sea View Villa', type: 'Real Estate — Villa / House', value: 4200000, monthly_budget: 25000 }]))
  localStorage.setItem('pl_expenses', JSON.stringify([{ id: 'e1', property_id: 'p1', category: 'Utilities', vendor: 'Adani', amount: 4200, date: '2026-05-02', status: 'paid' }]))
  localStorage.setItem('pl_income', JSON.stringify([{ id: 'i1', property_id: 'p1', source: 'Rent', amount: 90000, date: '2026-05-01' }]))
  localStorage.setItem('pl_documents', '[]')
})
const setLang = async (code) => {
  await p.evaluate((c) => localStorage.setItem('pl_lang', c), code)
  await p.goto(B, { waitUntil: 'networkidle' })
  await p.waitForTimeout(700)
}
const overflow = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

await p.goto(B, { waitUntil: 'domcontentloaded' })
await seed()

console.log('\n── EVERY LANGUAGE LOADS AND SPEAKS ──')
const EXPECT = {
  en: 'Dashboard', zh: '总览', hi: 'डैशबोर्ड', es: 'Panel', fr: 'Tableau de bord',
  ar: 'لوحة المعلومات', bn: 'ড্যাশবোর্ড', pt: 'Painel', ru: 'Панель', ur: 'ڈیش بورڈ',
  mr: 'डॅशबोर्ड', gu: 'ડેશબોર્ડ', ta: 'டாஷ்போர்டு',
}
for (const [code, word] of Object.entries(EXPECT)) {
  await setLang(code)
  // The nav is styled uppercase, and innerText returns the transformed text —
  // which matters for Latin and Cyrillic and does nothing to Arabic or Chinese.
  const nav = await p.locator('aside nav').innerText()
  ok(`${code}: the nav is in the right language`,
    nav.toLocaleLowerCase(code).includes(word.toLocaleLowerCase(code)),
    `wanted "${word}", got "${nav.split('\n')[0]}"`)
  const o = await overflow()
  ok(`${code}: no sideways scroll`, o <= 2, `${o}px`)
}

console.log('\n── THE DOCUMENT DECLARES ITSELF ──')
for (const [code, dir] of [['en', 'ltr'], ['ar', 'rtl'], ['ur', 'rtl'], ['ru', 'ltr']]) {
  await setLang(code)
  const got = await p.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir }))
  ok(`${code}: lang="${code}"`, got.lang === code, JSON.stringify(got))
  ok(`${code}: dir="${dir}"`, got.dir === dir, JSON.stringify(got))
}

console.log('\n── ARABIC ACTUALLY LAYS OUT RIGHT-TO-LEFT ──')
await setLang('ar')
const geom = await p.evaluate(() => {
  const aside = document.querySelector('aside')
  const main = document.querySelector('#main-content')
  const r = (el) => { const b = el.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right) } }
  return { aside: aside && r(aside), main: main && r(main), width: window.innerWidth }
})
ok('the sidebar moves to the right-hand side',
  geom.aside && geom.aside.left > geom.width / 2, JSON.stringify(geom))
ok('and the content sits to its left',
  geom.main && geom.aside && geom.main.left < geom.aside.left, JSON.stringify(geom))

// The nav's active marker is a border on the inline-start edge: on the right in RTL.
const marker = await p.evaluate(() => {
  const a = document.querySelector('aside nav a')
  if (!a) return null
  const cs = getComputedStyle(a)
  return { left: cs.borderLeftWidth, right: cs.borderRightWidth }
})
ok('the active-nav marker flips to the right edge',
  marker && marker.right !== '0px' && marker.left === '0px', JSON.stringify(marker))

console.log('\n── FORM FURNITURE FLIPS TOO ──')
await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
const money = await p.evaluate(() => {
  const span = [...document.querySelectorAll('form span')].find((s) => /[₹$€]/.test(s.textContent.trim()) && s.textContent.trim().length <= 2)
  if (!span) return null
  const input = span.parentElement.querySelector('input')
  if (!input) return null
  const s = span.getBoundingClientRect(), i = input.getBoundingClientRect()
  const cs = getComputedStyle(input)
  return { symbolCentre: Math.round(s.left + s.width / 2), inputCentre: Math.round(i.left + i.width / 2),
    padLeft: cs.paddingLeft, padRight: cs.paddingRight }
})
ok('the currency symbol sits on the right of the field in RTL',
  money && money.symbolCentre > money.inputCentre, JSON.stringify(money))
ok('and the padding is made on that side, so text cannot run under it',
  money && parseFloat(money.padRight) > parseFloat(money.padLeft), JSON.stringify(money))

const arrow = await p.evaluate(() => {
  const sel = document.querySelector('select.field-input')
  if (!sel) return null
  const cs = getComputedStyle(sel)
  return { pos: cs.backgroundPosition, padLeft: cs.paddingLeft, padRight: cs.paddingRight }
})
ok('the select chevron moves to the left in RTL',
  arrow && parseFloat(arrow.padLeft) > parseFloat(arrow.padRight), JSON.stringify(arrow))
ok('no sideways scroll on the form either', (await overflow()) <= 2, `${await overflow()}px`)

console.log('\n── AND LTR IS UNCHANGED ──')
await p.evaluate(() => localStorage.setItem('pl_lang', 'en'))
await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
const ltrMoney = await p.evaluate(() => {
  const span = [...document.querySelectorAll('form span')].find((s) => /[₹$€]/.test(s.textContent.trim()) && s.textContent.trim().length <= 2)
  const input = span?.parentElement.querySelector('input')
  if (!input) return null
  const s = span.getBoundingClientRect(), i = input.getBoundingClientRect()
  const cs = getComputedStyle(input)
  return { symbolCentre: Math.round(s.left + s.width / 2), inputCentre: Math.round(i.left + i.width / 2), padLeft: cs.paddingLeft }
})
ok('in English the symbol is still on the left',
  ltrMoney && ltrMoney.symbolCentre < ltrMoney.inputCentre, JSON.stringify(ltrMoney))
ok('with the padding still on the left', ltrMoney && parseFloat(ltrMoney.padLeft) > 20, JSON.stringify(ltrMoney))
const ltrGeom = await p.evaluate(() => {
  const a = document.querySelector('aside')
  return a ? Math.round(a.getBoundingClientRect().left) : null
})
ok('and the sidebar is back on the left', ltrGeom !== null && ltrGeom < 50, String(ltrGeom))

console.log('\n── THE PICKER ──')
await p.goto(`${B}/settings`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
const opts = await p.locator('select[aria-label="Language"], select[aria-label="भाषा"]').first().locator('option').allInnerTexts()
ok('all thirteen languages are offered, plus "match my browser"', opts.length === 14, `${opts.length}: ${opts.join(' / ')}`)
ok('each is named in its own script', opts.some((o) => /العربية/.test(o)) && opts.some((o) => /简体中文/.test(o)) && opts.some((o) => /Русский/.test(o)),
  opts.join(' / '))
ok('the top ten lead the list', /English/.test(opts[1]) && /简体中文/.test(opts[2]), opts.slice(0, 4).join(' / '))

// Switching from the picker works and is remembered.
await p.locator('select[aria-label="Language"]').first().selectOption('ar')
await p.waitForTimeout(900)
ok('choosing Arabic switches the page', (await p.evaluate(() => document.documentElement.dir)) === 'rtl')
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(700)
ok('and it survives a reload', (await p.evaluate(() => document.documentElement.dir)) === 'rtl')
ok('coverage is reported as complete, not 97%',
  /100%|١٠٠/.test(await p.locator('#main-content').innerText()) || !/9\d%/.test(await p.locator('#main-content').innerText()),
  (await p.locator('#main-content').innerText()).match(/\d+%[^\n]*/)?.[0] || 'no percentage shown')

console.log('\n── PHONE, IN ARABIC ──')
await p.setViewportSize({ width: 390, height: 800 })
for (const path of ['/', '/expenses', '/settings', '/properties/new']) {
  await p.goto(B + path, { waitUntil: 'networkidle' })
  await p.waitForTimeout(600)
  const o = await overflow()
  ok(`${path} does not scroll sideways in Arabic on a phone`, o <= 2, `${o}px`)
}

console.log(`\n${pass} passed, ${fail} failed`)
console.log('errors:', errs.length ? errs.slice(0, 5) : 'none')
await b.close()
if (fail) process.exitCode = 1
