// What a bank's own answer becomes once it is in the books.
//
// The live connection is a scaffold — docs/BANK_SYNC.md now says exactly which
// steps are missing — but the normalising is not scaffolding: the moment
// credentials are set, these rules decide whether money leaving an account is
// recorded as money leaving or money arriving. Nothing tested them.
//
// Five things were wrong, all in the direction of a wrong number stated as a
// fact rather than a failure stated as a failure:
//
//   1. The AA direction was `type.includes('DEBIT') ? 'debit' : 'credit'`, so a
//      payload keyed `@type` (ordinary after an XML→JSON conversion), a value of
//      OTHER or REVERSAL, or a missing field made every row a **credit** —
//      money paid out, booked as income received.
//   2. The Plaid path had no guards at all, while the AA path ended with a
//      filter. `amount: 0` passed (`0 > 0` is false, so the old filter would
//      have caught it; nothing here did) and a missing date passed through as
//      `undefined`, making `addIncome({ date: undefined, amount: 0 })` reachable.
//   3. Dates were `String(v).slice(0, 10)`, so a UTC timestamp of 19:30 — 01:00
//      the next morning in India — landed on the previous day.
//   4. `today()` was UTC, so between 00:00 and 05:29 IST the fetch window
//      **excluded the current day** for every Indian user, every morning.
//   5. Nothing read the row's currency, so a $42 charge was booked as 42 and
//      rendered **₹42** — out by a factor of ninety, and indistinguishable on
//      screen from a real figure.
//
// `fips: []` also made the `accounts` fallback dead code (an empty array is
// truthy), and a single collapsed `transaction` object threw rather than
// importing one row.
import {
  toBankDate,
  today,
  normalisePlaid,
  normaliseSetu,
  foreignCurrency,
} from '../../api/bank/transactions.js'
import { freezeClock } from './_clock.mjs'
import {
  leftOutNote,
  startBankLink,
  fetchLiveTransactions,
  serverBankProvider,
} from '../../src/lib/bankSync.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

// ── DATES ────────────────────────────────────────────────────────────────────
console.log('── A DAY IS A DAY WHERE THE ACCOUNT IS ──')
eq('a bare date is taken as given', toBankDate('2026-03-15'), '2026-03-15')
// The bug, exactly: 19:30 UTC is 01:00 IST the next morning. `.slice(0, 10)`
// answered the 15th.
eq('a late-evening UTC stamp lands on the Indian day', toBankDate('2026-03-15T19:30:00Z'), '2026-03-16')
// The control. Without it, a function that simply added a day would pass above.
eq('a mid-morning UTC stamp stays put', toBankDate('2026-03-15T10:00:00Z'), '2026-03-15')
eq('an IST stamp is already Indian', toBankDate('2026-03-15T19:30:00+05:30'), '2026-03-15')
eq('and so is one just before midnight IST', toBankDate('2026-03-15T23:59:00+05:30'), '2026-03-15')
eq('one minute later is the next day', toBankDate('2026-03-16T00:01:00+05:30'), '2026-03-16')
eq('an offset without a colon reads too', toBankDate('2026-03-15T19:30+0530'), '2026-03-15')
eq('and milliseconds do not confuse it', toBankDate('2026-03-15T19:30:00.123Z'), '2026-03-16')
// A stamp with no offset states no zone. Handing it to `new Date` calls it
// local time — UTC on a serverless host — which moves a Mumbai evening onto the
// next morning for no reason anybody stated.
eq('a stamp with no offset is read where the account is', toBankDate('2026-03-15T19:30:00'), '2026-03-15')
eq('and so is the space-separated form', toBankDate('2026-03-15 19:30:00'), '2026-03-15')

console.log('\n── AND THE FETCH WINDOW ENDS TODAY, NOT YESTERDAY ──')
{
  // `end_date` was `new Date().toISOString().slice(0, 10)` — UTC. India is
  // UTC+5:30, so from midnight until 05:29 IST it named *yesterday*, and the
  // window excluded the day the user was standing in. Every morning, for every
  // Indian user: this morning's transactions were simply not asked for.
  const unfreeze = freezeClock('2026-03-15T19:30:00Z') // 01:00 IST on the 16th
  const got = today()
  unfreeze()
  eq('at 01:00 IST the window still ends today', got, '2026-03-16')
}
{
  // The control: the rest of the day must not be shifted forward.
  const unfreeze = freezeClock('2026-03-15T10:00:00Z') // 15:30 IST on the 15th
  const got = today()
  unfreeze()
  eq('and in the afternoon it is still the same day', got, '2026-03-15')
}
{
  const unfreeze = freezeClock('2026-03-15T18:29:00Z') // 23:59 IST on the 15th
  const got = today()
  unfreeze()
  eq('one minute before Indian midnight is still the 15th', got, '2026-03-15')
}

