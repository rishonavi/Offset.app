// The Authorization header for calls to Offset's own /api endpoints.
//
// The server takes the caller's identity from this token and never from the
// request body — a body can claim to be anyone. In demo mode there is no
// session, so this returns just the content type and the endpoint decides
// whether it will serve an anonymous caller.

export async function authHeaders(extra = {}) {
  const headers = { 'Content-Type': 'application/json', ...extra }
  try {
    const { supabase } = await import('./supabaseClient')
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
