// Client for the live bank-connection endpoints (api/bank/*). Degrades
// gracefully: a 501 means live sync isn't configured on this deployment, and
// the UI falls back to statement-file import. Fetched transactions come back in
// the SAME { date, amount, direction, description } shape as parseStatement, so
// they flow straight into reconcile().

import { authHeaders } from './authHeader'

export const bankSyncEnabled = String(import.meta.env.VITE_BANK_SYNC || '').toLowerCase() === 'true'
export const bankProvider = (import.meta.env.VITE_BANK_PROVIDER || 'plaid').toLowerCase()
export const bankProviderLabel = bankProvider === 'setu' ? 'Account Aggregator' : 'Plaid'

// What the server says it is running, which is the one that decides what
// happens. The client reads `VITE_BANK_PROVIDER` and the endpoints read
// `BANK_PROVIDER`, each defaulting to plaid on its own, so setting only the
// server one left the badge reading "Plaid" over an Account Aggregator flow.
// The GET on each endpoint exists to answer this and was never called.
export async function serverBankProvider() {
  try {
    const res = await fetch('/api/bank/link', { headers: await authHeaders() })
    if (!res.ok) return null
    const body = await res.json()
    return typeof body?.provider === 'string' ? body.provider.toLowerCase() : null
  } catch {
    // Not knowing is different from disagreeing, and neither is worth an error
    // on a screen somebody opened to import a statement.
    return null
  }
}

async function postJSON(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    // The bank endpoints refuse an anonymous caller once a provider is
    // configured — linking someone's bank account is not an anonymous act.
    headers: await authHeaders(),
    body: JSON.stringify(payload || {}),
  })
  if (res.status === 501) {
    const e = new Error('Live bank connection isn’t set up on this deployment yet.')
    e.code = 'not_configured'
    throw e
  }
  if (res.status === 401) {
    const e = new Error('Please sign in to connect a bank.')
    e.code = 'unauthorized'
    throw e
  }
  if (!res.ok) {
    // The server names what went wrong — `plaid_exchange_400`, `setu_fetch_502`,
    // `bad_json` — and this used to throw one sentence over all of them,
    // discarding the only diagnostic anybody had. "Please try again" is also
    // wrong advice for most of them.
    let detail = ''
    try {
      const body = await res.json()
      detail = String(body?.error || '').slice(0, 120)
    } catch {
      /* not JSON — an error page, or nothing at all */
    }
    const e = new Error(
      detail
        ? `The bank request failed (${detail}).`
        : `The bank request failed (${res.status}).`,
    )
    e.code = 'request_failed'
    e.status = res.status
    throw e
  }
  return res.json()
}

// Begin a connection. Returns { provider, linkToken } (Plaid) or
// { provider, url, consentId } (Account Aggregator).
//
// No argument: who the link is for comes from the bearer token the endpoint
// already verifies, never from the body. It used to take a `userId` and send it
// — which the one caller never passed, so the provider was handed a placeholder
// shared by every user of the deployment. Dropping the parameter is the half of
// that fix that stops it coming back.
export async function startBankLink() {
  return postJSON('/api/bank/link', {})
}

// Fetch normalised transactions once a connection/consent is in place.
//
// A body without a `transactions` array is a failure, not an empty bank. This
// used to answer `[]` for any 200 whose shape was unexpected — a changed key
// name, `{transactions: null}`, an HTML error page served with a 200 — and the
// screen rendered that as "No transactions found in that source", which tells
// somebody their bank had nothing to say. Same family as every other silent
// failure in this app: an empty answer that is really an unanswered question.
export async function fetchLiveTransactions(params = {}) {
  const body = await postJSON('/api/bank/transactions', params)
  if (!Array.isArray(body?.transactions)) {
    const e = new Error('The bank replied with something this app could not read.')
    e.code = 'unreadable_reply'
    throw e
  }
  // `skipped` says what the bank sent that could not be used. A sync that
  // quietly hands back 40 of 48 rows is the same silence as one that hands back
  // none and calls it an empty bank, so it travels with the rows and is said out
  // loud. An older deployment's endpoint does not send it; absent is not zero,
  // and `leftOutNote` says nothing rather than claiming nothing was dropped.
  const counts = body.skipped && typeof body.skipped === 'object' ? body.skipped : null
  return { transactions: body.transactions, skipped: counts }
}

// "2 rows were in another currency and were left out." Nothing at all when
// there is nothing to say — an unconditional "0 skipped" is noise, and a
// deployment whose endpoint predates the counts has no answer to give.
//
// Same reasoning as `skippedNote` in lib/dedupe.js: a silent drop and a silent
// double are equally hard to notice, and the count is the thing that lets
// somebody notice.
export function leftOutNote(skipped) {
  if (!skipped || typeof skipped !== 'object') return ''
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0)
  const foreign = n(skipped.foreign)
  const unusable = n(skipped.unusable)
  const parts = []
  if (foreign) parts.push(`${foreign} row${foreign === 1 ? '' : 's'} in another currency`)
  if (unusable) parts.push(`${unusable} with no usable date or amount`)
  if (!parts.length) return ''
  return ` Left out: ${parts.join(', ')}.`
}
