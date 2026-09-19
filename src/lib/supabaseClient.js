import { SUPABASE_URL, SUPABASE_KEY, hasSupabase } from './cloudConfig'

export { hasSupabase }

// The client, fetched on first use.
//
// `createClient` was called at module scope, so importing this file for any
// reason pulled the library in. Nothing needs the client while a page is
// loading — every use is inside an async function or an effect — so it is
// fetched when somebody actually talks to the cloud, and kept afterwards.
//
// Builds with no cloud configured get `null` without downloading anything,
// which is the common case: a demo install never calls this at all.
let pending = null
export function client() {
  if (!hasSupabase) return Promise.resolve(null)
  return (pending ||= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    })))
}
