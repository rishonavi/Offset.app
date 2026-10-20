// What leaves the browser when somebody reports a bug.
//
// `reports.js` had no tests, and its header makes a promise that is unusually
// easy to break by accident: "describeDiagnostics() returns the exact list shown
// in the dialog before sending… If it isn't in here, it isn't attached. What is
// deliberately NOT collected: names, amounts, vendors, addresses, tenants,
// documents — the ledger itself. Only counts of it."
//
// Three ways it was not keeping it, all measured:
//
//   1. **Stacks were collected and transmitted that nothing ever displayed.**
//      `recentErrors()` carries a `stack` on every entry, up to eight at 600
//      characters each. The row list does not show it, `formatReportText` does
//      not send it, and `Admin.jsx` renders `diagnostics.crash.stack` and
//      nothing else — but `submitReportToCloud` posts `report.diagnostics`
//      whole, so they went to the inbox where no human ever saw them. Measured
//      at 3,364 bytes of diagnostics against the 976 the report carried.
//   2. **The stack that *is* sent was never disclosed.** `formatReportText`
//      appends a STACK section and the admin inbox renders it, but the list
//      shown before sending never said it existed.
//   3. **`describeDiagnostics` crashed on a diagnostics object without
//      `counts`** — `Cannot read properties of undefined (reading 'assets')`.
//      `crash` and `errors` beside it were read optionally; this one was not,
//      and it is called on objects from Postgres (Admin.jsx:486) and from
//      localStorage, neither of which this code wrote.
//
// Plus two failures of the parts around it: a `mailto:` long enough for the mail
// client to cut it silently, and an outbox that read an unparseable key as empty
// and then wrote over it.
import {
  REPORT_KINDS, kindLabel, routePattern, browserSummary,
  collectDiagnostics, describeDiagnostics, validateReport, newReference,
  formatReportText, mailtoLink, MAILTO_LIMIT,
  listReports, saveReport, markReportSent, deleteReport,
} from '../../src/lib/reports.js'
import { recordError } from '../../src/lib/errorLog.js'
import { unreadable, whyUnreadable, forgetUnreadable, SALVAGE_SUFFIX } from '../../src/lib/storage/salvage.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

console.log('── THE KINDS OF REPORT ──')
ok('each has an id, a label and a hint field', REPORT_KINDS.every((k) => k.id && k.label && 'hint' in k))
ok('no two share an id', new Set(REPORT_KINDS.map((k) => k.id)).size === REPORT_KINDS.length)
for (const k of REPORT_KINDS) eq(`${k.id} has a label`, kindLabel(k.id), k.label)
// `formatReportText` and the email subject both run through this, so an
// unrecognised kind must still produce a line somebody can read.
eq('an unknown kind still says something', kindLabel('nonsense'), 'Report')
eq('and so does no kind at all', kindLabel(undefined), 'Report')

console.log('\n── A PAGE, NOT A ROW ──')
// "A report about /properties/8f3e-… is a report about the asset page", and the
// id is a pointer at the user's private data. Every dynamic segment in App.jsx
// is an `:id`, so these are all of them.
eq('a UUID is a page', routePattern('/properties/8f3e1a2b-1111-2222-3333-444455556666'), '/properties/:id')
eq('a numeric id too', routePattern('/expenses/42'), '/expenses/:id')
// The shape local.js falls back to when crypto.randomUUID is missing.
eq('and the demo fallback id', routePattern('/x/id-q3axwz78hlamvgfy0it'), '/x/:id')
eq('a long hex string as well', routePattern('/x/deadbeefcafe'), '/x/:id')
eq('an edit route keeps its tail', routePattern('/properties/8f3e1a2b-1111-2222-3333-444455556666/edit'), '/properties/:id/edit')
// A query string can carry anything the app ever put in one.
eq('a query string is dropped', routePattern('/expenses/42?q=acme%20cement'), '/expenses/:id')
eq('and so is a hash', routePattern('/reports#top'), '/reports')
// Controls: a page name is not an id, or every report would be about ":id".
eq('a page name survives', routePattern('/reports'), '/reports')
eq('a short word survives', routePattern('/sites/abc'), '/sites/abc')
eq('eight hex characters are not an id', routePattern('/x/deadbeef'), '/x/deadbeef')
eq('nothing is the root', routePattern(''), '/')
eq('and so is null', routePattern(null), '/')
eq('the root stays the root', routePattern('/'), '/')

