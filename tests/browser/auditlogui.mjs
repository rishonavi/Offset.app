// The audit log, on screen.
//
// The trail has been written since the corporate layer existed: who, what
// action, and — for an edit — which fields moved and what they moved from. The
// card that showed it rendered the actor and a phrase and stopped, so it read
// "Deepak edited a day's muster" forty times and settled nothing. The `detail`
// the store had gone to the trouble of computing was written and never read.
//
// Forty was also the whole of it: `listAudit` was called with `limit: 40` and
// there was no way to ask for more, so the cap was invisible and the log
// looked complete when it was not.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 1100 }, serviceWorkers: 'block', acceptDownloads: true })
const p = await ctx.newPage(); p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 160)) })
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('ERR_FAILED') && !t.includes('404')) errs.push('CONSOLE ' + t.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const card = () => p.locator('#main-content').locator('section,div').filter({ hasText: 'Who changed what' }).last().innerText()
// Everything below the count line. The card's own text includes the person
// filter's `<option>` list, which holds every name in the trail — so a check
// for "deepak is gone" passes or fails on the dropdown rather than the rows.
const log = async () => {
  const t = await card()
  const m = /\n\s*\d+ (?:of \d+|entr(?:y|ies))\s*\n/.exec(t)
  return m ? t.slice(m.index + m[0].length) : t
}

// Ninety events, so the cap is reachable, plus five with known shapes.
const seed = () => p.evaluate(() => {
  localStorage.clear()
  const now = new Date()
  const iso = (mins) => new Date(now.getTime() - mins * 60000).toISOString()
  for (const k of ['pl_expenses', 'pl_income', 'pl_documents', 'pl_properties']) localStorage.setItem(k, '[]')
  localStorage.setItem('pl_corp_entities', JSON.stringify([{ id: 'e1', name: 'Navi Builders Pvt Ltd', registration: '', gstin: '', currency: 'INR', fy_start_month: 4, created_at: iso(9000) }]))
  localStorage.setItem('pl_corp_members', JSON.stringify([{ id: 'm1', entity_id: 'e1', user_id: 'local-user', email: 'you@navi.example', role: 'owner', department_id: null, created_at: iso(9000) }]))
  localStorage.setItem('pl_corp_active', 'e1')
  const ev = (id, mins, email, action, summary, detail) => ({
    id, entity_id: 'e1', actor_id: 'u', actor_email: email, action, target_id: 't', summary, detail, created_at: iso(mins),
  })
  // A day apart each, so ninety of them cover roughly three months.
  const filler = Array.from({ length: 90 }, (_, i) =>
    ev('f' + i, 1440 * (i + 2), 'filler@navi.example', 'measurement.create', 'measured work done', { qty: 60 }))
  localStorage.setItem('pl_corp_audit', JSON.stringify([
    ...filler,
    ev('a1', 300, 'deepak@navi.example', 'muster.create', 'recorded a day’s muster', { trade: 'mason', headcount: 14 }),
    ev('a2', 240, 'deepak@navi.example', 'muster.update', 'edited a day’s muster', { rate: [550, 620], headcount: [14, 12] }),
    ev('a3', 180, 'priya@navi.example', 'rabill.approve', 'approved a running account bill', { contractor: 'Shree Constructions', amount: 1840000 }),
    ev('a4', 90, 'priya@navi.example', 'entity.update', 'edited a company', { name: ['Navi Builders', 'Navi Builders Pvt Ltd'], pt_slabs: 'changed', pf_registered: [null, true] }),
    ev('a5', 20, 'deepak@navi.example', 'material.delete', 'removed a material', { name: 'TMT 12mm', sku: 'STL-12' }),
  ]))
})

await p.goto(B, { waitUntil: 'domcontentloaded' })
await seed()
await p.goto(`${B}/activity`, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)

console.log('\n── IT SAYS WHAT CHANGED, NOT ONLY THAT SOMETHING DID ──')
let t = await log()
ok('an edit names the field', /rate/.test(t), t.slice(0, 400).replace(/\n/g, ' | '))
ok('and what it was before', /550/.test(t), t.slice(0, 400).replace(/\n/g, ' | '))
ok('and what it is now', /620/.test(t), t.slice(0, 400).replace(/\n/g, ' | '))
// The control for all three: the old card rendered the actor and the phrase,
// both of which are still here. If the phrase alone were passing these, the
// figures would be absent.
ok('the phrase is there too, so the figures are the new part', /edited a day/.test(t))
ok('a long number is grouped the Indian way', /18,40,000/.test(t), (/1[,\d]*840[,\d]*/.exec(t) || [''])[0])
ok('a field the store would not print says so rather than dumping JSON',
  /professional tax slabs\s*changed/.test(t) && !/\{"/.test(t), (/professional tax[^\n]*/.exec(t) || [''])[0])
ok('an unset flag turning true reads as nothing → yes', /provident fund registration\s*nothing\s*→?\s*yes/.test(t.replace(/\s+/g, ' ')),
  (/provident fund[^\n]*/.exec(t) || [''])[0])
// A create is not a move, so it must not pretend one.
ok('a delete lists what identified the row', /TMT 12mm/.test(t) && /STL-12/.test(t), (/removed a material[^\n]*\n[^\n]*/.exec(t) || [''])[0])

console.log('\n── AND WHEN, TO THE MINUTE ──')
// Six edits to one rate on one afternoon are six lines with the same date, in
// an order nobody can see.
ok('the time is shown beside the date', /\d{1,2}:\d{2}/.test(t), (/\d{1,2}:\d{2}[^\n]*/.exec(t) || ['no time'])[0])

console.log('\n── NARROWED BY PERSON ──')
await p.locator('select[aria-label="Filter the log by person"]').selectOption('priya@navi.example')
await p.waitForTimeout(400)
t = await log()
ok('only that person is left', /priya@navi.example/.test(t) && !/deepak@navi.example/.test(t), t.slice(0, 300).replace(/\n/g, ' | '))
const counted = await card()
ok('and the count says so rather than the page going quiet', /\d+ of \d+/.test(counted), (/\d+ of \d+/.exec(counted) || ['no count'])[0])

console.log('\n── AND BY WHAT WAS DONE ──')
await p.locator('select[aria-label="Filter the log by person"]').selectOption('')
await p.locator('select[aria-label="Filter the log by what was done"]').selectOption('delete')
await p.waitForTimeout(400)
t = await log()
ok('only deletions are left', /removed a material/.test(t) && !/recorded a day/.test(t), t.slice(0, 300).replace(/\n/g, ' | '))
// The control: the filter is doing the work, not the fixture happening to hold
// one kind of event.
await p.locator('select[aria-label="Filter the log by what was done"]').selectOption('')
await p.waitForTimeout(400)
t = await log()
ok('and clearing it brings the rest back', /recorded a day/.test(t))

console.log('\n── AND BY SEARCH, ACROSS THE CHANGES THEMSELVES ──')
// Not just the phrase: "Shree Constructions" appears only inside the recorded
// detail, which is the half that was never on screen.
await p.locator('input[aria-label="Search the audit log"]').fill('Shree')
await p.waitForTimeout(500)
t = await log()
ok('a word from the detail finds its event', /approved a running account bill/.test(t), t.slice(0, 300).replace(/\n/g, ' | '))
ok('and nothing else', !/removed a material/.test(t), t.slice(0, 300).replace(/\n/g, ' | '))
await p.locator('input[aria-label="Search the audit log"]').fill('')
await p.waitForTimeout(400)

console.log('\n── AND BY WHEN ──')
// The question that brings somebody to this page is usually "what happened on
// the 4th", not "what happened ever".
const today = new Date()
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
await p.locator('input[aria-label="From date"]').fill(ymd(today))
await p.waitForTimeout(500)
const fromToday = await card()
ok('from today leaves only today', /\d+ of 95/.test(fromToday), (/\d+ of \d+/.exec(fromToday) || ['no count'])[0])
t = await log()
ok('which is the recent handful, not the filler', /removed a material/.test(t) && !/measured work done/.test(t),
  t.slice(0, 200).replace(/\n/g, ' | '))
// Both ends inclusive: the same day in both boxes means that day.
await p.locator('input[aria-label="To date"]').fill(ymd(today))
await p.waitForTimeout(500)
ok('and the same day in both boxes still shows it', /removed a material/.test(await log()),
  (await log()).slice(0, 200).replace(/\n/g, ' | '))
// The control: a range that ended yesterday must not contain today's events.
const yest = new Date(today.getTime() - 86400000)
await p.locator('input[aria-label="From date"]').fill(ymd(yest))
await p.locator('input[aria-label="To date"]').fill(ymd(yest))
await p.waitForTimeout(500)
ok('a range that ends before them excludes them', !/removed a material/.test(await log()),
  (await log()).slice(0, 200).replace(/\n/g, ' | '))

console.log('\n── AND IT REMEMBERS WHAT YOU WERE LOOKING AT ──')
// Chasing one person across a fortnight should not mean setting the same three
// filters on every visit.
await p.locator('select[aria-label="Filter the log by person"]').selectOption('priya@navi.example')
await p.waitForTimeout(400)
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(900)
ok('the person survives a reload',
  (await p.locator('select[aria-label="Filter the log by person"]').inputValue()) === 'priya@navi.example')
ok('and so do the dates', (await p.locator('input[aria-label="From date"]').inputValue()) === ymd(yest))
// Remembered filters have to be visibly undoable, or the log looks empty a
// week later for no apparent reason.
await p.locator('#main-content').getByRole('button', { name: /Clear filters/i }).click()
await p.waitForTimeout(500)
ok('and there is a way back to everything',
  (await p.locator('select[aria-label="Filter the log by person"]').inputValue()) === ''
  && (await p.locator('input[aria-label="From date"]').inputValue()) === '')
ok('which brings the whole trail back', /95 entr/.test(await card()), (/\d+ entr[^\n]*/.exec(await card()) || ['no count'])[0])

console.log('\n── AND IT DOES NOT STOP AT FORTY ──')
const all = await card()
ok('the count knows about all ninety-five', /95 entr/.test(all), (/\d+ entr[^\n]*/.exec(all) || ['no count'])[0])
const before = (await log()).split('\n').length
await p.locator('#main-content').getByRole('button', { name: /Show \d+ more/ }).click()
await p.waitForTimeout(400)
ok('and asking for more gives more', (await log()).split('\n').length > before,
  `${before} → ${(await log()).split('\n').length}`)

console.log('\n── AND LEAVES WITH YOU ──')
const [download] = await Promise.all([
  p.waitForEvent('download', { timeout: 15000 }).catch(() => null),
  p.locator('button[aria-label="Download the audit log"]').click(),
])
ok('the log downloads', Boolean(download), 'no download fired')
if (download) {
  ok('as a csv', /\.csv$/.test(download.suggestedFilename()), download.suggestedFilename())
  const { readFileSync } = await import('node:fs')
  const body = readFileSync(await download.path(), 'utf8')
  ok('with a header row', /^"When","Who","What","Changed"/.test(body), body.slice(0, 80))
  ok('and the changes in it, not just the phrases', /550/.test(body) && /620/.test(body), body.slice(0, 400))
  ok('and every event, not the page you can see', body.trim().split('\n').length === 96,
    String(body.trim().split('\n').length))
}

ok('and nothing threw', errs.length === 0, errs.join(' ; '))
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
