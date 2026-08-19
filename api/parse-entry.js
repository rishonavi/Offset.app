// Vercel serverless function: turns a plain-English description of a spend or
// receipt of money into structured fields, using Google Gemini. The client
// (src/lib/ai.js → parseEntry) POSTs { text, kind, assets } and prefills the
// add form with the result for the user to confirm.
//
// Env: GEMINI_API_KEY (required), SCAN_MODEL (optional; defaults gemini-2.0-flash).

import { requireUserIfConfigured } from './_auth.js'
import { rateLimited } from './_rate.js'

export const config = { maxDuration: 30 }

const MODEL = process.env.SCAN_MODEL || 'gemini-2.0-flash'
const API = 'https://generativelanguage.googleapis.com/v1beta'

const EXPENSE_CATEGORIES = [
  'Materials', 'Labor / Contractors', 'Permits & Legal', 'Utilities', 'Property Tax',
  'Maintenance & Repairs', 'Insurance', 'Loan / EMI', 'Brokerage / Marketing', 'Furnishing', 'Other',
]
const INCOME_SOURCES = ['Rent', 'Security Deposit', 'Maintenance Charges', 'Parking', 'Sale Proceeds', 'Other']

function parseJsonLoose(s) {
  if (!s) return null
  const t = s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    return JSON.parse(t)
  } catch {
    const m = t.match(/\{[\s\S]*\}/)
    if (m) {
      try {
        return JSON.parse(m[0])
      } catch {
        /* give up */
      }
    }
  }
  return null
}

function toNumber(v) {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''))
  return Number.isNaN(n) ? null : n
}
function toDate(v) {
  if (!v || typeof v !== 'string') return null
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}
function toStr(v) {
  if (v == null) return null
  const s = String(v).replace(/\s+/g, ' ').trim()
  if (!s || /^(n\/?a|none|unknown|null)$/i.test(s)) return null
  return s.slice(0, 80)
}

async function readBody(req) {
  if (req.body != null && req.body !== '') {
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  }
  const chunks = []
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c)
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function callGemini(apiKey, system, userText, schema) {
  const r = await fetch(`${API}/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema },
    }),
  })
  if (!r.ok) {
    const err = new Error(`gemini_${r.status}`)
    err.detail = await r.text().catch(() => '')
    throw err
  }
  const out = await r.json()
  return (out?.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join('\n')
}

export default async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, configured: !!apiKey })
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' })
    return
  }
  if (!apiKey) {
    res.status(501).json({ error: 'ai_not_configured' })
    return
  }

  // Every call past here spends the operator's Gemini quota, and this endpoint
  // was reachable by anyone who knew the URL. Where the deployment has accounts
  // the caller must be signed in; where it has none — a demo deployment, with
  // nobody to sign in as — the rate limit is what stands between the key and a
  // script pointed at it.
  const auth = await requireUserIfConfigured(req)
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error })
    return
  }
  if (rateLimited(req, res, auth.user, { max: 60 })) return

  let body
  try {
    body = await readBody(req)
  } catch {
    res.status(400).json({ error: 'bad_json' })
    return
  }

  const text = String(body?.text || '').trim()
  const kind = body?.kind === 'income' ? 'income' : 'expense'
  const assets = Array.isArray(body?.assets) ? body.assets.filter((a) => a?.name).slice(0, 100) : []
  if (!text) {
    res.status(400).json({ error: 'missing_text' })
    return
  }

  const isIncome = kind === 'income'
  const labelKey = isIncome ? 'source' : 'category'
  const partyKey = isIncome ? 'payer' : 'vendor'
  const options = isIncome ? INCOME_SOURCES : EXPENSE_CATEGORIES
  const assetNames = assets.map((a) => a.name)
  const today = new Date().toISOString().slice(0, 10)

  const system = `You convert a short plain-language note about a property-portfolio ${isIncome ? 'income receipt' : 'expense'} into structured fields. Today is ${today}. Return JSON with exactly these keys:
- "asset": the single best-matching asset name from this list — ${assetNames.join(' | ') || '(none provided)'}. Use the exact string from the list, or null if none clearly matches.
- "amount": the amount as a plain number (no symbols/commas), or null.
- "tax": any tax/GST amount as a plain number, or null.
- "date": the date in YYYY-MM-DD (resolve relative dates like "yesterday" against today), or null if unstated.
- "${labelKey}": the best-fit ${labelKey} from — ${options.join(', ')} — or a short custom label, or null.
- "${partyKey}": the ${isIncome ? 'payer' : 'vendor/payee'} name, or null.
All keys must be present; use null for anything not stated.`

  const schema = {
    type: 'OBJECT',
    properties: {
      asset: { type: 'STRING', nullable: true },
      amount: { type: 'NUMBER', nullable: true },
      tax: { type: 'NUMBER', nullable: true },
      date: { type: 'STRING', nullable: true },
      [labelKey]: { type: 'STRING', nullable: true },
      [partyKey]: { type: 'STRING', nullable: true },
    },
    required: ['asset', 'amount', 'tax', 'date', labelKey, partyKey],
  }

  try {
    const raw = await callGemini(apiKey, system, text, schema)
    const parsed = parseJsonLoose(raw) || {}
    // Map the returned asset name back to an id we gave it.
    const assetName = toStr(parsed.asset)
    const match = assetName ? assets.find((a) => a.name.toLowerCase() === assetName.toLowerCase()) : null
    res.status(200).json({
      property_id: match?.id || null,
      amount: toNumber(parsed.amount),
      tax: toNumber(parsed.tax),
      date: toDate(parsed.date),
      [labelKey]: toStr(parsed[labelKey]),
      [partyKey]: toStr(parsed[partyKey]),
    })
  } catch (err) {
    res.status(502).json({ error: err?.message || 'parse_failed', detail: (err?.detail || '').slice(0, 300) })
  }
}
