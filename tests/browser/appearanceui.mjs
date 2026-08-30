// Choosing a colour and an avatar, and whether the app is still readable after.
import { chromium } from './_playwright.mjs'
import { installColour, backdrops } from './_colour.mjs'
import { ACCENTS } from '../../src/lib/appearance.js'

const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const open = async (path = '/settings') => {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' })
  const p = await ctx.newPage()
  p.setDefaultTimeout(30000)
  await p.route('**/fonts.g**/**', (r) => r.abort())
  await p.goto(B + path, { waitUntil: 'networkidle' })
  await p.waitForTimeout(400)
  return { ctx, p }
}
const accentVar = (p) => p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-gold').trim())

console.log('── CHOOSING A COLOUR ──')
{
  const { ctx, p } = await open()
  const before = await accentVar(p)
  ok('the app starts on the gold it shipped with', before.includes('82.35') || before === '', before)

  await p.locator('button[title="Indigo"]').first().click()
  await p.waitForTimeout(300)
  const after = await accentVar(p)
  ok('picking one re-tints the whole document', after.includes('262'), after)
  // The point of doing this with a variable: the sidebar button was never told
  // about the change, and changes anyway.
  const btn = await p.locator('a[href="/expenses/new"], button:has-text("Add expense")').first()
    .evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => null)
  ok('a control nobody re-rendered follows it', btn === null || !btn.includes('197, 160, 89'), String(btn))

  ok('the choice is remembered', (await p.evaluate(() => localStorage.getItem('pl_accent'))) === 'indigo')
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(400)
  ok('and survives a reload', (await accentVar(p)).includes('262'))
  // Gold is the stylesheet's own value, so choosing it should clear the key
  // rather than store a default as though it were a decision.
  await p.locator('button[title="Gold"]').first().click()
  await p.waitForTimeout(300)
  ok('going back to gold stores nothing', (await p.evaluate(() => localStorage.getItem('pl_accent'))) === null)
  await ctx.close()
}

console.log('\n── NO FLASH OF THE WRONG COLOUR ──')
{
  // The inline script in index.html has to set the accent before the first
  // paint, or someone who chose a colour sees gold for a frame. Racing a
  // navigation to catch that window is flaky; blocking the app's JavaScript
  // outright is not. If the colour is right with none of the app loaded, only
  // the inline script can have set it.
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' })
  const p = await ctx.newPage()
  await p.route('**/fonts.g**/**', (r) => r.abort())
  await p.route('**/assets/*.js', (r) => r.abort())
  await p.addInitScript(() => localStorage.setItem('pl_accent', 'rose'))
  await p.goto(B + '/settings', { waitUntil: 'domcontentloaded' })
  const early = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-gold').trim())
  ok('the accent is set with none of the app loaded', early.includes('15'), early || 'not set')
  ok('and the app really was not running', (await p.locator('#root').innerHTML()) === '')
  await ctx.close()
}

console.log('\n── THE AVATAR ──')
{
  const { ctx, p } = await open()
  const mark = p.locator('aside .grid, nav .grid').first()
  await p.locator('input[aria-label="Display name"]').fill('Ada Lovelace')
  await p.waitForTimeout(300)
  const initials = await p.evaluate(() =>
    [...document.querySelectorAll('span')].map((s) => s.textContent.trim()).filter((t) => t === 'AL').length)
  ok('a name becomes initials', initials >= 1, `${initials} found`)
  ok('and the name is shown instead of the address',
    await p.locator('text=Ada Lovelace').first().isVisible())

  await p.locator('button:has-text("🦉")').first().click()
  await p.waitForTimeout(300)
  ok('a symbol replaces the initials', (await p.locator('text=🦉').count()) >= 2)
  ok('the avatar is remembered', JSON.parse(await p.evaluate(() => localStorage.getItem('pl_avatar'))).symbol === '🦉')

  await p.locator('button:has-text("Reset avatar")').click()
  await p.waitForTimeout(300)
  ok('reset clears it', (await p.evaluate(() => localStorage.getItem('pl_avatar'))) === null)
  ok('and the address comes back', await p.locator('text=demo@local').first().isVisible())
  await ctx.close()
}

console.log('\n── STILL READABLE IN EVERY COLOUR ──')
// Accents vary hue at gold's lightness, which is the claim that makes six
// palettes safe rather than six chances to ship something illegible. This is
// the claim being checked rather than assumed, in both themes.
for (const theme of ['light', 'dark']) {
  for (const a of ACCENTS) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' })
    const p = await ctx.newPage()
    p.setDefaultTimeout(30000)
    await p.route('**/fonts.g**/**', (r) => r.abort())
    await p.addInitScript(([accent, t]) => {
      localStorage.setItem('pl_accent', accent)
      localStorage.setItem('pl_theme', t)
    }, [a.id, theme])
    await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(500)
    await p.evaluate(installColour)
    const spots = await p.evaluate(() =>
      [['#main-content .btn-primary', 'the primary button'], ['.eyebrow', 'a section eyebrow'], ['nav a[aria-current], aside a[aria-current]', 'the current page in the sidebar']]
        .flatMap(([sel, name]) => {
          const el = document.querySelector(sel)
          if (!el) return []
          const r = el.getBoundingClientRect()
          if (r.width < 1 || r.height < 1) return []
          const cs = getComputedStyle(el)
          const px = parseFloat(cs.fontSize)
          return [{
            name,
            colour: cs.color,
            point: [r.left + scrollX + r.width / 2, r.top + scrollY + r.height / 2],
            need: px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700) ? 3 : 4.5,
          }]
        }))
    const bgs = await backdrops(p, spots.map((s) => s.point))
    const bad = await p.evaluate(({ spots, bgs }) => spots.flatMap((s, i) => {
      const bg = bgs[i]
      const fg = window.__colour.srgb([`rgb(${bg.join(',')})`, s.colour])
      const r = window.__colour.ratio(fg, bg)
      return r < s.need ? [`${s.name} ${r.toFixed(2)}:1 needs ${s.need}`] : []
    }), { spots, bgs })
    ok(`${theme} · ${a.name} stays readable`, bad.length === 0 && spots.length > 0, bad.join(' · ') || 'nothing measured')
    await ctx.close()
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
