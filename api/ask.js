// Vercel serverless function: answers a free-text question about the user's
// portfolio using Google Gemini, grounded ONLY in a compact data snapshot the
// client sends (built by src/lib/ai.js → buildDataSummary). The client
// (askData) POSTs { question, summary } and shows the answer.
//
// Env: GEMINI_API_KEY (required), SCAN_MODEL (optional; defaults gemini-2.0-flash).

export const config = { maxDuration: 30 }

const MODEL = process.env.SCAN_MODEL || 'gemini-2.0-flash'
const API = 'https://generativelanguage.googleapis.com/v1beta'

async function readBody(req) {
  if (req.body != null && req.body !== '') {
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  }
  const chunks = []
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c)
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const SYSTEM = `You are a precise financial analyst for a property / asset portfolio tracker. Answer the user's question using ONLY the JSON data snapshot provided — never invent transactions or assets. Amounts are in the user's own currency; report the raw numbers with thousands separators and do not add a currency symbol. Be concise (1-3 sentences), lead with the figure that answers the question, and when useful name the asset or category. If the snapshot doesn't contain enough information to answer, say so plainly and suggest what to log. Do not output code or JSON — reply in plain prose.`

async function callGemini(apiKey, userText) {
  const r = await fetch(`${API}/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { temperature: 0.2 },
    }),
  })
  if (!r.ok) {
    const err = new Error(`gemini_${r.status}`)
    err.detail = await r.text().catch(() => '')
    throw err
  }
  const out = await r.json()
  return (out?.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join('\n').trim()
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

  let body
  try {
    body = await readBody(req)
  } catch {
    res.status(400).json({ error: 'bad_json' })
    return
  }

  const question = String(body?.question || '').trim().slice(0, 500)
  const summary = body?.summary
  if (!question) {
    res.status(400).json({ error: 'missing_question' })
    return
  }

  try {
    const userText = `Question: ${question}\n\nData snapshot (JSON):\n${JSON.stringify(summary).slice(0, 120000)}`
    const answer = await callGemini(apiKey, userText)
    res.status(200).json({ answer: answer || 'I couldn’t find an answer in your data.' })
  } catch (err) {
    res.status(502).json({ error: err?.message || 'ask_failed', detail: (err?.detail || '').slice(0, 300) })
  }
}