console.log('\n── A BROWSER SOMEBODY CAN ACT ON ──')
const UA = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  opera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  linuxChrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
}
eq('Chrome on Windows', browserSummary(UA.chrome), 'Chrome 131 on Windows')
// Edge and Opera both claim to be Chrome, and both are tested before it.
eq('Edge is not reported as Chrome', browserSummary(UA.edge), 'Edge 131 on Windows')
eq('nor is Opera', browserSummary(UA.opera), 'Opera 115 on Windows')
// Safari claims to be Chrome's engine; the version comes from Version/, not
// Safari/, or every iPhone would report "Safari 604".
eq('Safari on iOS', browserSummary(UA.iphone), 'Safari 17 on iOS')
eq('Safari on a Mac', browserSummary(UA.macSafari), 'Safari 18 on macOS')
eq('Firefox on Android', browserSummary(UA.firefoxAndroid), 'Firefox 131 on Android')
eq('Chrome on Linux', browserSummary(UA.linuxChrome), 'Chrome 129 on Linux')
eq('nothing at all still reads as a sentence', browserSummary(''), 'Unknown browser on Unknown OS')
eq('and so does a string nobody recognises', browserSummary('curl/8.4.0'), 'Unknown browser on Unknown OS')
// The whole reason this exists: the 130-character string must not travel.
ok('no user-agent string survives intact', Object.values(UA).every((ua) => !browserSummary(ua).includes('AppleWebKit')))
ok('and none of them is longer than a phrase', Object.values(UA).every((ua) => browserSummary(ua).length < 40))

console.log('\n── WHAT IS COLLECTED ──')
// The ring starts empty in a fresh process, so there is nothing to clear — and
// the log's clear-the-ring export is deliberately left unmentioned, because
// naming it here would silence its entry in deadwiring.test.mjs, which is a note
// someone should act on rather than one a test should quietly retire.
// Two different stacks on purpose. The crash the user is reporting keeps its
// stack and is sent under its own heading; the ring's are no longer collected at
// all, and sharing one fixture between them would make that assertion unable to
// fail.
const STACK = 'Error: boom\n    at Dashboard (/assets/D.js:1:2)\n    at renderWithHooks (/assets/i.js:1:3)\n    at mount (/assets/i.js:1:4)'
const RING_STACK = 'Error: ring\n    at ringOnlyFrame (/assets/r.js:9:9)'
for (let i = 0; i < 8; i++) recordError('render', `Cannot read properties of undefined (reading 'x${i}')`, RING_STACK)
const diag = collectDiagnostics({
  route: '/properties/8f3e1a2b-1111-2222-3333-444455556666',
  theme: 'dark', textSize: 'large', backend: 'cloud', plan: 'pro',
  counts: { assets: 4, expenses: 820, income: 311 },
  error: Object.assign(new Error('Boom in the ledger'), { stack: STACK }),
})
eq('the route is reduced to a page', diag.route, '/properties/:id')
eq('the counts come through', diag.counts.expenses, 820)
ok('with a stamp for when', /^\d{4}-\d{2}-\d{2}T/.test(diag.at))
eq('eight errors are carried', diag.errors.length, 8)
// The fix. Every entry in the ring carried a stack that nothing displayed, and
// `submitReportToCloud` posts this object whole.
ok('no error in the ring carries a stack', diag.errors.every((e) => !('stack' in e)))
ok('and no ring frame appears anywhere in the object', !JSON.stringify(diag).includes('ringOnlyFrame'))
ok('but each still says what went wrong', diag.errors.every((e) => e.message.includes('Cannot read')))
ok('and when, and how many times', diag.errors.every((e) => e.at && e.count >= 1))
// The control: the crash the user is actually reporting keeps its stack,
// because that one is sent under its own heading and the inbox renders it.
ok('the reported crash keeps its stack', diag.crash.stack.includes('at Dashboard'))
eq('and its message', diag.crash.message, 'Boom in the ledger')
// Measured: 3,364 bytes before, well under 2,000 after.
ok('the whole object is smaller than the stacks made it', JSON.stringify(diag).length < 2000, String(JSON.stringify(diag).length))
// Nothing from the ledger itself — the promise in the header.
{
  const text = JSON.stringify(diag)
  ok('no amount, vendor or name appears anywhere in it',
    !/acme|cement|₹|vendor|tenant|address/i.test(text), text.slice(0, 200))
}
{
  const bare = collectDiagnostics()
  eq('with no arguments the route is the root', bare.route, '/')
  eq('the backend defaults to demo', bare.backend, 'demo')
  eq('counts default to nothing rather than undefined', bare.counts.assets, 0)
  eq('and there is no crash', bare.crash, null)
  eq('with no window there is no viewport', bare.viewport, '')
}

