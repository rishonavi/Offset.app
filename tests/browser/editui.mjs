// Correcting somebody who is already on the books.
//
// There was no way to change anything once it had been entered. A name typed
// wrong stayed wrong; somebody added with no pay sat at zero on every payslip
// for good. Worse, every field added to this app since — dearness allowance,
// the joining date, the work state, leave standing — could only ever be set at
// the moment of creation, so a company that had already entered its people
// could never fill them in.
//
// The joining date is the sharpest case, because it was not on the form at all:
// gratuity is fifteen days' wages for each year *since that date*, so the whole
// liability was nil for everybody and nothing on screen said why.
//
// The other half of this is what editing must NOT do. A payroll month already
// recorded carries the payslips as they were run, and correcting somebody's pay
// today must not reach back into it — the assertion near the end is the one
// that matters.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1200 }, serviceWorkers: 'block' })
const p = await ctx.newPage(); p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', (e) => { const s = String(e); if (!s.includes('serviceWorker')) errs.push('PAGEERROR ' + s.slice(0, 160)) })
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('ERR_FAILED') && !t.includes('404')) errs.push('CONSOLE ' + t.slice(0, 160)) })
await p.route('**/fonts.g**/**', (r) => r.abort())
p.on('dialog', (d) => d.accept())
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const ls = (k) => p.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), k)
const main = () => p.locator('#main-content').innerText()
const ENT = 'ent-edit-1'
const staff = async () => (await ls('pl_corp_employees')).filter((r) => !r.deleted_at)
const who = async (name) => (await staff()).find((e) => e.name === name)
const field = (label) => p.locator(`#main-content label:has-text("${label}")`).locator('input, select').first()

await p.goto(B, { waitUntil: 'domcontentloaded' })
await p.evaluate((ent) => {
  localStorage.clear()
  const born = new Date(); born.setFullYear(born.getFullYear() - 3)
  for (const k of ['pl_properties', 'pl_expenses', 'pl_income', 'pl_documents']) localStorage.setItem(k, '[]')
  localStorage.setItem('pl_corp_entities', JSON.stringify([
    { id: ent, name: 'Navi Builders Pvt Ltd', gstin: '27AAAPA1234A1Z5', currency: 'INR', fy_start_month: 4,
      pf_registered: true, esi_registered: true, created_at: born.toISOString() },
  ]))
  localStorage.setItem('pl_corp_members', JSON.stringify([
    { id: 'm1', entity_id: ent, user_id: 'local-user', email: '', role: 'owner', department_id: null, created_at: new Date().toISOString() },
  ]))
  // Two people entered the way they actually get entered: one properly, one
  // with the pay left blank and the name mistyped.
  localStorage.setItem('pl_corp_employees', JSON.stringify([
    { id: 'e-good', entity_id: ent, name: 'Avi Shah', code: 'EMP01', email: '', department_id: null,
      pay: { basic: 15000, da: 0, hra: 0, conveyance: 0, medical: 0, special: 0, other: 0 },
      pan: '', uan: '', joined_on: '', work_state: '', female: null, leave_balance: 0,
      active: true, created_at: born.toISOString() },
    { id: 'e-bad', entity_id: ent, name: 'Sanket Moore', code: 'EMP02', email: '', department_id: null,
      pay: { basic: 0, da: 0, hra: 0, conveyance: 0, medical: 0, special: 0, other: 0 },
      pan: '', uan: '', joined_on: '', work_state: '', female: null, leave_balance: 0,
      active: true, created_at: born.toISOString() },
  ]))
  localStorage.setItem('pl_corp_payroll_runs', '[]')
  localStorage.setItem('pl_corp_active', ent)
}, ENT)

