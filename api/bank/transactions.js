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
const today = () => new Date().toISOString().slice(0, 10)

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
  // Plaid convention: positive amount = money OUT of the account (a debit).
  return (j.transactions || []).map((t) => ({
    date: t.date,
    amount: Math.abs(Number(t.amount) || 0),
    direction: Number(t.amount) > 0 ? 'debit' : 'credit',
    description: t.merchant_name || t.name || '',
  }))
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
  const j = await r.json()
  // Flatten the AA FI bundle: each account carries a Transactions.Transaction[]
  // with type DEBIT/CREDIT, amount, valueDate and narration.
  const out = []
  for (const acc of j.fips?.flatMap((f) => f.accounts || []) || j.accounts || []) {
    const txns = acc?.data?.account?.transactions?.transaction || acc?.Transactions?.Transaction || []
    for (const t of txns) {
      const type = String(t.type || t._type || '').toUpperCase()
      out.push({
        date: String(t.valueDate || t.transactionTimestamp || '').slice(0, 10),
        amount: Math.abs(Number(t.amount) || 0),
        direction: type.includes('DEBIT') ? 'debit' : 'credit',
        description: t.narration || t.reference || '',
      })
    }
  }
  return out.filter((t) => t.date && t.amount > 0)
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
    const transactions = provider() === 'setu' ? await setuFetch(body) : await plaidFetch(body)
    res.status(200).json({ transactions })
  } catch (err) {
    res.status(502).json({ error: err?.message || 'fetch_failed' })
  }
}
