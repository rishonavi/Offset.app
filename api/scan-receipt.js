// Vercel serverless function: reads a receipt / bill / invoice with Google
// Gemini's free vision model and returns clean, structured fields. This is far
// more accurate than the on-device OCR (Tesseract) fallback — it understands
// layout, messy scans, handwriting and non-English receipts.
//
// The client (src/lib/ocr.js → scanReceipt) POSTs the file here and falls back
// to on-device OCR if it returns anything other than 200. If GEMINI_API_KEY is
// not configured the POST replies 501 so the app keeps working on OCR.
//
// Open this URL in a browser (GET) for a health check: it reports whether the
// key is set + valid and which models it can use — handy for diagnosing setup.
//
// Env:
//   GEMINI_API_KEY  (required for AI scanning — free key from aistudio.google.com)
//   SCAN_MODEL      (optional; defaults to gemini-2.0-flash)

export const config = { maxDuration: 30 }

const MODEL = process.env.SCAN_MODEL || 'gemini-2.0-flash'
const API = 'https://generativelanguage.googleapis.com/v1beta'

// Categories the app already uses — nudges the model to map onto an existing
// one so the result drops straight into the category picker.
const CATEGORIES = [
  'Materials',
  'Labor / Contractors',
  'Permits & Legal',
  'Utilities',
  'Property Tax',
  'Maintenance & Repairs',
  'Insurance',
  'Loan / EMI',
  'Brokerage / Marketing',
  'Furnishing',
  'Other',
]

const SYSTEM = `You are an expert bookkeeping assistant that reads a single receipt, bill or invoice and extracts its key fields. The image or PDF may be photographed at an angle, blurry, creased, handwritten, thermal-printed, or in a language other than English — read it as carefully as a human accountant would.

Return a JSON object with exactly these keys:

- "amount": the FINAL grand total actually paid or payable, as a plain number with no currency symbol and no thousands separators (use a dot for decimals). Prefer values labelled "Grand Total", "Total Amount", "Amount Payable", "Balance Due" or "Net Payable" over any sub-total. Use null only if no total can be found.
- "tax": the total tax charged on the bill (GST / VAT / sales tax / service tax) as a plain number. If CGST and SGST (or multiple tax lines) are itemised, return their sum. Use null if no tax is shown.
- "date": the invoice/receipt date in strict YYYY-MM-DD format. Infer the day/month order from context (e.g. Indian receipts are usually DD/MM/YYYY). Use null if no date is present.
- "vendor": the name of the business / merchant / supplier that ISSUED the receipt (the payee), not the customer. Keep it concise. Use null if not shown.
- "category": the single best-fit category for this expense from this list — ${CATEGORIES.join(', ')}. If none clearly fit, return a short custom label (1-3 words). Use null only if you cannot tell.

All five keys must always be present. Use the JSON value null (never "", "N/A" or 0) for anything you cannot determine.`

// Gemini structured-output schema (OpenAPI-subset; nullable so the model can
// honestly report missing fields instead of inventing them).
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    amount: { type: 'NUMBER', nullable: true },
    tax: { type: 'NUMBER', nullable: true },
    date: { type: 'STRING', nullable: true },
    vendor: { type: 'STRING', nullable: true },
    category: { type: 'STRING', nullable: true },
  },
  required: ['amount', 'tax', 'date', 'vendor', 'category'],
  propertyOrdering: ['amount', 'tax', 'date', 'vendor', 'category'],
}