console.log('\n── AND A NON-DATE IS NOT A DAY ──')
eq('empty', toBankDate(''), null)
eq('null', toBankDate(null), null)
eq('undefined', toBankDate(undefined), null)
eq('a word', toBankDate('not a date'), null)
// `new Date('0')` is 1 January 2000 and `new Date('1')` is 2001 — a year, not a
// refusal. Anything that reached `new Date` unguarded could become a date.
eq('zero is not the year 2000', toBankDate(0), null)
eq('nor is one the year 2001', toBankDate('1'), null)
eq('a bare year is not a day', toBankDate('2026'), null)
eq('and neither is an epoch in milliseconds', toBankDate(1773532800000), null)
// Day-first is unparseable and is refused rather than guessed. Guessing is how
// 15/03 becomes 3 December somewhere downstream; providers send ISO.
eq('an ambiguous slash date is refused, not guessed', toBankDate('15/03/2026'), null)
eq('and so is a written-out date', toBankDate('March 15, 2026'), null)
// Shape alone was the whole check, so these went into the ledger verbatim.
eq('the thirtieth of February does not exist', toBankDate('2026-02-30'), null)
eq('nor does the thirty-first of April', toBankDate('2026-04-31'), null)
eq('nor month thirteen', toBankDate('2026-13-45'), null)
eq('and a timestamp on a day that does not exist is refused too', toBankDate('2026-02-30T10:00:00Z'), null)
// The control for all four of those: a real end-of-month date still reads.
eq('the twenty-ninth of February 2028 does exist', toBankDate('2028-02-29'), '2028-02-29')
eq('and the thirty-first of March', toBankDate('2026-03-31'), '2026-03-31')
eq('a padded date still reads', toBankDate('  2026-03-15  '), '2026-03-15')
eq('and an unpadded month and day are filled in', toBankDate('2026-3-5'), '2026-03-05')

// ── PLAID ────────────────────────────────────────────────────────────────────
const plaid = (rows, want = 'INR') => normalisePlaid(rows, want)

console.log('\n── PLAID: WHICH WAY THE MONEY WENT ──')
{
  const { transactions: t } = plaid([
    { date: '2026-03-15', amount: 100, name: 'Cement' },
    { date: '2026-03-15', amount: -250, merchant_name: 'Client' },
  ])
  eq('two rows in, two out', t.length, 2)
  // Plaid's convention: positive is money out of the account.
  eq('a positive amount is money going out', t[0].direction, 'debit')
  eq('a negative amount is money coming in', t[1].direction, 'credit')
  eq('and the amount is unsigned either way', t[1].amount, 250)
  eq('the merchant name wins over the raw one', t[1].description, 'Client')
  eq('and the raw one is used when there is no merchant', t[0].description, 'Cement')
}

console.log('\n── PLAID: WHAT NEVER REACHES THE LEDGER ──')
{
  const { transactions: t, skipped } = plaid([
    { date: '2026-03-15', amount: 0, name: 'Zero' },
    { date: '2026-03-15', name: 'No amount' },
    { amount: 10, name: 'No date' },
    { date: '2026-03-15', amount: 'abc', name: 'Words' },
    { date: '2026-03-15', amount: Infinity, name: 'Infinite' },
    { date: 'nonsense', amount: 10, name: 'Bad date' },
  ])
  eq('none of the six is importable', t.length, 0)
  eq('and all six are counted', skipped.unusable, 6)
  eq('with nothing blamed on currency', skipped.foreign, 0)
}
{
  // The control: the guards are narrow. A filter that dropped everything would
  // pass every assertion above.
  const { transactions: t, skipped } = plaid([
    { date: '2026-03-15', amount: 0, name: 'Zero' },
    { date: '2026-03-15', amount: 0.5, name: 'Half a rupee' },
  ])
  eq('a real row beside them survives', t.length, 1)
  eq('with its amount intact', t[0].amount, 0.5)
  eq('and only the other is counted', skipped.unusable, 1)
}
{
  const { transactions: t, skipped } = plaid(null)
  eq('a missing list is an empty list', t.length, 0)
  eq('and claims nothing was dropped', skipped.unusable, 0)
  eq('an object where a list belongs is the same', plaid({ transactions: [] }).transactions.length, 0)
  eq('as is a string', plaid('transactions').transactions.length, 0)
}

