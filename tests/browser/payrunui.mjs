// A month that was run, on screen.
//
// The figure this is about is last March's wage bill. Until now every month was
// computed from the employees as they stand today, so giving somebody a raise
// in June made March more expensive — and an auditor asking what was paid got a
// different answer depending on when they asked.
//
// So the assertion that matters is near the end: record a month, give somebody
// a raise, and the recorded month must not move.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 }, serviceWorkers: 'block' })
const p = await ctx.newPage(); p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 160)) })
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('ERR_FAILED') && !t.includes('404')) errs.push('CONSOLE ' + t.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
p.on('dialog', (d) => d.accept())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const ls = (k) => p.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), k)
const live = async (k) => (await ls(k)).filter((r) => !r.deleted_at)
const main = () => p.locator('#main-content').innerText()
const ENT = 'ent-pay-1'
// Payroll is the last of the seven tabs.
const payrollTab = async () => {
  await p.locator('#main-content button[aria-pressed]').nth(6).click()
  await p.waitForTimeout(600)
}
const btn = (name) => p.locator('#main-content button', { hasText: name }).first()
// The stat labels are CSS-uppercased and sit a blank line above their figure,
// so this reads `GROSS` followed by a rupee amount. The table's own GROSS
// heading is tab-separated and cannot match.
const grossOnScreen = async () => ((await main()).match(/GROSS\s*\n\s*(\u20b9[\d,.]+)/i) || [])[1] || ''

await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate((ent) => {
  localStorage.clear()
  const born = new Date(); born.setFullYear(born.getFullYear() - 1)
  for (const k of ['pl_properties', 'pl_expenses', 'pl_income', 'pl_documents']) localStorage.setItem(k, '[]')
  localStorage.setItem('pl_corp_entities', JSON.stringify([
    { id: ent, name: 'Navi Builders Pvt Ltd', currency: 'INR', fy_start_month: 4, created_at: born.toISOString() },
  ]))
  localStorage.setItem('pl_corp_members', JSON.stringify([
    { id: 'm1', entity_id: ent, user_id: 'local-user', email: '', role: 'owner', department_id: null, created_at: new Date().toISOString() },
  ]))
  localStorage.setItem('pl_corp_employees', JSON.stringify([
    { id: 'emp-1', entity_id: ent, name: 'R. Yadav', code: 'RY01', email: '', department_id: null,
      pay: { basic: 40000, hra: 16000, conveyance: 0, medical: 0, special: 0, other: 0 },
      pan: '', uan: '', joined_on: '2025-04-01', active: true, created_at: born.toISOString() },
    { id: 'emp-2', entity_id: ent, name: 'S. Shaikh', code: 'SS02', email: '', department_id: null,
      pay: { basic: 25000, hra: 10000, conveyance: 0, medical: 0, special: 0, other: 0 },
      pan: '', uan: '', joined_on: '2025-04-01', active: true, created_at: born.toISOString() },
  ]))
  localStorage.setItem('pl_corp_payroll_runs', '[]')
  localStorage.setItem('pl_corp_active', ent)
}, ENT)

