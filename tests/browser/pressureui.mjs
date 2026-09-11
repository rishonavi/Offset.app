// Arriving with nothing, and then leaning on everything.
//
// Every other browser suite seeds the state it wants to look at. This one
// starts with an empty browser and walks in the front door, because the first
// five minutes are the ones nobody tests and the only ones every user has. Then
// it pushes: text where numbers go, a thousand characters where a name goes,
// markup where prose goes, storage full, storage corrupt, the back button.
//
// A failure here is not always a crash. Silently keeping a number the app
// cannot add up is worse than refusing it, so several of these check that
// nonsense was *rejected* rather than that nothing exploded.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${e ? '  — ' + String(e).replace(/\n+/g, ' | ').slice(0, 170) : ''}`) }

// A brand-new browser: no storage, no seeding, nothing.
const errs = []
const fresh = async () => {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
  const p = await ctx.newPage()
  p.setDefaultTimeout(20000)
  await p.route('**/fonts.g**/**', (r) => r.abort())
  p.on('pageerror', (e) => { const s = String(e); if (!/serviceWorker/.test(s)) errs.push(`PAGEERROR ${s.slice(0, 170)}`) })
  p.on('console', (m) => {
    const t = m.text()
    if (m.type() === 'error' && !/ERR_FAILED|404|ERR_CONNECTION|Failed to load resource/.test(t)) errs.push(`CONSOLE ${t.slice(0, 170)}`)
  })
  p.on('dialog', (d) => d.accept())
  return { ctx, p }
}
const main = (p) => p.locator('#main-content').innerText()
const rows = (p, k) => p.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), k)

// ── 1. The first screen anyone ever sees ──
console.log('\n── ARRIVING WITH NOTHING ──')
{
  const { ctx, p } = await fresh()
  await p.goto(B, { waitUntil: 'networkidle' })
  await p.waitForTimeout(900)
  const t = await main(p)
  ok('the dashboard renders for someone with no data', t.length > 60, t.slice(0, 160))
  ok('and does not show NaN, undefined or Invalid Date',
    !/NaN|undefined|Invalid Date|\[object/.test(t), t.match(/NaN|undefined|Invalid Date|\[object \w+/)?.[0])
  ok('and says what to do rather than showing an empty grid', /add|start|first|welcome/i.test(t), t.slice(0, 200))
  ok('nothing was written to storage just by looking',
    (await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('pl_')).length)) <= 3,
    await p.evaluate(() => Object.keys(localStorage).join(',')))
  await ctx.close()
}