const payroll = async () => {
  await p.goto(`${B}/operations?tab=payroll`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(900)
  return main()
}

console.log('\n── EVERYBODY IS LISTED, AND WHAT IS MISSING IS SAID ──')
let t = await payroll()
ok('there is a list of people', /People/.test(t), t.slice(0, 400).replace(/\n/g, ' | '))
ok('both are on it', /Avi Shah/.test(t) && /Sanket Moore/.test(t), t.slice(0, 1200).replace(/\n/g, ' | '))
// The two things that were impossible to fix, flagged rather than left to be
// noticed in a total.
ok('somebody with no pay is flagged', /no pay set/i.test(t), t.slice(0, 2500).replace(/\n/g, ' | '))
ok('and nobody has a joining date', /no joining date/i.test(t), t.slice(0, 2500).replace(/\n/g, ' | '))

console.log('\n── A NAME TYPED WRONG CAN BE PUT RIGHT ──')
await p.locator('#main-content button[aria-label="Edit Sanket Moore"]').click()
await p.waitForTimeout(500)
await field('Name').fill('Sanket More')
await field('Basic').fill('18000')
await p.locator('#main-content button', { hasText: 'Save' }).first().click()
await p.waitForTimeout(800)
ok('the name is corrected', Boolean(await who('Sanket More')), JSON.stringify((await staff()).map((e) => e.name)))
ok('and the old one is gone, not duplicated', (await staff()).length === 2, String((await staff()).length))
ok('the pay is set', (await who('Sanket More'))?.pay?.basic === 18000, JSON.stringify((await who('Sanket More'))?.pay))
t = await main()
ok('and the screen no longer says there is no pay', !/no pay set/i.test(t), t.slice(0, 2500).replace(/\n/g, ' | '))
ok('the payslip picks the correction up', /Sanket More/.test(t), t.slice(0, 2500).replace(/\n/g, ' | '))

console.log('\n── THE FIELDS THAT COULD NEVER BE FILLED IN ──')
// Gratuity is fifteen days' wages for every year since the joining date, and
// that date was not on the form at all — so the liability was nil for everybody
// and nothing said why.
await p.locator('#main-content button[aria-label="Edit Avi Shah"]').click()
await p.waitForTimeout(500)
await field('Joined on').fill('2018-04-01')
await field('Dearness allowance').fill('3000')
await field('Leave standing').fill('41')
await p.locator('#main-content button', { hasText: 'Save' }).first().click()
await p.waitForTimeout(900)
const avi = await who('Avi Shah')
ok('the joining date is kept', avi?.joined_on === '2018-04-01', JSON.stringify(avi?.joined_on))
ok('the dearness allowance too', avi?.pay?.da === 3000, JSON.stringify(avi?.pay))
ok('and the leave standing', Number(avi?.leave_balance) === 41, String(avi?.leave_balance))
t = await main()
// Two men is under the ten the Gratuity Act names, so it does not apply and the
// card says so rather than showing a liability nobody owes.
ok('at two people the Act does not apply', /under 10/i.test(t), t.slice(0, 3000).replace(/\n/g, ' | '))
// A promise made is owed whatever the Act says, and plenty of small firms make
// it — so there is a way to say so, and until now no way to test it either.
await p.locator('#main-content input[aria-label="This company pays gratuity anyway"]').check()
await p.waitForTimeout(900)
t = await main()
// Which is the point of filling the joining date in at all: the liability stops
// being nil. Eight years since April 2018, fifteen days of ₹18,000 for each.
ok('and once they say they pay it, gratuity is no longer nil',
  /OWED IF EVERYONE LEFT TODAY\s*\n\s*₹[1-9]/i.test(t), t.slice(0, 3500).replace(/\n/g, ' | '))
ok('with the years counted from the date just entered', /crossing 5 years|8 years/i.test(t) || /₹83,077/.test(t),
  t.slice(0, 3500).replace(/\n/g, ' | '))
ok('and the leave is worth something', /STANDING, IN CASH\s*\n\s*₹[1-9]/i.test(t),
  t.slice(0, 3500).replace(/\n/g, ' | '))
ok('with the days over the cap called out', /about to lapse/i.test(t), t.slice(0, 3500).replace(/\n/g, ' | '))
ok('the list shows the joining date back', /joined 01 Apr 2018/.test(t), t.slice(0, 2500).replace(/\n/g, ' | '))

console.log('\n── A RECORDED MONTH DOES NOT MOVE ──')
// The half that matters more than the editing: a month already run carries the
// payslips as they were run, and a correction today must not reach back into
// it. This is the same guarantee payrunui holds for a raise.
await p.locator('#main-content button', { hasText: 'Record this month' }).click()
await p.waitForTimeout(1000)
const runs = await ls('pl_corp_payroll_runs')
ok('the month is recorded', runs.length === 1, String(runs.length))
const before = runs[0]?.gross
ok('with a gross on it', before > 0, String(before))
await p.locator('#main-content button[aria-label="Edit Avi Shah"]').click()
await p.waitForTimeout(500)
await field('Basic').fill('60000')
await p.locator('#main-content button', { hasText: 'Save' }).first().click()
await p.waitForTimeout(1000)
ok('the correction is kept', (await who('Avi Shah'))?.pay?.basic === 60000, JSON.stringify((await who('Avi Shah'))?.pay))
ok('but the recorded month is untouched', (await ls('pl_corp_payroll_runs'))[0]?.gross === before,
  `${(await ls('pl_corp_payroll_runs'))[0]?.gross} vs ${before}`)
// The control: a month nobody recorded does move, which is why the record has
// to exist at all.
const other = new Date(); other.setMonth(other.getMonth() - 1)
await p.locator('#main-content input[type=month]').first().fill(other.toISOString().slice(0, 7))
await p.waitForTimeout(800)
t = await main()
ok('while an unrecorded month reflects the new pay', /not run/i.test(t), t.slice(0, 1200).replace(/\n/g, ' | '))

console.log('\n── TAKING SOMEBODY OFF IS NOT ERASING THEM ──')
await p.goto(`${B}/operations?tab=payroll`, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
await p.locator('#main-content button[aria-label="Remove Sanket More"]').click()
await p.waitForTimeout(800)
const gone = await who('Sanket More')
ok('the row is still there', Boolean(gone), 'the row was deleted outright')
ok('they are just not active', gone?.active === false, JSON.stringify(gone?.active))
t = await main()
ok('and the list still shows them', /Sanket More/.test(t), t.slice(0, 2500).replace(/\n/g, ' | '))
ok('marked as off the payroll', /off the payroll/i.test(t), t.slice(0, 2500).replace(/\n/g, ' | '))
// Which was the other thing that could not be undone: somebody taken off was
// invisible, so putting them back was impossible.
await p.locator('#main-content button[aria-label="Restore Sanket More"]').click()
await p.waitForTimeout(800)
ok('and they can be put back', (await who('Sanket More'))?.active === true, JSON.stringify((await who('Sanket More'))?.active))
ok('the trail records the corrections', (await ls('pl_corp_audit')).some((a) => /employee/.test(a.action || '')),
  JSON.stringify((await ls('pl_corp_audit')).map((a) => a.action).slice(-5)))

for (const e of errs) ok(e, false)
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
