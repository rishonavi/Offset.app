// Client helpers for the AI serverless endpoints (Gemini). Both degrade
// gracefully: a 501 means AI isn't configured on this deployment.

async function postJSON(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (res.status === 501) {
    const e = new Error('AI isn’t set up on this deployment yet.')
    e.code = 'not_configured'
    throw e
  }
  if (!res.ok) throw new Error('The AI request failed — please try again.')
  return res.json()
}

// Parse a plain-English note into structured add-form fields.
// kind: 'expense' | 'income'; assets: [{ id, name }].
export async function parseEntry(text, kind, assets = []) {
  return postJSON('/api/parse-entry', {
    text,
    kind,
    assets: assets.map((a) => ({ id: a.id, name: a.name })),
  })
}

// Answer a free-text question about the user's data. `summary` is a compact,
// id-free snapshot built by the caller (see buildDataSummary).
export async function askData(question, summary) {
  return postJSON('/api/ask', { question, summary })
}

// Build a compact, privacy-conscious snapshot of the workspace for the chat
// endpoint: asset names + a bounded set of recent transactions, no ids/receipts.
export function buildDataSummary({ properties = [], expenses = [], income = [] }, limit = 400) {
  const nameById = new Map(properties.map((p) => [p.id, p.name]))
  const trim = (rows, labelKey) =>
    rows.slice(0, limit).map((r) => ({
      asset: nameById.get(r.property_id) || null,
      date: r.date || null,
      amount: Number(r.amount) || 0,
      [labelKey]: r[labelKey] || null,
      status: r.status || null,
    }))
  return {
    today: new Date().toISOString().slice(0, 10),
    assets: properties.map((p) => ({
      name: p.name,
      type: p.type || null,
      value: Number(p.value) || null,
    })),
    expenses: trim(expenses, 'category'),
    income: trim(income, 'source'),
  }
}