console.log('\n── PLAID: ANOTHER CURRENCY IS NOT ANOTHER AMOUNT ──')
{
  const { transactions: t, skipped } = plaid([
    { date: '2026-03-15', amount: 42, name: 'US charge', iso_currency_code: 'USD' },
    { date: '2026-03-15', amount: 100, name: 'Cement', iso_currency_code: 'INR' },
  ])
  eq('the dollar row is left out', t.length, 1)
  eq('and it is the rupee one that stayed', t[0].description, 'Cement')
  eq('the drop is counted as a currency drop', skipped.foreign, 1)
  eq('and not as an unusable row', skipped.unusable, 0)
}
{
  // Silence is not disagreement. AA payloads carry no currency at all, and a
  // Plaid row can carry `unofficial_currency_code` instead of the ISO one.
  const { transactions: t } = plaid([
    { date: '2026-03-15', amount: 1, name: 'No code' },
    { date: '2026-03-15', amount: 2, name: 'Null code', iso_currency_code: null },
    { date: '2026-03-15', amount: 3, name: 'Blank code', iso_currency_code: '  ' },
    { date: '2026-03-15', amount: 4, name: 'Lowercase', iso_currency_code: 'inr' },
  ])
  eq('a row that states no currency is kept', t.length, 4, JSON.stringify(t))
}
{
  // A deployment whose books are in dollars keeps the dollars and drops the
  // rupees — the guard is about disagreement, not about INR.
  const { transactions: t, skipped } = plaid([
    { date: '2026-03-15', amount: 42, name: 'US charge', iso_currency_code: 'USD' },
    { date: '2026-03-15', amount: 100, name: 'Cement', iso_currency_code: 'INR' },
  ], 'USD')
  eq('the books decide which one is foreign', t[0].description, 'US charge')
  eq('and the other is the one dropped', skipped.foreign, 1)
}

{
  // Every assertion above passes `want` explicitly, which would still pass if
  // nothing ever read the environment. This is the one that proves the default
  // is wired to a real setting.
  const prev = process.env.BANK_CURRENCY
  process.env.BANK_CURRENCY = 'GBP'
  const { transactions: t, skipped } = normalisePlaid([
    { date: '2026-03-15', amount: 7, name: 'Pounds', iso_currency_code: 'GBP' },
    { date: '2026-03-15', amount: 8, name: 'Rupees', iso_currency_code: 'INR' },
  ])
  if (prev === undefined) delete process.env.BANK_CURRENCY
  else process.env.BANK_CURRENCY = prev
  eq('BANK_CURRENCY decides, with no argument passed', t.length, 1, JSON.stringify(t))
  eq('and it is the one matching it that stayed', t[0].description, 'Pounds')
  eq('with the other counted', skipped.foreign, 1)
  // And the read is per call, not cached at import: the default is back.
  eq('the setting is read each time, not cached', normalisePlaid([
    { date: '2026-03-15', amount: 8, name: 'Rupees', iso_currency_code: 'INR' },
  ]).transactions.length, 1)
}

console.log('\n── WHAT COUNTS AS A FOREIGN CURRENCY ──')
ok('a different code does', foreignCurrency('USD', 'INR'))
ok('the same one does not', !foreignCurrency('INR', 'INR'))
ok('nor does the same one in lower case', !foreignCurrency('inr', 'INR'))
ok('nor one with space around it', !foreignCurrency(' INR ', 'INR'))
ok('saying nothing is not disagreeing', !foreignCurrency('', 'INR'))
ok('and neither is null', !foreignCurrency(null, 'INR'))
ok('nor undefined', !foreignCurrency(undefined, 'INR'))
// Nothing to contradict: a deployment with no currency configured cannot call a
// row foreign, and dropping every row on that basis would be worse than the bug.
ok('with no books currency, nothing is foreign', !foreignCurrency('USD', ''))

