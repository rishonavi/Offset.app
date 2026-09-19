// The dashboard of somebody who has started but not finished.
//
// A new account that had added one asset and no costs got five chart cards
// stacked down the page, each collapsed to a line saying it had nothing to
// show — "No costs logged in the last twelve months", "No income or costs in
// the last twelve months", "No costs to break down yet", "No costs booked to
// an asset yet", and then "No costs to break down yet" again. Five apologies
// for the same absence, underneath a checklist that had already said what to
// do about it. It reads like an app that is broken rather than one that is
// empty.
//
// EveryDollar and DollarWise both do the opposite: until there is something to
// plot, the space belongs to the one instruction that moves you forward. So the
// charts stay away while the ledger is empty, and every one of them comes back
// — including the ones still empty — the moment a single figure exists, because
// then "nothing booked to an asset yet" is telling you something you can act on
// rather than repeating the page.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 1100 }, serviceWorkers: 'block' })
const p = await ctx.newPage(); p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 160)) })
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('ERR_FAILED') && !t.includes('404')) errs.push('CONSOLE ' + t.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const main = () => p.locator('#main-content').innerText()

// One asset, so the page is the real dashboard rather than the welcome screen,
// and whatever costs and rent the case wants.
const seed = (costs, rents = []) => p.evaluate(({ rows, rent }) => {
  localStorage.clear()
  const now = new Date()
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-10`
  for (const k of ['pl_documents', 'pl_personal_expenses', 'pl_personal_budgets']) {
    localStorage.setItem(k, '[]')
  }
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'p1', name: 'Flat in Powai', kind: 'property', value: 8500000, created_at: now.toISOString() },
    { id: 'p2', name: 'Shop in Thane', kind: 'property', value: 4200000, created_at: now.toISOString() },
  ]))
  localStorage.setItem('pl_expenses', JSON.stringify(rows.map((amount, i) => ({
    id: `e${i}`, property_id: 'p1', category: 'Repairs', amount, date: iso, created_at: now.toISOString(),
  }))))
  localStorage.setItem('pl_income', JSON.stringify(rent.map((amount, i) => ({
    id: `r${i}`, property_id: 'p1', source: 'Rent', amount, date: iso, status: 'received', created_at: now.toISOString(),
  }))))
}, { rows: costs, rent: rents })

const open = async () => {
  await p.goto(B, { waitUntil: 'networkidle' })
  await p.waitForTimeout(900)
  return main()
}

const CHARTS = [
  'Spending over the last 12 months',
  'Income vs expenses (last 12 months)',
  'Spending by category',
  'Spending by property',
]
const seen = (t) => CHARTS.filter((c) => t.includes(c))

await p.goto(B, { waitUntil: 'domcontentloaded' })

console.log('\n── AN ASSET AND NOTHING SPENT ON IT ──')
await seed([])
let t = await open()
ok('the page is the dashboard, not the welcome screen', /Dashboard/.test(t), t.slice(0, 300).replace(/\n/g, ' | '))
ok('and it knows the assets are there', /2 ASSETS|NET POSITION/i.test(t), t.slice(0, 700).replace(/\n/g, ' | '))
ok('no chart card is drawn', seen(t).length === 0, seen(t).join(' / '))
ok('and no card apologises for having nothing', !/No costs to break down yet|No costs logged in the last/.test(t),
  (/No costs[^\n]*/.exec(t) || [''])[0])
// The checklist keeps the page, because that is the thing worth doing next.
ok('the step that moves you forward is still there', /Log a cost against it|Getting started/i.test(t),
  t.slice(0, 900).replace(/\n/g, ' | '))
// Recent activity stays: it is one line, it is named for what it will hold,
// and it is the only card that is about the ledger rather than a chart of it.
ok('and recent activity still says what it is waiting for', /Costs will appear here as you log them/.test(t),
  t.slice(-700).replace(/\n/g, ' | '))

console.log('\n── ONE COST, AND EVERY CHART COMES BACK ──')
await seed([18400])
t = await open()
ok('all four chart cards return', seen(t).length === 4, 'missing: ' + CHARTS.filter((c) => !t.includes(c)).join(' / '))
ok('the cost is on the page', /18,400/.test(t), t.slice(0, 900).replace(/\n/g, ' | '))

console.log('\n── RENT AND NO COSTS: THE CHARTS COME BACK, THREE OF THEM EMPTY ──')
// The control for the first case, and the reason the gate is the whole ledger
// rather than each chart's own data. Money has moved, so the page has something
// to say — but three of the four charts are about spending and nothing has been
// spent. Each of those still says so, which is what makes the silence in the
// first case the gate working rather than the sentences having been deleted.
await seed([], [42000])
t = await open()
ok('every chart card is drawn', seen(t).length === 4, 'missing: ' + CHARTS.filter((c) => !t.includes(c)).join(' / '))
ok('the one with data is not apologising', !/Income vs expenses \(last 12 months\)\s*\nNo /.test(t),
  (/Income vs expenses[^\n]*\n[^\n]*/.exec(t) || [''])[0])
ok('the spending trend says it has no costs', /No costs logged in the last twelve months/.test(t),
  (/No costs[^\n]*/.exec(t) || ['none found'])[0])
ok('and the breakdown says the same', /No costs to break down yet/.test(t),
  (/No costs to break[^\n]*/.exec(t) || ['none found'])[0])
ok('and the rent is on the page', /42,000/.test(t), t.slice(0, 900).replace(/\n/g, ' | '))

console.log('\n── FILTERING TO AN EMPTY ASSET IS A QUESTION, NOT AN EMPTY APP ──')
// The gate got this wrong first time round: it counted the *filtered* rows, so
// narrowing to the shop — which has cost nothing — hid every chart. But that is
// somebody asking "what has this one cost me?", and "nothing yet" is the answer.
// Making the cards vanish instead reads as a filter that broke.
await seed([18400])
await open()
await p.locator('select[aria-label="Filter dashboard by asset"]').selectOption('p2')
await p.waitForTimeout(900)
t = await main()
ok('the charts stay when a filter empties them', seen(t).length === 4,
  'missing: ' + CHARTS.filter((c) => !t.includes(c)).join(' / '))
ok('and say there is nothing booked to it', /No costs booked to an asset yet|No costs to break down yet|No costs logged/.test(t),
  (/No costs[^\n]*/.exec(t) || ['none found'])[0])
// The control: the other asset does have a cost, so the filter really did
// change what is on screen rather than silently doing nothing.
ok('the other asset\u2019s cost is no longer shown', !/18,400/.test(t), (/18,400[^\n]*/.exec(t) || [''])[0])

console.log('\n── THE GATE IS THE LEDGER, NOT THE ASSET ──')
// An asset with a value but no costs is still nothing to plot: the charts are
// about money in and out, and a valuation is neither.
await seed([])
t = await open()
ok('a valued asset alone does not bring the charts back', seen(t).length === 0, seen(t).join(' / '))
// 85,00,000 + 42,00,000, in the Indian grouping this app uses everywhere.
ok('though the portfolio value is still reported', /1,27,00,000/.test(t), t.slice(0, 900).replace(/\n/g, ' | '))

ok('and nothing threw', errs.length === 0, errs.join(' ; '))
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
