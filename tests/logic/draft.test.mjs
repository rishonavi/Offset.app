// The half-typed form somebody comes back to, and the sweep that tidies up
// after the ones they never do.
//
// Six exports, no tests. `pruneDrafts()` runs at every boot from `main.jsx`,
// which makes it the highest-risk shape in this codebase: a sweep that deletes
// things, unattended, with nothing watching it. It held three faults, and the
// expiry arithmetic is clock-dependent, so the clock is frozen here with the
// helper the TDS work already added rather than a second one.
import {
  draftKey, readDraft, writeDraft, clearDraft, draftDiffers, pruneDrafts,
} from '../../src/lib/draft.js'
import { freezeClock } from './_clock.mjs'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

// A localStorage good enough for this module: Object.keys over it is what
// `pruneDrafts` iterates, so the keys have to be enumerable own properties.
function installStorage() {
  const store = {}
  globalThis.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v) },
    removeItem: (k) => { delete store[k] },
  }
  // `Object.keys(localStorage)` must list the stored keys, which a real one does
  // and a plain object of methods does not — so the backing object is what gets
  // enumerated.
  globalThis.localStorage = new Proxy(globalThis.localStorage, {
    ownKeys: () => Object.keys(store),
    getOwnPropertyDescriptor: (t, k) => (Object.prototype.hasOwnProperty.call(store, k)
      ? { value: store[k], enumerable: true, configurable: true }
      : Reflect.getOwnPropertyDescriptor(t, k)),
  })
  return store
}

const DAY = 24 * 60 * 60 * 1000
const NOW = '2026-06-15T12:00:00Z'
const at = (ms) => JSON.stringify({ at: new Date(NOW).getTime() + ms, fields: { vendor: 'Shree' } })

console.log('── THE KEY A FORM WRITES UNDER ──')
eq('a new expense', draftKey('expense', null), 'pl_draft_expense_new')
eq('an existing one', draftKey('expense', 'e1'), 'pl_draft_expense_e1')
eq('and one inside a company', draftKey('expense', 'e1', 'ent-1'), 'pl_draft_expense_e1@ent-1')
ok('personal books take no suffix', !draftKey('income', 'i1', '').includes('@'), draftKey('income', 'i1', ''))

console.log('\n── WHAT IS KEPT, AND WHAT IS NOT ──')
{
  const store = installStorage()
  const thaw = freezeClock(NOW)
  // A File cannot be serialised and a data URL would put a photograph into
  // every keystroke's worth of writes.
  writeDraft('pl_draft_expense_new', {
    vendor: 'Shree', amount: 1200, taxable: true,
    receipt: { name: 'bill.png' }, nothing: null, missing: undefined,
  })
  const back = readDraft('pl_draft_expense_new')
  eq('scalars come back', back, { vendor: 'Shree', amount: 1200, taxable: true })
  ok('an object does not', !('receipt' in back), JSON.stringify(back))
  ok('nor a null', !('nothing' in back), JSON.stringify(back))
  ok('and the stamp is kept beside them', JSON.parse(store['pl_draft_expense_new']).at > 0)
  thaw()
}
{
  // A write with nothing in it must not leave the last one standing. This used
  // to `return` early and keep the old key, superseded by nothing, for a day.
  const store = installStorage()
  const thaw = freezeClock(NOW)
  writeDraft('pl_draft_expense_new', { vendor: 'Shree' })
  ok('there is a draft to begin with', Boolean(store['pl_draft_expense_new']))
  writeDraft('pl_draft_expense_new', { vendor: null, amount: undefined, receipt: {} })
  eq('a write with no scalars removes it', store['pl_draft_expense_new'], undefined)
  eq('and nothing is restored', readDraft('pl_draft_expense_new'), null)
  thaw()
}
{
  // And the narrowness is the point, so state it. An empty string *is* a
  // scalar, so a blanked form still writes — which is why the forms guard the
  // call with `draftDiffers` rather than relying on this. Removing that guard
  // would make "start fresh" write back the draft it had just removed.
  const store = installStorage()
  const thaw = freezeClock(NOW)
  writeDraft('pl_draft_x', { vendor: '' })
  ok('an empty string is still a field', Boolean(store['pl_draft_x']), JSON.stringify(store))
  eq('and a blank one is not worth announcing', draftDiffers(readDraft('pl_draft_x'), { vendor: '' }), false)
  thaw()
}

