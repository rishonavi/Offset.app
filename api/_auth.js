// Shared bearer-token check for the serverless endpoints.
//
// Prefixed with an underscore so Vercel treats it as a helper and does not
// route it — there is no /api/_auth.
//
// The rule the whole API depends on: identity comes from the token, never from
// the request body. A body can say it is anyone. Only Supabase can say whether
// a token is real, so the token is what gets asked.

import { createClient } from '@supabase/supabase-js'

const url = () => (process.env.SUPABASE_URL || '').trim()
const serviceRole = () => (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

// A deployment has accounts only if it has somewhere to check them against.
export const hasAccounts = () => Boolean(url() && serviceRole())

export const bearerToken = (req) => {
  const header = req.headers?.authorization || req.headers?.Authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() || null : null
}

// { ok: true, user } or { ok: false, status, error } — shaped so a caller can
// forward the failure straight to the response without restating the codes.
export async function requireUser(req) {
  if (!hasAccounts()) return { ok: false, status: 501, error: 'auth_not_configured' }
  const token = bearerToken(req)
  if (!token) return { ok: false, status: 401, error: 'unauthorized' }

  try {
    const admin = createClient(url(), serviceRole())
    const { data, error } = await admin.auth.getUser(token)
    if (error || !data?.user) return { ok: false, status: 401, error: 'unauthorized' }
    return { ok: true, user: data.user }
  } catch {
    // A network failure reaching Supabase is not the caller's fault, and
    // answering 401 would tell them to sign in again to fix something that has
    // nothing to do with their session.
    return { ok: false, status: 503, error: 'auth_unavailable' }
  }
}

// For endpoints that must stay usable on a deployment with no accounts at all —
// the demo deployments, where there is nobody to sign in as and so nothing to
// check. Where accounts do exist, this is exactly requireUser.
export async function requireUserIfConfigured(req) {
  if (!hasAccounts()) return { ok: true, user: null }
  return requireUser(req)
}