// ── ACCOUNT AGGREGATOR ───────────────────────────────────────────────────────
const aa = (txns, extra = {}) => ({
  accounts: [{ data: { account: { transactions: { transaction: txns } } } }],
  ...extra,
})
const setu = (txns, want = 'INR') => normaliseSetu(aa(txns), want)
const t0 = { amount: '1000', valueDate: '2026-03-15', narration: 'Steel' }

console.log('\n── AA: A DIRECTION IS STATED OR IT IS NOT GUESSED ──')
eq('DEBIT is money out', setu([{ ...t0, type: 'DEBIT' }]).transactions[0].direction, 'debit')
eq('CREDIT is money in', setu([{ ...t0, type: 'CREDIT' }]).transactions[0].direction, 'credit')
eq('lower case still reads', setu([{ ...t0, type: 'debit' }]).transactions[0].direction, 'debit')
// The XML→JSON shape. This is what made every such row a credit.
eq('an @type attribute reads', setu([{ ...t0, '@type': 'DEBIT' }]).transactions[0].direction, 'debit')
eq('an _type attribute reads', setu([{ ...t0, _type: 'DEBIT' }]).transactions[0].direction, 'debit')
{
  // The heart of it. An unsigned positive amount beside an unrecognised type
  // says nothing about direction, so there is no row to add. Booking it as a
  // credit — which is what happened — turns a payment into income.
  const { transactions: t, skipped } = setu([
    { ...t0, type: 'OTHER' },
    { ...t0, type: 'REVERSAL' },
    { ...t0 },
    { ...t0, type: '' },
  ])
  eq('OTHER, REVERSAL, missing and blank all drop', t.length, 0, JSON.stringify(t))
  eq('and all four are counted', skipped.unusable, 4)
}
{
  // A signed amount is real information, and the file importer honours it the
  // same way (src/lib/statement.js:149). A negative is money out.
  const { transactions: t } = setu([{ ...t0, amount: '-1000' }])
  eq('a negative amount with no type is money out', t[0].direction, 'debit')
  eq('and its amount is unsigned', t[0].amount, 1000)
}
{
  // The control for the whole block: the type rules are narrow, so a good row
  // beside the refused ones still imports.
  const { transactions: t, skipped } = setu([{ ...t0, type: 'OTHER' }, { ...t0, type: 'DEBIT' }])
  eq('a stated direction beside an unstated one survives', t.length, 1)
  eq('with the right direction', t[0].direction, 'debit')
  eq('and only the other counted', skipped.unusable, 1)
}

console.log('\n── AA: THE SHAPES A PAYLOAD ARRIVES IN ──')
{
  // `j.fips?.flatMap(...) || j.accounts || []` could never reach the second
  // branch, because an empty array is truthy.
  const r = normaliseSetu({
    fips: [],
    accounts: [{ data: { account: { transactions: { transaction: [{ ...t0, type: 'DEBIT' }] } } } }],
  })
  eq('an empty fips list falls back to accounts', r.transactions.length, 1)
}
{
  const r = normaliseSetu({
    fips: [{ accounts: [{ data: { account: { transactions: { transaction: [{ ...t0, type: 'DEBIT' }] } } } }] }],
  })
  eq('and a populated fips list is read', r.transactions.length, 1)
}
{
  // The control: `fips` is still preferred when it holds something, so the
  // fallback has not become the only path.
  const r = normaliseSetu({
    fips: [{ accounts: [{ data: { account: { transactions: { transaction: [{ ...t0, type: 'DEBIT', narration: 'From fips' }] } } } }] }],
    accounts: [{ data: { account: { transactions: { transaction: [{ ...t0, type: 'DEBIT', narration: 'From accounts' }] } } } }],
  })
  eq('fips wins when it has accounts', r.transactions[0].description, 'From fips')
}
{
  // An XML conversion collapses a one-element list to a bare object, and
  // `for (const t of anObject)` throws — a flat 502 for an account that
  // happened to have a single transaction in the window.
  const r = normaliseSetu({
    accounts: [{ data: { account: { transactions: { transaction: { ...t0, type: 'DEBIT' } } } } }],
  })
  eq('a single collapsed transaction imports as one row', r.transactions.length, 1)
  eq('with its narration', r.transactions[0].description, 'Steel')
}
{
  const r = normaliseSetu({ accounts: [{ Transactions: { Transaction: [{ ...t0, type: 'CREDIT' }] } }] })
  eq('the capitalised XML shape reads too', r.transactions.length, 1)
}
for (const [label, payload] of [
  ['null', null],
  ['a string', 'transactions'],
  ['an empty object', {}],
  ['accounts holding a string', { accounts: 'none' }],
  ['an account with no transactions', { accounts: [{}] }],
  ['transactions holding a number', { accounts: [{ data: { account: { transactions: { transaction: 7 } } } }] }],
]) {
  const r = normaliseSetu(payload)
  ok(`${label} yields nothing and does not throw`, r.transactions.length === 0 && r.skipped.unusable === 0)
}

