// Provident fund and state insurance, as a question rather than a default.
//
// Both used to be on. `DEFAULT_PAYROLL_CONFIG` said `enabled: true` for each,
// no screen passed a config, so every company got twelve per cent of basic
// taken off every payslip and three and a quarter of gross on top — including a
// builder with four men and no registration, who had nowhere to turn it off and
// no hint that anything had been assumed on their behalf.
//
// So: nothing is deducted until the company says it is registered, the two
// schemes are asked separately, and being over a threshold without registering
// is said out loud rather than quietly treated as a setting.
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
const ENT = 'ent-stat-1'
// The "To deposit this month" line under the payslips, which is the only place
// the three totals appear together.
const deposit = async () => {
  const t = await main()
  const m = t.match(/To deposit this month:\s*PF\s*₹([\d,.]+)[^\n]*?ESI\s*₹([\d,.]+)[^\n]*?PT\s*₹([\d,.]+)/i)
  if (!m) return null
  return { pf: Number(m[1].replace(/,/g, '')), esi: Number(m[2].replace(/,/g, '')), pt: Number(m[3].replace(/,/g, '')) }
}
// One person's row off the payslip table: name, gross, PF, ESI, PT, net.
const row = async (name) => {
  const line = (await main()).split('\n').find((l) => l.startsWith(name)) || ''
  const nums = [...line.matchAll(/₹([\d,.]+)/g)].map((m) => Number(m[1].replace(/,/g, '')))
  return { line, gross: nums[0], pf: nums[1], esi: nums[2], pt: nums[3], net: nums[4] }
}
const attentionCard = async () => {
  const txt = await main()
  const i = txt.indexOf('Needs attention')
  return i < 0 ? '' : txt.slice(i, i + 2000)
}
const say = (short, answer) => p.locator(`#main-content button[aria-label="${short} registered: ${answer}"]`)
const entRow = async () => (await ls('pl_corp_entities')).find((e) => e.id === ENT)

// Twelve on the books: over the ESI threshold of ten, under the PF threshold of
// twenty. That gap is the point — the two questions have different answers for
// the same company on the same day.
const seed = async (count) => {
  await p.evaluate(({ ent, n }) => {
    localStorage.clear()
    const born = new Date(); born.setFullYear(born.getFullYear() - 1)
    for (const k of ['pl_properties', 'pl_expenses', 'pl_income', 'pl_documents']) localStorage.setItem(k, '[]')
    localStorage.setItem('pl_corp_entities', JSON.stringify([
      // The GSTIN matters here: its first two digits are the state, which is
      // how the professional tax knows which of twenty-two it is.
      { id: ent, name: 'Navi Builders Pvt Ltd', gstin: '27AAAPA1234A1Z5', currency: 'INR', fy_start_month: 4, created_at: born.toISOString() },
    ]))
    localStorage.setItem('pl_corp_members', JSON.stringify([
      { id: 'm1', entity_id: ent, user_id: 'local-user', email: '', role: 'owner', department_id: null, created_at: new Date().toISOString() },
    ]))
    const mk = (i, basic, hra) => ({
      id: `emp-${i}`, entity_id: ent, name: i === 1 ? 'A. Manager' : `W. Worker ${i}`, code: `E${String(i).padStart(2, '0')}`,
      email: '', department_id: null,
      pay: { basic, hra, conveyance: 0, medical: 0, special: 0, other: 0 },
      pan: '', uan: '', joined_on: '2025-04-01', active: true, created_at: born.toISOString(),
    })
    // One well above the ESI gross ceiling, the rest below it.
    const list = [mk(1, 40000, 16000)]
    for (let i = 2; i <= n; i++) list.push(mk(i, 12000, 6000))
    localStorage.setItem('pl_corp_employees', JSON.stringify(list))
    localStorage.setItem('pl_corp_payroll_runs', '[]')
    localStorage.setItem('pl_corp_active', ent)
  }, { ent: ENT, n: count })
}

await p.goto(B, { waitUntil: 'domcontentloaded' })
await seed(12)