console.log('\n── WHAT IS DISCLOSED BEFORE IT IS SENT ──')
{
  const rows = describeDiagnostics(diag)
  const labels = rows.map((r) => r.label)
  const value = (l) => rows.find((r) => r.label === l)?.value
  for (const l of ['Page', 'Offset version', 'Browser', 'Appearance', 'Storage', 'Plan', 'Portfolio size']) {
    ok(`${l} is on the list`, labels.includes(l), labels.join(' | '))
  }
  eq('the portfolio is a count, not a ledger', value('Portfolio size'), '4 assets, 1131 entries')
  eq('the page is the pattern', value('Page'), '/properties/:id')
  eq('the error on screen is named', value('Error on screen'), 'Boom in the ledger')
  // The second fix: the stack is sent, so its existence is stated.
  eq('and so is the stack that travels with it', value('Technical detail'), '4 lines of stack trace')
  ok('the frames themselves are not dumped into the consent list',
    !JSON.stringify(rows).includes('at Dashboard'), JSON.stringify(rows).slice(0, 200))
  ok('the error ring is summarised by count', labels.some((l) => l.startsWith('Recent errors (8)')))
  ok('every row is a label and a string', rows.every((r) => typeof r.label === 'string' && typeof r.value === 'string'))
}
{
  // The control for the disclosure: a report with no crash must not claim one.
  const clean = describeDiagnostics(collectDiagnostics({ route: '/x', counts: { assets: 1, expenses: 2, income: 3 } }))
  ok('no crash means no stack row', !clean.some((r) => r.label === 'Technical detail'), JSON.stringify(clean))
  ok('and no error row either', !clean.some((r) => r.label === 'Error on screen'))
  ok('while the page is still there', clean.some((r) => r.label === 'Page'))
}
{
  // The crash. Admin.jsx hands this a `diagnostics` column out of Postgres and
  // formatReportText hands it one out of localStorage.
  // Caught rather than thrown, so this fails as a line in the output instead of
  // taking the suite down with it — the failure mode under test is a crash.
  let rows = null
  try {
    rows = describeDiagnostics({ route: '/x', version: 'dev', browser: 'b', viewport: '1×1', backend: 'demo' })
  } catch {
    /* the crash this guard exists to prevent */
  }
  ok('an object with no counts does not throw', Array.isArray(rows))
  eq('and reads as an empty portfolio', rows.find((r) => r.label === 'Portfolio size')?.value, '0 assets, 0 entries')
  let odd = null
  try {
    odd = describeDiagnostics({ counts: { assets: 'four', expenses: null, income: undefined } })
  } catch {
    /* same shape, different contents */
  }
  ok('counts that are not numbers are not arithmetic',
    odd?.find((r) => r.label === 'Portfolio size')?.value === '0 assets, 0 entries', JSON.stringify(odd))
}
eq('no diagnostics at all is an empty list', describeDiagnostics(null).length, 0)
eq('and so is undefined', describeDiagnostics(undefined).length, 0)
{
  // Empty values are dropped rather than shown as blank rows.
  const rows = describeDiagnostics({ route: '/x', version: 'dev', plan: '', theme: '', textSize: '', browser: '', viewport: '', backend: 'demo', counts: {} })
  ok('an empty plan is left out', !rows.some((r) => r.label === 'Plan'), JSON.stringify(rows))
  ok('an empty appearance is left out', !rows.some((r) => r.label === 'Appearance'))
  ok('every value shown is non-empty', rows.every((r) => r.value !== ''))
}

console.log('\n── WHETHER IT IS WORTH SENDING ──')
ok('an empty message is refused', !!validateReport({}).message)
ok('so is whitespace', !!validateReport({ message: '   ' }).message)
ok('and so is one word', !!validateReport({ message: 'broken' }).message)
ok('ten characters is enough', !validateReport({ message: 'it crashed' }).message)
ok('a real sentence passes', !validateReport({ message: 'It crashed when I opened the asset page.' }).message)
ok('no email is fine — it is optional', !validateReport({ message: 'it crashed' }).email)
ok('an empty email is fine too', !validateReport({ message: 'it crashed', email: '  ' }).email)
ok('a real one passes', !validateReport({ message: 'it crashed', email: 'a@b.co' }).email)
for (const bad of ['notanemail', 'a@b', 'a b@c.co', '@b.co', 'a@.co', 'a@b.']) {
  ok(`"${bad}" is refused`, !!validateReport({ message: 'it crashed', email: bad }).email)
}
ok('a bad email and a bad message are both reported', Object.keys(validateReport({ email: 'x' })).length === 2)