// ── 2. Every route, cold, with nothing in it ──
console.log('\n── EVERY PAGE, EMPTY ──')
{
  const { ctx, p } = await fresh()
  const routes = ['/', '/properties', '/expenses', '/income', '/bills', '/invoices', '/reports',
    '/exports', '/import', '/personal', '/bin', '/settings', '/companies', '/operations',
    '/properties/new', '/expenses/new', '/income/new']
  for (const r of routes) {
    const before = errs.length
    await p.goto(`${B}${r}`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(450)
    const t = await main(p)
    const bad = /NaN|Invalid Date|\[object Object\]/.test(t)
    ok(`${r} renders and says something`, t.length > 30 && !bad && errs.length === before,
      bad ? t.match(/.{0,40}(NaN|Invalid Date|\[object Object\]).{0,40}/)?.[0] : errs.slice(before).join(' / ') || t.slice(0, 90))
  }
  await ctx.close()
}

// ── 3. An asset, made the way a person makes one ──
console.log('\n── THE FIRST ASSET ──')
const NASTY = '<img src=x onerror=alert(1)>Sea "View" का घर 🏠 & <b>bold</b>'
{
  const { ctx, p } = await fresh()
  await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(600)
  await p.locator('#main-content input').first().fill(NASTY)
  await p.locator('form button[type="submit"]').first().click()
  await p.waitForTimeout(1200)
  const saved = (await rows(p, 'pl_properties'))[0]
  ok('an asset with markup and unicode in its name saves', Boolean(saved), JSON.stringify(saved || {}).slice(0, 120))
  await p.goto(`${B}/properties`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(700)
  ok('and the markup is shown as text, not run',
    (await p.evaluate(() => document.querySelectorAll('#main-content img').length)) === 0)
  ok('the name is on screen', /Sea/.test(await main(p)))
  ok('no script ran', !errs.some((e) => /alert/.test(e)))
  await ctx.close()
}

// ── 4. Numbers that are not numbers ──
// A form that quietly keeps a value it cannot add up is worse than one that
// refuses it: the refusal is visible, the wrong total is not.
console.log('\n── MONEY THAT IS NOT MONEY ──')
{
  const { ctx, p } = await fresh()
  await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(500)
  await p.locator('#main-content input').first().fill('Pressure Asset')
  await p.locator('form button[type="submit"]').first().click()
  await p.waitForTimeout(1000)

  // The control, and it earns its place: the first version of this section
  // reported PASS seven times over while the expense form was throwing on every
  // submit. Nothing saved, so nothing absurd saved. A negative test with no
  // positive beside it says only that the app did nothing.
  const saveExpense = async (value) => {
    await p.goto(`${B}/expenses/new`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(500)
    await p.locator('#main-content input[type=number]').first().fill(value).catch(() => {})
    await p.locator('form button[type="submit"]').first().click()
    await p.waitForTimeout(900)
    return rows(p, 'pl_expenses')
  }
  ok('an ordinary amount does save', (await saveExpense('4200')).some((r) => Number(r.amount) === 4200),
    JSON.stringify((await rows(p, 'pl_expenses')).map((r) => r.amount)))

  const cases = [
    ['1e308', 'a number too big to add up'],
    ['-5000', 'a negative amount'],
    ['0', 'nothing at all'],
    ['1.23456789', 'more decimals than money has'],
    ['999999999999999999999', 'a pasted phone number'],
    ['abc', 'letters'],
    ['١٢٣', 'digits in another script'],
    ['Infinity', 'infinity'],
  ]
  for (const [value, label] of cases) {
    const saved = await saveExpense(value)
    const amounts = saved.map((r) => Number(r.amount))
    const broken = amounts.some((n) => !Number.isFinite(n) || n < 0 || n > 1e15)
    ok(`${label} never becomes a stored amount`, !broken, JSON.stringify(amounts))
  }
  // And whatever did save must still total correctly on the pages that add up.
  for (const r of ['/', '/reports', '/expenses']) {
    await p.goto(`${B}${r}`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(600)
    const t = await main(p)
    ok(`${r} still totals without NaN`, !/NaN|Infinity|e\+\d/.test(t), t.match(/.{0,40}(NaN|Infinity|e\+\d+).{0,30}/)?.[0])
  }
  await ctx.close()
}

// ── 5. A thousand characters where a name goes ──
console.log('\n── TOO MUCH TEXT ──')
{
  const { ctx, p } = await fresh()
  const HUGE = 'A'.repeat(1000)
  await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(500)
  await p.locator('#main-content input').first().fill(HUGE)
  await p.locator('input[placeholder="Street, area, city"]').fill(HUGE)
  await p.locator('form button[type="submit"]').first().click()
  await p.waitForTimeout(1100)
  const saved = (await rows(p, 'pl_properties'))[0]
  ok('a thousand-character name is saved or trimmed, not lost', Boolean(saved?.name), String(saved?.name).length)
  await p.goto(`${B}/properties`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(700)
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ok('and does not push the page sideways', overflow <= 2, `${overflow}px`)
  await p.setViewportSize({ width: 390, height: 800 })
  await p.waitForTimeout(500)
  const phone = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ok('nor on a phone', phone <= 2, `${phone}px`)
  await ctx.close()
}

// ── 6. Pressing save twice ──
console.log('\n── IMPATIENCE ──')
{
  const { ctx, p } = await fresh()
  await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(500)
  await p.locator('#main-content input').first().fill('Double Tap')
  const submit = p.locator('form button[type="submit"]').first()
  await Promise.all([submit.click(), submit.click().catch(() => {})])
  await p.waitForTimeout(1400)
  const saved = (await rows(p, 'pl_properties')).filter((r) => r.name === 'Double Tap')
  ok('pressing save twice does not make two assets', saved.length === 1, `${saved.length}`)
  await ctx.close()
}

// ── 7. Storage that is full, and storage that is nonsense ──
console.log('\n── WHEN STORAGE TURNS ON YOU ──')
{
  const { ctx, p } = await fresh()
  await p.goto(B, { waitUntil: 'networkidle' })
  // Every key the app reads, replaced with something it cannot possibly parse.
  await p.evaluate(() => {
    for (const k of ['pl_properties', 'pl_expenses', 'pl_income', 'pl_documents', 'pl_comments',
      'pl_corp_entities', 'pl_corp_members', 'pl_search_history', 'pl_invoice_issuer',
      'pl_personal_expenses', 'pl_reports', 'pl_avatar']) localStorage.setItem(k, 'not json {{{')
  })
  const before = errs.length
  for (const r of ['/', '/properties', '/expenses', '/bills', '/invoices', '/reports', '/personal', '/bin', '/settings', '/companies']) {
    await p.goto(`${B}${r}`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(400)
    const t = await main(p)
    ok(`${r} survives corrupt storage`, t.length > 30, t.slice(0, 80))
  }
  ok('and none of it threw', errs.length === before, errs.slice(before).join(' / '))
  await ctx.close()
}
{
  const { ctx, p } = await fresh()
  await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(500)
  // Fill the quota, then try to save. The app must say so, not fail silently.
  await p.evaluate(() => {
    try {
      const chunk = 'x'.repeat(512 * 1024)
      for (let i = 0; i < 40; i++) localStorage.setItem(`filler_${i}`, chunk)
    } catch { /* full, which is the point */ }
  })
  await p.locator('#main-content input').first().fill('Saved While Full')
  await p.locator('form button[type="submit"]').first().click()
  await p.waitForTimeout(1400)
  const body = await p.locator('body').innerText()
  const saved = (await rows(p, 'pl_properties')).some((r) => r.name === 'Saved While Full')
  ok('a full browser is either handled or reported, never silent',
    saved || /full|could not|couldn|error|storage/i.test(body), body.slice(-200))
  await ctx.close()
}

// ── 8. Leaning on the books boundary ──
// The newest machinery, and the one with the most ways to leak. Switch while a
// form is half-filled, switch while a page is mid-load, delete a company out
// from under the books you are looking at.
console.log('\n── PUSHING ON THE TWO SETS OF BOOKS ──')
{
  const { ctx, p } = await fresh()
  await p.goto(B, { waitUntil: 'networkidle' })
  await p.evaluate(() => {
    const now = new Date().toISOString()
    localStorage.setItem('pl_properties', JSON.stringify([
      { id: 'p-own', name: 'My Flat', type: 'Real Estate — Apartment / Flat', created_at: now },
      { id: 'p-co', name: 'Company Shed', type: 'Machinery / Equipment', entity_id: 'ent-1', created_at: now }]))
    localStorage.setItem('pl_expenses', '[]'); localStorage.setItem('pl_income', '[]')
    localStorage.setItem('pl_documents', '[]')
    localStorage.setItem('pl_corp_entities', JSON.stringify([
      { id: 'ent-1', name: 'Acme Pvt Ltd', gstin: '', currency: 'INR', fyStartMonth: 4, created_at: now }]))
    localStorage.setItem('pl_corp_members', JSON.stringify([
      { id: 'm1', entity_id: 'ent-1', user_id: 'local-user', email: '', role: 'owner', department_id: null, created_at: now }]))
    localStorage.setItem('pl_corp_active', 'ent-1')
  })
  const pick = async (name) => {
    await p.locator('aside [role="tab"]', { hasText: new RegExp(name, 'i') }).click()
    await p.waitForTimeout(600)
  }

  // Switch back and forth quickly — a stale filter would show the wrong rows.
  await p.goto(`${B}/properties`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(600)
  for (let i = 0; i < 4; i++) { await pick('personal'); await pick('company') }
  const after = await main(p)
  ok('rapid switching lands somewhere consistent',
    /Company Shed/.test(after) !== /My Flat/.test(after), after.slice(0, 160))

  // Half-fill a form, switch books underneath it, then save.
  await p.goto(`${B}/properties/new`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(500)
  await p.locator('#main-content input').first().fill('Started In A Company')
  await pick('personal')
  await p.waitForTimeout(500)
  await p.locator('form button[type="submit"]').first().click()
  await p.waitForTimeout(1200)
  const moved = (await rows(p, 'pl_properties')).find((r) => r.name === 'Started In A Company')
  ok('an entry saved after switching belongs to the books it was saved in',
    moved && !moved.entity_id, JSON.stringify(moved?.entity_id))

  // Archive the company while looking at its books.
  await pick('company')
  await p.evaluate(() => {
    const l = JSON.parse(localStorage.getItem('pl_corp_entities'))
    l[0].archived_at = new Date().toISOString()
    localStorage.setItem('pl_corp_entities', JSON.stringify(l))
  })
  const before = errs.length
  for (const r of ['/', '/properties', '/operations', '/reports', '/companies']) {
    await p.goto(`${B}${r}`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(500)
    ok(`${r} survives its company being archived`, (await main(p)).length > 30 && errs.length === before,
      errs.slice(before).join(' / '))
  }
  // The rows that pointed at it must not vanish from storage, only from view.
  ok('and the company rows are still in the file',
    (await rows(p, 'pl_properties')).some((r) => r.entity_id === 'ent-1'))
  await ctx.close()
}

// ── 9. The back button, and the URL bar ──
console.log('\n── NAVIGATION NOBODY PLANNED FOR ──')
{
  const { ctx, p } = await fresh()
  const before = errs.length
  for (const r of ['/', '/properties', '/expenses', '/reports', '/settings']) {
    await p.goto(`${B}${r}`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(300)
  }
  for (let i = 0; i < 4; i++) { await p.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {}); await p.waitForTimeout(300) }
  for (let i = 0; i < 4; i++) { await p.goForward({ waitUntil: 'domcontentloaded' }).catch(() => {}); await p.waitForTimeout(300) }
  ok('walking back and forward through history throws nothing', errs.length === before, errs.slice(before).join(' / '))
  ok('and lands on a real page', (await main(p)).length > 30)

  // URLs nobody would type on purpose.
  for (const r of ['/properties/does-not-exist', '/properties/does-not-exist/edit', '/expenses/nope/edit',
    '/reports?from=not-a-date&to=%%%', '/reports?propertyId=../../etc/passwd', '/nonsense/deep/path']) {
    const n = errs.length
    await p.goto(`${B}${r}`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(500)
    const t = await main(p)
    ok(`${r} is handled`, t.length > 20 && errs.length === n, errs.slice(n).join(' / ') || t.slice(0, 70))
  }
  await ctx.close()
}

// -- 10. Files that are not what they claim --
// Import parses whatever it is handed. It is the one place the app runs a
// stranger's bytes, so it is the one place a crash is most likely and least
// excusable - a bad file must be refused, not swallowed and not fatal.
console.log('\n== FILES THAT LIE ==')
{
  const { ctx, p } = await fresh()
  await p.goto(B, { waitUntil: 'networkidle' })
  await p.evaluate(() => {
    const now = new Date().toISOString()
    localStorage.setItem('pl_properties', JSON.stringify([{ id: 'p1', name: 'Import Target', type: 'Real Estate - Apartment / Flat', created_at: now }]))
    for (const k of ['pl_expenses', 'pl_income', 'pl_documents']) localStorage.setItem(k, '[]')
  })
  const NL = String.fromCharCode(10)
  const files = [
    ['empty.csv', ''],
    ['headers-only.csv', 'date,amount,category' + NL],
    ['ragged.csv', 'date,amount' + NL + '2026-01-01' + NL + ',,,,,' + NL + '"unclosed'],
    ['huge-number.csv', 'date,amount,category' + NL + '2026-01-01,1e308,Utilities' + NL],
    ['formula.csv', 'date,amount,category' + NL + '2026-01-01,=1+1,SUSPECT' + NL],
    ['not-really.csv', 'binary rubbish'],
    ['backup.json', '{"version":1,"properties":"not an array","expenses":{"nope":true}}'],
    ['backup-deep.json', JSON.stringify({ version: 1, properties: [{ name: 'x'.repeat(5000) }], expenses: [{ amount: 1e308 }] })],
    ['tally.xml', '<ENVELOPE><BODY><unclosed>'],
  ]
  for (const [name, body] of files) {
    const before = errs.length
    await p.goto(`${B}/import`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(600)
    const accept = name.endsWith('.json') ? 'input[accept="application/json,.json"]'
      : name.endsWith('.xml') ? 'input[accept*="xml"]'
      : 'input[type=file]'
    const input = p.locator(accept).first()
    if (!(await input.count())) { ok(`${name}: an input exists for it`, false, 'no matching file input'); continue }
    await input.setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(body) }).catch(() => {})
    await p.waitForTimeout(1600)
    const t = await p.locator('body').innerText()
    ok(`${name} does not take the page down`, errs.length === before && t.length > 50, errs.slice(before).join(' / '))
    const stored = await rows(p, 'pl_expenses')
    const poisoned = stored.some((r) => !Number.isFinite(Number(r.amount)) || Number(r.amount) > 1e15)
    ok(`${name} puts nothing unusable in the ledger`, !poisoned, JSON.stringify(stored.map((r) => r.amount)))
  }
  await ctx.close()
}

// -- 11. Dates at the edges --
console.log('\n== DATES NOBODY MEANS ==')
{
  const { ctx, p } = await fresh()
  await p.goto(B, { waitUntil: 'networkidle' })
  await p.evaluate(() => {
    const now = new Date().toISOString()
    localStorage.setItem('pl_properties', JSON.stringify([{ id: 'p1', name: 'Dated', type: 'Real Estate - Apartment / Flat', created_at: now }]))
    localStorage.setItem('pl_expenses', JSON.stringify([
      { id: 'x1', property_id: 'p1', date: '0001-01-01', amount: 100, category: 'Other', status: 'paid' },
      { id: 'x2', property_id: 'p1', date: '9999-12-31', amount: 200, category: 'Other', status: 'paid' },
      { id: 'x3', property_id: 'p1', date: 'not-a-date', amount: 300, category: 'Other', status: 'paid' },
      { id: 'x4', property_id: 'p1', date: '', amount: 400, category: 'Other', status: 'unpaid', due_date: 'rubbish' },
      { id: 'x5', property_id: 'p1', date: '2026-02-30', amount: 500, category: 'Other', status: 'paid' }]))
    localStorage.setItem('pl_income', '[]'); localStorage.setItem('pl_documents', '[]')
  })
  const before = errs.length
  for (const r of ['/', '/expenses', '/bills', '/reports', '/exports', '/invoices']) {
    await p.goto(`${B}${r}`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(600)
    const t = await main(p)
    ok(`${r} survives dates at the edges`,
      errs.length === before && !/Invalid Date|NaN/.test(t),
      t.match(/.{0,50}(Invalid Date|NaN).{0,40}/)?.[0] || errs.slice(before).join(' / '))
  }
  await ctx.close()
}

console.log(`\n${pass} passed, ${fail} failed`)
console.log('page errors seen:', errs.length ? errs.slice(0, 6) : 'none')
await b.close()
if (fail) process.exitCode = 1