console.log('\n── NOTHING IS DEDUCTED UNTIL SOMEBODY SAYS ──')
await p.goto(`${B}/operations?tab=payroll`, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
let t = await main()
ok('the payroll is on screen', /payslips/i.test(t), t.slice(0, 300).replace(/\n/g, ' | '))
ok('both schemes are asked about', /provident fund/i.test(t) && /state insurance/i.test(t),
  t.slice(0, 700).replace(/\n/g, ' | '))
// The heart of it. This is what was wrong before: these were ₹0 for nobody.
let d = await deposit()
ok('the deposit line is shown', d !== null, t.slice(0, 900).replace(/\n/g, ' | '))
ok('no provident fund is deducted', d?.pf === 0, JSON.stringify(d))
ok('no state insurance is deducted', d?.esi === 0, JSON.stringify(d))
// The control beside the two zeroes: professional tax is not one of the two
// questions and still comes off, so a zero above means "not asked", not
// "payroll produced nothing".
ok('professional tax still comes off, so the run is real', (d?.pt || 0) > 0, JSON.stringify(d))
ok('and the screen says nothing is deducted until you say', /nothing is deducted/i.test(t),
  t.slice(0, 900).replace(/\n/g, ' | '))
ok('the company has said nothing about PF', (await entRow())?.pf_registered === undefined,
  JSON.stringify(await entRow()))

console.log('\n── OVER THE THRESHOLD IS NOT A SETTING ──')
// Twelve employees is past the ESI Act's ten and short of the EPF Act's twenty,
// so exactly one of the two should be shouting.
ok('state insurance is flagged as required', /required at 10/i.test(t), t.slice(0, 1200).replace(/\n/g, ' | '))
ok('provident fund is not, at twelve employees', !/required at 20/i.test(t), t.slice(0, 1200).replace(/\n/g, ' | '))
ok('but provident fund is marked unanswered', /not answered/i.test(t), t.slice(0, 1200).replace(/\n/g, ' | '))
ok('and the headcount is given as the reason', /12 employees/.test(t), t.slice(0, 1200).replace(/\n/g, ' | '))

console.log('\n── SAYING NO IS AN ANSWER, AND NOT THE SAME AS SILENCE ──')
await say('PF', 'No').click()
await p.waitForTimeout(800)
t = await main()
ok('PF is recorded as not registered', (await entRow())?.pf_registered === false,
  JSON.stringify(await entRow()))
ok('still nothing deducted for it', (await deposit())?.pf === 0, JSON.stringify(await deposit()))
// The difference between the two answers, on screen.
ok('and it is no longer unanswered', !/not answered/i.test(t), t.slice(0, 1200).replace(/\n/g, ' | '))
ok('the reason now says it is not required under twenty', /under 20 employees it is not required/i.test(t),
  t.slice(0, 1200).replace(/\n/g, ' | '))
// Saying no when you are over the threshold does not make the problem go away.
await say('ESI', 'No').click()
await p.waitForTimeout(800)
t = await main()
ok('ESI is recorded as not registered', (await entRow())?.esi_registered === false)
ok('and is still flagged as required at ten', /required at 10/i.test(t), t.slice(0, 1200).replace(/\n/g, ' | '))
ok('with the Act named', /ESI Act requires it/i.test(t), t.slice(0, 1200).replace(/\n/g, ' | '))
ok('but nothing is deducted for a scheme the company is not in', (await deposit())?.esi === 0,
  JSON.stringify(await deposit()))

console.log('\n── SAYING YES TURNS IT ON, AND ONLY IT ──')
await say('PF', 'Yes').click()
await p.waitForTimeout(900)
ok('PF is recorded as registered', (await entRow())?.pf_registered === true)
d = await deposit()
ok('provident fund is now deducted', (d?.pf || 0) > 0, JSON.stringify(d))
// The two questions stay separate: answering one must not answer the other.
ok('and state insurance is still not', d?.esi === 0, JSON.stringify(d))
ok('the answer survives a reload', await (async () => {
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(900)
  return (await deposit())?.pf > 0
})(), JSON.stringify(await deposit()))
t = await main()
ok('and the screen says it is deducting', /deducting/i.test(t), t.slice(0, 1200).replace(/\n/g, ' | '))

console.log('\n── THE CEILINGS ARE PER PERSON ──')
const boss = await row('A. Manager')
const hand = await row('W. Worker 2')
// PF is on basic capped at ₹15,000, so the manager on ₹40,000 basic pays the
// same as somebody on ₹15,000 and not three times as much.
ok('the manager pays PF on the ceiling, not on basic', boss.pf === 1800, JSON.stringify(boss))
ok('and a worker under the ceiling pays on actual basic', hand.pf === 1440, JSON.stringify(hand))
await say('ESI', 'Yes').click()
await p.waitForTimeout(900)
const boss2 = await row('A. Manager')
const hand2 = await row('W. Worker 2')
// ESI is the other kind of ceiling: above it a person is out of the scheme
// entirely rather than capped at it.
ok('a worker under the gross ceiling is covered', hand2.esi > 0, JSON.stringify(hand2))
ok('the manager above it is left out altogether', boss2.esi === 0, JSON.stringify(boss2))
ok('and the take-home reflects only their own deductions', hand2.net < hand.net && boss2.net === boss.net,
  JSON.stringify({ hand: [hand.net, hand2.net], boss: [boss.net, boss2.net] }))
t = await main()
ok('the per-person rule is stated', /person by person/i.test(t), t.slice(0, 1400).replace(/\n/g, ' | '))

console.log('\n── A SMALL COMPANY IS NOT IN TROUBLE FOR SAYING NO ──')
// The control for "required at 10": the same answer on a smaller company must
// not produce the same warning, or the warning means nothing.
await seed(4)
await p.evaluate((ent) => {
  const list = JSON.parse(localStorage.getItem('pl_corp_entities'))
  list[0].pf_registered = false
  list[0].esi_registered = false
  localStorage.setItem('pl_corp_entities', JSON.stringify(list))
  localStorage.setItem('pl_corp_active', ent)
}, ENT)
await p.goto(`${B}/operations?tab=payroll`, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
t = await main()
ok('four men on the books', /ON PAYROLL\s*\n\s*4\b/i.test(t), t.slice(0, 1200).replace(/\n/g, ' | '))
ok('nothing is required of them', !/required at/i.test(t), t.slice(0, 1200).replace(/\n/g, ' | '))
d = await deposit()
ok('and neither scheme deducts a rupee', d?.pf === 0 && d?.esi === 0, JSON.stringify(d))
ok('which is the builder this was written for', (await row('W. Worker 2')).net > 0, JSON.stringify(await row('W. Worker 2')))

console.log('\n── AND THE QUESTION IS RAISED WHERE IT WILL BE SEEN ──')
// A question buried in the seventh tab of a page nobody opens is not a question.
// The dashboard is where somebody finds out they have been asked one.
await p.evaluate(() => {
  // A site, so the dashboard is past getting started and showing real findings.
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'a1', name: 'Depot', type: 'Real Estate — Villa / House', entity_id: 'ent-stat-1', created_at: new Date().toISOString() },
  ]))
  const list = JSON.parse(localStorage.getItem('pl_corp_entities'))
  delete list[0].pf_registered; delete list[0].esi_registered
  localStorage.setItem('pl_corp_entities', JSON.stringify(list))
})
await p.goto(B, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
let att = await attentionCard()
ok('an unanswered scheme reaches the dashboard', /Nobody has said whether this company runs/i.test(att),
  att.slice(0, 900).replace(/\n/g, ' | '))
ok('and names both of them', /PF or ESI/.test(att), att.slice(0, 900).replace(/\n/g, ' | '))
// The control: answering the question takes it off the list. A finding that
// cannot be cleared is a decoration.
await p.evaluate(() => {
  const list = JSON.parse(localStorage.getItem('pl_corp_entities'))
  list[0].pf_registered = false; list[0].esi_registered = false
  localStorage.setItem('pl_corp_entities', JSON.stringify(list))
})
await p.goto(B, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
att = await attentionCard()
ok('answering it takes it off the list', !/Nobody has said whether this company runs/i.test(att),
  att.slice(0, 900).replace(/\n/g, ' | '))

console.log('\n── AND BEING OVER THE THRESHOLD WITHOUT REGISTERING IS RAISED TOO ──')
// The louder of the two. This is not a question, it is a liability.
await p.evaluate(() => {
  const list = JSON.parse(localStorage.getItem('pl_corp_employees'))
  const born = new Date(); born.setFullYear(born.getFullYear() - 1)
  for (let i = list.length + 1; i <= 12; i++) {
    list.push({ id: `emp-${i}`, entity_id: 'ent-stat-1', name: `W. Worker ${i}`, code: `E${String(i).padStart(2, '0')}`,
      email: '', department_id: null, pay: { basic: 12000, hra: 6000, conveyance: 0, medical: 0, special: 0, other: 0 },
      pan: '', uan: '', joined_on: '2025-04-01', active: true, created_at: born.toISOString() })
  }
  localStorage.setItem('pl_corp_employees', JSON.stringify(list))
})
await p.goto(B, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
att = await attentionCard()
ok('not registering at twelve employees is raised', /required at this headcount/i.test(att),
  att.slice(0, 1200).replace(/\n/g, ' | '))
ok('and it names the scheme that requires it', /Employee state insurance/i.test(att),
  att.slice(0, 1200).replace(/\n/g, ' | '))
// The control: the same company under the threshold is not in trouble.
await p.evaluate(() => {
  const list = JSON.parse(localStorage.getItem('pl_corp_employees'))
  localStorage.setItem('pl_corp_employees', JSON.stringify(list.slice(0, 4)))
})
await p.goto(B, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
att = await attentionCard()
ok('four men and the same answer is nothing to raise', !/required at this headcount/i.test(att),
  att.slice(0, 1200).replace(/\n/g, ' | '))

console.log('\n── PROFESSIONAL TAX IS TWENTY-TWO TAXES WEARING ONE NAME ──')
// The same defect as the two schemes, one layer down. This app had Maharashtra's
// slabs switched on for everybody, so a company in Delhi — which levies no
// professional tax whatsoever — had ₹200 a month taken off every payslip.
await seed(4)
await p.goto(`${B}/operations?tab=payroll`, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
t = await main()
ok('the payroll asks about it', /Professional tax/.test(t), t.slice(0, 1400).replace(/\n/g, ' | '))
// The company never chose a state. It did enter a GSTIN, and the first two
// digits of a GSTIN are the state — asking a second time only gives the two
// answers a chance to disagree.
// The description sentence, not the bare word: "Maharashtra" also appears in
// the picker below, so matching it alone would pass with the derivation gone.
ok('and knows the state from the GSTIN without being asked',
  /Maharashtra: Slabs on monthly gross/.test(t), t.slice(0, 1600).replace(/\n/g, ' | '))
ok('nothing was chosen on the picker', (await entRow())?.pt_state == null, JSON.stringify(await entRow()))
d = await deposit()
ok('Maharashtra’s tax comes off', (d?.pt || 0) > 0, JSON.stringify(d))
// Said out loud, because a slab that moved last April is a wrong payslip every
// month and the app cannot know that it has.
ok('and the screen says when the slabs were last checked', /States revise them/.test(t),
  t.slice(0, 1600).replace(/\n/g, ' | '))

console.log('\n── A STATE THAT CHARGES NOTHING CHARGES NOTHING ──')
const pickState = (code) => p.locator('#main-content select[aria-label="Professional tax state"]').selectOption(code)
await pickState('07')
await p.waitForTimeout(900)
t = await main()
ok('Delhi is chosen', (await entRow())?.pt_state === '07', JSON.stringify(await entRow()))
// Whole sentence, not "Delhi — no professional tax": that is also how Delhi
// reads in the picker below, so matching it would pass whether or not the
// description had updated at all.
ok('and the screen says Delhi levies none', /Delhi levies no professional tax/.test(t),
  t.slice(0, 1600).replace(/\n/g, ' | '))
// The figure this whole thing is about.
ok('so nothing is deducted', (await deposit())?.pt === 0, JSON.stringify(await deposit()))
ok('while the other two are untouched by it', (await deposit())?.esi === 0 && (await deposit())?.pf === 0)

console.log('\n── A SMALL STATE, DEDUCTED AND MARKED ──')
// The eight smallest states were blank at first, because their notifications
// are a good deal harder to come by than Maharashtra's. They are filled in now,
// and marked: slabs this app is sure of and slabs it is not look identical once
// they are numbers on a payslip, so the screen says which kind these are.
await pickState('22')
await p.waitForTimeout(900)
t = await main()
ok('Chhattisgarh deducts', (await deposit())?.pt > 0, JSON.stringify(await deposit()))
ok('and the screen says the slabs want checking',
  /These slabs want checking against the state’s own notification/.test(t),
  t.slice(0, 1800).replace(/\n/g, ' | '))
ok('with a badge beside the money', /check these slabs/i.test(t), t.slice(0, 1900).replace(/\n/g, ' | '))
// It must read differently from Delhi, or a state that charges nothing and a
// state charging an unchecked figure are the same thing on screen.
ok('which does not read like a state that charges nothing',
  !/Chhattisgarh levies no professional tax/.test(t), t.slice(0, 1800).replace(/\n/g, ' | '))
// The control: a state this app is sure of carries no such line.
await pickState('27')
await p.waitForTimeout(900)
t = await main()
ok('and a state this is sure of says no such thing', !/want checking/.test(t),
  t.slice(0, 1800).replace(/\n/g, ' | '))
ok('nor carries the badge', !/check these slabs/i.test(t), t.slice(0, 1900).replace(/\n/g, ' | '))
await pickState('22')
await p.waitForTimeout(900)

console.log('\n── AND A DIFFERENT STATE IS A DIFFERENT NUMBER ──')
// Karnataka's threshold is ₹25,000 a month, Maharashtra's is ₹7,500. The same
// four men, the same pay, two different bills — which is the whole reason one
// set of slabs for the country was wrong.
await pickState('29')
await p.waitForTimeout(900)
const karnataka = await deposit()
await pickState('27')
await p.waitForTimeout(900)
const maharashtra = await deposit()
ok('Karnataka charges these men less than Maharashtra', karnataka.pt < maharashtra.pt,
  `${karnataka.pt} vs ${maharashtra.pt}`)
// Three of the four are on ₹18,000, under Karnataka's ₹25,000 threshold and
// over Maharashtra's ₹7,500 one.
ok('because three of the four are under one threshold and over the other',
  maharashtra.pt - karnataka.pt === 600, `${maharashtra.pt} - ${karnataka.pt}`)
t = await main()
ok('and the state is named beside the money, with the headcount under it',
  /Maharashtra — 4 people/.test(t), t.slice(0, 1800).replace(/\n/g, ' | '))

console.log('\n── NOBODY HAVING SAID REACHES THE DASHBOARD ──')
await p.evaluate(() => {
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'a1', name: 'Depot', type: 'Real Estate — Villa / House', entity_id: 'ent-stat-1', created_at: new Date().toISOString() },
  ]))
  const list = JSON.parse(localStorage.getItem('pl_corp_entities'))
  // No chosen state and no GSTIN to read one off: the genuinely unanswered case.
  list[0].pt_state = null; list[0].gstin = ''
  list[0].pf_registered = false; list[0].esi_registered = false
  localStorage.setItem('pl_corp_entities', JSON.stringify(list))
})
await p.goto(B, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
const ptCard = async () => {
  const txt = await main()
  const i = txt.indexOf('Needs attention')
  return i < 0 ? '' : txt.slice(i, i + 2000)
}
let pt = await ptCard()
ok('no state at all is raised', /which state the professional tax is for/i.test(pt),
  pt.slice(0, 1000).replace(/\n/g, ' | '))
ok('and points at the GSTIN as the easy answer', /GSTIN/.test(pt), pt.slice(0, 1000).replace(/\n/g, ' | '))
// The control: naming the state clears it.
await p.evaluate(() => {
  const list = JSON.parse(localStorage.getItem('pl_corp_entities'))
  list[0].pt_state = '27'
  localStorage.setItem('pl_corp_entities', JSON.stringify(list))
})
await p.goto(B, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
pt = await ptCard()
ok('answering it takes it off the list', !/which state the professional tax is for/i.test(pt),
  pt.slice(0, 1000).replace(/\n/g, ' | '))
// And the other one: deducting, but on slabs worth checking once.
await p.evaluate(() => {
  const list = JSON.parse(localStorage.getItem('pl_corp_entities'))
  list[0].pt_state = '22'
  localStorage.setItem('pl_corp_entities', JSON.stringify(list))
})
await p.goto(B, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
pt = await ptCard()
ok('a small state’s slabs are raised as worth checking', /slabs are worth checking/i.test(pt),
  pt.slice(0, 1200).replace(/\n/g, ' | '))
ok('and says whose reading they are', /best reading/i.test(pt), pt.slice(0, 1200).replace(/\n/g, ' | '))
// The control: Maharashtra's are not raised, or the warning means nothing.
await p.evaluate(() => {
  const list = JSON.parse(localStorage.getItem('pl_corp_entities'))
  list[0].pt_state = '27'
  localStorage.setItem('pl_corp_entities', JSON.stringify(list))
})
await p.goto(B, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
pt = await ptCard()
ok('and a state this is sure of is not raised at all', !/slabs are worth checking/i.test(pt),
  pt.slice(0, 1200).replace(/\n/g, ' | '))

console.log('\n── THE MONEY THAT REACHES NO PAYSLIP ──')
// Gratuity and bonus are costs the company carries rather than deductions, so
// nothing in a month's accounts moves and both grow in silence. This screen is
// the only place either has ever been added up.
//
// Twenty-five men, five of them there since 2016, so both Acts apply and
// gratuity has vested for some.
await p.evaluate((ent) => {
  const born = new Date(); born.setFullYear(born.getFullYear() - 12)
  const mk = (id, name, basic, da, joined) => ({
    id, entity_id: ent, name, code: id.toUpperCase(), email: '', department_id: null,
    pay: { basic, da, hra: 0, conveyance: 0, medical: 0, special: 0, other: 0 },
    pan: '', uan: '', joined_on: joined, active: true, created_at: born.toISOString(),
  })
  const list = [
    ...Array.from({ length: 5 }, (_, i) => mk(`old${i}`, `Old hand ${i}`, 15000, 3000, '2016-01-01')),
    ...Array.from({ length: 20 }, (_, i) => mk(`new${i}`, `New hand ${i}`, 9000, 1000, '2024-01-01')),
  ]
  localStorage.setItem('pl_corp_employees', JSON.stringify(list))
  const ents = JSON.parse(localStorage.getItem('pl_corp_entities'))
  ents[0].pt_state = '27'; ents[0].bonus_rate = null; ents[0].minimum_wage = null
  localStorage.setItem('pl_corp_entities', JSON.stringify(ents))
}, ENT)
await p.goto(`${B}/operations?tab=payroll`, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
t = await main()
const money = (label) => {
  const m = (t.match(new RegExp(`${label}\\s*\\n\\s*₹([\\d,.]+)`, 'i')) || [])[1]
  return m ? Number(m.replace(/,/g, '')) : null
}
ok('gratuity is on the payroll screen', /Gratuity/.test(t), t.slice(0, 600).replace(/\n/g, ' | '))
ok('and at twenty-five men the Act applies', /At 25 employees the Payment of Gratuity Act/.test(t),
  t.slice(0, 2500).replace(/\n/g, ' | '))
const owedToday = money('Owed if everyone left today')
const notVested = money('Not yet vested')
const accrued = money('Accrued in all')
ok('what is owed today is shown', owedToday > 0, String(owedToday))
ok('separately from what has not vested', notVested > 0, String(notVested))
// Adding the two together makes one number that is true of neither, so the
// screen has to keep them apart — and they have to actually differ.
ok('and the two are not the same figure', owedToday !== notVested, `${owedToday} vs ${notVested}`)
ok('the parts make the whole', owedToday + notVested === accrued, `${owedToday} + ${notVested} vs ${accrued}`)
ok('it says the money is on no payslip', /appears on no payslip/.test(t), t.slice(0, 2500).replace(/\n/g, ' | '))

console.log('\n── AND THE BONUS NOBODY HAS SET A RATE FOR ──')
ok('the bonus card names the year that closed', /Bonus for \d{4}-\d{2}/.test(t), t.slice(0, 3000).replace(/\n/g, ' | '))
ok('and says nobody chose a rate', /no rate chosen/i.test(t), t.slice(0, 3000).replace(/\n/g, ' | '))
// The two ceilings, which is the thing this card exists to say out loud.
ok('both ceilings are stated', /Two ceilings, and they are different numbers/.test(t),
  t.slice(0, 3000).replace(/\n/g, ' | '))
ok('and how many are paid on the ceiling rather than their wages',
  /rather than on their wages, because the Act caps the calculation there/.test(t),
  t.slice(0, 3000).replace(/\n/g, ' | '))
const atMin = money(`At 8.33%`)
const atMax = money('At the 20% maximum')
ok('the minimum is shown', atMin > 0, String(atMin))
ok('beside what the maximum would cost', atMax > atMin, `${atMax} vs ${atMin}`)

console.log('\n── A MINIMUM WAGE CHANGES WHAT IT IS WORKED OUT ON ──')
// The clause most often dropped: ₹7,000 *or the minimum wage, whichever is
// higher*. Twenty men on ₹10,000 of basic and DA are held to ₹7,000 until the
// minimum wage says otherwise.
await p.locator('#main-content input[aria-label="Minimum wage"]').fill('12000')
await p.waitForTimeout(1000)
t = await main()
const raised = money(`At 8.33%`)
ok('raising the minimum wage raises the bonus', raised > atMin, `${raised} vs ${atMin}`)
ok('and the screen says which ceiling bit', /the minimum wage, here/.test(t),
  t.slice(0, 3000).replace(/\n/g, ' | '))
// The control: a rate the company chooses is not the minimum the Act imposes.
await p.locator('#main-content input[aria-label="Bonus rate"]').fill('20')
await p.waitForTimeout(1000)
t = await main()
ok('choosing a rate clears the warning', !/no rate chosen/i.test(t), t.slice(0, 3000).replace(/\n/g, ' | '))
ok('and it is kept on the company', (await entRow())?.bonus_rate === 20, JSON.stringify(await entRow()))
ok('with the minimum wage', (await entRow())?.minimum_wage === 12000, JSON.stringify(await entRow()))

console.log('\n── AND BOTH REACH THE DASHBOARD ──')
await p.goto(B, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
let owedCard = await attentionCard()
ok('gratuity already owed is raised', /gratuity is owed and nothing is set aside/i.test(owedCard),
  owedCard.slice(0, 1200).replace(/\n/g, ' | '))
ok('as money, with a figure', /₹/.test(owedCard), owedCard.slice(0, 1200).replace(/\n/g, ' | '))
// The control: a payroll where nobody has five years owes nothing yet.
await p.evaluate(() => {
  const list = JSON.parse(localStorage.getItem('pl_corp_employees'))
  localStorage.setItem('pl_corp_employees', JSON.stringify(list.map((e) => ({ ...e, joined_on: '2024-01-01' }))))
})
await p.goto(B, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
owedCard = await attentionCard()
ok('a payroll where nobody has five years is not told they are owed',
  !/gratuity is owed/i.test(owedCard), owedCard.slice(0, 1200).replace(/\n/g, ' | '))

console.log('\n── AND THE REPORT COSTS THE COMPANY THE SAME WAY ──')
// Back to the four men this section's figures are about — the sections above
// put twenty-five on the books.
await seed(4)
await p.evaluate(() => {
  localStorage.setItem('pl_properties', JSON.stringify([
    { id: 'a1', name: 'Depot', type: 'Real Estate — Villa / House', entity_id: 'ent-stat-1', created_at: new Date().toISOString() },
  ]))
  const list = JSON.parse(localStorage.getItem('pl_corp_entities'))
  list[0].pf_registered = false; list[0].esi_registered = false; list[0].pt_state = '27'
  localStorage.setItem('pl_corp_entities', JSON.stringify(list))
})
// The other half of the wiring, and the half that was missed: the answer is
// written on the company and the report read the library defaults instead, so a
// company that had said yes saw the deduction on its payslips and a cost to
// company in its report that did not include it.
const costToCompany = async () => {
  const t = await main()
  const m = t.match(/COST TO COMPANY\s*\n\s*₹([\d,.]+)/i) || t.match(/Cost to company\s*\n?\s*₹([\d,.]+)/i)
  return m ? Number(m[1].replace(/,/g, '')) : null
}
const reportGross = async () => {
  const t = await main()
  const m = t.match(/Gross\s*\n?\s*₹([\d,.]+)/i)
  return m ? Number(m[1].replace(/,/g, '')) : null
}
await p.goto(`${B}/reports`, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
const offCost = await costToCompany()
const offGross = await reportGross()
ok('the report costs the payroll', offCost !== null && offGross !== null, `${offCost} / ${offGross}`)
// Not registered: the company's cost is the wage bill and nothing on top.
ok('a company not in either scheme costs exactly its wage bill', offCost === offGross,
  `${offCost} vs ${offGross}`)
await p.evaluate(() => {
  const list = JSON.parse(localStorage.getItem('pl_corp_entities'))
  list[0].pf_registered = true
  localStorage.setItem('pl_corp_entities', JSON.stringify(list))
})
await p.goto(`${B}/reports`, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
const onCost = await costToCompany()
ok('and saying yes puts the employer share into the report', onCost > offCost, `${onCost} vs ${offCost}`)
// The employer half of PF on four men: one on ₹40,000 basic capped at the
// ₹15,000 wage, three on ₹12,000.
ok('by exactly the employer contribution', onCost - offCost === 1800 + 3 * 1440,
  `${onCost - offCost}`)

for (const e of errs) ok(e, false)
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
