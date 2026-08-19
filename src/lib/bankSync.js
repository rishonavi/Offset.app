// Client for the live bank-connection endpoints (api/bank/*). Degrades
// gracefully: a 501 means live sync isn't configured on this deployment, and
// the UI falls back to statement-file import. Fetched transactions come back in
// the SAME { date, amount, direction, description } shape as parseStatement, so
// they flow straight into reconcile().

import { authHeaders } from './authHeader'

export const bankSyncEnabled = String(import.meta.env.VITE_BANK_SYNC || '').toLowerCase() === 'true'
export const bankProvider = (import.meta.env.VITE_BANK_PROVIDER || 'plaid').toLowerCase()
export const bankProviderLabel = bankProvider === 'setu' ? 'Account Aggregator' : 'Plaid'

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
  if (!res.ok) throw new Error('The bank request failed — please try again.')
  return res.json()
}

// Begin a connection. Returns { provider, linkToken } (Plaid) or
// { provider, url, consentId } (Account Aggregator).
export async function startBankLink(userId) {
  return postJSON('/api/bank/link', { userId })
}

// Fetch normalised transactions once a connection/consent is in place.
export async function fetchLiveTransactions(params = {}) {
  const { transactions } = await postJSON('/api/bank/transactions', params)
  return Array.isArray(transactions) ? transactions : []
}
