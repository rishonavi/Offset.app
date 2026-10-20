// Vercel serverless: fetch transactions from the linked bank and normalise them
// to Offset's shape — { date:'YYYY-MM-DD', amount:>0, direction:'debit'|'credit',
// description } — the SAME shape parseStatement() produces for file imports, so
// the client feeds them straight into reconcile(). Scaffold; needs credentials.
//
// Env: see api/bank/link.js.

import { requireUser } from '../_auth.js'

export const config = { maxDuration: 30 }

const provider = () => (process.env.BANK_PROVIDER || 'plaid').toLowerCase()
const plaidConfigured = () => !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET)
const setuConfigured = () => !!(process.env.SETU_CLIENT_ID && process.env.SETU_CLIENT_SECRET)
const configured = () => (provider() === 'setu' ? setuConfigured() : plaidConfigured())

const PLAID_HOSTS = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com',
}
// The day it is where the account is, not where the server is.
//
// `new Date().toISOString().slice(0, 10)` is UTC, and India is UTC+5:30, so
// between midnight and 05:29 IST it names yesterday — making `end_date`
// exclude the current day for every Indian user, every morning.
const ZONE = process.env.BANK_TIMEZONE || 'Asia/Kolkata'
const dayIn = (date, zone = ZONE) => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}
// Exported so the one thing that can go wrong with it can be asserted under a
// frozen clock, rather than only on a machine that happens to be east of UTC.
export const today = () => dayIn(new Date())

// The currency the books are kept in. A deployment sets `VITE_CURRENCY` for the
// client and the serverless functions are handed the same environment, so there
// is one answer here rather than two that can drift apart; `BANK_CURRENCY`
// exists for a deployment whose bank is in a different currency from its books,
// which is exactly the case this guard is about.
// Read per call, like `provider()` and the two `*Configured()` above it: a
// serverless file that caches an env var at import time answers with whatever
// was set the first time a warm instance was built.
const booksCurrency = () =>
  String(process.env.BANK_CURRENCY || process.env.VITE_CURRENCY || 'INR').trim().toUpperCase()

// Whether a row's own currency contradicts the books.
//
// Nothing read Plaid's `iso_currency_code`, so a $42 transaction arrived as
// `42` and `formatCurrency` rendered it **₹42** — a figure wrong by a factor of
// ninety, presented as a fact and reconciled against real bills. There is no
// conversion to do here: this app holds no exchange rates, and inventing one at
// import time would bake a guess into the ledger permanently. So a row that
// says it is in another currency is left out, and counted so it can be named.
//
// A row that says *nothing* is not a contradiction. AA payloads carry no
// currency field at all — the framework is Indian and the amounts are INR by
// construction — and a Plaid row can carry `unofficial_currency_code` in place
// of the ISO one. Silence is accepted; disagreement is not.
export const foreignCurrency = (code, want = booksCurrency()) => {
  const got = String(code ?? '').trim().toUpperCase()
  return !!got && !!want && got !== want
}

// A day that exists, or nothing.
//
// Shape is not enough, and asking `new Date` is not either: `2026-02-30` is
// rolled over to 2 March rather than refused, so an impossible date becomes a
// plausible one. The round trip is what catches that.
const plainDay = (text) => {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  if (!m) return null
  const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  const probe = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(probe.getTime())) return null
  return probe.toISOString().slice(0, 10) === iso ? iso : null
}