console.log('\n── AA: DATES AND CURRENCY ──')
eq(
  'a transactionTimestamp is used when there is no value date',
  normaliseSetu(aa([{ type: 'DEBIT', amount: '5', transactionTimestamp: '2026-03-15T19:30:00Z' }])).transactions[0].date,
  '2026-03-16',
)
eq(
  'and the value date wins when both are there',
  normaliseSetu(aa([{ type: 'DEBIT', amount: '5', valueDate: '2026-03-14', transactionTimestamp: '2026-03-15T19:30:00Z' }])).transactions[0].date,
  '2026-03-14',
)
{
  const { transactions: t, skipped } = setu([
    { ...t0, type: 'DEBIT', currency: 'USD' },
    { ...t0, type: 'DEBIT', currency: 'INR' },
    { ...t0, type: 'DEBIT' },
  ])
  eq('a stated foreign currency drops here too', t.length, 2)
  eq('and is counted', skipped.foreign, 1)
}
{
  const { transactions: t, skipped } = setu([
    { type: 'DEBIT', amount: '0', valueDate: '2026-03-15' },
    { type: 'DEBIT', valueDate: '2026-03-15' },
    { type: 'DEBIT', amount: '100' },
  ])
  eq('zero, no amount and no date all drop', t.length, 0)
  eq('and are counted', skipped.unusable, 3)
}

// ── SAYING WHAT WAS LEFT OUT ─────────────────────────────────────────────────
console.log('\n── A SYNC THAT DROPPED ROWS SAYS SO ──')
eq('nothing to say says nothing', leftOutNote({ unusable: 0, foreign: 0 }), '')
eq('no counts at all say nothing', leftOutNote(null), '')
eq('and neither does a number', leftOutNote(7), '')
ok('one foreign row is singular', leftOutNote({ foreign: 1 }).includes('1 row in another currency'), leftOutNote({ foreign: 1 }))
ok('two are plural', leftOutNote({ foreign: 2 }).includes('2 rows in another currency'), leftOutNote({ foreign: 2 }))
ok('unusable rows are named differently', leftOutNote({ unusable: 3 }).includes('3 with no usable date or amount'), leftOutNote({ unusable: 3 }))
{
  const note = leftOutNote({ foreign: 2, unusable: 1 })
  ok('both are said at once', note.includes('2 rows in another currency') && note.includes('1 with no usable'), note)
}
eq('a negative count says nothing', leftOutNote({ foreign: -4 }), '')
eq('nor does a word', leftOutNote({ foreign: 'lots' }), '')
eq('nor NaN', leftOutNote({ foreign: NaN }), '')

// ── THE CLIENT ───────────────────────────────────────────────────────────────
const stubFetch = (fn) => {
  const prev = globalThis.fetch
  globalThis.fetch = fn
  return () => { globalThis.fetch = prev }
}
const reply = (status, body, asText = false) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    if (asText) throw new Error('not json')
    return body
  },
})
const caught = async (fn) => {
  try {
    await fn()
    return null
  } catch (e) {
    return e
  }
}

