// Getting started, and the sample portfolio it offers.
import * as O from '../../src/lib/onboarding.js'
import * as S from '../../src/lib/sampleData.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

// localStorage does not exist under node; the module guards for it, and these
// tests give it one so dismissal can be exercised.
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const EMPTY = { properties: [], expenses: [], income: [] }

console.log('\n── THE CHECKLIST FOLLOWS THE BOOKS ──')
eq('nothing is done on an empty install', O.progress(EMPTY).done, 0)
ok('and it is not complete', !O.progress(EMPTY).complete)
eq('the first thing to do is add an asset', O.nextStep(EMPTY).id, 'asset')
const withAsset = { ...EMPTY, properties: [{ id: 'p1', name: 'Flat' }] }
eq('adding an asset ticks the first step', O.progress(withAsset).done, 1)
eq('and moves on to logging a cost', O.nextStep(withAsset).id, 'expense')
const withCost = { ...withAsset, expenses: [{ id: 'e1', amount: 100 }] }
eq('logging a cost ticks the second', O.progress(withCost).done, 2)
eq('then income is next', O.nextStep(withCost).id, 'income')
const withIncome = { ...withCost, income: [{ id: 'i1', amount: 500 }] }
eq('recording income ticks the third', O.progress(withIncome).done, 3)
eq('and a budget is last', O.nextStep(withIncome).id, 'budget')

console.log('\n── BUDGETS ──')
const zeroBudget = { ...withIncome, properties: [{ id: 'p1', name: 'Flat', monthly_budget: 0 }] }
ok('a budget of zero does not count as set', !O.progress(zeroBudget).complete, JSON.stringify(O.progress(zeroBudget)))
const budgeted = { ...withIncome, properties: [{ id: 'p1', name: 'Flat', monthly_budget: 25000 }] }
ok('a real budget finishes the list', O.progress(budgeted).complete)
eq('all four are done', O.progress(budgeted).done, 4)
eq('and there is nothing left to point at', O.nextStep(budgeted), null)

console.log('\n── WHEN IT SHOWS ──')
ok('it shows on an empty install', O.shouldShow(EMPTY))
ok('it shows part way through', O.shouldShow(withCost))
ok('it hides itself once finished, with no dismissal needed', !O.shouldShow(budgeted))
O.dismiss()
ok('and it hides when waved away', !O.shouldShow(EMPTY))
ok('which is remembered', O.isDismissed())
O.undismiss()
ok('and can be brought back', O.shouldShow(EMPTY))
eq('progress is a percentage too', O.progress(withCost).percent, 50)

console.log('\n── SAMPLE DATA IS TAGGED ──')
ok('a tagged row is recognised', S.isSampleRow({ is_sample: true }))
ok('a row a user typed is not', !S.isSampleRow({ name: 'My flat' }))
ok('an empty set has no sample data', !S.hasSampleData(EMPTY))
ok('nor any real data', !S.hasRealData(EMPTY))
ok('a user row counts as real', S.hasRealData({ ...EMPTY, properties: [{ id: 'p1', name: 'Mine' }] }))
ok('a sample row does not count as real',
  !S.hasRealData({ ...EMPTY, properties: [{ id: 'p1', name: 'Sea View', is_sample: true }] }))

console.log('\n── INSTALLING IT ──')
const makeDb = () => {
  const db = { properties: [], expenses: [], income: [] }
  let n = 0
  return {
    db,
    addProperty: async (r) => { const row = { ...r, id: `p${++n}` }; db.properties.push(row); return row },
    addExpense: async (r) => { const row = { ...r, id: `e${++n}` }; db.expenses.push(row); return row },
    addIncome: async (r) => { const row = { ...r, id: `i${++n}` }; db.income.push(row); return row },
    deleteProperty: async (id) => { db.properties = db.properties.filter((r) => r.id !== id) },
    deleteExpense: async (id) => { db.expenses = db.expenses.filter((r) => r.id !== id) },
    deleteIncome: async (id) => { db.income = db.income.filter((r) => r.id !== id) },
  }
}
const h = makeDb()
const added = await S.installSampleData({ ...h, ...EMPTY })
ok('it creates several assets', added.assets >= 3, String(added.assets))
ok('with a year of income', h.db.income.length >= 20, String(h.db.income.length))
ok('and a year of costs', h.db.expenses.length >= 20, String(h.db.expenses.length))
ok('every row it writes is tagged',
  [...h.db.properties, ...h.db.expenses, ...h.db.income].every(S.isSampleRow))
ok('the entries point at the assets it created',
  h.db.expenses.every((e) => h.db.properties.some((p) => p.id === e.property_id)))
ok('there is an unpaid bill, so that state is visible',
  h.db.expenses.some((e) => e.status === 'unpaid'))
ok('and rent varies, so the charts have something to show',
  new Set(h.db.income.map((i) => i.amount)).size > 1)
ok('no amount is zero', h.db.expenses.every((e) => e.amount > 0))

console.log('\n── IT REFUSES TO MERGE INTO REAL BOOKS ──')
const real = makeDb()
let refused = ''
try {
  await S.installSampleData({ ...real, properties: [{ id: 'x', name: 'My actual flat' }], expenses: [], income: [] })
} catch (e) { refused = e.message }
ok('it will not load over data the user typed', /already/i.test(refused), refused)
eq('and wrote nothing', real.db.properties.length, 0)
let twice = ''
try {
  await S.installSampleData({ ...h, ...h.db })
} catch (e) { twice = e.message }
ok('nor load itself twice', /already loaded/i.test(twice), twice)

console.log('\n── REMOVING IT ──')
const before = h.db.properties.length + h.db.expenses.length + h.db.income.length
const removed = await S.removeSampleData({ ...h.db, ...h })
eq('everything it added comes back out', removed, before)
eq('no assets are left', h.db.properties.length, 0)
eq('no expenses are left', h.db.expenses.length, 0)
eq('no income is left', h.db.income.length, 0)

console.log('\n── AND LEAVES REAL ROWS ALONE ──')
const mixed = makeDb()
await S.installSampleData({ ...mixed, ...EMPTY })
const mine = await mixed.addExpense({ category: 'Utilities', vendor: 'My own bill', amount: 999 })
const sampleCount = mixed.db.expenses.filter(S.isSampleRow).length
await S.removeSampleData({ ...mixed.db, ...mixed })
eq('the row the user typed survives', mixed.db.expenses.length, 1)
eq('and it is theirs', mixed.db.expenses[0].id, mine.id)
ok('while every sample row went', sampleCount > 0 && !mixed.db.expenses.some(S.isSampleRow))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