// A provider's date, as a date.
//
// This used to be `String(whatever).slice(0, 10)`, which is right for a plain
// `YYYY-MM-DD` and wrong for everything else:
//
//   • A timestamp was truncated rather than read. An AA transaction stamped
//     `2026-03-15T19:30:00Z` is 01:00 on the 16th in Indian time and landed on
//     the 15th.
//   • Anything `new Date` would accept got through. `date: 0` became
//     **1 January 2000** — `new Date('0')` is a year, not a refusal — and `1`
//     became 2001.
//   • An impossible date passed the shape test unexamined: `2026-02-30` was
//     returned verbatim and went into the ledger as written.
//
// So the accepted forms are now exactly the two ISO ones a provider sends: a
// bare day, taken as given because it is the bank's own value date and carries
// no zone to get wrong, and a day followed by a time, resolved in the account's
// zone. Anything else is refused and counted — a dropped row somebody can see
// beats an invented date nobody can.
export function toBankDate(value) {
  const text = String(value ?? '').trim()
  const bare = plainDay(text)
  if (bare) return bare
  // A timestamp: validate the day before trusting the clock part, so
  // `2026-02-30T10:00:00Z` is refused here too rather than rolled into March.
  if (!/^\d{4}-\d{2}-\d{2}[T ]/.test(text)) return null
  const head = plainDay(text.slice(0, 10))
  if (!head) return null
  // A stamp with no offset states no zone, so it is read as already being in
  // the account's zone — which makes its day its own date part, no arithmetic
  // involved. Handing it to `new Date` instead would call it UTC (the spec's
  // rule for a date-time with no offset is local time, and a serverless host
  // runs in UTC), moving a Mumbai evening onto the next morning.
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) return head
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : dayIn(parsed)
}

// Plaid's rows, normalised. Exported because the rules live here and can be
// checked without a provider, an account or a network.
//
// It had no guards at all, while the Setu path below ended with a filter — so
// `amount: 0` passed as a credit (`0 > 0` is false) and a missing date passed
// through as `undefined`, which made `addIncome({ date: undefined, amount: 0 })`
// reachable from a sync. The file importer drops exactly these
// (`src/lib/statement.js:130`, `:151`) and this file's own header promises the
// same shape it produces.
export function normalisePlaid(rows, want = booksCurrency()) {
  const transactions = []
  const skipped = { unusable: 0, foreign: 0 }
  for (const t of Array.isArray(rows) ? rows : []) {
    const signed = Number(t?.amount)
    const date = toBankDate(t?.date)
    const amount = Math.abs(signed)
    if (!date || !Number.isFinite(signed) || amount <= 0) {
      skipped.unusable += 1
      continue
    }
    if (foreignCurrency(t?.iso_currency_code, want)) {
      skipped.foreign += 1
      continue
    }
    transactions.push({
      date,
      amount,
      // Plaid convention: a positive amount is money OUT of the account.
      direction: signed > 0 ? 'debit' : 'credit',
      description: String(t?.merchant_name || t?.name || '').trim(),
    })
  }
  return { transactions, skipped }
}

// The accounts in an AA bundle, whichever shape it arrived in.
//
// `j.fips?.flatMap(...) || j.accounts || []` could never reach the second
// branch: an empty array is truthy, so a payload with `fips: []` returned the
// empty list rather than falling back.
const accountsOf = (payload) => {
  const fromFips = Array.isArray(payload?.fips)
    ? payload.fips.flatMap((f) => (Array.isArray(f?.accounts) ? f.accounts : []))
    : []
  if (fromFips.length) return fromFips
  return Array.isArray(payload?.accounts) ? payload.accounts : []
}

// An XML-to-JSON conversion collapses a single-element list to a bare object,
// and `for (const t of anObject)` throws — which surfaced as a flat 502 for an
// account that happened to have one transaction in the window.
const txnsOf = (acc) => {
  const found = acc?.data?.account?.transactions?.transaction ?? acc?.Transactions?.Transaction ?? []
  if (Array.isArray(found)) return found
  return found && typeof found === 'object' ? [found] : []
}