console.log('\n── THE REFERENCE ──')
{
  const refs = Array.from({ length: 400 }, newReference)
  ok('each starts with OF-', refs.every((r) => r.startsWith('OF-')))
  ok('each is the same length', new Set(refs.map((r) => r.length)).size === 1)
  // "No vowels, so it can't spell anything unfortunate."
  ok('none contains a vowel', refs.every((r) => !/[AEIOU]/.test(r.slice(3))))
  ok('and none a lower-case letter', refs.every((r) => r.slice(3) === r.slice(3).toUpperCase()))
  ok('four hundred draws collide rarely enough to be useful', new Set(refs).size > 395, String(new Set(refs).size))
  ok('and it is short enough to read down a phone', refs[0].length <= 12, refs[0])
}

console.log('\n── THE TEXT THAT ACTUALLY GOES ──')
const report = {
  reference: 'OF-BCDFGH', kind: 'broken', created_at: '2026-10-20T09:00:00.000Z',
  email: 'me@example.com', message: 'It crashed when I opened the asset page.',
  expected: 'The page to open.', diagnostics: diag,
}
{
  const text = formatReportText(report)
  ok('it leads with the reference', text.startsWith('Offset report OF-BCDFGH'))
  ok('it names the kind in words', text.includes('Type: Something is broken'))
  ok('it says where to reply', text.includes('Reply to: me@example.com'))
  ok('it carries what happened', text.includes('WHAT HAPPENED') && text.includes('opened the asset page'))
  ok('and what was expected', text.includes('WHAT I EXPECTED') && text.includes('The page to open.'))
  ok('the diagnostics are the disclosed rows', text.includes('Page: /properties/:id') && text.includes('Portfolio size: 4 assets'))
  ok('the stack goes under its own heading', text.includes('STACK') && text.includes('at Dashboard'))
  // The ring's stacks are not in here either — they are no longer collected.
  ok('but not the ring’s stacks', !text.includes('ringOnlyFrame'))
}
{
  const anon = formatReportText({ ...report, email: '', expected: '  ', diagnostics: null })
  ok('no email says so rather than leaving a blank', anon.includes('Reply to: (not given)'))
  ok('an empty "expected" section is left out', !anon.includes('WHAT I EXPECTED'))
  ok('and declining diagnostics is stated', anon.includes('chose not to attach'))
  ok('while what happened is still there', anon.includes('WHAT HAPPENED'))
}

console.log('\n── AND THE EMAIL LINK ──')
eq('with no support address there is no link', mailtoLink(report, ''), '')
eq('and none when the deployment has not set one', mailtoLink(report, '   '), '')
{
  const href = mailtoLink(report, 'support@example.com')
  ok('it is a mailto to that address', href.startsWith('mailto:support@example.com?'))
  ok('the subject carries the reference', decodeURIComponent(href).includes('Offset OF-BCDFGH'))
  ok('the body is the report', decodeURIComponent(href).includes('WHAT HAPPENED'))
  ok('and a normal report fits', href.length <= MAILTO_LIMIT, String(href.length))
  ok('with nothing cut', !decodeURIComponent(href).includes('Cut short'))
}
{
  // People write paragraphs. Outlook cuts around 2,048 characters without
  // saying so, which means a report sent and half-delivered.
  const long = mailtoLink({ ...report, message: 'It crashed. '.repeat(400) }, 'support@example.com')
  ok('a long report still fits the limit', long.length <= MAILTO_LIMIT, String(long.length))
  ok('and says it was cut', decodeURIComponent(long).includes('Cut short'))
  ok('pointing at where the whole thing is', decodeURIComponent(long).includes('Settings'))
  ok('keeping the part that matters most', decodeURIComponent(long).includes('WHAT HAPPENED'))
  ok('and still a valid single link', !/\s/.test(long))
}

