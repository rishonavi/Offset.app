// The Authorization header for calls to Offset's own /api endpoints.
//
// The server takes the caller's identity from this token and never from the
// request body — a body can claim to be anyone. In demo mode there is no
// session, so this returns just the content type and the endpoint decides
// whether it will serve an anonymous caller.
//
// It used to read `const { supabase } = await import('./supabaseClient')`, from
// back when that module exported a client built at import time. The lazy
// refactor replaced it with `client()`, and this file was left behind: the
// import still resolved, `supabase` was quietly `undefined`, the `if` never
// ran, and every call went out with no token at all. Nothing threw and nothing
// logged.
//
// On a cloud deployment that meant receipt scanning, bank sync and both AI
// endpoints answered 401 to their own app, for ever. `lib/team.js` does the
// same job by hand a few lines long and was never affected, which is how the
// shape above is known to be right.
//
// `getClient` is a parameter so that can be tested without a Supabase project.

import { client } from './supabaseClient'

export async function authHeaders(extra = {}, getClient = client) {
  const headers = { 'Content-Type': 'application/json', ...extra }
  try {
    const supabase = await getClient()
    if (supabase) {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
    }
  } catch {
    /* no cloud session — the call goes out unauthenticated */
  }
  return headers
}

export default authHeaders