// The Account Aggregator's rows, normalised.
//
// The direction was `type.includes('DEBIT') ? 'debit' : 'credit'`, with `type`
// read from `t.type || t._type || ''`. So a payload keyed `@type` — ordinary
// after an XML conversion — or a value of `OTHER` or `REVERSAL`, or a missing
// field, made every row a **credit**: money leaving the account booked as income
// received. The provider that gives an unambiguous direction was the one where
// the direction could silently invert.
//
// A negative amount is also informative and is honoured. A positive one is not:
// AA amounts are unsigned, so a positive number beside an unrecognised type says
// nothing at all, and that is the case that must drop rather than guess.
export function normaliseSetu(payload, want = booksCurrency()) {
  const transactions = []
  const skipped = { unusable: 0, foreign: 0 }
  for (const acc of accountsOf(payload)) {
    for (const t of txnsOf(acc)) {
      const type = String(t?.type ?? t?._type ?? t?.['@type'] ?? '').toUpperCase()
      const signed = Number(t?.amount)
      const amount = Math.abs(signed)
      const date = toBankDate(t?.valueDate ?? t?.transactionTimestamp)
      let direction = null
      if (type.includes('DEBIT')) direction = 'debit'
      else if (type.includes('CREDIT')) direction = 'credit'
      else if (Number.isFinite(signed) && signed < 0) direction = 'debit'
      if (!date || !direction || !Number.isFinite(signed) || amount <= 0) {
        skipped.unusable += 1
        continue
      }
      if (foreignCurrency(t?.currency, want)) {
        skipped.foreign += 1
        continue
      }
      transactions.push({
        date,
        amount,
        direction,
        description: String(t?.narration || t?.reference || '').trim(),
      })
    }
  }
  return { transactions, skipped }
}

async function readBody(req) {
  if (req.body != null && req.body !== '') return typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  const chunks = []
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c)
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

async function plaidFetch({ publicToken, since }) {
  const host = PLAID_HOSTS[process.env.PLAID_ENV || 'sandbox'] || PLAID_HOSTS.sandbox
  const creds = { client_id: process.env.PLAID_CLIENT_ID, secret: process.env.PLAID_SECRET }
  // 1) Exchange the Link public_token for a persistent access_token.
  const ex = await fetch(`${host}/item/public_token/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...creds, public_token: publicToken }),
  })
  if (!ex.ok) throw new Error(`plaid_exchange_${ex.status}`)
  const { access_token } = await ex.json()
  // 2) Pull transactions for the window.
  const tr = await fetch(`${host}/transactions/get`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...creds, access_token, start_date: since || '2020-01-01', end_date: today(), options: { count: 500 } }),
  })
  if (!tr.ok) throw new Error(`plaid_txns_${tr.status}`)
  const j = await tr.json()
  return normalisePlaid(j.transactions)
}

async function setuFetch({ sessionId, consentId, since }) {
  const base = process.env.SETU_BASE_URL || 'https://fiu-sandbox.setu.co'
  const headers = {
    'Content-Type': 'application/json',
    client_id: process.env.SETU_CLIENT_ID,
    client_secret: process.env.SETU_CLIENT_SECRET,
    'x-product-instance-id': process.env.SETU_PRODUCT_INSTANCE_ID || '',
  }
  // Create (or reuse) an FI data session, then fetch the account transactions.
  let sid = sessionId
  if (!sid) {
    const s = await fetch(`${base}/v2/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ consentId, DataRange: { from: (since || '2020-01-01') + 'T00:00:00Z', to: today() + 'T23:59:59Z' }, format: 'json' }),
    })
    if (!s.ok) throw new Error(`setu_session_${s.status}`)
    sid = (await s.json()).id
  }
  const r = await fetch(`${base}/v2/sessions/${sid}`, { headers })
  if (!r.ok) throw new Error(`setu_fetch_${r.status}`)
  return normaliseSetu(await r.json())
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, configured: configured(), provider: provider() })
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' })
    return
  }
  if (!configured()) {
    res.status(501).json({ error: 'bank_sync_not_configured', provider: provider() })
    return
  }

  // Linking a bank and pulling its transactions is not something an anonymous
  // caller should ever do, so this is requireUser rather than the "if
  // configured" variant: a deployment with a bank provider but no accounts has
  // no way to say who is asking, and the safe answer there is nobody.
  const auth = await requireUser(req)
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error })
    return
  }
  let body = {}
  try {
    body = await readBody(req)
  } catch {
    res.status(400).json({ error: 'bad_json' })
    return
  }
  try {
    // `skipped` travels with the rows. A sync that silently returns 40 of a
    // bank's 48 transactions is the same defect as one that returns none and
    // calls it an empty bank: the client has to be able to say what was left
    // out, and only this side knows.
    const { transactions, skipped } = provider() === 'setu' ? await setuFetch(body) : await plaidFetch(body)
    res.status(200).json({ transactions, skipped })
  } catch (err) {
    res.status(502).json({ error: err?.message || 'fetch_failed' })
  }
}