console.log('\n── A FAILED SYNC IS NOT AN EMPTY BANK ──')
{
  // The one that mattered most: this returned `[]` for any 200 whose body was
  // not what it expected, and the screen renders `[]` as "No transactions found
  // in that source" — telling somebody their bank had nothing to say.
  for (const [label, body] of [
    ['a null list', { transactions: null }],
    ['a renamed key', { txns: [] }],
    ['an object', { transactions: {} }],
    ['nothing at all', {}],
    ['a bare string', 'ok'],
  ]) {
    const restore = stubFetch(reply(200, body))
    const e = await caught(() => fetchLiveTransactions({}))
    restore()
    eq(`${label} is reported, not emptied`, e?.code, 'unreadable_reply')
  }
}
{
  // The control. A genuinely empty window is still an empty window.
  const restore = stubFetch(reply(200, { transactions: [] }))
  const r = await fetchLiveTransactions({})
  restore()
  eq('a real empty list comes back empty', r.transactions.length, 0)
  eq('and reports no counts rather than zeroes', r.skipped, null)
}
{
  const restore = stubFetch(reply(200, {
    transactions: [{ date: '2026-03-15', amount: 100, direction: 'debit', description: 'Cement' }],
    skipped: { unusable: 1, foreign: 2 },
  }))
  const r = await fetchLiveTransactions({})
  restore()
  eq('the rows come through', r.transactions.length, 1)
  eq('and so do the counts', r.skipped?.foreign, 2)
  ok('which turn into something a person can read', leftOutNote(r.skipped).includes('2 rows in another currency'))
}

console.log('\n── AND THE SERVER’S OWN REASON SURVIVES THE TRIP ──')
for (const [status, code] of [[501, 'not_configured'], [401, 'unauthorized'], [502, 'request_failed'], [500, 'request_failed'], [400, 'request_failed']]) {
  const restore = stubFetch(reply(status, { error: 'setu_fetch_502' }))
  const e = await caught(() => fetchLiveTransactions({}))
  restore()
  eq(`a ${status} is ${code}`, e?.code, code)
}
{
  // It used to throw one sentence over every failure, discarding the only
  // diagnostic anybody had — and "please try again" is wrong advice for most of
  // them.
  const restore = stubFetch(reply(502, { error: 'plaid_exchange_400' }))
  const e = await caught(() => fetchLiveTransactions({}))
  restore()
  ok('the provider’s own code is in the message', e?.message.includes('plaid_exchange_400'), e?.message)
  eq('and the status is kept', e?.status, 502)
}
{
  // An error page served as HTML, or nothing at all.
  const restore = stubFetch(reply(500, null, true))
  const e = await caught(() => fetchLiveTransactions({}))
  restore()
  ok('a non-JSON failure still names the status', e?.message.includes('500'), e?.message)
}

console.log('\n── WHO THE LINK IS FOR IS NOT THE CLIENT’S TO SAY ──')
{
  // Both handlers verified the token and then took `body.userId`, which this
  // client never sent — so Plaid was handed `client_user_id: 'offset-user'`,
  // one identity shared by every user of the deployment, and Setu `vua: ''`.
  let sent = null
  const restore = stubFetch(async (url, init) => {
    sent = { url, body: init?.body }
    return { ok: true, status: 200, json: async () => ({ provider: 'plaid', linkToken: 'lt' }) }
  })
  const out = await startBankLink()
  restore()
  eq('the link token comes back', out.linkToken, 'lt')
  eq('the body carries no identity', sent.body, '{}')
  ok('and nothing resembling a user id is in it', !/user/i.test(sent.body), sent.body)
  eq('it posts to the link endpoint', sent.url, '/api/bank/link')
}

console.log('\n── WHICH PROVIDER IS ACTUALLY RUNNING ──')
{
  // VITE_BANK_PROVIDER (client) and BANK_PROVIDER (server) default
  // independently, so setting only the server one left the badge reading
  // "Plaid" over an Account Aggregator flow. The GET exists to settle it and
  // was never called.
  const restore = stubFetch(reply(200, { ok: true, configured: true, provider: 'setu' }))
  eq('the server is asked and answers', await serverBankProvider(), 'setu')
  restore()
}
{
  const restore = stubFetch(reply(200, { provider: 'SETU' }))
  eq('the answer is normalised', await serverBankProvider(), 'setu')
  restore()
}
{
  const cases = [
    ['a 500 answers nothing', reply(500, { error: 'x' })],
    ['a body with no provider answers nothing', reply(200, { ok: true })],
    ['a non-string provider answers nothing', reply(200, { provider: 7 })],
    ['an unparseable body answers nothing', reply(200, null, true)],
    ['and a network failure answers nothing', async () => { throw new Error('offline') }],
  ]
  for (const [label, stub] of cases) {
    const restore = stubFetch(stub)
    const got = await serverBankProvider()
    restore()
    eq(label, got, null)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