// Tolerant JSON parse: strips code fences and pulls the first {...} block.
function parseJsonLoose(s) {
  if (!s) return null
  let t = s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    return JSON.parse(t)
  } catch {
    /* try to locate an embedded object */
  }
  const m = t.match(/\{[\s\S]*\}/)
  if (m) {
    try {
      return JSON.parse(m[0])
    } catch {
      /* give up */
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

// Free-plan monthly AI-scan cap. Keep in sync with src/lib/plans.js. Only
// enforced when ENFORCE_PLAN_LIMITS=true and Supabase service creds are set.
const FREE_SCAN_LIMIT = 10

// Decide whether this scan is allowed under the caller's plan. Returns
// { allow, uid?, admin?, month?, reason? }. A no-op (allow:true) when plan
// enforcement is off or Supabase isn't configured — so free/OCR keeps working.
async function scanGate(req) {
  const enforce = String(process.env.ENFORCE_PLAN_LIMITS || '').toLowerCase() === 'true'
  const url = process.env.SUPABASE_URL
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!enforce || !url || !serviceRole) return { allow: true }

  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return { allow: false, reason: 'unauthorized' }

  const { createClient } = await import('@supabase/supabase-js')
  const admin = createClient(url, serviceRole)
  const {
    data: { user },
    error,
  } = await admin.auth.getUser(token)
  if (error || !user) return { allow: false, reason: 'unauthorized' }

  const { data: profile } = await admin.from('profiles').select('plan').eq('user_id', user.id).maybeSingle()
  if ((profile?.plan || 'free') === 'pro') return { allow: true } // unlimited

  const month = new Date().toISOString().slice(0, 7)
  const { data: usage } = await admin
    .from('scan_usage')
    .select('count')
    .eq('user_id', user.id)
    .eq('month', month)
    .maybeSingle()
  if ((usage?.count || 0) >= FREE_SCAN_LIMIT) return { allow: false, reason: 'scan_limit_reached' }
  return { allow: true, uid: user.id, admin, month }
}

// Read + JSON-parse the request body, falling back to the raw stream if the
// runtime didn't pre-parse req.body.
async function readBody(req) {
  if (req.body != null && req.body !== '') {
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  }
  const chunks = []
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c)
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function callGemini(apiKey, parts, useSchema) {
  const generationConfig = { temperature: 0, responseMimeType: 'application/json' }
  if (useSchema) generationConfig.responseSchema = RESPONSE_SCHEMA
  const r = await fetch(`${API}/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts }],
      generationConfig,
    }),
  })
  if (!r.ok) {
    const detail = await r.text().catch(() => '')
    const err = new Error(`gemini_${r.status}`)
    err.status = r.status
    err.detail = detail
    throw err
  }
  const out = await r.json()
  return (out?.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text)
    .filter(Boolean)
    .join('\n')
}

// GET = health check: is the key set + valid, and can it use the chosen model?
async function health(res, apiKey) {
  if (!apiKey) {
    res.status(200).json({
      ok: true,
      configured: false,
      model: MODEL,
      hint: 'Set GEMINI_API_KEY in your host env vars (no VITE_ prefix), then redeploy.',
    })
    return
  }
  try {
    const r = await fetch(`${API}/models`, { headers: { 'x-goog-api-key': apiKey } })
    const body = await r.json().catch(() => null)
    if (!r.ok) {
      res.status(200).json({
        ok: true,
        configured: true,
        model: MODEL,
        keyValid: false,
        status: r.status,
        detail: (body?.error?.message || '').slice(0, 200),
      })
      return
    }
    const models = (body?.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => (m.name || '').replace('models/', ''))
      .filter(Boolean)
    res.status(200).json({
      ok: true,
      configured: true,
      model: MODEL,
      keyValid: true,
      modelAvailable: models.includes(MODEL),
      models,
    })
  } catch (e) {
    res.status(200).json({ ok: true, configured: true, model: MODEL, keyValid: false, error: e?.message })
  }
}

export default async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY

  if (req.method === 'GET') {
    await health(res, apiKey)
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' })
    return
  }
  if (!apiKey) {
    // Not configured — tell the client to use on-device OCR instead.
    res.status(501).json({ error: 'ai_not_configured' })
    return
  }

  let body
  try {
    body = await readBody(req)
  } catch {
    res.status(400).json({ error: 'bad_json' })
    return
  }

  const { media_type, data } = body || {}
  if (!data || !media_type) {
    res.status(400).json({ error: 'missing_image' })
    return
  }

  // Plan-limit gate (opt-in; no-op unless ENFORCE_PLAN_LIMITS=true).
  let gate
  try {
    gate = await scanGate(req)
  } catch {
    gate = { allow: true } // never block scanning on a limit-check failure
  }
  if (!gate.allow) {
    res.status(gate.reason === 'unauthorized' ? 401 : 429).json({ error: gate.reason })
    return
  }

  try {
    // Gemini handles both images and PDFs through inlineData.
    const parts = [
      { inlineData: { mimeType: media_type, data } },
      { text: 'Extract the fields from this receipt.' },
    ]

    let text
    try {
      text = await callGemini(apiKey, parts, true)
    } catch {
      // Retry without the schema (responseMimeType still forces JSON, and the
      // system prompt defines the shape) in case the schema is rejected.
      text = await callGemini(apiKey, parts, false)
    }

    const parsed = parseJsonLoose(text) || {}

    // Count this scan against the free monthly quota (only when gating a free user).
    if (gate.uid && gate.admin && gate.month) {
      await gate.admin.rpc('record_scan', { uid: gate.uid, mon: gate.month }).catch(() => {})
    }

    res.status(200).json({
      amount: toNumber(parsed.amount),
      tax: toNumber(parsed.tax),
      date: toDate(parsed.date),
      vendor: toStr(parsed.vendor),
      category: toStr(parsed.category),
    })
  } catch (err) {
    res
      .status(502)
      .json({ error: err?.message || 'scan_failed', detail: (err?.detail || '').slice(0, 300) })
  }
}