console.log('\n── THE OUTBOX ──')
const makeStore = (initial = {}) => {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  }
}
const withStore = (store, fn) => {
  const prev = globalThis.localStorage
  globalThis.localStorage = store
  try { return fn() } finally { globalThis.localStorage = prev }
}
forgetUnreadable()
{
  const s = makeStore()
  withStore(s, () => {
    eq('a fresh browser has no reports', listReports().length, 0)
    const r = saveReport({ kind: 'broken', message: 'it crashed on me', email: ' a@b.co ' }, diag)
    ok('saving gives back a reference', r.reference.startsWith('OF-'))
    ok('and an id', !!r.id)
    eq('the message is trimmed', r.message, 'it crashed on me')
    eq('so is the email', r.email, 'a@b.co')
    eq('it starts out saved, not sent', r.status, 'saved')
    eq('and it is in the outbox', listReports().length, 1)
    eq('with its diagnostics', listReports()[0].diagnostics.route, '/properties/:id')
    const sent = markReportSent(r.id, 'email')
    eq('marking it sent records how', sent.sent_how, 'email')
    eq('and that it was', sent.status, 'sent')
    ok('with a time', !!sent.sent_at)
    eq('the outbox still holds one', listReports().length, 1)
    eq('and it is the sent one', listReports()[0].status, 'sent')
    deleteReport(r.id)
    eq('deleting removes it', listReports().length, 0)
  })
}
{
  const s = makeStore()
  withStore(s, () => {
    const r = saveReport({ message: 'no kind given at all' }, null)
    eq('a report with no kind is filed as other', r.kind, 'other')
    eq('and with no diagnostics attached', r.diagnostics, null)
    eq('marking an id nobody has changes nothing', markReportSent('nope', 'email'), undefined)
    eq('and leaves the outbox alone', listReports().length, 1)
    eq('as does deleting one', (deleteReport('nope'), listReports().length), 1)
    eq('the saved one is untouched', listReports()[0].id, r.id)
  })
}
{
  // Fifty is the ceiling, and it keeps the newest.
  const s = makeStore()
  withStore(s, () => {
    for (let i = 0; i < 55; i++) saveReport({ message: `report number ${i}` }, null)
    const kept = listReports()
    eq('the outbox stops at fifty', kept.length, 50)
    ok('and it is the newest fifty', kept[kept.length - 1].message.includes('54'), kept[kept.length - 1].message)
    ok('the oldest are the ones gone', !kept.some((r) => r.message.includes('number 0')))
  })
}
{
  // The one this module exists to prevent. An unparseable key read as `[]`,
  // which is indistinguishable from an empty outbox, and the next save wrote
  // `[theOneNewReport]` over it.
  forgetUnreadable()
  const s = makeStore({ pl_reports: '[{"id":"r1","message":"the one I filed yester' })
  withStore(s, () => {
    eq('a damaged outbox reads as empty', listReports().length, 0)
    ok('but it is noted as damaged', unreadable().includes('pl_reports'), unreadable().join(','))
    ok('with a reason', !!whyUnreadable('pl_reports'))
    ok('and the raw text is copied aside before anything writes', s.map.has('pl_reports' + SALVAGE_SUFFIX))
    ok('intact', s.map.get('pl_reports' + SALVAGE_SUFFIX).includes('filed yester'))
    saveReport({ message: 'and now this one' }, null)
    ok('the copy survives the next save', s.map.get('pl_reports' + SALVAGE_SUFFIX).includes('filed yester'))
    eq('which is what makes the overwrite recoverable', listReports().length, 1)
  })
}
{
  // The control: a readable outbox is not marked, and nothing is copied aside.
  forgetUnreadable()
  const s = makeStore({ pl_reports: JSON.stringify([{ id: 'r1', message: 'fine' }]) })
  withStore(s, () => {
    eq('a readable one comes back whole', listReports().length, 1)
    eq('with no copy taken', s.map.has('pl_reports' + SALVAGE_SUFFIX), false)
    eq('and nothing marked', unreadable().length, 0)
  })
}
{
  // An object where a list belongs — the shape that made `[...rows]` throw
  // elsewhere in this app.
  forgetUnreadable()
  const s = makeStore({ pl_reports: '{"id":"r1"}' })
  withStore(s, () => {
    eq('an object where a list belongs reads as empty', listReports().length, 0)
    ok('and is noted', unreadable().includes('pl_reports'))
  })
}
{
  // No room left. The message has to say what still works, because the report
  // is on screen and copying needs no storage at all.
  const s = makeStore()
  s.setItem = () => { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e }
  withStore(s, () => {
    let message = ''
    try { saveReport({ message: 'it crashed on me' }, diag) } catch (e) { message = e.message }
    ok('a full browser says so', /no room/i.test(message), message)
    ok('and says to copy it instead', /copy/i.test(message), message)
  })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
