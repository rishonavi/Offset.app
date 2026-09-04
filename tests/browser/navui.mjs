// The bar down the side: what it groups, what it tells you, and whether it
// still fits on a short screen.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const seed = (unpaid, pending) => (args) => {
  const [u, p] = args
  const now = new Date().toISOString()
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'a1', name: 'Sea View Villa', type: 'Real Estate — Apartment / Flat', created_at: now }]))
  localStorage.setItem('pl_expenses', JSON.stringify(Array.from({ length: 6 }, (_, i) => ({
    id: 'e' + i, property_id: 'a1', date: '2026-0' + ((i % 9) + 1) + '-10', amount: 1000,
    category: 'Utilities', status: i < u ? 'unpaid' : 'paid', created_at: now }))))
  localStorage.setItem('pl_income', JSON.stringify(Array.from({ length: 4 }, (_, i) => ({
    id: 'i' + i, property_id: 'a1', date: '2026-0' + (i + 1) + '-05', amount: 5000,
    source: 'Rent', status: i < p ? 'pending' : 'received', created_at: now }))))
}
const open = async (viewport, unpaid = 3, pending = 1) => {
  const ctx = await b.newContext({ viewport, serviceWorkers: 'block' })
  const p = await ctx.newPage(); p.setDefaultTimeout(30000)
  await p.route('**/fonts.g**/**', (r) => r.abort())
  await p.addInitScript(seed(), [unpaid, pending])
  await p.goto(`${B}/expenses`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(700)
  return { ctx, p }
}
const sidebar = (p) => p.locator('aside').first()

console.log('── ELEVEN DESTINATIONS, GROUPED ──')
{
  const { ctx, p } = await open({ width: 1280, height: 1000 })
  const text = await sidebar(p).innerText()
  for (const g of ['ledger', 'holdings', 'tools', 'manage']) {
    ok(`the ${g} group is named`, new RegExp(g, 'i').test(text), text.slice(0, 90).replace(/\n/g, ' | '))
  }
  // Uppercase now marks a group rather than every single link, which is the
  // same rule the forms follow.
  const shouty = await p.evaluate(() =>
    [...document.querySelectorAll('aside nav a')]
      .filter((a) => getComputedStyle(a).textTransform === 'uppercase').length)
  ok('the links themselves are not shouting', shouty === 0, `${shouty} uppercase links`)
  await ctx.close()
}

console.log('\n── AND IT SAYS WHAT IS WAITING ──')
{
  const { ctx, p } = await open({ width: 1280, height: 1000 }, 3, 1)
  const badge = async (name) => p.evaluate((n) => {
    const link = [...document.querySelectorAll('aside nav a')].find((a) => a.innerText.trim().startsWith(n))
    if (!link) return 'NO LINK'
    const b = link.querySelector('span:last-child, span[title]')
    return (link.innerText.replace(n, '').trim()) || ''
  }, name)
  ok('expenses shows how many are unpaid', (await badge('Expenses')).includes('3'), await badge('Expenses'))
  ok('income shows how many are pending', (await badge('Income')).includes('1'), await badge('Income'))
  // A settled entry is finished business; counting it would make the number
  // mean "how much have you done", which nobody needs.
  ok('bills has no count, having nothing unsettled to count', (await badge('Bills')) === '', await badge('Bills'))
  ok('the count is announced, not only coloured',
    /still open/i.test(await sidebar(p).innerHTML()), 'no accessible text')
  await ctx.close()
}

console.log('\n── NOTHING WAITING, NOTHING SHOWN ──')
{
  const { ctx, p } = await open({ width: 1280, height: 1000 }, 0, 0)
  const digits = await p.evaluate(() =>
    [...document.querySelectorAll('aside nav a')].map((a) => a.innerText).join(' ').replace(/[^\d]/g, ''))
  ok('a settled ledger carries no badges at all', digits === '', digits)
  await ctx.close()
}

console.log('\n── IT STILL FITS A SHORT SCREEN ──')
{
  // The bug this is here for: a flex child will not shrink below its content
  // unless told to, so the column grew past the viewport and pushed the user
  // footer off the bottom instead of scrolling. Grouping made it tall enough to
  // show, but a short laptop or one more destination would have done it anyway.
  for (const height of [1000, 760, 620]) {
    const { ctx, p } = await open({ width: 1280, height })
    const fits = await p.evaluate(() => {
      const aside = document.querySelector('aside')
      const footer = aside && aside.lastElementChild
      if (!footer) return null
      const a = aside.getBoundingClientRect()
      const f = footer.getBoundingClientRect()
      return f.bottom <= a.bottom + 1 && f.top >= 0
    })
    ok(`at ${height}px the account footer is still on screen`, fits === true, String(fits))
    const scrolls = await p.evaluate(() => {
      const nav = document.querySelector('aside nav')
      const box = nav && nav.parentElement
      return box ? getComputedStyle(box).overflowY : null
    })
    ok(`at ${height}px the destinations scroll rather than overflow`, scrolls === 'auto', String(scrolls))
    await ctx.close()
  }
}

console.log('\n── EVERY DESTINATION IS STILL COMFORTABLE TO HIT ──')
{
  const { ctx, p } = await open({ width: 1280, height: 1000 })
  const small = await p.evaluate(() =>
    [...document.querySelectorAll('aside nav a')]
      .map((a) => ({ h: a.getBoundingClientRect().height, label: a.innerText.trim().slice(0, 20) }))
      .filter((x) => x.h > 0 && x.h < 44)
      .map((x) => `${x.label} ${Math.round(x.h)}px`))
  ok('no link is under 44px', small.length === 0, small.join(', '))
  await ctx.close()
}

console.log('\n── THE PANEL KEEPS ITS OWN PADDING ──')
// .pt-safe and friends set padding to env(safe-area-inset-*), which is 0px on
// anything without a notch — so instead of adding safety margin they deleted
// the padding the panel was written with. The sidebar said py-5 and ran at 0,
// which is why the account footer sat flush against the bottom of the screen.
{
  const { ctx, p } = await open({ width: 1280, height: 1000 })
  const pad = await p.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('aside'))
    return { top: parseFloat(cs.paddingTop), bottom: parseFloat(cs.paddingBottom), start: parseFloat(cs.paddingInlineStart) }
  })
  ok('the sidebar has its bottom padding', pad.bottom >= 16, JSON.stringify(pad))
  ok('and its top padding', pad.top >= 16, JSON.stringify(pad))
  ok('and its inline padding', pad.start >= 12, JSON.stringify(pad))
  const gap = await p.evaluate(() => {
    const aside = document.querySelector('aside').getBoundingClientRect()
    const kids = [...document.querySelector('aside').children]
    const last = kids[kids.length - 1].getBoundingClientRect()
    return Math.round(aside.bottom - last.bottom)
  })
  ok('so nothing in it touches the bottom edge', gap >= 16, `${gap}px`)
  await ctx.close()
}
{
  const { ctx, p } = await open({ width: 390, height: 800 })
  const top = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('header')).paddingTop))
  ok('the mobile bar keeps its top padding too', top >= 10, `${top}px`)
  await ctx.close()
}

console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
