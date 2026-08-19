// Vercel serverless: begin a LIVE bank connection so transactions can flow in
// without exporting a file. Provider-agnostic:
//   • Plaid            — US / UK / EU (returns a Link token for Plaid Link)
//   • Account Aggregator — India, e.g. Setu / Finvu (returns a consent URL)
//
// This is a scaffold: the HTTP shapes follow each provider's docs, but you must
// supply credentials (and, for India, be a registered FIU / use an AA TSP).
// With no credentials set it returns 501 so the UI shows "not set up".
//
// Env (server-side only — NO VITE_ prefix):
//   BANK_PROVIDER = plaid | setu            (defaults to plaid)
//   Plaid: PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV(sandbox|development|production),
//          PLAID_COUNTRIES(csv, default US)
//   Setu : SETU_CLIENT_ID, SETU_CLIENT_SECRET, SETU_PRODUCT_INSTANCE_ID,
//          SETU_BASE_URL(default https://fiu-sandbox.setu.co), BANK_REDIRECT_URL

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

async function readBody(req) {
  if (req.body != null && req.body !== '') return typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  const chunks = []
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c)
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

async function plaidLinkToken(userId) {
  const host = PLAID_HOSTS[process.env.PLAID_ENV || 'sandbox'] || PLAID_HOSTS.sandbox
  const r = await fetch(`${host}/link/token/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      client_name: 'Offset',
      language: 'en',
      country_codes: (process.env.PLAID_COUNTRIES || 'US').split(','),
      user: { client_user_id: userId || 'offset-user' },
      products: ['transactions'],
    }),
  })
  if (!r.ok) throw new Error(`plaid_${r.status}`)
  const j = await r.json()
  // Client hands linkToken to Plaid Link; Link returns a public_token to exchange
  // in /api/bank/transactions.
  return { provider: 'plaid', linkToken: j.link_token, expiration: j.expiration }
}

async function setuConsent(userId) {
  const base = process.env.SETU_BASE_URL || 'https://fiu-sandbox.setu.co'
  const r = await fetch(`${base}/v2/consents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      client_id: process.env.SETU_CLIENT_ID,
      client_secret: process.env.SETU_CLIENT_SECRET,
      'x-product-instance-id': process.env.SETU_PRODUCT_INSTANCE_ID || '',
    },
    body: JSON.stringify({
      // Consent detail per the Account Aggregator spec; the exact template is
      // configured on your Setu product. `vua` is the user's VPA/handle.
      vua: userId || '',
      redirectUrl: process.env.BANK_REDIRECT_URL || '',
      context: [],
    }),
  })
  if (!r.ok) throw new Error(`setu_${r.status}`)
  const j = await r.json()
  // Redirect the user to `url` to approve; poll transactions once approved.
  return { provider: 'setu', url: j.url, consentId: j.id || j.consentId }
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
    const out = provider() === 'setu' ? await setuConsent(body.userId) : await plaidLinkToken(body.userId)
    res.status(200).json(out)
  } catch (err) {
    res.status(502).json({ error: err?.message || 'link_failed' })
  }
}