console.log('\n── A DAY OLD, TO THE SECOND ──')
{
  const store = installStorage()
  const thaw = freezeClock(NOW)
  store['pl_draft_a'] = at(-(DAY - 1000))
  store['pl_draft_b'] = at(-(DAY + 1000))
  ok('a draft just under the day is kept', Boolean(readDraft('pl_draft_a')))
  eq('and one just over it is gone', readDraft('pl_draft_b'), null)
  eq('removed, not merely refused', store['pl_draft_b'], undefined)
  thaw()
}
{
  // A phone before its clock has synced, or a clock somebody corrected. `now -
  // at` is negative, which compared as newer than new: the draft never expired
  // and — before the sweep was fixed — could never be collected either.
  const store = installStorage()
  const thaw = freezeClock(NOW)
  store['pl_draft_future'] = at(+(3 * DAY))
  eq('a draft stamped in the future is not fresh', readDraft('pl_draft_future'), null)
  eq('it is thrown away', store['pl_draft_future'], undefined)
  thaw()
}

console.log('\n── THE SHAPES THAT ARE NOT A DRAFT ──')
{
  const store = installStorage()
  const thaw = freezeClock(NOW)
  store['pl_draft_1'] = '{not json'
  store['pl_draft_2'] = 'null'
  store['pl_draft_3'] = '{}'
  store['pl_draft_4'] = JSON.stringify({ at: Date.now() })
  store['pl_draft_5'] = JSON.stringify({ at: Date.now(), fields: ['x', 'y'] })
  store['pl_draft_6'] = JSON.stringify({ at: Date.now(), fields: 7 })
  for (const k of ['pl_draft_1', 'pl_draft_2', 'pl_draft_3', 'pl_draft_4', 'pl_draft_5', 'pl_draft_6']) {
    eq(`${store[k] === undefined ? k : k} reads as no draft`, readDraft(k), null)
  }
  // An array used to come back *as an array*, and the form spread it into its
  // state as {0:'x', 1:'y'}.
  eq('and every one of them is removed', Object.keys(store).length, 0)
  thaw()
}

console.log('\n── THE SWEEP THAT RUNS AT EVERY BOOT ──')
{
  const store = installStorage()
  const thaw = freezeClock(NOW)
  store['pl_draft_stale'] = at(-(2 * DAY))
  store['pl_draft_live'] = at(-(60 * 1000))
  store['pl_draft_broken'] = '{not json'
  store['pl_draft_empty'] = '{}'
  store['pl_expenses'] = JSON.stringify([{ id: 'e1' }])
  store['pl_theme'] = 'dark'
  pruneDrafts()
  eq('the stale draft is collected', store['pl_draft_stale'], undefined)
  // The leak this sweep exists to stop, and the entries it could never collect:
  // `readDraft` cleared only on the expiry branch, so broken keys survived
  // every boot for the life of the installation.
  eq('so is the unparseable one', store['pl_draft_broken'], undefined)
  eq('and the one with no fields', store['pl_draft_empty'], undefined)
  // The controls. A sweep that deleted everything would pass all three above.
  ok('the live draft is untouched', Boolean(store['pl_draft_live']), JSON.stringify(store))
  ok('the ledger is not a draft', Boolean(store['pl_expenses']), JSON.stringify(store))
  ok('nor is a preference', Boolean(store['pl_theme']), JSON.stringify(store))
  thaw()
}
{
  // Storage refused outright — a private window with site data blocked. The
  // form must still work; a draft is a convenience.
  globalThis.localStorage = {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('blocked') },
    removeItem: () => { throw new Error('blocked') },
  }
  eq('a blocked store reads as no draft', readDraft('pl_draft_x'), null)
  ok('writing does not throw', (() => { try { writeDraft('pl_draft_x', { a: 1 }); return true } catch { return false } })())
  ok('clearing does not throw', (() => { try { clearDraft('pl_draft_x'); return true } catch { return false } })())
  ok('and sweeping does not throw', (() => { try { pruneDrafts(); return true } catch { return false } })())
}

console.log('\n── WHETHER A DRAFT IS WORTH ANNOUNCING ──')
eq('nothing is no difference', draftDiffers(null, { vendor: '' }), false)
eq('a draft matching the blank form is no difference', draftDiffers({ vendor: '' }, { vendor: '' }), false)
eq('a filled field is', draftDiffers({ vendor: 'Shree' }, { vendor: '' }), true)
eq('a number against its string reads as the same', draftDiffers({ amount: 1200 }, { amount: '1200' }), false)
eq('and a changed one differs', draftDiffers({ amount: 1200 }, { amount: '1300' }), true)
eq('a key the blank form has not got counts', draftDiffers({ extra: 'x' }, {}), true)
eq('and a missing base is survivable', draftDiffers({ vendor: 'Shree' }, null), true)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
