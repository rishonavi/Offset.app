// Client helpers for Stripe checkout + billing portal. They call the serverless
// functions in /api/stripe/*.
//
// The signed-in user used to be sent in the body for the webhook to map the
// subscription back to an account. The endpoints read it from the token now —
// a body saying whose billing this is was a body anyone could write — so the
// header is the part that matters here.

import { authHeaders } from './authHeader'

async function postJson(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body || {}),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data?.error || `Request failed (${r.status})`)
  return data
}

export async function startCheckout(user) {
  const { url } = await postJson('/api/stripe/checkout', { userId: user?.id, email: user?.email })
  if (url) window.location.href = url
  else throw new Error('Could not start checkout.')
}

export async function openBillingPortal(user) {
  const { url } = await postJson('/api/stripe/portal', { userId: user?.id, email: user?.email })
  if (url) window.location.href = url
  else throw new Error('Could not open the billing portal.')
}
