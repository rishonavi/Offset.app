// The Personal page, and the figure at the top of it.
//
// Three numbers sat there — spent, budget, remaining — and "remaining"
// subtracted every rupee of the month from a budget that covered two categories
// out of six. Somebody who had budgeted groceries and nothing else, and who
// then paid their rent, was shown "Remaining −₹48,700": a frightening number
// describing nothing, because almost none of that spending was ever inside the
// plan it was being measured against.
//
// Two apps worth copying here — EveryDollar and DollarWise — build their whole
// interface on one spine: a single figure at the top answering "am I all
// right?", and planned, spent and left stated over the same set of categories.
// This suite is that spine, on screen.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 1100 }, serviceWorkers: 'block' })
const p = await ctx.newPage(); p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 160)) })
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('ERR_FAILED') && !t.includes('404')) errs.push('CONSOLE ' + t.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
p.on('dialog', (d) => d.accept())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const main = () => p.locator('#main-content').innerText()

// The stat cards are label-above-figure, CSS-uppercased.
const stat = async (label) => {
  const t = await main()
  const m = new RegExp(`${label}\\s*\\n\\s*₹([\\d,.]+)`, 'i').exec(t)
  return m ? Number(m[1].replace(/,/g, '')) : null
}

const seed = (budgets) => p.evaluate((budgetList) => {
  localStorage.clear()
  const now = new Date()
  const m = now.toISOString().slice(0, 7)
  const day = (d) => `${m}-${String(d).padStart(2, '0')}`
  for (const k of ['pl_expenses', 'pl_income', 'pl_documents', 'pl_properties']) localStorage.setItem(k, '[]')
  // Six categories of ordinary spending, of which rent is by far the largest.
  const spend = [['Groceries', 12400], ['Rent', 35000], ['Transport', 4200],
    ['Eating out', 6800], ['Utilities', 3100], ['Health', 2200]]
  localStorage.setItem('pl_personal_expenses', JSON.stringify(spend.map(([category, amount], i) => ({
    id: `pe${i}`, category, amount, date: day(3 + i * 2), note: '', method: 'UPI', created_at: now.toISOString(),
  }))))
  localStorage.setItem('pl_personal_budgets', JSON.stringify(budgetList.map(([category, monthly_limit], i) => ({
    id: `b${i}`, category, monthly_limit,
  }))))
}, budgets)

const open = async () => {
  await p.goto(`${B}/personal`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(900)
  return main()
}

await p.goto(B, { waitUntil: 'domcontentloaded' })

console.log('\n── A BUDGET ON ONE CATEGORY SAYS NOTHING ABOUT THE OTHERS ──')
// The exact shape that produced the nonsense.
await seed([['Groceries', 10000]])
let t = await open()
ok('the page opens', /Personal/.test(t), t.slice(0, 300).replace(/\n/g, ' | '))
const planned = await stat('PLANNED')
const spentOfPlan = await stat('SPENT OF THAT')
ok('the plan is what was budgeted', planned === 10000, String(planned))
// Not ₹63,700, which is what the whole month came to.
ok('and spent-of-it counts only what fell inside the plan', spentOfPlan === 12400, String(spentOfPlan))
ok('which is not the whole month', spentOfPlan !== 63700, String(spentOfPlan))
// The headline figure, which used to read −₹48,700.
const over = await stat('OVER BUDGET')
ok('so the overspend is small and true', over === 2400, String(over))
ok('and nothing on the page claims fifty thousand of it', !/48,700|53,700/.test(t),
  t.slice(0, 900).replace(/\n/g, ' | '))
// What fell outside the plan is real money and gets its own sentence.
ok('the rest is reported separately', /₹51,300\b[^\n]*no budget/.test(t.replace(/\n/g, ' ')),
  t.slice(0, 1200).replace(/\n/g, ' | '))
ok('and says the figures above do not cover it', /say nothing about it/.test(t),
  t.slice(0, 1200).replace(/\n/g, ' | '))

console.log('\n── EVERY CATEGORY IS LISTED, BUDGETED OR NOT ──')
// Listing only budgeted categories hid exactly the spending somebody would want
// to bring into the plan.
for (const c of ['Groceries', 'Rent', 'Transport', 'Eating out', 'Utilities', 'Health']) {
  ok(`${c} is on the list`, t.includes(c), '')
}
ok('the unbudgeted ones offer a way in', /Set a budget/.test(t), t.slice(0, 1200).replace(/\n/g, ' | '))
ok('and say plainly that they have none', /No budget set/.test(t), t.slice(0, 1200).replace(/\n/g, ' | '))

console.log('\n── WITH EVERYTHING BUDGETED, THE THREE FIGURES AGREE ──')
await seed([['Groceries', 10000], ['Rent', 35000], ['Transport', 5000],
  ['Eating out', 4000], ['Utilities', 3500], ['Health', 5000]])
t = await open()
ok('the plan is the sum of the budgets', (await stat('PLANNED')) === 62500, String(await stat('PLANNED')))
ok('spent of it is the whole month', (await stat('SPENT OF THAT')) === 63700, String(await stat('SPENT OF THAT')))
ok('and the overspend is the difference', (await stat('OVER BUDGET')) === 1200, String(await stat('OVER BUDGET')))
// Nothing falls outside, so the sentence about it goes.
ok('nothing is said about unbudgeted spending', !/no budget, so the figures above/.test(t),
  t.slice(0, 1200).replace(/\n/g, ' | '))

console.log('\n── UNDER BUDGET LEADS WITH WHAT IS LEFT ──')
await seed([['Groceries', 20000], ['Rent', 40000], ['Transport', 8000],
  ['Eating out', 9000], ['Utilities', 5000], ['Health', 6000]])
t = await open()
ok('the headline is what is left', /LEFT TO SPEND/i.test(t), t.slice(0, 600).replace(/\n/g, ' | '))
ok('and not an overspend', !/OVER BUDGET/i.test(t), t.slice(0, 600).replace(/\n/g, ' | '))
ok('with the amount still to spend', (await stat('LEFT TO SPEND')) === 24300, String(await stat('LEFT TO SPEND')))

console.log('\n── HITTING THE NUMBER EXACTLY IS NOT A FAILURE ──')
// Spending precisely the budget reported "Over budget by ₹0" in red.
await seed([['Rent', 35000]])
t = await open()
ok('a category spent exactly to its budget says so', /Budget used up, nothing over/.test(t),
  t.slice(0, 1400).replace(/\n/g, ' | '))
ok('and is not called an overspend by zero', !/Over budget by ₹0\b/.test(t),
  t.slice(0, 1400).replace(/\n/g, ' | '))
// The control: a rupee over really is over.
await seed([['Rent', 34999]])
t = await open()
ok('while a rupee over is over', /Over budget by ₹1\b/.test(t), t.slice(0, 1400).replace(/\n/g, ' | '))

console.log('\n── AND A BUDGET SOMEBODY SET IS A BUDGET ──')
// The totals filtered through a fixed category list, so a budget against
// anything not on it stopped counting in the header while still drawing its own
// bar below — six budgets on screen and two in the sum. "Rent" is not on that
// list, which is why this fixture uses it throughout.
await seed([['Rent', 30000]])
t = await open()
ok('a budget on an unlisted category counts', (await stat('PLANNED')) === 30000, String(await stat('PLANNED')))
ok('and its spending counts with it', (await stat('SPENT OF THAT')) === 35000, String(await stat('SPENT OF THAT')))
// Scoped to the Rent row in the budgets card. Matching "₹35,000" and
// "no budget" anywhere on a flattened page finds them in two different cards
// and passes — or fails — for reasons nothing to do with Rent.
const card = t.slice(t.indexOf('Category budgets'), t.indexOf('Spending by category'))
const rentRow = card.slice(card.indexOf('Rent'), card.indexOf('Groceries'))
ok('so it is shown as budgeted, not as unbudgeted spending', /Budget this month/.test(rentRow) && !/No budget set/.test(rentRow),
  rentRow.replace(/\n/g, ' | '))
ok('and the categories with no budget still say so', /No budget set/.test(card),
  card.slice(0, 500).replace(/\n/g, ' | '))

console.log('\n── AND STORAGE FROM AN OLDER VERSION DOES NOT TAKE THE PAGE DOWN ──')
// Budgets are read from browser storage, which can hold whatever an older
// build wrote. A shape nobody expected threw `find is not a function` and put
// the whole page behind "Something went wrong" with no way back.
await p.evaluate(() => {
  localStorage.setItem('pl_personal_budgets', JSON.stringify({ Groceries: 10000 }))
})
t = await open()
ok('a page that cannot read its budgets still opens', !/Something went wrong/.test(t),
  t.slice(0, 400).replace(/\n/g, ' | '))
ok('and still shows the spending', /Groceries/.test(t), t.slice(0, 900).replace(/\n/g, ' | '))

for (const e of errs) ok(e, false)
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
