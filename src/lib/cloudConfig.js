// Whether this build has a cloud behind it.
//
// Two environment variables and a Boolean — and it used to live in the same
// module as `createClient`, which meant that asking the question downloaded the
// answer's whole library. `storage/index.js` imports this to choose a backend,
// so 197 kB of `@supabase/supabase-js` arrived on every route of every visit,
// including the demo builds that have no cloud at all and never call it.
//
// It is here, on its own, so that the question costs nothing to ask.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
export const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY)

// VITE_OPEN_ACCESS=true → skip login entirely and run on local browser storage,
// so anyone can open the site and use it with no credentials.
export const openAccess = String(import.meta.env.VITE_OPEN_ACCESS || '').toLowerCase() === 'true'
export const isCloud = hasSupabase && !openAccess