console.log('\n── A MONTH NOBODY HAS RUN SAYS SO ──')
await p.goto(`${B}/operations?tab=payroll`, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
let t = await main()
ok('the payroll is on screen', /payslips/i.test(t), t.slice(0, 300).replace(/\n/g, ' | '))
ok('both people are on it', /R\. Yadav/.test(t) && /S\. Shaikh/.test(t))
ok('it is flagged as not run', /not run/i.test(t), t.slice(0, 600).replace(/\n/g, ' | '))
// The honesty that has to survive: an unrecorded month is arithmetic on today's
// salaries, and the screen says which kind of number it is showing.
ok('and says it is worked out from today’s salaries', /today.s salaries/i.test(t),
  t.slice(0, 800).replace(/\n/g, ' | '))
ok('there is nothing recorded yet', (await live('pl_corp_payroll_runs')).length === 0)
const before = await grossOnScreen()
ok('a gross is shown', /\d/.test(before), before)

console.log('\n── RECORDING IT ──')
await btn('Record this month').click()
await p.waitForTimeout(1000)
const runs = await live('pl_corp_payroll_runs')
ok('one run is kept', runs.length === 1, String(runs.length))
ok('for the month on screen', /^\d{4}-\d{2}$/.test(runs[0]?.period || ''), runs[0]?.period)
ok('as a draft', runs[0]?.status === 'draft', runs[0]?.status)
ok('with a payslip each', runs[0]?.slips?.length === 2, String(runs[0]?.slips?.length))
// The frozen name is the whole reason a run is kept rather than recomputed.
ok('and each slip names the person', runs[0]?.slips?.every((s) => s.name),
  JSON.stringify(runs[0]?.slips?.map((s) => s.name)))
t = await main()
ok('the screen now calls it a draft', /draft/i.test(t), t.slice(0, 600).replace(/\n/g, ' | '))
ok('and says a later raise will not change it', /does not change them/i.test(t),
  t.slice(0, 800).replace(/\n/g, ' | '))
ok('the gross did not move on recording it', (await grossOnScreen()) === before,
  `${await grossOnScreen()} vs ${before}`)

console.log('\n── A RAISE DOES NOT REACH IT ──')
// The failure this exists to prevent, done the way it actually happens.
await p.evaluate(() => {
  const list = JSON.parse(localStorage.getItem('pl_corp_employees'))
  list[0].pay.basic = 60000
  list[0].pay.hra = 24000
  localStorage.setItem('pl_corp_employees', JSON.stringify(list))
})
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(900)
ok('the recorded month is the same as it was', (await grossOnScreen()) === before,
  `${await grossOnScreen()} vs ${before}`)
// The control: a month nobody recorded does move, which is exactly why the
// record has to exist.
const other = new Date(); other.setMonth(other.getMonth() - 1)
const otherPeriod = other.toISOString().slice(0, 7)
await p.locator('#main-content input[type=month]').first().fill(otherPeriod)
await p.waitForTimeout(800)
t = await main()
ok('last month is not recorded', /not run/i.test(t), t.slice(0, 600).replace(/\n/g, ' | '))
const unrecorded = await grossOnScreen()
ok('and shows the bigger figure, because the raise reaches it', unrecorded !== before,
  `${unrecorded} vs ${before}`)

console.log('\n── APPROVING IT CLOSES THE MONTH ──')
await p.locator('#main-content input[type=month]').first().fill((await live('pl_corp_payroll_runs'))[0].period)
await p.waitForTimeout(800)
await btn('Approve').click()
await p.waitForTimeout(1000)
ok('it is approved', (await live('pl_corp_payroll_runs'))[0]?.status === 'approved',
  (await live('pl_corp_payroll_runs'))[0]?.status)
ok('and records who approved it', Boolean((await live('pl_corp_payroll_runs'))[0]?.approved_at))
t = await main()
ok('the screen says so', /approved/i.test(t), t.slice(0, 600).replace(/\n/g, ' | '))
ok('and says the month no longer changes', /no longer changes/i.test(t), t.slice(0, 800).replace(/\n/g, ' | '))
// A rule enforced only by a disabled button is not a rule, but the button
// should be disabled too.
ok('running it again is not offered', await btn('Run again').isDisabled())

console.log('\n── AND MARKING IT PAID CLOSES IT FOR GOOD ──')
await btn('Mark paid').click()
await p.waitForTimeout(1000)
const done = (await live('pl_corp_payroll_runs'))[0]
ok('it is paid', done?.status === 'paid', done?.status)
ok('with the date it was paid', Boolean(done?.paid_at))
t = await main()
ok('nothing offers to approve it again', !/\bApprove\b/.test(t), t.slice(0, 700).replace(/\n/g, ' | '))
ok('nor to mark it paid twice', !/Mark paid/.test(t))
ok('and it is still one run, not three', (await live('pl_corp_payroll_runs')).length === 1)

console.log('\n── SOMEBODY LEAVING DOES NOT ERASE THEM FROM IT ──')
// A slip holding only an employee_id stops meaning anything the day the row
// goes. This is what the frozen name is for.
await p.evaluate(() => {
  const list = JSON.parse(localStorage.getItem('pl_corp_employees'))
  localStorage.setItem('pl_corp_employees', JSON.stringify(list.filter((e) => e.id !== 'emp-1')))
})
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(900)
t = await main()
ok('the person who left is still on the recorded month', /R\. Yadav/.test(t),
  t.slice(0, 900).replace(/\n/g, ' | '))
ok('and the wage bill has not dropped', (await grossOnScreen()) === before,
  `${await grossOnScreen()} vs ${before}`)
ok('the trail records the run', (await ls('pl_corp_audit')).some((a) => /payroll run/.test(a.action || '')),
  JSON.stringify((await ls('pl_corp_audit')).map((a) => a.action).slice(-4)))

for (const e of errs) ok(e, false)
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
